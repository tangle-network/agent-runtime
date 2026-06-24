/**
 * Full chat handler — the centerpiece production pattern every product
 * chat handler implements. `handleChatTurn` frames events with NDJSON +
 * `session.run.*` envelope and calls product hooks after drain.
 *
 * In a real product, `produce()` calls `runAgentTaskStream({ task,
 * backend, input })` against a real backend
 * (`createOpenAICompatibleBackend` / `createSandboxPromptBackend`).
 * Here we yield a small scripted stream so the example runs offline.
 *
 * Run with:
 *   pnpm tsx examples/chat-handler/chat-handler.ts
 */

import {
  type ChatStreamEvent,
  type ChatTurnProducer,
  handleChatTurn,
} from '@tangle-network/agent-runtime'

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
  const result = handleChatTurn({
    identity: { tenantId: 'demo-tenant', sessionId: 'thread-42', userId: 'demo-user', turnIndex },
    hooks: {
      produce: () => produce(userMessage),
      persistAssistantMessage: async ({ finalText }) => {
        console.log(`[persist     ] turn=${turnIndex} chars=${finalText.length}`)
      },
    },
  })

  // The drain below is ILLUSTRATIVE, not an API to copy: any NDJSON reader works (your HTTP
  // framework, fetch's body reader, `readline`). The SUBJECT is `handleChatTurn` above — it OWNS
  // the framing (one JSON event per line, `application/x-ndjson`, the `session.run.*` envelope and
  // the post-drain `persistAssistantMessage` hook). Here we read it back by hand so the example is
  // self-contained.
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
