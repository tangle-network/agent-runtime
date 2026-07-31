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
 * Both arms spawn children through the SAME `makeWorkerAgent` seam and apply the SAME independent
 * deliverable check to direct submissions. Raw driver prose is never eligible.
 */
import type {
  AgentProfileModelHints,
  AgentProfilePrompt,
  AgentProfileResources,
} from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  CoordinationEvent,
  MakeWorkerAgent,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import { type RouterConfig, routerBrain } from '../router-client'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import type { DeliverableSpec } from './completion-gate'
import { driverAgent } from './coordination-driver'
import type { PriorCoordination } from './coordination-log'
import { isLoopbackHost, serveCoordinationMcp } from './coordination-mcp'
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

/**
 * The supervisor's profile — the subset of an `AgentProfile` that selects + shapes its brain.
 * `harness` is the backend-as-data discriminant; `systemPrompt` is the standing instruction.
 *
 * A canonical `AgentProfile` from `@tangle-network/agent-interface` satisfies this interface
 * structurally: its `model` is a hints OBJECT and its system prompt lives at `prompt.systemPrompt`,
 * so both spellings are accepted here and reduced by {@link resolveSupervisorProfile}. Before that,
 * a canonical profile's model object reached `RouterConfig.model` (a string) as an object and its
 * `prompt.systemPrompt` was dropped — a request the provider rejects, and a supervisor running the
 * default strategy while its profile named another.
 *
 * WHAT EACH ARM HONORS — the two brains read different amounts of a profile, so state it rather
 * than let a caller infer that a field took effect:
 *
 *  - ROUTER arm (`harness` null): only `name`, the resolved model id (`model`, or
 *    `model.default`), and the resolved system prompt (`prompt.systemPrompt`/`systemPrompt` plus
 *    `prompt.instructions` and `resources.instructions`) reach the brain. A full `AgentProfile`'s
 *    `tools`, `mcp`, `permissions`, `resources.skills`/`files`, `hooks`, `modes`, `subagents`,
 *    `model.provider`, `model.small` and `model.reasoningEffort` are NOT honored here: the router
 *    brain is one `ToolLoopChat` over the coordination verbs, and neither of its two tool-calling
 *    transports (`routerChatWithTools` buffered, `streamRouterChatWithTools` when
 *    `RouterConfig.stream` is set) has a parameter for any of them.
 *  - HARNESS arm (`harness` set): the WHOLE profile object is handed to `deps.driveHarness`
 *    untouched, plus the resolved system prompt as a separate argument. Everything the profile
 *    declares is the harness's to materialize; this module changes none of it.
 */
export interface SupervisorProfile {
  readonly name?: string
  /** null/undefined → router brain (in-process tool-loop); a coding-CLI harness → sandboxed brain. */
  readonly harness?: string | null
  /** The router model when the brain is router-driven: a model id, or a canonical profile's model
   *  hints whose `default` IS the id. Absent (including a hints object with no `default`) → the
   *  deps router config's model applies. Other hints (`small`, `provider`, `reasoningEffort`) are
   *  harness-arm material only. */
  readonly model?: string | AgentProfileModelHints
  /** Canonical `AgentProfile` prompt shaping. `prompt.systemPrompt` and the top-level `systemPrompt`
   *  are the same standing instruction in two spellings; disagreeing values are a fault, not a pick.
   *  `prompt.instructions` lines are appended to the resolved prompt, one per line. */
  readonly prompt?: AgentProfilePrompt
  /** Canonical `AgentProfile` resources. Only `instructions` shapes the brain here (appended to the
   *  resolved system prompt); every other resource is the harness's to materialize. */
  readonly resources?: AgentProfileResources
  /** The standing instructions ("you delegate, you do not solve"). */
  readonly systemPrompt?: string
}

/** A `SupervisorProfile` reduced to the scalars the two brain arms consume. `modelId`/`systemPrompt`
 *  stay `undefined` when the profile named none — the caller's fallback (`deps.router.model`,
 *  the built-in default supervisor prompt) then applies, and this type cannot hide which happened.
 *
 *  There is deliberately no `reasoningEffort` here: the router brain runs on `chatWithTools` (the
 *  buffered/streamed switch in the router client), and neither transport has a `reasoning_effort`
 *  parameter — only the chat-only `routerChatWithUsage` does — so a field carrying it would be a
 *  public promise nothing keeps. `model.reasoningEffort` still reaches the harness arm inside the
 *  profile. */
export interface ResolvedSupervisorProfile {
  readonly name: string
  readonly harness: string | null
  readonly modelId?: string
  readonly systemPrompt?: string
}

/** Longest prompt excerpt an error message may carry. A supervisor system prompt is routinely
 *  thousands of characters; two of them interpolated whole turn a configuration fault into an
 *  unreadable wall, so a fault reports each prompt's LENGTH plus a leading excerpt instead. */
const PROMPT_EXCERPT_CHARS = 60

/** `<n> chars starting "<first 60>…"` — enough to tell two prompts apart without printing either. */
function describePrompt(value: string): string {
  const head = value.slice(0, PROMPT_EXCERPT_CHARS)
  return `${value.length} chars starting ${JSON.stringify(head)}${value.length > PROMPT_EXCERPT_CHARS ? '…' : ''}`
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
 * The standing instruction both arms run under, assembled from every canonical spelling that
 * carries one: the system prompt (`prompt.systemPrompt` or the top-level `systemPrompt`), then the
 * `prompt.instructions` lines, then `resources.instructions` — each on its own line, in that order.
 * `undefined` only when the profile names none at all.
 *
 * Two disagreeing system prompts throw: they are the same standing instruction in two spellings, so
 * picking one silently changes what the supervisor runs and there is no defensible winner.
 */
function resolveSupervisorSystemPrompt(
  profile: SupervisorProfile,
  activePrompt?: string,
): string | undefined {
  const promptSystem = profile.prompt?.systemPrompt
  const topSystem = profile.systemPrompt
  if (promptSystem !== undefined && topSystem !== undefined && promptSystem !== topSystem) {
    throw new ValidationError(
      'supervisorAgent: profile.prompt.systemPrompt and profile.systemPrompt are both set and ' +
        'differ — they are the same standing instruction, so keep exactly one ' +
        `(prompt.systemPrompt: ${describePrompt(promptSystem)}; ` +
        `systemPrompt: ${describePrompt(topSystem)})`,
    )
  }
  // Instruction lines are APPENDED to the active prompt, so a profile that names only
  // instructions keeps whatever prompt the arm would otherwise run — never replaces it.
  const base = promptSystem ?? topSystem ?? activePrompt
  const lines = [
    ...(profile.prompt?.instructions ?? []),
    ...resourceInstructionLines(profile.resources?.instructions),
  ]
  if (lines.length === 0) return base
  return (base !== undefined ? [base, ...lines] : lines).join('\n')
}

/**
 * The router model id, or `undefined` when the profile names none. A string `model` IS the id; an
 * object `model` is canonical model hints and `default` is the id. `AgentProfileModelHints.default`
 * is OPTIONAL upstream (`{ provider: 'anthropic' }` is a valid canonical profile), so hints without
 * a resolvable id are the documented "profile names no model" case: the router config's own model
 * applies, exactly as when `model` is absent.
 */
export function resolveSupervisorModelId(profile: SupervisorProfile): string | undefined {
  if (typeof profile.model === 'string') return profile.model
  const fromHints = profile.model?.default
  return typeof fromHints === 'string' && fromHints.length > 0 ? fromHints : undefined
}

/**
 * Reduce either profile spelling — a hand-written `SupervisorProfile` or a canonical `AgentProfile`
 * — to the scalars the brain arms consume:
 *
 *  - `modelId`: a string `model` verbatim, else `model.default`. Absent or unresolvable → the
 *    router config's own model applies unchanged.
 *  - `systemPrompt`: the system prompt plus the `prompt.instructions` and `resources.instructions`
 *    lines, one per line.
 *
 * `supervisorAgent` resolves each piece only where it is consumed (the model id on the router arm
 * only); this whole-profile reduction is the caller-facing view of the same rules.
 */
export function resolveSupervisorProfile(profile: SupervisorProfile): ResolvedSupervisorProfile {
  const systemPrompt = resolveSupervisorSystemPrompt(profile)
  const modelId = resolveSupervisorModelId(profile)
  return {
    name: profile.name ?? 'supervisor',
    harness: profile.harness ?? null,
    ...(modelId !== undefined ? { modelId } : {}),
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
 * Fail closed on a non-loopback coordination bind. `serveCoordinationMcp` mounts spawn_agent /
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
      'has no authentication: any client that can reach the port could call spawn_agent/steer_agent ' +
      'and spend this run\'s budget. Bind a loopback host ("127.0.0.1", "localhost", "::1"), or set ' +
      'coordination.allowUnauthenticatedRemote: true to accept that exposure explicitly.',
  )
}

/** How to run a sandboxed harness as the DRIVER, with the coordination verbs mounted — the substrate
 *  seam the caller supplies (mirrors `makeWorkerAgent` for spawned children). It runs `profile` on
 *  `task` in its backend (sandbox / cli-bridge) with `coordinationMcpUrl` mounted as an MCP server,
 *  so the harness calls spawn_agent / await_event / stop as native tools over the live scope. */
export type DriveHarness = (args: {
  /** The caller's profile, EXACTLY as passed to `supervisorAgent` — never rewritten. A canonical
   *  `AgentProfile` stays schema-valid here (the canonical schema rejects unknown top-level keys,
   *  so hoisting a resolved prompt onto it would make a profile its own validator refuses). */
  readonly profile: SupervisorProfile
  /** The standing instruction assembled from the profile: its system prompt in either spelling,
   *  plus the `prompt.instructions` and `resources.instructions` lines. Absent when the profile
   *  names none — the harness's own default then applies. This, not `profile.systemPrompt`, is what
   *  the harness should run under. */
  readonly systemPrompt?: string
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
  /** Independent completion check for direct driver work (`submit_result`). */
  readonly deliverable?: DeliverableSpec<unknown>
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
  /** Where the coordination MCP binds (sandbox arm). Omit = an ephemeral loopback port, which is
   *  unreachable from an off-host harness. A non-loopback host fails closed — see
   *  {@link assertCoordinationBinding}. */
  readonly coordination?: CoordinationBinding
}

/** Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness` (backend-as-data), the same resolution rule as every worker. */
export function supervisorAgent(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
): Agent<unknown, unknown> {
  const name = profile.name ?? 'supervisor'
  const harness = profile.harness ?? null
  // The prompt is consumed by BOTH arms, so it resolves here; the model id is router-arm-only and
  // resolves inside that arm, so a harness supervisor never touches a field it does not use.
  // No fallback at this site: the harness supplies its own standing prompt, and the router arm
  // re-resolves against its default below so instruction lines append to that default.
  const profilePrompt = resolveSupervisorSystemPrompt(profile)

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
      // Resolved against the router's own default, so a profile naming only instruction
      // lines appends them to that default instead of replacing it.
      systemPrompt:
        resolveSupervisorSystemPrompt(profile, defaultSupervisorPrompt) ?? defaultSupervisorPrompt,
      ...(deps.deliverable ? { deliverable: deps.deliverable } : {}),
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
        ...(coordination?.host !== undefined ? { host: coordination.host } : {}),
        ...(coordination?.port !== undefined ? { port: coordination.port } : {}),
        // `serveCoordinationMcp` enforces the same non-loopback rule itself (it is a public export
        // anyone may call directly), so the caller's acknowledgment has to reach it — not just the
        // `assertCoordinationBinding` above.
        ...(coordination?.allowUnauthenticatedRemote === true
          ? { allowUnauthenticatedRemote: true }
          : {}),
        ...(deps.deliverable ? { deliverable: deps.deliverable } : {}),
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
        try {
          await driveHarness({
            profile,
            ...(profilePrompt !== undefined ? { systemPrompt: profilePrompt } : {}),
            task,
            scope,
            coordinationMcpUrl: mcp.url,
          })
        } catch (error) {
          // Once the injected check has accepted a result, a later backend shutdown/timeout cannot
          // erase that completed work. Without an accepted submission, preserve the backend error.
          if (!mcp.submittedResult()) throw error
        }
        // Drain settled-but-unpulled children first — a gate-verified delivery the harness never
        // awaited must still reach the finalize ledger.
        await mcp.drainResolved()
        // Direct work is eligible only through `submit_result`, after the injected independent
        // check passes. Raw harness prose remains ineligible.
        const submitted = mcp.submittedResult()
        if (submitted) return submitted.result
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
  // The model id is resolved HERE, the one place it is consumed. `model.reasoningEffort` is not
  // carried with it: `routerBrain` runs on `chatWithTools` — `routerChatWithTools` buffered, or
  // `streamRouterChatWithTools` when the spread `deps.router` sets `stream` — and neither transport
  // has a `reasoning_effort` parameter (only the chat-only `routerChatWithUsage` does), so
  // forwarding it would need a router-client change, not a local workaround.
  const modelId = resolveSupervisorModelId(profile)
  return routerBrain({
    ...deps.router,
    ...(modelId !== undefined ? { model: modelId } : {}),
  })
}
