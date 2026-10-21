/** SSE framing and response-body ownership for Router completion chunks. */

import { throwRouterFailureWithAttempts } from './router-http-transport'
import type { RawUsage } from './router-response'

// ── Streamed tool-calling transport ──────────────────────────────────────────

/** One OpenAI chat-completion chunk. Every field here is exercised by the pinned SSE fixture the
 *  streamed-transport tests read (`tests/kernel/fixtures/router-chat-completion-stream.sse`):
 *  `delta.reasoning_content` token-by-token, one `delta.tool_calls` entry carrying
 *  `index`/`id`/`function`, then a terminal chunk with `finish_reason` + `usage`. */
export interface ChatCompletionChunk {
  model?: unknown
  choices?: Array<{
    index?: number
    finish_reason?: string | null
    delta?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        [key: string]: unknown
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  usage?: RawUsage
  error?: { message?: string; type?: string }
}

/**
 * Decode an SSE body into chat-completion chunks. Frames are blank-line separated; `data:` lines
 * concatenate; `:` comments are keepalives; `[DONE]` ends the stream. The unterminated tail is
 * parsed too — an upstream that dies mid-response routinely sends a last frame with no trailing
 * blank line, and dropping it would turn a real upstream error into a silent empty turn.
 *
 * All three SSE line terminators (CRLF, LF, lone CR) are normalized, and the boundary scan runs
 * over the ACCUMULATED buffer — never over a single read in isolation, because a read may split a
 * CRLF. See `normalizeSseLineEndings`; the split is exercised byte-by-byte by the tests.
 *
 * The generator OWNS the body for its lifetime and releases it on every exit. Stopping early —
 * at `[DONE]`, or because the consumer threw — leaves the HTTP response only partly read, so the
 * body is CANCELLED rather than merely unlocked: releasing the lock alone leaves the connection
 * held open until the socket times out, which under a connection pool starves later turns.
 */
async function* readChatCompletionChunks(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<ChatCompletionChunk> {
  signal?.throwIfAborted()
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  // Set only when a read reported EOF: the body is then already exhausted and cancelling it is
  // both unnecessary and a no-op. Any other exit leaves bytes on the wire.
  let drained = false
  // Cancelling resolves the pending read as EOF; the abort check after each read turns that EOF
  // into the caller's abort instead of a truncated completion that looks finished.
  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      buf = normalizeSseLineEndings(
        done ? buf : buf + decoder.decode(value, { stream: true }),
        // While the stream is live a trailing `\r` is ambiguous; at EOF it is a terminator.
        !done,
      )
      let sep = buf.indexOf('\n\n')
      while (sep !== -1) {
        const frame = parseChunkFrame(buf.slice(0, sep))
        buf = buf.slice(sep + 2)
        if (frame === 'done') return
        if (frame) yield frame
        sep = buf.indexOf('\n\n')
      }
      if (done) break
    }
    drained = true
    const tail = parseChunkFrame(buf)
    if (tail && tail !== 'done') yield tail
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!drained) {
      // `cancel()` REJECTS when the body is already errored (a dead socket). That is cleanup on a
      // path that already carries either a complete result or an error of its own, and letting the
      // rejection escape `finally` would REPLACE that error with a less specific one. The
      // connection is released either way, which is the whole reason cancel is called.
      await reader.cancel().catch(() => undefined)
    }
    reader.releaseLock()
  }
}

export async function* readChatCompletionChunksWithAttempts(
  body: ReadableStream<Uint8Array>,
  attempts: number,
  signal?: AbortSignal,
): AsyncIterable<ChatCompletionChunk> {
  try {
    yield* readChatCompletionChunks(body, signal)
  } catch (error) {
    throwRouterFailureWithAttempts(error, attempts)
  }
}

/**
 * Normalize an SSE body's line terminators to `\n`. The SSE grammar accepts CRLF, LF, AND a lone
 * CR, so a `\r`-separated body is legal — and left unnormalized it decodes to zero frames, which
 * this transport would report as a turn with no content, no tool calls, and `usageUnknown: true`
 * and no error at all. Losing a whole turn in silence is the one outcome it may not produce.
 *
 * `holdTrailingCr` keeps an ambiguous FINAL `\r` out of the conversion while more bytes may still
 * arrive: rewriting it to `\n` before the next byte is seen turns a read-split CRLF into a FALSE
 * frame boundary, splitting one frame into two unparseable halves. At EOF nothing can follow it,
 * so it is converted. Re-running this over the accumulated buffer is idempotent.
 */
function normalizeSseLineEndings(buf: string, holdTrailingCr: boolean): string {
  if (holdTrailingCr && buf.endsWith('\r')) {
    return `${buf.slice(0, -1).replace(/\r\n?/g, '\n')}\r`
  }
  return buf.replace(/\r\n?/g, '\n')
}

/** One SSE frame → a chunk, `'done'`, or undefined for a comment/keepalive/unparseable payload. */
function parseChunkFrame(frame: string): ChatCompletionChunk | 'done' | undefined {
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart())
  }
  if (dataLines.length === 0) return undefined
  const data = dataLines.join('\n')
  if (data === '[DONE]') return 'done'
  try {
    return JSON.parse(data) as ChatCompletionChunk
  } catch {
    return undefined
  }
}
