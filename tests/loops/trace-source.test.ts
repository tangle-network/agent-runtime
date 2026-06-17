import { describe, expect, it } from 'vitest'
import {
  analyzeTrace,
  createPushTraceSource,
  decodeToolPart,
  type SessionTraceBox,
  sandboxSessionTraceSource,
} from '../../src/runtime'

describe('decodeToolPart — defensive across harness + OpenAI shapes', () => {
  it('decodes an OpenAI tool_call (function shape, string args)', () => {
    expect(
      decodeToolPart({ type: 'function', function: { name: 'run', arguments: '{"path":"src/"}' } }),
    ).toEqual({ toolName: 'run', args: { path: 'src/' } })
  })

  it('decodes a harness tool part (type=tool, input/state)', () => {
    expect(
      decodeToolPart({
        type: 'tool',
        toolName: 'edit',
        input: { file: 'a.ts' },
        state: 'completed',
      }),
    ).toEqual({ toolName: 'edit', args: { file: 'a.ts' }, status: 'ok' })
  })

  it('flags an errored tool part', () => {
    expect(decodeToolPart({ type: 'tool-call', name: 'build', args: {}, state: 'error' })).toEqual({
      toolName: 'build',
      args: {},
      status: 'error',
    })
  })

  it('returns undefined for non-tool parts (text, reasoning)', () => {
    expect(decodeToolPart({ type: 'text', text: 'hi' })).toBeUndefined()
    expect(decodeToolPart({ type: 'reasoning', text: '...' })).toBeUndefined()
    expect(decodeToolPart(null)).toBeUndefined()
  })
})

describe('sandboxSessionTraceSource — the production (box) path', () => {
  // A mock box matching the real `box.messages({sessionId})` surface; messages carry harness parts.
  const box: SessionTraceBox = {
    messages: async () => [
      {
        parts: [
          { type: 'text', text: 'working' },
          { type: 'tool', toolName: 'grep', input: { q: 'x' } },
        ],
      },
      { parts: [{ type: 'tool', toolName: 'grep', input: { q: 'x' } }] },
      { parts: [{ type: 'tool', toolName: 'grep', input: { q: 'x' } }] },
    ],
  }

  it('collects the harness tool calls from session parts and the batch analyzer sees the loop', async () => {
    const source = sandboxSessionTraceSource(box, 'sess-1')
    const spans = await source.collect()
    expect(spans.map((s) => s.toolName)).toEqual(['grep', 'grep', 'grep'])
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
})
