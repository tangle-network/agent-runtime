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

import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { sha256 } from '../../content-digest'
import {
  isNoEntError,
  readCommittedJsonFile,
  upsertCommittedJsonLine,
  withJsonlFileLock,
} from '../../durable/jsonl-file'
import { ValidationError } from '../../errors'
import { writeAtomicDurableFile } from './durable-file'
import type { AgentGraph, GraphEdge } from './graph'
import { checkGraphRoute } from './graph-file-schema'
import { bindGraphParameters } from './graph-parameters'
import type { GraphFromStoredOptions } from './stored-graph-check'

export type { GraphCommandCheck, GraphFromStoredOptions } from './stored-graph-check'

/** @inline */
interface StoredGraphContent {
  readonly digest: string
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly profile: AgentProfile }>
  readonly deliverable: Pick<
    AgentGraph['deliverable'],
    'describe' | 'checkRef' | 'command' | 'when'
  >
  /** A flow graph's entry and gates; absent for any other graph. */
  readonly entry?: AgentGraph['entry']
  readonly gates?: AgentGraph['gates']
}

/** A graph as stored. Observed imports retain unknown directives and budgets;
 * they describe what happened and cannot be replayed as executable graphs. */
export type StoredGraph = StoredGraphContent &
  (
    | {
        readonly observed?: false
        readonly edges: ReadonlyArray<GraphEdge>
        readonly budget: AgentGraph['budget']
      }
    | {
        readonly observed: true
        readonly edges: ReadonlyArray<
          | GraphEdge
          | {
              readonly from: string
              readonly to: string
            }
        >
        readonly budget?: AgentGraph['budget']
      }
  )

/** Editable graph data; registration computes its digest when it is omitted. */
export type StoredGraphInput = Omit<
  Extract<StoredGraph, { readonly observed?: false }>,
  'digest'
> & {
  readonly digest?: string
}

/** One run or an explicitly incomplete observation of a graph, for one task shape. */
export interface GraphRunRecord {
  /** Content-address of the exact graph that ran. */
  readonly graphDigest: string
  /** Digest of the normalized task shape the designer computed for lookup. */
  readonly taskDigest: string
  readonly startedAt: string
  /** Absent while running or when completion was not established. */
  readonly finishedAt?: string
  readonly outcome:
    | { readonly kind: 'delivered'; readonly summary?: string }
    | { readonly kind: 'no-winner'; readonly reason?: string }
    | { readonly kind: 'unknown' | 'running'; readonly reason: string }
  /** Measured accounting; running observations are to date. Unknown channels omitted. */
  readonly cost: {
    readonly iterations?: number
    readonly tokens?: number
    readonly usd?: number
    readonly ms?: number
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly humanMessages?: number
    readonly leadMessages?: number
    /** Elapsed wall time from the task start to an independently verified merge. */
    readonly mergeMs?: number
  }
  /** Metered ledger size, absent when a source exposes relationships without traversals. */
  readonly traversals?: number
  readonly exhaustedEdges?: ReadonlyArray<string>
  /** Explicit source metadata, never classified from transcript or PR prose. */
  readonly taskType?: 'feature' | 'bugfix' | 'consolidation' | 'investigation' | 'ops'
  /** Stable run identity; re-ingesting this source replaces its observation. */
  readonly source?: { readonly kind: string; readonly id: string; readonly url?: string }
  readonly observedAt?: string
  /** Link to the canonical trace run; execution trees remain trace-owned. */
  readonly traceRunId?: string
  /** Canonical ordered adjacency. This is not a graph-isomorphism claim. */
  readonly topologyDigest?: string
  readonly evidence?: ReadonlyArray<{
    readonly kind: string
    readonly url: string
    readonly at?: string
  }>
  readonly nodeUsage?: ReadonlyArray<{
    readonly nodeId: string
    readonly sourceId?: string
    readonly startedAt?: string
    /** Latest recorded activity, not a claim that the node finished. */
    readonly lastRecordAt?: string
    readonly finishedAt?: string
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly humanMessages?: number
    readonly leadMessages?: number
  }>
  /** Missing or partial evidence, including incomplete accounting channels. */
  readonly unknowns?: ReadonlyArray<string>
}

export interface GraphRegistryDir {
  readonly root: string
}

const RECORDS_FILE = 'records.jsonl'
const GRAPHS_DIR = 'graphs'

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

/** Digest of the exact graph (nodes + edges + budget + deliverable describe, and a flow graph's
 *  entry and gates). An absent key is not serialized, so a graph without `entry` keeps the digest
 *  it had before flow graphs were stored. */
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
  const { describe, checkRef, command, when } = graph.deliverable
  const content = {
    nodes: graph.nodes,
    edges: graph.edges,
    budget: graph.budget,
    deliverable: {
      ...(describe ? { describe } : {}),
      ...(checkRef ? { checkRef } : {}),
      ...(command ? { command } : {}),
      ...(when ? { when } : {}),
    },
    ...(graph.entry === undefined ? {} : { entry: graph.entry }),
    ...(graph.gates === undefined ? {} : { gates: graph.gates }),
  }
  return { digest: graphDigest(content), ...content }
}

function assertRecord(record: GraphRunRecord): void {
  if (typeof record.graphDigest !== 'string' || record.graphDigest.length === 0)
    throw new ValidationError('graph-registry: record.graphDigest is required')
  if (typeof record.taskDigest !== 'string' || record.taskDigest.length === 0)
    throw new ValidationError('graph-registry: record.taskDigest is required')
  if (!Number.isFinite(Date.parse(record.startedAt)))
    throw new ValidationError('graph-registry: record.startedAt must be a timestamp')
  if (!['delivered', 'no-winner', 'unknown', 'running'].includes(record.outcome.kind))
    throw new ValidationError('graph-registry: invalid record.outcome.kind')
  if (
    (record.outcome.kind === 'delivered' || record.outcome.kind === 'no-winner') &&
    (!record.finishedAt || !Number.isFinite(Date.parse(record.finishedAt)))
  )
    throw new ValidationError('graph-registry: terminal outcomes require record.finishedAt')
  if (
    (record.outcome.kind === 'unknown' || record.outcome.kind === 'running') &&
    !record.outcome.reason
  )
    throw new ValidationError('graph-registry: incomplete outcomes require a reason')
  if (record.source && (!record.source.kind || !record.source.id))
    throw new ValidationError('graph-registry: source.kind and source.id are required')
  if (
    record.finishedAt &&
    (!Number.isFinite(Date.parse(record.finishedAt)) ||
      Date.parse(record.finishedAt) < Date.parse(record.startedAt))
  )
    throw new ValidationError('graph-registry: finishedAt precedes startedAt or is invalid')
  for (const [channel, value] of Object.entries(record.cost)) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
      throw new ValidationError(`graph-registry: invalid cost.${channel}`)
  }
}

function recordKey(record: GraphRunRecord): string {
  assertRecord(record)
  if (record.source) return JSON.stringify(['source', record.source.kind, record.source.id])
  return JSON.stringify([record.taskDigest, record.graphDigest, record.startedAt])
}

/** Open (or lazily create) a registry rooted at a workspace directory. The
 *  directory is the sandbox workspace; snapshots carry it across runs. */
export function graphRegistry(root: string): GraphRegistryDir {
  if (!root || root.trim().length === 0)
    throw new ValidationError('graphRegistry: root directory is required')
  return { root }
}

/** Append one run record; the exact graph is content-addressed beside it.
 *  Idempotent per (taskDigest, graphDigest, startedAt): a replayed append with
 *  the same key replaces the prior row rather than duplicating it. */
export async function recordGraphRun(
  reg: GraphRegistryDir,
  graph: AgentGraph,
  record: GraphRunRecord,
): Promise<StoredGraph> {
  const stored = storeGraph(graph)
  return recordStoredGraphRun(reg, stored, record)
}

/** Store an executable graph or an observed external topology in the same registry.
 * Imported observations retain their source identity and never authorize replay.
 * A reader refreshing facts can preserve independently joined labels; an explicit
 * correction leaves preserveLabels unset and replaces the record. */
export async function recordStoredGraphRun(
  reg: GraphRegistryDir,
  definition: StoredGraph | StoredGraphInput,
  record?: GraphRunRecord,
  options: { readonly preserveLabels?: boolean } = {},
): Promise<StoredGraph> {
  const { digest, ...content } = definition
  const stored = { ...content, digest: digest ?? graphDigest(content) } as StoredGraph
  if (stored.observed && !record)
    throw new ValidationError('graph-registry: observed graphs require a source run identity')
  if (record) {
    assertRecord(record)
    if (stored.observed && !record.source)
      throw new ValidationError('graph-registry: observed graphs require a source run identity')
    if (!stored.observed && !record.finishedAt)
      throw new ValidationError('graph-registry: native graph runs require a completion timestamp')
    if (
      (!stored.observed || record.traversals !== undefined) &&
      (!Number.isSafeInteger(record.traversals) || record.traversals! < 0)
    )
      throw new ValidationError(
        'graph-registry: native graphs require metered traversals; observed counts must be non-negative integers',
      )
    if (stored.digest !== record.graphDigest) {
      throw new ValidationError(
        `graph-registry: record.graphDigest ${record.graphDigest} does not match the supplied graph (${stored.digest}) — record the graph that actually ran`,
      )
    }
  }
  if (graphDigest(content) !== stored.digest)
    throw new ValidationError('graph-registry: stored graph content does not match its digest')
  await mkdir(join(reg.root, GRAPHS_DIR), { recursive: true })
  const file = join(reg.root, RECORDS_FILE)
  return withJsonlFileLock(file, async (canonicalPath) => {
    if (!record) {
      await persistGraph(reg, stored)
      return stored
    }
    let persisted = record
    if (options.preserveLabels && record.source) {
      const prior = (await readCommittedJsonFile<GraphRunRecord>(canonicalPath)).find(
        (row) => row.source?.kind === record.source!.kind && row.source.id === record.source!.id,
      )
      if (prior) {
        const taskType = record.taskType ?? prior.taskType
        const priorTerminal =
          prior.outcome.kind === 'delivered' || prior.outcome.kind === 'no-winner'
        const incomingUnassessed =
          record.outcome.kind === 'unknown' || record.outcome.kind === 'running'
        if (priorTerminal && incomingUnassessed && prior.startedAt !== record.startedAt)
          throw new ValidationError(
            'graph-registry: preserving labels requires the same task start and source identity',
          )
        const evidence = [...(prior.evidence ?? []), ...(record.evidence ?? [])]
        persisted = {
          ...record,
          ...(taskType ? { taskType } : {}),
          ...(record.unknowns
            ? {
                unknowns: record.unknowns.filter(
                  (reason) => !(taskType && reason === 'task type not explicitly labeled'),
                ),
              }
            : {}),
          ...(evidence.length
            ? {
                evidence: [
                  ...new Map(evidence.map((entry) => [canonicalJson(entry), entry])).values(),
                ],
              }
            : {}),
          ...(priorTerminal && incomingUnassessed
            ? {
                outcome: prior.outcome,
                finishedAt: prior.finishedAt,
                cost: {
                  ...record.cost,
                  ...(prior.cost.ms === undefined ? {} : { ms: prior.cost.ms }),
                  ...(prior.cost.mergeMs === undefined ? {} : { mergeMs: prior.cost.mergeMs }),
                },
              }
            : {}),
        }
      }
    }
    assertRecord(persisted)
    await persistGraph(reg, stored)
    await upsertCommittedJsonLine(canonicalPath, persisted, recordKey)
    return stored
  })
}

async function persistGraph(reg: GraphRegistryDir, stored: StoredGraph): Promise<void> {
  const revisionPath = join(reg.root, GRAPHS_DIR, `${stored.digest}.json`)
  try {
    const { digest: existingDigest, ...existing } = JSON.parse(
      await readFile(revisionPath, 'utf8'),
    ) as StoredGraph
    if (existingDigest !== stored.digest || graphDigest(existing) !== stored.digest)
      throw new ValidationError(
        'graph-registry: stored graph revision is immutable but its content differs',
      )
  } catch (error) {
    if (!isNoEntError(error)) throw error
    // Content-addressed revisions are immutable. Rewriting one on every run adds
    // an unnecessary durable publication to the record lock's critical section.
    writeAtomicDurableFile(revisionPath, JSON.stringify(stored), { preserveMode: true })
  }
}

/** All records, newest last. */
export async function listGraphRuns(reg: GraphRegistryDir): Promise<GraphRunRecord[]> {
  return readCommittedJsonFile<GraphRunRecord>(join(reg.root, RECORDS_FILE))
}

/** Filters over the existing graph run records. Missing source kind is native. */
export interface GraphRunQuery {
  readonly taskDigest?: string
  readonly taskType?: GraphRunRecord['taskType'] | 'unknown'
  readonly topologyDigest?: string
  readonly sourceKind?: string
}

function observedTopology(record: GraphRunRecord): string {
  return record.topologyDigest ?? (record.source ? 'unknown' : record.graphDigest)
}

/** Records for one task shape or deterministic label query, newest last. */
export async function graphRunsFor(
  reg: GraphRegistryDir,
  query: string | GraphRunQuery = {},
): Promise<GraphRunRecord[]> {
  const filters = typeof query === 'string' ? { taskDigest: query } : query
  return (await listGraphRuns(reg)).filter(
    (row) =>
      (filters.taskDigest === undefined || row.taskDigest === filters.taskDigest) &&
      (filters.taskType === undefined || (row.taskType ?? 'unknown') === filters.taskType) &&
      (filters.topologyDigest === undefined || observedTopology(row) === filters.topologyDigest) &&
      (filters.sourceKind === undefined || (row.source?.kind ?? 'native') === filters.sourceKind),
  )
}

/** Descriptive task-type/topology measurements, with every population explicit.
 * Unknown and running runs never enter the assessed denominator or medians. */
export interface GraphCorpusGroup {
  readonly taskType: NonNullable<GraphRunRecord['taskType']> | 'unknown'
  readonly topologyDigest: string
  readonly delivered: number
  readonly assessed: number
  readonly unknown: number
  readonly deliveredRate: number | null
  readonly medianWallMs: number | null
  readonly wallMsCount: number
  readonly medianMergeMs: number | null
  readonly mergeMsCount: number
  readonly medianTokens: number | null
  readonly tokenCount: number
  readonly medianHumanMessages: number | null
  readonly humanMessageCount: number
  readonly runs: readonly GraphRunRecord[]
}

/** The registry's observational view. It neither authorizes replay nor proves a causal win. */
export interface GraphCorpusSummary {
  readonly recordCount: number
  readonly groups: readonly GraphCorpusGroup[]
}

function medianKnown(values: readonly (number | undefined)[]): {
  median: number | null
  count: number
} {
  const known = values
    .filter((value): value is number => value !== undefined && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b)
  const middle = Math.floor(known.length / 2)
  return {
    count: known.length,
    median:
      known.length === 0
        ? null
        : known.length % 2
          ? known[middle]!
          : (known[middle - 1]! + known[middle]!) / 2,
  }
}

// The single observational policy used by both query and pickBestGraph. Native
// selection below remains unchanged; this policy is an explicit descriptive opt-in.
function observedGraphSummary(records: readonly GraphRunRecord[]): GraphCorpusSummary {
  const groups = new Map<string, GraphRunRecord[]>()
  for (const record of records) {
    const key = JSON.stringify([record.taskType ?? 'unknown', observedTopology(record)])
    const rows = groups.get(key)
    if (rows) rows.push(record)
    else groups.set(key, [record])
  }
  const summaries: GraphCorpusGroup[] = [...groups.values()].map((runs) => {
    const assessed = runs.filter(
      (run) => run.outcome.kind === 'delivered' || run.outcome.kind === 'no-winner',
    )
    const delivered = assessed.filter((run) => run.outcome.kind === 'delivered')
    const wall = medianKnown(assessed.map((run) => run.cost.ms))
    const merge = medianKnown(
      delivered
        .filter((run) => run.evidence?.some((entry) => entry.kind === 'pr-merged'))
        .map((run) => run.cost.mergeMs),
    )
    const tokens = medianKnown(assessed.map((run) => run.cost.tokens))
    const human = medianKnown(assessed.map((run) => run.cost.humanMessages))
    return {
      taskType: runs[0]!.taskType ?? 'unknown',
      topologyDigest: observedTopology(runs[0]!),
      delivered: delivered.length,
      assessed: assessed.length,
      unknown: runs.length - assessed.length,
      deliveredRate: assessed.length ? delivered.length / assessed.length : null,
      medianWallMs: wall.median,
      wallMsCount: wall.count,
      medianMergeMs: merge.median,
      mergeMsCount: merge.count,
      medianTokens: tokens.median,
      tokenCount: tokens.count,
      medianHumanMessages: human.median,
      humanMessageCount: human.count,
      runs,
    }
  })
  summaries.sort((a, b) => {
    const delivered = (b.deliveredRate ?? -1) - (a.deliveredRate ?? -1)
    if (delivered) return delivered
    for (const key of ['medianWallMs', 'medianTokens', 'medianHumanMessages'] as const) {
      if (a[key] === b[key]) continue
      if (a[key] === null) return 1
      if (b[key] === null) return -1
      return a[key]! - b[key]!
    }
    return a.taskType.localeCompare(b.taskType) || a.topologyDigest.localeCompare(b.topologyDigest)
  })
  return { recordCount: records.length, groups: summaries }
}

/** Query and rank the same registry records using the opt-in observational
 * policy: delivery rate, wall time, tokens, then human messages; unknowns last. */
export async function graphCorpusSummary(
  reg: GraphRegistryDir,
  query: GraphRunQuery = {},
): Promise<GraphCorpusSummary> {
  return observedGraphSummary(await graphRunsFor(reg, query))
}

export type GraphSelection =
  | { readonly kind: 'replay'; readonly graph: StoredGraph; readonly record: GraphRunRecord }
  | { readonly kind: 'author'; readonly reason: string }

/** The documented heuristic: delivered beats failed; among delivered, cheaper
 *  (tokens, then iterations) wins; ties go to the most recent. */
export function pickBestGraph(
  records: ReadonlyArray<GraphRunRecord>,
  options: { readonly policy?: 'native' | 'observed' } = {},
): GraphRunRecord | undefined {
  if (options.policy === 'observed') {
    const group = observedGraphSummary(records).groups[0]
    return group && pickBestGraph(group.runs)
  }
  const delivered = records.filter((row) => row.outcome.kind === 'delivered')
  if (delivered.length === 0) return undefined
  const better = (a: GraphRunRecord, b: GraphRunRecord): GraphRunRecord => {
    const aTokens = a.cost.tokens ?? Number.POSITIVE_INFINITY
    const bTokens = b.cost.tokens ?? Number.POSITIVE_INFINITY
    if (aTokens !== bTokens) return aTokens < bTokens ? a : b
    const aIter = a.cost.iterations ?? Number.POSITIVE_INFINITY
    const bIter = b.cost.iterations ?? Number.POSITIVE_INFINITY
    if (aIter !== bIter) return aIter < bIter ? a : b
    return a.finishedAt! >= b.finishedAt! ? a : b
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
  const candidates: GraphRunRecord[] = []
  const loaded = new Map<string, StoredGraph | undefined>()
  for (const record of records) {
    if (!loaded.has(record.graphDigest))
      loaded.set(record.graphDigest, await loadGraph(reg, record.graphDigest))
    const graph = loaded.get(record.graphDigest)
    if (!graph?.observed) candidates.push(record)
  }
  if (records.length && !candidates.length)
    return {
      kind: 'author',
      reason: 'only observed topologies are available; author an executable graph',
    }
  const best = pickBestGraph(candidates)
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

/** Rehydrate a stored graph, binding trigger data and an environment-owned named check. */
export function graphFromStored(
  stored: StoredGraph | StoredGraphInput,
  environment: AgentGraph['deliverable']['check'] | GraphFromStoredOptions = {},
): AgentGraph {
  if (stored.observed)
    throw new ValidationError('graphFromStored: observed topology cannot be replayed')
  const {
    digest: _digest,
    observed: _observed,
    deliverable,
    ...topology
  } = (
    typeof environment === 'function'
      ? stored
      : bindGraphParameters(stored, { trigger: environment.trigger ?? {} })
  ) as typeof stored
  const selected =
    typeof environment === 'function'
      ? environment
      : environment.checks && Object.hasOwn(environment.checks, deliverable.checkRef ?? '')
        ? environment.checks[deliverable.checkRef!]
        : deliverable.checkRef === 'command'
          ? deliverable.command
          : deliverable.checkRef === 'route' && deliverable.when
            ? (((out, context) =>
                context
                  ? context.originalVerdict?.valid !== false
                  : checkGraphRoute(
                      deliverable.when!,
                      out,
                    )) satisfies AgentGraph['deliverable']['check'])
            : undefined
  if (!selected)
    throw new ValidationError(
      `graphFromStored: unknown checkRef ${deliverable.checkRef ?? '(missing)'}`,
    )
  if (typeof selected === 'function') {
    const { command: _command, ...description } = deliverable
    return { ...topology, deliverable: { ...description, check: selected } }
  }
  const command =
    selected === deliverable.command
      ? selected
      : (bindGraphParameters(selected, {
          trigger: (environment as GraphFromStoredOptions).trigger ?? {},
        }) as typeof selected)
  return {
    ...topology,
    deliverable: {
      ...deliverable,
      command,
      check: () => false, // runGraph binds the independent command authority before execution.
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
