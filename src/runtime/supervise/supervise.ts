/**
 * `supervise` — the one-call "just invoke the supervisor". Builds + runs a supervisor from its
 * profile with sensible defaults, so the common case is `supervise(profile, task, { backend, budget })`
 * instead of hand-wiring `blobs` / `perWorker` / `journal` / `executors` / `maxDepth`. The raw seams
 * (`supervisorAgent` + `createSupervisor().run`) stay available for power use.
 *
 * `workerFromBackend` derives the worker seam (`makeWorkerAgent`) from a backend config + an optional
 * completion oracle — so "where the workers run" is one data choice, not a hand-rolled factory.
 */
import type { AgentProfile } from '@tangle-network/sandbox'
import { ValidationError } from '../../errors'
import type { AnalystRegistry, MakeWorkerAgent } from '../../mcp/tools/coordination'
import type { RouterConfig } from '../router-client'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import { assertModelAllowed } from './model-policy'
import { createFileRunContext, createInMemoryRunContext } from './run-context'
import { createExecutor, type ExecutorConfig } from './runtime'
import { createSupervisor } from './supervisor'
import { type DriveHarness, type SupervisorProfile, supervisorAgent } from './supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  ExecutorContext,
  ResultBlobStore,
  SpawnJournal,
} from './types'

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

export interface SuperviseOptions {
  /** The conserved compute pool for the whole run. */
  readonly budget: Budget
  /** WHERE workers run — derives the worker seam. Provide this OR an explicit `makeWorkerAgent`. */
  readonly backend?: ExecutorConfig
  /** The completion oracle for backend-derived workers (settled ⟺ delivered). Strongly recommended:
   *  without it the supervisor trusts a worker's self-report — exactly the "ran but didn't deliver"
   *  failure mode of a static orchestrator. */
  readonly deliverable?: DeliverableSpec<unknown>
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
   *  (the driver receives settled worker outputs, no analyst findings). */
  readonly analysts?: AnalystRegistry
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
   *  the driver pulls (`await_event`) and composes its next steer from. The self-improving UP-leg,
   *  threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
   *  Omit/empty = status quo (no analyst feed). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string>
  /** Worker output store. Defaults to in-memory. */
  readonly blobs?: ResultBlobStore
  /**
   * Make the run DURABLE and RESUMABLE: journal + result blobs are file-backed under this
   * directory (`createFileRunContext`), and the supervisor reads the prior tree first. Re-running
   * `supervise()` with the same `runDir` AND the same `runId` resumes — the children that already
   * settled come back on `Scope.resume` instead of being re-executed. Unset = in-memory, fresh
   * every call (the default every existing caller gets).
   *
   * `runId` matters here: it defaults to the constant `'supervise'`, which is fine for a single
   * resumable run per directory but collides across concurrent runs sharing one `runDir`.
   */
  readonly runDir?: string
  /** Override the spawn journal directly (advanced; `runDir` is the ordinary durable path). Pair
   *  with `blobs` — a journal whose result payloads live in a different store cannot replay. */
  readonly journal?: SpawnJournal
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
  // when allowedModels is unset). The backend seam carries its own model on most backends.
  const backendModel = (opts.backend as { model?: unknown } | undefined)?.model
  assertModelAllowed(opts.router?.model, opts.allowedModels)
  assertModelAllowed(profile.model, opts.allowedModels)
  assertModelAllowed(
    typeof backendModel === 'string' ? backendModel : undefined,
    opts.allowedModels,
  )

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
    makeWorkerAgent = workerFromBackend(opts.backend, opts.deliverable)
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
    ...(ctx.resume === true ? { resume: true } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  })
}
