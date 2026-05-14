import { describe, expect, it, vi } from 'vitest'
import {
  type AgentTaskSpec,
  type RuntimeRunPersistenceAdapter,
  type RuntimeRunRow,
  RuntimeRunStateError,
  type RuntimeStreamEvent,
  startRuntimeRun,
  ValidationError,
} from '../src/index'

const task: AgentTaskSpec = {
  id: 'task-runtime-run',
  intent: 'Review the latest filing',
  domain: 'legal',
  metadata: { workspaceId: 'ws-1' },
}

function llmCall(
  partial: Partial<Extract<RuntimeStreamEvent, { type: 'llm_call' }>>,
): RuntimeStreamEvent {
  return {
    type: 'llm_call',
    model: 'claude-sonnet-4-6',
    timestamp: new Date(0).toISOString(),
    ...partial,
  }
}

describe('startRuntimeRun', () => {
  it('rejects missing workspaceId and missing taskSpec.id', () => {
    expect(() => startRuntimeRun({ workspaceId: '', taskSpec: task })).toThrow(ValidationError)
    expect(() => startRuntimeRun({ workspaceId: 'ws-1', taskSpec: { ...task, id: '' } })).toThrow(
      ValidationError,
    )
  })

  it('initializes with a stable id and defaults to running status', () => {
    const handle = startRuntimeRun({
      workspaceId: 'ws-1',
      sessionId: 'thread-1',
      taskSpec: task,
      id: 'run-fixed',
      now: () => 100,
    })

    expect(handle.id).toBe('run-fixed')
    expect(handle.workspaceId).toBe('ws-1')
    expect(handle.sessionId).toBe('thread-1')
    expect(handle.status).toBe('running')
    expect(handle.cost()).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      wallMs: 0,
      llmCalls: 0,
    })
  })

  it('accumulates an llm cost ledger from llm_call events and exposes wall time', () => {
    let clock = 1000
    const handle = startRuntimeRun({
      workspaceId: 'ws-1',
      taskSpec: task,
      id: 'cost-run',
      now: () => clock,
    })

    clock = 1200
    handle.observe(llmCall({ tokensIn: 100, tokensOut: 50, costUsd: 0.002 }))
    clock = 1500
    handle.observe(llmCall({ tokensIn: 80, tokensOut: 20, costUsd: 0.001 }))
    clock = 1500
    handle.observe(
      // Non-cost events must not mutate the ledger.
      {
        type: 'tool_call',
        toolName: 'shell',
        timestamp: new Date(0).toISOString(),
      },
    )

    const cost = handle.cost()
    expect(cost.tokensIn).toBe(180)
    expect(cost.tokensOut).toBe(70)
    expect(cost.costUsd).toBeCloseTo(0.003, 9)
    expect(cost.llmCalls).toBe(2)
    expect(cost.wallMs).toBe(500)
  })

  it('ignores non-finite numbers on llm_call events without polluting the ledger', () => {
    const handle = startRuntimeRun({
      workspaceId: 'ws-1',
      taskSpec: task,
      id: 'guard-run',
      now: () => 0,
    })
    handle.observe(
      llmCall({ tokensIn: Number.NaN, tokensOut: Number.POSITIVE_INFINITY, costUsd: 0.5 }),
    )
    const cost = handle.cost()
    expect(cost.tokensIn).toBe(0)
    expect(cost.tokensOut).toBe(0)
    expect(cost.costUsd).toBe(0.5)
    expect(cost.llmCalls).toBe(1)
  })

  it('completes idempotently with the same status and freezes wallMs at completion', () => {
    let clock = 100
    const handle = startRuntimeRun({
      workspaceId: 'ws-1',
      taskSpec: task,
      id: 'idempotent-run',
      now: () => clock,
    })
    clock = 350
    handle.complete({ status: 'completed', resultSummary: 'ok' })
    expect(handle.status).toBe('completed')
    const firstCost = handle.cost()

    clock = 9999
    // Same terminal status is a no-op (does not throw, does not update wallMs).
    handle.complete({ status: 'completed', resultSummary: 'ok-again' })
    expect(handle.status).toBe('completed')
    const secondCost = handle.cost()
    expect(firstCost.wallMs).toBe(250)
    expect(secondCost.wallMs).toBe(250)
  })

  it('refuses to transition between two different terminal statuses', () => {
    const handle = startRuntimeRun({ workspaceId: 'ws-1', taskSpec: task, id: 'no-time-travel' })
    handle.complete({ status: 'completed', resultSummary: 'done' })
    expect(() => handle.complete({ status: 'failed', error: 'too late' })).toThrow(
      RuntimeRunStateError,
    )
  })

  it('persist() refuses to run before complete()', async () => {
    const handle = startRuntimeRun({ workspaceId: 'ws-1', taskSpec: task, id: 'must-complete' })
    await expect(handle.persist()).rejects.toBeInstanceOf(RuntimeRunStateError)
  })

  it('persist() writes the canonical row to the adapter', async () => {
    const rows: RuntimeRunRow[] = []
    const adapter: RuntimeRunPersistenceAdapter = {
      upsert(row) {
        rows.push(row)
      },
    }
    let clock = 0
    const handle = startRuntimeRun({
      workspaceId: 'ws-1',
      sessionId: 'thread-1',
      agentId: 'legal-chat-runtime',
      taskSpec: task,
      adapter,
      id: 'persist-run',
      scenarioId: 'legal-chat:thread-1',
      now: () => clock,
    })
    clock = 50
    handle.observe(llmCall({ tokensIn: 100, tokensOut: 50, costUsd: 0.001 }))
    clock = 300
    handle.complete({
      status: 'completed',
      resultSummary: 'reviewed',
      metadata: { threadId: 'thread-1' },
    })
    await handle.persist({ runtimeEvents: [{ type: 'final' }] })

    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.id).toBe('persist-run')
    expect(row.workspaceId).toBe('ws-1')
    expect(row.sessionId).toBe('thread-1')
    expect(row.agentId).toBe('legal-chat-runtime')
    expect(row.domain).toBe('legal')
    expect(row.taskId).toBe('task-runtime-run')
    expect(row.scenarioId).toBe('legal-chat:thread-1')
    expect(row.status).toBe('completed')
    expect(row.resultSummary).toBe('reviewed')
    expect(row.cost.costUsd).toBeCloseTo(0.001, 9)
    expect(row.cost.tokensIn).toBe(100)
    expect(row.cost.tokensOut).toBe(50)
    expect(row.cost.llmCalls).toBe(1)
    expect(row.cost.wallMs).toBe(300)
    expect(row.completedAt).toBe(new Date(300).toISOString())
    expect(row.metadata).toEqual({ threadId: 'thread-1', runtimeEvents: [{ type: 'final' }] })
  })

  it('persist() propagates adapter errors so callers can decide whether to retry', async () => {
    const adapter: RuntimeRunPersistenceAdapter = {
      upsert: vi.fn(() => {
        throw new Error('postgres timeout')
      }),
    }
    const handle = startRuntimeRun({
      workspaceId: 'ws-1',
      taskSpec: task,
      adapter,
      id: 'persist-fail',
    })
    handle.complete({ status: 'failed', error: 'sandbox dropped' })
    await expect(handle.persist()).rejects.toThrow('postgres timeout')
  })

  it('persist() is a no-op when no adapter is configured', async () => {
    const handle = startRuntimeRun({ workspaceId: 'ws-1', taskSpec: task, id: 'no-adapter' })
    handle.complete({ status: 'completed', resultSummary: 'ok' })
    await expect(handle.persist()).resolves.toBeUndefined()
  })

  it('toRow() returns a row matching what persist() would write', async () => {
    const handle = startRuntimeRun({
      workspaceId: 'ws-1',
      taskSpec: task,
      id: 'dry-run',
      now: () => 0,
    })
    handle.observe(llmCall({ tokensIn: 10, tokensOut: 5, costUsd: 0.0001 }))
    handle.complete({ status: 'completed', resultSummary: 'dry' })
    const row = handle.toRow({ extra: 'value' })
    expect(row.id).toBe('dry-run')
    expect(row.status).toBe('completed')
    expect(row.metadata).toEqual({ extra: 'value' })
    expect(row.cost.tokensIn).toBe(10)
  })

  it('complete() with an explicit cost override replaces the accumulated ledger', () => {
    const handle = startRuntimeRun({
      workspaceId: 'ws-1',
      taskSpec: task,
      id: 'cost-override',
      now: () => 0,
    })
    handle.observe(llmCall({ tokensIn: 9999, tokensOut: 9999, costUsd: 9.99 }))
    handle.complete({
      status: 'completed',
      resultSummary: 'reconciled',
      cost: { tokensIn: 100, tokensOut: 50, costUsd: 0.01, llmCalls: 1 },
    })
    expect(handle.cost()).toMatchObject({
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.01,
      llmCalls: 1,
    })
  })
})
