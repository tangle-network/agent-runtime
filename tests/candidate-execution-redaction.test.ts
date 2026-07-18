import { InMemoryTraceStore } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'

import { redactProtectedValue } from '../src/candidate-execution/protected-redaction'
import { createProtectedAgentCandidateTraceAccess } from '../src/candidate-execution/protected-trace-store'

describe('candidate protected-value redaction', () => {
  it('redacts overlapping credentials longest-first without retaining a suffix', () => {
    const redacted = redactProtectedValue({ short: 'secret123', long: 'secret123456' }, [
      'secret123',
      'secret123456',
    ])
    expect(redacted.value).toEqual({
      short: '[redacted:candidate-access]',
      long: '[redacted:candidate-access]',
    })
  })

  it('keeps sensitive relationships queryable without guessable or cross-run identifiers', async () => {
    const inner = new InMemoryTraceStore()
    const access = createProtectedAgentCandidateTraceAccess(inner, [])
    const first = {
      runId: 'trace-4111111111111111',
      tags: { 'customer-4111111111111111': 'execution-4111111111111111' },
    }
    const second = {
      runId: 'trace-5555555555554444',
      tags: { execution: 'execution-5555555555554444' },
    }
    await access.store.appendRun({
      ...first,
      scenarioId: 'scenario-4111111111111111',
      parentRunId: 'parent-4111111111111111',
      projectId: 'project-4111111111111111',
      chatId: 'chat-4111111111111111',
      startedAt: 1,
      endedAt: 2,
      status: 'completed',
    })
    await access.store.appendRun({
      ...second,
      scenarioId: 'scenario-5555555555554444',
      startedAt: 1,
      endedAt: 2,
      status: 'completed',
    })
    await access.store.appendSpan({
      runId: first.runId,
      spanId: 'span-4111111111111111',
      kind: 'retrieval',
      name: 'lookup',
      query: 'find evidence',
      hits: [{ docId: 'document-4111111111111111', score: 1 }],
      attributes: { requestId: 'request-4111111111111111' },
      startedAt: 1,
      endedAt: 2,
      status: 'ok',
    })
    await access.store.appendEvent({
      eventId: 'event-4111111111111111',
      runId: first.runId,
      spanId: 'span-4111111111111111',
      kind: 'custom',
      timestamp: 2,
      payload: {
        jobId: 'job-4111111111111111',
        userid: 'user-4111111111111111',
        ids: ['child-4111111111111111', 'child-5555555555554444'],
      },
    })
    await access.store.appendArtifact({
      artifactId: 'artifact-4111111111111111',
      runId: first.runId,
      spanId: 'span-4111111111111111',
      contentType: 'text/plain',
      sizeBytes: 0,
      hash: 'empty',
    })
    await access.store.appendBudgetEntry({
      runId: first.runId,
      spanId: 'span-4111111111111111',
      dimension: 'calls',
      limit: 1,
      consumed: 1,
      remaining: 0,
      timestamp: 2,
      breached: false,
    })

    const [storedFirst, storedSecond] = await inner.listRuns()
    if (!storedFirst || !storedSecond) throw new Error('expected two stored runs')
    const firstIdentity = access.identity(first)
    expect(storedFirst.runId).toBe(firstIdentity.runId)
    expect(storedFirst.runId).not.toBe(storedSecond.runId)
    await expect(access.store.getRun(first.runId)).resolves.toEqual(storedFirst)
    await expect(
      access.store.listRuns({ parentRunId: 'parent-4111111111111111' }),
    ).resolves.toEqual([storedFirst])
    await expect(
      access.store.listRuns({
        tag: { key: 'customer-4111111111111111', value: 'execution-4111111111111111' },
      }),
    ).resolves.toEqual([storedFirst])

    const [spans, events, budget, artifacts] = await Promise.all([
      access.store.spans({ runId: first.runId }),
      access.store.events({ runId: first.runId }),
      access.store.budget(first.runId),
      access.store.artifacts(first.runId),
    ])
    expect(spans).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(budget).toHaveLength(1)
    expect(artifacts).toHaveLength(1)
    expect(spans[0]?.runId).toBe(firstIdentity.runId)
    expect(events[0]?.spanId).toBe(spans[0]?.spanId)
    expect(events[0]?.payload.userid).not.toBe('user-4111111111111111')
    expect(new Set(events[0]?.payload.ids as string[]).size).toBe(2)
    expect(budget[0]?.spanId).toBe(spans[0]?.spanId)
    expect(artifacts[0]?.spanId).toBe(spans[0]?.spanId)
    expect(Object.isFrozen(access.store)).toBe(true)
    await access.closeWrites()
    await expect(
      access.store.appendEvent({
        eventId: 'late-event',
        runId: first.runId,
        kind: 'custom',
        timestamp: 3,
        payload: {},
      }),
    ).rejects.toThrow(/writes are closed/)

    const otherInner = new InMemoryTraceStore()
    const otherAccess = createProtectedAgentCandidateTraceAccess(otherInner, [])
    await otherAccess.store.appendRun({
      ...first,
      scenarioId: 'same-source',
      startedAt: 1,
      endedAt: 2,
      status: 'completed',
    })
    const [otherStored] = await otherInner.listRuns()
    expect(otherStored?.runId).not.toBe(storedFirst.runId)

    expect(
      JSON.stringify({ storedFirst, storedSecond, spans, events, budget, artifacts }),
    ).not.toMatch(/4111111111111111|5555555555554444/)
  })
})
