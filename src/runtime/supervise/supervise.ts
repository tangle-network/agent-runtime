/**
 * `supervise` — the one-call "just invoke the supervisor". Builds + runs a supervisor from its
 * profile with sensible defaults, so the common case is
 * `supervise(profile, task, { worker: { provider }, budget })`.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  MakeWorkerAgent,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import { resolveAgentEnvironmentProvider } from '../environment-provider'
import type { RouterConfig } from '../router-client'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import { assertModelAllowed } from './model-policy'
import { createFileRunContext, createInMemoryRunContext } from './run-context'
import { type EnvironmentWorkerOptions, environmentExecutor } from './runtime'
import type { StopRule } from './stop-rules'
import { createSupervisor } from './supervisor'
import { type DriveHarness, type SupervisorProfile, supervisorAgent } from './supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorContext,
  ResultBlobStore,
  SpawnJournal,
} from './types'
import type { WaitProbeRegistry } from './wait'

/** Build workers from the environment provider used for each spawned profile. */
export function workerFromEnvironment(
  options: EnvironmentWorkerOptions,
  deliverable?: DeliverableSpec<unknown>,
): MakeWorkerAgent {
  const provider = resolveAgentEnvironmentProvider(options.provider, options.registry)
  return workerFromExecutor((profile, context) => {
    const spec: AgentSpec = { profile, harness: null }
    return environmentExecutor(provider, options)(spec, context)
  }, deliverable)
}

/** Build workers from a custom executor factory. */
export function workerFromExecutor(
  create: (profile: AgentProfile, context: ExecutorContext) => Executor<unknown>,
  deliverable?: DeliverableSpec<unknown>,
): MakeWorkerAgent {
  return (rawProfile) => {
    const p = (rawProfile ?? {}) as { name?: unknown }
    const name = typeof p.name === 'string' && p.name.length > 0 ? p.name : 'worker'
    const spec: AgentSpec = { profile: rawProfile as AgentProfile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const built = create(spec.profile, ctx)
    const executor = deliverable ? gateOnDeliverable(built, deliverable) : built
    return { name, act: async () => '', executorSpec: { ...spec, executor } } as Agent<
      unknown,
      unknown
    > & { executorSpec: AgentSpec }
  }
}

export interface SuperviseOptions {
  /** The conserved compute pool for the whole run. */
  readonly budget: Budget
  /** Environment provider and creation options used by spawned workers. */
  readonly worker?: EnvironmentWorkerOptions
  /** The completion check for provider-backed workers. Strongly recommended:
   *  without it the supervisor trusts a worker's self-report — exactly the "ran but didn't deliver"
   *  failure mode of a static orchestrator. */
  readonly deliverable?: DeliverableSpec<unknown>
  /** Override worker construction for tests or custom executors. */
  readonly makeWorkerAgent?: MakeWorkerAgent
  /** Router connection for an in-process supervisor (`harness` null). The profile's model wins. */
  readonly router?: RouterConfig
  /** Inject the supervisor brain directly (tests / advanced). */
  readonly brain?: ToolLoopChat
  /** Run the supervisor through a coding-harness driver. */
  readonly driveHarness?: DriveHarness
  /** WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
   *  itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
   *  `executeExtraTool`. Router arm only (`harness` null). */
  readonly extraTools?: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly parameters: Record<string, unknown>
  }>
  /** Runs an `extraTools` call; null/undefined falls through to the coordination dispatch. */
  readonly executeExtraTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string | null | undefined>
  /** Per-child budget reserved on each spawn. Defaults to a quarter of the pool's tokens. */
  readonly perWorker?: Budget
  /** Hard cap on simultaneously live workers. The conserved pool bounds total
   *  work; this bounds concurrently active provider environments. */
  readonly maxLiveWorkers?: number
  /** Analyst lenses available to the driver. Required for `analyzeOnSettle`. Unset → status quo
   *  (the driver receives settled worker outputs, no analyst findings). */
  readonly analysts?: AnalystRegistry
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
   *  the driver pulls (`await_event`) and composes its next steer from. The self-improving UP-leg,
   *  threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
   *  Omit/empty = status quo (no analyst feed). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string>
  /**
   * Watch every worker's LIVE tool trace with the online detector panel and raise a `finding` the
   * moment one loops or error-storms — so the supervisor learns it mid-run (via `await_event`)
   * instead of at settle. Pairs with a steerable worker: the finding is the evidence, `steer_agent`
   * is the correction. Requires a worker implementation that exposes a trace source; the
   * steerable provider worker and the pi wrapper do, while other runtimes are not watched.
   *
   * Omit = off (status quo — no online watching, no extra events).
   */
  readonly watchWorkers?: WorkerWatchOptions
  /** Idle time after which `observe_agent` reports a running worker as `stalled`. A derived read
   *  at observation time — nothing is killed or retried. Omit = the runtime default. */
  readonly stallAfterMs?: number
  /** Worker output store. Defaults to in-memory. */
  readonly blobs?: ResultBlobStore
  /**
   * Make the run DURABLE: journal + result blobs are file-backed under this directory
   * (`createFileRunContext`), fsynced per write, and the supervisor reads the prior tree first.
   * Re-running with the same `runDir` AND the same `runId` resumes — the children that already
   * settled are replayed onto `Scope.resume` with their real outputs, and the scope's counters
   * continue past the journaled maxima. Unset = in-memory, fresh every call.
   *
   * What that does and does not buy you, precisely: the run's history survives the process and is
   * replayable, and a resumed run never corrupts the tree. It does NOT by itself make the built-in
   * supervisor brain skip committed work — `supervisorAgent`'s driver does not read
   * `Scope.resume`, so out of the box a resumed run re-spawns children it already paid for. Only a
   * root `Agent.act` that reads `scope.resume.settled` (as the durable-resume test's root does)
   * turns durability into work-skipping. Wiring that into the default brain is separate work.
   *
   * `runId` matters here: it defaults to the constant `'supervise'`, which is fine for a single
   * resumable run per directory but collides across concurrent runs sharing one `runDir`.
   */
  readonly runDir?: string
  /** Override the spawn journal directly (advanced; `runDir` is the ordinary durable path). Pair
   *  with `blobs` — a journal whose result payloads live in a different store cannot replay. */
  readonly journal?: SpawnJournal
  /** Predicate registry for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so the
   *  wait survives a restart; this is what the name resolves against. Unset ⇒ `poll` waits are
   *  refused `unknown-probe` and `timer` waits still work. */
  readonly probes?: WaitProbeRegistry
  /**
   * PROGRESS-derived stop rule (router-brained supervisor). Ends a run that has stopped LEARNING
   * before it exhausts a ceiling — the answer to "a run should end because it is done or stuck,
   * not because it ran out". It composes with the budget guards and can never override one.
   *
   * Build it from `supervise/stop-rules`: `plateau({window, minDelta})`,
   * `noProgressFor({ms, settles})`, `allWorkersStalled({...})`, combined with `anyOf`/`allOf`. The
   * thresholds are policy and stay with you; the enforcement lives in the runtime. Omit = ceilings
   * only (unchanged behavior).
   */
  readonly stopRule?: StopRule
  /** One-shot notification of WHY a `stopRule` ended the run — so a caller records the reason
   *  instead of inferring an early stop from an unexhausted budget. */
  readonly onProgressStop?: (reason: string) => void
  readonly maxDepth?: number
  readonly maxTurns?: number
  /** Give the supervisor brain a chapter-lifecycle on its OWN context window (router arm only): once
   *  its coordination transcript exceeds `thresholdTokens` it distills to a compact progress note and
   *  continues, instead of re-billing the whole transcript every turn (the cost that makes the LLM-brain
   *  front door lose to a dumb-Ralph respawn). The live `Scope` roster is the durable state across
   *  chapters. Default off. `distill` defaults to a brain self-summary + the settled-worker roster. */
  readonly compaction?: ToolLoopCompactionOptions
  readonly runId?: string
  readonly now?: () => number
  /** Restrict the run to this subset of models. When set, every configured model — the
   *  supervisor router model, the profile's model, and the worker's model must be a member,
   *  or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted. */
  readonly allowedModels?: readonly string[]
}

/** A quarter of the token pool per worker → ~4 workers fit before `poolStarved` halts spawning. */
function defaultPerWorker(budget: Budget): Budget {
  return {
    maxIterations: budget.maxIterations,
    maxTokens: Math.max(1, Math.floor(budget.maxTokens / 4)),
  }
}

/** One-call supervisor: build + run a supervisor from its profile with sensible defaults; the raw `supervisorAgent` + `createSupervisor().run` seams stay available for power use. */
export function supervise(profile: SupervisorProfile, task: unknown, opts: SuperviseOptions) {
  assertModelAllowed(opts.router?.model, opts.allowedModels)
  assertModelAllowed(profile.model, opts.allowedModels)

  // `withDriver: true` is the wiring invariant either way (a `role: 'driver'` child must resolve
  // to the nested-scope executor); `runDir` only changes WHERE the journal and blobs live.
  const ctx =
    opts.runDir !== undefined
      ? createFileRunContext(opts.runDir, { withDriver: true })
      : createInMemoryRunContext({ withDriver: true })
  const blobs = opts.blobs ?? ctx.blobs
  const perWorker = opts.perWorker ?? defaultPerWorker(opts.budget)

  let makeWorkerAgent = opts.makeWorkerAgent
  if (!makeWorkerAgent) {
    if (!opts.worker) {
      throw new ValidationError('supervise: provide opts.worker or opts.makeWorkerAgent')
    }
    makeWorkerAgent = workerFromEnvironment(opts.worker, opts.deliverable)
  }
  const buildWorker = makeWorkerAgent
  makeWorkerAgent = (rawProfile) => {
    const workerModel = (rawProfile as AgentProfile | undefined)?.model?.default
    assertModelAllowed(workerModel, opts.allowedModels)
    return buildWorker(rawProfile)
  }

  const agent = supervisorAgent(profile, {
    blobs,
    makeWorkerAgent,
    perWorker,
    ...(opts.maxLiveWorkers !== undefined ? { maxLiveWorkers: opts.maxLiveWorkers } : {}),
    ...(opts.router ? { router: opts.router } : {}),
    ...(opts.brain ? { brain: opts.brain } : {}),
    ...(opts.driveHarness ? { driveHarness: opts.driveHarness } : {}),
    ...(opts.extraTools ? { extraTools: opts.extraTools } : {}),
    ...(opts.executeExtraTool ? { executeExtraTool: opts.executeExtraTool } : {}),
    ...(opts.analysts ? { analysts: opts.analysts } : {}),
    ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
    ...(opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {}),
    ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
    ...(opts.stopRule ? { stopRule: opts.stopRule } : {}),
    ...(opts.onProgressStop ? { onProgressStop: opts.onProgressStop } : {}),
    ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
    ...(opts.compaction ? { compaction: opts.compaction } : {}),
  })

  return createSupervisor<unknown, unknown>().run(agent, task, {
    budget: opts.budget,
    runId: opts.runId ?? 'supervise',
    journal: opts.journal ?? ctx.journal,
    blobs,
    executors: ctx.executors,
    maxDepth: opts.maxDepth ?? 8,
    ...(opts.probes ? { probes: opts.probes } : {}),
    ...(ctx.resume === true ? { resume: true } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  })
}
