import { describe, expect, it } from 'vitest'
import type { RuntimeDecisionPoint, RuntimeHookEvent } from './runtime-hooks'
import {
  runToolLoop,
  type StreamToolLoopYield,
  streamToolLoop,
  type ToolCallExecutor,
  type ToolCallOutcome,
  type ToolLoopCall,
  type ToolLoopEvent,
  type ToolLoopMessage,
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
    const streamTurn = async function* (messages: ToolLoopMessage[]) {
      if (!messages.some((m) => m.role === 'tool')) {
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

  it('appends tool history in OpenAI shape: assistant+tool_calls then role:tool per result, no user fold', async () => {
    const seen: ToolLoopMessage[][] = []
    const streamTurn = async function* (messages: ToolLoopMessage[]) {
      seen.push(messages)
      if (!messages.some((m) => m.role === 'tool')) {
        yield { type: 'text', text: 'Routing. ' } as ToolLoopEvent
        yield {
          type: 'tool_call',
          call: { toolName: 'submit_proposal', toolCallId: 'p1', args: { title: 'A' } },
        } as ToolLoopEvent
        return
      }
      yield { type: 'text', text: 'Done.' } as ToolLoopEvent
    }

    await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      executeToolCall: async () => ({ ok: true, result: { id: 1 } }),
      isExecutableTool: isExec,
    })

    // The second turn's history carries the model's own tool use in OpenAI shape.
    const second = seen[1] ?? []
    const assistant = second.find((m) => m.role === 'assistant' && m.tool_calls)
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: 'Routing.',
      tool_calls: [{ id: 'p1', type: 'function', function: { name: 'submit_proposal' } }],
    })
    const tool = second.find((m) => m.role === 'tool')
    expect(tool).toMatchObject({ role: 'tool', tool_call_id: 'p1' })
    // The broken shape — a user message folding results — must not appear.
    expect(
      second.some((m) => m.role === 'user' && (m.content ?? '').includes('Tool results')),
    ).toBe(false)
  })

  it('derives a stable tool_call_id from the tool name when the model omits one', async () => {
    const seen: ToolLoopMessage[][] = []
    const streamTurn = async function* (messages: ToolLoopMessage[]) {
      seen.push(messages)
      if (!messages.some((m) => m.role === 'tool')) {
        yield {
          type: 'tool_call',
          call: { toolName: 'submit_proposal', args: { title: 'A' } },
        } as ToolLoopEvent
        return
      }
      yield { type: 'text', text: 'ok' } as ToolLoopEvent
    }

    await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      executeToolCall: async () => ({ ok: true, result: {} }),
      isExecutableTool: isExec,
    })

    const second = seen[1] ?? []
    const assistant = second.find((m) => m.role === 'assistant' && m.tool_calls)
    const tool = second.find((m) => m.role === 'tool')
    // A tool-only turn carries null content and a name-derived id matching its result.
    expect(assistant?.content).toBeNull()
    expect(assistant?.tool_calls?.[0]?.id).toBe('call_submit_proposal')
    expect(tool?.tool_call_id).toBe('call_submit_proposal')
  })

  it('a strict model that re-issues on a user fold completes on the tool-history shape', async () => {
    // This model mimics a strict tool-history validator (Claude, OpenAI-compat):
    // if its own tool call is folded into a user message it cannot see the
    // result and re-issues the same call forever; given the assistant+tool_calls
    // / role:tool shape it reads the result back and finishes.
    let calls = 0
    const streamTurn = async function* (messages: ToolLoopMessage[]) {
      const sawToolResult = messages.some((m) => m.role === 'tool')
      const wasFoldedIntoUser = messages.some(
        (m) => m.role === 'user' && (m.content ?? '').includes('Tool results'),
      )
      if (sawToolResult && !wasFoldedIntoUser) {
        yield { type: 'text', text: 'Final answer.' } as ToolLoopEvent
        return
      }
      // No readable result yet — re-issue the call (the looping pathology).
      calls++
      yield {
        type: 'tool_call',
        call: { toolName: 'submit_proposal', toolCallId: 'p1', args: { title: 'A' } },
      } as ToolLoopEvent
    }

    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      executeToolCall: async () => ({ ok: true, result: { id: 1 } }),
      isExecutableTool: isExec,
    })

    expect(r.stopReason).toBe('completed')
    expect(r.finalText).toBe('Final answer.')
    // One call, then it reads the result and stops — not a stuck loop.
    expect(calls).toBe(1)
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

  it('stops with backstop stopReason when the model never stops', async () => {
    // Each turn emits a DIFFERENT args object so stuck-loop never fires; only
    // the backstop cap is hit.
    let seq = 0
    const streamTurn = async function* () {
      yield {
        type: 'tool_call',
        call: { toolName: 'schedule_followup', args: { seq: seq++ } },
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
    expect(r.stopReason).toBe('backstop')
    expect(r.cappedOut).toBe(true)
    expect(r.toolResults.length).toBe(3)
  })

  it('detects a stuck loop at exactly 3 consecutive identical calls', async () => {
    // The model re-issues the same tool call with the same args every turn.
    const streamTurn = async function* () {
      yield {
        type: 'tool_call',
        call: { toolName: 'submit_proposal', args: { type: 'x' } },
      } as ToolLoopEvent
    }
    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      executeToolCall: async () => ({ ok: true, result: {} }),
      isExecutableTool: isExec,
    })
    expect(r.stopReason).toBe('stuck-loop')
    expect(r.cappedOut).toBe(true)
    // Fires on the 3rd identical call — 2 tool results recorded before stop.
    expect(r.toolResults.length).toBe(2)
  })

  it('does NOT flag stuck-loop when calls alternate', async () => {
    let turn = 0
    const streamTurn = async function* () {
      // Alternates between two different tool names — not a stuck loop.
      yield {
        type: 'tool_call',
        call: {
          toolName: turn++ % 2 === 0 ? 'submit_proposal' : 'schedule_followup',
          args: {},
        },
      } as ToolLoopEvent
    }
    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      maxToolTurns: 6,
      streamTurn,
      executeToolCall: async () => ({ ok: true, result: {} }),
      isExecutableTool: isExec,
    })
    // Alternating never triggers stuck-loop; hits backstop instead.
    expect(r.stopReason).toBe('backstop')
  })

  it('stops with deadline stopReason when wall-clock is exceeded', async () => {
    const streamTurn = async function* () {
      yield {
        type: 'tool_call',
        call: { toolName: 'submit_proposal', args: {} },
      } as ToolLoopEvent
    }
    // Deadline already in the past.
    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      deadlineMs: Date.now() - 1,
      streamTurn,
      executeToolCall: async () => ({ ok: true, result: {} }),
      isExecutableTool: isExec,
    })
    expect(r.stopReason).toBe('deadline')
    expect(r.cappedOut).toBe(true)
  })

  it('completes normally with more than 50 tool turns when given sufficient backstop', async () => {
    let callCount = 0
    const total = 55
    const streamTurn = async function* () {
      // Each turn emits a DIFFERENT args object so stuck-loop never fires.
      if (callCount < total) {
        yield {
          type: 'tool_call',
          call: { toolName: 'submit_proposal', args: { seq: callCount } },
        } as ToolLoopEvent
      } else {
        yield { type: 'text', text: 'done' } as ToolLoopEvent
      }
    }
    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      maxToolTurns: 200,
      streamTurn,
      executeToolCall: async () => {
        callCount++
        return { ok: true, result: {} }
      },
      isExecutableTool: isExec,
    })
    expect(r.stopReason).toBe('completed')
    expect(r.cappedOut).toBe(false)
    expect(r.toolResults.length).toBe(total)
  })

  it('turns an executor throw into a failed outcome', async () => {
    const streamTurn = async function* (messages: ToolLoopMessage[]) {
      if (!messages.some((m) => m.role === 'tool')) {
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

  it('emits general before/after hook events around loop, turn, and tool call boundaries', async () => {
    const events: RuntimeHookEvent[] = []
    const streamTurn = async function* (messages: ToolLoopMessage[]) {
      if (!messages.some((m) => m.role === 'tool')) {
        yield {
          type: 'tool_call',
          call: { toolName: 'submit_proposal', toolCallId: 'p1', args: { title: 'A' } },
        } as ToolLoopEvent
        return
      }
      yield { type: 'text', text: 'done' } as ToolLoopEvent
    }

    await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      runId: 'hook-run',
      streamTurn,
      executeToolCall: async () => ({ ok: true, result: { id: 1 } }),
      isExecutableTool: isExec,
      hooks: {
        onEvent: (event) => {
          events.push(event)
        },
      },
    })

    expect(
      events.map((event) => `${event.target}:${event.phase}:${event.stepIndex ?? 'loop'}`),
    ).toEqual([
      'agent.run:before:loop',
      'agent.turn:before:0',
      'agent.tool_call:before:0',
      'agent.tool_call:after:0',
      'agent.turn:after:0',
      'agent.turn:before:1',
      'agent.turn:after:1',
      'agent.run:after:loop',
    ])
    expect(events.find((event) => event.target === 'agent.tool_call')?.payload).toMatchObject({
      toolName: 'submit_proposal',
      toolCallId: 'p1',
    })
  })

  it('emits one failure-recovery decision point before the next model turn', async () => {
    const order: string[] = []
    const points: RuntimeDecisionPoint[] = []
    const streamTurn = async function* (messages: ToolLoopMessage[]) {
      if (!messages.some((m) => m.role === 'tool')) {
        order.push('first-turn')
        yield { type: 'text', text: 'I will call the tool.' } as ToolLoopEvent
        yield {
          type: 'tool_call',
          call: {
            toolName: 'submit_proposal',
            toolCallId: 'p1',
            args: { title: 'A' },
          },
        } as ToolLoopEvent
        return
      }
      order.push('second-turn')
      yield { type: 'text', text: 'I will verify the inputs.' } as ToolLoopEvent
    }

    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      runId: 'run-1',
      scenarioId: 'scenario-1',
      streamTurn,
      executeToolCall: async () => ({
        ok: false,
        code: 'invalid_input',
        message: 'missing owner',
      }),
      isExecutableTool: isExec,
      hooks: {
        onDecisionPoint: (point) => {
          order.push('hook')
          points.push(point)
        },
      },
    })

    expect(r.finalText).toBe('I will call the tool.I will verify the inputs.')
    expect(order).toEqual(['first-turn', 'hook', 'second-turn'])
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({
      id: 'run-1:agent.turn:0:failure-recovery',
      runId: 'run-1',
      scenarioId: 'scenario-1',
      stepIndex: 0,
      kind: 'retry',
      candidateActions: ['retry', 'verify', 'continue', 'stop'],
      metadata: {
        target: 'failure-recovery',
        source: 'agent.turn',
        failedToolCount: 1,
        toolNames: ['submit_proposal'],
      },
    })
    expect(points[0]?.context).toContain('missing owner')
    expect(points[0]?.evidence.map((ref) => ref.source)).toEqual(['tool_call', 'tool_result'])
  })

  it('does not emit a failure-recovery decision point for successful tool results', async () => {
    const points: RuntimeDecisionPoint[] = []
    const streamTurn = async function* (messages: ToolLoopMessage[]) {
      if (!messages.some((m) => m.role === 'tool')) {
        yield {
          type: 'tool_call',
          call: { toolName: 'submit_proposal', args: {} },
        } as ToolLoopEvent
        return
      }
      yield { type: 'text', text: 'done' } as ToolLoopEvent
    }

    await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      executeToolCall: async () => ({ ok: true, result: { id: 1 } }),
      isExecutableTool: isExec,
      hooks: {
        onDecisionPoint: (point) => {
          points.push(point)
        },
      },
    })

    expect(points).toHaveLength(0)
  })

  it('isolates hook failures from the tool loop', async () => {
    const hookErrors: string[] = []
    const streamTurn = async function* (messages: ToolLoopMessage[]) {
      if (!messages.some((m) => m.role === 'tool')) {
        yield {
          type: 'tool_call',
          call: { toolName: 'submit_proposal', args: {} },
        } as ToolLoopEvent
        return
      }
      yield { type: 'text', text: 'recovered' } as ToolLoopEvent
    }

    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      executeToolCall: async () => ({
        ok: false,
        code: 'executor_error',
        message: 'db down',
      }),
      isExecutableTool: isExec,
      hooks: {
        onDecisionPoint: () => {
          throw new Error('hook down')
        },
        onHookError: (error, context) => {
          hookErrors.push(`${context.hook}:${error.message}`)
        },
      },
    })

    expect(r.finalText).toBe('recovered')
    expect(hookErrors).toEqual(['onDecisionPoint:hook down'])
  })

  it('isolates general hook failures from the tool loop', async () => {
    const hookErrors: string[] = []
    const streamTurn = async function* () {
      yield { type: 'text', text: 'done' } as ToolLoopEvent
    }

    const r = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      executeToolCall: async () => ({ ok: true, result: {} }),
      isExecutableTool: isExec,
      hooks: {
        onEvent: () => {
          throw new Error('event hook down')
        },
        onHookError: (error, context) => {
          hookErrors.push(`${context.hook}:${error.message}`)
        },
      },
    })

    expect(r.finalText).toBe('done')
    expect(hookErrors).toContain('onEvent:event hook down')
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
    const streamTurn = async function* (messages: ToolLoopMessage[]): AsyncIterable<Raw> {
      if (!messages.some((m) => m.role === 'tool')) {
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

  it('appends tool history in OpenAI shape (assistant+tool_calls then role:tool), no user fold', async () => {
    const seen: ToolLoopMessage[][] = []
    const streamTurn = async function* (messages: ToolLoopMessage[]): AsyncIterable<Raw> {
      seen.push(messages)
      if (!messages.some((m) => m.role === 'tool')) {
        yield { type: 'text_delta', text: 'Routing. ' }
        yield { type: 'tool_call', toolName: 'submit_proposal', toolCallId: 'p1', args: { a: 1 } }
        return
      }
      yield { type: 'text_delta', text: 'Done.' }
    }
    for await (const _ of streamToolLoop<Raw>({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      ...seams,
      executeToolCall: async () => ({ ok: true, result: {} }),
    })) {
      // drain
    }
    const second = seen[1] ?? []
    expect(second.find((m) => m.role === 'assistant' && m.tool_calls)).toMatchObject({
      tool_calls: [{ id: 'p1', type: 'function', function: { name: 'submit_proposal' } }],
    })
    expect(second.find((m) => m.role === 'tool')).toMatchObject({
      role: 'tool',
      tool_call_id: 'p1',
    })
    expect(
      second.some((m) => m.role === 'user' && (m.content ?? '').includes('Tool results')),
    ).toBe(false)
  })

  it('echoes the provider fields a model attached to a call on its tool_calls entry', async () => {
    // Gemini 3 answers HTTP 400 when the next request drops a call's thought_signature.
    const extraContent = { google: { thought_signature: 'sig-abc' } }
    const seen: ToolLoopMessage[][] = []
    const streamTurn = async function* (messages: ToolLoopMessage[]): AsyncIterable<Raw> {
      seen.push(messages)
      if (!messages.some((m) => m.role === 'tool')) {
        yield { type: 'tool_call', toolName: 'submit_proposal', toolCallId: 'p1', args: { a: 1 } }
        return
      }
      yield { type: 'text_delta', text: 'Done.' }
    }
    for await (const _ of streamToolLoop<Raw>({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn,
      ...seams,
      extractToolCall: (e: Raw): ToolLoopCall | null =>
        e.type === 'tool_call'
          ? {
              toolName: e.toolName,
              toolCallId: e.toolCallId,
              args: e.args,
              providerFields: { extra_content: extraContent },
            }
          : null,
      executeToolCall: async () => ({ ok: true, result: {} }),
    })) {
      // drain
    }
    const assistant = seen[1]?.find((m) => m.role === 'assistant' && m.tool_calls)
    expect(assistant?.tool_calls).toEqual([
      {
        extra_content: extraContent,
        id: 'p1',
        type: 'function',
        function: { name: 'submit_proposal', arguments: '{"a":1}' },
      },
    ])
  })

  it('emits one capped signal with backstop stopReason when the model never stops', async () => {
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
    const capped = ys.filter((y) => y.kind === 'capped')
    expect(capped).toHaveLength(1)
    expect(capped[0]).toMatchObject({ kind: 'capped', stopReason: 'backstop' })
  })

  it('emits capped with stuck-loop stopReason on 3 consecutive identical calls', async () => {
    const streamTurn = async function* (): AsyncIterable<Raw> {
      yield { type: 'tool_call', toolName: 'submit_proposal', args: { type: 'x' } }
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
    const capped = ys.filter((y) => y.kind === 'capped')
    expect(capped).toHaveLength(1)
    expect(capped[0]).toMatchObject({ kind: 'capped', stopReason: 'stuck-loop' })
  })

  it('emits a failure-recovery decision point without changing streamed yields', async () => {
    const points: RuntimeDecisionPoint[] = []
    const streamTurn = async function* (messages: ToolLoopMessage[]): AsyncIterable<Raw> {
      if (!messages.some((m) => m.role === 'tool')) {
        yield { type: 'text_delta', text: 'Trying. ' }
        yield { type: 'tool_call', toolName: 'submit_proposal', toolCallId: 'p1', args: {} }
        return
      }
      yield { type: 'text_delta', text: 'Retrying.' }
    }

    const ys: StreamToolLoopYield<Raw>[] = []
    for await (const item of streamToolLoop<Raw>({
      systemPrompt: 's',
      userMessage: 'u',
      runId: 'stream-run',
      streamTurn,
      ...seams,
      executeToolCall: async () => ({
        ok: false,
        code: 'rate_limited',
        message: 'slow down',
      }),
      hooks: {
        onDecisionPoint: (point) => {
          points.push(point)
        },
      },
    }))
      ys.push(item)

    expect(ys.map((y) => y.kind)).toEqual(['event', 'event', 'tool_result', 'event'])
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({
      id: 'stream-run:agent.turn:0:failure-recovery',
      kind: 'retry',
      candidateActions: ['retry', 'verify', 'continue', 'stop'],
    })
  })
})

describe('tool progress', () => {
  type Raw = { t: 'text'; text: string } | { t: 'call'; call: ToolLoopCall }
  const progressSeams = {
    extractText: (e: Raw) => (e.t === 'text' ? e.text : ''),
    extractToolCall: (e: Raw) => (e.t === 'call' ? e.call : null),
    isExecutableTool: (n: string) => n === 'build',
  }
  const progressTurn = async function* (messages: ToolLoopMessage[]): AsyncGenerator<Raw> {
    if (!messages.some((m) => m.role === 'tool')) {
      yield { t: 'call', call: { toolName: 'build', toolCallId: 'b1', args: {} } }
    } else {
      yield { t: 'text', text: 'built' }
    }
  }
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1))
  const reportingExecutor: ToolCallExecutor = async (_call, { progress }) => {
    // A burst of two before the first await, then one more later: order holds either way.
    progress({ message: 'resolving', progress: 1, total: 3 })
    progress({ message: 'compiling', progress: 2, total: 3 })
    await tick()
    progress({ message: 'linking', progress: 3, total: 3 })
    return { ok: true, result: { artifact: 'app' } }
  }

  it('yields each progress update in order, while the call runs, before its tool_result', async () => {
    const ys: StreamToolLoopYield<Raw>[] = []
    for await (const item of streamToolLoop<Raw>({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn: progressTurn,
      ...progressSeams,
      executeToolCall: reportingExecutor,
    }))
      ys.push(item)

    expect(ys.map((y) => y.kind)).toEqual([
      'event',
      'tool_progress',
      'tool_progress',
      'tool_progress',
      'tool_result',
      'event',
    ])
    expect(ys.filter((y) => y.kind === 'tool_progress')).toEqual(
      ['resolving', 'compiling', 'linking'].map((message, i) => ({
        kind: 'tool_progress',
        toolName: 'build',
        toolCallId: 'b1',
        update: { message, progress: i + 1, total: 3 },
      })),
    )
  })

  it('delivers an update while the call is still running, not after it settles', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const loop = streamToolLoop<Raw>({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn: progressTurn,
      ...progressSeams,
      executeToolCall: async (_call, { progress }) => {
        await tick()
        progress({ message: 'waiting on the box' })
        await gate
        return { ok: true, result: null }
      },
    })
    expect((await loop.next()).value).toMatchObject({ kind: 'event' })
    // The tool has not returned (the gate is shut), yet its update is already out.
    expect((await loop.next()).value).toMatchObject({
      kind: 'tool_progress',
      update: { message: 'waiting on the box' },
    })
    release()
    expect((await loop.next()).value).toMatchObject({ kind: 'tool_result' })
  })

  it('drops an update a tool sends after its call settled', async () => {
    const ys: StreamToolLoopYield<Raw>[] = []
    for await (const item of streamToolLoop<Raw>({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn: progressTurn,
      ...progressSeams,
      executeToolCall: async (_call, { progress }) => {
        progress({ message: 'on time' })
        setTimeout(() => progress({ message: 'too late' }), 0)
        return { ok: true, result: null }
      },
    })) {
      ys.push(item)
      // A slow consumer: the call settles and the late update fires before the next pull.
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    }
    expect(ys.map((y) => y.kind)).toEqual(['event', 'tool_progress', 'tool_result', 'event'])
    expect(ys[1]).toMatchObject({ update: { message: 'on time' } })
  })

  it('reports a progressing tool that throws as an executor_error after its updates', async () => {
    const ys: StreamToolLoopYield<Raw>[] = []
    for await (const item of streamToolLoop<Raw>({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn: progressTurn,
      ...progressSeams,
      executeToolCall: async (_call, { progress }) => {
        progress({ message: 'started' })
        await tick()
        throw new Error('box lost')
      },
    }))
      ys.push(item)
    expect(ys.map((y) => y.kind)).toEqual(['event', 'tool_progress', 'tool_result', 'event'])
    expect(ys[2]).toMatchObject({
      outcome: { ok: false, code: 'executor_error', message: 'box lost' },
    })
  })

  it('hands runToolLoop progress to onToolProgress in order', async () => {
    const seen: string[] = []
    const result = await runToolLoop({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn: async function* (messages) {
        if (!messages.some((m) => m.role === 'tool')) {
          yield { type: 'tool_call', call: { toolName: 'build', toolCallId: 'b1', args: {} } }
        } else {
          yield { type: 'text', text: 'built' }
        }
      },
      isExecutableTool: (n) => n === 'build',
      executeToolCall: reportingExecutor,
      onToolProgress: (call, update) => seen.push(`${call.toolCallId}:${update.message}`),
    })
    expect(result.stopReason).toBe('completed')
    expect(seen).toEqual(['b1:resolving', 'b1:compiling', 'b1:linking'])
  })

  it('still accepts an executor that takes only the call', async () => {
    const callOnly = async (call: ToolLoopCall): Promise<ToolCallOutcome> => ({
      ok: true,
      result: call.toolName,
    })
    const ys: StreamToolLoopYield<Raw>[] = []
    for await (const item of streamToolLoop<Raw>({
      systemPrompt: 's',
      userMessage: 'u',
      streamTurn: progressTurn,
      ...progressSeams,
      executeToolCall: callOnly,
    }))
      ys.push(item)
    expect(ys.map((y) => y.kind)).toEqual(['event', 'tool_result', 'event'])
  })
})
