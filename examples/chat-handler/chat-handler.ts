/**
 * Full durable chat handler — the centerpiece production pattern every
 * product chat handler implements.
 *
 * `DurableChatTurnEngine.runTurn` composes the substrate stack: it builds
 * the durable manifest from the chat identity, drives `runDurableTurn`,
 * emits `session.run.*` lifecycle events around the producer stream,
 * checkpoints the final text into the run store, and returns a ready-to-
 * pipe `ReadableStream`. A worker crash *after* the turn finishes replays
 * the cached final text; a worker crash *during* the turn is what
 * `runSupervisedTurn` is for (see `examples/durable-supervisor/`).
 *
 * In a real product, `produce()` calls `runAgentTaskStream({ task,
 * backend, input })` with a real backend (`createOpenAICompatibleBackend`
 * / `createSandboxPromptBackend`). Here we yield a small scripted stream
 * so the example runs offline with no LLM.
 *
 * Run with:
 *   pnpm tsx examples/chat-handler/chat-handler.ts
 */

import type { ChatStreamEvent, DurableTurnProducer } from '@tangle-network/agent-runtime'
import { durableChatTurnEngine, InMemoryDurableRunStore } from '@tangle-network/agent-runtime'

const store = new InMemoryDurableRunStore()

// ── The product's `produce` hook — yields the turn's event stream + a
//    finalText() once drained. In production this is a thin wrapper over
//    `runAgentTaskStream(...)` against a real backend. ──────────────────
function produce(userMessage: string): DurableTurnProducer<ChatStreamEvent> {
  let accumulated = ''
  const reply = userMessage.toLowerCase().includes('missing')
    ? 'The 2026 return is missing Schedule B and one W-2. Please upload them.'
    : `Acknowledged: "${userMessage.slice(0, 80)}". Drafting a reply.`

  async function* stream(): AsyncGenerator<ChatStreamEvent, void, unknown> {
    yield { type: 'message.started', data: { messageId: 'm-1' } }
    for (const chunk of reply.match(/.{1,16}/g) ?? [reply]) {
      accumulated += chunk
      yield {
        type: 'message.part.updated',
        data: { messageId: 'm-1', delta: chunk, part: { type: 'text', text: accumulated } },
      }
    }
    yield { type: 'result', data: { finalText: accumulated } }
  }

  return { stream: stream(), finalText: () => accumulated }
}

async function runTurn(userMessage: string, turnIndex: number): Promise<string> {
  const result = durableChatTurnEngine.runTurn({
    store,
    identity: { tenantId: 'demo-tenant', sessionId: 'thread-42', turnIndex },
    userMessage,
    projectId: 'demo-agent',
    domain: 'demo',
    hooks: { produce: () => produce(userMessage) },
  })

  // The engine returns a ReadableStream of NDJSON-encoded ChatStreamEvent
  // lines — exactly what an SSE/HTTP route forwards to the client.
  const reader = result.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value)
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      const event = JSON.parse(line) as ChatStreamEvent
      if (event.type === 'message.part.updated') process.stdout.write('.')
      if (event.type === 'result') final = String((event.data ?? {}).finalText ?? '')
      if (event.type === 'session.run.started') console.log(`[run started ] turn=${turnIndex}`)
      if (event.type === 'session.run.completed') console.log(`\n[run done    ] turn=${turnIndex}`)
    }
  }
  return final
}

async function main() {
  // Turn 1: fresh.
  const t1 = await runTurn('Where do I start with my 2026 return?', 0)
  console.log(`[turn 0 text ] ${t1}\n`)

  // Turn 2: a different turn — fresh manifest, fresh runId.
  const t2 = await runTurn('What about the missing Schedule B?', 1)
  console.log(`[turn 1 text ] ${t2}\n`)

  // Turn 3: same identity as turn 0 — durable run hits the replay path
  // because step 0 of `chat:thread-42:0` is already completed.
  const t3 = await runTurn('Where do I start with my 2026 return?', 0)
  console.log(`[turn 0 text ] ${t3}   (replayed from durable store)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
