/**
 * Trace roots: one Merkle root over the events a turn archived, so a single event can be proven
 * against the hash its journal record carries without reading the rest of the archive.
 *
 * The leaves are the archived events in stored order, each hashed with its own random salt, then
 * one summary leaf that counts the events and the tool calls among them. The artifact keeps every
 * leaf and salt and is stored under its content address in the run's result blob store, beside
 * the archive it commits to. A verifier recomputes leaf `i` from `events[i]` of the `outRef` blob
 * and `salts[i]`, checks it against `leaves[i]`, and checks `merkleRoot(leaves)` against the root
 * the journal recorded. Leaf identity is `(outRef, index)`: an event's own `id` is a session
 * buffer offset and is absent on terminal events.
 *
 * One event array has one root per node. A result always gets its own. Evidence whose events the
 * node already rooted gets none: a retained owner's deferred workspace capture stores the turn it
 * just committed again, with the workspace fields added, under another `outRef`. A second root
 * over the same events would give one turn two count candidates and two run-root leaves.
 *
 * Salts are random, so a trace root can never be recomputed from the archive alone. Recovery and
 * replay copy the recorded receipt; they never derive a new one.
 */
import { createHash } from 'node:crypto'
import {
  canonicalString,
  jsonDocument,
  LedgerCanonicalizationError,
  type LedgerHash,
  merkleLeafHash,
  merkleRoot,
  merkleSalt,
} from '@tangle-network/agent-eval/ledger-core'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { contentAddress } from '../../durable/content-address'
import { createSandboxToolPartState, mapSandboxToolEvent } from '../sandbox-executor-output'

import type { ResultBlobStore, TraceRootReceipt } from './types'

/** Schema identifier of a stored {@link TraceRootArtifact}. */
export const TRACE_ROOT_SCHEMA = 'agent-runtime.trace-root.v1'
/** Schema identifier of the {@link TraceSummary} carried by a trace root's last leaf. */
export const TRACE_SUMMARY_SCHEMA = 'agent-runtime.trace-summary.v1'

/** The last leaf of a trace root: how many events the archive holds and the tool calls among them,
 *  one per distinct call id, by tool name. An absence or count claim is checked against it. */
export interface TraceSummary {
  readonly schema: typeof TRACE_SUMMARY_SCHEMA
  readonly events: number
  readonly toolCalls: Readonly<Record<string, number>>
}

/** The stored trace-root artifact. `leaves[i]` and `salts[i]` belong to `events[i]` of the
 *  `outRef` blob for `i < summary.events`; the final entry belongs to `summary`. */
export interface TraceRootArtifact {
  readonly schema: typeof TRACE_ROOT_SCHEMA
  readonly nodeId: string
  readonly outRef: string
  readonly root: string
  readonly leafCount: number
  readonly salts: readonly string[]
  readonly leaves: readonly string[]
  readonly summary: TraceSummary
}

/** @internal One trace root per archived output of one node, however many records cite it. */
export interface TraceRootWriter {
  /** Store the trace root of the result `out` stored under `outRef`; `undefined` when it archived
   *  no events. */
  write(outRef: string, out: unknown): Promise<TraceRootReceipt | undefined>
  /** As `write`, for evidence: also `undefined` when this node already rooted the same events
   *  under another output. */
  writeEvidence(outRef: string, out: unknown): Promise<TraceRootReceipt | undefined>
  /** The receipt an earlier write produced for `outRef`, if any. */
  recorded(outRef: string | undefined): Promise<TraceRootReceipt | undefined>
}

/** @internal */
export function traceRootWriter(blobs: ResultBlobStore, nodeId: string): TraceRootWriter {
  const roots = new Map<string, Promise<TraceRootReceipt | undefined>>()
  /** Digests of the event arrays this node holds a stored root for. */
  const rooted = new Set<string>()
  const persist = async (
    outRef: string,
    out: unknown,
    evidence: boolean,
  ): Promise<TraceRootReceipt | undefined> => {
    const events = archivedEvents(out)
    if (events === undefined) return undefined
    if (evidence) {
      // A root still being written counts once it is stored.
      await Promise.allSettled([...roots.values()])
      if (rooted.has(await eventsDigest(events))) return undefined
    }
    const stored = await persistTraceRoot(blobs, nodeId, outRef, events)
    if (stored === undefined) return undefined
    rooted.add(stored.digest)
    return stored.receipt
  }
  const memoized = (outRef: string, out: unknown, evidence: boolean) => {
    const known = roots.get(outRef)
    if (known !== undefined) return known
    const pending = persist(outRef, out, evidence)
    roots.set(outRef, pending)
    // A failed write is retried by the next writer rather than remembered.
    pending.catch(() => roots.delete(outRef))
    return pending
  }
  return {
    write: (outRef, out) => memoized(outRef, out, false),
    writeEvidence: (outRef, out) => memoized(outRef, out, true),
    async recorded(outRef) {
      if (outRef === undefined) return undefined
      return roots.get(outRef)?.catch(() => undefined)
    },
  }
}

async function persistTraceRoot(
  blobs: ResultBlobStore,
  nodeId: string,
  outRef: string,
  events: readonly unknown[],
): Promise<{ receipt: TraceRootReceipt; digest: string } | undefined> {
  let built: { artifact: TraceRootArtifact; digest: string }
  try {
    built = await traceRootArtifact(nodeId, outRef, events)
  } catch (error) {
    // An event with no canonical JSON form (an unpaired surrogate) leaves the output unproven;
    // it never fails the turn that produced it. 0 of 366 archives.
    if (error instanceof LedgerCanonicalizationError) return undefined
    throw error
  }
  const { artifact, digest } = built
  // The content address and the store's own encoding each walk the whole artifact (9.2 MB for
  // the largest turn); each takes its own turn of the event loop.
  await nextTurn()
  const ref = contentAddress(artifact)
  await nextTurn()
  await blobs.put(ref, artifact)
  return { receipt: { root: artifact.root, ref, leafCount: artifact.leafCount }, digest }
}

function archivedEvents(out: unknown): readonly unknown[] | undefined {
  if (out === null || typeof out !== 'object' || Array.isArray(out)) return undefined
  const events = (out as { events?: unknown }).events
  return Array.isArray(events) ? events : undefined
}

/** The longest stretch of hashing between yields to the event loop. Hashing runs about 40 µs per
 *  event, and the largest archived turn holds 65,276 events: unbroken, that blocked the process
 *  for 2.7 s while sibling turns, coordination calls and heartbeats waited. A slice is measured
 *  in time, not events, because one event can be megabytes. */
const SLICE_MS = 10

/** Yields to the event loop once a slice has run `SLICE_MS`; `undefined` while it has not. */
function slicer(): () => Promise<void> | undefined {
  let started = performance.now()
  return () => {
    if (performance.now() - started < SLICE_MS) return undefined
    return nextTurn().then(() => {
      started = performance.now()
    })
  }
}

function nextTurn(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

/** The identity of an event array as stored: the digest of each event's stored JSON, in order.
 *  Two arrays with one digest have the same leaves' content. */
async function eventsDigest(events: readonly unknown[]): Promise<string> {
  const hash = createHash('sha256')
  const slice = slicer()
  for (const event of events) {
    const yielded = slice()
    if (yielded !== undefined) await yielded
    hash.update(storedText(event)).update('\n')
  }
  return hash.digest('hex')
}

async function traceRootArtifact(
  nodeId: string,
  outRef: string,
  archived: readonly unknown[],
): Promise<{ artifact: TraceRootArtifact; digest: string }> {
  const salts: string[] = []
  const leaves: LedgerHash[] = []
  const tree = merkleTree()
  const identity = createHash('sha256')
  const tools = createSandboxToolPartState()
  const toolCalls = new Map<string, number>()
  const slice = slicer()
  for (const event of archived) {
    const yielded = slice()
    if (yielded !== undefined) await yielded
    // Hash the event as the blob store keeps it: a JSON document, read back the way a verifier
    // reads `events[i]`. The writer's copy is a structured clone and can hold values JSON drops.
    const text = storedText(event)
    identity.update(text).update('\n')
    const stored: unknown = JSON.parse(text)
    const salt = merkleSalt()
    const leaf = merkleLeafHash(canonicalString(jsonDocument(stored)), salt)
    salts.push(salt)
    leaves.push(leaf)
    tree.push(leaf)
    for (const projected of mapSandboxToolEvent(stored as SandboxEvent, tools)) {
      if (projected.type !== 'tool_call') continue
      toolCalls.set(projected.toolName, (toolCalls.get(projected.toolName) ?? 0) + 1)
    }
  }
  const summary: TraceSummary = {
    schema: TRACE_SUMMARY_SCHEMA,
    events: archived.length,
    toolCalls: Object.fromEntries(toolCalls),
  }
  const salt = merkleSalt()
  const leaf = merkleLeafHash(canonicalString(summary), salt)
  salts.push(salt)
  leaves.push(leaf)
  tree.push(leaf)
  return {
    artifact: {
      schema: TRACE_ROOT_SCHEMA,
      nodeId,
      outRef,
      root: tree.root(),
      leafCount: leaves.length,
      salts,
      leaves,
      summary,
    },
    digest: identity.digest('hex'),
  }
}

/**
 * `merkleRoot(leaves)` built as the leaves arrive, so its interior hashes run inside the sliced
 * leaf loop instead of in one block after it (0.4 s for 65,277 leaves). It keeps the perfect
 * subtrees of RFC 9162, largest first, and joins two with ledger-core's own interior hash,
 * `merkleRoot([left, right])`; the root folds them from the right, as RFC 9162 splits at the
 * largest power of two.
 */
function merkleTree(): { push(leaf: LedgerHash): void; root(): LedgerHash } {
  const peaks: { hash: LedgerHash; size: number }[] = []
  return {
    push(leaf) {
      let hash = leaf
      let size = 1
      while (peaks.at(-1)?.size === size) {
        hash = merkleRoot([peaks.pop()!.hash, hash])
        size *= 2
      }
      peaks.push({ hash, size })
    },
    root() {
      let root = peaks.at(-1)!.hash
      for (let index = peaks.length - 2; index >= 0; index -= 1) {
        root = merkleRoot([peaks[index]!.hash, root])
      }
      return root
    },
  }
}

/** One array item as `JSON.stringify` writes it: `JSON.parse` of it is what `events[i]` holds. */
function storedText(event: unknown): string {
  return JSON.stringify(event) ?? 'null'
}
