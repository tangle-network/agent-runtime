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
import type { Agent, Budget, ResultBlobStore, Scope } from './types'

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
  /** Max driver turns before the loop force-finalizes on the best settled child. Default 16. */
  readonly maxTurns?: number
}

/**
 * Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a
 * `driverChild` (`driver-executor.ts`) to run it inside a nested scope, recursively.
 */
export function coordinationDriverAgent(opts: CoordinationDriverOptions): Agent<unknown, unknown> {
  if (typeof opts.chat?.next !== 'function') {
    throw new ValidationError('coordinationDriverAgent: opts.chat.next must be a function')
  }
  const maxTurns = opts.maxTurns ?? 16

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
        if (coord.isStopped()) break
        const res = await opts.chat.next({ system, messages, tools: toolSpecs })
        const calls = res.toolCalls ?? []
        if (calls.length === 0) {
          // The driver named no tool call — it is finished. Its content is the answer; if it
          // gave none, fall back to the best settled child (keep-best, never a vacuous return).
          const answer = res.content ?? (await finalize(coord, opts.blobs))
          return answer
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

/** Keep-best finalize: return the highest-scoring settled child's output (read through blobs).
 *  Returns undefined when no child settled `done` — an honest "the driver produced nothing". */
async function finalize(
  coord: { settled(): ReadonlyArray<{ status: string; score?: number; outRef?: string }> },
  blobs: ResultBlobStore,
): Promise<unknown> {
  const done = coord.settled().filter((w) => w.status === 'done')
  if (done.length === 0) return undefined
  let best = done[0]!
  for (const w of done) if ((w.score ?? 0) > (best.score ?? 0)) best = w
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
