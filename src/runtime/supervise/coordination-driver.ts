/**
 * @experimental
 *
 * `coordinationDriverAgent` — the driver's BRAIN.
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
 * `coordinationDriverAgent` over its own nested scope (see `driver-executor.ts`). So an agent
 * drives an agent that drives an agent, each an LLM tool-loop, all on one conserved-budget
 * tree.
 *
 * Two seams are INJECTED so the loop runs offline with no creds and stays decoupled:
 *  - `chat` (`DriverChat`) — one driver-LLM turn; a test drives a scripted mock, production
 *    adapts the router's tool-calling.
 *  - `systemPrompt` — the driver's stance (the agent-eval worker-driver prompt / the prompt
 *    generator). Injected, never hardcoded — the prompt is a pluggable role.
 */

import { ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import { createCoordinationTools, type MakeWorkerAgent } from '../../mcp/tools/coordination'
import type { Agent, Budget, ResultBlobStore, Scope, Spend } from './types'

/** One tool call the driver LLM asks for this turn. */
export interface DriverToolCall {
  readonly id?: string
  readonly name: string
  readonly arguments: Record<string, unknown>
}

/** A turn in the driver↔tools conversation. Tool results ride back as `role: 'tool'`. */
export interface DriverMessage {
  readonly role: 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly toolCalls?: ReadonlyArray<DriverToolCall>
  readonly toolCallId?: string
  readonly name?: string
}

/** What the driver LLM returns each turn. No `toolCalls` => the driver is finished. */
export interface DriverTurn {
  readonly toolCalls?: ReadonlyArray<DriverToolCall>
  /** The driver's natural-language output — the answer when there are no tool calls. */
  readonly content?: string
  /** The driver LLM's OWN token usage for THIS turn — metered against the conserved pool so the
   *  driver's inference counts toward equal-k AND the in-loop budget guard. Omit for a scripted/
   *  mock turn (no real inference); production `routerDriverChat` forwards it from the router. */
  readonly usage?: { readonly input: number; readonly output: number }
  /** The turn's inference cost (usd), when the provider priced it. */
  readonly costUsd?: number
}

/** The injected driver-LLM seam: one turn over the conversation + the coordination tool specs. */
export interface DriverChat {
  next(input: {
    readonly system: string
    readonly messages: ReadonlyArray<DriverMessage>
    readonly tools: ReadonlyArray<{ name: string; description: string; parameters: unknown }>
  }): Promise<DriverTurn>
}

export interface CoordinationDriverOptions {
  readonly name: string
  /** The driver-LLM seam (scripted mock offline; router tool-calling in production). */
  readonly chat: DriverChat
  /** Shared blob store — `observe_worker` reads settled outputs through it. */
  readonly blobs: ResultBlobStore
  /** Resolve a spawned `profile` to a worker LEAF or a driver child (the recursion seam). */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget
  /** The driver's stance — a string, or built from the task (the worker-driver prompt /
   *  the generator). INJECTED so the prompt is a pluggable, optimizable role. */
  readonly systemPrompt: string | ((task: unknown) => string)
  /** Max driver turns before the loop force-finalizes on the best settled child. Default 16.
   *  `0` lifts the turn-COUNT cap: the loop is bounded instead by the conserved budget pool,
   *  an absolute deadline, the driver's own stop, and abort (checked in-loop). A finite
   *  anti-runaway tripwire still guards a degenerate driver that loops on a no-spawn tool. */
  readonly maxTurns?: number
  /** Injected clock for the in-loop absolute-deadline guard — keeps the deadline check
   *  deterministic in tests. Defaults to `Date.now`. */
  readonly now?: () => number
}

/** maxTurns=0 anti-runaway tripwire: a finite ceiling that only catches a DEGENERATE driver
 *  looping on a no-spawn tool (the driver's own inference tokens are not yet metered against
 *  the conserved pool, so they alone cannot drain it). The conserved pool + deadline + abort
 *  are the real bounds; no healthy run approaches this. */
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
export function coordinationDriverAgent(opts: CoordinationDriverOptions): Agent<unknown, unknown> {
  if (typeof opts.chat?.next !== 'function') {
    throw new ValidationError('coordinationDriverAgent: opts.chat.next must be a function')
  }
  // Fail loud on a nonsensical cap: a negative maxTurns would silently run zero turns and
  // finalize an empty no-winner — a silent zero the house rules forbid.
  if (opts.maxTurns !== undefined && opts.maxTurns < 0) {
    throw new ValidationError(
      'coordinationDriverAgent: maxTurns must be >= 0 (0 lifts the turn cap; bounds become the conserved pool + deadline + abort)',
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
      const toolSpecs = coord.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      }))
      const system =
        typeof opts.systemPrompt === 'function' ? opts.systemPrompt(task) : opts.systemPrompt
      const messages: DriverMessage[] = [{ role: 'user', content: stringifyTask(task) }]

      for (let turn = 0; turn < maxTurns; turn += 1) {
        if (coord.isStopped() || scope.signal.aborted) break
        // The conserved-pool + deadline bound — what maxTurns=0 relies on. A driver that can no
        // longer spawn a worker (pool starved) or has run past the deadline stops here instead of
        // burning turns; the turn cap alone never made the budget the real bound.
        if (poolStarved(scope, opts.perWorker) || deadlinePassed(scope, now)) break
        const res = await opts.chat.next({ system, messages, tools: toolSpecs })
        const calls = res.toolCalls ?? []
        // Meter the driver's OWN inference for this turn — the largest single token consumer in an
        // agentic loop, and the one the conserved pool never saw. Only when the turn carried real
        // usage: a scripted/mock turn meters nothing, so offline equal-k stays exact. This debit is
        // what makes maxTurns=0 genuinely bounded — a thinking driver drains the pool → poolStarved.
        if (res.usage || res.costUsd !== undefined) {
          const turnSpend: Spend = {
            // iterations:0 — the conserved iteration channel (`maxIterations`) budgets CHILD rounds,
            // not driver turns; counting turns there would conflate the two AND make a driver arm's
            // iteration count diverge from a blind arm's. The driver is bounded by maxTurns + the
            // token/usd pool; its turn COUNT stays observable via the per-turn `agent.turn` events.
            iterations: 0,
            tokens: { input: res.usage?.input ?? 0, output: res.usage?.output ?? 0 },
            usd: res.costUsd ?? 0,
            ms: 0,
          }
          scope.meter(turnSpend, {
            kind: 'driver-inference',
            driver: opts.name,
            turn,
            toolCalls: calls.map((c) => c.name),
          })
        }
        if (calls.length === 0) {
          // The driver named no tool call — it is finished. Its deliverable is the best DELIVERED
          // child (the completion-oracle), NOT its own prose: a driver cannot self-declare done
          // (Foreman 0/18). No delivered child → it delivered nothing — finalize returns undefined,
          // which the supervisor types as a no-winner instead of wrapping a self-reported answer.
          return finalize(coord, opts.blobs)
        }
        messages.push({ role: 'assistant', content: res.content ?? '', toolCalls: calls })
        for (const tc of calls) {
          const tool = byName.get(tc.name)
          const result = tool
            ? await runTool(tool, tc.arguments)
            : { error: `unknown tool: ${tc.name}` }
          messages.push({
            role: 'tool',
            ...(tc.id ? { toolCallId: tc.id } : {}),
            name: tc.name,
            content: safeJson(result),
          })
        }
      }
      // Turn cap (or an external stop) reached — finalize on the best settled child.
      return finalize(coord, opts.blobs)
    },
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
async function finalize(
  coord: {
    settled(): ReadonlyArray<{ status: string; score?: number; valid?: boolean; outRef?: string }>
  },
  blobs: ResultBlobStore,
): Promise<unknown> {
  const delivered = coord.settled().filter((w) => w.status === 'done' && w.valid === true)
  if (delivered.length === 0) return undefined
  let best = delivered[0]!
  for (const w of delivered) if ((w.score ?? 0) > (best.score ?? 0)) best = w
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
