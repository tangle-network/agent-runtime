/**
 * Server-Sent Events serialization helpers.
 *
 * Run with:
 *   pnpm tsx examples/sse-stream/sse-stream.ts
 */

import { type KnowledgeRequirement, scoreKnowledgeReadiness } from '@tangle-network/agent-eval'
import {
  createIterableBackend,
  InMemoryRuntimeSessionStore,
  readinessServerSentEvent,
  runAgentTaskStream,
  runtimeStreamServerSentEvent,
} from '@tangle-network/agent-runtime'

// ── 1. One-off readiness SSE — the kind of event you'd write to a
// response stream when a task is gated by missing knowledge.
const requirements: KnowledgeRequirement[] = [
  {
    id: 'filing-status',
    description: 'Taxpayer filing status',
    requiredFor: ['return-review'],
    category: 'user_specific',
    acquisitionMode: 'ask_user',
    importance: 'blocking',
    freshness: 'static',
    sensitivity: 'private',
    confidenceNeeded: 1,
    currentConfidence: 0,
    evidenceIds: [],
    fallbackPolicy: 'ask',
  },
]
const readinessReport = scoreKnowledgeReadiness({
  taskId: 'review-2026-return',
  requirements,
})
console.log('--- readiness SSE ---')
process.stdout.write(readinessServerSentEvent(readinessReport))

// ── 2. Streamed-task SSE — what a real /chat or /agent route would do.
// createIterableBackend yields RuntimeStreamEvent values directly. If your
// backend speaks a different shape (e.g. OpenAI deltas), use
// createOpenAICompatibleBackend or createSandboxPromptBackend instead;
// they map common shapes for you.
const backend = createIterableBackend({
  kind: 'demo-iterable',
  async *stream(input) {
    const message = input.message ?? '(no message)'
    yield { type: 'text_delta' as const, text: `you said: ${message}\n` }
    yield { type: 'text_delta' as const, text: 'thinking...\n' }
    yield { type: 'text_delta' as const, text: 'done.\n' }
  },
})

async function main() {
  console.log('\n--- runtime stream SSE ---')
  for await (const event of runAgentTaskStream({
    task: { id: 'demo', intent: 'demo', domain: 'demo' },
    backend,
    input: { message: 'hello' },
    sessionStore: new InMemoryRuntimeSessionStore(),
  })) {
    process.stdout.write(runtimeStreamServerSentEvent(event))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
