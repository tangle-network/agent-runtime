import { describe, expect, it } from 'vitest'

import { createIterableBackend } from '../backends'
import { ValidationError } from '../errors'
import type { AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { createConversationBackend } from './conversation-backend'
import { defineConversation } from './define-conversation'
import { runConversation, runConversationStream } from './run-conversation'
import type { ConversationStreamEvent } from './types'

/**
 * Canned-reply backend. Each invocation returns the next entry in `replies`,
 * plus an `llm_call` event so the credit meter has something to aggregate.
 * Useful for asserting routing and halting without spinning up a real model.
 */
function fakeBackend(
  name: string,
  replies: string[],
  opts: { costUsd?: number } = {},
): AgentExecutionBackend {
  let callIdx = 0
  return createIterableBackend({
    kind: `fake-${name}`,
    async *stream(_input, context) {
      if (callIdx >= replies.length) {
        throw new Error(`fake backend '${name}' ran out of canned replies at call ${callIdx}`)
      }
      const reply = replies[callIdx]
      if (reply === undefined) {
        throw new Error(`fake backend '${name}' has undefined reply at call ${callIdx}`)
      }
      callIdx += 1
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text: reply,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
      yield {
        type: 'llm_call',
        task: context.task,
        session: context.session,
        model: `fake-model-${name}`,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: opts.costUsd ?? 0.01,
        latencyMs: 1,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
}

function alwaysThrowsBackend(name: string, message: string): AgentExecutionBackend {
  return createIterableBackend({
    kind: `boom-${name}`,
    // biome-ignore lint/correctness/useYield: deliberate — simulates a backend that throws before producing any event
    async *stream() {
      throw new Error(message)
    },
  })
}

describe('defineConversation', () => {
  const okBackend = fakeBackend('x', ['hi'])

  it('rejects fewer than 2 participants', () => {
    expect(() =>
      defineConversation({
        participants: [{ name: 'solo', backend: okBackend }],
        policy: { maxTurns: 4 },
      }),
    ).toThrow(ValidationError)
  })

  it('rejects duplicate participant names', () => {
    expect(() =>
      defineConversation({
        participants: [
          { name: 'dup', backend: okBackend },
          { name: 'dup', backend: okBackend },
        ],
        policy: { maxTurns: 4 },
      }),
    ).toThrow(/unique/)
  })

  it('rejects non-positive maxTurns', () => {
    expect(() =>
      defineConversation({
        participants: [
          { name: 'a', backend: okBackend },
          { name: 'b', backend: okBackend },
        ],
        policy: { maxTurns: 0 },
      }),
    ).toThrow(/maxTurns/)
  })

  it("rejects turnOrder='alternate' with !=2 participants", () => {
    expect(() =>
      defineConversation({
        participants: [
          { name: 'a', backend: okBackend },
          { name: 'b', backend: okBackend },
          { name: 'c', backend: okBackend },
        ],
        policy: { maxTurns: 4, turnOrder: 'alternate' },
      }),
    ).toThrow(/alternate/)
  })

  it('defaults to alternate for 2 participants, round-robin for N', () => {
    const two = defineConversation({
      participants: [
        { name: 'a', backend: okBackend },
        { name: 'b', backend: okBackend },
      ],
      policy: { maxTurns: 2 },
    })
    expect(two.policy.turnOrder).toBe('alternate')
    const three = defineConversation({
      participants: [
        { name: 'a', backend: okBackend },
        { name: 'b', backend: okBackend },
        { name: 'c', backend: okBackend },
      ],
      policy: { maxTurns: 3 },
    })
    expect(three.policy.turnOrder).toBe('round-robin')
  })
})

describe('runConversation — happy path', () => {
  it('alternates between two participants for the full maxTurns', async () => {
    const conv = defineConversation({
      participants: [
        { name: 'researcher', backend: fakeBackend('r', ['r-1', 'r-2', 'r-3']) },
        { name: 'critic', backend: fakeBackend('c', ['c-1', 'c-2', 'c-3']) },
      ],
      policy: { maxTurns: 4 },
    })

    const result = await runConversation(conv, { seed: 'design a key-rotation scheme' })

    expect(result.turns).toBe(4)
    expect(result.transcript.map((t) => t.speaker)).toEqual([
      'researcher',
      'critic',
      'researcher',
      'critic',
    ])
    expect(result.transcript.map((t) => t.text)).toEqual(['r-1', 'c-1', 'r-2', 'c-2'])
    expect(result.halted).toEqual({ kind: 'max_turns', turns: 4 })
    expect(result.spentCreditsCents).toBe(4) // 4 turns × $0.01 = 4¢
  })

  it('uses round-robin for 3 participants by default', async () => {
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: fakeBackend('a', ['a-1', 'a-2']) },
        { name: 'b', backend: fakeBackend('b', ['b-1']) },
        { name: 'c', backend: fakeBackend('c', ['c-1']) },
      ],
      policy: { maxTurns: 4 },
    })
    const result = await runConversation(conv, { seed: 'go' })
    expect(result.transcript.map((t) => t.speaker)).toEqual(['a', 'b', 'c', 'a'])
  })
})

describe('runConversation — halting', () => {
  it('halts on haltOn predicate true', async () => {
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: fakeBackend('a', ['hi-from-a-1', 'hi-from-a-2', 'CONVERGED']) },
        { name: 'b', backend: fakeBackend('b', ['hi-from-b-1', 'CONVERGED', 'hi-from-b-3']) },
      ],
      policy: {
        maxTurns: 10,
        haltOn: ({ lastTurn }) =>
          lastTurn.text.includes('CONVERGED')
            ? { halted: true, reason: 'convergence-marker' }
            : false,
      },
    })
    const result = await runConversation(conv, { seed: 'start' })
    expect(result.halted).toEqual({ kind: 'predicate', reason: 'convergence-marker' })
    expect(result.turns).toBeLessThan(10)
    expect(result.transcript.at(-1)?.text).toBe('CONVERGED')
  })

  it('halts on max_credits before exceeding the cap', async () => {
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: fakeBackend('a', ['1', '2', '3', '4'], { costUsd: 0.05 }) },
        { name: 'b', backend: fakeBackend('b', ['1', '2', '3', '4'], { costUsd: 0.05 }) },
      ],
      policy: { maxTurns: 20, maxCreditsCents: 12 },
    })
    const result = await runConversation(conv, { seed: 'go' })
    expect(result.halted.kind).toBe('max_credits')
    expect(result.spentCreditsCents).toBeGreaterThanOrEqual(12)
    expect(result.turns).toBeLessThanOrEqual(20)
  })

  it('halts on participant_error when a backend throws', async () => {
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: fakeBackend('a', ['ok']) },
        { name: 'b', backend: alwaysThrowsBackend('b', 'backend exploded') },
      ],
      policy: { maxTurns: 6 },
    })
    const result = await runConversation(conv, { seed: 'go' })
    expect(result.halted.kind).toBe('participant_error')
    if (result.halted.kind === 'participant_error') {
      expect(result.halted.participant).toBe('b')
      expect(result.halted.message).toContain('exploded')
    }
    expect(result.transcript).toHaveLength(1)
    expect(result.transcript[0]?.speaker).toBe('a')
  })

  it('halts on abort signal', async () => {
    const controller = new AbortController()
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: fakeBackend('a', ['1', '2', '3', '4']) },
        { name: 'b', backend: fakeBackend('b', ['1', '2', '3', '4']) },
      ],
      policy: { maxTurns: 10 },
    })
    controller.abort()
    const result = await runConversation(conv, { seed: 'go', signal: controller.signal })
    expect(result.halted).toEqual({ kind: 'abort' })
    expect(result.turns).toBe(0)
  })
})

describe('runConversationStream', () => {
  it('emits the full event sequence in order', async () => {
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: fakeBackend('a', ['hello-a']) },
        { name: 'b', backend: fakeBackend('b', ['hello-b']) },
      ],
      policy: { maxTurns: 2 },
    })
    const events: ConversationStreamEvent[] = []
    for await (const ev of runConversationStream(conv, { seed: 'hi' })) {
      events.push(ev)
    }
    const types = events.map((e) => e.type)
    expect(types[0]).toBe('conversation_start')
    expect(types.at(-1)).toBe('conversation_end')
    expect(types.filter((t) => t === 'turn_start')).toHaveLength(2)
    expect(types.filter((t) => t === 'turn_end')).toHaveLength(2)
    expect(types.filter((t) => t === 'turn_text_delta')).toHaveLength(2)
  })
})

describe('createConversationBackend — recursion', () => {
  it('exposes a Conversation as a single agent backend usable as a participant', async () => {
    const innerConv = defineConversation({
      participants: [
        { name: 'inner-a', backend: fakeBackend('ia', ['inner-a-says-hi']) },
        { name: 'inner-b', backend: fakeBackend('ib', ['inner-b-says-hi']) },
      ],
      policy: { maxTurns: 2 },
    })
    const swarmBackend = createConversationBackend({ conversation: innerConv, kind: 'swarm' })

    const outerConv = defineConversation({
      participants: [
        { name: 'outer-a', backend: fakeBackend('oa', ['outer-a-says-hi']) },
        { name: 'swarm', backend: swarmBackend },
      ],
      policy: { maxTurns: 2 },
    })

    const result = await runConversation(outerConv, { seed: 'kick off' })
    expect(result.turns).toBe(2)
    // The 'swarm' participant's turn text should contain the inner participants' speaker-tagged output.
    const swarmTurn = result.transcript.find((t) => t.speaker === 'swarm')
    expect(swarmTurn).toBeDefined()
    expect(swarmTurn?.text).toMatch(/\[inner-a\]/)
    expect(swarmTurn?.text).toMatch(/\[inner-b\]/)
  })
})
