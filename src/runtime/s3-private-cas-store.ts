import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Sha256Digest } from '@tangle-network/agent-interface'
import type { PrivateCasDurableStore } from './private-cas'
import {
  type PrivateCasNamespaceOperations,
  privateCasNamespaceOperations,
} from './s3-private-cas-namespace'
import { createPrivateCasS3Transport } from './s3-private-cas-request'

export type {
  PrivateCasNamespaceInventory,
  PrivateCasNamespaceObject,
  PrivateCasNamespaceRetirement,
} from './s3-private-cas-namespace'

const DIGEST = /^sha256:([0-9a-f]{64})$/u
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u
const PREFIX = /^(?:[A-Za-z0-9._-]+\/)*$/u
const NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u
// A pointer name: up to four path segments, never inside the content-addressed `sha256/` tree.
const POINTER_NAME =
  /^(?!sha256\/)[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}){0,3}$/u
const POINTER_MAX_BYTES = 1024 * 1024
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
/**
 * The S3 store also holds small named pointers beside its content-addressed objects. A pointer
 * names the latest of a changing set of CAS objects, such as a run's controller manifest, so a
 * reader finds the newest copy with one GET instead of listing and opening every object.
 */
export interface S3PrivateCasStore extends PrivateCasDurableStore, PrivateCasNamespaceOperations {
  /** Replace the pointer at `<prefix><namespace>/<name>`. Resolves after the bucket confirms its length and digest. */
  putPointer(object: {
    namespace: string
    name: string
    bytes: Uint8Array
    signal?: AbortSignal
  }): Promise<void>
  /** The pointer's bytes, or undefined when none was written. */
  getPointer(object: {
    namespace: string
    name: string
    signal?: AbortSignal
  }): Promise<Uint8Array | undefined>
}

/**
 * Durable private CAS bytes in one S3-compatible bucket under `<prefix><namespace>/sha256/<hex>`.
 *
 * Every write declares its SHA-256 as the signed payload hash, so the store refuses bytes that
 * do not match the digest. A write is confirmed by reading back the object's length and digest
 * metadata. Reads return raw bytes; the private CAS port verifies them.
 */
export function createS3PrivateCasStore(options: S3PrivateCasStoreOptions): S3PrivateCasStore {
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

  const key = (namespace: string, digest: Sha256Digest): string => {
    if (!NAMESPACE.test(namespace)) throw new Error('S3 private CAS namespace is invalid')
    const match = DIGEST.exec(digest)
    if (!match) throw new Error('S3 private CAS digest must be sha256:<64 lowercase hex>')
    return `${prefix}${namespace}/sha256/${match[1]}`
  }

  const pointerKey = (namespace: string, name: string): string => {
    if (!NAMESPACE.test(namespace)) throw new Error('S3 private CAS namespace is invalid')
    if (!POINTER_NAME.test(name)) throw new Error('S3 private CAS pointer name is invalid')
    return `${prefix}${namespace}/${name}`
  }

  const { request, refusal } = createPrivateCasS3Transport(options, endpoint)
  const namespaceOperations = privateCasNamespaceOperations({
    request,
    refusal,
    prefix,
    location: `s3://${options.bucket}/${prefix}`,
    storeIdentity: `sha256:${hex(JSON.stringify({ endpoint: endpoint.origin, bucket: options.bucket, prefix }))}`,
  })

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
    ...namespaceOperations,
    async putStream({ namespace, digest, byteLength, chunks, signal }) {
      const objectKey = key(namespace, digest)
      if (await holds(objectKey, digest, byteLength, signal)) return
      async function* checked(): AsyncGenerator<Uint8Array> {
        const hash = createHash('sha256')
        let total = 0
        for await (const chunk of chunks) {
          signal?.throwIfAborted()
          total += chunk.byteLength
          if (total > byteLength)
            throw new Error('S3 private CAS stream exceeds its declared length')
          hash.update(chunk)
          yield chunk
        }
        if (total !== byteLength || `sha256:${hash.digest('hex')}` !== digest)
          throw new Error('S3 private CAS stream failed digest or length verification')
      }
      const body = Readable.from(checked())
      try {
        const response = await request('PUT', objectKey, {
          body: Readable.toWeb(body) as ReadableStream<Uint8Array>,
          byteLength,
          payloadHash: DIGEST.exec(digest)![1]!,
          headers: {
            'content-type': CONTENT_TYPE,
            'content-length': String(byteLength),
            [METADATA_DIGEST]: digest,
          },
          ...(signal === undefined ? {} : { signal }),
        })
        if (!response.ok) throw await refusal(response, 'PUT')
        await response.body?.cancel().catch(() => undefined)
        if (!(await holds(objectKey, digest, byteLength, signal)))
          throw new Error(`S3 private CAS object ${objectKey} is absent after its write`)
      } finally {
        body.destroy()
      }
    },
    async getStream({ namespace, digest, signal }) {
      const response = await request(
        'GET',
        key(namespace, digest),
        signal === undefined ? {} : { signal },
      )
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined)
        return undefined
      }
      if (!response.ok) throw await refusal(response, 'GET')
      if (!response.body) throw new Error('S3 private CAS GET returned no body')
      return (async function* () {
        const reader = response.body!.getReader()
        try {
          while (true) {
            signal?.throwIfAborted()
            const { done, value } = await reader.read()
            if (done) break
            yield value
          }
        } finally {
          await reader.cancel().catch(() => undefined)
        }
      })()
    },
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
      await response.body?.cancel().catch(() => undefined)
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
        await response.body?.cancel().catch(() => undefined)
        return undefined
      }
      if (!response.ok) throw await refusal(response, 'GET')
      return new Uint8Array(await response.arrayBuffer())
    },
    async putPointer({ namespace, name, bytes, signal }) {
      if (bytes.byteLength > POINTER_MAX_BYTES)
        throw new Error('S3 private CAS pointer exceeds 1 MiB; store the content in CAS')
      const objectKey = pointerKey(namespace, name)
      const digest = `sha256:${hex(bytes)}` as Sha256Digest
      const response = await request('PUT', objectKey, {
        body: bytes,
        payloadHash: hex(bytes),
        headers: { 'content-type': 'application/json', [METADATA_DIGEST]: digest },
        ...(signal === undefined ? {} : { signal }),
      })
      if (!response.ok) throw await refusal(response, 'PUT')
      await response.body?.cancel().catch(() => undefined)
      // A concurrent writer may already have replaced it; only an absent or unreadable pointer fails.
      const confirm = await request('HEAD', objectKey, signal === undefined ? {} : { signal })
      await confirm.body?.cancel().catch(() => undefined)
      if (!confirm.ok)
        throw new Error(`S3 private CAS pointer ${objectKey} is absent after its write`)
    },
    async getPointer({ namespace, name, signal }) {
      const response = await request(
        'GET',
        pointerKey(namespace, name),
        signal === undefined ? {} : { signal },
      )
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined)
        return undefined
      }
      if (!response.ok) throw await refusal(response, 'GET')
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
