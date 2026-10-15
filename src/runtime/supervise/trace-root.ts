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
 * Salts are random, so a trace root can never be recomputed from the archive alone. Recovery and
 * replay copy the recorded receipt; they never derive a new one.
 */
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
import { createSandboxToolPartState, mapSandboxToolEvent } from '../sandbox-events'
import type { ResultBlobStore, TraceRootReceipt } from './types'

export const TRACE_ROOT_SCHEMA = 'agent-runtime.trace-root.v1'
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
  /** Store the trace root of `out` stored under `outRef`; `undefined` when it archived no events. */
  write(outRef: string, out: unknown): Promise<TraceRootReceipt | undefined>
  /** The receipt an earlier `write` produced for `outRef`, if any. */
  recorded(outRef: string | undefined): Promise<TraceRootReceipt | undefined>
}

/** @internal */
export function traceRootWriter(blobs: ResultBlobStore, nodeId: string): TraceRootWriter {
  const roots = new Map<string, Promise<TraceRootReceipt | undefined>>()
  return {
    write(outRef, out) {
      const known = roots.get(outRef)
      if (known !== undefined) return known
      const pending = persistTraceRoot(blobs, nodeId, outRef, out)
      roots.set(outRef, pending)
      // A failed write is retried by the next writer rather than remembered.
      pending.catch(() => roots.delete(outRef))
      return pending
    },
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
  out: unknown,
): Promise<TraceRootReceipt | undefined> {
  const events = archivedEvents(out)
  if (events === undefined) return undefined
  let artifact: TraceRootArtifact
  try {
    artifact = await traceRootArtifact(nodeId, outRef, events)
  } catch (error) {
    // An event with no canonical JSON form (an unpaired surrogate) leaves the output unproven;
    // it never fails the turn that produced it. Measured 2026-10-15: 0 of 366 archives.
    if (error instanceof LedgerCanonicalizationError) return undefined
    throw error
  }
  const ref = contentAddress(artifact)
  await blobs.put(ref, artifact)
  return { root: artifact.root, ref, leafCount: artifact.leafCount }
}

function archivedEvents(out: unknown): readonly unknown[] | undefined {
  if (out === null || typeof out !== 'object' || Array.isArray(out)) return undefined
  const events = (out as { events?: unknown }).events
  return Array.isArray(events) ? events : undefined
}

/** Leaves hashed between yields to the event loop. Hashing runs about 40 µs per event, and the
 *  largest archived turn holds 65,276 events: unbroken, that blocked the process for 2.7 s while
 *  sibling turns, coordination calls and heartbeats waited. */
const LEAVES_PER_SLICE = 256

async function traceRootArtifact(
  nodeId: string,
  outRef: string,
  archived: readonly unknown[],
): Promise<TraceRootArtifact> {
  const salts: string[] = []
  const leaves: LedgerHash[] = []
  const tools = createSandboxToolPartState()
  const toolCalls = new Map<string, number>()
  for (const [index, event] of archived.entries()) {
    if (index > 0 && index % LEAVES_PER_SLICE === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    // Hash the event as the blob store keeps it: a JSON document, read back the way a verifier
    // reads `events[i]`. The writer's copy is a structured clone and can hold values JSON drops.
    const stored = storedForm(event)
    const salt = merkleSalt()
    salts.push(salt)
    leaves.push(merkleLeafHash(canonicalString(jsonDocument(stored)), salt))
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
  salts.push(salt)
  leaves.push(merkleLeafHash(canonicalString(summary), salt))
  return {
    schema: TRACE_ROOT_SCHEMA,
    nodeId,
    outRef,
    root: merkleRoot(leaves),
    leafCount: leaves.length,
    salts,
    leaves,
    summary,
  }
}

/** One array item through `JSON.stringify` and back: what `JSON.parse(blob).events[i]` holds. */
function storedForm(event: unknown): unknown {
  const text = JSON.stringify(event)
  return text === undefined ? null : JSON.parse(text)
}
