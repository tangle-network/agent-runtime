import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { AgentCandidateArtifactRef, Sha256Digest } from '@tangle-network/agent-interface'
import type { AgentCandidateOutputArtifactPort } from '../candidate-execution/types'

const DIGEST = /^sha256:([0-9a-f]{64})$/u
const HEX = /^[0-9a-f]{64}$/u
const SHARD = /^[0-9a-f]{2}$/u
const SAFE_NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u
const RECEIPT_SCHEMA = 'agent-runtime.private-cas-durable-receipt.v1'
const DURABLE_ATTEMPTS = 3

/**
 * Off-host storage that holds a private CAS's bytes after the host deletes its local copy.
 * Keys are the run namespace and the content digest, so a retry stores the same object again.
 */
export interface PrivateCasDurableStore {
  /** Store a known digest and length without retaining all bytes. */
  putStream?(object: {
    namespace: string
    digest: Sha256Digest
    byteLength: number
    chunks: AsyncIterable<Uint8Array>
    signal?: AbortSignal
  }): Promise<void>
  /** Open stored bytes without materializing the object. */
  getStream?(object: {
    namespace: string
    digest: Sha256Digest
    signal?: AbortSignal
  }): Promise<AsyncIterable<Uint8Array> | undefined>

  /** Where the bytes live, recorded in every durable receipt, for example `s3://bucket/prefix/`. */
  readonly location: string
  /**
   * Store exactly these bytes. Resolve only after the store confirms that it holds an object of
   * this digest and length; storing an object that already exists is a success.
   */
  put(object: {
    namespace: string
    digest: Sha256Digest
    bytes: Uint8Array
    signal?: AbortSignal
  }): Promise<void>
  /** The stored bytes, or undefined when the store holds no object for this digest. */
  get(object: {
    namespace: string
    digest: Sha256Digest
    signal?: AbortSignal
  }): Promise<Uint8Array | undefined>
}

export interface PrivateCasOptions {
  /** Copy every object off the host as it is written. */
  readonly durable?: PrivateCasDurableStore
  /**
   * Local bytes to keep. Only objects with a durable receipt are deleted, oldest first, so a
   * store outage keeps every byte on the host. Requires `durable`.
   */
  readonly localBudgetBytes?: number
}

/** One offload pass: what reached the durable store and what the host still holds. */
export interface PrivateCasOffloadReport {
  /** Local and evicted objects with a durable receipt after this pass. */
  readonly durable: number
  /** Objects this pass copied to the durable store. */
  readonly uploaded: number
  /** Objects without a durable receipt, including in-progress uploads and store refusals. */
  readonly pending: ReadonlyArray<{ readonly digest: Sha256Digest; readonly error: string }>
  /** Local copies this pass deleted; their bytes remain in the durable store. */
  readonly evicted: number
  readonly localObjects: number
  readonly localBytes: number
}

export interface PrivateCasArtifactPort extends AgentCandidateOutputArtifactPort {
  /**
   * Copy every local object that has no durable receipt, then delete the oldest durable local
   * copies above the budget. Without a durable store this only reports local usage. Store
   * refusals are reported, not thrown; local filesystem failures throw.
   */
  offload(signal?: AbortSignal): Promise<PrivateCasOffloadReport>
}

async function realDirectory(path: string): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error(`private CAS directory is not a real directory: ${path}`)
}

async function checkDirectories(path: string, create: boolean): Promise<void> {
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

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const sha256 = (bytes: Uint8Array): Sha256Digest =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}` as Sha256Digest

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Read one local object, or undefined when the host no longer holds it. */
async function readLocal(path: string): Promise<Uint8Array | undefined> {
  let file: Awaited<ReturnType<typeof open>>
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
  try {
    return await file.readFile()
  } finally {
    await file.close()
  }
}

/**
 * Private content-addressed storage scoped to one recorded run identity.
 *
 * Bytes are written to the host first. With a durable store, every object is also copied off the
 * host as it is written, and `localBudgetBytes` bounds what the host keeps: an object's local copy
 * is deleted only after its durable receipt exists, and reads fall back to the durable store.
 */
export function createPrivateCasArtifactPort(
  root: string,
  namespace: string,
  options: PrivateCasOptions = {},
): PrivateCasArtifactPort {
  if (!isAbsolute(root)) throw new Error('private CAS root must be absolute')
  if (!SAFE_NAMESPACE.test(namespace) || namespace === '.' || namespace === '..')
    throw new Error('private CAS namespace must be one safe identifier')
  const { durable, localBudgetBytes } = options
  if (
    localBudgetBytes !== undefined &&
    (durable === undefined || !Number.isSafeInteger(localBudgetBytes) || localBudgetBytes < 0)
  )
    throw new Error('private CAS localBudgetBytes needs a durable store and a non-negative integer')
  const store = join(resolve(root), 'sha256')
  const receipts = join(resolve(root), 'durable', 'sha256')
  const hexOf = (digest: string): string => {
    const match = DIGEST.exec(digest)
    if (!match) throw new Error('private CAS digest must be sha256:<64 lowercase hex>')
    return match[1]!
  }
  const destination = (digest: string): string => {
    const hex = hexOf(digest)
    return join(store, hex.slice(0, 2), hex)
  }

  const hasReceipt = async (hex: string): Promise<boolean> => {
    try {
      return (await lstat(join(receipts, hex))).isFile()
    } catch (error) {
      if (missing(error)) return false
      throw error
    }
  }

  const writeReceipt = async (digest: Sha256Digest, byteLength: number): Promise<void> => {
    await checkDirectories(receipts, true)
    const hex = hexOf(digest)
    const temporary = join(receipts, `.${hex}.${randomUUID()}.tmp`)
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await file.writeFile(
        `${JSON.stringify({ schema: RECEIPT_SCHEMA, location: durable!.location, namespace, digest, byteLength, storedAt: new Date().toISOString() })}\n`,
      )
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, join(receipts, hex))
    await syncDirectory(receipts)
  }

  // A transient store failure must not leave an object host-only while the next try would succeed.
  const storeDurably = async (digest: Sha256Digest, bytes: Uint8Array, signal?: AbortSignal) => {
    let failure: unknown
    for (let attempt = 1; attempt <= DURABLE_ATTEMPTS; attempt++) {
      signal?.throwIfAborted()
      try {
        await durable!.put({
          namespace,
          digest,
          bytes,
          ...(signal === undefined ? {} : { signal }),
        })
        await writeReceipt(digest, bytes.byteLength)
        return
      } catch (error) {
        failure = error
        if (signal?.aborted) throw error
        if (attempt < DURABLE_ATTEMPTS)
          await new Promise((settle) => setTimeout(settle, 1_000 * 4 ** (attempt - 1)))
      }
    }
    throw failure
  }

  const localObjects = async (): Promise<
    Array<{ hex: string; path: string; size: number; modifiedMs: number }>
  > => {
    let shards: string[]
    try {
      shards = await readdir(store)
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
    const objects: Array<{ hex: string; path: string; size: number; modifiedMs: number }> = []
    for (const shard of shards.filter((name) => SHARD.test(name))) {
      for (const hex of await readdir(join(store, shard))) {
        if (!HEX.test(hex) || hex.slice(0, 2) !== shard) continue
        const path = join(store, shard, hex)
        try {
          const entry = await lstat(path)
          if (entry.isFile())
            objects.push({ hex, path, size: entry.size, modifiedMs: entry.mtimeMs })
        } catch (error) {
          if (!missing(error)) throw error
        }
      }
    }
    return objects
  }

  // Digests a buffered put has linked and is still copying to the durable store with the bytes it
  // holds. A pass leaves them to that put; copying them again doubles the upload and, for a
  // buffered store, holds a second copy of the same archive in memory.
  const uploading = new Map<string, number>()
  const sweep = async (signal?: AbortSignal): Promise<PrivateCasOffloadReport> => {
    const objects = await localObjects()
    const pending: Array<{ digest: Sha256Digest; error: string }> = []
    let uploaded = 0
    let refusal: string | undefined
    const durableHex = new Set<string>()
    for (const object of objects) {
      if (await hasReceipt(object.hex)) {
        durableHex.add(object.hex)
        continue
      }
      if (durable === undefined) continue
      const digest = `sha256:${object.hex}` as Sha256Digest
      if (uploading.has(object.hex)) {
        pending.push({ digest, error: 'durable upload in progress' })
        continue
      }
      // After one refusal the store is likely down; the next pass retries instead of this one
      // spending its backoff on every remaining object.
      if (refusal !== undefined) {
        pending.push({ digest, error: `not attempted after an earlier refusal: ${refusal}` })
        continue
      }
      try {
        if (durable.putStream && durable.getStream) {
          const ref: AgentCandidateArtifactRef = {
            locator: { kind: 'private-cas', namespace, digest },
            sha256: digest,
            byteLength: object.size,
          }
          let failure: unknown
          for (let attempt = 1; attempt <= DURABLE_ATTEMPTS; attempt++) {
            signal?.throwIfAborted()
            const chunks = readObject(object.path, ref, signal)
            try {
              await durable.putStream({
                namespace,
                digest,
                byteLength: object.size,
                chunks,
                signal,
              })
              await writeReceipt(digest, object.size)
              failure = undefined
              break
            } catch (error) {
              failure = error
              if (signal?.aborted) throw error
              if (attempt < DURABLE_ATTEMPTS)
                await new Promise((settle) => setTimeout(settle, 1_000 * 4 ** (attempt - 1)))
            } finally {
              await chunks.return(undefined)
            }
          }
          if (failure !== undefined) throw failure
        } else {
          const bytes = await readLocal(object.path)
          if (bytes === undefined) continue
          if (sha256(bytes) !== digest) {
            pending.push({
              digest,
              error: 'local object failed digest verification; it stays on the host',
            })
            continue
          }
          await storeDurably(digest, bytes, signal)
        }
        durableHex.add(object.hex)
        uploaded++
      } catch (error) {
        if (signal?.aborted) throw error
        refusal = message(error)
        pending.push({ digest, error: refusal })
      }
    }
    let localBytes = objects.reduce((total, object) => total + object.size, 0)
    let evicted = 0
    if (localBudgetBytes !== undefined) {
      for (const object of [...objects].sort((a, b) => a.modifiedMs - b.modifiedMs)) {
        if (localBytes <= localBudgetBytes) break
        if (!durableHex.has(object.hex) || !(await hasReceipt(object.hex))) continue
        try {
          await unlink(object.path)
        } catch (error) {
          if (!missing(error)) throw error
        }
        localBytes -= object.size
        evicted++
      }
    }
    let receiptCount = 0
    try {
      receiptCount = (await readdir(receipts)).filter((name) => HEX.test(name)).length
    } catch (error) {
      if (!missing(error)) throw error
    }
    return {
      durable: receiptCount,
      uploaded,
      pending,
      evicted,
      localObjects: objects.length - evicted,
      localBytes,
    }
  }

  // One pass at a time: a pass never deletes a copy that another pass is still uploading.
  let passes: Promise<unknown> = Promise.resolve()
  const offload = (signal?: AbortSignal): Promise<PrivateCasOffloadReport> => {
    const pass = passes.then(() => sweep(signal))
    passes = pass.catch(() => undefined)
    return pass
  }

  const verified = (bytes: Uint8Array, ref: AgentCandidateArtifactRef): Uint8Array => {
    if (sha256(bytes) !== ref.sha256 || bytes.byteLength !== ref.byteLength)
      throw new Error('private CAS object failed digest or length verification')
    return bytes
  }

  async function* readStream(
    ref: AgentCandidateArtifactRef,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<Uint8Array> {
    const { signal } = options
    signal?.throwIfAborted()
    if (
      ref.locator.kind !== 'private-cas' ||
      ref.locator.namespace !== namespace ||
      ref.locator.digest !== ref.sha256
    )
      throw new Error('private CAS locator does not match its digest and namespace')
    const path = destination(ref.sha256)
    try {
      await checkDirectories(join(store, hexOf(ref.sha256).slice(0, 2)), false)
      yield* readObject(path, ref, signal)
      return
    } catch (error) {
      if (!missing(error)) throw error
    }
    if (!durable?.getStream)
      throw new Error(
        `private CAS object is not on this host; streaming durable reads are unavailable: ${ref.sha256}`,
      )
    const chunks = await durable.getStream({ namespace, digest: ref.sha256, signal })
    if (!chunks)
      throw new Error(
        `private CAS object is neither on this host nor in ${durable.location}: ${ref.sha256}`,
      )
    yield* checkedChunks(chunks, ref, signal)
  }

  async function* readObject(
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

  async function putStream(input: {
    chunks: AsyncIterable<Uint8Array>
    signal?: AbortSignal
  }): Promise<AgentCandidateArtifactRef> {
    const { signal } = input
    signal?.throwIfAborted()
    await checkDirectories(store, true)
    const temporary = join(store, `.${randomUUID()}.tmp`)
    try {
      const file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      const hash = createHash('sha256')
      let byteLength = 0
      try {
        for await (const chunk of input.chunks) {
          signal?.throwIfAborted()
          if (!(chunk instanceof Uint8Array))
            throw new Error('private CAS received a non-byte chunk')
          hash.update(chunk)
          byteLength += chunk.byteLength
          if (!Number.isSafeInteger(byteLength)) throw new Error('private CAS object is too large')
          await file.writeFile(chunk)
        }
        signal?.throwIfAborted()
        await file.sync()
      } finally {
        await file.close()
      }
      const sha = hash.digest('hex')
      const digest = `sha256:${sha}` as AgentCandidateArtifactRef['sha256']
      const ref: AgentCandidateArtifactRef = {
        locator: { kind: 'private-cas', namespace, digest },
        sha256: digest,
        byteLength,
      }
      for await (const _chunk of readObject(temporary, ref, signal)) {
        // Verify the staged inode before it can become another writer's deduplicated object.
      }
      const path = destination(digest)
      const directory = join(store, sha.slice(0, 2))
      await checkDirectories(directory, true)
      signal?.throwIfAborted()
      try {
        // The link commits publication. Later cancellation must not delete a shared CAS object.
        await link(temporary, path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        for await (const _chunk of readStream(ref, { signal })) {
          // An existing object must independently match, even when our staged bytes were valid.
        }
      }
      const dir = await open(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      try {
        await dir.sync()
      } finally {
        await dir.close()
      }
      if (durable !== undefined) await offload(signal)
      return ref
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }

  const port: PrivateCasArtifactPort = {
    // A buffered remote store cannot satisfy the streaming capture contract.
    ...(durable === undefined || (durable.putStream && durable.getStream)
      ? { putStream, readStream }
      : {}),
    async put({ bytes, signal }) {
      signal?.throwIfAborted()
      const digest = sha256(bytes)
      const sha = hexOf(digest)
      if (durable !== undefined) uploading.set(sha, (uploading.get(sha) ?? 0) + 1)
      try {
        return await putBuffered(bytes, digest, sha, signal)
      } finally {
        if (durable !== undefined) {
          const count = (uploading.get(sha) ?? 1) - 1
          if (count === 0) uploading.delete(sha)
          else uploading.set(sha, count)
        }
      }
    },
    async read(ref) {
      return readRef(ref)
    },
    async locate(object, options = {}) {
      options.signal?.throwIfAborted()
      const digest = object.sha256
      const hex = hexOf(digest)
      const ref: AgentCandidateArtifactRef = {
        locator: { kind: 'private-cas', namespace, digest },
        sha256: digest,
        byteLength: object.byteLength,
      }
      try {
        await checkDirectories(join(store, hex.slice(0, 2)), false)
        const local = await lstat(destination(digest))
        // An object is published whole by a link, so its length is the length it was written with.
        if (local.isFile()) return local.size === object.byteLength ? ref : undefined
      } catch (error) {
        if (!missing(error)) throw error
      }
      if (durable === undefined) return undefined
      const receipt = await readLocal(join(receipts, hex))
      if (receipt === undefined) return undefined
      const stored = JSON.parse(Buffer.from(receipt).toString('utf8')) as { byteLength?: unknown }
      return stored.byteLength === object.byteLength ? ref : undefined
    },
    offload,
  }

  async function putBuffered(
    bytes: Uint8Array,
    digest: Sha256Digest,
    sha: string,
    signal?: AbortSignal,
  ): Promise<AgentCandidateArtifactRef> {
    const path = destination(digest)
    const directory = join(store, sha.slice(0, 2))
    await checkDirectories(directory, true)
    const temporary = join(directory, `.${sha}.${randomUUID()}.tmp`)
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    try {
      signal?.throwIfAborted()
      try {
        await link(temporary, path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      await syncDirectory(directory)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
    const ref: AgentCandidateArtifactRef = {
      locator: { kind: 'private-cas', namespace, digest },
      sha256: digest,
      byteLength: bytes.byteLength,
    }
    await readRef(ref)
    if (durable !== undefined) {
      // The bytes are already in memory, so this put copies them itself; the pass that follows
      // skips this digest and only evicts and retries others.
      if (!(await hasReceipt(sha))) await storeDurably(digest, bytes, signal).catch(() => undefined)
      await offload(signal)
    }
    return ref
  }

  async function readRef(ref: AgentCandidateArtifactRef): Promise<Uint8Array> {
    if (
      ref.locator.kind !== 'private-cas' ||
      ref.locator.namespace !== namespace ||
      ref.locator.digest !== ref.sha256
    ) {
      throw new Error('private CAS locator does not match its digest and namespace')
    }
    const path = destination(ref.sha256)
    const shard = join(store, hexOf(ref.sha256).slice(0, 2))
    let local: Uint8Array | undefined
    try {
      await checkDirectories(shard, false)
      local = await readLocal(path)
    } catch (error) {
      if (!missing(error)) throw error
    }
    if (local !== undefined) return verified(local, ref)
    if (durable === undefined)
      throw new Error(`private CAS object is not on this host: ${ref.sha256}`)
    const stored = await durable.get({ namespace, digest: ref.sha256 })
    if (stored === undefined)
      throw new Error(
        `private CAS object is neither on this host nor in ${durable.location}: ${ref.sha256}`,
      )
    return verified(stored, ref)
  }
  return port
}
