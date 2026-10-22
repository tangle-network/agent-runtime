/**
 * Durable copies of a private CAS, and the offload passes that make them: one object at a time to
 * the off-host store, with a stall bound, retries, a receipt on the host once the store holds the
 * bytes, and one copy in flight per digest. A pass copies every local object without a receipt,
 * then deletes the oldest durable local copies above the host's budget.
 */

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sha256Digest } from '@tangle-network/agent-interface'
import { syncDirectory, syncHandle } from './durable-sync'
import type { PrivateCasOffloadReport } from './private-cas'
import {
  casSha256,
  checkDirectories,
  hexOf,
  isMissingPath,
  type PrivateCasLayout,
  privateCasRef,
  readLocal,
  readObject,
} from './private-cas-objects'
import { runAbortable } from './supervise/abortable'
import { errorMessage, mapWithConcurrency } from './util'

const HEX = /^[0-9a-f]{64}$/u
const SHARD = /^[0-9a-f]{2}$/u
// Objects a pass copies at once. Each copy is a store round trip plus a receipt with two fsyncs, so
// one at a time ran at 2 objects/s on drew-gtr-pro's USB drive (a 3,563-object run took 30 min).
const OFFLOAD_COPIES_AT_ONCE = 16
// Shards a full pass lists at once. Listed one object at a time, the first pass of a retire pass's
// owner export over a run of 13,240 objects on drew-gtr-pro's USB disk took 56 s from a cold cache
// (2026-10-20), and every put of that export waited for it.
const LIST_SHARDS_AT_ONCE = 16

interface LocalObject {
  hex: string
  path: string
  size: number
  modifiedMs: number
}

type CopyOutcome = { hex: string; durable: boolean; copied?: boolean; error?: string }

/** One object a put has just written locally and now makes durable. */
export interface PutToSettle {
  /** The object's lowercase hex digest. */
  sha: string
  byteLength: number
  /** False when the object already existed and this put linked nothing. */
  linked: boolean
  /** The put's bytes, when it holds them; otherwise the copy streams the local object. */
  bytes?: Uint8Array
}

async function receiptCount(layout: PrivateCasLayout): Promise<number> {
  try {
    return (await readdir(layout.receipts)).filter((name) => HEX.test(name)).length
  } catch (error) {
    if (!isMissingPath(error)) throw error
    return 0
  }
}

async function listLocalObjects(layout: PrivateCasLayout): Promise<LocalObject[]> {
  let shards: string[]
  try {
    shards = await readdir(layout.store)
  } catch (error) {
    if (isMissingPath(error)) return []
    throw error
  }
  // Shards come back in listing order, so the pass is the same whichever shard ends first.
  const listed = await mapWithConcurrency(
    shards.filter((name) => SHARD.test(name)),
    LIST_SHARDS_AT_ONCE,
    async (shard) => {
      const objects: LocalObject[] = []
      for (const hex of await readdir(join(layout.store, shard))) {
        if (!HEX.test(hex) || hex.slice(0, 2) !== shard) continue
        const path = join(layout.store, shard, hex)
        try {
          const entry = await lstat(path)
          if (entry.isFile())
            objects.push({ hex, path, size: entry.size, modifiedMs: entry.mtimeMs })
        } catch (error) {
          if (!isMissingPath(error)) throw error
        }
      }
      return objects
    },
  )
  return listed.flat()
}

/**
 * The state offload passes share, with the passes that read and write it.
 *
 * A pass after the first reads only the objects this process wrote without a receipt: a full
 * pass lists every object of the store and reads its receipt, and on canary
 * test-acceptance-canary-20261019q two of them per capture (the Lab offloads before and after)
 * took 60.1-63.2 s on each native copy, on a store whose puts had already uploaded their own
 * objects. The first pass of every process is full, so objects an earlier process left on disk
 * without a receipt are always found.
 */
export class PrivateCasOffload {
  // What the last full pass left on this host. A put that makes its own object durable, after a
  // pass that left nothing pending, stays inside the budget without another pass: a pass reads
  // every object and its receipt, so a pass per put made capture quadratic on a host that keeps
  // its objects (drew-gtr-pro wrote 3 objects a minute into a run holding 1,228, 2026-10-18).
  private lastPass: { localBytes: number; pending: number } | undefined
  // Every object on this host and its size, as the last full pass found them plus what puts linked
  // since, so a pass that reads only the undurable objects still reports exact totals.
  private readonly localIndex = new Map<string, number>()
  // Objects this process wrote that have no durable receipt yet.
  private readonly undurable = new Set<string>()
  private readonly copier: DurableCopier
  // One pass at a time: a pass never deletes a copy that another pass is still uploading. Callers
  // that arrive while a pass waits to start share it: it starts after each of them called, so it
  // reads every object they wrote. Each put of a capture used to queue a pass of its own, which
  // reads every object and its receipt, and another capture on the same store waited behind all
  // of them: on Discovery canary test-acceptance-canary-20261019j a root's final capture spent
  // 26.6 minutes storing one 31.7 MB archive behind a checkpoint capture's puts. A shared pass
  // runs on no caller's signal, since its copies end at their stall bound; each caller stops
  // waiting at its own cancellation.
  private passes: Promise<unknown> = Promise.resolve()
  private waiting: Promise<PrivateCasOffloadReport> | undefined

  constructor(private readonly layout: PrivateCasLayout) {
    this.copier = createDurableCopier(layout)
  }

  /** Make a just-written object durable, then run a pass unless the last one proves it needs none. */
  async settlePut(put: PutToSettle, signal?: AbortSignal): Promise<void> {
    const { sha, byteLength, linked } = put
    const { layout } = this
    if (!(await hasReceipt(layout, sha)))
      await this.copier
        .copyOnce(
          sha,
          put.bytes === undefined
            ? { path: join(layout.store, sha.slice(0, 2), sha), byteLength }
            : { bytes: put.bytes },
          signal,
        )
        .catch(() => undefined)
    const durableNow = await hasReceipt(layout, sha)
    if (linked) this.localIndex.set(sha, byteLength)
    if (durableNow) this.undurable.delete(sha)
    else this.undurable.add(sha)
    // No await between the budget check and the reservation, so concurrent puts cannot both fit.
    const added = linked ? byteLength : 0
    const known = this.lastPass
    if (
      durableNow &&
      known !== undefined &&
      known.pending === 0 &&
      (layout.localBudgetBytes === undefined || known.localBytes + added <= layout.localBudgetBytes)
    ) {
      known.localBytes += added
      return
    }
    await this.offload(signal)
  }

  offload(signal?: AbortSignal): Promise<PrivateCasOffloadReport> {
    let pass = this.waiting
    if (pass === undefined) {
      pass = this.passes.then(() => {
        this.waiting = undefined
        return this.sweep()
      })
      this.waiting = pass
      this.passes = pass.catch(() => undefined)
    }
    const shared = pass
    return signal === undefined
      ? shared
      : runAbortable(() => shared, signal, 'private CAS offload wait was cancelled')
  }

  private indexedBytes(): number {
    let total = 0
    for (const size of this.localIndex.values()) total += size
    return total
  }

  // The objects a pass after the first needs: those written without a receipt, as they are now.
  private async undurableObjects(): Promise<LocalObject[]> {
    const objects: LocalObject[] = []
    for (const hex of [...this.undurable]) {
      const path = join(this.layout.store, hex.slice(0, 2), hex)
      try {
        const entry = await lstat(path)
        if (entry.isFile()) objects.push({ hex, path, size: entry.size, modifiedMs: entry.mtimeMs })
      } catch (error) {
        if (!isMissingPath(error)) throw error
        this.undurable.delete(hex)
      }
    }
    return objects
  }

  private async sweep(): Promise<PrivateCasOffloadReport> {
    const { durable, localBudgetBytes } = this.layout
    // A full pass on the first pass of a process, with no durable store (nothing becomes durable),
    // or when the host is over its budget and must evict.
    const full =
      this.lastPass === undefined ||
      durable === undefined ||
      (localBudgetBytes !== undefined && this.indexedBytes() > localBudgetBytes)
    const objects = full ? await listLocalObjects(this.layout) : await this.undurableObjects()
    const outcomes = await this.copyObjects(objects)
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
      if (outcome.durable) this.undurable.delete(outcome.hex)
      else if (durable !== undefined) this.undurable.add(outcome.hex)
    }
    if (!full) {
      const localBytes = this.indexedBytes()
      this.lastPass = { localBytes, pending: pending.length }
      return {
        durable: await receiptCount(this.layout),
        uploaded,
        pending,
        evicted: 0,
        localObjects: this.localIndex.size,
        localBytes,
      }
    }
    this.localIndex.clear()
    for (const object of objects) this.localIndex.set(object.hex, object.size)
    const total = objects.reduce((sum, object) => sum + object.size, 0)
    const { evicted, localBytes } = await this.evictOldest(objects, durableHex, total)
    this.lastPass = { localBytes, pending: pending.length }
    return {
      durable: await receiptCount(this.layout),
      uploaded,
      pending,
      evicted,
      localObjects: objects.length - evicted,
      localBytes,
    }
  }

  // Delete the oldest local copies that have a durable receipt until the host is within budget.
  private async evictOldest(
    objects: LocalObject[],
    durableHex: ReadonlySet<string>,
    totalBytes: number,
  ): Promise<{ evicted: number; localBytes: number }> {
    const { localBudgetBytes } = this.layout
    let localBytes = totalBytes
    let evicted = 0
    if (localBudgetBytes === undefined) return { evicted, localBytes }
    for (const object of [...objects].sort((a, b) => a.modifiedMs - b.modifiedMs)) {
      if (localBytes <= localBudgetBytes) break
      if (!durableHex.has(object.hex) || !(await hasReceipt(this.layout, object.hex))) continue
      try {
        await unlink(object.path)
      } catch (error) {
        if (!isMissingPath(error)) throw error
      }
      localBytes -= object.size
      this.localIndex.delete(object.hex)
      evicted++
    }
    return { evicted, localBytes }
  }

  // Outcomes come back in object order, so the report does not depend on which copy ends first.
  // A buffered store reads each object whole into memory, so it keeps copying one at a time.
  private async copyObjects(objects: LocalObject[]): Promise<CopyOutcome[]> {
    const { durable } = this.layout
    let refusal: string | undefined
    const streams = durable === undefined || (durable.putStream && durable.getStream)
    return mapWithConcurrency(
      objects,
      streams ? OFFLOAD_COPIES_AT_ONCE : 1,
      async ({ hex, path, size }): Promise<CopyOutcome> => {
        await this.copier.waitForCopy(hex)
        if (await hasReceipt(this.layout, hex)) return { hex, durable: true, copied: false }
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
            const copied = await this.copier.copyOnce(hex, { path, byteLength: size })
            return { hex, durable: true, copied }
          }
          const bytes = await readLocal(path)
          if (bytes === undefined) return { hex, durable: false }
          if (casSha256(bytes) !== digest)
            return {
              hex,
              durable: false,
              error: 'local object failed digest verification; it stays on the host',
            }
          const copied = await this.copier.copyOnce(hex, { bytes })
          return { hex, durable: true, copied }
        } catch (error) {
          refusal ??= errorMessage(error)
          return { hex, durable: false, error: errorMessage(error) }
        }
      },
    )
  }
}

const RECEIPT_SCHEMA = 'agent-runtime.private-cas-durable-receipt.v1'
const DURABLE_ATTEMPTS = 3
// A buffered put reports no progress, so its attempt also gets the time this rate needs for its bytes.
const BUFFERED_BYTES_PER_MS = 256

export async function hasReceipt(layout: PrivateCasLayout, hex: string): Promise<boolean> {
  try {
    return (await lstat(join(layout.receipts, hex))).isFile()
  } catch (error) {
    if (isMissingPath(error)) return false
    throw error
  }
}

async function writeReceipt(
  layout: PrivateCasLayout,
  digest: Sha256Digest,
  byteLength: number,
): Promise<void> {
  const { receipts } = layout
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
      `${JSON.stringify({ schema: RECEIPT_SCHEMA, location: layout.durable!.location, namespace: layout.namespace, digest, byteLength, storedAt: new Date().toISOString() })}\n`,
    )
    if (!layout.ephemeral) await syncHandle(file)
  } finally {
    await file.close()
  }
  await rename(temporary, join(receipts, hex))
  if (!layout.ephemeral) await syncDirectory(receipts)
}

// One attempt's signal: the caller's, plus a stall that aborts after `idleMs` without progress.
// The store call is raced against it too, so a store that ignores its signal cannot hold the copy.
function watchAttempt(idleMs: number, signal?: AbortSignal) {
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
async function retryCopy(
  signal: AbortSignal | undefined,
  attemptCopy: () => Promise<void>,
): Promise<void> {
  let failure: unknown
  for (let attempt = 1; attempt <= DURABLE_ATTEMPTS; attempt++) {
    signal?.throwIfAborted()
    try {
      await attemptCopy()
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

function storeDurably(
  layout: PrivateCasLayout,
  digest: Sha256Digest,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  return retryCopy(signal, async () => {
    const watch = watchAttempt(
      layout.durableStallMs + Math.ceil(bytes.byteLength / BUFFERED_BYTES_PER_MS),
      signal,
    )
    try {
      await watch.run(() =>
        layout.durable!.put({ namespace: layout.namespace, digest, bytes, signal: watch.signal }),
      )
      await writeReceipt(layout, digest, bytes.byteLength)
    } finally {
      watch.done()
    }
  })
}

// Streams one local object to the durable store and records its receipt, retrying a transient
// store failure like storeDurably.
function streamDurably(
  layout: PrivateCasLayout,
  digest: Sha256Digest,
  path: string,
  byteLength: number,
  signal?: AbortSignal,
): Promise<void> {
  const ref = privateCasRef(layout.namespace, digest, byteLength)
  return retryCopy(signal, async () => {
    const watch = watchAttempt(layout.durableStallMs, signal)
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
        layout.durable!.putStream!({
          namespace: layout.namespace,
          digest,
          byteLength,
          chunks: pulled,
          signal: watch.signal,
        }),
      )
      await writeReceipt(layout, digest, byteLength)
    } finally {
      watch.done()
      await chunks.return(undefined)
    }
  })
}

/** The bytes one digest copies from: held in memory, or streamed from its local object. */
export type DurableCopySource = { bytes: Uint8Array } | { path: string; byteLength: number }

export interface DurableCopier {
  /** Copy a digest unless another caller's copy of it is in flight; true when this call copied. */
  copyOnce(hex: string, source: DurableCopySource, signal?: AbortSignal): Promise<boolean>
  /** Wait for another caller's copy to settle, ending at this caller's own cancellation. */
  waitForCopy(hex: string, signal?: AbortSignal): Promise<void>
}

/**
 * The one copy of each digest to the durable store in flight, from a put or a pass. A put or pass
 * that finds its digest in flight waits for that copy, then reads the receipt. Copying it again
 * doubles the upload and, for a buffered store, the archive in memory. Reporting it pending
 * failed captures: a capture refuses on any pending object, so two captures sharing one store
 * refused each other (discovery-lab provider-retention, agent-runtime 0.325.6, 2026-10-18).
 * A copy never waits for a pass, so a pass may wait for a copy.
 */
export function createDurableCopier(layout: PrivateCasLayout): DurableCopier {
  const uploading = new Map<string, Promise<void>>()
  // Waiting for another caller's copy ends at this caller's own cancellation: a stalled upload
  // must not hold every pass in the process, which all wait under one pass lock.
  const waitFor = (copy: Promise<void>, signal?: AbortSignal): Promise<void> => {
    const settled = copy.catch(() => undefined)
    return signal === undefined
      ? settled
      : runAbortable(() => settled, signal, 'private CAS wait for a copy in flight was cancelled')
  }
  return {
    async waitForCopy(hex, signal) {
      const inflight = uploading.get(hex)
      if (inflight !== undefined) await waitFor(inflight, signal)
    },
    async copyOnce(hex, source, signal) {
      for (
        let inflight = uploading.get(hex);
        inflight !== undefined;
        inflight = uploading.get(hex)
      ) {
        await waitFor(inflight, signal)
        if (await hasReceipt(layout, hex)) return false
      }
      const digest = `sha256:${hex}` as Sha256Digest
      // Nothing awaits between the last check and the entry, so two callers cannot both copy.
      const current =
        'bytes' in source
          ? storeDurably(layout, digest, source.bytes, signal)
          : streamDurably(layout, digest, source.path, source.byteLength, signal)
      uploading.set(hex, current)
      try {
        await current
        return true
      } finally {
        if (uploading.get(hex) === current) uploading.delete(hex)
      }
    },
  }
}
