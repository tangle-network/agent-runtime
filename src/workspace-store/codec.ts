/**
 * Content encryption for the workspace store. {@link withContentCodec} wraps
 * any adapter so `content` is sealed before it reaches storage and opened on
 * the way out; paths, kinds, revisions, actors and tombstones stay plaintext so
 * listing, compare-and-set and erasure keep working. Hosts seal R2 bytes with
 * {@link sealWorkspaceBytes} before upload, under the same tenant and path.
 *
 * Each sealed value names its key id, so keys rotate by adding a key and moving
 * `activeKeyId`; old values stay readable while their key is kept. The tenant
 * and path are authenticated data: a value copied to another path or tenant
 * does not open.
 *
 * Web Crypto only: Worker-safe.
 */
import type { WorkspaceEntry, WorkspaceStore } from './store'

/** Where a value lives; bound into the ciphertext. */
export interface WorkspaceCodecContext {
  readonly tenant: string
  readonly path: string
  /**
   * The write's `operationId`, when it has one. A codec then seals the same
   * plaintext to the same bytes, so a replayed put is the same write.
   */
  readonly operationId?: string
}

export interface WorkspaceContentCodec {
  seal(plain: Uint8Array, context: WorkspaceCodecContext): Promise<Uint8Array>
  open(sealed: Uint8Array, context: WorkspaceCodecContext): Promise<Uint8Array>
}

/** A value did not open: unknown key, wrong tenant or path, tampering, or plaintext where a seal was required. */
export class WorkspaceCodecError extends Error {
  readonly code = 'codec' as const
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceCodecError'
  }
}

const VERSION = 1
const IV_BYTES = 12
const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function bytesOf(value: string | Uint8Array): Uint8Array {
  if (typeof value !== 'string') return value
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  }
  return btoa(binary)
}

/** A copy in a plain ArrayBuffer, which every Web Crypto typing accepts (this package has no DOM lib). */
function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Strings joined with a 4-byte length before each, so no two lists encode alike. */
function framed(...values: string[]): Uint8Array {
  return concat(
    ...values.flatMap((value) => {
      const bytes = encoder.encode(value)
      const length = new Uint8Array(4)
      new DataView(length.buffer).setUint32(0, bytes.length)
      return [length, bytes]
    }),
  )
}

/** The authenticated data: the tenant and path a value belongs to. */
const associated = ({ tenant, path }: WorkspaceCodecContext) => framed(tenant, path)

interface DerivedKey {
  readonly seal: CryptoKey
  readonly iv: CryptoKey
}

/**
 * AES-256-GCM with a key id per value. `keys` maps key id to 32 raw bytes
 * (base64 or base64url when a string). The encryption key and the key that
 * derives replay-stable IVs are both derived from the raw key with HKDF, so the
 * raw key is never used for two algorithms.
 *
 * Without an `operationId` every seal uses a random 96-bit IV. With one, the IV
 * is an HMAC of the tenant, path, operation and plaintext, as in SIV: only an
 * identical write repeats it, and that repeat reveals only that the write was
 * repeated.
 */
export function createAesGcmContentCodec(options: {
  keys: Readonly<Record<string, string | Uint8Array>>
  activeKeyId: string
}): WorkspaceContentCodec {
  const raw = new Map<string, Uint8Array>()
  for (const [id, value] of Object.entries(options.keys)) {
    if (!KEY_ID.test(id))
      throw new TypeError(`workspace store key id is not [A-Za-z0-9_-]{1,64}: ${id}`)
    const bytes = bytesOf(value)
    if (bytes.length !== 32)
      throw new TypeError(`workspace store key ${id} must be 32 bytes, got ${bytes.length}`)
    raw.set(id, bytes)
  }
  if (!raw.has(options.activeKeyId)) {
    throw new TypeError(
      `the active workspace store key ${options.activeKeyId} is not among the keys`,
    )
  }
  const derived = new Map<string, Promise<DerivedKey>>()
  const keyFor = (id: string): Promise<DerivedKey> => {
    const bytes = raw.get(id)
    if (!bytes)
      return Promise.reject(new WorkspaceCodecError(`unknown workspace store key id: ${id}`))
    let key = derived.get(id)
    if (!key) {
      key = (async () => {
        const base = await crypto.subtle.importKey('raw', arrayBuffer(bytes), 'HKDF', false, [
          'deriveKey',
        ])
        const hkdf = (info: string) => ({
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new Uint8Array(32),
          info: encoder.encode(`workspace-store/${info}`),
        })
        return {
          seal: await crypto.subtle.deriveKey(
            hkdf('aes-256-gcm'),
            base,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
          ),
          iv: await crypto.subtle.deriveKey(
            hkdf('siv'),
            base,
            { name: 'HMAC', hash: 'SHA-256', length: 256 },
            false,
            ['sign'],
          ),
        }
      })()
      derived.set(id, key)
    }
    return key
  }
  return {
    async seal(plain, context) {
      const id = options.activeKeyId
      const key = await keyFor(id)
      const aad = associated(context)
      const iv =
        context.operationId === undefined
          ? crypto.getRandomValues(new Uint8Array(IV_BYTES))
          : new Uint8Array(
              await crypto.subtle.sign(
                'HMAC',
                key.iv,
                arrayBuffer(
                  concat(framed(context.tenant, context.path, context.operationId), plain),
                ),
              ),
            ).slice(0, IV_BYTES)
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: arrayBuffer(iv), additionalData: arrayBuffer(aad) },
          key.seal,
          arrayBuffer(plain),
        ),
      )
      const keyId = encoder.encode(id)
      return concat(Uint8Array.of(VERSION, keyId.length), keyId, iv, sealed)
    },
    async open(sealed, context) {
      if (sealed.length < 2 || sealed[0] !== VERSION)
        throw new WorkspaceCodecError('not a sealed workspace value')
      const idLength = sealed[1]!
      const start = 2 + idLength
      if (sealed.length < start + IV_BYTES + 16)
        throw new WorkspaceCodecError('a sealed workspace value is truncated')
      const key = await keyFor(new TextDecoder().decode(sealed.subarray(2, start)))
      try {
        return new Uint8Array(
          await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: arrayBuffer(sealed.subarray(start, start + IV_BYTES)),
              additionalData: arrayBuffer(associated(context)),
            },
            key.seal,
            arrayBuffer(sealed.subarray(start + IV_BYTES)),
          ),
        )
      } catch {
        throw new WorkspaceCodecError(
          `${context.path}: the sealed value does not open for this tenant and path`,
        )
      }
    },
  }
}

/**
 * The AES-256-GCM codec from an app's env, or `null` when neither variable is
 * set. `WORKSPACE_STORE_KEYS` is `id:base64,id:base64`; `WORKSPACE_STORE_KEY_ID`
 * names the key new writes use. Setting one without the other is refused.
 */
export function aesGcmContentCodecFromEnv(env: {
  WORKSPACE_STORE_KEYS?: string
  WORKSPACE_STORE_KEY_ID?: string
}): WorkspaceContentCodec | null {
  const list = env.WORKSPACE_STORE_KEYS?.trim()
  const active = env.WORKSPACE_STORE_KEY_ID?.trim()
  if (!list && !active) return null
  if (!list || !active)
    throw new TypeError('set both WORKSPACE_STORE_KEYS and WORKSPACE_STORE_KEY_ID')
  const keys: Record<string, string> = {}
  for (const pair of list.split(',')) {
    const at = pair.indexOf(':')
    if (at <= 0) throw new TypeError('WORKSPACE_STORE_KEYS is id:base64,id:base64')
    keys[pair.slice(0, at).trim()] = pair.slice(at + 1).trim()
  }
  return createAesGcmContentCodec({ keys, activeKeyId: active })
}

/** Stored text of a sealed `content`: a prefix, then the sealed bytes in base64. */
export const SEALED_CONTENT_PREFIX = 'wsc1:'

/** Seal bytes a host is about to upload (an R2 object) under the entry's tenant and path. */
export function sealWorkspaceBytes(
  codec: WorkspaceContentCodec,
  context: WorkspaceCodecContext,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  return codec.seal(bytes, context)
}

/** Open bytes a host downloaded for an entry's `bytes` reference. */
export function openWorkspaceBytes(
  codec: WorkspaceContentCodec,
  context: WorkspaceCodecContext,
  sealed: Uint8Array,
): Promise<Uint8Array> {
  return codec.open(sealed, context)
}

export interface ContentCodecOptions {
  /**
   * Return stored content that is not sealed as is, for a store being moved
   * onto a codec. Off by default: a regulated store refuses plaintext.
   */
  readonly readPlaintext?: boolean
}

/**
 * `store` with every entry's `content` sealed at rest. Index fields, `bytes`
 * references and tombstones pass through untouched; the host seals the bytes
 * themselves. `idempotentOperations` is the inner store's: a replayed put with
 * an `operationId` seals to the same bytes, so the inner replay check holds.
 */
export function withContentCodec(
  store: WorkspaceStore,
  codec: WorkspaceContentCodec,
  options: ContentCodecOptions = {},
): WorkspaceStore {
  const open = async (entry: WorkspaceEntry): Promise<WorkspaceEntry> => {
    if (entry.content === undefined) return entry
    if (!entry.content.startsWith(SEALED_CONTENT_PREFIX)) {
      if (options.readPlaintext) return entry
      throw new WorkspaceCodecError(`${entry.path}: stored content is not sealed`)
    }
    const plain = await codec.open(bytesOf(entry.content.slice(SEALED_CONTENT_PREFIX.length)), {
      tenant: entry.workspaceId,
      path: entry.path,
    })
    return { ...entry, content: decoder.decode(plain) }
  }
  return {
    ...(store.idempotentOperations !== undefined
      ? { idempotentOperations: store.idempotentOperations }
      : {}),
    async get(workspaceId, path) {
      const entry = await store.get(workspaceId, path)
      return entry ? open(entry) : null
    },
    async list(workspaceId, prefix) {
      return Promise.all((await store.list(workspaceId, prefix)).map(open))
    },
    async put(input) {
      if (input.content === undefined) return store.put(input)
      const sealed = await codec.seal(encoder.encode(input.content), {
        tenant: input.workspaceId,
        path: input.path,
        ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
      })
      const saved = await store.put({
        ...input,
        content: `${SEALED_CONTENT_PREFIX}${base64(sealed)}`,
      })
      return { ...saved, content: input.content }
    },
    delete: (input) => store.delete(input),
    tombstones: (workspaceId, prefix) => store.tombstones(workspaceId, prefix),
  }
}
