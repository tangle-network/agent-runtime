import { describe, expect, it } from 'vitest'

import { createIterableBackend } from '../backends'
import { ValidationError } from '../errors'
import { InMemoryRuntimeSessionStore } from '../sessions'
import type {
  AgentBackendInput,
  AgentExecutionBackend,
  RuntimeSession,
  RuntimeStreamEvent,
} from '../types'
import { createConversationBackend } from './conversation-backend'
import { defineConversation } from './define-conversation'
import { InMemoryConversationJournal } from './journal'
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

function emptyBackend(name: string): AgentExecutionBackend {
  return createIterableBackend({
    kind: `empty-${name}`,
    async *stream() {},
  })
}

function failedFinalBackend(name: string): AgentExecutionBackend {
  return createIterableBackend({
    kind: `failed-${name}`,
    async *stream(_input, context) {
      yield {
        type: 'final',
        task: context.task,
        session: context.session,
        status: 'failed',
        reason: 'provider failed',
        error: { kind: 'transport', message: 'provider failed', status: 503 },
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
}

function backendErrorEventBackend(name: string): AgentExecutionBackend {
  return createIterableBackend({
    kind: `error-event-${name}`,
    async *stream(_input, context) {
      yield {
        type: 'backend_error',
        task: context.task,
        session: context.session,
        backend: `error-event-${name}`,
        message: 'provider unavailable',
        recoverable: true,
        error: { kind: 'transport', message: 'provider unavailable', status: 503 },
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
}

interface SessionCall {
  phase: 'start' | 'resume' | 'stream'
  input: AgentBackendInput
  sessionId: string
}

function sessionBackend(
  name: string,
  replies: readonly string[],
  calls: SessionCall[],
): AgentExecutionBackend {
  let replyIndex = 0
  return createIterableBackend({
    kind: `session-${name}`,
    start(input, context) {
      const session = testSession(`provider-${name}`)
      calls.push({ phase: 'start', input, sessionId: session.id })
      expect(context.requestedSessionId).toBeDefined()
      return session
    },
    resume(session, input) {
      calls.push({ phase: 'resume', input, sessionId: session.id })
      return { ...session, status: 'active', updatedAt: new Date().toISOString() }
    },
    async *stream(input, context) {
      calls.push({ phase: 'stream', input, sessionId: context.session.id })
      const text = replies[replyIndex]
      replyIndex += 1
      if (text === undefined) throw new Error(`session backend '${name}' has no reply`)
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
}

function testSession(id: string): RuntimeSession {
  const now = new Date().toISOString()
  return {
    id,
    backend: id.replace('provider-', 'session-'),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
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
    // Every turn has a deterministic id + attempts=1 on the happy path.
    for (const t of result.transcript) {
      expect(t.turnId).toMatch(new RegExp(`^${result.runId}\\.t\\d+\\.`))
      expect(t.attempts).toBe(1)
    }
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

  it('resumes one provider session per participant with only unseen turns', async () => {
    const calls: SessionCall[] = []
    const conv = defineConversation({
      participants: [
        { name: 'author', backend: sessionBackend('author', ['a-1', 'a-2'], calls) },
        { name: 'critic', backend: sessionBackend('critic', ['c-1', 'c-2'], calls) },
      ],
      policy: { maxTurns: 4 },
    })

    const result = await runConversation(conv, {
      seed: 'solve the task',
      runId: 'persistent-actors',
    })

    expect(calls.filter((call) => call.phase === 'start')).toHaveLength(2)
    expect(calls.filter((call) => call.phase === 'resume')).toHaveLength(2)
    expect(result.transcript.map((turn) => turn.sessionId)).toEqual([
      'provider-author',
      'provider-critic',
      'provider-author',
      'provider-critic',
    ])

    const streams = calls.filter((call) => call.phase === 'stream')
    expect(streams[0]?.input.message).toBe('solve the task')
    expect(streams[1]?.input.message).toContain('[author] a-1')
    expect(streams[1]?.input.message).toContain('solve the task')
    expect(streams[2]?.input.message).toBe('[critic] c-1')
    expect(streams[3]?.input.message).toBe('[author] a-2')
  })

  it('reconstructs stateless messages once without repeating the previous response', async () => {
    const inputs: AgentBackendInput[] = []
    const backend = (name: string, reply: string): AgentExecutionBackend =>
      createIterableBackend({
        kind: `stateless-${name}`,
        async *stream(input, context) {
          inputs.push(input)
          yield {
            type: 'text_delta',
            task: context.task,
            session: context.session,
            text: reply,
            timestamp: new Date().toISOString(),
          } satisfies RuntimeStreamEvent
        },
      })
    const conv = defineConversation({
      participants: [
        { name: 'author', backend: backend('author', 'draft') },
        { name: 'critic', backend: backend('critic', 'review') },
      ],
      policy: { maxTurns: 2 },
    })

    await runConversation(conv, { seed: 'solve the task', runId: 'stateless-history' })

    expect(inputs[0]?.messages).toEqual([{ role: 'user', content: 'solve the task' }])
    expect(inputs[1]?.messages).toEqual([
      { role: 'user', content: 'solve the task' },
      { role: 'user', content: '[author] draft' },
    ])
  })

  it('continues actor sessions after the conversation driver restarts', async () => {
    const calls: SessionCall[] = []
    const journal = new InMemoryConversationJournal()
    const sessionStore = new InMemoryRuntimeSessionStore()
    const conv = defineConversation({
      participants: [
        { name: 'author', backend: sessionBackend('author', ['a-1', 'a-2'], calls) },
        { name: 'critic', backend: sessionBackend('critic', ['c-1', 'c-2'], calls) },
      ],
      policy: { maxTurns: 4 },
    })
    const options = {
      seed: 'solve the task',
      runId: 'driver-restart',
      journal,
      sessionStore,
    }

    let committedTurns = 0
    for await (const event of runConversationStream(conv, options)) {
      if (event.type === 'turn_end') committedTurns += 1
      if (committedTurns === 2) break
    }
    const result = await runConversation(conv, options)

    expect(result.transcript.map((turn) => turn.text)).toEqual(['a-1', 'c-1', 'a-2', 'c-2'])
    expect(calls.filter((call) => call.phase === 'start')).toHaveLength(2)
    expect(calls.filter((call) => call.phase === 'resume')).toHaveLength(2)
  })

  it('does not bind a participant to a session from a failed attempt', async () => {
    let starts = 0
    let resumes = 0
    let streams = 0
    const retrying = createIterableBackend({
      kind: 'retry-session',
      start() {
        starts += 1
        const now = new Date().toISOString()
        return {
          id: `attempt-${starts}`,
          backend: 'retry-session',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        } satisfies RuntimeSession
      },
      resume(session) {
        resumes += 1
        return session
      },
      async *stream(_input, context) {
        streams += 1
        if (streams === 1) throw new Error('ECONNRESET')
        yield {
          type: 'text_delta',
          task: context.task,
          session: context.session,
          text: 'recovered',
          timestamp: new Date().toISOString(),
        } satisfies RuntimeStreamEvent
      },
    })
    const conv = defineConversation({
      participants: [
        { name: 'author', backend: retrying },
        { name: 'critic', backend: fakeBackend('critic', ['unused']) },
      ],
      policy: {
        maxTurns: 1,
        defaultCallPolicy: { maxRetries: 1, retryBackoffMs: 0 },
      },
    })

    const result = await runConversation(conv, { seed: 'solve the task' })

    expect(result.transcript[0]).toMatchObject({
      text: 'recovered',
      sessionId: 'attempt-2',
      attempts: 2,
    })
    expect({ starts, resumes, streams }).toEqual({ starts: 2, resumes: 0, streams: 2 })
  })

  it('rejects a provider session shared by two participants', async () => {
    let sessionWrites = 0
    const sessionStore = {
      get: () => undefined,
      put: () => {
        sessionWrites += 1
      },
    }
    const backend = createIterableBackend({
      kind: 'shared-session',
      start() {
        const now = new Date().toISOString()
        return {
          id: 'provider-shared',
          backend: 'shared-session',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        } satisfies RuntimeSession
      },
      resume(session) {
        return session
      },
      async *stream(_input, context) {
        yield {
          type: 'text_delta',
          task: context.task,
          session: context.session,
          text: 'response',
          timestamp: new Date().toISOString(),
        } satisfies RuntimeStreamEvent
      },
    })
    const conv = defineConversation({
      participants: [
        { name: 'author', backend },
        { name: 'critic', backend },
      ],
      policy: { maxTurns: 2 },
    })

    const result = await runConversation(conv, { seed: 'solve the task', sessionStore })

    expect(result.transcript).toHaveLength(1)
    expect(result.halted).toMatchObject({
      kind: 'participant_error',
      participant: 'critic',
      message: expect.stringContaining("already bound to participant 'author'"),
    })
    expect(sessionWrites).toBe(1)
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

  it('halts when a backend completes without text', async () => {
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: emptyBackend('a') },
        { name: 'b', backend: fakeBackend('b', ['unused']) },
      ],
      policy: { maxTurns: 2 },
    })
    const result = await runConversation(conv, { seed: 'go' })
    expect(result.halted).toEqual({
      kind: 'participant_error',
      participant: 'a',
      message: "backend 'empty-a' completed without text",
    })
    expect(result.transcript).toHaveLength(0)
  })

  it('halts when a backend emits a failed final event', async () => {
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: failedFinalBackend('a') },
        { name: 'b', backend: fakeBackend('b', ['unused']) },
      ],
      policy: { maxTurns: 2 },
    })
    const result = await runConversation(conv, { seed: 'go' })
    expect(result.halted).toEqual({
      kind: 'participant_error',
      participant: 'a',
      message: 'provider failed',
    })
    expect(result.transcript).toHaveLength(0)
  })

  it('halts when a backend emits a backend error event', async () => {
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: backendErrorEventBackend('a') },
        { name: 'b', backend: fakeBackend('b', ['unused']) },
      ],
      policy: { maxTurns: 2 },
    })
    const result = await runConversation(conv, { seed: 'go' })
    expect(result.halted).toEqual({
      kind: 'participant_error',
      participant: 'a',
      message: 'provider unavailable',
    })
    expect(result.transcript).toHaveLength(0)
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
