import type {
  ExecutionBindingReceipt,
  ProfileMaterializationReceipt,
  ProviderModelExecutionEvidence,
  Spend,
  SpendChannel,
  SpendGap,
  WorkerTraceEvidence,
} from '../runtime/supervise/types'
import { addSpend, cloneSpend, zeroSpend } from '../runtime/util'
import type { RuntimeDecisionKind, RuntimeHookTarget } from '../runtime-hooks'
import { type ObserverRecord, verifyObserverRecords } from './observer-journal'

/**
 * One settled projection status, shared by runs and nodes. `down` is the journal's own word for a
 * failure (a settlement is journaled as `kind: 'down'`, cancellation included), so a consumer can
 * join run rows to node rows on `status` and read one failure population instead of two.
 */
export type PursuitStatus = 'running' | 'done' | 'down'

/**
 * Where a node's dollar figure came from. `reported` = a provider billed all of it; `estimated` =
 * a model catalog priced all of it; `partial` = a provider billed part and a catalog priced the
 * rest; `unknown` = nothing priced it, so `usd` is a floor and never the cost.
 */
export type PursuitCostProvenance = 'reported' | 'estimated' | 'partial' | 'unknown'

/**
 * One node's token usage by class. Cache and reasoning classes are absent when the provider did
 * not report them — absence is not zero. `tokensKnown` is `false` when work happened whose token
 * count no provider reported, which makes `input`/`output` a floor.
 */
export interface PursuitNodeUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
  readonly reasoning?: number
  readonly tokensKnown: boolean
}

/** One node's dollar cost with the provenance that decides whether it may be compared or summed. */
export interface PursuitNodeCost {
  readonly usd: number
  readonly usdKnown: boolean
  /** The part of `usd` a model catalog priced because no provider receipt covered it. */
  readonly usdEstimated?: number
  readonly provenance: PursuitCostProvenance
}

/**
 * One node's clock. `wallMs` is `settledAt - startedAt` and is deliberately distinct from the
 * executor-reported `spent.ms` sums, which under-report and overlap across parallel children.
 * `firstTokenAt` stays absent unless a provider reports that instant; it is never inferred from
 * `firstOutputAt`, which is when the node first reported usage for a turn.
 */
export interface PursuitNodeTiming {
  readonly startedAt: number
  readonly firstOutputAt?: number
  readonly firstTokenAt?: number
  readonly settledAt?: number
  readonly wallMs?: number
}

/** Where and how a node's execution was placed, read off its execution-binding receipt. */
export type PursuitNodePlacement = Readonly<Record<string, string | number | boolean | null>>

/**
 * One run's spend counted once, and each node's own share of it. `inclusive` and the entries of
 * `exclusiveByNode` are the two views a client needs to show a tree without double counting.
 */
export interface PursuitRunTotals {
  /**
   * The whole run counted once. A node's settled `spent` already contains the child work its own
   * nested tree reported, so summing only the run's top-level nodes plus every node's own
   * inference counts each model call exactly once.
   */
  readonly inclusive: Spend
  /**
   * Each node's own share: its reported spend and own inference minus what its direct children
   * reported. Keyed by node id, plus the run root when the root itself metered inference. The
   * entries sum to `inclusive` by construction.
   */
  readonly exclusiveByNode: Readonly<Record<string, Spend>>
}

export interface PursuitRunProjection {
  readonly runId: string
  readonly status: PursuitStatus
  readonly settledAt?: number
  readonly error?: string
  readonly firstSequence: number
  readonly lastSequence: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly eventCount: number
  readonly decisionCount: number
  readonly targets: Readonly<Record<string, number>>
  readonly decisions: Readonly<Record<string, number>>
  readonly totals: PursuitRunTotals
  /** The nodes whose accounting is incomplete. Present exactly when non-empty. */
  readonly spendGaps?: ReadonlyArray<SpendGap>
}

export interface PursuitNodeProjection {
  readonly id: string
  readonly parentId?: string
  /** Node ids are scoped to this concrete Runtime tree; `(runId,id)` is identity. */
  readonly runId: string
  readonly label?: string
  /** The runner that executed this node — the executor's own name, not a harness guess. */
  readonly runtime?: string
  readonly depth?: number
  readonly assignmentId?: string
  readonly identity?: unknown
  readonly budget?: unknown
  readonly status: PursuitStatus
  readonly settledAt?: number
  /** The child work this node reported at settlement. Absent until a terminal record lands. */
  readonly spent?: Spend
  /** This node's OWN inference, re-homed from its nested tree. Absent when it drove no turns. */
  readonly ownInference?: Spend
  /** Absent until a spend record lands; the run's `spendGaps` then names the node. */
  readonly usage?: PursuitNodeUsage
  /** Absent until a spend record lands; the run's `spendGaps` then names the node. */
  readonly cost?: PursuitNodeCost
  readonly timing?: PursuitNodeTiming
  /** The kernel-minted attempt this node's execution binding is keyed on. */
  readonly attemptId?: string
  /** The runner-native execution the node bound to: a request, session, run, process, or tree. */
  readonly execution?: { readonly kind: string; readonly id: string }
  /** The model the materialization receipt names, when the runner reported one. */
  readonly model?: string
  /** The concrete backend the profile materialized onto. */
  readonly backend?: string
  readonly placement?: PursuitNodePlacement
  /** Model-call identifiers this node's own turns reported, in order, deduplicated. */
  readonly modelCalls?: ReadonlyArray<string>
  readonly materialization?: ProfileMaterializationReceipt
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>
  /** What the provider itself reported serving, and why it is unknown when it is. */
  readonly providerModel?: ProviderModelExecutionEvidence
  /** Content-addressed pointer to this node's persisted tool trace, or why there is none. */
  readonly trace?: WorkerTraceEvidence
  readonly outRef?: string
  readonly score?: number
  readonly valid?: boolean
  readonly reason?: string
  readonly infra?: boolean
  readonly wait?: unknown
  readonly firstSequence: number
  readonly lastSequence: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly eventCount: number
  readonly turnCount: number
}

export interface PursuitProjection {
  readonly pursuitId: string
  /** Number of records in this concrete execution journal. */
  readonly sequence: number
  /** Digest-chain tip for this concrete execution journal. */
  readonly chainTip: string
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly runs: readonly PursuitRunProjection[]
  readonly nodes: readonly PursuitNodeProjection[]
  readonly eventCount: number
  readonly decisionCount: number
}

type MutableRun = {
  runId: string
  status: PursuitStatus
  settledAt?: number
  error?: string
  firstSequence: number
  lastSequence: number
  firstObservedAt: number
  lastObservedAt: number
  eventCount: number
  decisionCount: number
  targets: Record<string, number>
  decisions: Record<string, number>
  /** Inference the run root drove itself, attributable to no spawned node. */
  rootInference?: Spend
}

type MutableNode = {
  id: string
  parentId?: string
  runId: string
  label?: string
  runtime?: string
  depth?: number
  assignmentId?: string
  identity?: unknown
  budget?: unknown
  status: PursuitStatus
  startedAt?: number
  settledAt?: number
  spent?: Spend
  ownInference?: Spend
  reasoningTokens?: number
  firstOutputAt?: number
  firstTokenAt?: number
  attemptId?: string
  execution?: { kind: string; id: string }
  model?: string
  backend?: string
  placement?: PursuitNodePlacement
  modelCalls: string[]
  materialization?: ProfileMaterializationReceipt
  executionBindings?: ReadonlyArray<ExecutionBindingReceipt>
  providerModel?: ProviderModelExecutionEvidence
  trace?: WorkerTraceEvidence
  outRef?: string
  score?: number
  valid?: boolean
  reason?: string
  infra?: boolean
  wait?: unknown
  firstSequence: number
  lastSequence: number
  firstObservedAt: number
  lastObservedAt: number
  eventCount: number
  turnCount: number
}

/**
 * Fold one append-only execution journal into a deterministic operator projection.
 *
 * This is intentionally a READ model, not another state machine: it does not own
 * execution, cannot steer agents, and can be rebuilt from the journal at any time.
 * Projection verifies the complete hash chain first, so an operator view can never
 * silently render a mutated or reordered observer history as trustworthy state.
 *
 * Topology comes only from Runtime's canonical `agent.spawn` facts. Terminal node
 * state comes only from `agent.child`; concrete run state comes only from the root
 * `agent.run` lifecycle emitted by `supervisePursuit`. Node identity is scoped to the
 * concrete Runtime run so independent trees may both contain `root:s0` without aliasing.
 *
 * Usage, cost and timing are reported at the class the runtime measured them at. A missing
 * class stays ABSENT and the run names the node in `spendGaps`; nothing here converts an
 * unmeasured channel into a zero, because a fabricated zero is indistinguishable from free work.
 */
export function projectPursuit(records: readonly ObserverRecord[]): PursuitProjection {
  if (records.length === 0) {
    throw new TypeError('projectPursuit: at least one observer record is required')
  }
  const pursuitId = records[0]!.pursuitId
  const verified = verifyObserverRecords(records, pursuitId)
  const runs = new Map<string, MutableRun>()
  const nodes = new Map<string, MutableNode>()
  let eventCount = 0
  let decisionCount = 0

  for (const record of verified) {
    const observed = record.event ?? record.decision
    if (!observed) throw new Error(`projectPursuit: record ${record.sequence} has no observation`)
    const run = getRun(runs, observed.runId, record)
    run.lastSequence = record.sequence
    run.lastObservedAt = record.observedAt

    if (record.event) {
      eventCount += 1
      run.eventCount += 1
      increment(run.targets, record.event.target)
      projectRunActivity(run, record)
      projectSpawnNode(nodes, record)
      projectNodeActivity(nodes, record)
      projectTurn(runs, nodes, record)
    } else if (record.decision) {
      decisionCount += 1
      run.decisionCount += 1
      increment(run.decisions, record.decision.kind)
    }
  }

  const byRun = new Map<string, MutableNode[]>()
  for (const node of nodes.values()) {
    const list = byRun.get(node.runId)
    if (list) list.push(node)
    else byRun.set(node.runId, [node])
  }

  const first = verified[0]!
  const last = verified.at(-1)!
  return Object.freeze({
    pursuitId,
    sequence: last.sequence,
    chainTip: last.digest,
    firstObservedAt: first.observedAt,
    lastObservedAt: last.observedAt,
    runs: Object.freeze(
      [...runs.values()]
        .sort((a, b) => a.firstSequence - b.firstSequence || a.runId.localeCompare(b.runId))
        .map((run) => freezeRun(run, byRun.get(run.runId) ?? [])),
    ),
    nodes: Object.freeze(
      [...nodes.values()]
        .sort(
          (a, b) =>
            a.firstSequence - b.firstSequence ||
            a.runId.localeCompare(b.runId) ||
            a.id.localeCompare(b.id),
        )
        .map(freezeNode),
    ),
    eventCount,
    decisionCount,
  })
}

function getRun(runs: Map<string, MutableRun>, runId: string, record: ObserverRecord): MutableRun {
  const existing = runs.get(runId)
  if (existing) return existing
  const created: MutableRun = {
    runId,
    status: 'running',
    firstSequence: record.sequence,
    lastSequence: record.sequence,
    firstObservedAt: record.observedAt,
    lastObservedAt: record.observedAt,
    eventCount: 0,
    decisionCount: 0,
    targets: {},
    decisions: {},
  }
  runs.set(runId, created)
  return created
}

function projectRunActivity(run: MutableRun, record: ObserverRecord): void {
  const event = record.event
  if (event?.target !== 'agent.run') return
  const payload = objectRecord(event.payload)
  const status = stringField(payload, 'status')
  if (event.phase === 'after' || status === 'done') {
    run.status = 'done'
    run.settledAt = record.observedAt
    return
  }
  // The `agent.run` hook payload spells a failure `failed`; the projection spells every
  // settled failure `down`, the journal's word, so run and node rows join on one vocabulary.
  if (event.phase !== 'error' && status !== 'failed') return
  run.status = 'down'
  run.settledAt = record.observedAt
  const error = stringField(payload, 'error')
  if (error) run.error = error
}

function nodeKey(runId: string, nodeId: string): string {
  return `${runId}\u0000${nodeId}`
}

function projectSpawnNode(nodes: Map<string, MutableNode>, record: ObserverRecord): void {
  const event = record.event
  if (event?.target !== 'agent.spawn') return
  const payload = objectRecord(event.payload)
  const childId = stringField(payload, 'childId')
  if (!childId) return
  const key = nodeKey(event.runId, childId)
  const existing = nodes.get(key)
  if (existing) {
    existing.lastSequence = record.sequence
    existing.lastObservedAt = record.observedAt
    existing.eventCount += 1
    return
  }
  const label = stringField(payload, 'label')
  const runtime = stringField(payload, 'runtime')
  const depth = numberField(payload, 'depth')
  const assignmentId = stringField(payload, 'assignmentId')
  const attemptId = stringField(payload, 'attemptId')
  const startedAt = numberField(payload, 'startedAt')
  nodes.set(key, {
    id: childId,
    ...(event.parentId ? { parentId: event.parentId } : {}),
    runId: event.runId,
    ...(label ? { label } : {}),
    ...(runtime ? { runtime } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(assignmentId ? { assignmentId } : {}),
    ...(attemptId ? { attemptId } : {}),
    // A spawn that predates the `startedAt` fact falls back to when the record was observed:
    // the spawn event is emitted synchronously with the spawn, so the two agree to the ms.
    startedAt: startedAt ?? record.observedAt,
    ...(payload && Object.hasOwn(payload, 'identity') ? { identity: payload.identity } : {}),
    ...(payload && Object.hasOwn(payload, 'budget') ? { budget: payload.budget } : {}),
    status: 'running',
    modelCalls: [],
    firstSequence: record.sequence,
    lastSequence: record.sequence,
    firstObservedAt: record.observedAt,
    lastObservedAt: record.observedAt,
    eventCount: 1,
    turnCount: 0,
  })
}

function projectNodeActivity(nodes: Map<string, MutableNode>, record: ObserverRecord): void {
  const event = record.event
  if (event === undefined) return
  if (event.target === 'agent.spawn') return
  const payload = objectRecord(event.payload)
  const nodeId =
    stringField(payload, 'childId') ??
    stringField(payload, 'nodeId') ??
    stringField(payload, 'workerId')
  if (!nodeId) return
  const node = nodes.get(nodeKey(event.runId, nodeId))
  if (!node) return
  node.lastSequence = record.sequence
  node.lastObservedAt = record.observedAt
  node.eventCount += 1

  if (event.target !== 'agent.child') return
  const status = stringField(payload, 'status')
  if (status !== 'done' && status !== 'down') return
  node.status = status
  node.settledAt = numberField(payload, 'settledAt') ?? record.observedAt
  const startedAt = numberField(payload, 'startedAt')
  if (startedAt !== undefined) node.startedAt = startedAt
  if (payload && Object.hasOwn(payload, 'spent')) node.spent = spendField(payload, 'spent')
  const metered = spendField(payload, 'metered')
  if (metered)
    node.ownInference = node.ownInference ? addSpend(node.ownInference, metered) : metered
  const runtime = stringField(payload, 'runtime')
  if (runtime) node.runtime = runtime
  const outRef = stringField(payload, 'outRef')
  if (outRef) node.outRef = outRef
  const score = numberField(payload, 'score')
  if (score !== undefined) node.score = score
  const valid = booleanField(payload, 'valid')
  if (valid !== undefined) node.valid = valid
  const reason = stringField(payload, 'reason')
  if (reason) node.reason = reason
  const infra = booleanField(payload, 'infra')
  if (infra !== undefined) node.infra = infra
  if (payload && Object.hasOwn(payload, 'wait')) node.wait = payload.wait
  attachSettlementEvidence(node, payload)
}

/**
 * Read the receipts a settlement carries. Each is taken as reported: an `unknown` receipt keeps
 * its `status` and `reason` so a client can show WHY a model or backend is missing instead of
 * showing nothing, and a receipt that never landed leaves every derived field absent.
 */
function attachSettlementEvidence(
  node: MutableNode,
  payload: Record<string, unknown> | undefined,
): void {
  const providerModel = payload?.providerModel as ProviderModelExecutionEvidence | undefined
  if (providerModel && typeof providerModel === 'object') node.providerModel = providerModel
  const trace = payload?.trace as WorkerTraceEvidence | undefined
  if (trace && typeof trace === 'object') node.trace = trace
  const bindings = payload?.executionBindings
  if (Array.isArray(bindings) && bindings.length > 0) {
    node.executionBindings = bindings as ReadonlyArray<ExecutionBindingReceipt>
    const known = bindings.find(
      (binding): binding is Extract<ExecutionBindingReceipt, { status: 'known' }> =>
        objectRecord(binding)?.status === 'known',
    )
    if (known) {
      node.placement = known.descriptor
      node.attemptId ??= known.attemptId
    }
  }
  const receipt = payload?.materialization as ProfileMaterializationReceipt | undefined
  if (!receipt || typeof receipt !== 'object') return
  node.materialization = receipt
  if (receipt.status !== 'known') return
  node.backend = receipt.backend
  if (receipt.model.status === 'known') node.model = receipt.model.id
  node.execution = { kind: receipt.execution.kind, id: receipt.execution.id }
}

/**
 * Fold one metered turn onto whoever drove it. `agent.turn` names its subject in `parentId` — the
 * node making the call — not in the payload, because the caller IS the subject. A turn the run
 * root drove belongs to no spawned node and lands on the run instead, so the run's totals stay
 * complete without inventing a node for the root.
 */
function projectTurn(
  runs: Map<string, MutableRun>,
  nodes: Map<string, MutableNode>,
  record: ObserverRecord,
): void {
  const event = record.event
  if (event?.target !== 'agent.turn') return
  const payload = objectRecord(event.payload)
  const spend = spendField(payload, 'spend')
  const subject = event.parentId
  if (subject === undefined) return
  const node = nodes.get(nodeKey(event.runId, subject))
  if (!node) {
    if (!spend) return
    const run = runs.get(event.runId)
    if (!run) return
    run.rootInference = run.rootInference ? addSpend(run.rootInference, spend) : spend
    return
  }
  node.turnCount += 1
  node.lastSequence = record.sequence
  node.lastObservedAt = record.observedAt
  if (spend) {
    node.ownInference = node.ownInference ? addSpend(node.ownInference, spend) : spend
    node.firstOutputAt ??= record.observedAt
  }
  const reasoning = numberField(payload, 'reasoningTokens')
  if (reasoning !== undefined) node.reasoningTokens = (node.reasoningTokens ?? 0) + reasoning
  const firstTokenAt = numberField(payload, 'firstTokenAt')
  if (firstTokenAt !== undefined) node.firstTokenAt ??= firstTokenAt
  const model = stringField(payload, 'model')
  if (model) node.model ??= model
  const callId = stringField(payload, 'callId')
  if (callId && !node.modelCalls.includes(callId)) node.modelCalls.push(callId)
}

/**
 * A node's whole reported cost: the child work its settlement reported plus the inference it drove
 * itself. `undefined` when neither landed — the run's `spendGaps` then names the node, so an
 * unaccounted node is visible instead of reading as free.
 */
function nodeTotal(node: MutableNode): Spend | undefined {
  if (node.spent && node.ownInference) return addSpend(node.spent, node.ownInference)
  if (node.spent) return cloneSpend(node.spent)
  if (node.ownInference) return cloneSpend(node.ownInference)
  return undefined
}

/**
 * The run counted once, and each node's own share of it.
 *
 * A settled node's `spent` already contains the child work its nested tree reported, so summing
 * every node would count a driver's descendants twice. Inclusive therefore sums only the run's
 * TOP-LEVEL nodes — those whose parent is not another node of this run — plus the root's own
 * turns. Exclusive subtracts each node's direct children from its own total, which telescopes:
 * the exclusive entries sum back to `inclusive` exactly.
 */
function runTotals(run: MutableRun, nodes: readonly MutableNode[]): PursuitRunTotals {
  const present = new Set(nodes.map((node) => node.id))
  const children = new Map<string, MutableNode[]>()
  for (const node of nodes) {
    if (node.parentId === undefined || !present.has(node.parentId)) continue
    const list = children.get(node.parentId)
    if (list) list.push(node)
    else children.set(node.parentId, [node])
  }
  const exclusiveByNode: Record<string, Spend> = {}
  let inclusive = run.rootInference ? cloneSpend(run.rootInference) : zeroSpend()
  if (run.rootInference) exclusiveByNode[run.runId] = cloneSpend(run.rootInference)
  for (const node of nodes) {
    const total = nodeTotal(node)
    if (total === undefined) continue
    if (node.parentId === undefined || !present.has(node.parentId)) {
      inclusive = addSpend(inclusive, total)
    }
    let exclusive = total
    for (const child of children.get(node.id) ?? []) {
      const childTotal = nodeTotal(child)
      if (childTotal !== undefined) exclusive = subtractSpend(exclusive, childTotal)
    }
    exclusiveByNode[node.id] = exclusive
  }
  return Object.freeze({
    inclusive: Object.freeze(inclusive),
    exclusiveByNode: Object.freeze(exclusiveByNode),
  })
}

/**
 * Remove a child's reported total from its parent's. Per channel, never below zero: a parent whose
 * executor reported less than its children did is a reporting gap, and a negative exclusive share
 * would be a fabricated number rather than a measurement.
 */
function subtractSpend(a: Spend, b: Spend): Spend {
  const tokens = { ...a.tokens }
  tokens.input = Math.max(0, tokens.input - b.tokens.input)
  tokens.output = Math.max(0, tokens.output - b.tokens.output)
  if (a.tokens.cacheRead !== undefined)
    tokens.cacheRead = Math.max(0, a.tokens.cacheRead - (b.tokens.cacheRead ?? 0))
  if (a.tokens.cacheWrite !== undefined)
    tokens.cacheWrite = Math.max(0, a.tokens.cacheWrite - (b.tokens.cacheWrite ?? 0))
  if (a.tokens.freshInput !== undefined)
    tokens.freshInput = Math.max(0, a.tokens.freshInput - (b.tokens.freshInput ?? 0))
  return {
    iterations: Math.max(0, a.iterations - b.iterations),
    tokens,
    ...(a.tokensKnown === false || b.tokensKnown === false ? { tokensKnown: false } : {}),
    usd: Math.max(0, a.usd - b.usd),
    ...(a.usdKnown === false || b.usdKnown === false ? { usdKnown: false } : {}),
    ...(a.usdEstimated !== undefined
      ? { usdEstimated: Math.max(0, a.usdEstimated - (b.usdEstimated ?? 0)) }
      : {}),
    ms: Math.max(0, a.ms - b.ms),
  }
}

/** The nodes of one run whose accounting is incomplete, in the vocabulary the supervisor already
 *  uses: `never-settled` = no terminal record, so every channel is unaccounted; `unreported` = a
 *  record landed with a channel the provider did not report, so that channel is a floor. */
function runSpendGaps(nodes: readonly MutableNode[]): SpendGap[] {
  const gaps: SpendGap[] = []
  for (const node of nodes) {
    const label = node.label
    if (node.status === 'running') {
      gaps.push({
        id: node.id,
        ...(label !== undefined ? { label } : {}),
        kind: 'never-settled',
        channels: ['tokens', 'usd'],
      })
      continue
    }
    const total = nodeTotal(node)
    const channels: SpendChannel[] = []
    if (total === undefined || total.tokensKnown === false) channels.push('tokens')
    if (total === undefined || total.usdKnown === false) channels.push('usd')
    if (channels.length === 0) continue
    gaps.push({
      id: node.id,
      ...(label !== undefined ? { label } : {}),
      kind: 'unreported',
      channels,
    })
  }
  return gaps
}

function usageOf(total: Spend, reasoning: number | undefined): PursuitNodeUsage {
  return {
    input: total.tokens.input,
    output: total.tokens.output,
    ...(total.tokens.cacheRead !== undefined ? { cacheRead: total.tokens.cacheRead } : {}),
    ...(total.tokens.cacheWrite !== undefined ? { cacheWrite: total.tokens.cacheWrite } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    tokensKnown: total.tokensKnown !== false && total.tokens.tokensKnown !== false,
  }
}

function costOf(total: Spend): PursuitNodeCost {
  const usdKnown = total.usdKnown !== false
  const estimated = total.usdEstimated
  const provenance: PursuitCostProvenance = usdKnown
    ? estimated === undefined || estimated === 0
      ? 'reported'
      : 'partial'
    : estimated === undefined
      ? 'unknown'
      : estimated >= total.usd
        ? 'estimated'
        : 'partial'
  return {
    usd: total.usd,
    usdKnown,
    ...(estimated !== undefined ? { usdEstimated: estimated } : {}),
    provenance,
  }
}

function timingOf(node: MutableNode): PursuitNodeTiming | undefined {
  if (node.startedAt === undefined) return undefined
  return {
    startedAt: node.startedAt,
    ...(node.firstOutputAt !== undefined ? { firstOutputAt: node.firstOutputAt } : {}),
    ...(node.firstTokenAt !== undefined ? { firstTokenAt: node.firstTokenAt } : {}),
    ...(node.settledAt !== undefined ? { settledAt: node.settledAt } : {}),
    ...(node.settledAt !== undefined
      ? { wallMs: Math.max(0, node.settledAt - node.startedAt) }
      : {}),
  }
}

function freezeRun(run: MutableRun, nodes: readonly MutableNode[]): PursuitRunProjection {
  const gaps = runSpendGaps(nodes)
  const { rootInference: _rootInference, ...rest } = run
  return Object.freeze({
    ...rest,
    targets: Object.freeze({ ...run.targets }),
    decisions: Object.freeze({ ...run.decisions }),
    totals: runTotals(run, nodes),
    ...(gaps.length > 0 ? { spendGaps: Object.freeze(gaps) } : {}),
  })
}

function freezeNode(node: MutableNode): PursuitNodeProjection {
  const { modelCalls, reasoningTokens, startedAt: _startedAt, ...rest } = node
  const total = nodeTotal(node)
  const timing = timingOf(node)
  return Object.freeze({
    ...rest,
    ...(modelCalls.length > 0 ? { modelCalls: Object.freeze([...modelCalls]) } : {}),
    ...(total !== undefined ? { usage: usageOf(total, reasoningTokens), cost: costOf(total) } : {}),
    ...(timing !== undefined ? { timing } : {}),
  })
}

function increment(
  target: Record<string, number>,
  key: RuntimeHookTarget | RuntimeDecisionKind,
): void {
  target[key] = (target[key] ?? 0) + 1
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Read a journaled `Spend` without trusting the wire: a record missing the conserved channels is
 *  not a zero-cost turn, it is an unparseable one, and it must not enter a total. */
function spendField(value: Record<string, unknown> | undefined, key: string): Spend | undefined {
  const field = objectRecord(value?.[key])
  if (!field) return undefined
  const tokens = objectRecord(field.tokens)
  if (typeof field.usd !== 'number' || !Number.isFinite(field.usd)) return undefined
  if (!tokens || typeof tokens.input !== 'number' || typeof tokens.output !== 'number') {
    return undefined
  }
  return cloneSpend(field as unknown as Spend)
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function numberField(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const field = value?.[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}

function booleanField(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const field = value?.[key]
  return typeof field === 'boolean' ? field : undefined
}
