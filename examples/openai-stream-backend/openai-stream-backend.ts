/**
 * runAgentTaskStream wired to an OpenAI-compatible chat endpoint.
 *
 * Run with:
 *   OPENAI_API_KEY=... OPENAI_BASE_URL=https://... \
 *   pnpm tsx examples/openai-stream-backend/openai-stream-backend.ts
 */

import {
  createOpenAICompatibleBackend,
  InMemoryRuntimeSessionStore,
  runAgentTaskStream,
  runtimeStreamServerSentEvent,
} from '@tangle-network/agent-runtime'

async function main() {
  const apiKey = process.env.OPENAI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://router.tangle.tools/v1'
  const model = process.env.OPENAI_MODEL ?? 'claude-sonnet-4-6@2025-04-15'

  if (!apiKey) {
    console.error('OPENAI_API_KEY is required to run this example.')
    console.error('Set it (and optionally OPENAI_BASE_URL / OPENAI_MODEL) and re-run.')
    process.exit(1)
  }

  const backend = createOpenAICompatibleBackend({
    baseUrl,
    apiKey,
    model,
  })

  const sessions = new InMemoryRuntimeSessionStore()

  for await (const event of runAgentTaskStream({
    task: {
      id: 'demo-chat',
      intent: 'Greet the user briefly.',
      domain: 'demo',
    },
    backend,
    input: { message: 'Say hello in five words.' },
    sessionStore: sessions,
  })) {
    process.stdout.write(runtimeStreamServerSentEvent(event))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
