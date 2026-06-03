import { describe, expect, it } from 'vitest'
import {
  runToolLoop,
  type StreamToolLoopYield,
  streamToolLoop,
  type ToolCallOutcome,
  type ToolLoopCall,
  type ToolLoopEvent,
} from './tool-loop'

const isExec = (n: string) => n === 'submit_proposal' || n === 'schedule_followup'

describe('runToolLoop', () => {
  it('returns text immediately when no tool calls are emitted (single turn)', async () => {
    const stream = async function* () {
      yield { type: 'text', text: 'Here is my analysis.' } as ToolLoopEvent
    }
    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn: () => stream(),
      executeToolCall: async () => ({ ok: true, result: {} }),
      isExecutableTool: isExec,
    })
    expect(r.finalText).toBe('Here is my analysis.')
    expect(r.turns).toBe(1)
    expect(r.toolResults).toHaveLength(0)
    expect(r.cappedOut).toBe(false)
  })

  it('executes a tool call, folds the result back, re-runs to the final answer', async () => {
    const calls: ToolLoopCall[] = []
    const streamTurn = async function* (messages: Array<{ role: string; content: string }>) {
      if (!messages.some((m) => m.content.includes('Tool results'))) {
        yield { type: 'text', text: 'Routing. ' } as ToolLoopEvent
        yield {
          type: 'tool_call',
          call: { toolName: 'submit_proposal', toolCallId: 'p1', args: { type: 'x', title: 'A' } },
        } as ToolLoopEvent
        return
      }
      yield { type: 'text', text: 'Done.' } as ToolLoopEvent
    }
    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      executeToolCall: async (c) => {
        calls.push(c)
        return { ok: true, result: { id: 1 } } satisfies ToolCallOutcome
      },
      isExecutableTool: isExec,
    })
    expect(calls).toHaveLength(1)
    expect(r.turns).toBe(2)
    expect(r.finalText).toBe('Routing. Done.')
  })

  it('ignores non-executable tool calls', async () => {
    const stream = async function* () {
      yield { type: 'text', text: 'done' } as ToolLoopEvent
      yield { type: 'tool_call', call: { toolName: 'render_widget', args: {} } } as ToolLoopEvent
    }
    let executed = 0
    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn: () => stream(),
      executeToolCall: async () => {
        executed++
        return { ok: true, result: {} }
      },
      isExecutableTool: isExec,
    })
    expect(executed).toBe(0)
    expect(r.turns).toBe(1)
  })

  it('caps the loop and flags cappedOut when the model never stops', async () => {
    const streamTurn = async function* () {
      yield {
        type: 'tool_call',
        call: { toolName: 'schedule_followup', args: {} },
      } as ToolLoopEvent
    }
    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      maxToolTurns: 3,
      streamTurn,
      executeToolCall: async () => ({ ok: true, result: {} }),
      isExecutableTool: isExec,
    })
    expect(r.cappedOut).toBe(true)
    expect(r.toolResults.length).toBe(3)
  })

  it('turns an executor throw into a failed outcome', async () => {
    const streamTurn = async function* (messages: Array<{ role: string; content: string }>) {
      if (!messages.some((m) => m.content.includes('Tool results'))) {
        yield {
          type: 'tool_call',
          call: { toolName: 'submit_proposal', args: {} },
        } as ToolLoopEvent
        return
      }
      yield { type: 'text', text: 'noted' } as ToolLoopEvent
    }
    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      executeToolCall: async () => {
        throw new Error('db down')
      },
      isExecutableTool: isExec,
    })
    expect(r.toolResults[0]?.outcome).toEqual({
      ok: false,
      code: 'executor_error',
      message: 'db down',
    })
  })
})

type Raw =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; toolName: string; toolCallId?: string; args: Record<string, unknown> }

describe('streamToolLoop', () => {
  const seams = {
    extractText: (e: Raw) => (e.type === 'text_delta' ? e.text : ''),
    extractToolCall: (e: Raw): ToolLoopCall | null =>
      e.type === 'tool_call'
        ? { toolName: e.toolName, toolCallId: e.toolCallId, args: e.args }
        : null,
    isExecutableTool: (n: string) => n === 'submit_proposal',
  }

  it('yields each raw event + each tool_result and drives the loop', async () => {
    const streamTurn = async function* (
      messages: Array<{ role: string; content: string }>,
    ): AsyncIterable<Raw> {
      if (!messages.some((m) => m.content.includes('Tool results'))) {
        yield { type: 'text_delta', text: 'Routing. ' }
        yield { type: 'tool_call', toolName: 'submit_proposal', toolCallId: 'p1', args: {} }
        return
      }
      yield { type: 'text_delta', text: 'Done.' }
    }
    const ys: StreamToolLoopYield<Raw>[] = []
    for await (const item of streamToolLoop<Raw>({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      ...seams,
      executeToolCall: async () => ({ ok: true, result: {} }),
    }))
      ys.push(item)
    expect(ys.filter((y) => y.kind === 'event').length).toBe(3)
    expect(ys.filter((y) => y.kind === 'tool_result').length).toBe(1)
  })

  it('emits one capped signal when the model never stops', async () => {
    const streamTurn = async function* (): AsyncIterable<Raw> {
      yield { type: 'tool_call', toolName: 'submit_proposal', args: {} }
    }
    const ys: StreamToolLoopYield<Raw>[] = []
    for await (const item of streamToolLoop<Raw>({
      systemPrompt: 's',
      userMessage: 'u',
      maxToolTurns: 2,
      streamTurn,
      ...seams,
      executeToolCall: async () => ({ ok: true, result: {} }),
    }))
      ys.push(item)
    expect(ys.filter((y) => y.kind === 'capped')).toHaveLength(1)
  })
})
