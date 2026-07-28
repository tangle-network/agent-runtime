/**
 * `supervisorAgent` — build a supervisor `Agent` FROM its profile. The brain is resolved from
 * `profile.harness` exactly as `createExecutor({ backend })` resolves a worker: backend-as-data,
 * no hand-built brain. The supervisor stops being special — it's one profile, materialized by the
 * same resolution rule as every other agent.
 *
 *  - `harness` null/undefined → the in-process router tool-loop: `driverAgent` over the
 *    canonical `ToolLoopChat`, built by `routerBrain` from the profile's model + the router seam.
 *  - `harness` a coding CLI (`claude-code`/`opencode`/`codex`/…) → a SANDBOXED harness drives the
 *    coordination verbs: `serveCoordinationMcp` exposes spawn/await/steer/stop over the live scope,
 *    and the caller's `driveHarness` runs the harness with that MCP mounted. The harness IS the brain.
 *
 * Both arms spawn children through the SAME `makeWorkerAgent` seam and finalize through the SAME
 * seam (`runFinalizer` over DELIVERED children only — default keep-best, never the driver's own
 * prose).
 */
import { ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  CoordinationEvent,
  MakeWorkerAgent,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import { type RouterConfig, routerBrain } from '../router-client'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import { driverAgent } from './coordination-driver'
import type { PriorCoordination } from './coordination-log'
import { serveCoordinationMcp } from './coordination-mcp'
import { bestDelivered, runFinalizer, runTree, type SupervisorFinalizer } from './finalizer'
import type { StopRule } from './stop-rules'
import type { Agent, Budget, ResultBlobStore, Scope } from './types'

/** The standing strategy a router-brained supervisor runs with when its profile names no
 *  `systemPrompt`. The brain's competence IS this prompt: without it the brain has the coordination
 *  verbs but no policy for WHEN to use them, and either over-spawns or stalls. A profile may override
 *  it for a specific topology. */
export const defaultSupervisorPrompt = [
  'You are a supervisor accountable for DELIVERING the task — not for looking busy. You succeed only',
  'when the deliverable is actually produced and verified, never on a worker reporting "done".',
  '',
  'Spawning a worker spends the shared, conserved budget — so delegate with intent, not by reflex:',
  '- Do small, sequential work YOURSELF when you have work tools; spawn a worker when a sub-task is',
  '  large, independent (parallelizable), or needs a clean context the current one has filled.',
  '- Prefer the FEWEST workers that deliver. Over-spawning burns the budget and rarely helps.',
  '',
  'Manage the context lifecycle on long work: give each spawned worker a BOUNDED brief — the specific',
  'sub-task plus only the interfaces/state it needs — never your whole history. When one chapter is',
  'done, distill what the next chapter needs and spawn fresh, rather than steering one worker until',
  'its context fills and degrades.',
  '',
  'Wait on real signals (await a settle, answer a blocking question), integrate the result, and stop',
  'as soon as the deliverable is met.',
].join('\n')

/** The supervisor's profile — the subset of an `AgentProfile` that selects + shapes its brain.
 *  `harness` is the backend-as-data discriminant; `systemPrompt` is the standing instruction. */
export interface SupervisorProfile {
  readonly name?: string
  /** null/undefined → router brain (in-process tool-loop); a coding-CLI harness → sandboxed brain. */
  readonly harness?: string | null
  /** The router model when the brain is router-driven (falls back to the deps router config). */
  readonly model?: string
  /** The standing instructions ("you delegate, you do not solve"). */
  readonly systemPrompt?: string
}

/** How to run a sandboxed harness as the DRIVER, with the coordination verbs mounted — the substrate
 *  seam the caller supplies (mirrors `makeWorkerAgent` for spawned children). It runs `profile` on
 *  `task` in its backend (sandbox / cli-bridge) with `coordinationMcpUrl` mounted as an MCP server,
 *  so the harness calls spawn_agent / await_event / stop as native tools over the live scope. */
export type DriveHarness = (args: {
  readonly profile: SupervisorProfile
  readonly task: unknown
  readonly scope: Scope<unknown>
  readonly coordinationMcpUrl: string
}) => Promise<void>

export interface SupervisorAgentDeps {
  readonly blobs: ResultBlobStore
  /** Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms). */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget
  /** Hard cap on simultaneously-LIVE workers across both arms — `spawn_agent` fails closed once
   *  this many are in flight (a concurrency fence on top of the conserved-pool fence; bounds live
   *  boxes/sandboxes, not total work). Omit/`<= 0` = no cap. */
  readonly maxLiveWorkers?: number
  /** Router substrate for a router-brained supervisor (`harness` null). The profile's model wins. */
  readonly router?: RouterConfig
  /** Inject the brain directly (tests / advanced) instead of resolving `routerBrain` from the profile. */
  readonly brain?: ToolLoopChat
  /** Required for a sandboxed-harness supervisor (`harness` set): runs the harness as the driver. */
  readonly driveHarness?: DriveHarness
  /** WORK tools the supervisor may call DIRECTLY (router arm) — so it can do simple work ITSELF and
   *  only delegate when it needs parallelism. Pair with `executeExtraTool`. */
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
  /** Analyst lenses available to the driver (both arms). Required for `analyzeOnSettle`. */
  readonly analysts?: AnalystRegistry
  /** Analyst kinds run on each worker-settle → a `finding` the driver composes its next steer from
   *  (the self-improving UP-leg). Unset/empty = status quo (no analyst feed). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string>
  /** Run the ONLINE detector panel over each worker's LIVE tool trace (both arms) so the driver
   *  learns a worker is looping mid-run instead of at settle. Omit = no online watching. */
  readonly watchWorkers?: WorkerWatchOptions
  /** Idle time after which `observe_agent` reports a worker as stalled. Omit = runtime default. */
  readonly stallAfterMs?: number
  /** PROGRESS-derived stop rule (router arm). Ends a run that has stopped learning BEFORE it
   *  exhausts a ceiling; it can never keep a run alive past one. Build it with `plateau` /
   *  `noProgressFor` / `allWorkersStalled` from `supervise/stop-rules` — the thresholds are the
   *  caller's judgment. Omit = ceilings only. */
  readonly stopRule?: StopRule
  /** One-shot notification of WHY a `stopRule` ended the run. */
  readonly onProgressStop?: (reason: string) => void
  readonly maxTurns?: number
  /** Give the supervisor brain a chapter-lifecycle on its OWN context window (router arm only) — it
   *  distills its coordination transcript to a compact progress note once it exceeds the threshold,
   *  instead of re-billing the whole thing every turn. See `DriverAgentOptions.compaction`. */
  readonly compaction?: ToolLoopCompactionOptions
  /** Pass-through subscriber for every coordination bus event (both arms) — the seam a durable
   *  caller hooks its coordination log onto. */
  readonly onEvent?: (event: CoordinationEvent) => void | Promise<void>
  /** Questions + findings replayed from a prior process of this run (a durable coordination log).
   *  Router arm: seeds the question ledger + the resume brief. Sandbox arm: seeds the ledger. */
  readonly priorCoordination?: PriorCoordination
  /** How the settled ledger becomes the run's output (both arms). Default `bestDelivered` — the
   *  exact keep-best every existing caller had. Always runs under the delivered-only invariant. */
  readonly finalizer?: SupervisorFinalizer
}

/** Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness` (backend-as-data), the same resolution rule as every worker. */
export function supervisorAgent(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
): Agent<unknown, unknown> {
  const name = profile.name ?? 'supervisor'
  const systemPrompt = profile.systemPrompt ?? defaultSupervisorPrompt
  const harness = profile.harness ?? null

  if (harness !== null && deps.compaction) {
    throw new ValidationError(
      'supervisorAgent: compaction is only supported for router-brained supervisors (profile.harness null)',
    )
  }

  if (harness === null) {
    // ROUTER arm: the in-process tool-loop. `routerBrain` is now an internal detail — the caller
    // passes a profile, not a hand-built brain (a test may still inject `deps.brain`).
    const brain = deps.brain ?? routerBrainFromProfile(profile, deps)
    return driverAgent({
      name,
      brain,
      blobs: deps.blobs,
      makeWorkerAgent: deps.makeWorkerAgent,
      perWorker: deps.perWorker,
      systemPrompt,
      ...(deps.maxLiveWorkers !== undefined ? { maxLiveWorkers: deps.maxLiveWorkers } : {}),
      ...(deps.extraTools ? { extraTools: deps.extraTools } : {}),
      ...(deps.executeExtraTool ? { executeExtraTool: deps.executeExtraTool } : {}),
      ...(deps.analysts ? { analysts: deps.analysts } : {}),
      ...(deps.analyzeOnSettle ? { analyzeOnSettle: deps.analyzeOnSettle } : {}),
      ...(deps.watchWorkers ? { watchWorkers: deps.watchWorkers } : {}),
      ...(deps.stallAfterMs !== undefined ? { stallAfterMs: deps.stallAfterMs } : {}),
      ...(deps.stopRule ? { stopRule: deps.stopRule } : {}),
      ...(deps.onProgressStop ? { onProgressStop: deps.onProgressStop } : {}),
      ...(deps.maxTurns !== undefined ? { maxTurns: deps.maxTurns } : {}),
      ...(deps.compaction ? { compaction: deps.compaction } : {}),
      ...(deps.onEvent ? { onEvent: deps.onEvent } : {}),
      ...(deps.priorCoordination ? { priorCoordination: deps.priorCoordination } : {}),
      ...(deps.finalizer ? { finalizer: deps.finalizer } : {}),
    })
  }

  // SANDBOX arm: a sandboxed harness drives the coordination verbs over the live scope.
  const driveHarness = deps.driveHarness
  if (!driveHarness) {
    throw new ValidationError(
      `supervisorAgent: profile.harness="${harness}" needs deps.driveHarness (how to run the harness with the coordination MCP mounted)`,
    )
  }
  return {
    name,
    async act(task, scope) {
      const mcp = await serveCoordinationMcp({
        scope,
        blobs: deps.blobs,
        makeWorkerAgent: deps.makeWorkerAgent,
        perWorker: deps.perWorker,
        ...(deps.maxLiveWorkers !== undefined ? { maxLiveWorkers: deps.maxLiveWorkers } : {}),
        ...(deps.analysts ? { analysts: deps.analysts } : {}),
        ...(deps.analyzeOnSettle ? { analyzeOnSettle: deps.analyzeOnSettle } : {}),
        ...(deps.watchWorkers ? { watchWorkers: deps.watchWorkers } : {}),
        ...(deps.stallAfterMs !== undefined ? { stallAfterMs: deps.stallAfterMs } : {}),
        ...(deps.onEvent ? { onEvent: deps.onEvent } : {}),
        ...(deps.priorCoordination?.questions.length
          ? { priorQuestions: deps.priorCoordination.questions }
          : {}),
      })
      try {
        await driveHarness({ profile, task, scope, coordinationMcpUrl: mcp.url })
        // Drain settled-but-unpulled children first — a gate-verified delivery the harness never
        // awaited must still reach the finalize ledger.
        await mcp.drainResolved()
        // The deliverable comes from the finalizer seam over DELIVERED children only — never the
        // harness's own output (Foreman 0/18). Default keep-best.
        return await runFinalizer(deps.finalizer ?? bestDelivered, {
          settled: mcp.settled(),
          blobs: deps.blobs,
          tree: runTree(scope),
          budget: scope.budget,
        })
      } finally {
        await mcp.close()
      }
    },
  }
}

function routerBrainFromProfile(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
): ToolLoopChat {
  if (!deps.router) {
    throw new ValidationError(
      'supervisorAgent: a router-brained supervisor (harness null) needs deps.router (or deps.brain)',
    )
  }
  return routerBrain({ ...deps.router, model: profile.model ?? deps.router.model })
}
