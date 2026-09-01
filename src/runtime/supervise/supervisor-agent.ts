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
 * Both arms spawn children through the SAME `makeWorkerAgent` seam and apply the SAME independent
 * deliverable check to direct submissions. Raw driver prose is never eligible.
 */
import {
  type AgentProfile,
  type AgentProfileResources,
  agentProfileSchema,
} from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import type {
  AnalystRegistry,
  AnalyzeOnSettleRoute,
  AuthorizeDownMessage,
  ContinuityMode,
  CoordinationEvent,
  MakeWorkerAgent,
  SpawnPreflight,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import { coordinationVerbNames } from '../../mcp/tools/coordination'
import { agentHarness } from '../harness-role'
import { type RouterTransportConfig, routerBrain } from '../router-client'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import type { DeliverableSpec } from './completion-gate'
import { driverAgent } from './coordination-driver'
import type { PriorCoordination } from './coordination-log'
import { isLoopbackHost, serveCoordinationMcp } from './coordination-mcp'
import {
  type DriverAttemptRecord,
  type DriverProgressMark,
  type DriverRetryPolicy,
  defaultUnmetContractSteer,
  type OnUnmetContract,
  runDriverWithRetry,
} from './driver-retry'
import type { BusRecord } from './event-bus'
import { bestDelivered, runFinalizer, runTree, type SupervisorFinalizer } from './finalizer'
import { createInbox } from './inbox'
import { attestRuntimeOwnedScopeOwner, runtimeOwnedScopeOwnerRuntime } from './materialization'
import {
  assertExecutableAgentProfile,
  concreteProfileModel,
  enforceTokenLimits,
  profileModelExecutionSettings,
} from './model-policy'
import type { PeerMailLimits } from './peer-mail'
import { supervisorPolicyPrompt } from './prompt-registry'
import { detachedSnapshot } from './snapshot'
import {
  createProgressTracker,
  progressStop,
  type SettledLedger,
  type StopRule,
} from './stop-rules'
import type { Agent, Budget, NodeExecutionIdentity, ResultBlobStore, Scope } from './types'

/** The standing strategy a router-brained supervisor runs with when its profile names no
 *  `systemPrompt`. The brain's competence IS this prompt: without it the brain has the coordination
 *  verbs but no policy for WHEN to use them, and either over-spawns or stalls. A profile may override
 *  it for a specific topology.
 *
 *  This is the registry's ONE supervisor policy (`supervisor/policy`), not this module's own text:
 *  the delegate front door (`supervisorInstructions`) derives from the same entry, so which front
 *  door built the supervisor no longer decides its work-vs-delegate policy — the package used to
 *  ship two contradictory defaults selected by entry point. */
export const defaultSupervisorPrompt = supervisorPolicyPrompt.text

/** A supervisor is an exact canonical AgentProfile; no looser model/prompt shape exists. */
export type SupervisorProfile = AgentProfile

/** The exact profile fields consumed by supervisor materialization. */
export interface ResolvedSupervisorProfile {
  readonly name: string
  readonly harness: string | null
  readonly modelId: string
  readonly systemPrompt?: string
}

/**
 * The instruction lines a canonical `resources.instructions` contributes. A plain string and an
 * `inline` resource are their own text; a `github` reference names bytes that live elsewhere and
 * cannot be fetched while building a supervisor synchronously — that fails loud rather than
 * dropping instructions the profile says the agent runs under (the same rule
 * `improve()`'s memory surface applies to the same field).
 */
function resourceInstructionLines(
  instructions: AgentProfileResources['instructions'],
): readonly string[] {
  if (instructions === undefined) return []
  if (typeof instructions === 'string') return instructions.length > 0 ? [instructions] : []
  if (instructions.kind === 'inline') {
    return instructions.content.length > 0 ? [instructions.content] : []
  }
  throw new ConfigError(
    'supervisorAgent: profile.resources.instructions is a github resource reference ' +
      `(${JSON.stringify(instructions.path)}), which cannot be fetched while the supervisor is ` +
      'built — pass the instruction text as a string or an inline resource',
  )
}

/**
 * Refuse a best-effort resource policy on the router arm.
 *
 * The router arm inlines `resources.instructions` into the standing prompt and has no channel that
 * could report a resource it skipped. `resources.failOnError: false` asks for the supported subset
 * plus a warning about the rest, so this arm cannot honor it. Running such a profile as strict
 * would apply a policy the profile did not ask for, which is the silent drop the materialization
 * contract exists to prevent.
 */
function assertRouterArmResourcePolicy(profile: SupervisorProfile): void {
  if (profile.resources?.failOnError !== false) return
  throw new ConfigError(
    'supervisorAgent: resources.failOnError: false requests a best-effort resource subset; the ' +
      'router-brained supervisor inlines its resources and reports no skipped resource, so the ' +
      'best-effort policy is refused rather than applied as strict',
  )
}

/**
 * The standing instruction both arms run under: `prompt.systemPrompt`, then canonical prompt and
 * resource instruction lines.
 * `undefined` only when the profile names none at all.
 *
 */
function resolveSupervisorSystemPrompt(
  profile: SupervisorProfile,
  activePrompt?: string,
): string | undefined {
  const promptSystem = profile.prompt?.systemPrompt
  // Instruction lines are APPENDED to the active prompt, so a profile that names only
  // instructions keeps whatever prompt the arm would otherwise run — never replaces it.
  const base = promptSystem ?? activePrompt
  const lines = [
    ...(profile.prompt?.instructions ?? []),
    ...resourceInstructionLines(profile.resources?.instructions),
  ]
  if (lines.length === 0) return base
  return (base !== undefined ? [base, ...lines] : lines).join('\n')
}

/** Resolve the model after refusing any incomplete execution identity. */
export function resolveSupervisorModelId(profile: SupervisorProfile): string {
  assertExecutableAgentProfile(profile, 'supervisorAgent')
  return concreteProfileModel(profile)!
}

/**
 * Reduce one canonical executable profile to the scalars the two brain arms consume.
 */
export function resolveSupervisorProfile(profile: SupervisorProfile): ResolvedSupervisorProfile {
  const exact = agentProfileSchema.parse(profile)
  assertExecutableAgentProfile(exact, 'resolveSupervisorProfile')
  const systemPrompt = resolveSupervisorSystemPrompt(exact)
  const modelId = resolveSupervisorModelId(exact)
  return {
    name: exact.name ?? 'supervisor',
    harness: agentHarness(exact.harness) ?? null,
    modelId,
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
  }
}

/** Where the coordination MCP binds. Omit = an ephemeral port on `127.0.0.1` (the local-harness
 *  default); set `host` when the root or the harness runs off-host. */
export interface CoordinationBinding {
  readonly host?: string
  readonly port?: number
  /** Explicit acknowledgment required to bind a NON-loopback host — see
   *  {@link assertCoordinationBinding} for what is being accepted. */
  readonly allowUnauthenticatedRemote?: boolean
}

/**
 * Fail closed on a non-loopback coordination bind. `serveCoordinationMcp` mounts spawn_worker /
 * steer_agent / stop with NO authentication of any kind (it is a bare JSON-RPC-over-HTTP handler),
 * so a non-loopback bind lets anyone who can reach the port spawn agents and spend the run's
 * conserved budget. There is no token to require yet, so the only honest options are loopback or an
 * explicit, recorded acknowledgment — never a silent bind.
 */
export function assertCoordinationBinding(binding: CoordinationBinding | undefined): void {
  const host = binding?.host
  if (host === undefined || isLoopbackHost(host)) return
  if (binding?.allowUnauthenticatedRemote === true) return
  throw new ConfigError(
    `supervisorAgent: coordination.host=${JSON.stringify(host)} is not a loopback address and the coordination MCP ` +
      'has no authentication: any client that can reach the port could call spawn_worker/steer_agent ' +
      'and spend this run\'s budget. Bind a loopback host ("127.0.0.1", "localhost", "::1"), or set ' +
      'coordination.allowUnauthenticatedRemote: true to accept that exposure explicitly.',
  )
}

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

/**
 * The coordination verbs THIS manager serves, callable in code from a product tool handler.
 *
 * Each verb dispatches by name to the live coordination descriptor's own handler, so a spawn made
 * here crosses the identical path the MCP verb crosses: `makeWorkerAgent` → `authorizeSpawn` /
 * security / `allowedModels`, the conserved pool reservation, `maxLiveWorkers`, the journal, and
 * the event bus. There is no second spawn path and no way to bypass a gate by calling in code.
 *
 * The set is deliberately the COORDINATION surface only. `submit_result`, `stop`, and `ask_parent`
 * are the manager's own lifecycle verbs — a product tool that could settle the run or answer as
 * the manager would be a second brain, not a composition surface.
 *
 * Arguments and results are the same JSON shapes the MCP tools take and return.
 */
export interface CoordinationVerbs {
  spawnAgent(args: unknown): Promise<unknown>
  awaitEvent(args: unknown): Promise<unknown>
  steerAgent(args: unknown): Promise<unknown>
  observeAgent(args: unknown): Promise<unknown>
  listQuestions(args: unknown): Promise<unknown>
  answerQuestion(args: unknown): Promise<unknown>
  runAnalyst(args: unknown): Promise<unknown>
}

/** Trusted context for one product-tool invocation. The node identity remains the same detached,
 * immutable snapshot supplied to the resolver; `signal` and `verbs` are the live control
 * references Runtime adds. `signal` aborts when this manager's scope is cancelled by the caller,
 * RootHandle, deadline, breaker, or a recursive parent; `verbs` composes THIS manager's children
 * in code (see {@link CoordinationVerbs}). */
export interface SupervisorToolInvocationContext extends SupervisorNodeContext {
  readonly signal: AbortSignal
  readonly verbs: CoordinationVerbs
  /** The static face (name / description / inputSchema) of every coordination tool mounted on
   *  THIS manager — the same objects that define the tools, so a product surface rendered from
   *  them (code mode's `search`) can never drift from the grant. Late-bound like `verbs`: a call
   *  before the coordination tools exist throws instead of answering an empty grant. */
  readonly coordinationTools: () => ReadonlyArray<CoordinationToolFace>
}

/** One mounted coordination tool's static face; the handler is deliberately absent. */
export interface CoordinationToolFace {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: unknown
}

/**
 * The late binding behind `context.verbs`.
 *
 * Product tools are resolved and bound BEFORE the coordination tools exist on both arms (the
 * external arm serves them from `serveCoordinationMcp`, the router arm builds them inside
 * `driverAgent.act`). So the slot is created first, handed to the tool handlers, and filled the
 * moment the coordination descriptors are built. A verb called before the fill throws instead of
 * silently doing nothing.
 */
interface VerbSlot {
  readonly verbs: CoordinationVerbs
  readonly descriptors: () => ReadonlyArray<CoordinationToolFace>
  bind(tools: ReadonlyArray<McpToolDescriptor>): void
}

function createVerbSlot(): VerbSlot {
  let bound: ReadonlyArray<McpToolDescriptor> | undefined
  const verb =
    (name: string) =>
    async (args: unknown): Promise<unknown> => {
      if (bound === undefined) {
        throw new ValidationError(
          `supervisorAgent: coordination verb "${name}" was called before this manager's coordination tools were bound`,
        )
      }
      const tool = bound.find((descriptor) => descriptor.name === name)
      if (tool === undefined) {
        throw new ValidationError(
          `supervisorAgent: coordination verb "${name}" is not mounted on this manager`,
        )
      }
      return tool.handler(args)
    }
  return {
    verbs: Object.freeze({
      spawnAgent: verb('spawn_worker'),
      awaitEvent: verb('await_event'),
      steerAgent: verb('steer_agent'),
      observeAgent: verb('observe_agent'),
      listQuestions: verb('list_questions'),
      answerQuestion: verb('answer_question'),
      runAnalyst: verb('run_analyst'),
    }),
    descriptors(): ReadonlyArray<CoordinationToolFace> {
      if (bound === undefined) {
        throw new ValidationError(
          "supervisorAgent: coordinationTools() was called before this manager's coordination tools were bound",
        )
      }
      return Object.freeze(
        bound.map(({ name, description, inputSchema }) =>
          Object.freeze({
            name,
            ...(description === undefined ? {} : { description }),
            ...(inputSchema === undefined ? {} : { inputSchema }),
          }),
        ),
      )
    },
    bind(tools): void {
      bound = tools
    },
  }
}

/** One product-owned tool. It reuses the canonical MCP descriptor fields while Runtime supplies
 *  the trusted invocation context as a separate argument and binds the result for either
 *  transport. Existing handlers remain compatible: the second argument only gains `signal`. */
export interface SupervisorToolDescriptor extends Omit<McpToolDescriptor, 'handler'> {
  readonly handler: (raw: unknown, context: SupervisorToolInvocationContext) => Promise<unknown>
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
 *  so the harness calls spawn_worker / await_event / stop as native tools over the live scope. */
export interface DriveHarness {
  (args: {
    /** The caller's profile, EXACTLY as passed to `supervisorAgent` — never rewritten. A canonical
     *  `AgentProfile` stays schema-valid here (the canonical schema rejects unknown top-level keys,
     *  so hoisting a resolved prompt onto it would make a profile its own validator refuses). */
    readonly profile: SupervisorProfile
    /** The standing instruction assembled from the profile: its system prompt in either spelling,
     *  plus the `prompt.instructions` and `resources.instructions` lines. Absent when the profile
     *  names none — the harness's own default then applies. This, not `profile.systemPrompt`, is
     *  what the harness should run under. */
    readonly systemPrompt?: string
    readonly task: unknown
    readonly scope: Scope<unknown>
    readonly coordinationMcpUrl: string
    /** Fires when the coordination server accepts a result or declares completion. */
    readonly stopSignal?: AbortSignal
    /** Data-only product tool surface mounted on the coordination MCP. Runtime-owned drivers include
     *  this in their materialization evidence without persisting executable handlers. */
    readonly coordinationTools: ReadonlyArray<Omit<McpToolDescriptor, 'handler'>>
  }): Promise<void>
  /** Optional live inbox for the manager session this adapter currently drives. Return `false`
   * when no executor inbox is active instead of claiming a message was delivered. */
  deliver?(message: unknown): boolean
}

/** Trusted manager identity available before its external harness starts. A product uses this to
 * return one independently steerable harness session per recursive manager. */
export type DriveHarnessOwnerContext = Omit<SupervisorNodeContext, 'nodeId'>

/** Resolve an external harness for one exact Runtime-owned manager identity. */
export type ResolveDriveHarness = (context: DriveHarnessOwnerContext) => DriveHarness

export interface SupervisorAgentDeps {
  readonly blobs: ResultBlobStore
  /** Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms). */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Product authorization for every down-leg continuation to a child. */
  readonly authorizeDownMessage?: AuthorizeDownMessage
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget
  /** Runtime-owned sink for provider identity observed by this manager's own turns. */
  readonly onProviderModel?: (model: string | undefined) => void
  /** Independent completion check for direct driver work (`submit_result`). */
  readonly deliverable?: DeliverableSpec<unknown>
  /** Hard cap on simultaneously-LIVE workers across both arms — `spawn_worker` fails closed once
   *  this many are in flight (a concurrency fence on top of the conserved-pool fence; bounds live
   *  boxes/sandboxes, not total work). Omit/`<= 0` = no cap. */
  readonly maxLiveWorkers?: number
  /** Router substrate for a router-brained supervisor (`harness` omitted or `cli-base`). The
   *  profile's model wins. */
  readonly router?: RouterTransportConfig
  /** Required to run an external-harness supervisor: runs the harness as the driver. */
  readonly driveHarness?: DriveHarness
  /** How hard a transiently-failed EXTERNAL driver is re-entered before the run ends
   *  `driver-failed` (#741). Retries reuse the same scope, coordination server, and live children;
   *  the bridge backend reattaches the harness session by its durable execution id. Omit = retry
   *  under the defaults; `{ enabled: false }` = the historical first-failure-ends-the-run behavior.
   *  The router arm is unaffected: its transport already retries. */
  readonly driverRetry?: DriverRetryPolicy
  /** Per-attempt record for the external driver — how an operator sees "failed after N attempts"
   *  instead of one backend's last words. */
  readonly onDriverAttempt?: (record: DriverAttemptRecord) => void | Promise<void>
  /** How many times an EXTERNAL driver that RETURNED with `deliverable` still unmet is re-entered
   *  on the SAME live session with the unmet items. The harness owns its own turn loop, so it can
   *  end while the run has delivered nothing — 376 of 376 winning discovery-lab runs (2026-09-01)
   *  ended on the driver's own completion, and the completion gate could only label that result,
   *  never change it. A re-prompt reuses the retry path: same scope, same coordination server, same
   *  live children, same budget/deadline/abort/attempt bounds. Requires `deliverable`; refused for
   *  a router-brained supervisor, which runs its loop in process. Omit/`0` = never re-prompt. */
  readonly repromptOnUnmet?: number
  /** Compose the re-entry instruction for an unmet contract, or return `'stop'` to end the run.
   *  Requires `repromptOnUnmet >= 1`. Omit = Runtime's own instruction. */
  readonly onUnmetContract?: OnUnmetContract
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
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
  /** Run the ONLINE detector panel over each worker's LIVE tool trace (both arms) so the driver
   *  learns a worker is looping mid-run instead of at settle. Omit = no online watching. */
  readonly watchWorkers?: WorkerWatchOptions
  /** Idle time after which `observe_agent` reports a worker as stalled. Omit = runtime default. */
  readonly stallAfterMs?: number
  /** Default continuity per worker PROFILE NAME (both arms) — `'resume'` re-attaches spawns of
   *  that name to the node's latest settled worker; `spawn_worker`'s per-call `continuity`
   *  overrides. Omit = every spawn fresh (status quo). */
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>
  /** PROGRESS-derived stop rule (BOTH arms). Ends a run that has stopped learning BEFORE it
   *  exhausts a ceiling; it can never keep a run alive past one. Router arm: evaluated before each
   *  driver inference turn. External arm: evaluated on each worker settle, and a stop aborts
   *  `stopSignal` so the harness ends at its next turn boundary. Build it with `plateau` /
   *  `noProgressFor` / `allWorkersStalled` from `supervise/stop-rules` — the thresholds are the
   *  caller's judgment. Omit = ceilings only. */
  readonly stopRule?: StopRule
  /** One-shot notification of WHY a `stopRule` ended the run (BOTH arms). */
  readonly onProgressStop?: (reason: string) => void
  /** Turn cap for the supervisor's own loop. Router arm: driver inference turns (see
   *  `DriverAgentOptions.maxTurns`). External arm: the cap belongs to the harness loop, so
   *  `supervise()` applies it in the drive seam it builds and this field is not read here. */
  readonly maxTurns?: number
  /** Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY; a
   *  harness-brained supervisor is refused at construction rather than silently ignoring it) — it
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
  /** Where the coordination MCP binds (external arm). Omit = an ephemeral loopback port, which is
   *  unreachable from an off-host harness. A non-loopback host fails closed — see
   *  {@link assertCoordinationBinding}. */
  readonly coordination?: CoordinationBinding
  /** OPT-IN async gate run before every spawn mints an assignment or reserves budget — the one
   *  pre-journal point that may ask the backend a question (does this bridge route the child's
   *  wire id; is it already at admission capacity). `supervise` derives one automatically for a
   *  bridge backend; see `CoordinationToolsOptions.preflightSpawn`. */
  readonly preflightSpawn?: SpawnPreflight
  /** Pre-journal profile resolution for `preflightSpawn`: the authored profile → the profile that
   *  will run, so the gate judges the canonical profile. See
   *  `CoordinationToolsOptions.resolveSpawnProfile`. */
  readonly resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile
  /** OPT-IN peer mail (external arm): serve the sibling `send_mail` / `read_mail` post office
   *  beside the coordination MCP and mint each spawn a capability URL on
   *  `WorkerSpawnContext.peerMailUrl`. A router-brained supervisor is refused: it serves no
   *  listener, so there is no post office a worker could reach. */
  readonly peerMail?: boolean | { limits?: Partial<PeerMailLimits> }
  /** The durable run directory this manager acknowledges worker-scoped cancel requests from
   *  (router arm only — the in-process turn loop is the acknowledger). See
   *  `DriverAgentOptions.controlDir`. */
  readonly controlDir?: string
  /** Which cancel requests this manager's acknowledger owns: `'run'` (default; the tree root —
   *  its own direct-child node ids plus label/profile-name references) or `'subtree'` (a nested
   *  manager — exact direct-child node ids only). Exactly one manager owns any request, so two
   *  acknowledgers can never apply one operation. See `DriverAgentOptions.controlScope`. */
  readonly controlScope?: 'run' | 'subtree'
  /** Abort the whole run — the seam a run-scoped cancel request is applied through (router arm,
   *  `'run'` scope only). See `DriverAgentOptions.abortRun`. */
  readonly abortRun?: (reason: string) => void
}

const ROUTER_TRANSPORT_FIELDS = new Set(['routerBaseUrl', 'routerKey', 'complete'])

/** Capture the transport-only Router seam before any profile lowering. TypeScript excess-property
 * checks are not a runtime boundary: JavaScript and widened objects can otherwise smuggle private
 * generation/retry fields through a spread and override an AgentProfile that omitted them. */
function snapshotRouterTransportConfig(input: RouterTransportConfig): RouterTransportConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('supervisorAgent: deps.router must be a RouterTransportConfig object')
  }
  const unsupported = Object.keys(input).filter((field) => !ROUTER_TRANSPORT_FIELDS.has(field))
  if (unsupported.length > 0) {
    throw new ValidationError(
      `supervisorAgent: deps.router contains unsupported behavioral fields: ${unsupported.sort().join(', ')}`,
    )
  }
  if (typeof input.routerBaseUrl !== 'string' || input.routerBaseUrl.length === 0) {
    throw new ValidationError(
      'supervisorAgent: deps.router.routerBaseUrl must be a non-empty string',
    )
  }
  if (typeof input.routerKey !== 'string' || input.routerKey.length === 0) {
    throw new ValidationError('supervisorAgent: deps.router.routerKey must be a non-empty string')
  }
  if (input.complete !== undefined && typeof input.complete !== 'function') {
    throw new ValidationError(
      'supervisorAgent: deps.router.complete must be a function when provided',
    )
  }
  return Object.freeze({
    routerBaseUrl: input.routerBaseUrl,
    routerKey: input.routerKey,
    ...(input.complete !== undefined ? { complete: input.complete } : {}),
  })
}

/** Test-only dependency shape. It is exported only through the package's explicit `/testing`
 * entry; production supervisor surfaces cannot replace profile-derived model execution. */
export interface SupervisorAgentTestDeps extends SupervisorAgentDeps {
  readonly brain: ToolLoopChat
}

/** Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness`
 * (backend-as-data), the same resolution rule as every worker. */
export function supervisorAgent(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
): Agent<unknown, unknown> {
  if ('brain' in deps) {
    throw new ValidationError(
      'supervisorAgent: direct brain injection is test-only; production execution derives the model call from AgentProfile',
    )
  }
  return buildSupervisorAgent(profile, deps)
}

/** Scripted-brain construction for deterministic tests. Not exported from Runtime's main entry. */
export function supervisorAgentWithTestBrain(
  profile: SupervisorProfile,
  deps: SupervisorAgentTestDeps,
): Agent<unknown, unknown> {
  const { brain, ...runtimeDeps } = deps
  return buildSupervisorAgent(profile, runtimeDeps, brain)
}

function buildSupervisorAgent(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
  testBrain?: ToolLoopChat,
): Agent<unknown, unknown> {
  const exactProfile = agentProfileSchema.parse(profile)
  assertExecutableAgentProfile(exactProfile, 'supervisorAgent')
  const stableProfile = detachedSnapshot(exactProfile, 'supervisorAgent profile')
  const stableRouter =
    deps.router === undefined ? undefined : snapshotRouterTransportConfig(deps.router)
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
  const harness = agentHarness(stableProfile.harness) ?? null
  // The prompt is consumed by BOTH arms, so it resolves here; the model id is router-arm-only and
  // resolves inside that arm, so a harness supervisor never touches a field it does not use.
  // No fallback at this site: the harness supplies its own standing prompt, and the router arm
  // re-resolves against its default below so instruction lines append to that default.
  const profilePrompt = resolveSupervisorSystemPrompt(stableProfile)

  // Bind safety is a BUILD-time fault, not a run-time one: it must throw before any compute, on the
  // same synchronous path as the other configuration guards. The binding is SNAPSHOT here and the
  // snapshot is both what gets checked and what `act()` binds, so a later mutation of
  // `deps.coordination` cannot slip an unchecked host past the guard.
  const coordination: CoordinationBinding | undefined = deps.coordination
    ? { ...deps.coordination }
    : undefined
  assertCoordinationBinding(coordination)

  if (harness === null && coordination !== undefined) {
    throw new ConfigError(
      'supervisorAgent: coordination binding is only meaningful for a harness-brained supervisor ' +
        '(profile.harness set). A router-brained supervisor calls the coordination verbs in ' +
        'process and serves no MCP, so this binding would be silently ignored.',
    )
  }

  if (harness === null && deps.peerMail) {
    throw new ValidationError(
      'supervisorAgent: peerMail is only served by a harness-brained supervisor ' +
        '(profile.harness set). A router-brained supervisor serves no coordination MCP listener, ' +
        'so there is no peer-mail post office to mint worker capabilities from.',
    )
  }

  if (harness !== null && deps.compaction) {
    throw new ValidationError(
      'supervisorAgent: compaction is only supported for router-brained supervisors (profile.harness omitted or cli-base)',
    )
  }

  if (
    harness === null &&
    (deps.repromptOnUnmet !== undefined || deps.onUnmetContract !== undefined)
  ) {
    throw new ValidationError(
      'supervisorAgent: repromptOnUnmet/onUnmetContract apply to an EXTERNAL-harness supervisor ' +
        'only (profile.harness set). A router-brained supervisor runs its own turn loop in ' +
        'process, so this option would be silently ignored.',
    )
  }

  if (
    deps.repromptOnUnmet !== undefined &&
    (!Number.isInteger(deps.repromptOnUnmet) || deps.repromptOnUnmet < 0)
  ) {
    throw new ValidationError(
      'supervisorAgent: repromptOnUnmet must be a non-negative integer (0 = never re-prompt)',
    )
  }

  if (deps.onUnmetContract !== undefined && (deps.repromptOnUnmet ?? 0) <= 0) {
    throw new ValidationError(
      'supervisorAgent: onUnmetContract needs repromptOnUnmet >= 1 — without a cap the hook is ' +
        'never consulted',
    )
  }

  if ((deps.repromptOnUnmet ?? 0) > 0 && deps.deliverable === undefined) {
    throw new ValidationError(
      'supervisorAgent: repromptOnUnmet needs a `deliverable` completion check — with no check ' +
        'there is no contract that can be unmet, and every run would re-prompt',
    )
  }

  if (harness === null) {
    // ROUTER arm: the in-process tool-loop. `routerBrain` is an internal detail — a production
    // caller passes a profile, never a hand-built brain. Deterministic source tests use the
    // separately exported `/testing` constructor.
    assertRouterArmResourcePolicy(stableProfile)
    const brain = testBrain ?? routerBrainFromProfile(stableProfile, stableRouter)
    const inbox = createInbox()
    const build = (
      priorCoordination?: PriorCoordination,
      nodeTools?: ReadonlyArray<McpToolDescriptor>,
      onEvent?: SupervisorAgentDeps['onEvent'],
      slot?: VerbSlot,
    ) =>
      driverAgent({
        name,
        brain,
        ...(testBrain === undefined
          ? { expectedModel: resolveSupervisorModelId(stableProfile) }
          : {}),
        ...(deps.onProviderModel ? { onProviderModel: deps.onProviderModel } : {}),
        blobs: deps.blobs,
        makeWorkerAgent: deps.makeWorkerAgent,
        ...(deps.authorizeDownMessage ? { authorizeDownMessage: deps.authorizeDownMessage } : {}),
        perWorker: deps.perWorker,
        // Resolved against the router's own default, so a profile naming only instruction
        // lines appends them to that default instead of replacing it.
        systemPrompt:
          resolveSupervisorSystemPrompt(stableProfile, defaultSupervisorPrompt) ??
          defaultSupervisorPrompt,
        ...(deps.deliverable ? { deliverable: deps.deliverable } : {}),
        ...(nodeTools?.length ? { nodeTools } : {}),
        ...(deps.maxLiveWorkers !== undefined ? { maxLiveWorkers: deps.maxLiveWorkers } : {}),
        ...(deps.extraTools ? { extraTools: deps.extraTools } : {}),
        ...(deps.executeExtraTool ? { executeExtraTool: deps.executeExtraTool } : {}),
        ...(deps.analysts ? { analysts: deps.analysts } : {}),
        ...(deps.analyzeOnSettle ? { analyzeOnSettle: deps.analyzeOnSettle } : {}),
        ...(deps.watchWorkers ? { watchWorkers: deps.watchWorkers } : {}),
        ...(deps.stallAfterMs !== undefined ? { stallAfterMs: deps.stallAfterMs } : {}),
        ...(deps.continuityByProfile ? { continuityByProfile: deps.continuityByProfile } : {}),
        ...(deps.preflightSpawn ? { preflightSpawn: deps.preflightSpawn } : {}),
        ...(deps.resolveSpawnProfile ? { resolveSpawnProfile: deps.resolveSpawnProfile } : {}),
        ...(deps.stopRule ? { stopRule: deps.stopRule } : {}),
        ...(deps.onProgressStop ? { onProgressStop: deps.onProgressStop } : {}),
        ...(deps.maxTurns !== undefined ? { maxTurns: deps.maxTurns } : {}),
        ...(deps.compaction ? { compaction: deps.compaction } : {}),
        ...(onEvent ? { onEvent } : {}),
        ...(deps.replaySettlements ? { replaySettlements: true } : {}),
        ...(priorCoordination ? { priorCoordination } : {}),
        ...(deps.finalizer ? { finalizer: deps.finalizer } : {}),
        ...(slot ? { onCoordinationTools: (tools) => slot.bind(tools) } : {}),
        ...(deps.controlDir === undefined ? {} : { controlDir: deps.controlDir }),
        ...(deps.controlScope === undefined ? {} : { controlScope: deps.controlScope }),
        ...(deps.abortRun ? { abortRun: deps.abortRun } : {}),
        inbox,
      })
    if (!deps.loadPriorCoordination && !resolveTools && !observeNodeEvent) {
      return build(deps.priorCoordination, undefined, deps.onEvent)
    }
    return {
      name,
      deliver(message): boolean {
        return inbox.deliver(message)
      },
      async act(task, scope) {
        const context = nodeContextSeed
          ? supervisorNodeContext(nodeContextSeed, stableProfile, task, scope)
          : undefined
        const priorCoordination = await deps.loadPriorCoordination?.()
        // Filled by `driverAgent` the moment it builds this manager's coordination tools, which
        // is after the product tools are bound — hence the slot rather than a value.
        const slot = createVerbSlot()
        const nodeTools =
          resolveTools && context
            ? await bindSupervisorTools(resolveTools, context, scope.signal, slot)
            : undefined
        const onEvent = bindSupervisorNodeObserver(context, observeNodeEvent, deps.onEvent)
        return build(priorCoordination, nodeTools, onEvent, slot).act(task, scope)
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
  const deliver = driveHarness.deliver?.bind(driveHarness)
  const externalAgent: Agent<unknown, unknown> = {
    name,
    ...(deliver
      ? {
          deliver(message: unknown): boolean {
            return deliver(message)
          },
        }
      : {}),
    async act(task, scope) {
      const context = nodeContextSeed
        ? supervisorNodeContext(nodeContextSeed, stableProfile, task, scope)
        : undefined
      const priorCoordination = deps.loadPriorCoordination
        ? await deps.loadPriorCoordination()
        : deps.priorCoordination
      // Filled by `serveCoordinationMcp` right after it builds this manager's coordination tools
      // and before it listens, so a product tool can compose from its first invocation.
      const slot = createVerbSlot()
      const nodeTools =
        resolveTools && context
          ? await bindSupervisorTools(resolveTools, context, scope.signal, slot)
          : undefined
      const nodeObserver = bindSupervisorNodeObserver(context, observeNodeEvent, deps.onEvent)
      const stopController = new AbortController()
      // PROGRESS-derived stop on this arm. The harness owns its own turn loop, so a worker settle
      // is the evaluation boundary the supervisor has — and it is the same ledger + the same
      // `progressStop` evaluator the router arm consults before each of its inference turns.
      // The stop is delivered through the ONE lever this arm already has: `stopController`, which
      // the harness reads as its stop signal and honours at the next turn boundary.
      const tracker = deps.stopRule ? createProgressTracker({ now: Date.now }) : undefined
      let progressStopReason: string | undefined
      let ledger: SettledLedger | undefined
      const rule = deps.stopRule
      const onEvent =
        tracker && rule
          ? async (
              event: CoordinationEvent,
              record: BusRecord<CoordinationEvent>,
            ): Promise<void> => {
              await nodeObserver?.(event, record)
              if (event.type !== 'settled') return
              if (ledger === undefined) {
                throw new ValidationError(
                  'supervisorAgent: a worker settled before the coordination server was bound',
                )
              }
              const decision = progressStop(
                tracker,
                rule,
                ledger,
                scope,
                Date.now,
                deps.stallAfterMs,
              )
              if (!decision.stop || progressStopReason !== undefined) return
              progressStopReason = decision.reason
              deps.onProgressStop?.(decision.reason)
              if (!stopController.signal.aborted) stopController.abort(decision.reason)
            }
          : nodeObserver
      const mcp = await serveCoordinationMcp({
        scope,
        blobs: deps.blobs,
        makeWorkerAgent: deps.makeWorkerAgent,
        ...(deps.authorizeDownMessage ? { authorizeDownMessage: deps.authorizeDownMessage } : {}),
        perWorker: deps.perWorker,
        ...(coordination?.host !== undefined ? { host: coordination.host } : {}),
        ...(coordination?.port !== undefined ? { port: coordination.port } : {}),
        // `serveCoordinationMcp` enforces the same non-loopback rule itself (it is a public export
        // anyone may call directly), so the caller's acknowledgment has to reach it — not just the
        // `assertCoordinationBinding` above.
        ...(coordination?.allowUnauthenticatedRemote === true
          ? { allowUnauthenticatedRemote: true }
          : {}),
        ...(deps.deliverable ? { deliverable: deps.deliverable } : {}),
        onStop: (reason) => {
          if (!stopController.signal.aborted) {
            stopController.abort(reason ?? 'coordination stop')
          }
        },
        ...(deps.maxLiveWorkers !== undefined ? { maxLiveWorkers: deps.maxLiveWorkers } : {}),
        ...(deps.analysts ? { analysts: deps.analysts } : {}),
        ...(deps.analyzeOnSettle ? { analyzeOnSettle: deps.analyzeOnSettle } : {}),
        ...(deps.watchWorkers ? { watchWorkers: deps.watchWorkers } : {}),
        ...(deps.stallAfterMs !== undefined ? { stallAfterMs: deps.stallAfterMs } : {}),
        ...(deps.continuityByProfile ? { continuityByProfile: deps.continuityByProfile } : {}),
        ...(onEvent ? { onEvent } : {}),
        ...(deps.replaySettlements ? { replaySettlements: true } : {}),
        ...(deps.preflightSpawn ? { preflightSpawn: deps.preflightSpawn } : {}),
        ...(deps.resolveSpawnProfile ? { resolveSpawnProfile: deps.resolveSpawnProfile } : {}),
        ...(deps.peerMail ? { peerMail: deps.peerMail } : {}),
        ...(priorCoordination?.questions.length
          ? { priorQuestions: priorCoordination.questions }
          : {}),
        ...(nodeTools?.length ? { nodeTools } : {}),
        onCoordinationTools: (tools) => slot.bind(tools),
      })
      ledger = mcp
      try {
        // The retry's progress mark. `tokensLeft` only falls, so the difference from the first
        // reading is everything this run has spent from the shared pool — the driver's own turns
        // and any child's. Those two channels are the BURN rate, not the goal, so they are reported
        // beside the contract's verdict and the retry policy reads them together: with a declared
        // check unmet, spend and settlements alone do not buy another attempt.
        const baseTokensLeft = scope.budget.tokensLeft
        const contractDeclared = deps.deliverable !== undefined
        const maxReprompts = deps.repromptOnUnmet ?? 0
        const readProgress = (): DriverProgressMark => {
          const settled = mcp.settled()
          // The same delivered-only rule the finalizer applies: settled `done` AND check-passed.
          const deliveredCount = settled.filter(
            (w) => w.status === 'done' && w.valid === true,
          ).length
          const submitted = Boolean(mcp.submittedResult())
          return {
            poolTokensSpent: baseTokensLeft - scope.budget.tokensLeft,
            settledCount: settled.length,
            submitted,
            deliveredCount,
            contract: !contractDeclared
              ? 'none'
              : submitted || deliveredCount > 0
                ? 'met'
                : 'unmet',
          }
        }
        await runDriverWithRetry({
          drive: async (_attempt, reentry) => {
            try {
              await driveHarness({
                profile: stableProfile,
                ...(profilePrompt !== undefined ? { systemPrompt: profilePrompt } : {}),
                // A re-prompt re-enters the SAME session, so the unmet items ARE the turn. The
                // bridge backend reattaches by durable execution id, exactly as a retry does.
                task: reentry === undefined ? task : reentry.steer,
                scope,
                coordinationMcpUrl: mcp.url,
                stopSignal: stopController.signal,
                coordinationTools: (nodeTools ?? []).map(({ name, description, inputSchema }) => ({
                  name,
                  description,
                  inputSchema,
                })),
              })
            } catch (error) {
              // Once the injected check has accepted a result, a later backend shutdown/timeout
              // cannot erase that completed work — and there is nothing left to retry FOR. Without
              // an accepted submission the backend error propagates into the retry decision.
              if (!mcp.submittedResult() && !mcp.isStopped()) throw error
            }
          },
          progress: readProgress,
          budget: () => scope.budget,
          signal: scope.signal,
          ...(deps.driverRetry ? { policy: deps.driverRetry } : {}),
          ...(maxReprompts > 0
            ? {
                reprompt: {
                  maxReprompts,
                  ...(deps.deliverable?.describe === undefined
                    ? {}
                    : { describe: deps.deliverable.describe }),
                  onUnmetContract: async (context) => {
                    // A run the coordination server STOPPED ended on purpose — the driver called
                    // `stop`, a stop rule fired, or the turn cap closed it. Re-prompting would
                    // re-enter a session whose stop signal is already aborted and argue with a
                    // decision the run already made. Runtime refuses that before the product hook
                    // is consulted, so no hook can override a declared stop.
                    if (mcp.isStopped()) return 'stop'
                    return (
                      (await deps.onUnmetContract?.(context)) ?? {
                        steer: defaultUnmetContractSteer(context),
                      }
                    )
                  },
                },
              }
            : {}),
          ...(deps.onDriverAttempt ? { onAttempt: deps.onDriverAttempt } : {}),
        })
        // Drain settled-but-unpulled children first — a gate-verified delivery the harness never
        // awaited must still reach the finalize ledger.
        await mcp.drainResolved()
        // Direct work is eligible only through `submit_result`, after the injected independent
        // check passes. Raw harness prose remains ineligible.
        const submitted = mcp.submittedResult()
        if (submitted) return submitted.result
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
  signal: AbortSignal,
  slot: VerbSlot,
): Promise<ReadonlyArray<McpToolDescriptor>> {
  const resolved = await resolveTools(context)
  if (!Array.isArray(resolved)) {
    throw new ValidationError('supervisorAgent: resolveSupervisorTools must return an array')
  }
  // Keep the durable node snapshot free of live process objects. The invocation wrapper is frozen
  // shallowly so handlers cannot replace identity or signal, while the AbortSignal itself remains
  // live and follows the manager scope's existing root/parent cascade.
  const invocationContext: SupervisorToolInvocationContext = Object.freeze({
    ...context,
    signal,
    verbs: slot.verbs,
    coordinationTools: slot.descriptors,
  })
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
            invocationContext,
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
  router: RouterTransportConfig | undefined,
): ToolLoopChat {
  if (!router) {
    throw new ValidationError(
      'supervisorAgent: a router-brained supervisor (harness omitted or cli-base) needs deps.router',
    )
  }
  const modelId = resolveSupervisorModelId(profile)
  const settings = profileModelExecutionSettings(profile, 'supervisorAgent')
  return routerBrain(
    {
      routerBaseUrl: router.routerBaseUrl,
      routerKey: router.routerKey,
      ...(router.complete !== undefined ? { complete: router.complete } : {}),
      model: modelId,
      ...(settings.retry !== undefined ? { retry: settings.retry } : {}),
      ...enforceTokenLimits(settings.tokenLimits, 'router', 'supervisorAgent').applied,
      ...(settings.stream !== undefined ? { stream: settings.stream } : {}),
    },
    {
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      ...(settings.seed !== undefined ? { seed: settings.seed } : {}),
      ...(settings.toolChoice !== undefined ? { toolChoice: settings.toolChoice } : {}),
      ...(settings.extraBody !== undefined ? { extraBody: settings.extraBody } : {}),
      ...(profile.model?.reasoningEffort ? { reasoningEffort: profile.model.reasoningEffort } : {}),
    },
  )
}
