/**
 * Stream a task through `createSandboxPromptBackend` against the
 * canonical `@tangle-network/sandbox` `SandboxEvent` shape — the real
 * event vocabulary the sandbox SDK's `box.streamTask()` yields.
 *
 * The synthetic `sandboxClient` mirrors the production SDK's surface
 * one-for-one: `client.get(id)` returns a handle exposing
 * `streamPrompt(message): AsyncIterable<SandboxEvent>` where each
 * `SandboxEvent` is `{ type: string, data: Record<string, unknown> }`
 * — `type: 'message.part.updated'` with `data.part = { type: 'text',
 * text: '…' }` for streamed tokens, plus `tool_call` / `tool_result`
 * for tool invocations. Swap the synthetic client for the real SDK in
 * your product; the wire shape stays identical.
 *
 * **Why this example matters.** Before `agent-runtime@0.16.1` (#36),
 * the default `mapCommonBackendEvent` looked at `data.text` only and
 * silently dropped sandbox-SDK text deltas — products had to ship a
 * custom `mapEvent` shim per repo. 0.16.1 lands the native unwrap so
 * `createSandboxPromptBackend` consumes the canonical shape out of the
 * box. This example demonstrates the canonical shape so consumers can
 * copy it verbatim.
 *
 * Run with:
 *   pnpm tsx examples/sandbox-stream-backend/sandbox-stream-backend.ts
 */

import {
  createSandboxPromptBackend,
  InMemoryRuntimeSessionStore,
  runAgentTaskStream,
  runtimeStreamServerSentEvent,
} from '@tangle-network/agent-runtime'

// ── 1. The sandbox-SDK `SandboxEvent` shape. Production code imports
// this from `@tangle-network/sandbox`; here we restate it inline so the
// example is self-contained. The default `mapCommonBackendEvent`
// recognises every variant below — no custom `mapEvent` required.
interface SandboxEvent {
  type: string
  data: Record<string, unknown>
  id?: string
}

interface SandboxBox {
  id: string
  streamPrompt(message: string): AsyncIterable<SandboxEvent>
}

// ── 2. A synthetic sandbox client. In production this is
// `new SandboxClient(...).get(id)`; here it's an inline factory that
// emits the canonical event shapes the real SDK does.
const sandboxClient = {
  get(id: string): SandboxBox {
    return {
      id,
      async *streamPrompt(message: string): AsyncIterable<SandboxEvent> {
        // Text-delta events arrive as `message.part.updated` with the
        // text nested under `data.part.text`. This is the shape the
        // sandbox SDK emits when the agent's model produces a token.
        yield {
          type: 'message.part.updated',
          data: { part: { type: 'text', text: `received: ${message}\n` } },
        }
        yield {
          type: 'message.part.updated',
          data: { part: { type: 'text', text: 'thinking...\n' } },
        }
        // Tool calls come through with `data.name` + `data.input`. The
        // default mapper produces a canonical `tool_call` event with
        // these surfaced as `toolName` + `args`.
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
  },
}

const sandboxId = 'sandbox-demo-123'

// ── 3. Wire it up. `createSandboxPromptBackend` takes three callbacks;
// none of them need to massage event shapes when the box yields the
// canonical sandbox-SDK shape — the default mapper handles it.
const backend = createSandboxPromptBackend<SandboxBox>({
  getBox: () => sandboxClient.get(sandboxId),
  streamPrompt: (box, message) => box.streamPrompt(message),
  getSessionId: (box) => box.id,
  // mapEvent is OPTIONAL — only needed for product-specific event
  // shapes the default mapper doesn't already handle. For the
  // canonical sandbox-SDK vocabulary (`message.part.updated` with
  // nested part, `tool_call`, `tool_result`, `text_delta`,
  // `reasoning_delta`), omit it.
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
    // Every event is a typed RuntimeStreamEvent — `text_delta` for the
    // streamed tokens, `tool_call` / `tool_result` for the tool turns,
    // plus the runtime's lifecycle events around them.
    const sse = runtimeStreamServerSentEvent(event)
    process.stdout.write(new TextDecoder().decode(encoder.encode(sse)))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
