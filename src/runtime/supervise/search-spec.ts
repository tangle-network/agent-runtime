/**
 * SearchSpec: one data value for a multi-agent research configuration, and the compiler that maps
 * it onto exactly one existing call, `supervise(profile, task, options)` or `runGraph(graph,
 * options)`. The design record is `docs/design/search-spec.md`.
 *
 * Nothing here runs anything. The compiler only chooses options those two calls already take, so
 * the control loop, the budget, the check, the continuation and the journal stay theirs. A spec is
 * plain data with a canonical digest; the compiled call records that digest on the run's root as
 * `execution.correlation.searchSpecDigest`, which the journal's root registration and the settle
 * record's tree both carry, so two runs can be compared as the same design on two problems.
 *
 * Every axis value compiles to an option, or to a refusal before any compute. An axis value the
 * compiled call would not read is refused rather than recorded, because a digest that names a knob
 * which changes nothing would make two different runs look like one design.
 */

import {
  type AgentProfile,
  canonicalCandidateDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { AnalystRegistry } from '../../mcp/tools/coordination-analysts'
import type { SuperviseProfileEntry } from '../../mcp/tools/coordination-contracts'
import { harnessRunsAgent } from '../harness-role'
import type { SharedBoxPlacement } from '../shared-box'
import type { ToolLoopChat } from '../tool-loop'
import type { DeliverableSpec } from './completion-gate'
import type { ContinuationPolicy } from './continuation'
import type { AgentGraph, RunGraphOptions } from './graph'
import type { PromptRegistry } from './prompt-registry'
import { coordinationProfileToolPrefix } from './provider-visible-profile'
import type { ExecutorConfig } from './runtime'
import type { SuperviseOptions, SuperviseRegistry } from './supervise'
import type { Budget } from './types'

/**
 * One multi-agent research configuration: seven orthogonal axes, all data.
 *
 * | Axis | Compiles to |
 * |---|---|
 * | `state` | always `harness`: the journal, Knowledge and checkpoints hold research state |
 * | `context` | `continuation.session` |
 * | `select` | the call: `lead`, `advisor`, `self` → `supervise`; `code` → `runGraph({ brain })`; `fixed` → `runGraph` |
 * | `workers` | `workerSlots`, `allowedModels`, the worker backend's shared placement |
 * | `comms` | `peerMail` for `messages` |
 * | `evaluate` | `continuation.failures`, `continuation.bar`, `analysts` + `analyzeOnSettle` |
 * | `stop` | `continuation.maxBarren`, `stopRule` |
 */
export interface SearchSpec {
  /** Where research state lives. `harness` is the only value: memory that lives only in a harness
   *  conversation cannot be checkpointed, inspected or ablated. */
  readonly state: 'harness'
  /** What a re-entered root's harness session holds. `fresh`: a new session per re-entry whose only
   *  input is Runtime's full re-entry task. `native`: the same session wherever the backend proves it. */
  readonly context: 'fresh' | 'native'
  /**
   * Who decides the next work. `lead`: the root does work and may spawn. `advisor`: the root only
   * assigns, sees each epoch fresh, and its workers are leaves. `self`: a convener starts the peers
   * and the peers divide the work by messages. `code`: the caller's brain drives the root in
   * process. `fixed`: a static graph.
   */
  readonly select: 'lead' | 'advisor' | 'code' | 'self' | 'fixed'
  readonly workers: {
    /** Agents working at once below the root (`workerSlots`); 0 runs the root alone. For `self`,
     *  the number of peers. */
    readonly count: number
    /** Model ids the run may use (`allowedModels`); the root's model must be among them. */
    readonly models?: ReadonlyArray<string>
    /** `isolated`: every worker has its own environment. `shared`: workers may share boxes
     *  through the provider backend's shared placement. */
    readonly isolation: 'isolated' | 'shared'
  }
  /** Channels between agents. `none`: no workers. `assignments`: briefs down and results up.
   *  `messages`: assignments plus worker-to-worker peer mail. */
  readonly comms: 'none' | 'assignments' | 'messages'
  readonly evaluate: {
    /** Whether a continuation note carries the check's FAIL lines (`continuation.failures`). */
    readonly feedback: 'verbatim' | 'off'
    /** Whether a continuation note states the bar (`continuation.bar`). */
    readonly bar: 'on' | 'off'
    /** Analyst kinds run on every settled worker (`analyzeOnSettle`). */
    readonly analysts?: ReadonlyArray<string>
  }
  readonly stop: {
    /** Re-entered turns in a row without progress before the run ends (`continuation.maxBarren`). */
    readonly maxBarren: number
    /** End the run when a window of settlements lifts the best score by no more than `minDelta`. */
    readonly plateau?: { readonly window: number; readonly minDelta: number }
  }
}

/** The correlation key the compiled call records the spec's digest under. Runtime writes it; a
 *  caller that supplies it is refused. */
export const SEARCH_SPEC_CORRELATION_KEY = 'searchSpecDigest'

const SPAWN_GRANT = `${coordinationProfileToolPrefix}spawn_worker`

function refuse(message: string): never {
  throw new ValidationError(`SearchSpec: ${message}`)
}

const quoted = (values: ReadonlyArray<string>): string => values.map((v) => `'${v}'`).join(', ')

function record(
  value: unknown,
  where: string,
  required: ReadonlyArray<string>,
  optional: ReadonlyArray<string> = [],
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`${where} must be an object`)
  }
  const fields = value as Readonly<Record<string, unknown>>
  const known = new Set([...required, ...optional])
  const unknown = Object.keys(fields).filter((key) => !known.has(key))
  if (unknown.length > 0) {
    refuse(
      `${where} has unknown ${unknown.length === 1 ? 'key' : 'keys'} ${quoted(unknown)}; it takes ${quoted([...required, ...optional])}`,
    )
  }
  const missing = required.filter((key) => fields[key] === undefined)
  if (missing.length > 0) refuse(`${where} is missing ${quoted(missing)}`)
  return fields
}

function oneOf<T extends string>(value: unknown, where: string, values: ReadonlyArray<T>): T {
  if (typeof value === 'string' && (values as ReadonlyArray<string>).includes(value)) {
    return value as T
  }
  return refuse(`${where} is ${JSON.stringify(value)}; it must be one of ${quoted(values)}`)
}

function names(value: unknown, where: string): ReadonlyArray<string> {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string' && item.trim() !== '')
  ) {
    refuse(`${where} must be a non-empty list of non-empty strings`)
  }
  const list = value as string[]
  if (new Set(list).size !== list.length) refuse(`${where} lists a name twice`)
  return Object.freeze([...list].sort())
}

function integer(value: unknown, where: string, min: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    refuse(`${where} must be an integer >= ${min}`)
  }
  return value as number
}

/**
 * Check a spec and return its canonical frozen form: every axis present, no unknown key, no
 * contradictory pair of values. Lists are sorted, so two specs that mean the same digest the same.
 */
export function assertSearchSpec(spec: unknown): SearchSpec {
  const axes = ['state', 'context', 'select', 'workers', 'comms', 'evaluate', 'stop'] as const
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    refuse(
      'a spec must be an object with the axes state, context, select, workers, comms, evaluate and stop',
    )
  }
  const top = spec as Readonly<Record<string, unknown>>
  const unknownAxes = Object.keys(top).filter(
    (key) => !(axes as ReadonlyArray<string>).includes(key),
  )
  if (unknownAxes.length > 0) {
    refuse(`unknown axis ${quoted(unknownAxes)}; the axes are ${quoted(axes)}`)
  }
  const missingAxes = axes.filter((axis) => top[axis] === undefined)
  if (missingAxes.length > 0) refuse(`axis ${quoted(missingAxes)} is missing`)

  if (top.state === 'conversation') {
    refuse(
      "state 'conversation' is not a value: research memory that lives only in a harness " +
        'conversation cannot be checkpointed, inspected or ablated; it is always harness',
    )
  }
  const state = oneOf(top.state, 'state', ['harness'] as const)
  const context = oneOf(top.context, 'context', ['fresh', 'native'] as const)
  const select = oneOf(top.select, 'select', ['lead', 'advisor', 'code', 'self', 'fixed'] as const)
  const workersIn = record(top.workers, 'workers', ['count', 'isolation'], ['models'])
  const count = integer(workersIn.count, 'workers.count', 0)
  const isolation = oneOf(workersIn.isolation, 'workers.isolation', ['isolated', 'shared'] as const)
  const models =
    workersIn.models === undefined ? undefined : names(workersIn.models, 'workers.models')
  const comms = oneOf(top.comms, 'comms', ['none', 'assignments', 'messages'] as const)
  const evaluateIn = record(top.evaluate, 'evaluate', ['feedback', 'bar'], ['analysts'])
  const feedback = oneOf(evaluateIn.feedback, 'evaluate.feedback', ['verbatim', 'off'] as const)
  const bar = oneOf(evaluateIn.bar, 'evaluate.bar', ['on', 'off'] as const)
  const analysts =
    evaluateIn.analysts === undefined ? undefined : names(evaluateIn.analysts, 'evaluate.analysts')
  const stopIn = record(top.stop, 'stop', ['maxBarren'], ['plateau'])
  const maxBarren = integer(stopIn.maxBarren, 'stop.maxBarren', 1)
  let plateau: { readonly window: number; readonly minDelta: number } | undefined
  if (stopIn.plateau !== undefined) {
    const plateauIn = record(stopIn.plateau, 'stop.plateau', ['window', 'minDelta'])
    const minDelta = plateauIn.minDelta
    if (typeof minDelta !== 'number' || !Number.isFinite(minDelta) || minDelta < 0) {
      refuse('stop.plateau.minDelta must be a finite number >= 0')
    }
    plateau = Object.freeze({
      window: integer(plateauIn.window, 'stop.plateau.window', 1),
      minDelta,
    })
  }

  // Contradictory pairs, each refused with what would have gone wrong.
  if (select === 'advisor' && context === 'native') {
    refuse(
      "select 'advisor' sees each epoch only through the coordinator's projection, so it needs " +
        "context 'fresh'; with 'native' its earlier turns would stay in its context",
    )
  }
  if (select === 'code' && context === 'fresh') {
    refuse(
      "select 'code' runs the root in your brain, in process; it has no harness session for " +
        "context 'fresh' to renew",
    )
  }
  if (select === 'advisor' && count === 0) {
    refuse("select 'advisor' only assigns work, so workers.count must be at least 1")
  }
  if (count === 0 && comms !== 'none') {
    refuse(`workers.count 0 runs the root alone, so comms must be 'none', not '${comms}'`)
  }
  if (count > 0 && comms === 'none') {
    refuse(
      `comms 'none' leaves ${count} worker(s) with no channel; use 'assignments' or 'messages'`,
    )
  }
  if (comms === 'messages' && count < 2) {
    refuse(
      `comms 'messages' needs at least two peers to message each other; workers.count is ${count}`,
    )
  }
  if (select === 'self' && comms !== 'messages') {
    refuse(
      "select 'self' lets the peers divide the work by messages, so comms must be 'messages'; " +
        "use select 'fixed' for independent attempts",
    )
  }
  if (count === 0 && isolation === 'shared') {
    refuse("workers.isolation 'shared' places workers in shared boxes, and workers.count is 0")
  }
  if (count === 0 && models !== undefined) {
    refuse('workers.models lists the models workers may use, and workers.count is 0')
  }

  return Object.freeze({
    state,
    context,
    select,
    workers: Object.freeze({ count, ...(models === undefined ? {} : { models }), isolation }),
    comms,
    evaluate: Object.freeze({ feedback, bar, ...(analysts === undefined ? {} : { analysts }) }),
    stop: Object.freeze({ maxBarren, ...(plateau === undefined ? {} : { plateau }) }),
  })
}

/** The canonical digest of a spec: equal for two specs that mean the same, different otherwise. */
export function searchSpecDigest(spec: SearchSpec): Sha256Digest {
  return canonicalCandidateDigest({
    kind: 'agent-runtime.search-spec.v1',
    spec: assertSearchSpec(spec),
  })
}

const presetEvaluate = Object.freeze({ feedback: 'verbatim', bar: 'off' } as const)
// The continuation's measured value: repair loses most of its effect within two or three
// attempts, and a fresh start at the same budget scored higher (`ContinuationPolicy.maxBarren`).
const presetStop = Object.freeze({ maxBarren: 2 } as const)

/**
 * The five configurations Runtime ships, as specs. Each is an ordinary spec: its digest is its
 * value's, and a consumer that changes any axis passes an inline spec with its own digest.
 */
export const searchPresets = Object.freeze({
  /** One root alone in one session. */
  solo: (): SearchSpec =>
    assertSearchSpec({
      state: 'harness',
      context: 'native',
      select: 'lead',
      workers: { count: 0, isolation: 'isolated' },
      comms: 'none',
      evaluate: presetEvaluate,
      stop: presetStop,
    }),
  /** A doing lead with up to `width` workers at once, each in its own environment; any of them
   *  may lead its own team within the same bound. */
  tree: (width: number): SearchSpec =>
    assertSearchSpec({
      state: 'harness',
      context: 'native',
      select: 'lead',
      workers: { count: width, isolation: 'isolated' },
      comms: 'assignments',
      evaluate: presetEvaluate,
      stop: presetStop,
    }),
  /** A doing lead with up to `width` workers at once that may share boxes. */
  swarm: (width: number): SearchSpec =>
    assertSearchSpec({
      state: 'harness',
      context: 'native',
      select: 'lead',
      workers: { count: width, isolation: 'shared' },
      comms: 'assignments',
      evaluate: presetEvaluate,
      stop: presetStop,
    }),
  /** `count` peers started by a convener, dividing the work by peer mail. */
  peers: (count: number): SearchSpec =>
    assertSearchSpec({
      state: 'harness',
      context: 'native',
      select: 'self',
      workers: { count, isolation: 'isolated' },
      comms: 'messages',
      evaluate: presetEvaluate,
      stop: presetStop,
    }),
  /** Stateless Language Agents (arXiv 2610.07625): an assign-only advisor re-entered fresh every
   *  epoch from the coordinator's projection, over `width` isolated leaf workers. */
  sla: (width: number): SearchSpec =>
    assertSearchSpec({
      state: 'harness',
      context: 'fresh',
      select: 'advisor',
      workers: { count: width, isolation: 'isolated' },
      comms: 'assignments',
      evaluate: presetEvaluate,
      stop: presetStop,
    }),
})

/** A `SuperviseOptions` key that an axis or a typed input decides. */
export type SearchSpecOwnedOption =
  | 'budget'
  | 'deliverable'
  | 'continuation'
  | 'workerSlots'
  | 'allowedModels'
  | 'peerMail'
  | 'analysts'
  | 'analyzeOnSettle'
  | 'stopRule'
  | 'maxDepth'
  | 'inheritSpawnRights'

/** The `SuperviseOptions` an axis decides. A caller value for one is refused, naming the axis. */
const ownedBy: Readonly<Record<SearchSpecOwnedOption, string>> = Object.freeze({
  budget: 'inputs.budget',
  deliverable: 'inputs.deliverable',
  continuation: 'context, evaluate, stop and inputs.continuation',
  workerSlots: 'workers.count',
  allowedModels: 'workers.models',
  peerMail: "comms 'messages'",
  analysts: 'inputs.analysts',
  analyzeOnSettle: 'evaluate.analysts',
  stopRule: 'stop.plateau',
  maxDepth: "select 'advisor'",
  inheritSpawnRights: "select 'advisor'",
})

/** Everything a compiled call needs besides the spec: the problem, its bounds, and the call's
 *  other options. */
export interface SearchSpecInputs {
  /** The root, for select `lead`, `advisor` and `self`: the lead, the advisor, or the convener
   *  that starts the peers. A graph's root is its own node. */
  readonly profile?: AgentProfile
  /** The root's task, for the same three selects. A graph's task is its deliverable's description. */
  readonly task?: unknown
  /** select `code` and `fixed`: the graph's nodes and edges. The compiler adds the deliverable and
   *  the budget. */
  readonly graph?: Pick<AgentGraph, 'nodes' | 'edges'>
  /** select `code`: the caller's brain that makes every root call (`RunGraphOptions.brain`). */
  readonly brain?: ToolLoopChat
  readonly budget: Budget
  /** The completion check. Every spec's run has one: the continuation is sent back by it. */
  readonly deliverable: DeliverableSpec<unknown>
  /** No re-entry starts at or after this instant (epoch ms or ISO 8601). It is the run's time
   *  bound, not design, so two runs of one spec share a digest. */
  readonly deadline: number | string
  /** The continuation note's words, and the problem's reference result for `evaluate.bar: 'on'`. */
  readonly continuation: Pick<ContinuationPolicy, 'profile' | 'reference' | 'append'>
  /** Profiles the root spawns by name (`registry.profiles`). For select `self`, the peers:
   *  exactly `workers.count` of them. */
  readonly workers?: ReadonlyArray<AgentProfile | SuperviseProfileEntry>
  /** The registry `evaluate.analysts` names kinds in; a graph's lens analysts resolve against it. */
  readonly analysts?: AnalystRegistry
  /** `workers.isolation: 'shared'`: the shared-box pool the provider backend places workers in. */
  readonly sharedPlacement?: SharedBoxPlacement
  /** select `code` and `fixed`: the directive registry the graph's edges name
   *  (`RunGraphOptions.registry`). */
  readonly directives?: PromptRegistry
  /** Every other option of the call, unchanged: `backend`, `driverBackend`, `coordination`,
   *  `runDir`, `journal`, `runId`, `makeLeafAgent`, `driveHarness`, and the rest. */
  readonly options?: Omit<SuperviseOptions, SearchSpecOwnedOption>
}

/** The one call a spec compiles to, with every option inspectable before spend. */
export type CompiledSearchSpec =
  | {
      readonly call: 'supervise'
      readonly spec: SearchSpec
      readonly digest: Sha256Digest
      readonly profile: AgentProfile
      readonly task: unknown
      readonly options: SuperviseOptions
    }
  | {
      readonly call: 'runGraph'
      readonly spec: SearchSpec
      readonly digest: Sha256Digest
      readonly graph: AgentGraph
      readonly options: RunGraphOptions
    }

function grantsSpawn(profile: AgentProfile): boolean {
  return profile.tools?.[SPAWN_GRANT] === true
}

function profileTable(
  entries: ReadonlyArray<AgentProfile | SuperviseProfileEntry>,
): NonNullable<SuperviseRegistry['profiles']> {
  const table = new Map<string, SuperviseProfileEntry>()
  for (const item of entries) {
    const entry: SuperviseProfileEntry = 'profile' in item ? item : { profile: item }
    const name = entry.profile.name
    if (typeof name !== 'string' || name.trim() === '') {
      refuse('every profile in inputs.workers needs a name, which the root spawns it by')
    }
    if (table.has(name)) refuse(`inputs.workers names profile '${name}' twice`)
    table.set(name, entry)
  }
  const listed = Object.freeze([...table.keys()])
  return Object.freeze({ resolve: (name: string) => table.get(name), names: () => listed })
}

/** The worker backend with the spec's placement, refusing a placement the spec contradicts. */
function placedBackend(spec: SearchSpec, inputs: SearchSpecInputs): ExecutorConfig | undefined {
  const backend = inputs.options?.backend
  const sharedAlready = backend?.backend === 'provider' && backend.shared !== undefined
  if (spec.workers.isolation === 'isolated') {
    if (inputs.sharedPlacement !== undefined || sharedAlready) {
      refuse(
        "workers.isolation 'isolated' gives every worker its own environment; drop the shared " +
          "placement or use isolation 'shared'",
      )
    }
    return backend
  }
  if (inputs.sharedPlacement === undefined) return backend
  if (backend?.backend !== 'provider') {
    refuse(
      "inputs.sharedPlacement places workers through a 'provider' backend; options.backend is " +
        `${backend === undefined ? 'absent' : `'${backend.backend}'`}`,
    )
  }
  if (sharedAlready) refuse('options.backend already carries a shared placement; pass it once')
  return Object.freeze({ ...backend, shared: inputs.sharedPlacement })
}

/** The one root of a graph: the node that delegates and is never delegated to. */
function graphRoot(graph: Pick<AgentGraph, 'nodes' | 'edges'>): AgentProfile | undefined {
  const delegates = graph.edges.filter((edge) => edge.kind === 'delegates')
  const targets = new Set(delegates.map((edge) => edge.to))
  const roots = [...new Set(delegates.map((edge) => edge.from))].filter((id) => !targets.has(id))
  return roots.length === 1 ? graph.nodes.find((node) => node.id === roots[0])?.profile : undefined
}

/**
 * Compile a spec onto exactly one existing call. Every refusal names the axis or input and what
 * would have gone wrong, and happens before any compute.
 *
 * ```ts
 * const compiled = compileSearchSpec(searchPresets.sla(3), { profile, task, budget, deliverable,
 *   deadline, continuation: { profile: words }, workers, options: { backend, coordination, runDir } })
 * const result = compiled.call === 'supervise'
 *   ? await supervise(compiled.profile, compiled.task, compiled.options)
 *   : (await runGraph(compiled.graph, compiled.options)).result
 * ```
 */
export function compileSearchSpec(raw: SearchSpec, inputs: SearchSpecInputs): CompiledSearchSpec {
  const spec = assertSearchSpec(raw)
  const digest = searchSpecDigest(spec)
  const passed: Omit<SuperviseOptions, SearchSpecOwnedOption> = inputs.options ?? {}
  for (const [key, axis] of Object.entries(ownedBy)) {
    if ((passed as Readonly<Record<string, unknown>>)[key] !== undefined) {
      refuse(`options.${key} is decided by ${axis}; change the spec or that input instead`)
    }
  }
  if (inputs.deliverable === undefined) {
    refuse('inputs.deliverable is required: a spec run is sent back by its check')
  }
  const correlation = passed.execution?.correlation ?? {}
  if (Object.hasOwn(correlation, SEARCH_SPEC_CORRELATION_KEY)) {
    refuse(
      `options.execution.correlation cannot set ${SEARCH_SPEC_CORRELATION_KEY}; Runtime records it`,
    )
  }
  const execution = Object.freeze({
    ...passed.execution,
    correlation: Object.freeze({ ...correlation, [SEARCH_SPEC_CORRELATION_KEY]: digest }),
  })
  const continuation: ContinuationPolicy = {
    deadline: inputs.deadline,
    maxBarren: spec.stop.maxBarren,
    profile: inputs.continuation.profile,
    failures: spec.evaluate.feedback,
    panel: 'off',
    bar: spec.evaluate.bar,
    session: spec.context,
    ...(inputs.continuation.reference === undefined
      ? {}
      : { reference: inputs.continuation.reference }),
    ...(inputs.continuation.append === undefined ? {} : { append: inputs.continuation.append }),
  }
  const backend = placedBackend(spec, inputs)
  const callerOwnsLeaves =
    passed.makeLeafAgent !== undefined || passed.makeWorkerAgent !== undefined
  if (
    spec.comms === 'messages' &&
    backend !== undefined &&
    backend.backend !== 'bridge' &&
    backend.backend !== 'provider' &&
    !callerOwnsLeaves
  ) {
    refuse(
      `comms 'messages' needs workers that can call peer mail: Runtime mounts it on 'bridge' or capable 'provider' ` +
        `workers, and '${backend.backend}' workers run no client for it. Run the workers on a ` +
        'bridge, or mount WorkerSpawnContext.peerMailUrl through makeLeafAgent',
    )
  }
  const analystKinds = spec.evaluate.analysts ?? []
  if (analystKinds.length > 0 && inputs.analysts === undefined) {
    refuse(
      'evaluate.analysts names analyst kinds, and inputs.analysts holds no registry to run them',
    )
  }
  const axisOptions = {
    continuation,
    execution,
    ...(spec.workers.count > 0 ? { workerSlots: spec.workers.count } : {}),
    ...(spec.workers.models === undefined ? {} : { allowedModels: spec.workers.models }),
    ...(spec.comms === 'messages' ? { peerMail: true } : {}),
    ...(spec.stop.plateau === undefined ? {} : { stopRule: { plateau: spec.stop.plateau } }),
    ...(backend === undefined ? {} : { backend }),
  } as const

  if (spec.select === 'code' || spec.select === 'fixed') {
    const graph = inputs.graph ?? refuse(`select '${spec.select}' needs inputs.graph`)
    if (inputs.profile !== undefined || inputs.task !== undefined) {
      refuse(
        `select '${spec.select}' runs inputs.graph, whose root is its own node and whose task is ` +
          "the deliverable's description; drop inputs.profile and inputs.task",
      )
    }
    if (inputs.workers !== undefined) {
      refuse(`select '${spec.select}' spawns the graph's nodes; drop inputs.workers`)
    }
    if (analystKinds.length > 0) {
      refuse(
        `select '${spec.select}' declares a graph's analysts as analyzes edges, not evaluate.analysts`,
      )
    }
    if (spec.workers.count === 0) {
      refuse(
        `select '${spec.select}' runs a graph's worker nodes, so workers.count must be at least 1`,
      )
    }
    if (spec.select === 'code' && inputs.brain === undefined) {
      refuse("select 'code' needs inputs.brain, the caller's brain that drives the root")
    }
    if (spec.select === 'fixed' && inputs.brain !== undefined) {
      refuse("select 'fixed' runs the graph's root profile; a brain is select 'code'")
    }
    if (passed.registry !== undefined) {
      refuse(
        "options.registry is supervise's name table, which a graph cannot read; pass the " +
          "graph's directive registry as inputs.directives",
      )
    }
    if (spec.context === 'fresh' && !harnessRunsAgent(graphRoot(graph)?.harness)) {
      refuse(
        "context 'fresh' renews an external harness root's session at each re-entry, and the " +
          "graph's root runs on the router brain",
      )
    }
    return Object.freeze({
      call: 'runGraph',
      spec,
      digest,
      graph: Object.freeze({
        nodes: graph.nodes,
        edges: graph.edges,
        deliverable: inputs.deliverable,
        budget: inputs.budget,
      }),
      options: Object.freeze({
        // runGraph refuses, by name, any passed option a graph decides itself.
        ...(passed as unknown as RunGraphOptions),
        ...axisOptions,
        ...(inputs.brain === undefined ? {} : { brain: inputs.brain }),
        ...(inputs.analysts === undefined ? {} : { analysts: inputs.analysts }),
        ...(inputs.directives === undefined ? {} : { registry: inputs.directives }),
      }),
    })
  }

  const profile = inputs.profile ?? refuse(`select '${spec.select}' needs inputs.profile, the root`)
  if (inputs.task === undefined) refuse(`select '${spec.select}' needs inputs.task`)
  if (inputs.graph !== undefined || inputs.brain !== undefined || inputs.directives !== undefined) {
    refuse(
      `select '${spec.select}' runs inputs.profile; a graph, brain or directives is select 'code' or 'fixed'`,
    )
  }
  if (!harnessRunsAgent(profile.harness)) {
    refuse(
      `select '${spec.select}' runs the root under Runtime's continuation (context, evaluate and ` +
        `stop), which drives an external harness; profile '${profile.name}' runs on the router ` +
        "brain. Give it a harness such as claude-code or codex, or use select 'code'",
    )
  }
  if (spec.workers.count === 0 && grantsSpawn(profile)) {
    refuse(
      `workers.count 0 runs the root alone, but profile '${profile.name}' grants ${SPAWN_GRANT}`,
    )
  }
  if (spec.workers.count > 0 && !grantsSpawn(profile)) {
    refuse(
      `workers.count ${spec.workers.count} needs a root that spawns, and profile '${profile.name}' ` +
        `does not grant ${SPAWN_GRANT}`,
    )
  }
  if (spec.select === 'self' && inputs.workers?.length !== spec.workers.count) {
    refuse(
      `select 'self' starts exactly workers.count peers; inputs.workers holds ` +
        `${inputs.workers?.length ?? 0}, and workers.count is ${spec.workers.count}`,
    )
  }
  if (inputs.workers !== undefined && passed.registry?.profiles !== undefined) {
    refuse(
      'inputs.workers and options.registry.profiles both name spawnable profiles; pass them once',
    )
  }
  const registry =
    inputs.workers === undefined
      ? passed.registry
      : Object.freeze({ ...passed.registry, profiles: profileTable(inputs.workers) })
  return Object.freeze({
    call: 'supervise',
    spec,
    digest,
    profile,
    task: inputs.task,
    options: Object.freeze({
      ...passed,
      ...axisOptions,
      budget: inputs.budget,
      deliverable: inputs.deliverable,
      ...(registry === undefined ? {} : { registry }),
      ...(inputs.analysts === undefined ? {} : { analysts: inputs.analysts }),
      ...(analystKinds.length > 0 ? { analyzeOnSettle: analystKinds } : {}),
      // The advisor's assignments are the run's only selection: its workers are leaves.
      ...(spec.select === 'advisor' ? { maxDepth: 1, inheritSpawnRights: false } : {}),
    }),
  })
}
