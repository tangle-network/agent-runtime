/**
 * Durable copies of a private CAS: one object at a time to the off-host store, with a stall
 * bound, retries, a receipt on the host once the store holds the bytes, and one copy in
 * flight per digest.
 */

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sha256Digest } from '@tangle-network/agent-interface'
import { syncDirectory, syncHandle } from './durable-sync'
import {
  checkDirectories,
  hexOf,
  isMissingPath,
  type PrivateCasLayout,
  privateCasRef,
  readObject,
} from './private-cas-objects'
import { runAbortable } from './supervise/abortable'

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
    await syncHandle(file)
  } finally {
    await file.close()
  }
  await rename(temporary, join(receipts, hex))
  await syncDirectory(receipts)
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
