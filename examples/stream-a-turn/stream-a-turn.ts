/**
 * stream-a-turn — run one agent turn and read its events.
 *
 * Two contracts, and nothing else: you write an `AgentExecutionBackend` that
 * yields `RuntimeStreamEvent` values, and you read the same union back out of
 * `runAgentTaskStream`. Offline, deterministic, no API keys.
 *
 * Run:  pnpm build && pnpm tsx examples/stream-a-turn/stream-a-turn.ts
 */

import type {
  AgentBackendContext,
  AgentBackendInput,
  AgentExecutionBackend,
  AgentTaskSpec,
  RuntimeStreamEvent,
} from '@tangle-network/agent-runtime'
import { InMemoryRuntimeSessionStore, runAgentTaskStream } from '@tangle-network/agent-runtime'

// The unit of work. `id` is yours; `intent` and `domain` describe the work.
const task: AgentTaskSpec = {
  id: 'support:thread-42',
  intent: 'Answer one support question about refunds.',
  domain: 'support',
}

// The backend contract every product implements. `kind` names it in the trace.
// `stream` yields the turn's events. A real backend calls a model API, a
// sandbox, or a coding CLI here; this one is scripted so the file runs offline.
const backend: AgentExecutionBackend = {
  kind: 'scripted-support',
  async *stream(
    input: AgentBackendInput,
    ctx: AgentBackendContext,
  ): AsyncIterable<RuntimeStreamEvent> {
    const now = () => new Date().toISOString()
    yield { type: 'text_delta', text: 'Checking the refund policy', timestamp: now() }
    yield {
      type: 'tool_call',
      toolName: 'search_policy',
      toolCallId: 'call_1',
      args: { query: input.message ?? '' },
      timestamp: now(),
    }
    yield {
      type: 'tool_result',
      toolName: 'search_policy',
      toolCallId: 'call_1',
      result: { section: 'renewals', window: '14 days' },
      timestamp: now(),
    }
    yield {
      type: 'llm_call',
      task: ctx.task,
      session: ctx.session,
      model: 'scripted/support-agent',
      tokensIn: 320,
      tokensOut: 64,
      costUsd: 0.0009,
      latencyMs: 120,
      timestamp: now(),
    }
    yield {
      type: 'text_delta',
      text: '\nA renewal is refundable within 14 days of the charge.\n',
      timestamp: now(),
    }
  },
}

// The session store keeps this turn's session and events. Swap in your own
// store to make the transcript durable; omit it entirely for a stateless turn.
const sessions = new InMemoryRuntimeSessionStore()

let reply = ''
let costUsd = 0
const toolCalls: string[] = []

for await (const event of runAgentTaskStream({
  task,
  backend,
  input: { message: 'Can I refund a subscription renewal?' },
  sessionStore: sessions,
  sessionId: 'thread-42',
})) {
  switch (event.type) {
    case 'text_delta':
      reply += event.text
      process.stdout.write(event.text)
      break
    case 'tool_call':
      toolCalls.push(event.toolName)
      break
    case 'llm_call':
      costUsd += event.costUsd ?? 0
      break
    case 'final':
      console.log(`\nstatus: ${event.status} — ${event.reason}`)
      break
    default:
      break
  }
}

console.log(`tools: ${toolCalls.join(', ') || 'none'}`)
console.log(`cost: $${costUsd.toFixed(4)} — reply chars: ${reply.length}`)
