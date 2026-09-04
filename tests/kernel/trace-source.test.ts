import { describe, expect, it } from 'vitest'
import {
  analyzeTrace,
  createPushTraceSource,
  decodeToolPart,
  type SessionTraceBox,
  sandboxSessionTraceSource,
} from '../../src/runtime'

describe('decodeToolPart — validated against the LIVE opencode shape', () => {
  it('decodes a real opencode tool part (tool=name string, state.input, state.status, callID)', () => {
    expect(
      decodeToolPart({
        type: 'tool',
        tool: 'read',
        callID: 'call_1',
        state: { status: 'completed', input: { filePath: 'a.ts' } },
      }),
    ).toEqual({ toolName: 'read', args: { filePath: 'a.ts' }, status: 'ok', callId: 'call_1' })
  })

  it('skips an in-progress opencode part (pending/running — no populated args yet)', () => {
    expect(
      decodeToolPart({
        type: 'tool',
        tool: 'read',
        callID: 'call_1',
        state: { status: 'pending', input: {} },
      }),
    ).toBeUndefined()
  })

  it('decodes an OpenAI tool_call (codex/router/kimi: function shape, string args)', () => {
    expect(
      decodeToolPart({
        type: 'function',
        id: 'call_x',
        function: { name: 'run', arguments: '{"path":"src/"}' },
      }),
    ).toEqual({ toolName: 'run', args: { path: 'src/' }, callId: 'call_x' })
  })

  it('decodes an Anthropic / claude-code tool_use block (cli-bridge claude.ts shape)', () => {
    expect(
      decodeToolPart({ type: 'tool_use', id: 'toolu_1', name: 'edit', input: { file: 'a.ts' } }),
    ).toEqual({ toolName: 'edit', args: { file: 'a.ts' }, callId: 'toolu_1' })
  })

  it("decodes kimi's tool_use variant (tool_use_id / tool fallbacks, per cli-bridge kimi.ts)", () => {
    expect(
      decodeToolPart({ type: 'tool_use', tool_use_id: 'k1', tool: 'read', input: { f: 'x' } }),
    ).toEqual({ toolName: 'read', args: { f: 'x' }, callId: 'k1' })
  })

  it("decodes BOTH kimi shapes when the harness that arrives is named ('kimi-code')", () => {
    // kimi-code streams a tool_use content block AND a top-level OpenAI tool_calls entry on one
    // session (cli-bridge kimi.ts surfaces each from a different part of the wire). Binding the
    // harness to one of the two decoders drops half of a worker's tool calls with no error: the
    // trace just reports fewer calls, and every rate computed from it is wrong.
    expect(
      decodeToolPart(
        { type: 'tool_use', tool_use_id: 'k1', tool: 'read', input: { f: 'x' } },
        'kimi-code',
      ),
    ).toEqual({ toolName: 'read', args: { f: 'x' }, callId: 'k1' })
    expect(
      decodeToolPart(
        { type: 'function', id: 'call_k', function: { name: 'bash', arguments: '{"cmd":"ls"}' } },
        'kimi-code',
      ),
    ).toEqual({ toolName: 'bash', args: { cmd: 'ls' }, callId: 'call_k' })
  })

  it('a known harness selects its adapter (opencode shape only decodes under opencode)', () => {
    const part = {
      type: 'tool',
      tool: 'read',
      callID: 'c',
      state: { status: 'completed', input: {} },
    }
    expect(decodeToolPart(part, 'opencode')).toMatchObject({ toolName: 'read' })
    // Under the anthropic adapter the opencode shape is not a tool_use → no false decode.
    expect(decodeToolPart(part, 'claude-code')).toBeUndefined()
  })

  it('flags an errored tool part', () => {
    expect(
      decodeToolPart({
        type: 'tool',
        tool: 'build',
        callID: 'c2',
        state: { status: 'error', input: {} },
      }),
    ).toMatchObject({ toolName: 'build', status: 'error' })
  })

  it("flags a 'failed' tool part (ToolStateError.status is 'error' | 'failed')", () => {
    // The agent-interface ToolState union allows both; decoding against the real type covers 'failed'.
    expect(
      decodeToolPart({
        type: 'tool',
        tool: 'build',
        callID: 'c3',
        state: { status: 'failed', input: {} },
      }),
    ).toMatchObject({ toolName: 'build', status: 'error' })
  })

  it('returns undefined for non-tool parts (text, reasoning)', () => {
    expect(decodeToolPart({ type: 'text', text: 'hi' })).toBeUndefined()
    expect(decodeToolPart({ type: 'reasoning', text: '...' })).toBeUndefined()
    expect(decodeToolPart(null)).toBeUndefined()
  })
})

describe('sandboxSessionTraceSource — the production (box) path, real opencode parts', () => {
  // Mirrors the LIVE stream: each call appears as pending→completed AND a `raw`-wrapped copy. The
  // source must de-dup by callID to one span per call. Three DISTINCT grep calls = a real loop.
  const toolPart = (callID: string, status: string) => ({
    type: 'tool',
    tool: 'grep',
    callID,
    state: { status, input: { q: 'x' } },
  })
  const box: SessionTraceBox = {
    messages: async () => [
      { parts: [{ type: 'reasoning', text: 'let me search' }] },
      { parts: [toolPart('c1', 'pending'), toolPart('c1', 'completed')] },
      { parts: [{ type: 'raw', state: { status: 'completed' }, tool: 'grep', callID: 'c1' }] }, // raw dup
      { parts: [toolPart('c2', 'completed')] },
      { parts: [toolPart('c3', 'completed')] },
    ],
  }

  it('collects ONE span per callID (de-duped) and the batch analyzer sees the 3-call loop', async () => {
    const source = sandboxSessionTraceSource(box, 'sess-1')
    const spans = await source.collect()
    // c1's pending + completed + raw-dup collapse to one; c2, c3 each one → 3 total.
    expect(spans.map((s) => s.toolName)).toEqual(['grep', 'grep', 'grep'])
    expect(spans.every((s) => s.toolName === 'grep')).toBe(true)
    const analysis = await analyzeTrace(source)
    expect(analysis.trajectory.toolCalls).toBe(3)
    expect(analysis.stuckLoop.findings.find((f) => f.toolName === 'grep')?.occurrences).toBe(3)
  })
})

describe('createPushTraceSource — owned-loop path', () => {
  it('records steps as spans, fans out live, and buffers for collect', async () => {
    const seen: string[] = []
    const { source, record } = createPushTraceSource({ runId: 'p' })
    const off = source.onSpan((s) => seen.push(s.toolName))
    record({ toolName: 'a', args: {} })
    record({ toolName: 'b', args: {} })
    off()
    record({ toolName: 'c', args: {} }) // after unsubscribe — buffered but not streamed
    expect(seen).toEqual(['a', 'b'])
    expect((await source.collect()).map((s) => s.toolName)).toEqual(['a', 'b', 'c'])
  })

  it('leaves the status UNSTATED when the source never saw the call finish', async () => {
    const { source, record } = createPushTraceSource({ runId: 'p' })
    // A source that sees the call being MADE but never its result (cli-bridge's `tool_calls`
    // deltas) must not have that call read as a success. `status` is optional on `ToolSpan`
    // exactly so an unobserved outcome can stay unstated.
    record({ toolName: 'decided', args: { path: 'x' }, statusCaptured: false })
    record({ toolName: 'finished', args: {}, status: 'error', error: 'boom' })
    const spans = await source.collect()
    expect('status' in (spans[0] as object)).toBe(false)
    expect(spans[0]?.endedAt).toBe(spans[0]?.startedAt)
    expect(spans[1]?.status).toBe('error')
  })

  it('still defaults an observed call with no explicit status to ok', async () => {
    const { source, record } = createPushTraceSource({ runId: 'p' })
    record({ toolName: 'observed', args: {} })
    expect((await source.collect())[0]?.status).toBe('ok')
  })
})

describe('sandboxSessionTraceSource — a claude-code box publishes canonical ToolParts', () => {
  it('decodes the box-normalized `type: "tool"` parts under harness claude-code', async () => {
    // What a live box returns from `messages()` for a claude-code session: the canonical ToolPart,
    // not the raw Anthropic `tool_use` block the bridge streams.
    const box = {
      async messages() {
        return [
          {
            parts: [
              { type: 'text', text: 'looking' },
              {
                id: 'toolu_01',
                type: 'tool',
                callID: 'toolu_01',
                tool: 'Bash',
                state: { status: 'completed', input: { command: 'pwd' }, output: '/home/agent' },
              },
              {
                id: 'toolu_02',
                type: 'tool',
                callID: 'toolu_02',
                tool: 'Read',
                state: { status: 'failed', input: { file_path: 'x' }, error: 'ENOENT' },
              },
            ],
          },
        ]
      },
    }
    const spans = await sandboxSessionTraceSource(box, 'loop-sess-1', {
      harness: 'claude-code',
    }).collect()
    expect(spans.map((s) => s.toolName)).toEqual(['Bash', 'Read'])
    expect(spans.map((s) => s.status)).toEqual(['ok', 'error'])
  })

  it('still reads a raw Anthropic tool_use block when a session streams unnormalized parts', async () => {
    const box = {
      async messages() {
        return [
          { parts: [{ type: 'tool_use', id: 'toolu_09', name: 'Grep', input: { pattern: 'x' } }] },
        ]
      },
    }
    const spans = await sandboxSessionTraceSource(box, 'loop-sess-2', {
      harness: 'claude-code',
    }).collect()
    expect(spans.map((s) => s.toolName)).toEqual(['Grep'])
  })
})
