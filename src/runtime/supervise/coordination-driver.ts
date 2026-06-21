/**
 * @experimental
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
 */

import { ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import {
  coordinationVerbNames,
  createCoordinationTools,
  type MakeWorkerAgent,
} from '../../mcp/tools/coordination'
import type { ToolSpec } from '../router-client'
import { runBrainLoop, type ToolLoopChat } from '../tool-loop'
import type { Agent, Budget, ResultBlobStore, Scope, Spend } from './types'

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

      // Meter the driver's OWN inference each turn into the conserved pool — the largest single
      // token consumer in the loop, and what makes maxTurns=0 genuinely bounded (a thinking driver
      // drains the pool → poolStarved). Wrapping the brain keeps the debit exactly where it was; a
      // scripted/mock turn reports no usage and meters nothing, so offline equal-k stays exact.
      // iterations:0 — the conserved iteration channel budgets CHILD rounds, not driver turns.
      let turn = 0
      const chat: ToolLoopChat = async (messages, tools) => {
        const res = await opts.brain(messages, tools)
        if (res.usage || res.costUsd !== undefined) {
          const turnSpend: Spend = {
            iterations: 0,
            tokens: { input: res.usage?.input ?? 0, output: res.usage?.output ?? 0 },
            usd: res.costUsd ?? 0,
            ms: 0,
          }
          await scope.meter(turnSpend, {
            kind: 'driver-inference',
            driver: opts.name,
            turn,
            toolCalls: (res.toolCalls ?? []).map((c) => c.name),
          })
        }
        turn += 1
        return res
      }

      await runBrainLoop({
        chat,
        tools: toolSpecs,
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
          stopBefore: () =>
            coord.isStopped() ||
            scope.signal.aborted ||
            poolStarved(scope, opts.perWorker) ||
            deadlinePassed(scope, now),
        },
      })
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
