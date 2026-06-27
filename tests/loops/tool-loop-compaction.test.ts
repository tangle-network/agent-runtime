import { describe, expect, it } from 'vitest'
import { runBrainLoop, type ToolLoopChat } from '../../src/runtime/tool-loop'

/** A brain that requests a tool call for the first `toolTurns` turns (forcing the conversation to
 *  accumulate), then answers with final text. Records the conversation SIZE it saw each turn so the
 *  test can assert growth vs boundedness. */
function recordingBrain(toolTurns: number, sizesSeen: number[]): ToolLoopChat {
  let t = 0
  return async (messages) => {
    sizesSeen.push(messages.length)
    t += 1
    if (t <= toolTurns)
      return { content: '', toolCalls: [{ id: `c${t}`, name: 'work', arguments: '{}' }] }
    return { content: 'done', toolCalls: [] }
  }
}

const tools = [
  { type: 'function' as const, function: { name: 'work', description: 'w', parameters: {} } },
]
const init = [
  { role: 'system', content: 'SYS' },
  { role: 'user', content: 'TASK' },
]
const bigResult = 'x'.repeat(4000) // ≈ 1000 tokens per tool result, well over a small threshold

describe('runBrainLoop self-compaction', () => {
  it('without compaction the conversation grows unbounded across turns', async () => {
    const sizes: number[] = []
    await runBrainLoop({
      chat: recordingBrain(6, sizes),
      tools,
      execute: async () => bigResult,
      initialMessages: init,
      maxTurns: 8,
    })
    expect(sizes[sizes.length - 1]).toBeGreaterThan(sizes[0]!)
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(12) // 2 + 2·(6 tool turns)
  })

  it('with compaction the conversation stays bounded and preserves the head', async () => {
    const sizes: number[] = []
    const events: Array<{ beforeTokens: number; afterTokens: number }> = []
    let headPreserved = true
    const inner = recordingBrain(6, sizes)
    const chat: ToolLoopChat = async (messages, t) => {
      const head0 = (messages[0] as { content?: unknown }).content
      const head1 = (messages[1] as { content?: unknown }).content
      if (head0 !== 'SYS' || head1 !== 'TASK') headPreserved = false
      return inner(messages, t)
    }
    await runBrainLoop({
      chat,
      tools,
      execute: async () => bigResult,
      initialMessages: init,
      maxTurns: 8,
      compaction: {
        thresholdTokens: 200,
        distill: () => 'DIGEST',
        onCompact: (info) => events.push(info),
      },
    })
    expect(headPreserved).toBe(true)
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.afterTokens).toBeLessThan(events[0]!.beforeTokens)
    // After each compaction the conversation resets to [system, task, digest] (3) and re-grows by one
    // tool round (5) before the next compaction — it never approaches the unbounded run's max (14).
    expect(Math.max(...sizes)).toBeLessThanOrEqual(6)
  })

  it('does not fire while the conversation stays below the threshold', async () => {
    const sizes: number[] = []
    let fired = 0
    await runBrainLoop({
      chat: recordingBrain(3, sizes),
      tools,
      execute: async () => 'small',
      initialMessages: init,
      maxTurns: 5,
      compaction: {
        thresholdTokens: 1_000_000,
        distill: () => 'DIGEST',
        onCompact: () => {
          fired += 1
        },
      },
    })
    expect(fired).toBe(0)
  })

  it('a negative preserveHead is clamped (never splices from the end / preserves the wrong messages)', async () => {
    const sizes: number[] = []
    let headIntact = true
    const inner = recordingBrain(6, sizes)
    const chat: ToolLoopChat = async (messages, t) => {
      if ((messages[0] as { content?: unknown }).content !== 'SYS') headIntact = false
      return inner(messages, t)
    }
    await runBrainLoop({
      chat,
      tools,
      execute: async () => bigResult,
      initialMessages: init,
      maxTurns: 8,
      compaction: { thresholdTokens: 200, distill: () => 'DIGEST', preserveHead: -1 },
    })
    // With the clamp, the system message at index 0 is never spliced away.
    expect(headIntact).toBe(true)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(6)
  })

  it('the distiller receives the full accumulated conversation (so it can summarize everything)', async () => {
    const sizes: number[] = []
    let distillSawAtLeast = 0
    await runBrainLoop({
      chat: recordingBrain(6, sizes),
      tools,
      execute: async () => bigResult,
      initialMessages: init,
      maxTurns: 8,
      compaction: {
        thresholdTokens: 200,
        distill: (messages) => {
          distillSawAtLeast = Math.max(distillSawAtLeast, messages.length)
          return 'DIGEST'
        },
      },
    })
    // The distiller is handed the full pre-compaction conversation (head + at least one tool round).
    expect(distillSawAtLeast).toBeGreaterThanOrEqual(4)
  })
})
