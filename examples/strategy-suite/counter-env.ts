/**
 * The shared toy domain for the optimization examples: drive a counter to a target with
 * an `increment` tool, scored by the env's OWN deployable check (never an LLM's opinion).
 * Both `strategy-suite` (compare strategies) and `strategy-evolution` (the holdout gate)
 * reuse this so each example shows only its DISTINCT concept, not 60 lines of fixture.
 * A real domain opens a repo / browser / MCP server the same way.
 */

import type { AgenticTask, ArtifactHandle, Environment } from '@tangle-network/agent-runtime/loops'

export const target = 5
const counters = new Map<string, { count: number }>()

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
  async score(_task, handle) {
    const count = counters.get(handle.id)?.count ?? 0
    return { passes: Math.min(count, target), total: target, errored: 0 }
  },
  async close(handle) {
    counters.delete(handle.id)
  },
}

/** One counter task with the given id — the same prompt across both examples. */
export const counterTask = (id: string): AgenticTask => ({
  id,
  systemPrompt: 'You operate a counter with tools.',
  userPrompt: `Use the increment tool to bring the counter to exactly ${target}. Use read_count to verify before you finish. Reply DONE when the count equals ${target}.`,
})
