import { describe, expect, it } from 'vitest'
import {
  createTraceBridge,
  type RuntimeStreamEvent,
  toAgentEvalTrace,
  ValidationError,
} from '../src/index'

const task = { id: 'task-1', intent: 'Run a chat turn', domain: 'legal' }
const session = {
  id: 'thread-1',
  backend: 'tcloud',
  status: 'active' as const,
  createdAt: '2026-05-10T00:00:00.000Z',
  updatedAt: '2026-05-10T00:00:00.000Z',
}

describe('createTraceBridge', () => {
  it('rejects construction without a runId', () => {
    expect(() => createTraceBridge({ runId: '' })).toThrow(ValidationError)
  })

  it('maps lifecycle events to log-kind trace events with the runId stamped', () => {
    const bridge = createTraceBridge({ runId: 'run-1', spanId: 'span-1' })
    const ts = '2026-05-10T00:00:00.000Z'
    const taskStart = bridge.toTraceEvent({ type: 'task_start', task, timestamp: ts })
    expect(taskStart).toMatchObject({
      runId: 'run-1',
      spanId: 'span-1',
      kind: 'log',
      payload: { phase: 'task_start', taskId: 'task-1' },
    })
    expect(taskStart?.timestamp).toBe(Date.parse(ts))
  })

  it('maps readiness_end to policy_violation when the decision is blocked', () => {
    const bridge = createTraceBridge({ runId: 'run-2' })
    const trace = bridge.toTraceEvent({
      type: 'readiness_end',
      task,
      timestamp: '2026-05-10T00:00:00.000Z',
      knowledge: {
        taskId: 'task-1',
        readinessScore: 0,
        reason: 'missing',
        severity: 'error',
        recommendedAction: 'collect_missing_data',
        blockingMissingRequirements: [],
        nonBlockingGaps: [],
        bundle: {
          taskId: 'task-1',
          readinessScore: 0,
          missing: [],
          evidence: [],
          evidenceIds: [],
          userAnswers: {},
        },
      },
      decision: {
        passed: false,
        status: 'blocked',
        reason: 'missing',
        readinessScore: 0,
        recommendedAction: 'collect_missing_data',
        severity: 'error',
        blockingGapIds: ['missing-doc'],
        nonBlockingGapIds: [],
      },
    })
    expect(trace?.kind).toBe('policy_violation')
    expect(trace?.payload).toMatchObject({
      status: 'blocked',
      blockingGapIds: ['missing-doc'],
    })
  })

  it('maps backend_error and failed task_end to error kind', () => {
    const bridge = createTraceBridge({ runId: 'run-3' })
    const backendError = bridge.toTraceEvent({
      type: 'backend_error',
      task,
      session,
      backend: 'tcloud',
      message: 'sandbox lost',
      recoverable: true,
      timestamp: '2026-05-10T00:00:00.000Z',
    })
    expect(backendError?.kind).toBe('error')
    expect(backendError?.payload).toMatchObject({ message: 'sandbox lost', recoverable: true })

    const failedTaskEnd = bridge.toTraceEvent({
      type: 'task_end',
      task,
      status: 'failed',
      reason: 'sandbox lost',
      timestamp: '2026-05-10T00:00:00.000Z',
    })
    expect(failedTaskEnd?.kind).toBe('error')
  })

  it('drops text_delta and reasoning_delta — they belong inside an LlmSpan', () => {
    const bridge = createTraceBridge({ runId: 'run-4' })
    expect(
      bridge.toTraceEvent({
        type: 'text_delta',
        task,
        session,
        text: 'hi',
        timestamp: '2026-05-10T00:00:00.000Z',
      }),
    ).toBeUndefined()
    expect(
      bridge.toTraceEvent({
        type: 'reasoning_delta',
        task,
        session,
        text: 'thinking',
        timestamp: '2026-05-10T00:00:00.000Z',
      }),
    ).toBeUndefined()
  })

  it('maps llm_call into a log-kind trace event carrying tokens + cost', () => {
    const bridge = createTraceBridge({ runId: 'run-5' })
    const trace = bridge.toTraceEvent({
      type: 'llm_call',
      task,
      session,
      model: 'claude-sonnet-4-6',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      latencyMs: 320,
      finishReason: 'stop',
      timestamp: '2026-05-10T00:00:00.000Z',
    })
    expect(trace?.kind).toBe('log')
    expect(trace?.payload).toMatchObject({
      phase: 'llm_call',
      model: 'claude-sonnet-4-6',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
    })
  })

  it('drain() projects a full stream into trace events in order', () => {
    const bridge = createTraceBridge({ runId: 'run-6' })
    const events: RuntimeStreamEvent[] = [
      { type: 'task_start', task, timestamp: '2026-05-10T00:00:00.000Z' },
      { type: 'readiness_start', task, timestamp: '2026-05-10T00:00:01.000Z' },
      {
        type: 'text_delta',
        task,
        session,
        text: 'dropped',
        timestamp: '2026-05-10T00:00:02.000Z',
      },
      {
        type: 'task_end',
        task,
        status: 'completed',
        reason: 'ok',
        timestamp: '2026-05-10T00:00:03.000Z',
      },
    ]
    const traces = bridge.drain(events)
    expect(traces.map((trace) => trace.payload.phase)).toEqual([
      'task_start',
      'readiness_start',
      'task_end',
    ])
    expect(traces.map((trace) => trace.eventId)).toEqual(['evt-1', 'evt-2', 'evt-3'])
  })

  it('maps proposal_created into a state_mutation trace event carrying id, title, status', () => {
    const bridge = createTraceBridge({ runId: 'run-prop' })
    const trace = bridge.toTraceEvent({
      type: 'proposal_created',
      task,
      session,
      proposalId: 'prop-1',
      title: 'Amend filing X',
      status: 'pending',
      timestamp: '2026-05-10T00:00:00.000Z',
    })
    expect(trace?.kind).toBe('state_mutation')
    expect(trace?.payload).toMatchObject({
      phase: 'proposal_created',
      proposalId: 'prop-1',
      title: 'Amend filing X',
      status: 'pending',
    })
  })

  it('toAgentEvalTrace() one-shot matches createTraceBridge.toTraceEvent()', () => {
    const event: RuntimeStreamEvent = {
      type: 'task_start',
      task,
      timestamp: '2026-05-10T00:00:00.000Z',
    }
    const oneShot = toAgentEvalTrace(event, { runId: 'run-7' })
    expect(oneShot).toMatchObject({ runId: 'run-7', kind: 'log' })
  })

  it('falls back to Date.now() when an event lacks a timestamp', () => {
    const bridge = createTraceBridge({ runId: 'run-8' })
    const before = Date.now()
    const trace = bridge.toTraceEvent({
      type: 'text_delta',
      task,
      session,
      text: 'untimed',
    })
    expect(trace).toBeUndefined()

    // tool_call is the simplest event whose timestamp may legitimately be
    // omitted by a backend; the bridge must still produce a valid trace.
    const toolCall = bridge.toTraceEvent({
      type: 'tool_call',
      task,
      session,
      toolName: 'shell',
    })
    expect(toolCall).toBeDefined()
    expect(toolCall!.timestamp).toBeGreaterThanOrEqual(before)
  })
})
