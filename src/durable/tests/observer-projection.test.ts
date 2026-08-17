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
  it('builds a multi-run recursive topology from substrate spawn facts', () => {
    const first = record(1, {
      kind: 'event',
      event: {
        id: 'spawn-a',
        pursuitId: 'pursuit:test',
        runId: 'run:1',
        target: 'agent.spawn',
        phase: 'after',
        timestamp: 1,
        parentId: 'root',
        payload: {
          childId: 'root:s0',
          label: 'researcher',
          runtime: 'sandbox',
          depth: 0,
          identity: { candidateDigest: 'sha256:a' },
        },
      },
    })
    const second = record(
      2,
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
      first.digest,
    )
    const third = record(
      3,
      {
        kind: 'event',
        event: {
          id: 'spawn-b',
          pursuitId: 'pursuit:test',
          runId: 'run:2',
          target: 'agent.spawn',
          phase: 'after',
          timestamp: 3,
          parentId: 'root:s0',
          payload: {
            childId: 'root:s0:s0',
            label: 'critic',
            runtime: 'bridge',
            depth: 1,
          },
        },
      },
      second.digest,
    )

    const view = projectPursuit([first, second, third])
    expect(view.pursuitId).toBe('pursuit:test')
    expect(view.sequence).toBe(3)
    expect(view.chainTip).toBe(third.digest)
    expect(view.runs.map((run) => run.runId)).toEqual(['run:1', 'run:2'])
    expect(view.runs[0]?.decisions.continue).toBe(1)
    expect(view.nodes.map((node) => [node.id, node.parentId])).toEqual([
      ['root:s0', 'root'],
      ['root:s0:s0', 'root:s0'],
    ])
  })

  it('refuses records from different pursuits', () => {
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
    expect(() => projectPursuit([first, second])).toThrow(/mixed pursuit journals/)
  })
})
