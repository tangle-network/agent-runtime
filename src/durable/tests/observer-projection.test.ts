import { describe, expect, it } from 'vitest'
import { type ObserverRecord, observerRecordDigest } from '../observer-journal'
import { projectPursuit } from '../observer-projection'

function record(
  sequence: number,
  input: Omit<ObserverRecord, 'schemaVersion' | 'pursuitId' | 'sequence' | 'observedAt' | 'digest'>,
  previousDigest?: string,
): ObserverRecord {
  const unsigned = {
    schemaVersion: 1 as const,
    pursuitId: 'pursuit:test',
    sequence,
    observedAt: sequence * 10,
    ...(previousDigest ? { previousDigest } : {}),
    ...input,
  }
  return { ...unsigned, digest: observerRecordDigest(unsigned) }
}

describe('projectPursuit', () => {
  it('keeps run lifecycle and recursive terminal truth isolated per Runtime run', () => {
    const first = record(1, {
      kind: 'event',
      event: {
        id: 'run-a-before',
        pursuitId: 'pursuit:test',
        runId: 'run:1',
        target: 'agent.run',
        phase: 'before',
        timestamp: 1,
      },
    })
    const second = record(
      2,
      {
        kind: 'event',
        event: {
          id: 'spawn-a',
          pursuitId: 'pursuit:test',
          runId: 'run:1',
          target: 'agent.spawn',
          phase: 'after',
          timestamp: 2,
          parentId: 'root',
          payload: {
            childId: 'root:s0',
            label: 'researcher',
            runtime: 'sandbox',
            depth: 0,
            identity: { candidateDigest: 'sha256:a' },
          },
        },
      },
      first.digest,
    )
    const third = record(
      3,
      {
        kind: 'decision',
        decision: {
          id: 'decision-a',
          pursuitId: 'pursuit:test',
          runId: 'run:1',
          stepIndex: 0,
          kind: 'continue',
          candidateActions: ['continue'],
          evidence: [],
        },
      },
      second.digest,
    )
    const fourth = record(
      4,
      {
        kind: 'event',
        event: {
          id: 'run-b-before',
          pursuitId: 'pursuit:test',
          runId: 'run:2',
          target: 'agent.run',
          phase: 'before',
          timestamp: 4,
        },
      },
      third.digest,
    )
    // A different top-level Runtime run may legitimately mint the same local node id.
    const fifth = record(
      5,
      {
        kind: 'event',
        event: {
          id: 'spawn-b',
          pursuitId: 'pursuit:test',
          runId: 'run:2',
          target: 'agent.spawn',
          phase: 'after',
          timestamp: 5,
          parentId: 'root',
          payload: {
            childId: 'root:s0',
            label: 'critic',
            runtime: 'bridge',
            depth: 0,
          },
        },
      },
      fourth.digest,
    )
    const sixth = record(
      6,
      {
        kind: 'event',
        event: {
          id: 'settle-b',
          pursuitId: 'pursuit:test',
          runId: 'run:2',
          target: 'agent.child',
          phase: 'after',
          timestamp: 6,
          parentId: 'root',
          payload: {
            childId: 'root:s0',
            status: 'done',
            outRef: 'sha256:out',
            score: 0.9,
            valid: true,
            spent: { tokens: 123 },
          },
        },
      },
      fifth.digest,
    )
    const seventh = record(
      7,
      {
        kind: 'event',
        event: {
          id: 'run-b-after',
          pursuitId: 'pursuit:test',
          runId: 'run:2',
          target: 'agent.run',
          phase: 'after',
          timestamp: 7,
          payload: { status: 'done' },
        },
      },
      sixth.digest,
    )

    const view = projectPursuit([first, second, third, fourth, fifth, sixth, seventh])
    expect(view.pursuitId).toBe('pursuit:test')
    expect(view.sequence).toBe(7)
    expect(view.chainTip).toBe(seventh.digest)
    expect(view.runs.map((run) => [run.runId, run.status])).toEqual([
      ['run:1', 'running'],
      ['run:2', 'done'],
    ])
    expect(view.runs[0]?.decisions.continue).toBe(1)
    expect(view.runs[1]?.settledAt).toBe(70)
    expect(view.nodes.map((node) => [node.runId, node.id, node.parentId])).toEqual([
      ['run:1', 'root:s0', 'root'],
      ['run:2', 'root:s0', 'root'],
    ])
    expect(view.nodes[0]?.status).toBe('running')
    expect(view.nodes[1]).toMatchObject({
      status: 'done',
      settledAt: 60,
      outRef: 'sha256:out',
      score: 0.9,
      valid: true,
      spent: { tokens: 123 },
    })
  })

  it('projects an authoritative root failure without treating a child as the pursuit verdict', () => {
    const first = record(1, {
      kind: 'event',
      event: {
        id: 'before',
        pursuitId: 'pursuit:test',
        runId: 'run:failed',
        target: 'agent.run',
        phase: 'before',
        timestamp: 1,
      },
    })
    const second = record(
      2,
      {
        kind: 'event',
        event: {
          id: 'error',
          pursuitId: 'pursuit:test',
          runId: 'run:failed',
          target: 'agent.run',
          phase: 'error',
          timestamp: 2,
          payload: { status: 'failed', error: 'driver crashed' },
        },
      },
      first.digest,
    )

    expect(projectPursuit([first, second]).runs[0]).toMatchObject({
      runId: 'run:failed',
      status: 'failed',
      settledAt: 20,
      error: 'driver crashed',
    })
  })

  it('refuses mixed or tampered observer history before projecting it', () => {
    const first = record(1, {
      kind: 'event',
      event: {
        id: 'a',
        pursuitId: 'pursuit:test',
        runId: 'run:1',
        target: 'agent.run',
        phase: 'event',
        timestamp: 1,
      },
    })
    const secondUnsigned = {
      schemaVersion: 1 as const,
      pursuitId: 'pursuit:other',
      sequence: 2,
      observedAt: 20,
      previousDigest: first.digest,
      kind: 'event' as const,
      event: {
        id: 'b',
        pursuitId: 'pursuit:other',
        runId: 'run:2',
        target: 'agent.run' as const,
        phase: 'event' as const,
        timestamp: 2,
      },
    }
    const second: ObserverRecord = {
      ...secondUnsigned,
      digest: observerRecordDigest(secondUnsigned),
    }
    expect(() => projectPursuit([first, second])).toThrow(/pursuit/i)

    const tampered: ObserverRecord = {
      ...first,
      event: { ...first.event!, runId: 'run:forged' },
    }
    expect(() => projectPursuit([tampered])).toThrow(/digest mismatch/)
  })
})
