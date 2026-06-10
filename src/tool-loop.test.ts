import { describe, expect, it } from 'vitest'
import type { RuntimeDecisionPoint, RuntimeHookEvent } from './runtime-hooks'
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

  it('emits general before/after hook events around loop, turn, and tool call boundaries', async () => {
    const events: RuntimeHookEvent[] = []
    const streamTurn = async function* (messages: Array<{ role: string; content: string }>) {
      if (!messages.some((m) => m.content.includes('Tool results'))) {
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
    const streamTurn = async function* (messages: Array<{ role: string; content: string }>) {
      if (!messages.some((m) => m.content.includes('Tool results'))) {
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
    const streamTurn = async function* (messages: Array<{ role: string; content: string }>) {
      if (!messages.some((m) => m.content.includes('Tool results'))) {
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
    const streamTurn = async function* (messages: Array<{ role: string; content: string }>) {
      if (!messages.some((m) => m.content.includes('Tool results'))) {
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
    const streamTurn = async function* (
      messages: Array<{ role: string; content: string }>,
    ): AsyncIterable<Raw> {
      if (!messages.some((m) => m.content.includes('Tool results'))) {
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
