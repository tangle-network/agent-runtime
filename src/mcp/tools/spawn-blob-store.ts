import { createHash } from 'node:crypto'
import { ConfigError } from '../../errors'

/**
 * Bytes a manager STAGED for a spawn, addressed by the sha256 of those bytes.
 *
 * `spawn-resource-paths.ts` records why a resource cannot travel inside a model's tool call. The
 * `path` transport answers it for a manager whose workspace this process can read. A manager
 * inside a remote sandbox has no such directory — the coordination server cannot read a sandbox —
 * so its files went back through the model, and the same failure returned. Measured 2026-09-17 on
 * a Discovery director (opencode harness, glm-5.3) across four runs and roughly fifteen lost
 * children: a brief pinned seven files and the spawn carried two, and of six mounted files the one
 * whose docstring held a column-aligned table arrived two bytes short (6,983 authored, 6,981
 * delivered). Code indentation never drifted; aligned prose did.
 *
 * This store is the other half of the answer: the manager PUSHES the bytes to the coordination
 * server itself (from its shell, over the JSON-RPC endpoint its harness already uses), and the
 * spawn then names the content by digest. The model handles 71 characters instead of 7,000 bytes.
 *
 * Three properties do the work:
 *  - CONTENT-ADDRESSED. The key is the hash, so re-staging identical bytes is the same blob by
 *    definition, and storing different bytes under one address is impossible rather than resolved
 *    by a winner rule. A retry, a resume, or a "did that land?" doubt is answered by staging again.
 *  - PER MANAGER. One store per `createCoordinationTools` closure, which is one per manager node,
 *    per bus, per listener, per credential. Run A's digest cannot satisfy run B's reference even
 *    for byte-identical content; B stages its own. Identical content is not shared authorization.
 *  - BOUNDED AND RELEASED WITH THE MANAGER. A blob, an entry count, and a total are all capped,
 *    and the memory is a `Map` the manager owns.
 *
 * Deliberately NOT here: any read or list verb. Children hold no coordination credential and this
 * store has no reader, so a worker cannot enumerate or fetch what its manager staged.
 */

/** One blob's raw bytes. 512 KiB fits comfortably inside the default 1 MiB request bound once
 *  base64 inflates it by 4/3, so the oversize answer is this module's named refusal rather than
 *  the transport's 413. */
export const SPAWN_BLOB_MAX_BYTES = 512 * 1024
/** Blobs one manager may hold at once. */
export const SPAWN_BLOB_MAX_ENTRIES = 256
/** Total raw bytes one manager may hold. Deliberately conservative: the fleet box this was
 *  measured on has 1.2 GiB of memory for every manager it runs. */
export const SPAWN_BLOB_MAX_TOTAL_BYTES = 32 * 1024 * 1024

/** The canonical address spelling, shared with `src/durable/content-address.ts`: one prefix, 64
 *  lowercase hex characters, no aliases. */
const SPAWN_BLOB_REF = /^sha256:[0-9a-f]{64}$/
/** Standard base64 only. Base64url (`-` / `_`) is refused so one byte string has one spelling. */
const STANDARD_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

export interface SpawnBlobLimits {
  readonly maxBlobBytes?: number
  readonly maxBlobs?: number
  readonly maxBlobTotalBytes?: number
}

/** What one manager currently holds, and the ceilings it holds it under. Returned with every
 *  staging result so a manager can see it approaching the fence before it hits it. */
export interface SpawnBlobStats {
  readonly blobs: number
  readonly bytes: number
  readonly maxBlobs: number
  readonly maxBytes: number
}

export type SpawnBlobPutOutcome =
  /** `stored: false` = this exact content was already held. Not an error: the address is the
   *  content, so the manager's intent is already satisfied and nothing is rewritten. */
  | { readonly ok: true; readonly stored: boolean }
  | {
      readonly ok: false
      readonly error: 'blob-too-large' | 'blob-store-full'
      readonly reason: string
    }

export interface SpawnBlobStore {
  get(ref: string): Buffer | undefined
  put(ref: string, bytes: Buffer): SpawnBlobPutOutcome
  drop(ref: string): boolean
  stats(): SpawnBlobStats
  /** Release every held blob. Called when the manager's coordination server closes. */
  clear(): void
}

/** The address of these exact bytes. */
export function spawnBlobRef(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

/** The ref when `value` is the one legal spelling, otherwise `undefined`. Uppercase hex, a bare
 *  digest, and a padded or truncated one are all refused rather than normalized: a second accepted
 *  spelling is a second key for one blob. */
export function parseSpawnBlobRef(value: unknown): string | undefined {
  return typeof value === 'string' && SPAWN_BLOB_REF.test(value) ? value : undefined
}

/**
 * Decode standard base64, or return `undefined`.
 *
 * Whitespace is stripped first, because `base64` without GNU's `-w0` wraps at 76 columns and a
 * busybox box has no `-w0` at all. Everything after that is strict: `Buffer.from(…, 'base64')` is
 * lenient enough to silently accept a corrupted payload and hand back short bytes, so the decoded
 * buffer is re-encoded and compared. A payload that does not round-trip is refused before its
 * digest is ever computed.
 */
export function decodeSpawnBlobBase64(value: string): Buffer | undefined {
  const compact = value.replace(/\s+/g, '')
  if (!STANDARD_BASE64.test(compact) || compact.length % 4 !== 0) return undefined
  const bytes = Buffer.from(compact, 'base64')
  return bytes.toString('base64') === compact ? bytes : undefined
}

function bound(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new ConfigError(`spawnResources ${name} must be a positive safe integer`)
  }
  return resolved
}

/** The only implementation Runtime ships: a `Map` in the manager's own closure. */
export class InMemorySpawnBlobStore implements SpawnBlobStore {
  readonly #blobs = new Map<string, Buffer>()
  readonly #maxBlobBytes: number
  readonly #maxBlobs: number
  readonly #maxTotalBytes: number
  #bytes = 0

  constructor(limits: SpawnBlobLimits = {}) {
    this.#maxBlobBytes = bound('maxBlobBytes', limits.maxBlobBytes, SPAWN_BLOB_MAX_BYTES)
    this.#maxBlobs = bound('maxBlobs', limits.maxBlobs, SPAWN_BLOB_MAX_ENTRIES)
    this.#maxTotalBytes = bound(
      'maxBlobTotalBytes',
      limits.maxBlobTotalBytes,
      SPAWN_BLOB_MAX_TOTAL_BYTES,
    )
  }

  get(ref: string): Buffer | undefined {
    return this.#blobs.get(ref)
  }

  put(ref: string, bytes: Buffer): SpawnBlobPutOutcome {
    // Held content is admitted work. Answering it before the capacity check is what makes a full
    // store safe to retry against: a re-stage of something already staged can never be refused.
    if (this.#blobs.has(ref)) return { ok: true, stored: false }
    if (bytes.length > this.#maxBlobBytes) {
      return {
        ok: false,
        error: 'blob-too-large',
        reason: `${bytes.length} bytes exceeds this manager's per-blob bound of ${this.#maxBlobBytes} bytes.`,
      }
    }
    if (this.#blobs.size >= this.#maxBlobs || this.#bytes + bytes.length > this.#maxTotalBytes) {
      return {
        ok: false,
        error: 'blob-store-full',
        reason:
          `this manager holds ${this.#blobs.size}/${this.#maxBlobs} blobs and ` +
          `${this.#bytes}/${this.#maxTotalBytes} bytes. Release one with ` +
          'put_blob {"drop":"sha256:…"}, or spawn the children that need the ones you staged.',
      }
    }
    // Copied, because the caller's buffer may be a view over a larger decode arena.
    this.#blobs.set(ref, Buffer.from(bytes))
    this.#bytes += bytes.length
    return { ok: true, stored: true }
  }

  drop(ref: string): boolean {
    const held = this.#blobs.get(ref)
    if (held === undefined) return false
    this.#blobs.delete(ref)
    this.#bytes -= held.length
    return true
  }

  stats(): SpawnBlobStats {
    return {
      blobs: this.#blobs.size,
      bytes: this.#bytes,
      maxBlobs: this.#maxBlobs,
      maxBytes: this.#maxTotalBytes,
    }
  }

  clear(): void {
    this.#blobs.clear()
    this.#bytes = 0
  }
}
