/**
 * Full chat handler — the centerpiece production pattern every product
 * chat handler implements.
 *
 * `ChatTurnEngine.runTurn` wraps the product's `produce()` hook with the
 * `session.run.*` lifecycle envelope, drains the producer stream through
 * the NDJSON line protocol, and calls the persist / post-process hooks
 * after drain. It owns no execution state — that lives in the substrate
 * (`@tangle-network/sandbox`'s `box.streamPrompt({ executionId,
 * lastEventId })` handles reconnect/replay/dedup).
 *
 * In a real product, `produce()` calls `runAgentTaskStream({ task,
 * backend, input })` with a real backend (`createOpenAICompatibleBackend`
 * / `createSandboxPromptBackend`). Here we yield a small scripted stream
 * so the example runs offline with no LLM.
 *
 * Run with:
 *   pnpm tsx examples/chat-handler/chat-handler.ts
 */

import type { ChatStreamEvent, ChatTurnProducer } from '@tangle-network/agent-runtime'
import { chatTurnEngine, deriveExecutionId } from '@tangle-network/agent-runtime'

// ── The product's `produce` hook — yields the turn's event stream + a
//    finalText() once drained. In production this is a thin wrapper over
//    `runAgentTaskStream(...)` against a real backend. ──────────────────
function produce(userMessage: string): ChatTurnProducer<ChatStreamEvent> {
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
  // The execution id products persist alongside their session row so a
  // client retry lands on the same substrate execution. The chat-turn
  // engine itself does not need it — it goes into the producer hook
  // when calling `box.streamPrompt({ executionId, lastEventId })`.
  const executionId = deriveExecutionId({
    projectId: 'demo-agent',
    sessionId: 'thread-42',
    turnIndex,
  })

  const result = chatTurnEngine.runTurn({
    identity: { tenantId: 'demo-tenant', sessionId: 'thread-42', userId: 'demo-user', turnIndex },
    hooks: {
      produce: () => produce(userMessage),
      persistAssistantMessage: async ({ finalText }) => {
        console.log(
          `[persist     ] turn=${turnIndex} executionId=${executionId} chars=${finalText.length}`,
        )
      },
    },
  })

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
      if (event.type === 'result') final = String(event.data?.finalText ?? '')
      if (event.type === 'session.run.started') console.log(`[run started ] turn=${turnIndex}`)
      if (event.type === 'session.run.completed') console.log(`\n[run done    ] turn=${turnIndex}`)
    }
  }
  return final
}

async function main() {
  const t1 = await runTurn('Where do I start with my 2026 return?', 0)
  console.log(`[turn 0 text ] ${t1}\n`)

  const t2 = await runTurn('What about the missing Schedule B?', 1)
  console.log(`[turn 1 text ] ${t2}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
