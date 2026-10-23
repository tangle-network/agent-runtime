import { createHash } from 'node:crypto'
import type { createPrivateCasS3Transport } from './s3-private-cas-request'

export interface PrivateCasNamespaceObject {
  readonly key: string
  readonly etag: string
  readonly byteLength: number
}

/** A complete current-object inventory. Callers must fence all namespace writers before retirement. */
export interface PrivateCasNamespaceInventory {
  readonly namespace: string
  readonly location: string
  /** Opaque identity of the endpoint/account, bucket and prefix that supplied this inventory. */
  readonly storeIdentity: string
  readonly objects: readonly PrivateCasNamespaceObject[]
  readonly sha256: string
}

export interface PrivateCasNamespaceRetirement {
  readonly namespace: string
  readonly location: string
  readonly deletedObjects: number
  readonly deletedBytes: number
  readonly remainingObjects: number
  readonly remainingBytes: number
  /** Current objects only; a versioned bucket may retain older versions. */
  readonly complete: boolean
}

export interface PrivateCasNamespaceOperations {
  inspectNamespace(input: {
    namespace: string
    signal?: AbortSignal
  }): Promise<PrivateCasNamespaceInventory>
  /** Refuses changed/unreviewed objects. Retry the same inventory after a partial failure. */
  retireNamespace(input: {
    inventory: PrivateCasNamespaceInventory
    signal?: AbortSignal
  }): Promise<PrivateCasNamespaceRetirement>
}

const NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const fingerprint = (
  namespace: string,
  location: string,
  storeIdentity: string,
  objects: readonly PrivateCasNamespaceObject[],
) =>
  `sha256:${createHash('sha256').update(JSON.stringify({ namespace, location, storeIdentity, objects })).digest('hex')}`

function xmlText(text: string): string {
  return text.replace(/&([^;]*);/gu, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[entity] !== undefined) return named[entity]!
    const numeric = /^#(?:x([0-9a-f]+)|([0-9]+))$/iu.exec(entity)
    if (!numeric) throw new Error('S3 private CAS list contains an unknown XML entity')
    const code = Number.parseInt(numeric[1] ?? numeric[2]!, numeric[1] ? 16 : 10)
    if (
      !Number.isSafeInteger(code) ||
      code <= 0 ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      throw new Error('S3 private CAS list contains an invalid XML character')
    return String.fromCodePoint(code)
  })
}

function field(text: string, name: string, optional = false): string | undefined {
  const values = [...text.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'gu'))]
  if (values.length !== 1) {
    if (optional && values.length === 0) return undefined
    throw new Error(`S3 private CAS list has an invalid ${name}`)
  }
  return xmlText(values[0]![1]!)
}

async function listPage(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('S3 private CAS list returned no body')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PAGE_BYTES) throw new Error('S3 private CAS list page exceeds its bound')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (
    /<!/u.test(text) ||
    !/^\s*(?:<\?xml[^>]*>\s*)?<ListBucketResult(?:\s[^>]*)?>[\s\S]*<\/ListBucketResult>\s*$/u.test(
      text,
    )
  )
    throw new Error('S3 private CAS list returned an invalid document')
  if (field(text, 'EncodingType') !== 'url')
    throw new Error('S3 private CAS list did not encode keys')
  const truncated = field(text, 'IsTruncated')
  if (truncated !== 'true' && truncated !== 'false')
    throw new Error('S3 private CAS list has no completion flag')
  const objects = [...text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)].map(([, row]) => {
    const byteLength = Number(field(row!, 'Size'))
    const key = decodeURIComponent(field(row!, 'Key')!)
    const etag = field(row!, 'ETag')!
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || !etag || /[\r\n]/u.test(etag))
      throw new Error('S3 private CAS list has invalid object metadata')
    return { key, etag, byteLength }
  })
  const count = field(text, 'KeyCount')
  if (!/^\d+$/u.test(count!) || Number(count) !== objects.length)
    throw new Error('S3 private CAS list object count is inconsistent')
  const next = field(text, 'NextContinuationToken', true)
  if (truncated === 'true' && !next) throw new Error('S3 private CAS list omitted its next page')
  return { objects, next: truncated === 'true' ? next : undefined }
}

/** Generic storage operation only; ownership, holds, references and writer fencing belong to its consumer. */
export function privateCasNamespaceOperations({
  request,
  refusal,
  prefix,
  location,
  storeIdentity,
}: ReturnType<typeof createPrivateCasS3Transport> & {
  prefix: string
  location: string
  storeIdentity: string
}): PrivateCasNamespaceOperations {
  const namespacePrefix = (namespace: string) => {
    if (!NAMESPACE.test(namespace)) throw new Error('S3 private CAS namespace is invalid')
    return `${prefix}${namespace}/`
  }
  const validObject = (object: PrivateCasNamespaceObject, scope: string) => {
    if (
      !object.key.startsWith(scope) ||
      object.key.length === scope.length ||
      object.key.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('S3 private CAS inventory contains a key outside its namespace')
    if (
      !Number.isSafeInteger(object.byteLength) ||
      object.byteLength < 0 ||
      !object.etag ||
      /[\r\n]/u.test(object.etag)
    )
      throw new Error('S3 private CAS inventory contains invalid object metadata')
  }
  const inspectNamespace: PrivateCasNamespaceOperations['inspectNamespace'] = async ({
    namespace,
    signal,
  }) => {
    const scope = namespacePrefix(namespace)
    const objects: PrivateCasNamespaceObject[] = []
    const tokens = new Set<string>()
    const keys = new Set<string>()
    let next: string | undefined
    do {
      signal?.throwIfAborted()
      const response = await request('GET', '', {
        query: {
          'list-type': '2',
          'encoding-type': 'url',
          'max-keys': '1000',
          prefix: scope,
          ...(next ? { 'continuation-token': next } : {}),
        },
        ...(signal ? { signal } : {}),
      })
      if (!response.ok) throw await refusal(response, 'namespace list')
      const page = await listPage(response)
      for (const object of page.objects) {
        validObject(object, scope)
        if (keys.has(object.key)) throw new Error('S3 private CAS list repeated an object')
        keys.add(object.key)
        objects.push(object)
      }
      next = page.next
      if (next && tokens.has(next))
        throw new Error('S3 private CAS list repeated its continuation token')
      if (next) tokens.add(next)
    } while (next)
    objects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    return {
      namespace,
      location,
      storeIdentity,
      objects,
      sha256: fingerprint(namespace, location, storeIdentity, objects),
    }
  }
  return {
    inspectNamespace,
    async retireNamespace({ inventory, signal }) {
      const { namespace, objects } = inventory
      const scope = namespacePrefix(namespace)
      if (
        inventory.location !== location ||
        inventory.storeIdentity !== storeIdentity ||
        inventory.sha256 !== fingerprint(namespace, location, storeIdentity, objects)
      )
        throw new Error('S3 private CAS retirement inventory does not match this store')
      const reviewed = new Map<string, PrivateCasNamespaceObject>()
      for (const object of objects) {
        validObject(object, scope)
        if (reviewed.has(object.key))
          throw new Error('S3 private CAS retirement inventory repeats an object')
        reviewed.set(object.key, object)
      }
      const current = await inspectNamespace({ namespace, ...(signal ? { signal } : {}) })
      for (const object of current.objects) {
        const prior = reviewed.get(object.key)
        if (!prior || prior.etag !== object.etag || prior.byteLength !== object.byteLength)
          throw new Error('S3 private CAS namespace changed after its reviewed inventory')
      }
      let deletedObjects = 0
      let deletedBytes = 0
      for (const object of current.objects) {
        signal?.throwIfAborted()
        const check = await request('HEAD', object.key, { ...(signal ? { signal } : {}) })
        if (check.status === 404) {
          await check.body?.cancel()
          continue
        }
        if (!check.ok) throw await refusal(check, 'retirement HEAD')
        await check.body?.cancel()
        if (
          check.headers.get('etag') !== object.etag ||
          check.headers.get('content-length') === null ||
          Number(check.headers.get('content-length')) !== object.byteLength
        )
          throw new Error('S3 private CAS object changed before retirement')
        // The consumer has fenced writers; the fresh inventory/HEAD protects stale review and retries.
        const response = await request('DELETE', object.key, { ...(signal ? { signal } : {}) })
        if (!response.ok) throw await refusal(response, 'namespace delete')
        await response.body?.cancel()
        const absent = await request('HEAD', object.key, { ...(signal ? { signal } : {}) })
        await absent.body?.cancel()
        if (absent.status !== 404)
          throw new Error('S3 private CAS object is not confirmed absent after retirement')
        deletedObjects++
        deletedBytes += object.byteLength
        if (!Number.isSafeInteger(deletedBytes))
          throw new Error('S3 private CAS retired payload bytes exceed the safe integer range')
      }
      const remaining = await inspectNamespace({ namespace, ...(signal ? { signal } : {}) })
      return {
        namespace,
        location,
        deletedObjects,
        deletedBytes,
        remainingObjects: remaining.objects.length,
        remainingBytes: remaining.objects.reduce((sum, object) => sum + object.byteLength, 0),
        complete: remaining.objects.length === 0,
      }
    },
  }
}
