import { createHash, createHmac } from 'node:crypto'
import type { Sha256Digest } from '@tangle-network/agent-interface'
import type { PrivateCasDurableStore } from './private-cas'

const DIGEST = /^sha256:([0-9a-f]{64})$/u
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u
const PREFIX = /^(?:[A-Za-z0-9._-]+\/)*$/u
const NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u
const EMPTY_PAYLOAD = createHash('sha256').update('').digest('hex')
const CONTENT_TYPE = 'application/octet-stream'
const METADATA_DIGEST = 'x-amz-meta-sha256'

/** An S3-compatible bucket (Amazon S3, Cloudflare R2) addressed with path-style requests. */
export interface S3PrivateCasStoreOptions {
  /** HTTPS origin of the S3 API, for example `https://<account>.r2.cloudflarestorage.com`. */
  readonly endpoint: string
  readonly bucket: string
  /** Signing region. R2 uses `auto`. */
  readonly region?: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** Key prefix: empty, or path segments that end in `/`. */
  readonly prefix?: string
  /** Minimum time for one request; large bodies get one more second per MiB. */
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

const hex = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
const hmac = (key: string | Buffer, value: string): Buffer =>
  createHmac('sha256', key).update(value).digest()
const encode = (segment: string): string =>
  encodeURIComponent(segment).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )

/**
 * Durable private CAS bytes in one S3-compatible bucket under `<prefix><namespace>/sha256/<hex>`.
 *
 * Every write declares its SHA-256 as the signed payload hash, so the store refuses bytes that
 * do not match the digest. A write is confirmed by reading back the object's length and digest
 * metadata. Reads return raw bytes; the private CAS port verifies them.
 */
export function createS3PrivateCasStore(options: S3PrivateCasStoreOptions): PrivateCasDurableStore {
  const endpoint = new URL(options.endpoint)
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== '/' && endpoint.pathname !== '')
  )
    throw new Error('S3 private CAS endpoint must be a bare https origin')
  if (!BUCKET.test(options.bucket)) throw new Error('S3 private CAS bucket name is invalid')
  const prefix = options.prefix ?? ''
  if (!PREFIX.test(prefix)) throw new Error('S3 private CAS prefix must be empty or end in /')
  if (!options.accessKeyId || !options.secretAccessKey)
    throw new Error('S3 private CAS needs an access key id and secret')
  const region = options.region ?? 'auto'
  const timeoutMs = options.timeoutMs ?? 120_000
  const send = options.fetch ?? fetch

  const key = (namespace: string, digest: Sha256Digest): string => {
    if (!NAMESPACE.test(namespace)) throw new Error('S3 private CAS namespace is invalid')
    const match = DIGEST.exec(digest)
    if (!match) throw new Error('S3 private CAS digest must be sha256:<64 lowercase hex>')
    return `${prefix}${namespace}/sha256/${match[1]}`
  }

  const request = async (
    method: 'GET' | 'HEAD' | 'PUT',
    objectKey: string,
    {
      body,
      payloadHash = EMPTY_PAYLOAD,
      headers = {},
      signal,
    }: {
      body?: Uint8Array
      payloadHash?: string
      headers?: Record<string, string>
      signal?: AbortSignal
    } = {},
  ): Promise<Response> => {
    const path = `/${[options.bucket, ...objectKey.split('/')].map(encode).join('/')}`
    const url = new URL(path, endpoint)
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
      '',
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
      timeoutMs + Math.ceil((body?.byteLength ?? 0) / (1024 * 1024)) * 1_000,
    )
    return await send(url, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
      },
      ...(body === undefined ? {} : { body }),
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    })
  }

  const refusal = async (response: Response, action: string): Promise<Error> => {
    const detail = (await response.text().catch(() => '')).replace(/\s+/gu, ' ').slice(0, 300)
    return new Error(
      `S3 private CAS ${action} returned ${response.status}${detail ? `: ${detail}` : ''}`,
    )
  }

  /** Whether the bucket holds this exact object; refuses a same-key object of other bytes. */
  const holds = async (
    objectKey: string,
    digest: Sha256Digest,
    byteLength: number,
    signal?: AbortSignal,
  ) => {
    const response = await request('HEAD', objectKey, signal === undefined ? {} : { signal })
    if (response.status === 404) return false
    if (!response.ok) throw await refusal(response, 'HEAD')
    const length = Number(response.headers.get('content-length'))
    const recorded = response.headers.get(METADATA_DIGEST)
    if (length !== byteLength || (recorded !== null && recorded !== digest))
      throw new Error(`S3 private CAS object ${objectKey} has another length or digest`)
    return recorded === digest
  }

  return {
    location: `s3://${options.bucket}/${prefix}`,
    async put({ namespace, digest, bytes, signal }) {
      const objectKey = key(namespace, digest)
      if (await holds(objectKey, digest, bytes.byteLength, signal)) return
      const response = await request('PUT', objectKey, {
        body: bytes,
        payloadHash: DIGEST.exec(digest)![1]!,
        headers: { 'content-type': CONTENT_TYPE, [METADATA_DIGEST]: digest },
        ...(signal === undefined ? {} : { signal }),
      })
      if (!response.ok) throw await refusal(response, 'PUT')
      await response.arrayBuffer().catch(() => undefined)
      if (!(await holds(objectKey, digest, bytes.byteLength, signal)))
        throw new Error(`S3 private CAS object ${objectKey} is absent after its write`)
    },
    async get({ namespace, digest, signal }) {
      const response = await request(
        'GET',
        key(namespace, digest),
        signal === undefined ? {} : { signal },
      )
      if (response.status === 404) {
        await response.arrayBuffer().catch(() => undefined)
        return undefined
      }
      if (!response.ok) throw await refusal(response, 'GET')
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
