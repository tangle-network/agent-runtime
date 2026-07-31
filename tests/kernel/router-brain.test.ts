import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routerBrain, streamRouterChatWithTools } from '../../src/runtime/router-client'

// `routerBrain` is a same-module thin wrapper over `routerChatWithTools`, which speaks raw HTTP.
// The offline seam is therefore `fetch` (the real boundary) — stub it to drive the whole
// brain → routerChatWithTools → fetch path with no creds and no network. `routerBrain` does no
// message translation: the canonical loop already hands it OpenAI messages + ToolSpec tools, so
// it forwards both verbatim and returns `routerChatWithTools`'s parsed result.

// A priced model so `routerChatWithTools` derives a real per-turn cost the brain forwards.
const cfg = { routerBaseUrl: 'http://router.test/v1', routerKey: 'k', model: 'deepseek-v4-flash' }

let fetchMock: ReturnType<typeof vi.fn>

/** Stub `fetch` to return one OpenAI chat-completion body, and capture the request it received. */
function stubRouter(body: unknown): void {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
  vi.stubGlobal('fetch', fetchMock)
}

/**
 * Stub `fetch` to return an SSE body — the same real boundary, one layer lower. `sliceAt` splits
 * the payload into separate `read()` results so a frame is delivered ACROSS reads: the buffering
 * in `readChatCompletionChunks` is only exercised when bytes arrive mid-frame, which is the normal
 * case on a real socket and the one a single-enqueue stub would never reach.
 */
function stubStream(sse: string, opts: { status?: number; sliceAt?: number[] } = {}): void {
  const encoder = new TextEncoder()
  const bounds = [0, ...(opts.sliceAt ?? []), sse.length]
  const parts = bounds.slice(0, -1).map((start, i) => sse.slice(start, bounds[i + 1]))
  fetchMock = vi.fn(async () => ({
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    text: async () => sse,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) if (part) controller.enqueue(encoder.encode(part))
        controller.close()
      },
    }),
  }))
  vi.stubGlobal('fetch', fetchMock)
}

/**
 * Stub `fetch` with an SSE body that is enqueued but NEVER closed — a real HTTP response the
 * client stops reading before EOF. `stubStream`'s stream closes as its last chunk is read, and a
 * closed stream swallows `cancel()`, so it cannot observe whether the body was released at all.
 * The returned spy is the underlying source's `cancel`: it fires only if the reader actually
 * cancels, which is what frees the connection back to the pool.
 */
function stubUnclosedStream(sse: string): ReturnType<typeof vi.fn> {
  const encoder = new TextEncoder()
  const cancelled = vi.fn()
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => sse,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse))
      },
      cancel(reason) {
        cancelled(reason)
      },
    }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return cancelled
}

/** One SSE frame carrying an OpenAI chat-completion chunk. */
function frame(chunk: unknown): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}

describe('routerBrain — the production ToolLoopChat seam over the router tool-calling', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('forwards the config max_tokens so a reasoning model is not truncated mid-thought', async () => {
    stubRouter({ choices: [{ message: { content: 'ok' } }] })
    // A thinking model spends this ceiling on hidden reasoning BEFORE any visible token, so a
    // caller driving one must be able to raise it above the 8192 default.
    await routerBrain({ ...cfg, maxTokens: 32_000 })([{ role: 'user', content: 'hi' }], [])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(32_000)
  })

  it('sends no ceiling when the config names none, leaving the provider default', async () => {
    stubRouter({ choices: [{ message: { content: 'ok' } }] })
    await routerBrain(cfg)([{ role: 'user', content: 'hi' }], [])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    // The tool-calling path omits max_tokens entirely rather than defaulting it, so the
    // provider's own ceiling governs — which is what truncated a reasoning model in production.
    expect('max_tokens' in body).toBe(false)
  })

  it('forwards the conversation + tools to the router (no translation) and parses tool calls back', async () => {
    stubRouter({
      choices: [
        {
          message: {
            content: 'reasoning',
            tool_calls: [
              { id: 'c1', function: { name: 'spawn_agent', arguments: '{"task":"go","n":3}' } },
            ],
          },
        },
      ],
    })

    const messages = [
      { role: 'system', content: 'SYSTEM PROMPT' },
      { role: 'user', content: 'do it' },
    ]
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'spawn_agent',
          description: 'spawn a worker',
          parameters: { type: 'object' },
        },
      },
    ]
    const result = await routerBrain(cfg)(messages, tools)

    // The request body carries the messages + tools UNCHANGED (no system-prepend, no
    // DriverMessage→OpenAI mapping) plus the default driver temperature + auto tool choice.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://router.test/v1/chat/completions')
    const sent = JSON.parse((init as { body: string }).body)
    expect(sent.messages).toEqual(messages)
    expect(sent.tools).toEqual(tools)
    expect(sent.temperature).toBe(0.4)
    expect(sent.tool_choice).toBe('auto')

    // tool_calls carry RAW JSON argument strings (the loop JSON.parses them itself).
    expect(result.content).toBe('reasoning')
    expect(result.toolCalls).toEqual([
      { id: 'c1', name: 'spawn_agent', arguments: '{"task":"go","n":3}' },
    ])
  })

  it('honors a custom temperature', async () => {
    stubRouter({ choices: [{ message: { content: 'x' } }] })
    await routerBrain(cfg, { temperature: 0.1 })([], [])
    const init = fetchMock.mock.calls[0]![1] as { body: string }
    const sent = JSON.parse(init.body)
    expect(sent.temperature).toBe(0.1)
    expect(sent.tool_choice).toBe('auto')
  })

  it('forwards the router usage + cost so the driver can meter its inference', async () => {
    stubRouter({
      choices: [{ message: { content: 'x', tool_calls: [] } }],
      usage: { prompt_tokens: 120, completion_tokens: 45 },
    })
    const result = await routerBrain(cfg)([], [])
    expect(result.usage).toEqual({ input: 120, output: 45 })
    // A priced model yields a real per-turn cost, forwarded for the driver's conserved-pool metering.
    expect(result.costUsd).toBeGreaterThan(0)
  })

  it('omits usage/cost when the router reports none — never a fabricated zero', async () => {
    stubRouter({ choices: [{ message: { content: 'x', tool_calls: [] } }] })
    const result = await routerBrain(cfg)([], [])
    expect(result.usage).toBeUndefined()
    expect(result.costUsd).toBeUndefined()
    // The BUFFERED path asked for nothing extra, so it makes no claim about a broken contract; the
    // driver still records the turn as unknown rather than skipping it (see the metering suite).
    expect(result.usageUnknown).toBeUndefined()
  })
})

// The deleted `routerDriverChat` had cases for DriverMessage→OpenAI translation, malformed-arg
// degradation, content-omission, and a `typeof === 'number'` costUsd-0 guard. `routerBrain` does
// none of that — it forwards `routerChatWithTools`'s parsed result whole — so those cases are gone.

// A supervisor turn is the system's longest completion, and a BUFFERED post holds one connection
// idle for all of it — the window an idle-timeout gateway kills. These cases pin the streamed
// transport: it must reassemble the identical result, and above all it must meter the identical
// tokens (or say explicitly that it could not), or the conserved budget pool spends a turn it never
// accounted for.
describe('streamRouterChatWithTools — the SSE tool-calling transport', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  // The committed SSE fixture this suite runs against. It is HAND-AUTHORED to the OpenAI-compatible
  // streaming chunk shape — not a verbatim capture of a recorded upstream response — and covers a
  // full tool-calling turn: reasoning streaming token-by-token in `delta.reasoning_content`, the
  // tool call arriving in `delta.tool_calls` with index+id, and usage riding the chunk that carries
  // `finish_reason`. Kept as a committed file rather than an inline string so the payload every
  // claim below rests on is a reviewable artifact in the branch.
  const fixture = readFileSync(
    new URL('./fixtures/router-chat-completion-stream.sse', import.meta.url),
    'utf8',
  )

  it('reassembles the pinned fixture into the same result shape the buffered path returns', async () => {
    // Split mid-frame so the decoder has to buffer across reads, the way a real socket delivers.
    stubStream(fixture, { sliceAt: [120, 400, 800] })
    const result = await streamRouterChatWithTools(cfg, [{ role: 'user', content: 'hi' }], [])

    expect(result.toolCalls).toEqual([
      { id: 'call_83f2da0d', name: 'calc', arguments: '{"expr":"21*2"}' },
    ])
    // The terminal chunk of this tool-calls-only turn carries `content: ""`, and the BUFFERED path
    // maps `content: ""` to `''` (only an absent field becomes `null`) — so a caller cannot tell
    // the two transports apart by this field.
    expect(result.content).toBe('')
    expect(result.reasoning).toBe('The user wants me to calculate.')
    expect(result.finishReason).toBe('tool_calls')
    // The whole point: the streamed turn meters exactly what the buffered turn would have.
    expect(result.usage).toEqual({ input: 162, output: 28 })
    expect(result.costUsd).toBeGreaterThan(0)
    // Usage arrived, so the turn is NOT marked unknown.
    expect(result.usageUnknown).toBeUndefined()
  })

  // B1: an SSE body is allowed to end its lines with CRLF, and a read boundary is free to land
  // between the `\r` and the `\n`. Normalizing each decode result in isolation leaves a stray `\r`
  // in the buffer, `\r\n\r\n` never becomes `\n\n`, and every frame from that point on — the
  // terminal usage chunk included — is silently dropped.
  it('finds the frame boundary when a read splits a CRLF exactly between the \\r and the \\n', async () => {
    const crlf = fixture.replace(/\n/g, '\r\n')
    const boundary = crlf.indexOf('\r\n\r\n')
    expect(boundary).toBeGreaterThan(0)
    // Every cut position inside the four-byte frame separator, including the one that puts the read
    // boundary between the `\r` and the `\n` of the SECOND CRLF (boundary + 3) — the exact split
    // that loses the frame.
    for (const cut of [boundary + 1, boundary + 2, boundary + 3]) {
      stubStream(crlf, { sliceAt: [cut] })
      const result = await streamRouterChatWithTools(cfg, [{ role: 'user', content: 'hi' }], [])
      // Frame 1 and 2 (reasoning) both survive the split.
      expect(result.reasoning).toBe('The user wants me to calculate.')
      // Frame 3 (the tool call) survives.
      expect(result.toolCalls).toEqual([
        { id: 'call_83f2da0d', name: 'calc', arguments: '{"expr":"21*2"}' },
      ])
      // Frame 4 — the terminal usage chunk, the one whose loss makes a real turn look free.
      expect(result.finishReason).toBe('tool_calls')
      expect(result.usage).toEqual({ input: 162, output: 28 })
      expect(result.usageUnknown).toBeUndefined()
    }
  })

  it('reassembles a wholly CRLF-terminated stream delivered one byte per read', async () => {
    // The worst case for the boundary scan: every read is a single byte, so every CRLF in the body
    // is split. Nothing may be lost.
    const crlf = fixture.replace(/\n/g, '\r\n')
    stubStream(crlf, {
      sliceAt: crlf
        .split('')
        .map((_, i) => i + 1)
        .slice(0, -1),
    })
    const result = await streamRouterChatWithTools(cfg, [], [])
    expect(result.reasoning).toBe('The user wants me to calculate.')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.usage).toEqual({ input: 162, output: 28 })
  })

  it('asks for the stream and for usage inside it, and keeps every other request field identical', async () => {
    stubStream(fixture)
    const messages = [{ role: 'user', content: 'hi' }]
    const tools = [
      {
        type: 'function' as const,
        function: { name: 'calc', description: 'math', parameters: { type: 'object' } },
      },
    ]
    // `maxTokens` is a per-call option on both transports (the config's ceiling is bridged into it
    // by `routerBrain`), so it is passed here exactly as the buffered function takes it.
    await streamRouterChatWithTools(cfg, messages, tools, { temperature: 0.4, maxTokens: 32_000 })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://router.test/v1/chat/completions')
    const sent = JSON.parse((init as { body: string }).body)
    expect(sent.stream).toBe(true)
    // Without `include_usage` an OpenAI-compatible upstream omits usage from a streamed response
    // entirely and the turn would meter nothing.
    expect(sent.stream_options).toEqual({ include_usage: true })
    expect(sent.messages).toEqual(messages)
    expect(sent.tools).toEqual(tools)
    expect(sent.temperature).toBe(0.4)
    expect(sent.tool_choice).toBe('auto')
    expect(sent.max_tokens).toBe(32_000)
    expect((init as { headers: Record<string, string> }).headers.accept).toBe('text/event-stream')
  })

  it('concatenates content deltas and splits an inline <think> block out of the answer', async () => {
    stubStream(
      frame({ choices: [{ delta: { content: '<think>weigh it' } }] }) +
        frame({ choices: [{ delta: { content: '</think>the answer' } }] }) +
        frame({ choices: [{ index: 0, finish_reason: 'stop', delta: {} }] }) +
        'data: [DONE]\n\n',
    )
    const result = await streamRouterChatWithTools(cfg, [], [])
    expect(result.content).toBe('the answer')
    expect(result.reasoning).toBe('weigh it')
    expect(result.finishReason).toBe('stop')
  })

  it('assembles a tool call whose arguments were fragmented across chunks', async () => {
    stubStream(
      frame({
        choices: [
          { delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'spawn_agent' } }] } },
        ],
      }) +
        frame({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"ta' } }] } }],
        }) +
        frame({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'sk":"go"}' } }] } },
          ],
        }) +
        frame({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 1, id: 'c2', function: { name: 'stop', arguments: '{}' } }],
              },
            },
          ],
        }) +
        'data: [DONE]\n\n',
    )
    const result = await streamRouterChatWithTools(cfg, [], [])
    // Ordered by the provider's slot index, arguments reassembled whole — the loop JSON.parses them.
    expect(result.toolCalls).toEqual([
      { id: 'c1', name: 'spawn_agent', arguments: '{"task":"go"}' },
      { id: 'c2', name: 'stop', arguments: '{}' },
    ])
  })

  it('marks the turn UNKNOWN — never a fabricated zero, never a quiet undefined — when the stream carried no usage', async () => {
    stubStream(
      frame({ choices: [{ delta: { content: 'done' } }] }) +
        frame({ choices: [{ index: 0, finish_reason: 'stop', delta: {} }] }) +
        'data: [DONE]\n\n',
    )
    const result = await streamRouterChatWithTools(cfg, [], [])
    expect(result.content).toBe('done')
    // A phantom 0 reads as a FREE call to the conserved budget pool, which would then over-spend.
    // Undefined is the same contract the buffered path holds.
    expect(result.usage).toBeUndefined()
    expect(result.costUsd).toBeUndefined()
    // But undefined ALONE is indistinguishable from a turn that cost nothing. The transport asked
    // for usage (`stream_options.include_usage`) and did not get it, which is a broken contract —
    // said out loud so the metering caller records an unknown turn rather than a free one.
    expect(result.usageUnknown).toBe(true)
  })

  it('reads usage off a terminal chunk that carries no choices (the include_usage shape)', async () => {
    stubStream(
      frame({ choices: [{ delta: { content: 'ok' } }] }) +
        frame({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } }) +
        'data: [DONE]\n\n',
    )
    const result = await streamRouterChatWithTools(cfg, [], [])
    expect(result.usage).toEqual({ input: 10, output: 4 })
  })

  it('surfaces a length finish_reason so a truncated turn is distinguishable from a chosen stop', async () => {
    stubStream(
      `${frame({
        choices: [{ index: 0, finish_reason: 'length', delta: { content: 'half an ans' } }],
      })}data: [DONE]\n\n`,
    )
    // The buffered path cannot report this at all; a caller driving a reasoning model needs it to
    // tell "the model answered" from "the model hit max_tokens mid-sentence".
    expect((await streamRouterChatWithTools(cfg, [], [])).finishReason).toBe('length')
  })

  it('parses an unterminated tail frame instead of dropping the upstream error with it', async () => {
    // A dying upstream sends a last frame with no trailing blank line. Dropping it would turn a
    // real error into a silent empty turn.
    stubStream(`data: ${JSON.stringify({ error: { message: 'origin timeout' } })}`)
    await expect(streamRouterChatWithTools(cfg, [], [])).rejects.toThrow(
      /router stream error: origin timeout/,
    )
  })

  it('fails loud on a non-2xx with the same message shape as the buffered path', async () => {
    stubStream('gateway blew up', { status: 524 })
    await expect(streamRouterChatWithTools(cfg, [], [])).rejects.toThrow(/router 524/)
  })

  it('refuses to pair the streamed transport with the buffered injected transport', async () => {
    // `complete` returns one parsed body and has no stream to read. Silently taking the buffered
    // path instead would make `stream: true` a lie.
    await expect(
      streamRouterChatWithTools(
        { ...cfg, complete: async () => ({ choices: [] }), stream: true },
        [],
        [],
      ),
    ).rejects.toThrow(/cannot serve a stream/)
  })

  it('ignores SSE comments and keepalive frames', async () => {
    stubStream(
      `: keepalive\n\n${frame({ choices: [{ delta: { content: 'hi' } }] })}: ping\n\ndata: [DONE]\n\n`,
    )
    expect((await streamRouterChatWithTools(cfg, [], [])).content).toBe('hi')
  })

  // The SSE grammar accepts a LONE CR as a line terminator, so this body is legal. Handling only
  // `\r\n` and `\n` decoded it to zero frames and returned a turn with no content, no tool calls
  // and `usageUnknown: true` — a whole turn lost with no error anywhere to say so.
  it('decodes a legal lone-CR-terminated body to the same frames as the LF one', async () => {
    const cr = fixture.replace(/\n/g, '\r')
    stubStream(cr)
    const result = await streamRouterChatWithTools(cfg, [], [])
    expect(result.reasoning).toBe('The user wants me to calculate.')
    expect(result.toolCalls).toEqual([
      { id: 'call_83f2da0d', name: 'calc', arguments: '{"expr":"21*2"}' },
    ])
    expect(result.finishReason).toBe('tool_calls')
    expect(result.usage).toEqual({ input: 162, output: 28 })
    expect(result.usageUnknown).toBeUndefined()
  })

  it('decodes a lone-CR body delivered one byte per read', async () => {
    // A lone `\r` at the end of a read is ambiguous — it may be the first half of a CRLF — so it is
    // held back. Held back WITHOUT ever being resolved, every CR body would decode to nothing; and
    // resolved too early, a split CRLF would become a false frame boundary. One byte per read is
    // the case that fails on either mistake.
    const cr = fixture.replace(/\n/g, '\r')
    stubStream(cr, { sliceAt: cr.split('').map((_, i) => i + 1) })
    const result = await streamRouterChatWithTools(cfg, [], [])
    expect(result.reasoning).toBe('The user wants me to calculate.')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.usage).toEqual({ input: 162, output: 28 })
  })

  // A streamed turn stops reading its body EARLY on both of its exits: `[DONE]` arrives before the
  // response ends, and a stream-level error aborts mid-body. Releasing the reader's lock is not
  // releasing the CONNECTION — an un-cancelled body holds its socket until the server times out,
  // so under a connection pool the leak starves the turns that come after it.
  it('cancels the response body when the stream ends at [DONE] before the body does', async () => {
    const cancelled = stubUnclosedStream(fixture)
    const result = await streamRouterChatWithTools(cfg, [], [])
    // The turn still parsed completely — cancelling is cleanup, not truncation.
    expect(result.usage).toEqual({ input: 162, output: 28 })
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  it('cancels the response body when the consumer throws on a stream error frame', async () => {
    const cancelled = stubUnclosedStream(
      frame({ choices: [{ delta: { content: 'partial' } }] }) +
        frame({ error: { message: 'origin timeout' } }) +
        frame({ choices: [{ delta: { content: 'never read' } }] }),
    )
    await expect(streamRouterChatWithTools(cfg, [], [])).rejects.toThrow(
      /router stream error: origin timeout/,
    )
    // The throw unwinds through the generator, so the body must be released on the error path too.
    expect(cancelled).toHaveBeenCalledTimes(1)
  })
})

describe('routerBrain transport selection', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('stays buffered by default — no existing caller changes transport', async () => {
    stubRouter({ choices: [{ message: { content: 'ok' } }] })
    await routerBrain(cfg)([{ role: 'user', content: 'hi' }], [])
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect('stream' in sent).toBe(false)
    expect('stream_options' in sent).toBe(false)
  })

  it('takes the streamed transport when the config opts in, and meters the turn identically', async () => {
    stubStream(
      frame({ choices: [{ delta: { content: 'ok' } }] }) +
        frame({
          choices: [{ index: 0, finish_reason: 'stop', delta: {} }],
          usage: { prompt_tokens: 120, completion_tokens: 45 },
        }) +
        'data: [DONE]\n\n',
    )
    const result = await routerBrain({ ...cfg, stream: true })(
      [{ role: 'user', content: 'hi' }],
      [],
    )
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(sent.stream).toBe(true)
    expect(sent.temperature).toBe(0.4)
    expect(sent.tool_choice).toBe('auto')
    expect(result.content).toBe('ok')
    // Same numbers the buffered brain reports for the same usage — the conserved pool is unaffected
    // by the transport choice.
    expect(result.usage).toEqual({ input: 120, output: 45 })
    expect(result.costUsd).toBeGreaterThan(0)
  })
})
