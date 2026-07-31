/**
 * `supervise` — the one-call "just invoke the supervisor". Builds + runs a supervisor from its
 * profile with sensible defaults, so the common case is `supervise(profile, task, { backend, budget })`
 * instead of hand-wiring `blobs` / `perWorker` / `journal` / `executors` / `maxDepth`. The raw seams
 * (`supervisorAgent` + `createSupervisor().run`) stay available for power use.
 *
 * `workerFromBackend` derives the worker seam (`makeWorkerAgent`) from a backend config + an optional
 * completion oracle — so "where the workers run" is one data choice, not a hand-rolled factory.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  MakeWorkerAgent,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import { composeRuntimeHooks, type RuntimeHooks } from '../../runtime-hooks'
import type { RouterConfig } from '../router-client'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import type { SupervisorFinalizer } from './finalizer'
import { assertModelAllowed } from './model-policy'
import { createSupervisorSpanRecorder, type SupervisorSpanOptions } from './otel-spans'
import { createFileRunContext, createInMemoryRunContext } from './run-context'
import { createExecutor, type ExecutorConfig } from './runtime'
import type { StopRule } from './stop-rules'
import { createSupervisor } from './supervisor'
import {
  assertCoordinationBinding,
  type CoordinationBinding,
  type DriveHarness,
  resolveSupervisorModelId,
  type SupervisorProfile,
  supervisorAgent,
} from './supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  ExecutorContext,
  ResultBlobStore,
  SpawnJournal,
} from './types'
import type { WaitProbeRegistry } from './wait'

/** Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the
 *  deliverable check that makes "settled ⟺ delivered" true — the guard against "ran but didn't
 *  deliver"). The ONE place a backend becomes a spawnable worker. */
export function workerFromBackend(
  backend: ExecutorConfig,
  deliverable?: DeliverableSpec<unknown>,
): MakeWorkerAgent {
  return (rawProfile) => {
    const p = (rawProfile ?? {}) as { name?: unknown }
    const name = typeof p.name === 'string' && p.name.length > 0 ? p.name : 'worker'
    // harness:null — createExecutor(backend) carries the harness in its config (the sandbox case-arm
    // reads config.harness when the spec leaves it null); the BYO executor below resolves the leaf.
    const spec: AgentSpec = { profile: rawProfile as AgentProfile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const built = createExecutor(backend)(spec, ctx)
    const executor = deliverable ? gateOnDeliverable(built, deliverable) : built
    return { name, act: async () => '', executorSpec: { ...spec, executor } } as Agent<
      unknown,
      unknown
    > & { executorSpec: AgentSpec }
  }
}

/** A name→value table, in this package's resolver-port shape (the same one `WaitProbeRegistry`
 *  uses): construction stays the caller's, lookup stays lazy, and a table backed by a file, a
 *  plugin loader, or a plain object all satisfy one interface. */
export interface SuperviseRegistryTable<T> {
  resolve(name: string): T | undefined
}

/**
 * The name→value tables that make the four CODE-valued options expressible as run DATA.
 *
 * `deliverable` / `finalizer` / `analysts` / `probes` are functions and registries, so a recorded
 * run configuration (a JSON row, a campaign spec, a resumed run's options) cannot carry them — and
 * a run with no `deliverable` cannot return a `winner` at all outside the sandbox backend, because
 * the finalizer keeps only children whose oracle passed and nothing else writes that verdict. A
 * caller that owns the code registers it here once and names it from data thereafter.
 */
export interface SuperviseRegistry {
  readonly deliverables?: SuperviseRegistryTable<DeliverableSpec<unknown>>
  readonly finalizers?: SuperviseRegistryTable<SupervisorFinalizer>
  readonly analysts?: SuperviseRegistryTable<AnalystRegistry>
  readonly probes?: SuperviseRegistryTable<WaitProbeRegistry>
}

/** Which registry table each nameable option resolves against. Indexing this map inside
 *  {@link resolveNamed} makes the pairing a type error to get wrong: `resolveNamed('probes',
 *  'deliverables', …)` does not compile. */
interface SuperviseRegistryTableFor {
  readonly deliverable: 'deliverables'
  readonly finalizer: 'finalizers'
  readonly analysts: 'analysts'
  readonly probes: 'probes'
}

/** Resolve one option that may be given as a value OR as a name into `opts.registry`. Both failure
 *  modes name the option, the requested name, and the table it was looked up in — a typo must not
 *  degrade into a silently unconfigured run (which for `deliverable` means "no run can ever
 *  deliver"). A resolver port cannot enumerate its names, so the message names the table instead of
 *  listing what was in it. */
function resolveNamed<K extends keyof SuperviseRegistryTableFor, T extends object>(
  option: K,
  table: SuperviseRegistryTableFor[K],
  value: T | string | undefined,
  registry: SuperviseRegistryTable<T> | undefined,
): T | undefined {
  if (typeof value !== 'string') return value
  if (!registry) {
    throw new ConfigError(
      `supervise: opts.${option} = ${JSON.stringify(value)} names a registry entry, but no ` +
        `opts.registry.${table} was provided to resolve it against`,
    )
  }
  const entry = registry.resolve(value)
  if (entry === undefined) {
    throw new ConfigError(
      `supervise: opts.${option} = ${JSON.stringify(value)} is not in opts.registry.${table} — ` +
        'the table resolved no entry under that name',
    )
  }
  return entry
}

export interface SuperviseOptions {
  /** The conserved compute pool for the whole run. */
  readonly budget: Budget
  /** WHERE workers run — derives the worker seam. Provide this OR an explicit `makeWorkerAgent`. */
  readonly backend?: ExecutorConfig
  /** The independent completion check for backend-derived workers and direct supervisor
   *  submissions. Strongly recommended: without it the supervisor cannot submit its own work and
   *  backend-derived workers fall back to their own validity signal. A `string` names an entry in
   *  `registry.deliverables`. */
  readonly deliverable?: DeliverableSpec<unknown> | string
  /** Name→value tables for the four code-valued options, so a recorded run configuration can name
   *  them instead of carrying closures. See {@link SuperviseRegistry}. */
  readonly registry?: SuperviseRegistry
  /** Where the coordination MCP binds when the supervisor is harness-driven. Omit = an ephemeral
   *  port on `127.0.0.1`, which an off-host root cannot reach. A non-loopback host is refused
   *  unless `allowUnauthenticatedRemote` acknowledges that the verbs are unauthenticated. */
  readonly coordination?: CoordinationBinding
  /** Override the worker seam directly (tests / advanced) instead of deriving it from `backend`. */
  readonly makeWorkerAgent?: MakeWorkerAgent
  /** The supervisor's router substrate (`harness` null). The profile's model wins. */
  readonly router?: RouterConfig
  /** Inject the supervisor brain directly (tests / advanced). */
  readonly brain?: ToolLoopChat
  /** Run a sandboxed-harness supervisor (`harness` set). */
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
  /** Hard cap on simultaneously-LIVE workers — `spawn_agent` fails closed once this many are in
   *  flight. The conserved pool bounds TOTAL work; this bounds SIMULTANEOUS work (live boxes/
   *  sandboxes a real fleet runs at once). Omit/`<= 0` = no cap (the pool stays the only fence). */
  readonly maxLiveWorkers?: number
  /** Analyst lenses available to the driver. Required for `analyzeOnSettle`. Unset → status quo
   *  (the driver receives settled worker outputs, no analyst findings). A `string` names an entry in
   *  `registry.analysts`. */
  readonly analysts?: AnalystRegistry | string
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
   *  the driver pulls (`await_event`) and composes its next steer from. The self-improving UP-leg,
   *  threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
   *  Omit/empty = status quo (no analyst feed). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string>
  /**
   * Watch every worker's LIVE tool trace with the online detector panel and raise a `finding` the
   * moment one loops or error-storms — so the supervisor learns it mid-run (via `await_event`)
   * instead of at settle. Pairs with a steerable worker: the finding is the evidence, `steer_agent`
   * is the correction. Requires a backend whose executor exposes a trace source (the steerable
   * sandbox worker and the pi wrapper do); other runtimes are simply not watched.
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
   * Make the run DURABLE: journal + result blobs + the coordination side-log are file-backed under
   * this directory (`createFileRunContext`), fsynced per write, and the supervisor reads the prior
   * tree first. Re-running with the same `runDir` AND the same `runId` resumes, and the built-in
   * driver is resume-AWARE out of the box: the children that already settled are replayed onto
   * `Scope.resume` (and into the driver's settled ledger + its first context), keyed assignments
   * (`spawn_agent`'s `key`) resolve to their committed results instead of re-running, pending
   * waits re-arm on their original deadlines, prior questions/findings replay from the
   * coordination log, and the finalize spans both processes' work. Unset = in-memory, fresh
   * every call.
   *
   * The boundary that remains: work that was IN FLIGHT when the process died is not recovered —
   * the built-in executors cannot re-attach to a dead process's executions, so those assignments
   * resume as explicitly lost/in-doubt and re-run (reported, never silent).
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
   *  refused `unknown-probe` and `timer` waits still work. A `string` names an entry in
   *  `registry.probes`. */
  readonly probes?: WaitProbeRegistry | string
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
   *  supervisor router model, the profile's model, and the backend's model — must be a member,
   *  or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted. */
  readonly allowedModels?: readonly string[]
  /** How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
   *  highest-scoring DELIVERED child (the exact behavior every existing caller had). Alternatives:
   *  `collectDelivered` (every verified distinct output with provenance — a Pareto set / recorded
   *  disagreement) or a custom `SupervisorFinalizer`. Whatever the finalizer, it operates on
   *  structurally DELIVERED outputs only — an undelivered or invalid child stays ineligible. A
   *  `string` names an entry in `registry.finalizers`. */
  readonly finalizer?: SupervisorFinalizer | string
  /** Lifecycle observers for the whole recursive tree (`Scope` re-seeds them into every nested
   *  scope). Composed with the `otel` recorder below when both are set. Omit = no observers, which
   *  is the behavior every existing caller has. */
  readonly hooks?: RuntimeHooks
  /**
   * OPT-IN OTLP tracing: emit one span per supervised node (opened at spawn, closed at settle,
   * parented to its parent node's span) plus an `LLM` child span per metered driver turn, so the
   * tree is readable by any trace viewer instead of only by a journal parser. See `otel-spans.ts`.
   *
   * Omit and the run emits nothing, allocates no recorder, and installs no hook — telemetry is
   * never a default. Present with no reachable endpoint (no `exportConfig.endpoint` and no
   * `OTEL_EXPORTER_OTLP_ENDPOINT`) is also a no-op. The spawn journal is untouched either way:
   * spans are telemetry, never the replay/resume record.
   */
  readonly otel?: Omit<SupervisorSpanOptions, 'runId' | 'now'>
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
  // Fail loud before any compute: every configured model must be in the allowed subset (no-op
  // when allowedModels is unset). The backend seam carries its own model on most backends. The
  // profile's model is checked as the RESOLVED id, so a canonical AgentProfile's `model.default`
  // is subject to the same policy a plain string model is.
  const backendModel = (opts.backend as { model?: unknown } | undefined)?.model
  assertModelAllowed(opts.router?.model, opts.allowedModels)
  assertModelAllowed(resolveSupervisorModelId(profile), opts.allowedModels)
  assertModelAllowed(
    typeof backendModel === 'string' ? backendModel : undefined,
    opts.allowedModels,
  )

  // Named options become values before anything is built or spent — an unknown name is a
  // configuration fault, and a fault that surfaces after a run started has already cost budget.
  const deliverable = resolveNamed(
    'deliverable',
    'deliverables',
    opts.deliverable,
    opts.registry?.deliverables,
  )
  const finalizer = resolveNamed(
    'finalizer',
    'finalizers',
    opts.finalizer,
    opts.registry?.finalizers,
  )
  const analysts = resolveNamed('analysts', 'analysts', opts.analysts, opts.registry?.analysts)
  const probes = resolveNamed('probes', 'probes', opts.probes, opts.registry?.probes)
  assertCoordinationBinding(opts.coordination)

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
    if (!opts.backend) {
      throw new ValidationError(
        'supervise: provide opts.backend (where workers run) or opts.makeWorkerAgent',
      )
    }
    makeWorkerAgent = workerFromBackend(opts.backend, deliverable)
  }
  const workerFactory = makeWorkerAgent

  const runId = opts.runId ?? 'supervise'
  const log = ctx.coordinationLog
  const now = opts.now ?? Date.now

  // Every configuration fault above throws SYNCHRONOUSLY — a caller that guards with
  // `expect(() => supervise(...)).toThrow` still sees the throw, and no compute starts. Only the
  // durable coordination replay needs to await, so the run begins inside this closure.
  const start = async () => {
    // The durable coordination side-log (file contexts only): replay the prior process's questions
    // and findings into the driver, and append this process's as they publish — so a resumed run
    // keeps the coordination context the spawn journal does not record.
    const priorCoordination = log ? await log.load(runId) : undefined

    const agent = supervisorAgent(profile, {
      blobs,
      makeWorkerAgent: workerFactory,
      perWorker,
      ...(deliverable ? { deliverable } : {}),
      ...(log ? { onEvent: (ev) => log.append(runId, ev, new Date(now()).toISOString()) } : {}),
      ...(priorCoordination &&
      (priorCoordination.questions.length > 0 || priorCoordination.findings.length > 0)
        ? { priorCoordination }
        : {}),
      ...(finalizer ? { finalizer } : {}),
      ...(opts.coordination ? { coordination: opts.coordination } : {}),
      ...(opts.maxLiveWorkers !== undefined ? { maxLiveWorkers: opts.maxLiveWorkers } : {}),
      ...(opts.router ? { router: opts.router } : {}),
      ...(opts.brain ? { brain: opts.brain } : {}),
      ...(opts.driveHarness ? { driveHarness: opts.driveHarness } : {}),
      ...(opts.extraTools ? { extraTools: opts.extraTools } : {}),
      ...(opts.executeExtraTool ? { executeExtraTool: opts.executeExtraTool } : {}),
      ...(analysts ? { analysts } : {}),
      ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
      ...(opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {}),
      ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
      ...(opts.stopRule ? { stopRule: opts.stopRule } : {}),
      ...(opts.onProgressStop ? { onProgressStop: opts.onProgressStop } : {}),
      ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
      ...(opts.compaction ? { compaction: opts.compaction } : {}),
    })

    // Built ONLY when `otel` is configured AND an exporter resolves, so the default path allocates
    // nothing and passes no `hooks` at all — byte-for-byte the wiring every existing caller gets.
    const spans = opts.otel ? createSupervisorSpanRecorder({ runId, ...opts.otel, now }) : undefined
    const hooks = spans ? composeRuntimeHooks(opts.hooks, spans.hooks) : opts.hooks

    const run = createSupervisor<unknown, unknown>().run(agent, task, {
      budget: opts.budget,
      runId,
      journal: opts.journal ?? ctx.journal,
      blobs,
      executors: ctx.executors,
      maxDepth: opts.maxDepth ?? 8,
      ...(probes ? { probes } : {}),
      ...(ctx.resume === true ? { resume: true } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      ...(hooks ? { hooks } : {}),
    })
    if (!spans) return run
    // The recorder closes the root span on BOTH exits and never rethrows, so tracing can neither
    // change the result nor swallow the run's own rejection.
    try {
      const result = await run
      await spans.finish({ result })
      return result
    } catch (error) {
      await spans.finish({ error })
      throw error
    }
  }

  return start()
}
