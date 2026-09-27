/**
 * The shared toy domain for the optimization examples: drive a counter to a target with
 * an `increment` tool, scored by the env's OWN deployable check (never an LLM's opinion).
 * Both `strategy-suite` (compare strategies) and `strategy-evolution` (search for a better
 * one) reuse this so each example shows only its DISTINCT concept, not 60 lines of fixture.
 * A real domain opens a repo / browser / MCP server the same way.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { AgenticTask, ArtifactHandle, Environment } from '@tangle-network/agent-runtime/kernel'

/** The default target; `counterTask` can set another per task. */
export const target = 5
const counters = new Map<string, { count: number }>()

const taskTarget = (task: AgenticTask): number =>
  typeof task.meta?.target === 'number' ? task.meta.target : target

export const counterEnv: Environment = {
  name: 'counter',
  async open(_task) {
    const id = `counter-${Math.random().toString(36).slice(2, 8)}`
    counters.set(id, { count: 0 })
    return { id, surface: 'counter' } satisfies ArtifactHandle
  },
  async tools() {
    return [
      {
        type: 'function',
        function: {
          name: 'increment',
          description: 'Add 1 to the counter.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_count',
          description: 'Read the current counter value.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]
  },
  async call(handle, name) {
    const c = counters.get(handle.id)
    if (!c) return 'ERROR: no such counter'
    if (name === 'increment') {
      c.count += 1
      return `count is now ${c.count}`
    }
    if (name === 'read_count') return `count is ${c.count}`
    return `ERROR: unknown tool ${name}`
  },
  // The deployable CHECK — your own success criterion, never an LLM's opinion.
  async score(task, handle) {
    const goal = taskTarget(task)
    const count = counters.get(handle.id)?.count ?? 0
    return { passes: Math.min(count, goal), total: goal, errored: 0 }
  },
  async close(handle) {
    counters.delete(handle.id)
  },
}

/** One counter task with the given id and target. */
export const counterTask = (id: string, goal = target): AgenticTask => ({
  id,
  userPrompt: `You operate a counter with tools. Use the increment tool to bring the counter to exactly ${goal}. Use read_count to verify before you finish. Reply DONE when the count equals ${goal}.`,
  meta: { target: goal },
})

/** A router-shaped AgentProfile. A worker enables the counter's tools (`tools: true`), and
 *  `maxTurns` bounds the tool-loop turns of one shot. */
export function counterProfile(
  name: string,
  model: string,
  options: { systemPrompt?: string; maxTurns?: number; tools?: boolean } = {},
): AgentProfile {
  return {
    name,
    harness: 'cli-base',
    model: {
      provider: 'tangle-router',
      default: model,
      ...(options.maxTurns !== undefined ? { metadata: { maxTurns: options.maxTurns } } : {}),
    },
    ...(options.systemPrompt ? { prompt: { systemPrompt: options.systemPrompt } } : {}),
    ...(options.tools ? { tools: { increment: true, read_count: true } } : {}),
  }
}

// ── The offline worker: a deterministic `complete` transport (no server) ─────
// `worker.complete` is the injected completion transport: given the OpenAI request body
// it returns the parsed `/chat/completions` JSON the worker + analyst would have fetched. The same
// fn serves BOTH legs — the worker's tool-calling turns and the refine analyst's chat-only steer —
// exactly as a localhost mock endpoint would, but in-process. The live router is the drop-in upgrade.

interface ChatBody {
  messages?: Array<{ role?: string; content?: string | null }>
  tools?: Array<{ function?: { name?: string } }>
}

/** Highest `count is now N` (or `count is N`) seen in the prior tool results. */
function currentCount(messages: ChatBody['messages']): number {
  let count = 0
  for (const m of messages ?? []) {
    if (m.role !== 'tool' || typeof m.content !== 'string') continue
    const match = m.content.match(/count is(?: now)? (\d+)/)
    if (match) count = Math.max(count, Number(match[1]))
  }
  return count
}

/** The target the task prompt names. */
function promptTarget(messages: ChatBody['messages']): number {
  for (const m of messages ?? []) {
    const match = typeof m.content === 'string' ? m.content.match(/to exactly (\d+)/) : null
    if (match) return Number(match[1])
  }
  return target
}

/** Drive the counter: emit `increment` until the count hits the task's target, verify with
 *  `read_count`, then answer "DONE". With NO tools (the analyst's chat-only call) return a short
 *  steer string. Each call reports a small fixed usage and billed cost, so spend stays known. */
export async function offlineCounterComplete(body: Record<string, unknown>): Promise<unknown> {
  const req = body as ChatBody
  const message = (() => {
    if (!req.tools?.length) {
      return {
        role: 'assistant',
        content: 'Keep calling increment until read_count shows the target.',
      }
    }
    const count = currentCount(req.messages)
    if (count < promptTarget(req.messages)) {
      return {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: `call_${count}`,
            type: 'function',
            function: { name: 'increment', arguments: '{}' },
          },
        ],
      }
    }
    const verified = (req.messages ?? []).some((m) =>
      (m as { tool_calls?: Array<{ function?: { name?: string } }> }).tool_calls?.some(
        (t) => t.function?.name === 'read_count',
      ),
    )
    if (!verified) {
      return {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_verify',
            type: 'function',
            function: { name: 'read_count', arguments: '{}' },
          },
        ],
      }
    }
    return { role: 'assistant', content: `DONE — count is ${count}` }
  })()
  return {
    choices: [{ message, finish_reason: 'tool_calls' in message ? 'tool_calls' : 'stop' }],
    // Real (small, fixed) usage so the backend-integrity guard sees a backend, never a phantom 0.
    usage: { prompt_tokens: 40, completion_tokens: 12, cost: 0.00001 },
  }
}
