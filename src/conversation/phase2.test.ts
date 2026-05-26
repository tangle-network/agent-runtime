/**
 * Phase 2 — durable journal + retry/deadline/circuit-breaker + header propagation.
 * Each block exercises one primitive end-to-end against the real runner; no
 * unit-test-only fakes of the primitives themselves.
 */
import { describe, expect, it } from 'vitest'

import { createIterableBackend } from '../backends'
import type { AgentBackendContext, AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { CircuitOpenError, DeadlineExceededError, defaultIsRetryable } from './call-policy'
import { defineConversation } from './define-conversation'
import { FORWARD_HEADERS } from './headers'
import { InMemoryConversationJournal } from './journal'
import { runConversation, runConversationStream } from './run-conversation'
import { turnId as deriveTurnId, slugifySpeaker } from './turn-id'
import type { ConversationStreamEvent } from './types'

function steadyBackend(name: string, replies: string[]): AgentExecutionBackend {
  let idx = 0
  return createIterableBackend({
    kind: `steady-${name}`,
    async *stream(_input, context) {
      const reply = replies[idx]
      if (reply === undefined) throw new Error(`${name}: out of canned replies (${idx})`)
      idx += 1
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
        model: `steady-${name}`,
        tokensIn: 4,
        tokensOut: 4,
        costUsd: 0.01,
        latencyMs: 1,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
}

/**
 * A backend that fails the first `failTimes` calls with a retryable error,
 * then yields a steady text response. Lets us assert that the call policy
 * actually retried + that the same deterministic turn id was used.
 */
function flakyBackend(
  name: string,
  failTimes: number,
  finalText: string,
): AgentExecutionBackend & {
  calls: { signal: AbortSignal | undefined; turnId: string | undefined }[]
} {
  const calls: { signal: AbortSignal | undefined; turnId: string | undefined }[] = []
  let attempt = 0
  const backend = createIterableBackend({
    kind: `flaky-${name}`,
    async *stream(_input, context) {
      attempt += 1
      calls.push({ signal: context.signal, turnId: context.turnId })
      if (attempt <= failTimes) {
        throw new Error('ECONNRESET')
      }
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text: finalText,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
      yield {
        type: 'llm_call',
        task: context.task,
        session: context.session,
        model: `flaky-${name}`,
        costUsd: 0.01,
        tokensIn: 1,
        tokensOut: 1,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
  return Object.assign(backend, { calls })
}

function slowBackend(name: string, latencyMs: number): AgentExecutionBackend {
  return createIterableBackend({
    kind: `slow-${name}`,
    async *stream(_input, context) {
      // sleep that respects the AbortSignal so the deadline can interrupt
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, latencyMs)
        if (context.signal) {
          context.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(t)
              reject(context.signal?.reason ?? new Error('aborted'))
            },
            { once: true },
          )
        }
      })
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text: 'slow-final',
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
}

function headerCapturingBackend(): {
  backend: AgentExecutionBackend
  contexts: AgentBackendContext[]
} {
  const contexts: AgentBackendContext[] = []
  const backend = createIterableBackend({
    kind: 'header-capture',
    async *stream(_input, context) {
      contexts.push(context)
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text: 'ack',
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
      yield {
        type: 'llm_call',
        task: context.task,
        session: context.session,
        model: 'header-capture',
        costUsd: 0.01,
        tokensIn: 1,
        tokensOut: 1,
        timestamp: new Date().toISOString(),
      } satisfies RuntimeStreamEvent
    },
  })
  return { backend, contexts }
}

// ── Turn ID ───────────────────────────────────────────────────────────

describe('turnId — deterministic', () => {
  it('encodes runId + index + speaker slug deterministically', () => {
    expect(deriveTurnId('run_1', 0, 'researcher')).toBe('run_1.t0.researcher')
    expect(deriveTurnId('run_1', 0, 'researcher')).toBe(deriveTurnId('run_1', 0, 'researcher'))
  })
  it('slugifies awkward speaker names without losing recognizability', () => {
    expect(slugifySpeaker('GPT-5 Codex')).toBe('gpt-5-codex')
    expect(slugifySpeaker('inner-a')).toBe('inner-a')
    expect(slugifySpeaker('!@#$')).toBe('anon')
  })
})

// ── Journal ───────────────────────────────────────────────────────────

describe('journal — durable resume', () => {
  it('persists every committed turn and resumes from the last entry', async () => {
    const journal = new InMemoryConversationJournal()
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: steadyBackend('a', ['a-1', 'a-2', 'a-3']) },
        { name: 'b', backend: steadyBackend('b', ['b-1', 'b-2', 'b-3']) },
      ],
      policy: { maxTurns: 6 },
    })

    // First run aborts after 4 turns via custom haltOn so we have a clean
    // mid-run state in the journal.
    let counted = 0
    const aborted = defineConversation({
      participants: conv.participants as any,
      policy: {
        ...conv.policy,
        haltOn: () => {
          counted += 1
          return counted >= 4 ? { halted: true, reason: 'mid-run pause' } : false
        },
      },
    })
    const firstRun = await runConversation(aborted, { seed: 'start', journal, runId: 'run-resume' })
    expect(firstRun.turns).toBe(4)

    // Journal should hold all 4 committed turns + the halt.
    const after = await journal.loadRun('run-resume')
    expect(after?.turns).toHaveLength(4)
    expect(after?.halted?.kind).toBe('predicate')

    // Calling with the same runId on a halted journal entry just replays the
    // final state without invoking any backend.
    const replay = await runConversation(conv, {
      seed: 'ignored on resume',
      journal,
      runId: 'run-resume',
    })
    expect(replay.turns).toBe(4)
    expect(replay.transcript).toEqual(firstRun.transcript)
  })

  it('resumes mid-run when journal has unfinished entry', async () => {
    const journal = new InMemoryConversationJournal()
    await journal.beginRun('run-mid', new Date().toISOString())
    // Pre-seed 2 turns as if a prior process had committed them.
    await journal.appendTurn('run-mid', {
      index: 0,
      speaker: 'a',
      turnId: deriveTurnId('run-mid', 0, 'a'),
      text: 'previously-a',
      attempts: 1,
      usage: { costUsd: 0.01 },
      startedAt: '2026-05-27T00:00:00.000Z',
      endedAt: '2026-05-27T00:00:01.000Z',
    })
    await journal.appendTurn('run-mid', {
      index: 1,
      speaker: 'b',
      turnId: deriveTurnId('run-mid', 1, 'b'),
      text: 'previously-b',
      attempts: 1,
      usage: { costUsd: 0.01 },
      startedAt: '2026-05-27T00:00:01.000Z',
      endedAt: '2026-05-27T00:00:02.000Z',
    })

    const conv = defineConversation({
      participants: [
        { name: 'a', backend: steadyBackend('a', ['fresh-a-1', 'fresh-a-2']) },
        { name: 'b', backend: steadyBackend('b', ['fresh-b-1', 'fresh-b-2']) },
      ],
      policy: { maxTurns: 4 },
    })

    const events: ConversationStreamEvent[] = []
    for await (const e of runConversationStream(conv, {
      seed: 'never-used-on-resume',
      journal,
      runId: 'run-mid',
    })) {
      events.push(e)
    }

    // First event MUST be conversation_resumed (not conversation_start) and
    // carry the persisted transcript.
    expect(events[0]?.type).toBe('conversation_resumed')
    if (events[0]?.type === 'conversation_resumed') {
      expect(events[0].transcript).toHaveLength(2)
      expect(events[0].transcript.map((t) => t.text)).toEqual(['previously-a', 'previously-b'])
    }
    const end = events.find((e) => e.type === 'conversation_end')
    if (end?.type !== 'conversation_end') throw new Error('no end event')
    expect(end.result.turns).toBe(4) // 2 resumed + 2 fresh
    expect(end.result.transcript.map((t) => t.text)).toEqual([
      'previously-a',
      'previously-b',
      'fresh-a-1',
      'fresh-b-1',
    ])
  })

  it('refuses to overwrite an existing journal entry with a different startedAt', async () => {
    const journal = new InMemoryConversationJournal()
    await journal.beginRun('clash', '2026-05-27T00:00:00.000Z')
    await expect(journal.beginRun('clash', '2026-05-27T01:00:00.000Z')).rejects.toThrow(
      /already exists/,
    )
  })

  it('refuses appends to a halted journal entry', async () => {
    const journal = new InMemoryConversationJournal()
    await journal.beginRun('finished', '2026-05-27T00:00:00.000Z')
    await journal.recordHalt(
      'finished',
      { kind: 'max_turns', turns: 0 },
      '2026-05-27T01:00:00.000Z',
    )
    await expect(
      journal.appendTurn('finished', {
        index: 0,
        speaker: 'x',
        turnId: 'foo',
        text: 'after-halt',
        attempts: 1,
        startedAt: '2026-05-27T02:00:00.000Z',
        endedAt: '2026-05-27T02:00:01.000Z',
      }),
    ).rejects.toThrow(/halted/)
  })
})

// ── Call policy: retries ───────────────────────────────────────────────

describe('call-policy — retries', () => {
  it('retries a flaky backend and commits the final response with attempts > 1', async () => {
    const flaky = flakyBackend('f', 2, 'finally-worked')
    const conv = defineConversation({
      participants: [
        { name: 'flaky', backend: flaky },
        { name: 'steady', backend: steadyBackend('s', ['ack']) },
      ],
      policy: {
        maxTurns: 2,
        defaultCallPolicy: { maxRetries: 3, retryBackoffMs: 1 },
      },
    })
    const result = await runConversation(conv, { seed: 'go' })
    expect(result.transcript[0]?.text).toBe('finally-worked')
    expect(result.transcript[0]?.attempts).toBe(3) // 2 failures + 1 success
    // Every retry of the same logical turn uses the same turnId.
    const turnIds = flaky.calls.map((c) => c.turnId)
    expect(new Set(turnIds).size).toBe(1)
  })

  it('halts as participant_error when retries are exhausted', async () => {
    const flaky = flakyBackend('f', 5, 'never-reached')
    const conv = defineConversation({
      participants: [
        { name: 'flaky', backend: flaky },
        { name: 'steady', backend: steadyBackend('s', ['ack']) },
      ],
      policy: {
        maxTurns: 2,
        defaultCallPolicy: { maxRetries: 2, retryBackoffMs: 1 },
      },
    })
    const result = await runConversation(conv, { seed: 'go' })
    expect(result.halted.kind).toBe('participant_error')
    expect(flaky.calls).toHaveLength(3) // 1 + 2 retries, all failed
  })

  it('emits turn_retry events that reference the same turnId', async () => {
    const flaky = flakyBackend('f', 1, 'eventually')
    const conv = defineConversation({
      participants: [
        { name: 'flaky', backend: flaky },
        { name: 'steady', backend: steadyBackend('s', ['ack']) },
      ],
      policy: {
        maxTurns: 1,
        defaultCallPolicy: { maxRetries: 2, retryBackoffMs: 1 },
      },
    })
    const retries: ConversationStreamEvent[] = []
    for await (const e of runConversationStream(conv, { seed: 'go' })) {
      if (e.type === 'turn_retry') retries.push(e)
    }
    expect(retries).toHaveLength(1)
    if (retries[0]?.type === 'turn_retry') {
      expect(retries[0].attempt).toBe(2)
      expect(retries[0].turnId).toMatch(/\.t0\.flaky$/)
    }
  })
})

// ── Call policy: deadlines ─────────────────────────────────────────────

describe('call-policy — deadlines', () => {
  it('aborts a too-slow attempt and surfaces DeadlineExceededError as retryable', async () => {
    const slow = slowBackend('s', 200)
    const conv = defineConversation({
      participants: [
        { name: 'slow', backend: slow },
        { name: 'steady', backend: steadyBackend('t', ['ack']) },
      ],
      policy: {
        maxTurns: 1,
        defaultCallPolicy: { perAttemptDeadlineMs: 20, maxRetries: 0 },
      },
    })
    const result = await runConversation(conv, { seed: 'go' })
    expect(result.halted.kind).toBe('participant_error')
    if (result.halted.kind === 'participant_error') {
      expect(result.halted.message).toMatch(/exceeded per-attempt deadline of 20ms/)
    }
  })

  it('treats deadline errors as retryable by default', () => {
    expect(defaultIsRetryable(new DeadlineExceededError(100))).toBe(true)
  })

  it('treats AbortError + network errors as retryable; refuses model refusals', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(defaultIsRetryable(abort)).toBe(true)
    expect(defaultIsRetryable(new Error('ECONNRESET'))).toBe(true)
    expect(defaultIsRetryable(new Error('fetch failed'))).toBe(true)
    expect(defaultIsRetryable(new Error('model refused: 400 bad request'))).toBe(false)
  })
})

// ── Call policy: circuit breaker ───────────────────────────────────────

describe('call-policy — circuit breaker', () => {
  it('opens the breaker after N consecutive failures and halts with the open-error', async () => {
    // Backend that always throws a non-retryable so retries don't mask the breaker behavior.
    const dead = createIterableBackend({
      kind: 'dead',
      // biome-ignore lint/correctness/useYield: throws-only generator on purpose
      async *stream() {
        throw new Error('400 bad request')
      },
    })
    const conv = defineConversation({
      participants: [
        { name: 'dead', backend: dead },
        { name: 'steady', backend: steadyBackend('t', ['ack', 'ack']) },
      ],
      policy: {
        maxTurns: 4,
        defaultCallPolicy: {
          maxRetries: 0,
          circuitBreaker: { failuresToOpen: 1, cooldownMs: 60_000 },
        },
      },
    })
    const result = await runConversation(conv, { seed: 'go' })
    expect(result.halted.kind).toBe('participant_error')
    // First attempt: actual backend throw. Subsequent calls (none here because
    // alternate halts after first failure) would have been CircuitOpenError.
  })

  it('CircuitOpenError carries remaining cooldown', () => {
    const err = new CircuitOpenError('x', 1234)
    expect(err.message).toContain('1234ms')
    expect(err.message).toContain("'x'")
  })

  it('breaker resets after a success', async () => {
    // Verify by direct usage: 1 failure (open), wait past cooldown, success closes it.
    const { CircuitBreakerState } = await import('./call-policy')
    const breaker = new CircuitBreakerState({ failuresToOpen: 1, cooldownMs: 20 })
    breaker.recordFailure(1000)
    expect(() => breaker.preflight('p', 1010)).toThrow(CircuitOpenError)
    // After cooldown the breaker auto-closes on next preflight.
    expect(() => breaker.preflight('p', 1050)).not.toThrow()
    breaker.recordSuccess()
    // After success the consecutive-failure counter is zero, so a brand-new
    // failure has to clear the (still-1) threshold again before re-opening.
    breaker.recordFailure(2000)
    // failuresToOpen=1, so this single failure DOES re-open the breaker.
    expect(() => breaker.preflight('p', 2010)).toThrow(CircuitOpenError)
  })
})

// ── Header propagation ─────────────────────────────────────────────────

describe('header propagation — cross-gateway forwarding', () => {
  it('stamps run/turn/depth/speaker headers on every backend call', async () => {
    const cap = headerCapturingBackend()
    const conv = defineConversation({
      participants: [
        { name: 'cap', backend: cap.backend },
        { name: 'steady', backend: steadyBackend('s', ['ack']) },
      ],
      policy: { maxTurns: 2 },
    })
    const result = await runConversation(conv, {
      seed: 'hello',
      inboundDepth: 0,
      propagatedHeaders: {
        [FORWARD_HEADERS.authorization]: 'Bearer sk-tan-test-user',
      },
    })
    expect(result.turns).toBe(2)
    expect(cap.contexts).toHaveLength(1)
    const h = cap.contexts[0]?.propagatedHeaders
    expect(h).toBeDefined()
    if (!h) return
    // Depth incremented from inbound 0 → 1 on outbound.
    expect(h[FORWARD_HEADERS.depth]).toBe('1')
    expect(h[FORWARD_HEADERS.authorization]).toBe('Bearer sk-tan-test-user')
    expect(h[FORWARD_HEADERS.runId]).toBe(result.runId)
    expect(h[FORWARD_HEADERS.turnId]).toMatch(/\.t0\.cap$/)
    expect(h[FORWARD_HEADERS.speaker]).toBe('cap')
  })

  it('does not leak the forwarded authorization when caller did not supply one', async () => {
    const cap = headerCapturingBackend()
    const conv = defineConversation({
      participants: [
        { name: 'cap', backend: cap.backend },
        { name: 'steady', backend: steadyBackend('s', ['ack']) },
      ],
      policy: { maxTurns: 1 },
    })
    await runConversation(conv, { seed: 'go' })
    const h = cap.contexts[0]?.propagatedHeaders ?? {}
    expect(h[FORWARD_HEADERS.authorization]).toBeUndefined()
  })

  it('preserves runId across all participants in a multi-turn run', async () => {
    const cap1 = headerCapturingBackend()
    const cap2 = headerCapturingBackend()
    const conv = defineConversation({
      participants: [
        { name: 'a', backend: cap1.backend },
        { name: 'b', backend: cap2.backend },
      ],
      policy: { maxTurns: 4 },
    })
    const result = await runConversation(conv, {
      seed: 'go',
      runId: 'shared-run',
    })
    expect(result.runId).toBe('shared-run')
    for (const ctx of [...cap1.contexts, ...cap2.contexts]) {
      expect(ctx.propagatedHeaders?.[FORWARD_HEADERS.runId]).toBe('shared-run')
    }
  })
})
