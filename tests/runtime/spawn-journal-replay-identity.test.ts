import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  contentAddress,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'
import type { NodeExecutionIdentity, SpawnEvent } from '../../src/runtime/supervise/types'

const spent = {
  iterations: 1,
  tokens: { input: 2, output: 3 },
  usd: 0.01,
  ms: 4,
}

describe('spawn journal replay identity', () => {
  it('keeps a profile materialization receipt informational when rebuilding node status', () => {
    const profileDigest = canonicalCandidateDigest({ profile: 'scientist' })
    const view = materializeTreeView([
      {
        kind: 'spawned',
        id: 'receipt-only',
        label: 'root',
        budget: { maxIterations: 1, maxTokens: 100 },
        runtime: 'cli',
        seq: 0,
        at: new Date(0).toISOString(),
      },
      {
        kind: 'materialized',
        id: 'receipt-only',
        receipt: {
          status: 'known',
          authoredProfileDigest: profileDigest,
          effectiveProfileDigest: profileDigest,
          materializationPlanDigest: canonicalCandidateDigest({ kind: 'test-plan' }),
          runtime: 'cli',
          backend: 'bridge',
          model: { status: 'known', id: 'test/model' },
          execution: { kind: 'session', id: 'test-session' },
          materializer: 'test',
        },
        seq: 0,
        at: new Date(0).toISOString(),
      },
      {
        kind: 'execution-bound',
        id: 'receipt-only',
        binding: {
          status: 'known',
          attemptId: 'attempt-1',
          materializationReceiptDigest: canonicalCandidateDigest({ receipt: 'test' }),
          bindingDigest: canonicalCandidateDigest({ endpoint: 'hidden' }),
          descriptor: { kind: 'bridge-session', transport: 'http' },
        },
        seq: 0,
        at: new Date(0).toISOString(),
      },
    ])

    expect(view.nodes).toEqual([expect.objectContaining({ id: 'receipt-only', status: 'pending' })])
  })

  it('copies every spawned identity field onto done, down, and cancelled terminal handles', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const root = 'identity-replay'
    const at = new Date(0).toISOString()
    const correlation = { pursuitId: 'pursuit-1', experimentId: 'experiment-1' }
    const identity: NodeExecutionIdentity = {
      profileDigest: canonicalCandidateDigest({ profile: 'scientist' }),
      taskDigest: canonicalCandidateDigest({ task: 'test the mechanism' }),
      candidateDigest: canonicalCandidateDigest({ candidate: 'candidate-1' }),
      correlation,
    }
    const expectedIdentity = {
      profileDigest: identity.profileDigest,
      taskDigest: identity.taskDigest,
      candidateDigest: identity.candidateDigest,
      correlation: { ...correlation },
    }

    await journal.beginTree(root, at)
    const spawns: SpawnEvent[] = [
      {
        kind: 'spawned',
        id: `${root}:done`,
        parent: root,
        label: 'done',
        key: 'done-key',
        budget: { maxIterations: 1, maxTokens: 100 },
        runtime: 'router',
        identity,
        seq: 0,
        at,
      },
      {
        kind: 'spawned',
        id: `${root}:down`,
        parent: root,
        label: 'down',
        key: 'down-key',
        budget: { maxIterations: 1, maxTokens: 100 },
        runtime: 'router',
        identity,
        seq: 1,
        at,
      },
      {
        kind: 'spawned',
        id: `${root}:cancelled`,
        parent: root,
        label: 'cancelled',
        key: 'cancelled-key',
        budget: { maxIterations: 1, maxTokens: 100 },
        runtime: 'router',
        identity,
        seq: 2,
        at,
      },
    ]
    for (const event of spawns) await journal.appendEvent(root, event)

    const out = { answer: 42 }
    const outRef = contentAddress(out)
    await blobs.put(outRef, out)
    await journal.appendEvent(root, {
      kind: 'settled',
      id: `${root}:done`,
      status: 'done',
      outRef,
      spent,
      seq: 3,
      at,
    })
    await journal.appendEvent(root, {
      kind: 'settled',
      id: `${root}:down`,
      status: 'down',
      spent,
      seq: 4,
      at,
    })
    await journal.appendEvent(root, {
      kind: 'cancelled',
      id: `${root}:cancelled`,
      reason: 'stopped',
      seq: 5,
      at,
    })

    const replayed = await replaySpawnTree(journal, blobs, root)
    expect(replayed).toHaveLength(3)
    for (const terminal of replayed) {
      expect(terminal.handle.identity).toEqual(expectedIdentity)
      expect(terminal.handle.identity).not.toBe(identity)
      expect(terminal.handle.identity?.correlation).not.toBe(correlation)
      expect(Object.isFrozen(terminal.handle)).toBe(true)
      expect(Object.isFrozen(terminal.handle.identity)).toBe(true)
      expect(Object.isFrozen(terminal.handle.identity?.correlation)).toBe(true)
    }

    correlation.experimentId = 'mutated-after-replay'
    expect(replayed.map((terminal) => terminal.handle.identity)).toEqual([
      expectedIdentity,
      expectedIdentity,
      expectedIdentity,
    ])
  })
})
