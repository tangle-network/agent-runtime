import { describe, expect, it } from 'vitest'
import { analyzeTrace } from '../../src/runtime'
import {
  type SessionTraceBox,
  sandboxSessionTraceSource,
} from '../../src/runtime/supervise/trace-source'

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
