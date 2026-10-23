import { createHash, createHmac } from 'node:crypto'
import type { S3PrivateCasStoreOptions } from './s3-private-cas-store'

const EMPTY_PAYLOAD = createHash('sha256').update('').digest('hex')
const hex = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
const hmac = (key: string | Buffer, value: string): Buffer => createHmac('sha256', key).update(value).digest()
const encode = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

/** The single signed transport for private CAS object, pointer and namespace operations. */
export function createPrivateCasS3Transport(options: S3PrivateCasStoreOptions, endpoint: URL) {
  const region = options.region ?? 'auto'
  const timeoutMs = options.timeoutMs ?? 120_000
  const send = options.fetch ?? fetch
  const request = async (
    method: 'GET' | 'HEAD' | 'PUT' | 'DELETE',
    objectKey: string,
    {
      body,
      byteLength,
      payloadHash = EMPTY_PAYLOAD,
      headers = {},
      signal,
      query = {},
    }: {
      body?: Uint8Array | ReadableStream<Uint8Array>
      byteLength?: number
      payloadHash?: string
      headers?: Record<string, string>
      signal?: AbortSignal
      query?: Record<string, string>
    } = {},
  ): Promise<Response> => {
    const path = `/${[options.bucket, ...objectKey.split('/')].map(encode).join('/')}`
    const url = new URL(path, endpoint)
    const canonicalQuery = Object.entries(query).map(([name, value]) => [encode(name), encode(value)] as const).sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0).map(([name, value]) => `${name}=${value}`).join('&')
    url.search = canonicalQuery
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/gu, '')
    const day = amzDate.slice(0, 8)
    const signed: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
      ),
    }
    const names = Object.keys(signed).sort()
    const canonical = [
      method,
      path,
      canonicalQuery,
      names.map((name) => `${name}:${signed[name]!.trim()}\n`).join(''),
      names.join(';'),
      payloadHash,
    ].join('\n')
    const scope = `${day}/${region}/s3/aws4_request`
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${options.secretAccessKey}`, day), region), 's3'),
      'aws4_request',
    )
    const signature = createHmac('sha256', signingKey)
      .update(['AWS4-HMAC-SHA256', amzDate, scope, hex(canonical)].join('\n'))
      .digest('hex')
    const { host: _host, ...sent } = signed
    const deadline = AbortSignal.timeout(
      timeoutMs +
        Math.ceil(
          (byteLength ?? (body instanceof Uint8Array ? body.byteLength : 0)) / (1024 * 1024),
        ) *
          1_000,
    )
    return await send(url, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
      },
      ...(body === undefined ? {} : { body }),
      ...(body instanceof ReadableStream ? { duplex: 'half' as const } : {}),
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    })
  }

  const refusal = async (response: Response, action: string): Promise<Error> => {
    const reader = response.body?.getReader()
    let detail = ''
    try {
      while (reader && detail.length < 300) {
        const { done, value } = await reader.read()
        if (done) break
        detail += new TextDecoder().decode(value.subarray(0, 300))
      }
    } catch {
      /* A refused response may close before its diagnostic body arrives. */
    } finally {
      await reader?.cancel().catch(() => undefined)
    }
    detail = detail.replace(/\s+/gu, ' ').slice(0, 300)
    return new Error(
      `S3 private CAS ${action} returned ${response.status}${detail ? `: ${detail}` : ''}`,
    )
  }

  return { request, refusal }
}
