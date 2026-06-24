/**
 * An in-process, OpenAI-compatible mock router — the OFFLINE worker for strategy-suite.
 *
 * The whole point of this file: strategy-suite runs the REAL `runBenchmark` machinery (the
 * Supervisor, the conserved budget pool, every strategy, the env's own deployable check). The only
 * thing it needs from the outside world is a chat-completions endpoint. With no `TANGLE_API_KEY`,
 * the suite points the worker at THIS localhost server instead of the Tangle router — so the entire
 * comparison runs end-to-end with zero credentials, while the live router stays the drop-in upgrade.
 *
 * The mock answers `POST /v1/chat/completions` like an OpenAI endpoint:
 *   • given the counter `tools`, it reads the running count out of the prior tool results and emits
 *     one `increment` tool_call until the count hits the target, then a final "DONE" message — i.e.
 *     it actually drives the counter, so the env scores a real pass.
 *   • given NO tools (the refine analyst's chat-only call), it returns a short steer string.
 * It reports token usage so agent-eval's backend-integrity guard sees a real backend.
 */

import { createServer, type Server } from 'node:http'
import { target } from './counter-env'

interface ChatMessage {
  role: string
  content?: string | null
  tool_calls?: Array<{
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
}
interface ChatRequest {
  messages?: ChatMessage[]
  tools?: Array<{ function?: { name?: string } }>
}

/** Highest `count is now N` (or `count is N`) seen in the prior tool results. */
function currentCount(messages: ChatMessage[]): number {
  let count = 0
  for (const m of messages) {
    if (m.role !== 'tool' || typeof m.content !== 'string') continue
    const match = m.content.match(/count is(?: now)? (\d+)/)
    if (match) count = Math.max(count, Number(match[1]))
  }
  return count
}

function respondTo(req: ChatRequest): ChatMessage {
  const messages = req.messages ?? []
  // Chat-only call (the refine analyst): no tools → return a steer, never a tool_call.
  if (!req.tools?.length) {
    return {
      role: 'assistant',
      content: 'Keep calling increment until read_count shows the target.',
    }
  }
  const count = currentCount(messages)
  if (count < target) {
    return {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: `call_${count}`, function: { name: 'increment', arguments: '{}' } }],
    }
  }
  // Target reached — verify, then answer without a tool call so the loop ends.
  const verified = messages.some((m) =>
    m.tool_calls?.some((t) => t.function?.name === 'read_count'),
  )
  if (!verified) {
    return {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_verify', function: { name: 'read_count', arguments: '{}' } }],
    }
  }
  return { role: 'assistant', content: `DONE — count is ${count}` }
}

/** Start the mock on an ephemeral port; returns the `/v1` base URL and a stop handle. */
export async function startMockRouter(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (!req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      const parsed = body ? (JSON.parse(body) as ChatRequest) : {}
      const message = respondTo(parsed)
      const payload = {
        choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
        // Real (small, fixed) usage so the backend-integrity guard sees a backend, never a phantom 0.
        usage: { prompt_tokens: 40, completion_tokens: 12 },
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock router: no port assigned')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
