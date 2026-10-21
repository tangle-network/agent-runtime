import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { AgentCandidateArtifactRef, Sha256Digest } from '@tangle-network/agent-interface'
import { markPutStreamVerified } from '../candidate-execution/artifact-streams'
import type { AgentCandidateOutputArtifactPort } from '../candidate-execution/types'
import { syncDirectory, syncHandle } from './durable-sync'
import { runAbortable } from './supervise/abortable'
import { mapWithConcurrency } from './util'

const DIGEST = /^sha256:([0-9a-f]{64})$/u
const HEX = /^[0-9a-f]{64}$/u
const SHARD = /^[0-9a-f]{2}$/u
const SAFE_NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u
const RECEIPT_SCHEMA = 'agent-runtime.private-cas-durable-receipt.v1'
const DURABLE_ATTEMPTS = 3
// A durable copy that moves no bytes for this long is abandoned and retried. Every put and pass that
// shares its digest waits for that copy, so a store that hangs without failing must not hold them,
// including callers that pass no signal of their own.
const DURABLE_STALL_MS = 120_000
// A buffered put reports no progress, so its attempt also gets the time this rate needs for its bytes.
const BUFFERED_BYTES_PER_MS = 256
// Objects a pass copies at once. Each copy is a store round trip plus a receipt with two fsyncs, so
// one at a time ran at 2 objects/s on drew-gtr-pro's USB drive (a 3,563-object run took 30 min).
const OFFLOAD_COPIES_AT_ONCE = 16
// Shards a full pass lists at once. Listed one object at a time, the first pass of a retire pass's
// owner export over a run of 13,240 objects on drew-gtr-pro's USB disk took 56 s from a cold cache
// (2026-10-20), and every put of that export waited for it.
const LIST_SHARDS_AT_ONCE = 16

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
 *
 * An object's name is published only after its bytes are synced, and that order is what makes a
 * name trustworthy. A put whose digest already exists links nothing: it re-reads the existing
 * object and refuses on a mismatch, and no later put replaces that file. So a deferred-sync mode
 * that published names before one batch sync would, after a crash, leave a torn object under its
 * valid name, and every later put of that digest would fail. Any batching must keep the order:
 * write under temporary names, sync, publish the names, sync again (discovery-lab
 * runner/evidence-store.mjs commits receipts this way). On drew-gtr-pro's USB SMR disk on
 * 2026-10-21 these per-object fsyncs, 545 ms each on the 16 SYNC_THREADS, set a store's rate at
 * about 26 files/s.
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
      await syncHandle(file)
    } finally {
      await file.close()
    }
    await rename(temporary, join(receipts, hex))
    await syncDirectory(receipts)
  }

  // One attempt's signal: the caller's, plus a stall that aborts after `idleMs` without progress.
  // The store call is raced against it too, so a store that ignores its signal cannot hold the copy.
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
    const attempt = signal === undefined ? stall.signal : AbortSignal.any([signal, stall.signal])
    return {
      signal: attempt,
      touch,
      run: (act: () => Promise<void>) =>
        runAbortable(act, attempt, 'private CAS durable copy was cancelled'),
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
        await watch.run(() => durable!.put({ namespace, digest, bytes, signal: watch.signal }))
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
    // Shards come back in listing order, so the pass is the same whichever shard ends first.
    const listed = await mapWithConcurrency(
      shards.filter((name) => SHARD.test(name)),
      LIST_SHARDS_AT_ONCE,
      async (shard) => {
        const objects: Array<{ hex: string; path: string; size: number; modifiedMs: number }> = []
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
        return objects
      },
    )
    return listed.flat()
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
        await watch.run(() =>
          durable!.putStream!({
            namespace,
            digest,
            byteLength,
            chunks: pulled,
            signal: watch.signal,
          }),
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
  // Every object on this host and its size, as the last full pass found them plus what puts linked
  // since, so a pass that reads only the undurable objects still reports exact totals.
  const localIndex = new Map<string, number>()
  // Objects this process wrote that have no durable receipt yet. After the process's first full
  // pass, a pass reads only these: a full pass lists every object of the store and reads its
  // receipt, and on canary test-acceptance-canary-20261019q two of them per capture (the Lab
  // offloads before and after) took 60.1-63.2 s on each native copy, on a store whose puts had
  // already uploaded their own objects. The first pass of every process is full, so objects an
  // earlier process left on disk without a receipt are always found.
  const undurable = new Set<string>()
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
    if (linked) localIndex.set(sha, byteLength)
    if (durableNow) undurable.delete(sha)
    else undurable.add(sha)
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
  // Waiting for another caller's copy ends at this caller's own cancellation: a stalled upload
  // must not hold every pass in the process, which all wait under one pass lock.
  const waitFor = (copy: Promise<void>, signal?: AbortSignal): Promise<void> => {
    const settled = copy.catch(() => undefined)
    return signal === undefined
      ? settled
      : runAbortable(() => settled, signal, 'private CAS wait for a copy in flight was cancelled')
  }
  const copyOnce = async (
    sha: string,
    copy: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    for (let inflight = uploading.get(sha); inflight !== undefined; inflight = uploading.get(sha)) {
      await waitFor(inflight, signal)
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
  // The objects a pass after the first need: those written without a receipt, as they are now.
  const undurableObjects = async (): Promise<
    Array<{ hex: string; path: string; size: number; modifiedMs: number }>
  > => {
    const objects: Array<{ hex: string; path: string; size: number; modifiedMs: number }> = []
    for (const hex of [...undurable]) {
      const path = join(store, hex.slice(0, 2), hex)
      try {
        const entry = await lstat(path)
        if (entry.isFile()) objects.push({ hex, path, size: entry.size, modifiedMs: entry.mtimeMs })
      } catch (error) {
        if (!missing(error)) throw error
        undurable.delete(hex)
      }
    }
    return objects
  }
  const receiptCount = async (): Promise<number> => {
    try {
      return (await readdir(receipts)).filter((name) => HEX.test(name)).length
    } catch (error) {
      if (!missing(error)) throw error
      return 0
    }
  }
  const sweep = async (signal?: AbortSignal): Promise<PrivateCasOffloadReport> => {
    // A full pass on the first pass of a process, with no durable store (nothing becomes durable),
    // or when the host is over its budget and must evict.
    // The host's bytes now, including objects puts linked since the last pass.
    let indexedBytes = 0
    for (const size of localIndex.values()) indexedBytes += size
    const full =
      lastPass === undefined ||
      durable === undefined ||
      (localBudgetBytes !== undefined && indexedBytes > localBudgetBytes)
    const objects = full ? await localObjects() : await undurableObjects()
    let refusal: string | undefined
    type Outcome = { hex: string; durable: boolean; copied?: boolean; error?: string }
    // Outcomes come back in object order, so the report does not depend on which copy ends first.
    // A buffered store reads each object whole into memory, so it keeps copying one at a time.
    const streams = durable === undefined || (durable.putStream && durable.getStream)
    const outcomes = await mapWithConcurrency(
      objects,
      streams ? OFFLOAD_COPIES_AT_ONCE : 1,
      async ({ hex, path, size }): Promise<Outcome> => {
        const inflight = uploading.get(hex)
        if (inflight !== undefined) await waitFor(inflight, signal)
        if (await hasReceipt(hex)) return { hex, durable: true, copied: false }
        if (durable === undefined) return { hex, durable: false }
        const digest = `sha256:${hex}` as Sha256Digest
        // After one refusal the store is likely down; the next pass retries instead of this one
        // spending its backoff on every remaining object. Copies already in flight finish.
        if (refusal !== undefined)
          return {
            hex,
            durable: false,
            error: `not attempted after an earlier refusal: ${refusal}`,
          }
        try {
          if (durable.putStream && durable.getStream) {
            const copied = await copyOnce(
              hex,
              () => streamDurably(digest, path, size, signal),
              signal,
            )
            return { hex, durable: true, copied }
          }
          const bytes = await readLocal(path)
          if (bytes === undefined) return { hex, durable: false }
          if (sha256(bytes) !== digest)
            return {
              hex,
              durable: false,
              error: 'local object failed digest verification; it stays on the host',
            }
          const copied = await copyOnce(hex, () => storeDurably(digest, bytes, signal), signal)
          return { hex, durable: true, copied }
        } catch (error) {
          if (signal?.aborted) throw error
          refusal ??= message(error)
          return { hex, durable: false, error: message(error) }
        }
      },
    )
    const pending: Array<{ digest: Sha256Digest; error: string }> = []
    let uploaded = 0
    const durableHex = new Set<string>()
    for (const outcome of outcomes) {
      if (outcome.durable) {
        durableHex.add(outcome.hex)
        if (outcome.copied) uploaded++
      } else if (outcome.error !== undefined)
        pending.push({ digest: `sha256:${outcome.hex}` as Sha256Digest, error: outcome.error })
    }
    for (const outcome of outcomes) {
      if (outcome.durable) undurable.delete(outcome.hex)
      else if (durable !== undefined) undurable.add(outcome.hex)
    }
    if (!full) {
      let localBytes = 0
      for (const size of localIndex.values()) localBytes += size
      lastPass = { localBytes, pending: pending.length }
      return {
        durable: await receiptCount(),
        uploaded,
        pending,
        evicted: 0,
        localObjects: localIndex.size,
        localBytes,
      }
    }
    localIndex.clear()
    for (const object of objects) localIndex.set(object.hex, object.size)
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
        localIndex.delete(object.hex)
        evicted++
      }
    }
    lastPass = { localBytes, pending: pending.length }
    return {
      durable: await receiptCount(),
      uploaded,
      pending,
      evicted,
      localObjects: objects.length - evicted,
      localBytes,
    }
  }

  // One pass at a time: a pass never deletes a copy that another pass is still uploading. Callers
  // that arrive while a pass waits to start share it: it starts after each of them called, so it
  // reads every object they wrote. Each put of a capture used to queue a pass of its own, which
  // reads every object and its receipt, and another capture on the same store waited behind all
  // of them: on Discovery canary test-acceptance-canary-20261019j a root's final capture spent
  // 26.6 minutes storing one 31.7 MB archive behind a checkpoint capture's puts. A shared pass
  // runs on no caller's signal, since its copies end at their stall bound; each caller stops
  // waiting at its own cancellation.
  let passes: Promise<unknown> = Promise.resolve()
  let waiting: Promise<PrivateCasOffloadReport> | undefined
  const offload = (signal?: AbortSignal): Promise<PrivateCasOffloadReport> => {
    let pass = waiting
    if (pass === undefined) {
      pass = passes.then(() => {
        waiting = undefined
        return sweep()
      })
      waiting = pass
      passes = pass.catch(() => undefined)
    }
    const shared = pass
    return signal === undefined
      ? shared
      : runAbortable(() => shared, signal, 'private CAS offload wait was cancelled')
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
        await syncHandle(file)
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
      await syncDirectory(directory)
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
      await syncHandle(file)
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
