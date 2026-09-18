import { describe, expect, it, vi } from 'vitest'
import { runBrainLoop } from '../../src/runtime/tool-loop'

const initialMessages = [
  { role: 'system', content: 'Keep the task constraints.' },
  { role: 'user', content: 'Complete the task.' },
  { role: 'assistant', content: 'Earlier work.' },
  { role: 'user', content: 'More evidence.' },
]

const response = {
  content: 'done',
  toolCalls: [],
  usage: { input: 10, output: 2 },
}

describe('tool-loop preparation authority', () => {
  it('does not compact or infer after cancellation during a classifier hook', async () => {
    const controller = new AbortController()
    const chat = vi.fn(async () => response)
    const distill = vi.fn(async () => 'digest')
    const execute = vi.fn(async () => 'tool output')
    const result = await runBrainLoop({
      initialMessages,
      chat,
      tools: [],
      execute,
      hooks: {
        stopBefore: () => controller.signal.aborted,
        beforeTurn: async (_turn, messages) => {
          await Promise.resolve()
          messages.push({ role: 'user', content: 'Classifier observation retained.' })
          controller.abort()
        },
      },
      compaction: { thresholdTokens: 1, distill },
    })
    expect(chat).not.toHaveBeenCalled()
    expect(distill).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(result.turns).toBe(0)
    expect(result.usage).toEqual({ input: 0, output: 0 })
    expect(result.messages.at(-1)?.content).toBe('Classifier observation retained.')
  })

  it('does not infer when compaction consumes the remaining execution budget', async () => {
    let budgetAvailable = true
    const chat = vi.fn(async () => response)
    const onCompact = vi.fn()
    const result = await runBrainLoop({
      initialMessages,
      chat,
      tools: [],
      execute: async () => 'unused',
      hooks: { stopBefore: () => !budgetAvailable },
      compaction: {
        thresholdTokens: 1,
        distill: async () => {
          await Promise.resolve()
          budgetAvailable = false
          return 'Completed compaction retained for resume.'
        },
        onCompact,
      },
    })
    expect(chat).not.toHaveBeenCalled()
    expect(onCompact).toHaveBeenCalledOnce()
    expect(result.turns).toBe(0)
    expect(result.messages.at(-1)?.content).toContain('Completed compaction retained for resume.')
    expect(result.messages.slice(0, 2)).toEqual(initialMessages.slice(0, 2))
  })

  it('retains completed turns, tool results, and metering when a later hook stops the run', async () => {
    let stopped = false
    const onUsage = vi.fn()
    const chat = vi.fn(async () => ({
      content: 'Check the evidence.',
      toolCalls: [{ id: 'tool-1', name: 'read', arguments: '{}' }],
      usage: { input: 10, output: 2 },
    }))
    const execute = vi.fn(async () => 'Observed evidence.')
    const result = await runBrainLoop({
      initialMessages: initialMessages.slice(0, 2),
      tools: [],
      maxTurns: 0,
      chat,
      execute,
      hooks: {
        stopBefore: () => stopped,
        beforeTurn: async (turn) => {
          await Promise.resolve()
          if (turn === 2) stopped = true
        },
        onUsage,
      },
    })
    expect(chat).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledOnce()
    expect(onUsage).toHaveBeenCalledExactlyOnceWith({ input: 10, output: 2 })
    expect(result.turns).toBe(1)
    expect(result.toolCalls).toBe(1)
    expect(result.usage).toEqual({ input: 10, output: 2 })
    expect(result.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'tool-1',
      content: 'Observed evidence.',
    })
  })
})
