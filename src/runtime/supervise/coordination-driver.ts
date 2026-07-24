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
 * Recursion composes through `makeWorkerAgent`: `spawn_agent` resolves a `profile` to a
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

import { ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import {
  type AnalystRegistry,
  coordinationVerbNames,
  createCoordinationTools,
  type MakeWorkerAgent,
  type SettledWorker,
  type WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import type { ToolSpec } from '../router-client'
import {
  runBrainLoop,
  type ToolLoopChat,
  type ToolLoopCompaction,
  type ToolLoopCompactionOptions,
} from '../tool-loop'
import {
  createProgressTracker,
  type ProgressTracker,
  type StopDecision,
  type StopRule,
} from './stop-rules'
import type { Agent, Budget, NodeSnapshot, ResultBlobStore, Scope, Spend, TreeView } from './types'

export interface DriverAgentOptions {
  readonly name: string
  /** The driver-LLM seam — ONE inference turn over the conversation + the coordination tool specs
   *  (the canonical `ToolLoopChat`): a scripted mock offline, the router's tool-calling in
   *  production, or a sandboxed harness. The same seam every tool-loop uses; no bespoke shape. */
  readonly brain: ToolLoopChat
  /** Shared blob store — `observe_agent` reads settled outputs through it. */
  readonly blobs: ResultBlobStore
  /** Resolve a spawned `profile` to a worker LEAF or a driver child (the recursion seam). */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget
  /** Hard cap on simultaneously-LIVE workers — `spawn_agent` fails closed once this many are in
   *  flight (a concurrency fence on top of the conserved-pool fence). Omit/`<= 0` = no cap. */
  readonly maxLiveWorkers?: number
  /** The analyst lenses available to the driver. Required for `analyzeOnSettle` (and `run_analyst`).
   *  Unset → no analyst feed (status quo: the driver gets settled outputs, no findings). */
  readonly analysts?: AnalystRegistry
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each result re-enters as a
   *  `finding` the driver pulls and composes its next steer from. The UP-leg of the self-improving
   *  loop. Omit/empty = no auto-analysis (status quo). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string>
  /** Run the ONLINE detector panel over each worker's LIVE tool trace and raise a `finding` the
   *  moment it loops/error-storms — mid-run evidence to steer on, not a settle-time post-mortem.
   *  Omit = no online watching. */
  readonly watchWorkers?: WorkerWatchOptions
  /** Idle time after which `observe_agent` reports a worker as stalled (a derived read; nothing is
   *  killed). Omit = the runtime default. */
  readonly stallAfterMs?: number
  /** The driver's stance — a string, or built from the task (the worker-driver prompt /
   *  the generator). INJECTED so the prompt is a pluggable, optimizable role. */
  readonly systemPrompt: string | ((task: unknown) => string)
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

/** maxTurns=0 anti-runaway tripwire: a finite ceiling for the ONE case the conserved pool can't
 *  bound — a driver whose chat seam reports NO usage (so `scope.meter`/`pool.observe` is never
 *  called and its turns don't drain the pool). With a usage-reporting seam, driver inference now
 *  meters into the pool and `poolStarved` halts it; the pool + deadline + abort are the real bounds
 *  and no healthy run approaches this. */
const runawayTripwireTurns = 2000

/** Spawn-progress is impossible: the pool can't afford another worker AND nothing is in flight to
 *  await. A long-horizon driver bounded by the conserved pool stops here instead of spinning (the
 *  in-loop budget guard the turn cap alone never provided). Checks BOTH conserved channels: tokens
 *  (can't afford a worker) and usd (a usd-capped pool whose ceiling the driver's own metered
 *  inference has drained — `meter` debits usd, so without this a huge-token/small-usd pool would
 *  overspend usd up to the turn tripwire). */
function poolStarved(scope: Scope<unknown>, perWorker: Budget): boolean {
  const b = scope.budget
  if (b.reservedTokens > 0) return false // a child is in flight — await it, don't finalize early
  const tokenStarved = b.tokensLeft < perWorker.maxTokens
  const usdStarved = b.usdCapped && b.usdLeft <= 0
  return tokenStarved || usdStarved
}

/** The absolute wall-clock deadline (when the root set one) has passed. */
function deadlinePassed(scope: Scope<unknown>, now: () => number): boolean {
  const b = scope.budget
  return b.deadlineMs > 0 && now() >= b.deadlineMs
}

/**
 * The PROGRESS-derived stop, evaluated strictly AFTER the hard ceilings above.
 *
 * Ordering is the contract, not a detail: `poolStarved` / `deadlinePassed` / abort / the driver's
 * own stop are checked first and independently, so a stop rule can only ever ADD a stop — it can
 * never keep a run alive past a budget it has exhausted. The rule reads the settled-work ledger
 * (via the tracker) plus the live worker feed off the scope; it spends nothing to do so.
 */
function progressStop(
  tracker: ProgressTracker,
  rule: StopRule,
  coord: { settled(): ReadonlyArray<SettledWorker> },
  scope: Scope<unknown>,
  now: () => number,
  stallAfterMs: number | undefined,
): StopDecision {
  // Fold every settlement the coordination ledger has recorded. `record` is idempotent by worker
  // id, so pushing the whole roster each turn costs O(settled) and never double-counts. The
  // timestamp is when the DRIVER observed the settlement, which is the resolution a per-turn guard
  // has; `SettledWorker.settledAt` carries the real instant when the ledger recorded one.
  for (const w of coord.settled()) {
    tracker.record({
      id: w.id,
      at: w.settledAt ?? now(),
      ...(w.score !== undefined ? { objective: w.score } : {}),
      delivered: w.status === 'done' && w.valid === true,
    })
  }
  return tracker.evaluate(rule, scope, stallAfterMs !== undefined ? { stallAfterMs } : undefined)
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
  if ((opts.analyzeOnSettle?.length ?? 0) > 0 && !opts.analysts) {
    throw new ValidationError(
      'driverAgent: analyzeOnSettle requires analysts (the lens registry the kinds resolve against)',
    )
  }
  // A work tool that shadows a coordination verb would leave the driver unable to coordinate.
  // Validate against the reserved verb set HERE (construction), so the conflict fails loud — not
  // buried inside act() where the supervisor would swallow the throw into a quiet no-winner.
  const reserved = new Set<string>(coordinationVerbNames)
  for (const t of opts.extraTools ?? []) {
    if (reserved.has(t.name)) {
      throw new ValidationError(
        `driverAgent: extra work tool "${t.name}" collides with a coordination verb`,
      )
    }
  }
  // Fail loud on a nonsensical cap: a negative maxTurns would silently run zero turns and
  // finalize an empty no-winner — a silent zero the house rules forbid.
  if (opts.maxTurns !== undefined && opts.maxTurns < 0) {
    throw new ValidationError(
      'driverAgent: maxTurns must be >= 0 (0 lifts the turn cap; bounds become the conserved pool + deadline + abort)',
    )
  }
  // maxTurns=0 lifts the turn-COUNT cap: a long-horizon decomposition must not die on an
  // arbitrary number of turns. It is bounded instead by the conserved budget pool, an absolute
  // deadline, the driver's own stop, and abort — all checked in-loop below. The tripwire is a
  // pure anti-runaway guard, NOT the intended limit.
  const maxTurns = opts.maxTurns === 0 ? runawayTripwireTurns : (opts.maxTurns ?? 16)
  const now = opts.now ?? Date.now

  return {
    name: opts.name,
    async act(task, scope: Scope<unknown>): Promise<unknown> {
      const coord = createCoordinationTools({
        scope,
        blobs: opts.blobs,
        makeWorkerAgent: opts.makeWorkerAgent,
        perWorker: opts.perWorker,
        ...(opts.maxLiveWorkers !== undefined ? { maxLiveWorkers: opts.maxLiveWorkers } : {}),
        ...(opts.analysts ? { analysts: opts.analysts } : {}),
        ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
        ...(opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {}),
        ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
      })
      const byName = new Map<string, McpToolDescriptor>(coord.tools.map((t) => [t.name, t]))
      const toolSpecs: ToolSpec[] = [
        ...coord.tools.map((t) => ({
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

      // Meter the driver's OWN inference each turn into the conserved pool — the largest single
      // token consumer in the loop, and what makes maxTurns=0 genuinely bounded (a thinking driver
      // drains the pool → poolStarved). Wrapping the brain keeps the debit exactly where it was; a
      // scripted/mock turn reports no usage and meters nothing, so offline equal-k stays exact.
      // iterations:0 — the conserved iteration channel budgets CHILD rounds, not driver turns.
      let driverTurn = 0
      const meteredBrain = async (
        messages: ReadonlyArray<Record<string, unknown>>,
        tools: ReadonlyArray<ToolSpec>,
        detail: Record<string, unknown>,
      ) => {
        const res = await opts.brain(messages, tools)
        if (res.usage || res.costUsd !== undefined) {
          const turnSpend: Spend = {
            iterations: 0,
            tokens: { input: res.usage?.input ?? 0, output: res.usage?.output ?? 0 },
            usd: res.costUsd ?? 0,
            ms: 0,
          }
          await scope.meter(turnSpend, {
            driver: opts.name,
            toolCalls: (res.toolCalls ?? []).map((c) => c.name),
            ...detail,
          })
        }
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
        ],
        maxTurns,
        // The conserved-pool + deadline + external-stop bound (what maxTurns=0 relies on): a driver
        // that can no longer spawn (pool starved) or has run past the deadline stops here instead of
        // burning turns. Checked before each inference turn.
        hooks: {
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
      // The driver's deliverable is the best DELIVERED child (the completion-oracle), never its own
      // prose — a driver cannot self-declare done (Foreman 0/18). No delivered child → undefined.
      return finalize(coord, opts.blobs)
    },
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
 *  unchecked best-effort. */
export async function finalizeBestDelivered(
  settled: ReadonlyArray<{ status: string; score?: number; valid?: boolean; outRef?: string }>,
  blobs: ResultBlobStore,
): Promise<unknown> {
  const delivered = settled.filter((w) => w.status === 'done' && w.valid === true)
  if (delivered.length === 0) return undefined
  let best = delivered[0]!
  for (const w of delivered) if ((w.score ?? 0) > (best.score ?? 0)) best = w
  return best.outRef ? await blobs.get(best.outRef) : undefined
}

async function finalize(
  coord: {
    settled(): ReadonlyArray<{ status: string; score?: number; valid?: boolean; outRef?: string }>
  },
  blobs: ResultBlobStore,
): Promise<unknown> {
  return finalizeBestDelivered(coord.settled(), blobs)
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
