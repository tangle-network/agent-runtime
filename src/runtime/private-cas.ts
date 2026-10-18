import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { AgentCandidateArtifactRef, Sha256Digest } from '@tangle-network/agent-interface'
import { markPutStreamVerified } from '../candidate-execution/artifact-streams'
import type { AgentCandidateOutputArtifactPort } from '../candidate-execution/types'

const DIGEST = /^sha256:([0-9a-f]{64})$/u
const HEX = /^[0-9a-f]{64}$/u
const SHARD = /^[0-9a-f]{2}$/u
const SAFE_NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u
const RECEIPT_SCHEMA = 'agent-runtime.private-cas-durable-receipt.v1'
const DURABLE_ATTEMPTS = 3
// A durable copy that moves no bytes for this long is abandoned and retried. Every put and pass that
// shares its digest waits for that copy, so a store that hangs without failing must not hold them all.
const DURABLE_STALL_MS = 120_000
// A buffered put reports no progress, so its attempt also gets the time this rate needs for its bytes.
const BUFFERED_BYTES_PER_MS = 256

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
  /** Milliseconds a durable copy may move no bytes before it is abandoned and retried (default 2 min). */
  readonly durableStallMs?: number
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
  const { durable, localBudgetBytes, durableStallMs = DURABLE_STALL_MS } = options
  if (!Number.isSafeInteger(durableStallMs) || durableStallMs <= 0)
    throw new Error('private CAS durableStallMs must be a positive integer')
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

  // Settles with the work, or rejects as soon as the signal aborts: a store or copy that ignores the
  // signal cannot hold its caller.
  const untilAborted = <T>(work: Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal === undefined) return work
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise<T>((settle, fail) => {
      const abort = () => fail(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      work.then(settle, fail).finally(() => signal.removeEventListener('abort', abort))
    })
  }

  // One attempt's signal: the caller's, plus a stall that aborts after `idleMs` without progress.
  const watchAttempt = (idleMs: number, signal?: AbortSignal) => {
    const stall = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const touch = () => {
      clearTimeout(timer)
      timer = setTimeout(
        () => stall.abort(new Error(`durable copy moved no bytes for ${idleMs} ms`)),
        idleMs,
      )
    }
    touch()
    return {
      signal: signal === undefined ? stall.signal : AbortSignal.any([signal, stall.signal]),
      touch,
      done: () => clearTimeout(timer),
    }
  }

  // A transient store failure must not leave an object host-only while the next try would succeed.
  const storeDurably = async (digest: Sha256Digest, bytes: Uint8Array, signal?: AbortSignal) => {
    let failure: unknown
    for (let attempt = 1; attempt <= DURABLE_ATTEMPTS; attempt++) {
      signal?.throwIfAborted()
      const watch = watchAttempt(
        durableStallMs + Math.ceil(bytes.byteLength / BUFFERED_BYTES_PER_MS),
        signal,
      )
      try {
        await untilAborted(
          durable!.put({ namespace, digest, bytes, signal: watch.signal }),
          watch.signal,
        )
        await writeReceipt(digest, bytes.byteLength)
        return
      } catch (error) {
        failure = error
        if (signal?.aborted) throw error
        if (attempt < DURABLE_ATTEMPTS)
          await new Promise((settle) => setTimeout(settle, 1_000 * 4 ** (attempt - 1)))
      } finally {
        watch.done()
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

  // Streams one local object to the durable store and records its receipt, retrying a transient
  // store failure like storeDurably.
  const streamDurably = async (
    digest: Sha256Digest,
    path: string,
    byteLength: number,
    signal?: AbortSignal,
  ): Promise<void> => {
    const ref: AgentCandidateArtifactRef = {
      locator: { kind: 'private-cas', namespace, digest },
      sha256: digest,
      byteLength,
    }
    let failure: unknown
    for (let attempt = 1; attempt <= DURABLE_ATTEMPTS; attempt++) {
      signal?.throwIfAborted()
      const watch = watchAttempt(durableStallMs, signal)
      const chunks = readObject(path, ref, watch.signal)
      // Each chunk the store pulls is progress; a store that stops pulling stalls the attempt.
      const pulled = (async function* () {
        for await (const chunk of chunks) {
          watch.touch()
          yield chunk
        }
      })()
      try {
        await untilAborted(
          durable!.putStream!({
            namespace,
            digest,
            byteLength,
            chunks: pulled,
            signal: watch.signal,
          }),
          watch.signal,
        )
        await writeReceipt(digest, byteLength)
        return
      } catch (error) {
        failure = error
        if (signal?.aborted) throw error
        if (attempt < DURABLE_ATTEMPTS)
          await new Promise((settle) => setTimeout(settle, 1_000 * 4 ** (attempt - 1)))
      } finally {
        watch.done()
        await chunks.return(undefined)
      }
    }
    throw failure
  }

  // What the last full pass left on this host. A put that makes its own object durable, after a
  // pass that left nothing pending, stays inside the budget without another pass: a pass reads
  // every object and its receipt, so a pass per put made capture quadratic on a host that keeps
  // its objects (drew-gtr-pro wrote 3 objects a minute into a run holding 1,228, 2026-10-18).
  let lastPass: { localBytes: number; pending: number } | undefined
  const settlePut = async (
    sha: string,
    byteLength: number,
    linked: boolean,
    upload: (() => Promise<void>) | undefined,
    signal?: AbortSignal,
  ): Promise<void> => {
    if (upload !== undefined && !(await hasReceipt(sha)))
      await copyOnce(sha, upload, signal).catch(() => undefined)
    const durableNow = await hasReceipt(sha)
    // No await between the budget check and the reservation, so concurrent puts cannot both fit.
    const added = linked ? byteLength : 0
    const known = lastPass
    if (
      durableNow &&
      known !== undefined &&
      known.pending === 0 &&
      (localBudgetBytes === undefined || known.localBytes + added <= localBudgetBytes)
    ) {
      known.localBytes += added
      return
    }
    await offload(signal)
  }

  // The one copy of each digest to the durable store in flight, from a put or a pass. A put or pass
  // that finds its digest in flight waits for that copy, then reads the receipt. Copying it again
  // doubles the upload and, for a buffered store, the archive in memory. Reporting it pending
  // failed captures: a capture refuses on any pending object, so two captures sharing one store
  // refused each other (discovery-lab provider-retention, agent-runtime 0.325.6, 2026-10-18).
  // A copy never waits for a pass, so a pass may wait for a copy.
  const uploading = new Map<string, Promise<void>>()
  const copyOnce = async (
    sha: string,
    copy: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    for (let inflight = uploading.get(sha); inflight !== undefined; inflight = uploading.get(sha)) {
      await untilAborted(
        inflight.catch(() => undefined),
        signal,
      )
      if (await hasReceipt(sha)) return false
    }
    // Nothing awaits between the last check and the entry, so two callers cannot both copy.
    const current = copy()
    uploading.set(sha, current)
    try {
      await current
      return true
    } finally {
      if (uploading.get(sha) === current) uploading.delete(sha)
    }
  }
  const sweep = async (signal?: AbortSignal): Promise<PrivateCasOffloadReport> => {
    const objects = await localObjects()
    const pending: Array<{ digest: Sha256Digest; error: string }> = []
    let uploaded = 0
    let refusal: string | undefined
    const durableHex = new Set<string>()
    for (const object of objects) {
      const inflight = uploading.get(object.hex)
      if (inflight !== undefined)
        await untilAborted(
          inflight.catch(() => undefined),
          signal,
        )
      signal?.throwIfAborted()
      if (await hasReceipt(object.hex)) {
        durableHex.add(object.hex)
        continue
      }
      if (durable === undefined) continue
      const digest = `sha256:${object.hex}` as Sha256Digest
      // After one refusal the store is likely down; the next pass retries instead of this one
      // spending its backoff on every remaining object.
      if (refusal !== undefined) {
        pending.push({ digest, error: `not attempted after an earlier refusal: ${refusal}` })
        continue
      }
      try {
        let copied: boolean
        if (durable.putStream && durable.getStream) {
          copied = await copyOnce(
            object.hex,
            () => streamDurably(digest, object.path, object.size, signal),
            signal,
          )
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
          copied = await copyOnce(object.hex, () => storeDurably(digest, bytes, signal), signal)
        }
        durableHex.add(object.hex)
        if (copied) uploaded++
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
    lastPass = { localBytes, pending: pending.length }
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
      let linked = true
      try {
        // The link commits publication. Later cancellation must not delete a shared CAS object.
        await link(temporary, path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        linked = false
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
      if (durable !== undefined)
        await settlePut(
          sha,
          byteLength,
          linked,
          () => streamDurably(digest, path, byteLength, signal),
          signal,
        )
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
      return putBuffered(bytes, digest, hexOf(digest), signal)
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
    let linked = true
    try {
      signal?.throwIfAborted()
      try {
        await link(temporary, path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        linked = false
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
      // The bytes are already in memory, so this put copies them itself; a pass that follows
      // skips this digest and only evicts and retries others.
      await settlePut(
        sha,
        bytes.byteLength,
        linked,
        () => storeDurably(digest, bytes, signal),
        signal,
      )
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
  // Without a durable store, putStream's own readback reads the object readStream will return.
  // With one, the caller's readback may come from the store and is kept.
  if (durable === undefined) markPutStreamVerified(putStream, readStream)
  return port
}
