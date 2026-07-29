/**
 * `supervisorAgent` — build a supervisor `Agent` FROM its profile. The brain is resolved from
 * `profile.harness` exactly as `createExecutor({ backend })` resolves a worker: backend-as-data,
 * no hand-built brain. The supervisor stops being special — it's one profile, materialized by the
 * same resolution rule as every other agent.
 *
 *  - `harness` omitted or `cli-base` → the in-process router tool-loop: `driverAgent` over the
 *    canonical `ToolLoopChat`, built by `routerBrain` from the profile's model + the router seam.
 *  - `harness` a coding CLI (`claude-code`/`opencode`/`codex`/…) → an EXTERNAL harness drives the
 *    coordination verbs: `serveCoordinationMcp` exposes spawn/await/steer/stop over the live scope,
 *    and the caller's `driveHarness` runs the harness with that MCP mounted. `supervise()` builds
 *    this automatically only for a local bridge; a remote sandbox needs an explicit reachable
 *    relay or tunnel. The harness IS the brain.
 *
 * Both arms spawn children through the SAME `makeWorkerAgent` seam and finalize through the SAME
 * seam (`runFinalizer` over DELIVERED children only — default keep-best, never the driver's own
 * prose).
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import type {
  AnalystRegistry,
  AuthorizeDownMessage,
  CoordinationEvent,
  MakeWorkerAgent,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import { coordinationVerbNames } from '../../mcp/tools/coordination'
import { type RouterConfig, routerBrain } from '../router-client'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import { driverAgent } from './coordination-driver'
import type { PriorCoordination } from './coordination-log'
import { serveCoordinationMcp } from './coordination-mcp'
import type { BusRecord } from './event-bus'
import { bestDelivered, runFinalizer, runTree, type SupervisorFinalizer } from './finalizer'
import { attestRuntimeOwnedScopeOwner, runtimeOwnedScopeOwnerRuntime } from './materialization'
import { detachedSnapshot } from './snapshot'
import type { StopRule } from './stop-rules'
import type { Agent, Budget, NodeExecutionIdentity, ResultBlobStore, Scope } from './types'

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

/** A supervisor is an ordinary, complete `AgentProfile` playing the supervisor role.
 *  Runtime policy (budget, concurrency, analysts, stop rules) stays in `SupervisorAgentDeps`; it is
 *  live execution state, not agent identity. An omitted harness or `cli-base` selects the in-process
 *  router brain; every other harness is materialized by `driveHarness`. */
export type SupervisorProfile = AgentProfile

/** Trusted run/node identity Runtime binds to one manager. Model-authored tool arguments cannot
 *  provide or replace any of these fields. */
export interface SupervisorNodeContext {
  readonly runId: string
  /** Stable across a durable restart; unique per in-memory invocation. */
  readonly runNamespace: string
  /** Concrete Scope node that owns this manager's coordination stream. */
  readonly nodeId: string
  /** Stable identity of this manager's coordination stream. */
  readonly ownerId: string
  readonly depth: number
  readonly identity: NodeExecutionIdentity
  /** Assignment identity within the parent manager; absent only for the root. */
  readonly assignmentId?: string
  readonly profile: SupervisorProfile
  readonly task: unknown
}

/** Context known before `Agent.act`; Runtime adds the concrete node, profile, and task. */
export type SupervisorNodeContextSeed = Omit<SupervisorNodeContext, 'nodeId' | 'profile' | 'task'>

/** One product-owned tool. It reuses the canonical MCP descriptor fields while Runtime supplies
 *  the trusted node context as a separate argument and binds the result for either transport. */
export interface SupervisorToolDescriptor extends Omit<McpToolDescriptor, 'handler'> {
  readonly handler: (raw: unknown, context: SupervisorNodeContext) => Promise<unknown>
}

/** Product policy for the tools one exact supervisor node may call. Resolved once per node. */
export type ResolveSupervisorTools = (
  context: SupervisorNodeContext,
) => ReadonlyArray<SupervisorToolDescriptor> | Promise<ReadonlyArray<SupervisorToolDescriptor>>

/** Context-aware observer used internally to bind product transactions to the actual live node. */
export type ObserveSupervisorNodeEvent = (
  context: SupervisorNodeContext,
  event: CoordinationEvent,
  record: BusRecord<CoordinationEvent>,
) => void | Promise<void>

/** How to run an external harness as the DRIVER, with the coordination verbs mounted — the substrate
 *  seam the caller supplies (mirrors `makeWorkerAgent` for spawned children). It runs `profile` on
 *  `task` in its backend (remote sandbox or local CLI bridge) with `coordinationMcpUrl` mounted as an MCP server,
 *  so the harness calls spawn_agent / await_event / stop as native tools over the live scope. */
export type DriveHarness = (args: {
  readonly profile: SupervisorProfile
  readonly task: unknown
  readonly scope: Scope<unknown>
  readonly coordinationMcpUrl: string
  /** Data-only product tool surface mounted on the coordination MCP. Runtime-owned drivers include
   *  this in their materialization evidence without persisting executable handlers. */
  readonly coordinationTools: ReadonlyArray<Omit<McpToolDescriptor, 'handler'>>
}) => Promise<void>

export interface SupervisorAgentDeps {
  readonly blobs: ResultBlobStore
  /** Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms). */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Product authorization for every down-leg continuation to a child. */
  readonly authorizeDownMessage?: AuthorizeDownMessage
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget
  /** Hard cap on simultaneously-LIVE workers across both arms — `spawn_agent` fails closed once
   *  this many are in flight (a concurrency fence on top of the conserved-pool fence; bounds live
   *  boxes/sandboxes, not total work). Omit/`<= 0` = no cap. */
  readonly maxLiveWorkers?: number
  /** Router substrate for a router-brained supervisor (`harness` omitted or `cli-base`). The
   *  profile's model wins. */
  readonly router?: RouterConfig
  /** Inject the brain directly (tests / advanced) instead of resolving `routerBrain` from the profile. */
  readonly brain?: ToolLoopChat
  /** Required to run an external-harness supervisor: runs the harness as the driver. */
  readonly driveHarness?: DriveHarness
  /** Trusted identity for this manager. Required with node-scoped tools or observation. */
  readonly nodeContext?: SupervisorNodeContextSeed
  /** Resolve product-owned tools for this exact manager. Static `extraTools` remain a router-only
   *  compatibility seam and deliberately receive no new recursive authority. */
  readonly resolveSupervisorTools?: ResolveSupervisorTools
  /** Awaited product observation, enriched with this manager's actual live node context. */
  readonly observeNodeEvent?: ObserveSupervisorNodeEvent
  /** Replay resume-time settlements through `observeNodeEvent` before the manager starts. */
  readonly replaySettlements?: boolean
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
  readonly onEvent?: (
    event: CoordinationEvent,
    record: BusRecord<CoordinationEvent>,
  ) => void | Promise<void>
  /** Questions, findings, and authorized continuation receipts loaded from a prior process.
   *  Router arm: questions seed the ledger and all evidence enters the resume brief. External arm:
   *  questions seed the ledger; receipts remain durable evidence and are never auto-delivered. */
  readonly priorCoordination?: PriorCoordination
  /** Deferred owner-scoped replay for a recursive supervisor. Its stable owner is known while the
   * parent authorizes the child, but loading remains asynchronous; Runtime calls this before the
   * nested brain can publish or act on coordination state. */
  readonly loadPriorCoordination?: () => Promise<PriorCoordination>
  /** How the settled ledger becomes the run's output (both arms). Default `bestDelivered` — the
   *  exact keep-best every existing caller had. Always runs under the delivered-only invariant. */
  readonly finalizer?: SupervisorFinalizer
}

/** Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness` (backend-as-data), the same resolution rule as every worker. */
export function supervisorAgent(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
): Agent<unknown, unknown> {
  const stableProfile = detachedSnapshot(profile, 'supervisorAgent profile')
  const resolveTools = deps.resolveSupervisorTools
  const observeNodeEvent = deps.observeNodeEvent
  const nodeContextSeed =
    deps.nodeContext === undefined
      ? undefined
      : detachedSnapshot(deps.nodeContext, 'supervisorAgent node context')
  if ((resolveTools || observeNodeEvent) && !nodeContextSeed) {
    throw new ValidationError(
      'supervisorAgent: nodeContext is required with resolveSupervisorTools or observeNodeEvent',
    )
  }
  const name = stableProfile.name ?? 'supervisor'
  const systemPrompt = [
    stableProfile.prompt?.systemPrompt ?? defaultSupervisorPrompt,
    ...(stableProfile.prompt?.instructions ?? []),
  ].join('\n')
  const harness =
    stableProfile.harness === undefined || stableProfile.harness === 'cli-base'
      ? null
      : stableProfile.harness

  if (harness !== null && deps.compaction) {
    throw new ValidationError(
      'supervisorAgent: compaction is only supported for router-brained supervisors (profile.harness omitted or cli-base)',
    )
  }

  if (harness === null) {
    // ROUTER arm: the in-process tool-loop. `routerBrain` is now an internal detail — the caller
    // passes a profile, not a hand-built brain (a test may still inject `deps.brain`).
    const brain = deps.brain ?? routerBrainFromProfile(stableProfile, deps)
    const build = (
      priorCoordination?: PriorCoordination,
      nodeTools?: ReadonlyArray<McpToolDescriptor>,
      onEvent?: SupervisorAgentDeps['onEvent'],
    ) =>
      driverAgent({
        name,
        brain,
        blobs: deps.blobs,
        makeWorkerAgent: deps.makeWorkerAgent,
        ...(deps.authorizeDownMessage ? { authorizeDownMessage: deps.authorizeDownMessage } : {}),
        perWorker: deps.perWorker,
        systemPrompt,
        ...(nodeTools?.length ? { nodeTools } : {}),
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
        ...(onEvent ? { onEvent } : {}),
        ...(deps.replaySettlements ? { replaySettlements: true } : {}),
        ...(priorCoordination ? { priorCoordination } : {}),
        ...(deps.finalizer ? { finalizer: deps.finalizer } : {}),
      })
    if (!deps.loadPriorCoordination && !resolveTools && !observeNodeEvent) {
      return build(deps.priorCoordination, undefined, deps.onEvent)
    }
    return {
      name,
      async act(task, scope) {
        const context = nodeContextSeed
          ? supervisorNodeContext(nodeContextSeed, stableProfile, task, scope)
          : undefined
        const priorCoordination = await deps.loadPriorCoordination?.()
        const nodeTools =
          resolveTools && context ? await bindSupervisorTools(resolveTools, context) : undefined
        const onEvent = bindSupervisorNodeObserver(context, observeNodeEvent, deps.onEvent)
        return build(priorCoordination, nodeTools, onEvent).act(task, scope)
      },
    }
  }

  // EXTERNAL arm: a caller-driven harness uses the coordination verbs over the live scope.
  const driveHarness = deps.driveHarness
  if (!driveHarness) {
    throw new ValidationError(
      `supervisorAgent: profile.harness="${harness}" needs deps.driveHarness (how to run the harness with the coordination MCP mounted)`,
    )
  }
  const externalAgent: Agent<unknown, unknown> = {
    name,
    async act(task, scope) {
      const context = nodeContextSeed
        ? supervisorNodeContext(nodeContextSeed, stableProfile, task, scope)
        : undefined
      const priorCoordination = deps.loadPriorCoordination
        ? await deps.loadPriorCoordination()
        : deps.priorCoordination
      const nodeTools =
        resolveTools && context ? await bindSupervisorTools(resolveTools, context) : undefined
      const onEvent = bindSupervisorNodeObserver(context, observeNodeEvent, deps.onEvent)
      const mcp = await serveCoordinationMcp({
        scope,
        blobs: deps.blobs,
        makeWorkerAgent: deps.makeWorkerAgent,
        ...(deps.authorizeDownMessage ? { authorizeDownMessage: deps.authorizeDownMessage } : {}),
        perWorker: deps.perWorker,
        ...(deps.maxLiveWorkers !== undefined ? { maxLiveWorkers: deps.maxLiveWorkers } : {}),
        ...(deps.analysts ? { analysts: deps.analysts } : {}),
        ...(deps.analyzeOnSettle ? { analyzeOnSettle: deps.analyzeOnSettle } : {}),
        ...(deps.watchWorkers ? { watchWorkers: deps.watchWorkers } : {}),
        ...(deps.stallAfterMs !== undefined ? { stallAfterMs: deps.stallAfterMs } : {}),
        ...(onEvent ? { onEvent } : {}),
        ...(deps.replaySettlements ? { replaySettlements: true } : {}),
        ...(priorCoordination?.questions.length
          ? { priorQuestions: priorCoordination.questions }
          : {}),
        ...(nodeTools?.length ? { nodeTools } : {}),
      })
      try {
        await driveHarness({
          profile: stableProfile,
          task,
          scope,
          coordinationMcpUrl: mcp.url,
          coordinationTools: (nodeTools ?? []).map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        })
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
  const runtime = runtimeOwnedScopeOwnerRuntime(driveHarness)
  return runtime === undefined
    ? externalAgent
    : attestRuntimeOwnedScopeOwner(externalAgent, runtime)
}

function supervisorNodeContext(
  seed: SupervisorNodeContextSeed,
  profile: SupervisorProfile,
  task: unknown,
  scope: Scope<unknown>,
): SupervisorNodeContext {
  return detachedSnapshot(
    { ...seed, nodeId: scope.view.root, profile, task },
    'supervisorAgent trusted node context',
  )
}

async function bindSupervisorTools(
  resolveTools: ResolveSupervisorTools,
  context: SupervisorNodeContext,
): Promise<ReadonlyArray<McpToolDescriptor>> {
  const resolved = await resolveTools(context)
  if (!Array.isArray(resolved)) {
    throw new ValidationError('supervisorAgent: resolveSupervisorTools must return an array')
  }
  const names = new Set<string>(coordinationVerbNames)
  return Object.freeze(
    resolved.map((rawTool, index) => {
      if (typeof rawTool !== 'object' || rawTool === null || Array.isArray(rawTool)) {
        throw new ValidationError(
          `supervisorAgent: resolved tool at index ${index} must be a descriptor`,
        )
      }
      const { name, description, inputSchema, handler } = rawTool
      if (typeof name !== 'string' || name.length === 0) {
        throw new ValidationError(
          `supervisorAgent: resolved tool at index ${index} needs a non-empty name`,
        )
      }
      if (names.has(name)) {
        throw new ValidationError(
          `supervisorAgent: resolved tool "${name}" collides with a coordination verb or another resolved tool`,
        )
      }
      names.add(name)
      if (typeof description !== 'string' || description.length === 0) {
        throw new ValidationError(`supervisorAgent: resolved tool "${name}" needs a description`)
      }
      if (typeof inputSchema !== 'object' || inputSchema === null || Array.isArray(inputSchema)) {
        throw new ValidationError(`supervisorAgent: resolved tool "${name}" needs an inputSchema`)
      }
      if (typeof handler !== 'function') {
        throw new ValidationError(`supervisorAgent: resolved tool "${name}" needs a handler`)
      }
      const descriptor = detachedSnapshot(
        { name, description, inputSchema },
        `supervisorAgent resolved tool ${JSON.stringify(name)}`,
      )
      return Object.freeze({
        ...descriptor,
        handler: (raw: unknown) =>
          handler(
            detachedSnapshot(raw, `supervisorAgent tool ${JSON.stringify(name)} input`),
            context,
          ),
      })
    }),
  )
}

function bindSupervisorNodeObserver(
  context: SupervisorNodeContext | undefined,
  observeNodeEvent: ObserveSupervisorNodeEvent | undefined,
  onEvent: SupervisorAgentDeps['onEvent'],
): SupervisorAgentDeps['onEvent'] {
  if (!observeNodeEvent && !onEvent) return undefined
  return async (event, record) => {
    if (observeNodeEvent) {
      if (!context) {
        throw new ValidationError('supervisorAgent: observeNodeEvent has no trusted node context')
      }
      await observeNodeEvent(context, event, record)
    }
    await onEvent?.(event, record)
  }
}

function routerBrainFromProfile(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
): ToolLoopChat {
  if (!deps.router) {
    throw new ValidationError(
      'supervisorAgent: a router-brained supervisor (harness omitted or cli-base) needs deps.router (or deps.brain)',
    )
  }
  return routerBrain({ ...deps.router, model: profile.model?.default ?? deps.router.model })
}
