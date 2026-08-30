/**
 *
 * `driverAgent` — the driver's BRAIN.
 *
 * The recursive driver-executor (`driver-executor.ts`) runs a driver `Agent.act` inside a
 * nested `Scope`; this is the intelligent `act`: it mounts the coordination MCP verbs
 * (`createCoordinationTools`) over that scope and runs an LLM tool-loop, so the driver
 * REASONS — spawn / observe / steer / await / stop — about how to drive its children,
 * instead of running a fixed script. Each turn: ask the driver LLM for tool calls, run them
 * against the live scope, fold the results back, repeat until the driver stops (no tool
 * calls) or the turn cap forces a keep-best finalize.
 *
 * Recursion composes through `makeWorkerAgent`: `spawn_worker` resolves a `profile` to a
 * worker LEAF or — when the profile is a driver — a `driverChild` wrapping ANOTHER
 * `driverAgent` over its own nested scope (see `driver-executor.ts`). So an agent
 * drives an agent that drives an agent, each an LLM tool-loop, all on one conserved-budget
 * tree.
 *
 * Two seams are INJECTED so the loop runs offline with no creds and stays decoupled:
 *  - `brain` (`ToolLoopChat`) — one driver-LLM turn over the canonical tool-loop seam; a test
 *    drives a scripted mock, production passes the router's tool-calling (`routerBrain`), a
 *    sandboxed harness drives the verbs as MCP tools. The same seam every tool-loop uses.
 *  - `systemPrompt` — the driver's stance (the agent-eval worker-driver prompt / the prompt
 *    generator). Injected, never hardcoded — the prompt is a pluggable role.
 *
 * @experimental
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { RuntimeRunStateError, ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import {
  type AnalystRegistry,
  type AnalyzeOnSettleRoute,
  type AuthorizeDownMessage,
  type ContinuityMode,
  type CoordinationEvent,
  coordinationVerbNames,
  createCoordinationTools,
  type DownMessageEvent,
  type MakeWorkerAgent,
  normalizeAnalyzeOnSettle,
  type SettledWorker,
  type SpawnPreflight,
  type WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import type { ToolSpec } from '../router-client'
import {
  runBrainLoop,
  type ToolLoopCallContext,
  type ToolLoopChat,
  type ToolLoopCompaction,
  type ToolLoopCompactionOptions,
} from '../tool-loop'
import { chargedTokens, promptCacheTokenClasses, unmeteredSpend } from '../util'
import type { DeliverableSpec } from './completion-gate'
import type { PriorCoordination } from './coordination-log'
import type { BusRecord } from './event-bus'
import {
  bestDelivered,
  pickBestDelivered,
  runFinalizer,
  runTree,
  type SupervisorFinalizer,
} from './finalizer'
import { createInbox, type Inbox } from './inbox'
import { providerAttemptEvidence } from './materialization'
import { isTerminalNodeStatus } from './node-status'
import {
  claimWorkerSteerDelivery,
  type RunCancellation,
  readRunCancellation,
  readRunCancelRequest,
  readWorkerCancellation,
  readWorkerCancelRequests,
  readWorkerSteerAcknowledgement,
  readWorkerSteerRequests,
  type WorkerCancellation,
  type WorkerCancelRequest,
  type WorkerSteerAcknowledgement,
  type WorkerSteerRequest,
  writeRunCancellation,
  writeWorkerCancellation,
  writeWorkerSteerAcknowledgement,
} from './run-layout'
import { meterRuntimeOwnedProviderAttempt } from './scope'
import { createProgressTracker, progressStop, type StopRule } from './stop-rules'
import type {
  Agent,
  Budget,
  NodeSnapshot,
  ResultBlobStore,
  ResumedWork,
  Scope,
  Spend,
  TreeView,
} from './types'

export interface DriverAgentOptions {
  readonly name: string
  /** The driver-LLM seam — ONE inference turn over the conversation + the coordination tool specs
   *  (the canonical `ToolLoopChat`): a scripted mock offline, the router's tool-calling in
   *  production, or a sandboxed harness. The same seam every tool-loop uses; no bespoke shape. */
  readonly brain: ToolLoopChat
  /** Profile-declared model for a production Router brain. When set, every turn must report this
   * exact provider-observed model before its output is accepted. Omitted by scripted test brains. */
  readonly expectedModel?: string
  /** Runtime-owned observation sink for the provider identity of each settled driver turn. */
  readonly onProviderModel?: (model: string | undefined) => void
  /** Shared blob store — `observe_agent` reads settled outputs through it. */
  readonly blobs: ResultBlobStore
  /** Resolve a spawned `profile` to a worker LEAF or a driver child (the recursion seam). */
  readonly makeWorkerAgent: MakeWorkerAgent
  readonly authorizeDownMessage?: AuthorizeDownMessage
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget
  /** Independent completion check for work the driver performs itself. When present, the driver
   *  receives `submit_result`; the first passing submission ends the loop and becomes the output. */
  readonly deliverable?: DeliverableSpec<unknown>
  /** Hard cap on simultaneously-LIVE workers — `spawn_worker` fails closed once this many are in
   *  flight (a concurrency fence on top of the conserved-pool fence). Omit/`<= 0` = no cap. */
  readonly maxLiveWorkers?: number
  /** The analyst lenses available to the driver. Required for `analyzeOnSettle` (and `run_analyst`).
   *  Unset → no analyst feed (status quo: the driver gets settled outputs, no findings). */
  readonly analysts?: AnalystRegistry
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each result re-enters as a
   *  `finding` the driver pulls and composes its next steer from. The UP-leg of the self-improving
   *  loop. Omit/empty = no auto-analysis (status quo). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
  /** Run the ONLINE detector panel over each worker's LIVE tool trace and raise a `finding` the
   *  moment it loops/error-storms — mid-run evidence to steer on, not a settle-time post-mortem.
   *  Omit = no online watching. */
  readonly watchWorkers?: WorkerWatchOptions
  /** Idle time after which `observe_agent` reports a worker as stalled (a derived read; nothing is
   *  killed). Omit = the runtime default. */
  readonly stallAfterMs?: number
  /** Default continuity per worker PROFILE NAME — `'resume'` makes spawns of that name re-attach
   *  to the node's latest settled worker (see
   *  `CoordinationToolsOptions.continuityByProfile`); `spawn_worker`'s per-call `continuity`
   *  argument overrides. Omit = every spawn fresh (status quo). */
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>
  /** OPT-IN async gate run before every spawn mints an assignment or reserves budget. See
   *  `CoordinationToolsOptions.preflightSpawn`. */
  readonly preflightSpawn?: SpawnPreflight
  /** Pre-journal profile resolution for `preflightSpawn`; see
   *  `CoordinationToolsOptions.resolveSpawnProfile`. */
  readonly resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile
  /** The driver's stance — a string, or built from the task (the worker-driver prompt /
   *  the generator). INJECTED so the prompt is a pluggable, optimizable role. */
  readonly systemPrompt: string | ((task: unknown) => string)
  /** Product-selected tools already bound to this exact supervisor node. The same descriptors are
   *  served over MCP for external supervisors; this arm projects them into router ToolSpecs. */
  readonly nodeTools?: ReadonlyArray<McpToolDescriptor>
  /** WORK tools the driver may call DIRECTLY (alongside the coordination verbs) — so the driver is
   *  not a pure manager but a full agent that can ACT (do simple work itself) OR SPAWN (delegate).
   *  Each is a router tool spec; their names must not collide with the coordination verbs. Pair with
   *  `executeExtraTool`. Unset → coordination-only (the prior behavior). */
  readonly extraTools?: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly parameters: Record<string, unknown>
  }>
  /** Runs an `extraTools` call. Returns a string result, or null/undefined to signal "not handled"
   *  so the call falls through to the coordination dispatch. Required iff `extraTools` is set. */
  readonly executeExtraTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string | null | undefined>
  /** Max driver turns before the loop force-finalizes on the best settled child. Default 16.
   *  `0` lifts the turn-COUNT cap: the loop is bounded instead by the conserved budget pool,
   *  an absolute deadline, the driver's own stop, and abort (checked in-loop). A finite
   *  anti-runaway tripwire still guards a degenerate driver that loops on a no-spawn tool. */
  readonly maxTurns?: number
  /** Injected clock for the in-loop absolute-deadline guard — keeps the deadline check
   *  deterministic in tests. Defaults to `Date.now`. */
  readonly now?: () => number
  /**
   * PROGRESS-derived stop (mechanic D). Today a run ends on a ceiling — iterations, tokens,
   * dollars, deadline, turn cap — which answers "may it continue?" and never "is it still getting
   * anywhere?". A stop rule reads the run's own progress (best-so-far over settled work, time
   * since the last settle, the live worker feed) and ends a run that has stopped learning BEFORE
   * it exhausts a budget.
   *
   * Composes with, and can never override, the hard guards: `poolStarved` / `deadlinePassed` /
   * abort / the driver's own stop are evaluated first, so a rule can only ADD a stop.
   *
   * THRESHOLDS are the caller's judgment, not this module's — build the rule with
   * `plateau({window, minDelta})` / `noProgressFor({...})` / `allWorkersStalled({...})` from
   * `supervise/stop-rules`. Omit ⇒ ceilings only (unchanged behavior).
   */
  readonly stopRule?: StopRule
  /** Called once with the rule's reason when a `stopRule` ends the run — so a caller can record
   *  WHY a run stopped early instead of inferring it from an unexhausted budget. */
  readonly onProgressStop?: (reason: string) => void
  /** Give the driver brain a chapter-lifecycle on its OWN context window. The LLM-brain front doors
   *  lose to a dumb-Ralph respawn because the brain re-bills its whole coordination transcript every
   *  turn — the same context overflow a single steered agent suffers, one level up. With this set,
   *  once the brain's running conversation exceeds `thresholdTokens` it distills the accumulated
   *  history to a compact progress note and continues fresh: the supervisor analog of respawning
   *  against external tracking state, except the live `Scope` roster IS the durable state. Default
   *  off (no behavior change). `distill` defaults to a self-summary authored by the brain combined
   *  with the factual settled-worker roster; override to supply your own. */
  readonly compaction?: ToolLoopCompactionOptions
  /** Pass-through subscriber for every coordination bus event: settled/question/finding,
   *  pre-delivery instruction receipts, and steer/answer delivery outcomes. A durable caller uses
   *  this to append the coordination log. Omit = no observer. */
  readonly onEvent?: (
    event: CoordinationEvent,
    record: BusRecord<CoordinationEvent>,
  ) => void | Promise<void>
  /** Re-publish resume-time settlements through the awaited observer before the first brain turn. */
  readonly replaySettlements?: boolean
  /** Questions, findings, and authorized continuation receipts loaded from a prior process.
   *  Questions seed the ledger (`list_questions`, blocking-stop policy); all three feed the resume
   *  brief. Continuation receipts are evidence only and are never auto-delivered. Omit = fresh. */
  readonly priorCoordination?: PriorCoordination
  /** How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
   *  highest-scoring DELIVERED child (the exact keep-best every existing caller had). Runs under
   *  the delivered-only invariant (`runFinalizer`): whatever the finalizer, an undelivered or
   *  invalid child's output stays unreachable. */
  readonly finalizer?: SupervisorFinalizer
  /** Optional shared manager inbox used by a wrapper that must accept messages before async node
   * setup finishes. Ordinary callers omit it and the driver owns a fresh inbox. */
  readonly inbox?: Inbox
  /**
   * The durable run directory (`SuperviseOptions.runDir` / the `run-layout` event dir) this driver
   * ACKNOWLEDGES worker-scoped cancel requests from. Each turn the driver reads the layout's
   * cancellation inbox once, applies any request naming one of ITS OWN workers through that
   * worker's existing per-child abort (cascading to the worker's subtree and no sibling), and
   * writes the durable {@link WorkerCancellation} acknowledgement: `cancel_requested` when the
   * abort is issued, `cancelled` only when the worker reaches a terminal `down` on the settle
   * path, `not_live` when the worker is already gone — a missing worker never reads as success.
   * Which requests this driver OWNS is set by {@link controlScope}. Omit = no acknowledger
   * (in-memory runs keep in-process control via handles).
   */
  readonly controlDir?: string
  /**
   * Which cancel requests this driver's acknowledger owns when `controlDir` is set.
   *
   * `'run'` (the default, and the tree root's role): exact node ids of its OWN direct children,
   * plus every label/profile-name reference. `'subtree'` (a nested manager): exact direct-child
   * node ids ONLY — never labels or profile names, which can match workers under more than one
   * manager. Ownership makes each operation appliable by exactly ONE manager, so two acknowledgers
   * sharing one `controlDir` can never abort two workers for one operation or race on the
   * acknowledgement file. At the end of `act`, the owner writes an expiry record for each owned
   * request still open: `not_live` for one never applied, `unknown` for an abort whose settle the
   * run ended too soon to observe — so a reader can tell run-over from in-progress.
   */
  /** Called with this driver's coordination tool descriptors once they exist and before the brain
   *  loop starts — the seam a node tool uses to call the same verbs in code
   *  (`SupervisorToolInvocationContext.verbs`). */
  readonly onCoordinationTools?: (tools: ReadonlyArray<McpToolDescriptor>) => void
  readonly controlScope?: 'run' | 'subtree'
  /**
   * Abort the WHOLE run — the seam a run-scoped cancel request (`cancelRun`) is applied through.
   * Wired by `supervise()` to the run's ONE cascade controller (the attached root control), so a
   * run cancel takes the same path a caller's `RootHandle.abort` takes; there is no second
   * controller and no poller. Read only by the `'run'`-scoped manager with a `controlDir`; omit
   * and a run-scoped request stays unanswered.
   */
  readonly abortRun?: (reason: string) => void
}

/** The default chapter-close prompt: the brain summarizes its OWN progress for its future self before
 *  the detailed history is dropped. Emphasis on PENDING work — the part a too-eager chapter-close
 *  loses (the coding-burn counter-finding: closing after one fix leaves integration bugs uncircled). */
const distillInstruction =
  'CONTEXT COMPACTION. Your detailed turn-by-turn history is about to be discarded to free your context window. Write a COMPLETE, compact handoff note for your future self so you can keep going without it. Cover: (1) what you have accomplished; (2) every worker you spawned and its current status/result; (3) what subtasks remain unfinished, failing, or unverified — be specific and exhaustive here, this is the part you must not lose; (4) your immediate next action. Do not call any tools; respond with the note only.'

/** Factual ground truth for the digest — the live worker roster from Scope plus the delivered-result
 *  ledger, independent of whatever the brain's prose summary captures. */
function summarizeRoster(view: TreeView, settled: ReadonlyArray<SettledWorker>): string {
  if (view.nodes.length === 0) return 'Workers in current live scope: none yet.'
  const settledById = new Map(settled.map((w) => [w.id, w]))
  const lines = view.nodes.map((node) => formatRosterNode(node, settledById.get(node.id)))
  return `Workers in current live scope (ground truth from the run, ${view.nodes.length} total, ${view.inFlight} in flight):\n${lines.join('\n')}`
}

function formatRosterNode(node: NodeSnapshot, settled?: SettledWorker): string {
  const result =
    settled?.status === 'done'
      ? `, delivered=${settled.valid ?? false}${
          settled.score !== undefined ? `, score=${settled.score}` : ''
        }${settled.outRef ? `, outRef=${settled.outRef}` : ''}`
      : settled?.status === 'down'
        ? `, reason=${settled.reason ?? 'unknown'}`
        : node.outRef
          ? `, outRef=${node.outRef}`
          : ''
  return `- ${node.id}: ${node.status}, label=${node.label}, runtime=${node.runtime}${result}`
}

/** Spawn-progress is impossible: the pool can't afford another worker AND nothing is in flight to
 *  await. A long-horizon driver bounded by the conserved pool stops here instead of spinning (the
 *  in-loop budget guard the turn cap alone never provided). Checks BOTH conserved channels: tokens
 *  (can't afford a worker) and usd (a usd-capped pool whose ceiling the driver's own metered
 *  inference has drained — `meter` debits usd, so without this a huge-token/small-usd pool would
 *  overspend usd up to the turn tripwire). */
function poolStarved(scope: Scope<unknown>, perWorker: Budget): boolean {
  const b = scope.budget
  if (scope.view.inFlight > 0 || scope.view.waiting > 0) return false
  const tokenStarved = b.tokensLeft < perWorker.maxTokens
  const iterationStarved = b.iterationsLeft <= 0
  const usdStarved =
    b.usdCapped &&
    (b.usdLeft <= 0 || (perWorker.maxUsd !== undefined && b.usdLeft < perWorker.maxUsd))
  return tokenStarved || iterationStarved || usdStarved
}

/** The absolute wall-clock deadline (when the root set one) has passed. */
function deadlinePassed(scope: Scope<unknown>, now: () => number): boolean {
  const b = scope.budget
  return b.deadlineMs > 0 && now() >= b.deadlineMs
}

/** The USD-denominated members of {@link PromptCacheUsage} — the schema, not a guess. Every
 *  other known member (`readTokens`, `writeTokens`, `missTokens`) is a token COUNT. */
const PROMPT_CACHE_USD_FIELDS: ReadonlySet<string> = new Set(['readSavingsUsd'])

/** Dollar amounts above this are provider nonsense, not evidence. The old all-integer rule
 *  rejected them as a side effect; keeping an explicit ceiling preserves that protection
 *  without pretending a dollar amount is an integer. */
const MAX_PROMPT_CACHE_USD = 1_000_000

/**
 * Validate provider-reported prompt-cache evidence.
 *
 * Prompt-cache carries two kinds of number and they obey different rules: token COUNTS are
 * integers, and USD amounts are fractional by nature. Applying the count rule to a dollar
 * field refuses every provider that reports cache savings in dollars — a healthy router
 * response carrying `readSavingsUsd: 0.0034` failed the driver outright before this split.
 *
 * Classification is schema-first: a field named in {@link PromptCacheUsage} is validated by
 * what that member IS. `promptCache` is an open record (the sandbox path forwards provider
 * fields verbatim), so an unknown field falls back to the `usd` name-suffix convention —
 * documented here as the contract a provider must follow to report dollars.
 *
 * Returns the refusal, or `undefined` when the evidence is acceptable.
 */
export function validateDriverPromptCache(
  promptCache: Readonly<Record<string, number | string>> | undefined,
): ValidationError | undefined {
  for (const [field, value] of Object.entries(promptCache ?? {})) {
    if (typeof value !== 'number') continue
    const isUsdField = PROMPT_CACHE_USD_FIELDS.has(field) || /usd$/i.test(field)
    if (isUsdField) {
      if (!Number.isFinite(value) || value < 0 || value > MAX_PROMPT_CACHE_USD) {
        return new ValidationError(
          `driverAgent: prompt-cache field ${JSON.stringify(field)} must be a non-negative finite number of dollars`,
        )
      }
      continue
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      return new ValidationError(
        `driverAgent: prompt-cache field ${JSON.stringify(field)} must be a non-negative safe integer`,
      )
    }
  }
  return undefined
}

/** The journal file `createFileRunContext` writes inside the run directory. The acknowledger
 *  reads it as EVIDENCE for the terminated-descendants set — the nested trees of a cancelled
 *  lead journal their terminal records there before the lead settles into this scope. */
const SPAWN_JOURNAL_FILE = 'spawn-journal.jsonl'

interface CancelAcknowledgerDeps {
  readonly dir: string
  readonly coord: {
    settled(): ReadonlyArray<SettledWorker>
    abortWorker(
      ref: string,
      reason?: string,
    ): { readonly id: string; readonly label: string } | undefined
  }
  readonly scope: Scope<unknown>
  readonly now: () => number
  /** This manager's own node id (`scope.view.root`) — the parent every owned node id hangs off. */
  readonly ownerId: string
  /** `'run'` also owns label/profile-name references (the tree root's role); `'subtree'` owns
   *  exact direct-child node ids only. See `DriverAgentOptions.controlScope`. */
  readonly controlScope: 'run' | 'subtree'
  /** Abort the WHOLE run through the one cascade controller it already has. Present only on the
   *  `'run'`-scoped manager, and only when the caller wired a root control; without it a
   *  run-scoped cancel request is not this manager's to apply. */
  readonly abortRun?: (reason: string) => void
}

interface SteerAcknowledgerDeps {
  readonly dir: string
  readonly coord: {
    steerWorker(
      workerId: string,
      instruction: string,
      options?: { readonly interrupt?: boolean },
    ): Promise<DownMessageEvent>
  }
  readonly now: () => number
  readonly ownerId: string
}

/**
 * Apply externally admitted steers once from the owning manager's turn loop.
 *
 * The `unknown` acknowledgement lands before authorization or delivery. A crash after that write
 * can lose this steer, but a restarted manager never delivers it again. This is the same
 * at-most-once crash boundary as coordination instruction receipts: no duplicate instruction is
 * safer than replaying a mutation whose first delivery may already have succeeded.
 */
export function createSteerAcknowledger(deps: SteerAcknowledgerDeps): {
  pass(phase: 'turn' | 'final'): Promise<void>
} {
  const iso = () => new Date(deps.now()).toISOString()
  const directChildId = (ref: string): boolean =>
    ref.startsWith(`${deps.ownerId}:s`) && /^s\d+$/.test(ref.slice(deps.ownerId.length + 1))

  const base = (
    request: WorkerSteerRequest,
  ): Omit<WorkerSteerAcknowledgement, 'effect' | 'observedAt' | 'detail'> => ({
    schemaVersion: 1,
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    worker: request.worker,
    requestedAt: request.at,
  })

  return {
    async pass(phase): Promise<void> {
      for (const request of readWorkerSteerRequests(deps.dir)) {
        if (!directChildId(request.worker)) continue
        if (readWorkerSteerAcknowledgement(deps.dir, request.operationId) !== undefined) continue
        if (phase === 'final') {
          writeWorkerSteerAcknowledgement(deps.dir, {
            ...base(request),
            effect: 'not_live',
            observedAt: iso(),
            detail: 'run ended before the steer was applied',
          })
          continue
        }
        const claimed = claimWorkerSteerDelivery(deps.dir, {
          ...base(request),
          effect: 'unknown',
          observedAt: iso(),
          detail: 'delivery admitted; outcome not yet known',
        })
        if (!claimed) continue
        try {
          const outcome = await deps.coord.steerWorker(request.worker, request.message, {
            interrupt: request.interrupt,
          })
          const effect: WorkerSteerAcknowledgement['effect'] = outcome.delivered
            ? 'delivered'
            : outcome.outcome === 'runtime-has-no-inbox'
              ? 'unsupported'
              : outcome.outcome === 'unknown-worker' ||
                  outcome.outcome === 'already-settled' ||
                  outcome.outcome === 'scope-stopped'
                ? 'not_live'
                : 'unknown'
          writeWorkerSteerAcknowledgement(deps.dir, {
            ...base(request),
            effect,
            observedAt: iso(),
            detail: steerAcknowledgementDetail(outcome),
          })
        } catch (error) {
          void error
          writeWorkerSteerAcknowledgement(deps.dir, {
            ...base(request),
            effect: 'unknown',
            observedAt: iso(),
            detail: 'delivery outcome is unknown after a runtime error',
          })
        }
      }
    },
  }
}

function steerAcknowledgementDetail(outcome: DownMessageEvent): string {
  switch (outcome.outcome) {
    case 'delivered':
      return 'the owning manager delivered the steer to the exact live worker'
    case 'runtime-has-no-inbox':
      return 'the exact worker does not expose a steer inbox'
    case 'unknown-worker':
      return 'the owning manager does not know the exact worker'
    case 'already-settled':
      return 'the exact worker settled before delivery'
    case 'scope-stopped':
      return 'the owning manager stopped before delivery'
    case 'runtime-error':
      return 'delivery outcome is unknown after a runtime error'
  }
}

/**
 * The worker-cancel ACKNOWLEDGER — the runtime-side half of `run-layout`'s `cancelWorker`
 * contract, run from the coordination driver's turn loop (one cancellation-inbox read per turn,
 * no new process, no poller, no extra lifetime). Every manager with a `controlDir` mounts one;
 * OWNERSHIP keeps them from colliding: a request naming a node id is owned by the manager whose
 * own id is that node's parent, and a label/profile-name reference is owned by the `'run'`-scoped
 * (root) manager only — so exactly one acknowledger can ever apply one operation.
 *
 * Two-phase, honestly reported: `cancel_requested` is written the moment a live worker's abort is
 * issued (through the per-child abort chain the scope already owns, so siblings are untouched);
 * `cancelled` is written only when that worker's settlement is DELIVERED on the settle path with
 * a terminal `down`, and then the record names every subtree node id proven terminated. A worker
 * that already settled — or that settles `done` despite the abort — records `not_live`; a
 * reference matching nothing this manager owns stays pending (`cancelWorker` reports it
 * `unknown`). No path reports success for a missing worker.
 *
 * Expiry is run end, not a clock: `finish()` (after the final post-drain pass) writes `not_live`
 * for every owned request never applied and `unknown` for an issued abort whose settle the run
 * ended too soon to observe. A pending request can therefore never outlive its run and abort a
 * future spawn that happens to reuse a label.
 *
 * Idempotency is a lookup, in-process and across processes: an operation with a durable
 * acknowledgement is returned as-is and never re-applied.
 */
export function createCancelAcknowledger(deps: CancelAcknowledgerDeps): {
  /** `'turn'` = a driver turn boundary (the only phase that APPLIES a request); `'final'` = the
   *  post-drain pass, which only reconciles records the run already wrote. */
  pass(phase: 'turn' | 'final'): void
  finish(): void
} {
  const tracked = new Map<string, WorkerCancellation>()
  // The run-scoped operation this manager has already applied, so its abort is issued once.
  let runTracked: RunCancellation | undefined
  // The abort-issue instant per operation (the `observedAt` written on its `cancel_requested`
  // record) — the terminated-set window survives the record moving to `cancelled`.
  const abortIssuedAt = new Map<string, string>()
  const iso = () => new Date(deps.now()).toISOString()

  const write = (record: WorkerCancellation): void => {
    writeWorkerCancellation(deps.dir, record)
    tracked.set(record.operationId, record)
  }

  /** `ref` is exactly one of THIS manager's direct-child node ids (`${ownerId}:s<seq>`). */
  const directChildId = (ref: string): boolean =>
    ref.startsWith(`${deps.ownerId}:s`) && /^s\d+$/.test(ref.slice(deps.ownerId.length + 1))

  /** Whether this acknowledger owns `ref`. A node id deeper in this subtree belongs to the nested
   *  manager that parents it; anything that is not a node id under this manager is a
   *  label/profile-name reference, owned by the `'run'`-scoped manager alone. */
  const owned = (ref: string): boolean => {
    if (directChildId(ref)) return true
    if (deps.controlScope !== 'run') return false
    return !ref.startsWith(`${deps.ownerId}:`) && ref !== deps.ownerId
  }

  // Terminal knowledge of one node, visible only once its settlement was DELIVERED (the ledger
  // row, or the view status `finalizeSettlement` stamps on the pull). 'down' = it died.
  const deliveredTerminal = (id: string): 'down' | 'done' | undefined => {
    const row = deps.coord.settled().find((w) => w.id === id)
    if (row !== undefined) return row.status
    const node = deps.scope.view.nodes.find((n) => n.id === id)
    if (node === undefined) return undefined
    if (node.status === 'done') return 'done'
    if (node.status === 'failed' || node.status === 'cancelled') return 'down'
    return undefined
  }

  const apply = (request: WorkerCancelRequest): void => {
    const aborted = deps.coord.abortWorker(request.worker, request.reason ?? 'cancel requested')
    const base = {
      operationId: request.operationId,
      worker: request.worker,
      requestedAt: request.at,
      observedAt: iso(),
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    }
    if (aborted !== undefined) {
      abortIssuedAt.set(request.operationId, base.observedAt)
      write({
        ...base,
        effect: 'cancel_requested',
        workerId: aborted.id,
        detail: `abort issued to live worker '${aborted.label}' (${aborted.id}); termination not yet proven`,
        terminated: [],
      })
      return
    }
    // Not live. A reference that matches a node whose settlement was already delivered is
    // answered `not_live`; a reference matching nothing stays pending — never a success either
    // way, and a worker that appears later can still be cancelled by a later pass.
    const settledNode = deps.scope.view.nodes.find(
      (n) =>
        (n.id === request.worker || n.label === request.worker) && isTerminalNodeStatus(n.status),
    )
    const goneId = settledNode?.id ?? deps.coord.settled().find((w) => w.id === request.worker)?.id
    if (goneId !== undefined) {
      write({
        ...base,
        effect: 'not_live',
        workerId: goneId,
        detail: `worker '${goneId}' had already settled before this operation was applied`,
        terminated: [],
      })
    }
  }

  /** The proven-terminated set for one record: the worker plus every subtree id with a terminal
   *  journal record at/after the abort was issued. Union with what the record already names, so
   *  the set only ever grows (a late teardown journal adds; nothing removes). */
  const provenTerminated = (record: WorkerCancellation, workerId: string): string[] => {
    const since = abortIssuedAt.get(record.operationId) ?? record.observedAt
    const ids = new Set<string>([
      ...record.terminated,
      workerId,
      ...terminatedDescendants(deps.dir, workerId, since),
    ])
    return [...ids].sort()
  }

  const reconcile = (record: WorkerCancellation): void => {
    const workerId = record.workerId
    if (workerId === undefined) return
    const terminal = deliveredTerminal(workerId)
    if (terminal === undefined) return
    if (terminal === 'down') {
      write({
        ...record,
        effect: 'cancelled',
        observedAt: iso(),
        terminated: provenTerminated(record, workerId),
        detail: `worker '${workerId}' reached a terminal down state on the settle path`,
      })
      return
    }
    // The worker finished `done` despite the abort request — its result stands, so this
    // operation terminated nothing and must not read as a successful cancellation.
    write({
      ...record,
      effect: 'not_live',
      observedAt: iso(),
      terminated: [],
      detail: `worker '${workerId}' settled done despite the abort request; nothing was terminated`,
    })
  }

  /** Re-scan a `cancelled` record while the manager still turns: a descendant whose teardown
   *  journals after the lead's settle joins the set on a later pass instead of being lost. Only
   *  a grown set is re-written; the window needs the in-process abort instant, so a record a
   *  PRIOR process closed stays as that process proved it. */
  const regrow = (record: WorkerCancellation): void => {
    const workerId = record.workerId
    if (workerId === undefined || !abortIssuedAt.has(record.operationId)) return
    const terminated = provenTerminated(record, workerId)
    if (terminated.length > record.terminated.length) {
      write({ ...record, observedAt: iso(), terminated })
    }
  }

  /**
   * The RUN-scoped request: seen once, `cancel_requested` written the moment the run's cascading
   * abort is issued through the one controller the run already has. The `supervise()` settle path
   * records what the run then actually did — this manager cannot observe its own tree's terminal
   * state from inside `act`.
   *
   * Applied only at a TURN boundary, never on the final post-drain pass: by then the driver has
   * finished and drained, so a root abort could only void work that is already delivered. A
   * request that arrives that late expires in `finish()` instead — it terminated nothing.
   */
  const passRun = (): void => {
    if (deps.controlScope !== 'run' || deps.abortRun === undefined) return
    const request = readRunCancelRequest(deps.dir)
    if (request === undefined) return
    if (runTracked !== undefined) return
    const prior = readRunCancellation(deps.dir, request.operationId)
    if (prior !== undefined) {
      runTracked = prior
      return
    }
    const record: RunCancellation = {
      operationId: request.operationId,
      effect: 'cancel_requested',
      requestedAt: request.at,
      observedAt: iso(),
      ...(request.reason === undefined ? {} : { reason: request.reason }),
      detail: 'root abort issued to the whole run; termination not yet proven',
    }
    writeRunCancellation(deps.dir, record)
    runTracked = record
    deps.abortRun(request.reason ?? 'run cancel requested')
  }

  const pass = (phase: 'turn' | 'final'): void => {
    if (phase === 'turn') passRun()
    for (const request of readWorkerCancelRequests(deps.dir)) {
      if (!owned(request.worker)) continue
      let record = tracked.get(request.operationId)
      if (record === undefined) {
        // Cross-process idempotency: an acknowledgement a prior process wrote wins over
        // re-applying the operation.
        record = readWorkerCancellation(deps.dir, request.operationId)
        if (record !== undefined) tracked.set(request.operationId, record)
      }
      if (record === undefined) {
        apply(request)
        continue
      }
      if (record.effect === 'cancel_requested') reconcile(record)
      else if (record.effect === 'cancelled') regrow(record)
    }
  }

  return {
    pass,
    finish(): void {
      const runRequest =
        deps.controlScope === 'run' && deps.abortRun !== undefined
          ? readRunCancelRequest(deps.dir)
          : undefined
      if (
        runRequest !== undefined &&
        readRunCancellation(deps.dir, runRequest.operationId) === undefined
      ) {
        // The request landed after the last turn boundary. The run is over, so it terminated
        // nothing — recording it here keeps a reader from seeing an operation that never resolves.
        writeRunCancellation(deps.dir, {
          operationId: runRequest.operationId,
          effect: 'not_live',
          requestedAt: runRequest.at,
          observedAt: iso(),
          ...(runRequest.reason === undefined ? {} : { reason: runRequest.reason }),
          detail: 'run ended before the request was applied',
        })
      }
      for (const request of readWorkerCancelRequests(deps.dir)) {
        if (!owned(request.worker)) continue
        const record =
          tracked.get(request.operationId) ?? readWorkerCancellation(deps.dir, request.operationId)
        if (record === undefined) {
          // Never applied and the run is over: the request expires as `not_live` so it cannot
          // linger and abort a future spawn that matches by label — and never reads as success.
          write({
            operationId: request.operationId,
            worker: request.worker,
            effect: 'not_live',
            requestedAt: request.at,
            observedAt: iso(),
            ...(request.reason === undefined ? {} : { reason: request.reason }),
            detail: 'run ended before the request was applied',
            terminated: [],
          })
          continue
        }
        if (record.effect === 'cancel_requested') {
          // The abort went out but act is returning before the settle path could prove the
          // termination. `unknown` is the honest terminal: not in progress, never a success.
          write({
            ...record,
            effect: 'unknown',
            observedAt: iso(),
            detail: 'abort issued; run ended before termination was observed',
          })
        }
      }
    },
  }
}

/**
 * Subtree node ids with a terminal `down`/`cancelled` journal record at or after `sinceIso` —
 * the abort-issue instant (the acknowledger's own `observedAt` on the `cancel_requested` record,
 * runtime clock), never the client's `requestedAt` — read from the durable spawn journal beside
 * the run layout. The set is proven at acknowledgement time and is approximate about post-abort
 * causation: a descendant that died of its OWN cause after the abort was issued is
 * indistinguishable from the cascade and may be included; one whose teardown journals late joins
 * on a later acknowledger pass; a teardown journal still absent when the run ends is absent from
 * the set. Ids are hierarchical (`parent:sN`), so `${nodeId}:` prefixes exactly the subtree.
 * Tolerant of a missing or partially-written journal: evidence that cannot be read names fewer
 * nodes, never wrong ones.
 */
function terminatedDescendants(dir: string, nodeId: string, sinceIso: string): string[] {
  let raw: string
  try {
    raw = readFileSync(join(dir, SPAWN_JOURNAL_FILE), 'utf8')
  } catch {
    return []
  }
  const prefix = `${nodeId}:`
  const ids = new Set<string>()
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: { kind?: unknown; event?: Record<string, unknown> }
    try {
      parsed = JSON.parse(trimmed) as { kind?: unknown; event?: Record<string, unknown> }
    } catch {
      continue
    }
    if (parsed.kind !== 'event' || parsed.event === undefined) continue
    const event = parsed.event
    const died = (event.kind === 'settled' && event.status === 'down') || event.kind === 'cancelled'
    if (!died) continue
    if (typeof event.id !== 'string' || !event.id.startsWith(prefix)) continue
    if (typeof event.at !== 'string' || event.at < sinceIso) continue
    ids.add(event.id)
  }
  return [...ids].sort()
}

/**
 * Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a
 * `driverChild` (`driver-executor.ts`) to run it inside a nested scope, recursively.
 */
export function driverAgent(opts: DriverAgentOptions): Agent<unknown, unknown> {
  if (typeof opts.brain !== 'function') {
    throw new ValidationError('driverAgent: opts.brain must be a function')
  }
  // Fail loud on a half-wired work-tool seam: extra tool specs with no executor (or an executor
  // with no specs the model can see) is a silent no-op the house rules forbid.
  if ((opts.extraTools?.length ?? 0) > 0 && typeof opts.executeExtraTool !== 'function') {
    throw new ValidationError(
      'driverAgent: extraTools requires executeExtraTool (how to run a work-tool call)',
    )
  }
  // Fail loud on a half-wired analyst seam (matches the extraTools pattern): analyze-on-settle with no
  // lens registry is a silent no-op the house rules forbid — the driver would get no findings, no error.
  // Only LENS routes resolve against the registry; an agent route carries its own analyst profile.
  if (
    (opts.analyzeOnSettle ?? [])
      .map(normalizeAnalyzeOnSettle)
      .some((route) => route.agent === undefined) &&
    !opts.analysts
  ) {
    throw new ValidationError(
      'driverAgent: analyzeOnSettle requires analysts (the lens registry the kinds resolve against)',
    )
  }
  // A work tool that shadows a coordination verb would leave the driver unable to coordinate.
  // Validate against the reserved verb set HERE (construction), so the conflict fails loud — not
  // buried inside act() where the supervisor would swallow the throw into a quiet no-winner.
  const reserved = new Set<string>(coordinationVerbNames)
  for (const tool of opts.nodeTools ?? []) {
    if (reserved.has(tool.name)) {
      throw new ValidationError(
        `driverAgent: node tool "${tool.name}" collides with a coordination verb or another node tool`,
      )
    }
    reserved.add(tool.name)
  }
  for (const t of opts.extraTools ?? []) {
    if (reserved.has(t.name)) {
      throw new ValidationError(
        `driverAgent: extra work tool "${t.name}" collides with a coordination verb or node tool`,
      )
    }
    reserved.add(t.name)
  }
  // Fail loud on a nonsensical cap: a negative maxTurns would silently run zero turns and
  // finalize an empty no-winner — a silent zero the house rules forbid.
  if (opts.maxTurns !== undefined && opts.maxTurns < 0) {
    throw new ValidationError(
      'driverAgent: maxTurns must be >= 0 (0 lifts the turn cap; bounds become the conserved pool + deadline + abort)',
    )
  }
  // maxTurns=0 lifts the turn-count cap exactly. The conserved pool, deadline, abort, and explicit
  // stop remain the caller-visible bounds; Runtime does not substitute a hidden sentinel.
  const maxTurns = opts.maxTurns ?? 16
  const now = opts.now ?? Date.now
  const inbox = opts.inbox ?? createInbox()

  return {
    name: opts.name,
    deliver(message): boolean {
      return inbox.deliver(message)
    },
    async act(task, scope: Scope<unknown>): Promise<unknown> {
      const coord = createCoordinationTools({
        scope,
        blobs: opts.blobs,
        makeWorkerAgent: opts.makeWorkerAgent,
        ...(opts.authorizeDownMessage ? { authorizeDownMessage: opts.authorizeDownMessage } : {}),
        perWorker: opts.perWorker,
        ...(opts.deliverable ? { deliverable: opts.deliverable } : {}),
        ...(opts.maxLiveWorkers !== undefined ? { maxLiveWorkers: opts.maxLiveWorkers } : {}),
        ...(opts.analysts ? { analysts: opts.analysts } : {}),
        ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
        ...(opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {}),
        ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
        ...(opts.continuityByProfile ? { continuityByProfile: opts.continuityByProfile } : {}),
        ...(opts.preflightSpawn ? { preflightSpawn: opts.preflightSpawn } : {}),
        ...(opts.resolveSpawnProfile ? { resolveSpawnProfile: opts.resolveSpawnProfile } : {}),
        ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
        ...(opts.replaySettlements ? { replaySettlements: true } : {}),
        ...(opts.priorCoordination?.questions.length
          ? { priorQuestions: opts.priorCoordination.questions }
          : {}),
      })
      await coord.ready()
      // Before the first brain turn: a node tool invoked on turn one must already be able to call
      // these verbs.
      opts.onCoordinationTools?.(coord.tools)
      // The worker-cancel acknowledger, mounted only for a durable run that named its layout dir.
      // It runs inside this existing turn loop — the one place that already runs every turn and
      // already holds the child handles — so external cancellation needs no second lifetime.
      const acknowledger =
        opts.controlDir === undefined
          ? undefined
          : createCancelAcknowledger({
              dir: opts.controlDir,
              coord,
              scope,
              now,
              ownerId: scope.view.root,
              controlScope: opts.controlScope ?? 'run',
              ...(opts.abortRun ? { abortRun: opts.abortRun } : {}),
            })
      const steerAcknowledger =
        opts.controlDir === undefined
          ? undefined
          : createSteerAcknowledger({
              dir: opts.controlDir,
              coord,
              now,
              ownerId: scope.view.root,
            })
      // Resume-first: re-establish the prior process's supervision state BEFORE the first brain
      // turn — its armed-but-never-woken waits become live again on their ORIGINAL deadlines
      // (they settle through the same cursor `await_event` drains). Fail loud on a wait that
      // cannot be re-armed: silently dropping supervision state is worse than stopping.
      for (const w of scope.resume?.waits ?? []) {
        const rearmed = scope.wait(w.spec, { label: w.label })
        if (!rearmed.ok) {
          throw new RuntimeRunStateError(
            `driverAgent: cannot re-arm resumed wait '${w.label}' (${rearmed.reason})`,
          )
        }
      }
      const byName = new Map<string, McpToolDescriptor>(
        [...coord.tools, ...(opts.nodeTools ?? [])].map((t) => [t.name, t]),
      )
      const toolSpecs: ToolSpec[] = [
        ...coord.tools.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
        ...(opts.nodeTools ?? []).map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
        // Work tools the driver calls DIRECTLY — so it can ACT, not only delegate.
        ...(opts.extraTools ?? []).map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      ]
      const system =
        typeof opts.systemPrompt === 'function' ? opts.systemPrompt(task) : opts.systemPrompt

      // Built only when a rule is configured, so a run without one allocates and evaluates nothing.
      const tracker = opts.stopRule ? createProgressTracker({ now }) : undefined
      let progressStopReason: string | undefined

      // Meter the driver's OWN inference on EVERY turn into the conserved pool — the largest single
      // token consumer in the loop, and what makes maxTurns=0 genuinely bounded (a thinking driver
      // drains the pool → poolStarved). Driver turns never consume the child-iteration budget;
      // failed inference stays visible through unknown token/USD channels and journal detail.
      //
      // There is deliberately no branch that skips `scope.meter`. A turn whose brain reported no
      // usage is metered as an UNKNOWN turn (`tokensKnown: false`), not omitted: omitting it let the
      // pool and the journal record a turn that ran as a turn that cost nothing, which is the one
      // thing this package forbids — a missing measurement is never zero. The unknown turn debits
      // the zero it actually knows and permanently marks `pool.readout().tokensKnown` false, so a
      // reader of `tokensLeft` can see the balance is a ceiling rather than a measurement. A
      // scripted/mock turn takes this path too, so offline equal-k still debits exactly zero tokens.
      let driverTurn = 0
      let driverCall = 0
      const meteredBrain = async (
        messages: ReadonlyArray<Record<string, unknown>>,
        tools: ReadonlyArray<ToolSpec>,
        detail: Record<string, unknown>,
      ) => {
        let res: Awaited<ReturnType<typeof opts.brain>>
        const call = driverCall
        driverCall += 1
        const callContext: ToolLoopCallContext = Object.freeze({
          signal: scope.signal,
          callId: `${scope.view.root}:brain:${crypto.randomUUID()}`,
          correlationId: scope.view.root,
        })
        try {
          res = await opts.brain(messages, tools, callContext)
        } catch (error) {
          // Calling the brain is the provider-attempt boundary. A rejection after that boundary
          // carries no trusted served identity, so preserve an empty attempt for root settlement.
          opts.onProviderModel?.(undefined)
          await meterRuntimeOwnedProviderAttempt(
            scope,
            unmeteredSpend(0),
            providerAttemptEvidence(undefined),
            {
              driver: opts.name,
              inferenceFailed: true,
              call,
              callId: callContext.callId,
              correlationId: callContext.correlationId,
              ...detail,
            },
          )
          throw error
        }
        let evidenceError: ValidationError | undefined
        opts.onProviderModel?.(res.model)
        if (opts.expectedModel !== undefined) {
          if (res.model === undefined) {
            evidenceError = new ValidationError(
              `driverAgent: Router response omitted model identity; expected ${JSON.stringify(opts.expectedModel)}`,
            )
          } else if (res.model !== opts.expectedModel) {
            evidenceError = new ValidationError(
              `driverAgent: Router response reported model ${JSON.stringify(res.model)}; expected ${JSON.stringify(opts.expectedModel)}`,
            )
          }
        }
        if (
          res.transportAttempts !== undefined &&
          (!Number.isSafeInteger(res.transportAttempts) || res.transportAttempts < 1)
        ) {
          evidenceError = new ValidationError(
            'driverAgent: transportAttempts must be a positive safe integer when reported',
          )
        }
        evidenceError = validateDriverPromptCache(res.promptCache) ?? evidenceError
        const trustedCost =
          res.costProvenance === 'provider-receipt' || res.costProvenance === 'billing-receipt'
        const cacheUsage = promptCacheTokenClasses(res.usage?.input, res.promptCache)
        const turnSpend: Spend = {
          iterations: 0,
          tokens: {
            input: res.usage?.input ?? 0,
            output: res.usage?.output ?? 0,
            ...cacheUsage,
          },
          ...(res.usage === undefined ? { tokensKnown: false } : {}),
          usd: trustedCost ? (res.costUsd ?? 0) : 0,
          ...(trustedCost && res.costUsd !== undefined ? {} : { usdKnown: false }),
          ms: 0,
        }
        await meterRuntimeOwnedProviderAttempt(
          scope,
          turnSpend,
          providerAttemptEvidence(res.model),
          {
            driver: opts.name,
            call,
            callId: callContext.callId,
            correlationId: callContext.correlationId,
            toolCalls: (res.toolCalls ?? []).map((c) => c.name),
            ...(res.model !== undefined ? { model: res.model } : {}),
            ...(res.transportAttempts !== undefined
              ? { transportAttempts: res.transportAttempts }
              : {}),
            ...(res.usage?.reasoning !== undefined ? { reasoningTokens: res.usage.reasoning } : {}),
            ...(res.promptCache !== undefined ? { promptCache: res.promptCache } : {}),
            // The streamed transport says explicitly when it finished with no usage chunk (a broken
            // `include_usage` contract), which is a different fact from a brain that never reports
            // usage at all. Recorded on the turn so the journal distinguishes them.
            ...(res.usageUnknown === true ? { streamUsageMissing: true } : {}),
            ...(res.costProvenance === 'catalog-estimate' ? { estimatedCostUsd: res.costUsd } : {}),
            ...detail,
          },
        )
        if (evidenceError !== undefined) throw evidenceError
        return res
      }
      const chat: ToolLoopChat = async (messages, tools) => {
        const turn = driverTurn
        const res = await meteredBrain(messages, tools, {
          kind: 'driver-inference',
          turn,
        })
        driverTurn += 1
        return res
      }

      // Chapter-close on the brain's own window. The default distiller pairs the factual settled-worker
      // roster (from the live scope) with a brain-authored progress note; the brain call runs through
      // the metered `chat`, so the one-time O(history) distill cost debits the conserved pool like any
      // turn. It replaces the per-turn O(history) re-billing it removes.
      const compaction: ToolLoopCompaction | undefined = opts.compaction
        ? {
            thresholdTokens: opts.compaction.thresholdTokens,
            distill:
              opts.compaction.distill ??
              (async (msgs) => {
                const roster = summarizeRoster(scope.view, coord.settled())
                try {
                  const res = await meteredBrain(
                    [...msgs, { role: 'user', content: distillInstruction }],
                    [],
                    { kind: 'driver-compaction', compactingTurn: driverTurn },
                  )
                  const narrative = (res.content ?? '').trim()
                  return narrative ? `${roster}\n\n## Progress notes\n${narrative}` : roster
                } catch (e) {
                  return `${roster}\n\n## Progress notes\nSummary unavailable: ${errMessage(e)}`
                }
              }),
            ...(opts.compaction.onCompact ? { onCompact: opts.compaction.onCompact } : {}),
            ...(opts.compaction.preserveHead !== undefined
              ? { preserveHead: opts.compaction.preserveHead }
              : {}),
            ...(opts.compaction.estimateTokens
              ? { estimateTokens: opts.compaction.estimateTokens }
              : {}),
          }
        : undefined

      await runBrainLoop({
        chat,
        tools: toolSpecs,
        ...(compaction ? { compaction } : {}),
        execute: async (name, args) => {
          // WORK FIRST: a work tool the driver runs itself (act). A non-null return is handled here;
          // null/undefined means "not mine" → fall through to the coordination dispatch (spawn/await/…).
          if (opts.executeExtraTool) {
            const worked = await runExtraTool(opts.executeExtraTool, name, args)
            if (worked !== null && worked !== undefined) return worked
          }
          const tool = byName.get(name)
          const result = tool ? await runTool(tool, args) : { error: `unknown tool: ${name}` }
          return safeJson(result)
        },
        initialMessages: [
          { role: 'system', content: system },
          { role: 'user', content: stringifyTask(task) },
          // The resume brief: on a resumed run the brain's FIRST context already carries the
          // committed settlements, the key states, the re-armed waits, carried-over questions/
          // findings, and the spend the run already paid — so it continues from the unresolved
          // work instead of re-planning (and re-paying) from scratch.
          ...(scope.resume
            ? [{ role: 'user', content: resumeBrief(scope.resume, opts.priorCoordination) }]
            : hasPriorCoordination(opts.priorCoordination)
              ? [
                  {
                    role: 'user',
                    content: priorCoordinationBrief(opts.priorCoordination as PriorCoordination),
                  },
                ]
              : []),
        ],
        maxTurns,
        // The conserved-pool + deadline + external-stop bound (what maxTurns=0 relies on): a driver
        // that can no longer spawn (pool starved) or has run past the deadline stops here instead of
        // burning turns. Checked before each inference turn.
        hooks: {
          beforeTurn: async (_turn, messages) => {
            await steerAcknowledger?.pass('turn')
            acknowledger?.pass('turn')
            const pending = inbox.drain()
            if (pending.length > 0) {
              messages.push({ role: 'user', content: inbox.fold(pending) })
            }
          },
          stopBefore: () => {
            // HARD CEILINGS FIRST, and independently — a progress rule may never keep a run alive
            // past one, so they are not folded into the same expression.
            if (
              coord.isStopped() ||
              scope.signal.aborted ||
              poolStarved(scope, opts.perWorker) ||
              deadlinePassed(scope, now)
            ) {
              return true
            }
            if (!opts.stopRule || !tracker) return false
            const decision = progressStop(
              tracker,
              opts.stopRule,
              coord,
              scope,
              now,
              opts.stallAfterMs,
            )
            if (!decision.stop) return false
            // `stopBefore` is a predicate the loop may consult more than once; the callback is a
            // one-shot notification, so it fires on the FIRST stop only.
            if (progressStopReason === undefined) {
              progressStopReason = decision.reason
              opts.onProgressStop?.(decision.reason)
            }
            return true
          },
        },
      })
      // Drain every already-settled child the brain never pulled — a gate-verified delivery must
      // never be lost to the driver's pull discipline (e.g. a brain that spawned and stopped
      // without awaiting). Non-blocking: live children are the supervisor's to tear down.
      await coord.drainResolved()
      // Final acknowledgement pass over the drained ledger, so a cancellation whose worker
      // settled after the last turn's pass still records its terminal effect before act returns.
      // Then expiry: run end closes every owned request that is still open (`not_live` never
      // applied, `unknown` issued-but-unproven) — a reader can tell run-over from in-progress,
      // and no pending request survives to abort a future spawn that matches by label.
      await steerAcknowledger?.pass('final')
      acknowledger?.pass('final')
      acknowledger?.finish()
      // Direct work is eligible only through `submit_result`, after the same injected independent
      // check workers face. Raw driver prose remains ineligible. The first passing submission wins;
      // otherwise finalize over delivered children as before.
      const submitted = coord.submittedResult()
      if (submitted) return submitted.result
      return runFinalizer(opts.finalizer ?? bestDelivered, {
        settled: coord.settled(),
        blobs: opts.blobs,
        tree: runTree(scope),
        budget: scope.budget,
      })
    },
  }
}

/**
 * The factual context a resumed driver starts from — everything the durable stores prove about
 * the prior process(es): committed settlements, per-key states (completed / lost / failed),
 * re-armed waits, carried-over questions/findings/continuation receipts, and spend already paid.
 * Injected as the brain's first user-context on a resumed run so it continues from unresolved work;
 * old continuation receipts are evidence and are never auto-delivered.
 */
function resumeBrief(resume: ResumedWork<unknown>, prior?: PriorCoordination): string {
  const lines: string[] = [
    'RESUME: this run continues a prior coordinator process. Its committed work is restored',
    'below and already counts toward the deliverable — do NOT redo it. Continue from the',
    'unresolved work only.',
    '',
    `Committed workers (${resume.settled.length}):`,
  ]
  if (resume.settled.length === 0) lines.push('- none')
  for (const s of resume.settled) {
    lines.push(
      s.kind === 'done'
        ? `- ${s.handle.id} (${s.handle.label}): done, score=${s.verdict?.score ?? 0}, valid=${
            s.verdict?.valid ?? false
          }, outRef=${s.outRef}`
        : `- ${s.handle.id} (${s.handle.label}): down, reason=${s.reason}`,
    )
  }
  const byState = (state: 'completed' | 'in-doubt' | 'down') =>
    [...resume.keys].filter(([, v]) => v.state === state)
  const completed = byState('completed')
  const lost = byState('in-doubt')
  const failed = byState('down')
  if (completed.length > 0) {
    lines.push(
      '',
      'COMPLETED keys — spawn_worker with the same key returns the finished result, spending nothing:',
      ...completed.map(([k, v]) => `- ${k} → ${v.id} (${v.label})`),
    )
  }
  if (lost.length > 0) {
    lines.push(
      '',
      'Keys LOST in flight with the prior process — this is the unresolved work; spawn_worker with the same key starts a fresh attempt:',
      ...lost.map(([k, v]) => `- ${k} (prior attempt ${v.id}, ${v.label})`),
    )
  }
  if (failed.length > 0) {
    lines.push(
      '',
      'Keys whose prior attempt FAILED (settled down) — spawn_worker with the same key retries:',
      ...failed.map(([k, v]) => `- ${k} (prior attempt ${v.id}, ${v.label})`),
    )
  }
  if (resume.waits.length > 0) {
    lines.push(
      '',
      'Pending waits RE-ARMED on their original deadlines (they settle through await_event):',
      ...resume.waits.map((w) => `- ${w.label} (${w.spec.kind})`),
    )
  }
  appendPriorCoordination(lines, prior)
  const spent = resume.priorSpend
  lines.push(
    '',
    'Budget the run ALREADY spent before this process (it counts toward the run total):',
    // `charged` is what the token cap debited: newly-presented tokens, not the rolled-up prompt
    // total, which counts a cached prefix again on every turn that reads it. A driver told the
    // rolled-up number would read a cache-heavy resume as near-exhaustion of a cap it has barely
    // touched.
    `- child work: tokens charged=${chargedTokens(spent.childWork.tokens)} (in=${spent.childWork.tokens.input} out=${spent.childWork.tokens.output}), usd=${spent.childWork.usd}, iterations=${spent.childWork.iterations}`,
    `- driver inference: tokens charged=${chargedTokens(spent.driverInference.tokens)} (in=${spent.driverInference.tokens.input} out=${spent.driverInference.tokens.output}), usd=${spent.driverInference.usd}`,
  )
  return lines.join('\n')
}

function hasPriorCoordination(prior?: PriorCoordination): boolean {
  return (
    prior !== undefined &&
    (prior.questions.length > 0 ||
      prior.findings.length > 0 ||
      prior.continuations.length > 0 ||
      prior.deliveryEvidence.length > 0)
  )
}

function priorCoordinationBrief(prior: PriorCoordination): string {
  const lines = [
    'PRIOR COORDINATION EVIDENCE: this logical supervisor ran in an earlier process.',
    'Use the evidence below as context. Never auto-deliver an old continuation; issue a new',
    'authorized instruction only when current live state still warrants it.',
  ]
  appendPriorCoordination(lines, prior)
  return lines.join('\n')
}

function appendPriorCoordination(lines: string[], prior?: PriorCoordination): void {
  const openQuestions = (prior?.questions ?? []).filter(
    (q) => q.status === 'open' || q.status === 'escalated',
  )
  if (openQuestions.length > 0) {
    lines.push(
      '',
      'Questions carried over, still undecided (answer_question decides them; list_questions shows all):',
      ...openQuestions.map(
        (q) => `- [${q.id}] from=${q.from}, urgency=${q.urgency}: ${q.question}`,
      ),
    )
  }
  if ((prior?.findings.length ?? 0) > 0) {
    lines.push(
      '',
      'Analyst findings from the prior process:',
      ...(prior?.findings ?? []).map(
        (f) => `- ${f.analyst} on ${f.fromWorker}: ${safeJson(f.findings)}`,
      ),
    )
  }
  if ((prior?.continuations.length ?? 0) > 0) {
    const attempts = new Set(
      (prior?.deliveryEvidence ?? [])
        .filter((event) => event.type === 'delivery-attempt')
        .map((event) => event.attempt.receiptId),
    )
    const outcomes = new Map(
      (prior?.deliveryEvidence ?? [])
        .filter((event) => event.type === 'steer' || event.type === 'answer')
        .map((event) => [event.down.receiptId, event.down.outcome] as const),
    )
    lines.push(
      '',
      'Authorized continuations committed by the prior process (evidence only; never replayed automatically):',
      ...(prior?.continuations ?? []).map((continuation) => {
        const outcome = outcomes.get(continuation.receiptId)
        const delivery =
          outcome ??
          (attempts.has(continuation.receiptId)
            ? 'unknown-after-crash'
            : 'not-attempted-before-crash')
        return `- receipt=${continuation.receiptId}, ${continuation.kind} → ${continuation.toWorker}, instruction=${continuation.instructionDigest}, delivery=${delivery}`
      }),
    )
  }
}

/** Run a work tool. A throw is data to the driver (it can recover next turn), not a crash — fold
 *  the error back as a string result. null/undefined passes through (the caller treats it as "not
 *  handled" and falls to the coordination dispatch). */
async function runExtraTool(
  execute: (name: string, args: Record<string, unknown>) => Promise<string | null | undefined>,
  name: string,
  args: Record<string, unknown>,
): Promise<string | null | undefined> {
  try {
    return await execute(name, args)
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function runTool(tool: McpToolDescriptor, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await tool.handler(args)
  } catch (e) {
    // A tool throw is data to the driver (it can recover), not a crash — fold it back.
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Keep-best finalize under the completion-oracle: return the highest-scoring DELIVERED child's
 *  output (settled `done` AND `valid` — its deliverable check passed). Returns undefined when no
 *  child delivered — an honest "the driver produced nothing", never a high-scoring result that
 *  ran without passing its check (Foreman's 0/18 lesson). `valid` is the single delivery signal,
 *  matching `defaultSelectWinner`'s valid-first rule; the oracle just doesn't fall back to an
 *  unchecked best-effort. The same argmax as the `bestDelivered` finalizer (`pickBestDelivered`);
 *  this direct form serves callers that hold a bare ledger + blob store. */
export async function finalizeBestDelivered(
  settled: ReadonlyArray<{ status: string; score?: number; valid?: boolean; outRef?: string }>,
  blobs: ResultBlobStore,
): Promise<unknown> {
  const delivered = settled.filter((w) => w.status === 'done' && w.valid === true)
  const best = pickBestDelivered(delivered)
  if (best === undefined) return undefined
  return best.outRef ? await blobs.get(best.outRef) : undefined
}

function stringifyTask(task: unknown): string {
  return typeof task === 'string' ? task : safeJson(task)
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
