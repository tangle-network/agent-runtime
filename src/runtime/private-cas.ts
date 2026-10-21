import { isAbsolute, join, resolve } from 'node:path'
import type { Sha256Digest } from '@tangle-network/agent-interface'
import { markPutStreamVerified } from '../candidate-execution/artifact-streams'
import type { AgentCandidateOutputArtifactPort } from '../candidate-execution/types'
import {
  casSha256,
  hexOf,
  locatePrivateCasObject,
  type PrivateCasLayout,
  readPrivateCasRef,
  readPrivateCasStream,
} from './private-cas-objects'
import { PrivateCasOffload } from './private-cas-offload'
import { putPrivateCasBuffered, putPrivateCasStream } from './private-cas-write'

const SAFE_NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u
// A durable copy that moves no bytes for this long is abandoned and retried. Every put and pass that
// shares its digest waits for that copy, so a store that hangs without failing must not hold them,
// including callers that pass no signal of their own.
const DURABLE_STALL_MS = 120_000

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
  const layout: PrivateCasLayout = {
    namespace,
    store: join(resolve(root), 'sha256'),
    receipts: join(resolve(root), 'durable', 'sha256'),
    durable,
    localBudgetBytes,
    durableStallMs,
  }
  const offload = new PrivateCasOffload(layout)
  const readStream: NonNullable<AgentCandidateOutputArtifactPort['readStream']> = (ref, options) =>
    readPrivateCasStream(layout, ref, options)
  const putStream: NonNullable<AgentCandidateOutputArtifactPort['putStream']> = (input) =>
    putPrivateCasStream(layout, offload, input)
  const port: PrivateCasArtifactPort = {
    // A buffered remote store cannot satisfy the streaming capture contract.
    ...(durable === undefined || (durable.putStream && durable.getStream)
      ? { putStream, readStream }
      : {}),
    async put({ bytes, signal }) {
      signal?.throwIfAborted()
      const digest = casSha256(bytes)
      return putPrivateCasBuffered(layout, offload, { bytes, digest, sha: hexOf(digest) }, signal)
    },
    read: (ref) => readPrivateCasRef(layout, ref),
    locate: (object, options) => locatePrivateCasObject(layout, object, options),
    offload: (signal) => offload.offload(signal),
  }
  // Without a durable store, putStream's own readback reads the object readStream will return.
  // With one, the caller's readback may come from the store and is kept.
  if (durable === undefined) markPutStreamVerified(putStream, readStream)
  return port
}
