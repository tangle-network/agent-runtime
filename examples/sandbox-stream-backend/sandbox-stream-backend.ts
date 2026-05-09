/**
 * Stream a task through createSandboxPromptBackend against a synthetic
 * sandbox client. Every reference (sandboxClient, sandboxId, the box's
 * streamPrompt method) is defined inline so the example is self-
 * contained; in your product you'd swap in the real sandbox SDK.
 *
 * Run with:
 *   pnpm tsx examples/sandbox-stream-backend/sandbox-stream-backend.ts
 */

import {
  InMemoryRuntimeSessionStore,
  createSandboxPromptBackend,
  runAgentTaskStream,
  runtimeStreamServerSentEvent,
} from '@tangle-network/agent-runtime'

// ── 1. Define the shape of YOUR sandbox box. agent-runtime never assumes
// a specific SDK; it just calls back into whatever shape you pass in.
// The events your box yields can be any shape — the runtime's default
// mapper recognises `text_delta` / `delta` / `tool_call` / `tool_result`
// / `final`. For anything else, pass `mapEvent` to do the conversion.
interface SandboxBox {
  id: string
  streamPrompt(message: string): AsyncIterable<{ type: 'text_delta'; text: string }>
}

// ── 2. Define YOUR sandbox client. In production this is the real
// sandbox SDK; here it's a one-line stub that returns a box with a
// synthetic streamPrompt. Both `sandboxClient` and `sandboxId` are
// declared in YOUR product code, not in agent-runtime.
const sandboxClient = {
  get(id: string): SandboxBox {
    return {
      id,
      async * streamPrompt(message: string) {
        // A real sandbox forwards the prompt to a model + tools and
        // yields streamed tokens. Here we just yield three fragments.
        yield { type: 'text_delta' as const, text: `received: ${message}\n` }
        yield { type: 'text_delta' as const, text: 'thinking...\n' }
        yield { type: 'text_delta' as const, text: 'done.\n' }
      },
    }
  },
}

const sandboxId = 'sandbox-demo-123'

// ── 3. Wire it up. createSandboxPromptBackend asks for three callbacks:
//   - getBox():        return the sandbox handle for this task
//   - streamPrompt():  yield events from the box's streaming endpoint
//   - getSessionId():  stable id used for session resume
const backend = createSandboxPromptBackend<SandboxBox>({
  getBox: () => sandboxClient.get(sandboxId),
  streamPrompt: (box, message) => box.streamPrompt(message),
  getSessionId: (box) => box.id,
})

// ── 4. Run.
async function main() {
  const sessions = new InMemoryRuntimeSessionStore()
  const encoder = new TextEncoder()

  for await (const event of runAgentTaskStream({
    task: {
      id: 'demo-task',
      intent: 'Greet the user',
      domain: 'demo',
    },
    backend,
    input: { message: 'hello' },
    sessionStore: sessions,
  })) {
    // Each event is a typed RuntimeStreamEvent. For a browser/HTTP route
    // you'd write the SSE encoding to the response stream:
    const sse = runtimeStreamServerSentEvent(event)
    process.stdout.write(new TextDecoder().decode(encoder.encode(sse)))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
