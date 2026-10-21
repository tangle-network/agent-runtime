/**
 * The local object store of a private CAS: where an object lives, how it is read back and
 * verified, and how a locator is checked. Writing and durable copies build on these.
 */

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { AgentCandidateArtifactRef, Sha256Digest } from '@tangle-network/agent-interface'
import type { PrivateCasDurableStore } from './private-cas'

const DIGEST = /^sha256:([0-9a-f]{64})$/u

/** The immutable shape of one private CAS: its directories, namespace and durable policy. */
export interface PrivateCasLayout {
  readonly namespace: string
  readonly store: string
  readonly receipts: string
  readonly durable: PrivateCasDurableStore | undefined
  readonly localBudgetBytes: number | undefined
  readonly durableStallMs: number
}

export const isMissingPath = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export const casSha256 = (bytes: Uint8Array): Sha256Digest =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}` as Sha256Digest

export function privateCasRef(
  namespace: string,
  digest: Sha256Digest,
  byteLength: number,
): AgentCandidateArtifactRef {
  return { locator: { kind: 'private-cas', namespace, digest }, sha256: digest, byteLength }
}

export function hexOf(digest: string): string {
  const match = DIGEST.exec(digest)
  if (!match) throw new Error('private CAS digest must be sha256:<64 lowercase hex>')
  return match[1]!
}

export function objectPath(layout: PrivateCasLayout, digest: string): string {
  const hex = hexOf(digest)
  return join(layout.store, hex.slice(0, 2), hex)
}

async function realDirectory(path: string): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error(`private CAS directory is not a real directory: ${path}`)
}

/** Require every component of `path` to be a real directory, creating them when `create`. */
export async function checkDirectories(path: string, create: boolean): Promise<void> {
  const parts = resolve(path).split(sep)
  let current: string = sep
  for (const part of parts) {
    if (!part) continue
    current = join(current, part)
    if (create) {
      try {
        await mkdir(current, { mode: 0o700 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    await realDirectory(current)
  }
}

/** Read one local object, or undefined when the host no longer holds it. */
export async function readLocal(path: string): Promise<Uint8Array | undefined> {
  let file: Awaited<ReturnType<typeof open>>
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (isMissingPath(error)) return undefined
    throw error
  }
  try {
    return await file.readFile()
  } finally {
    await file.close()
  }
}

export async function* readObject(
  path: string,
  ref: AgentCandidateArtifactRef,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  signal?.throwIfAborted()
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stats = await file.stat()
    if (!stats.isFile() || stats.size !== ref.byteLength)
      throw new Error('private CAS object failed digest or length verification')
    yield* checkedChunks(
      file.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 }),
      ref,
      signal,
    )
  } finally {
    await file.close()
  }
}

async function* checkedChunks(
  chunks: AsyncIterable<Uint8Array>,
  ref: AgentCandidateArtifactRef,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const hash = createHash('sha256')
  let byteLength = 0
  for await (const chunk of chunks) {
    signal?.throwIfAborted()
    if (!(chunk instanceof Uint8Array)) throw new Error('private CAS emitted a non-byte chunk')
    byteLength += chunk.byteLength
    if (byteLength > ref.byteLength)
      throw new Error('private CAS object failed digest or length verification')
    hash.update(chunk)
    yield chunk
  }
  signal?.throwIfAborted()
  if (`sha256:${hash.digest('hex')}` !== ref.sha256 || byteLength !== ref.byteLength)
    throw new Error('private CAS object failed digest or length verification')
}

function verified(bytes: Uint8Array, ref: AgentCandidateArtifactRef): Uint8Array {
  if (casSha256(bytes) !== ref.sha256 || bytes.byteLength !== ref.byteLength)
    throw new Error('private CAS object failed digest or length verification')
  return bytes
}

function assertOwnLocator(layout: PrivateCasLayout, ref: AgentCandidateArtifactRef): void {
  if (
    ref.locator.kind !== 'private-cas' ||
    ref.locator.namespace !== layout.namespace ||
    ref.locator.digest !== ref.sha256
  )
    throw new Error('private CAS locator does not match its digest and namespace')
}

/** Stream an object from the host, falling back to the durable store when the host lacks it. */
export async function* readPrivateCasStream(
  layout: PrivateCasLayout,
  ref: AgentCandidateArtifactRef,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<Uint8Array> {
  const { signal } = options
  const { durable } = layout
  signal?.throwIfAborted()
  assertOwnLocator(layout, ref)
  const path = objectPath(layout, ref.sha256)
  try {
    await checkDirectories(join(layout.store, hexOf(ref.sha256).slice(0, 2)), false)
    yield* readObject(path, ref, signal)
    return
  } catch (error) {
    if (!isMissingPath(error)) throw error
  }
  if (!durable?.getStream)
    throw new Error(
      `private CAS object is not on this host; streaming durable reads are unavailable: ${ref.sha256}`,
    )
  const chunks = await durable.getStream({
    namespace: layout.namespace,
    digest: ref.sha256,
    signal,
  })
  if (!chunks)
    throw new Error(
      `private CAS object is neither on this host nor in ${durable.location}: ${ref.sha256}`,
    )
  yield* checkedChunks(chunks, ref, signal)
}

/** Read a whole object from the host, falling back to the durable store. */
export async function readPrivateCasRef(
  layout: PrivateCasLayout,
  ref: AgentCandidateArtifactRef,
): Promise<Uint8Array> {
  const { durable } = layout
  assertOwnLocator(layout, ref)
  const path = objectPath(layout, ref.sha256)
  const shard = join(layout.store, hexOf(ref.sha256).slice(0, 2))
  let local: Uint8Array | undefined
  try {
    await checkDirectories(shard, false)
    local = await readLocal(path)
  } catch (error) {
    if (!isMissingPath(error)) throw error
  }
  if (local !== undefined) return verified(local, ref)
  if (durable === undefined)
    throw new Error(`private CAS object is not on this host: ${ref.sha256}`)
  const stored = await durable.get({ namespace: layout.namespace, digest: ref.sha256 })
  if (stored === undefined)
    throw new Error(
      `private CAS object is neither on this host nor in ${durable.location}: ${ref.sha256}`,
    )
  return verified(stored, ref)
}

/** The ref of an object this CAS holds with exactly this length, on the host or by receipt. */
export async function locatePrivateCasObject(
  layout: PrivateCasLayout,
  object: { sha256: Sha256Digest; byteLength: number },
  options: { signal?: AbortSignal } = {},
): Promise<AgentCandidateArtifactRef | undefined> {
  options.signal?.throwIfAborted()
  const digest = object.sha256
  const hex = hexOf(digest)
  const ref = privateCasRef(layout.namespace, digest, object.byteLength)
  try {
    await checkDirectories(join(layout.store, hex.slice(0, 2)), false)
    const local = await lstat(objectPath(layout, digest))
    // An object is published whole by a link, so its length is the length it was written with.
    if (local.isFile()) return local.size === object.byteLength ? ref : undefined
  } catch (error) {
    if (!isMissingPath(error)) throw error
  }
  if (layout.durable === undefined) return undefined
  const receipt = await readLocal(join(layout.receipts, hex))
  if (receipt === undefined) return undefined
  const stored = JSON.parse(Buffer.from(receipt).toString('utf8')) as { byteLength?: unknown }
  return stored.byteLength === object.byteLength ? ref : undefined
}
