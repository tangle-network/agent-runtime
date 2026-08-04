/**
 * Three Runtime event sources, plus the SSE
 * serialization helpers a browser route uses — one file, one comparison.
 *
 *   1. createIterableBackend       — you own the event loop (offline)
 *   2. createSandboxPromptBackend  — the sandbox-SDK `SandboxEvent` vocabulary (offline)
 *   3. streamAgentTurn             — an exact AgentProfile through Runtime (needs TANGLE_API_KEY)
 *
 * Every section ends in the same place: typed `RuntimeStreamEvent`s
 * serialized with `runtimeStreamServerSentEvent` for an SSE response.
 *
 * Run with:
 *   pnpm tsx examples/stream-backends/stream-backends.ts
 */

import { type KnowledgeRequirement, scoreKnowledgeReadiness } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  createIterableBackend,
  createSandboxPromptBackend,
  InMemoryRuntimeSessionStore,
  readinessServerSentEvent,
  runAgentTaskStream,
  runtimeStreamServerSentEvent,
} from '@tangle-network/agent-runtime'
import { createExecutor, streamAgentTurn } from '@tangle-network/agent-runtime/kernel'
import type { SandboxEvent } from '@tangle-network/sandbox'

// ── 1. Iterable backend — you yield RuntimeStreamEvent values directly ───────
// The simplest transport: your own async generator is the model. Use it for
// tests, scripted demos, or wrapping a stream shape the other factories
// don't already map.

const iterableBackend = createIterableBackend({
  kind: 'demo-iterable',
  async *stream(input) {
    const message = input.message ?? '(no message)'
    yield { type: 'text_delta' as const, text: `you said: ${message}\n` }
    yield { type: 'text_delta' as const, text: 'thinking...\n' }
    yield { type: 'text_delta' as const, text: 'done.\n' }
  },
})

// ── 2. Sandbox backend — the canonical sandbox-SDK `SandboxEvent` shape ──────
// `SandboxEvent` is the real union imported from `@tangle-network/sandbox` (no
// inline restatement — a status the SDK adds is a compile error here, not a
// silent miss). The default `mapCommonBackendEvent` recognises every variant
// below — text deltas arrive as `message.part.updated` with the text nested
// under `data.part.text`, tool turns as `tool_call` / `tool_result` — so no
// custom `mapEvent` is required.

interface SandboxBox {
  id: string
  streamPrompt(message: string): AsyncIterable<SandboxEvent>
}

// A synthetic box. In production this is `new Sandbox(...).get(id)`;
// the wire shape stays identical.
const syntheticBox: SandboxBox = {
  id: 'sandbox-demo-123',
  async *streamPrompt(message: string): AsyncIterable<SandboxEvent> {
    yield {
      type: 'message.part.updated',
      data: { part: { type: 'text', text: `received: ${message}\n` } },
    }
    yield {
      type: 'tool_call',
      data: { id: 'call_1', name: 'Read', input: { path: '/tmp/notes.md' } },
    }
    yield {
      type: 'tool_result',
      data: { id: 'call_1', name: 'Read', output: '(file contents)' },
    }
    yield {
      type: 'message.part.updated',
      data: { part: { type: 'text', text: 'done.\n' } },
    }
  },
}

const sandboxBackend = createSandboxPromptBackend<SandboxBox>({
  getBox: () => syntheticBox,
  streamPrompt: (box, message) => box.streamPrompt(message),
  getSessionId: (box) => box.id,
  // mapEvent is OPTIONAL — only needed for product-specific event shapes the
  // default mapper doesn't already handle.
})

// ── Shared drain: every backend lands on the same SSE serialization ─────────

async function drainToSse(
  label: string,
  backend: Parameters<typeof runAgentTaskStream>[0]['backend'],
  message: string,
): Promise<void> {
  console.log(`\n--- ${label} ---`)
  for await (const event of runAgentTaskStream({
    task: { id: `demo-${label}`, intent: 'Greet the user', domain: 'demo' },
    backend,
    input: { message },
    sessionStore: new InMemoryRuntimeSessionStore(),
  })) {
    process.stdout.write(runtimeStreamServerSentEvent(event))
  }
}

async function main() {
  console.log(
    'stream-backends — three transports, one drain: every backend below lands on the same',
  )
  console.log(
    'RuntimeStreamEvent -> SSE serialization. Sections: readiness SSE, iterable (offline),',
  )
  console.log(
    'sandbox (offline), exact Runtime model turn (skipped unless TANGLE_API_KEY is set).\n',
  )

  // Readiness SSE — the one-off event a route writes when a task is gated on
  // missing knowledge (see examples/knowledge-gating for the gate itself).
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
  console.log('--- readiness SSE ---')
  process.stdout.write(
    readinessServerSentEvent(
      scoreKnowledgeReadiness({ taskId: 'review-2026-return', requirements }),
    ),
  )

  await drainToSse('iterable backend', iterableBackend, 'hello')
  await drainToSse('sandbox backend', sandboxBackend, 'hello')

  // ── 3. Exact profile through Runtime — a real endpoint, so key-gated ──────
  const apiKey = process.env.TANGLE_API_KEY
  if (!apiKey) {
    console.log('\n--- exact Runtime model turn ---')
    console.log('skipped: set TANGLE_API_KEY to run')
    return
  }
  const profile: AgentProfile = {
    name: 'five-word-greeter',
    harness: 'cli-base',
    model: {
      provider: process.env.MODEL_PROVIDER ?? 'deepseek',
      default: process.env.MODEL ?? 'deepseek/deepseek-v4-flash',
    },
    prompt: { systemPrompt: 'Answer in exactly five words.' },
  }
  console.log('\n--- exact Runtime model turn ---')
  for await (const event of streamAgentTurn(
    {
      kind: 'executor',
      profile,
      factory: createExecutor({
        backend: 'router',
        routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
        routerKey: apiKey,
      }),
    },
    'Say hello.',
  )) {
    process.stdout.write(runtimeStreamServerSentEvent(event))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
