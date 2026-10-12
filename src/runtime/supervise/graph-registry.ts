/**
 * `graph-registry` — the designer's memory: graphs and their outcomes as files.
 *
 * The AgentGraph algebra makes a graph PLAIN DATA (nodes with pinned profiles,
 * edges with registry-versioned directives, a budget, a deliverable
 * description), which is the property that lets a graph be stored, replayed
 * byte-identical, and mutated like code. This module is the thin durable layer
 * on top: one JSONL record per run, the exact graph content-addressed beside
 * it. The natural home is a SANDBOX WORKSPACE — the platform's snapshot story
 * (Firecracker restore, warm leases, `continuity: 'resume'`) then makes the
 * registry the agent's compounding execution memory across runs: a rerun over
 * the same sandbox finds every graph the designer ever ran, what each cost,
 * and whether it delivered.
 *
 * ORACLES STAY ENVIRONMENT-OWNED. `DeliverableSpec.check` is a function and is
 * deliberately NOT stored: a stored graph keeps the deliverable's `describe`
 * and an optional `checkRef`, and replay re-binds the check from the caller's
 * environment. This is the graph contract's own doctrine — graders are
 * environment, never workers — applied to persistence.
 *
 * Scoring is a documented heuristic, not a learned model: delivered beats
 * failed, then cheaper (tokens, then iterations), then most recent. A designer
 * that needs better selection replaces `pickBest`, not the records.
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { AgentGraph, GraphEdge } from './graph'

/** A graph as stored: every axis serializable; the check re-bound at replay. */
export interface StoredGraph {
  readonly digest: string
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly profile: AgentProfile }>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly budget: AgentGraph['budget']
  readonly deliverable: { readonly describe?: string; readonly checkRef?: string }
}

/** One completed run of one graph, for one task shape. */
export interface GraphRunRecord {
  /** Content-address of the exact graph that ran. */
  readonly graphDigest: string
  /** Digest of the normalized task shape the designer computed for lookup. */
  readonly taskDigest: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly outcome:
    | { readonly kind: 'delivered'; readonly summary?: string }
    | { readonly kind: 'no-winner'; readonly reason?: string }
  /** Cost from the run's terminal accounting. Unknown channels omitted. */
  readonly cost: {
    readonly iterations?: number
    readonly tokens?: number
    readonly usd?: number
    readonly ms?: number
  }
  /** Ledger size + exhausted edges: the trace's shape, for the designer's read. */
  readonly traversals: number
  readonly exhaustedEdges?: ReadonlyArray<string>
}

export interface GraphRegistryDir {
  readonly root: string
}

const RECORDS_FILE = 'records.jsonl'
const GRAPHS_DIR = 'graphs'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Canonical serialization for content-addressing: stable key order, sorted. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Digest of the exact graph (nodes + edges + budget + deliverable describe). */
export function graphDigest(graph: Omit<StoredGraph, 'digest'>): string {
  return sha256(canonicalJson(graph))
}

/** Digest of the normalized task shape a designer looks records up by. */
export function taskShapeDigest(taskShape: Record<string, unknown>): string {
  return sha256(canonicalJson(taskShape))
}

/** Digest of a runnable graph exactly as the registry stores it — the value
 *  `recordGraphRun` demands. Callers recording real runs hash through this,
 *  never hand-rolled, so a record always matches its graph. */
export function digestOfGraph(graph: AgentGraph): string {
  return storeGraph(graph).digest
}

function storeGraph(graph: AgentGraph): StoredGraph {
  return {
    digest: graphDigest({
      nodes: graph.nodes,
      edges: graph.edges,
      budget: graph.budget,
      deliverable: {
        ...(graph.deliverable.describe ? { describe: graph.deliverable.describe } : {}),
      },
    }),
    nodes: graph.nodes,
    edges: graph.edges,
    budget: graph.budget,
    deliverable: {
      ...(graph.deliverable.describe ? { describe: graph.deliverable.describe } : {}),
    },
  }
}

function assertRecord(record: GraphRunRecord): void {
  if (typeof record.graphDigest !== 'string' || record.graphDigest.length === 0)
    throw new ValidationError('graph-registry: record.graphDigest is required')
  if (typeof record.taskDigest !== 'string' || record.taskDigest.length === 0)
    throw new ValidationError('graph-registry: record.taskDigest is required')
  if (record.outcome.kind !== 'delivered' && record.outcome.kind !== 'no-winner')
    throw new ValidationError(
      "graph-registry: record.outcome.kind must be 'delivered' | 'no-winner'",
    )
}

/** Open (or lazily create) a registry rooted at a workspace directory. The
 *  directory is the sandbox workspace; snapshots carry it across runs. */
export function graphRegistry(root: string): GraphRegistryDir {
  if (!root || root.trim().length === 0)
    throw new ValidationError('graphRegistry: root directory is required')
  return { root }
}

async function recordsPath(reg: GraphRegistryDir): Promise<string> {
  await mkdir(join(reg.root, GRAPHS_DIR), { recursive: true })
  return join(reg.root, RECORDS_FILE)
}

/** Append one run record; the exact graph is content-addressed beside it.
 *  Idempotent per (taskDigest, graphDigest, startedAt): a replayed append with
 *  the same key replaces the prior row rather than duplicating it. */
export async function recordGraphRun(
  reg: GraphRegistryDir,
  graph: AgentGraph,
  record: GraphRunRecord,
): Promise<StoredGraph> {
  assertRecord(record)
  const stored = storeGraph(graph)
  if (stored.digest !== record.graphDigest) {
    throw new ValidationError(
      `graph-registry: record.graphDigest ${record.graphDigest} does not match the supplied graph (${stored.digest}) — record the graph that actually ran`,
    )
  }
  await recordsPath(reg)
  await writeFile(
    join(reg.root, GRAPHS_DIR, `${stored.digest}.json`),
    JSON.stringify(stored),
    'utf8',
  )
  const file = join(reg.root, RECORDS_FILE)
  let existing: GraphRunRecord[] = []
  try {
    existing = (await readFile(file, 'utf8'))
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as GraphRunRecord)
  } catch {
    // First record.
  }
  const keyed = existing.filter(
    (row) =>
      !(
        row.taskDigest === record.taskDigest &&
        row.graphDigest === record.graphDigest &&
        row.startedAt === record.startedAt
      ),
  )
  keyed.push(record)
  await writeFile(file, keyed.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  return stored
}

/** All records, newest last. */
export async function listGraphRuns(reg: GraphRegistryDir): Promise<GraphRunRecord[]> {
  try {
    const text = await readFile(join(reg.root, RECORDS_FILE), 'utf8')
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as GraphRunRecord)
  } catch {
    return []
  }
}

/** Records for one task shape, newest last. */
export async function graphRunsFor(
  reg: GraphRegistryDir,
  taskDigest: string,
): Promise<GraphRunRecord[]> {
  return (await listGraphRuns(reg)).filter((row) => row.taskDigest === taskDigest)
}

export type GraphSelection =
  | { readonly kind: 'replay'; readonly graph: StoredGraph; readonly record: GraphRunRecord }
  | { readonly kind: 'author'; readonly reason: string }

/** The documented heuristic: delivered beats failed; among delivered, cheaper
 *  (tokens, then iterations) wins; ties go to the most recent. */
export function pickBestGraph(records: ReadonlyArray<GraphRunRecord>): GraphRunRecord | undefined {
  const delivered = records.filter((row) => row.outcome.kind === 'delivered')
  if (delivered.length === 0) return undefined
  const better = (a: GraphRunRecord, b: GraphRunRecord): GraphRunRecord => {
    const aTokens = a.cost.tokens ?? Number.POSITIVE_INFINITY
    const bTokens = b.cost.tokens ?? Number.POSITIVE_INFINITY
    if (aTokens !== bTokens) return aTokens < bTokens ? a : b
    const aIter = a.cost.iterations ?? Number.POSITIVE_INFINITY
    const bIter = b.cost.iterations ?? Number.POSITIVE_INFINITY
    if (aIter !== bIter) return aIter < bIter ? a : b
    return a.finishedAt >= b.finishedAt ? a : b
  }
  return delivered.reduce((best, row) => (better(best, row) === best ? best : row))
}

/** Load a stored graph by digest. */
export async function loadGraph(
  reg: GraphRegistryDir,
  digest: string,
): Promise<StoredGraph | undefined> {
  try {
    return JSON.parse(
      await readFile(join(reg.root, GRAPHS_DIR, `${digest}.json`), 'utf8'),
    ) as StoredGraph
  } catch {
    return undefined
  }
}

/** The designer's lookup: replay the known-good graph for this task shape, or
 *  author a new one — with the reason stated either way (the decision is data). */
export async function lookupGraph(
  reg: GraphRegistryDir,
  taskDigest: string,
): Promise<GraphSelection> {
  const records = await graphRunsFor(reg, taskDigest)
  const best = pickBestGraph(records)
  if (best) {
    const graph = await loadGraph(reg, best.graphDigest)
    if (graph) return { kind: 'replay', graph, record: best }
    return {
      kind: 'author',
      reason: `best record's graph ${best.graphDigest.slice(0, 12)} is missing from the registry`,
    }
  }
  return {
    kind: 'author',
    reason:
      records.length === 0
        ? 'first run for this task shape'
        : 'no graph delivered for this task shape yet',
  }
}

/** Rehydrate a stored graph into a runnable one. The check comes from the
 *  CALLER's environment (oracles are environment, never stored). */
export function graphFromStored(
  stored: StoredGraph,
  check: AgentGraph['deliverable']['check'],
): AgentGraph {
  return {
    nodes: stored.nodes,
    edges: stored.edges,
    budget: stored.budget,
    deliverable: {
      check,
      ...(stored.deliverable.describe ? { describe: stored.deliverable.describe } : {}),
    },
  }
}

/** Digests present on disk (integrity probe for tests and audits). */
export async function storedGraphDigests(reg: GraphRegistryDir): Promise<string[]> {
  try {
    return (await readdir(join(reg.root, GRAPHS_DIR)))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort()
  } catch {
    return []
  }
}
