import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProfile,
  buildAgentExecutionPreparationReceipt,
  buildAgentWorkspaceLeaseRecord,
  canonicalCandidateDigest,
  profileMaterializationRequests,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  FileSpawnJournal,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'
import type {
  ExecutionBindingReceipt,
  ExecutionPreparationEvidence,
  NodeExecutionIdentity,
  ProfileMaterializationReceipt,
  SpawnEvent,
  SpawnJournal,
} from '../../src/runtime/supervise/types'

type SpawnedEvent = Extract<SpawnEvent, { kind: 'spawned' }>
type PreparedEvent = Extract<SpawnEvent, { kind: 'prepared' }>
type MaterializedEvent = Extract<SpawnEvent, { kind: 'materialized' }>
type ExecutionBoundEvent = Extract<SpawnEvent, { kind: 'execution-bound' }>
type SettledEvent = Extract<SpawnEvent, { kind: 'settled' }>

interface PreparationFixture {
  readonly root: string
  readonly at: string
  readonly spawn: SpawnedEvent
  readonly prepared: PreparedEvent
  readonly materialized: MaterializedEvent
  readonly executionBound: ExecutionBoundEvent
  readonly settled: SettledEvent
}

const zeroSpend = {
  iterations: 0,
  tokens: { input: 0, output: 0 },
  usd: 0,
  ms: 0,
}

function sha(character: string): Sha256Digest {
  return `sha256:${character.repeat(64)}` as Sha256Digest
}

function preparationFixture(
  options: {
    readonly root?: string
    readonly attemptId?: string
    readonly identityProfile?: AgentProfile
    readonly receiptProfile?: AgentProfile
  } = {},
): PreparationFixture {
  const root = options.root ?? 'preparation-integrity'
  const nodeId = `${root}:s0`
  const attemptId = options.attemptId ?? `${nodeId}:attempt:1`
  const at = new Date(0).toISOString()
  const identityProfile = options.identityProfile ?? { name: 'prepared-worker' }
  const receiptProfile = options.receiptProfile ?? identityProfile
  const identity: NodeExecutionIdentity = {
    profileDigest: canonicalCandidateDigest(identityProfile),
    taskDigest: canonicalCandidateDigest({ task: 'test preparation integrity' }),
  }
  const requestDigest = canonicalCandidateDigest({
    kind: 'supervised-executor-preparation-request',
    rootId: root,
    parentId: root,
    nodeId,
    attemptId,
    role: 'worker',
    identity,
  })
  const profileActivation = { digest: sha('4') }
  const leaseBase = {
    kind: 'agent-workspace-lease' as const,
    schemaVersion: 1 as const,
    leaseId: `lease-${attemptId}`,
    ownerId: 'test-owner',
    workspace: {
      provider: 'test-private-workspace',
      root: `/tmp/${nodeId}`,
      identityDigest: sha('2'),
    },
    isolation: 'per-run' as const,
    sourceSnapshotDigest: sha('3'),
    sourceSnapshotPolicy: {
      kind: 'provider-declared' as const,
      name: 'test-source-policy',
      version: 1,
      digest: sha('1'),
    },
    preparedWorkspaceDigest: sha('5'),
    profileActivationDigest: profileActivation.digest,
    createdAtMs: 100,
    expiresAtMs: 10_000,
    cleanupAttempts: 0 as const,
  }
  const sealedLease = buildAgentWorkspaceLeaseRecord({
    ...leaseBase,
    phase: 'workspace-sealed',
    updatedAtMs: 200,
  })
  const receipt = buildAgentExecutionPreparationReceipt({
    preparationId: `preparation-${attemptId}`,
    requestDigest,
    authoredProfile: receiptProfile,
    effectiveProfile: receiptProfile,
    backend: 'test-backend',
    harness: 'codex',
    harnessVersion: 'test-harness-1',
    resolvedModel: { requested: '', resolved: 'test/model' },
    workspaceLease: sealedLease,
    profileActivation,
    axisResults: profileMaterializationRequests(receiptProfile).map((request) => ({
      ...request,
      disposition: 'behavior' as const,
      owner: 'executor' as const,
      mechanism: 'test-materializer',
    })),
    executionPlanDigest: canonicalCandidateDigest({ kind: 'test-plan', attemptId }),
    materializer: { name: 'test-materializer', version: '1.0.0' },
    expiresAtMs: 10_000,
    nowMs: 100,
  })
  const workspaceLease = buildAgentWorkspaceLeaseRecord({
    ...leaseBase,
    phase: 'execution-bound',
    updatedAtMs: 300,
    executionPreparationDigest: receipt.digest,
  })
  const evidence: ExecutionPreparationEvidence = {
    attemptId,
    role: 'worker',
    receipt,
    workspaceLease,
  }
  const materialization: ProfileMaterializationReceipt = {
    status: 'known',
    authoredProfileDigest: receipt.authoredProfileDigest,
    effectiveProfileDigest: receipt.effectiveProfileDigest,
    materializationPlanDigest: canonicalCandidateDigest({ kind: 'runtime-plan', attemptId }),
    runtime: 'test-runtime',
    backend: receipt.backend,
    model: { status: 'known', id: receipt.resolvedModel.resolved },
    execution: { kind: 'session', id: nodeId },
    materializer: receipt.materializer.name,
  }
  const binding: ExecutionBindingReceipt = {
    status: 'known',
    attemptId,
    materializationReceiptDigest: canonicalCandidateDigest(materialization),
    bindingDigest: canonicalCandidateDigest({ transport: 'private', attemptId }),
    descriptor: { kind: 'test-session', transport: 'in-process' },
  }

  return {
    root,
    at,
    spawn: {
      kind: 'spawned',
      id: nodeId,
      parent: root,
      label: 'prepared worker',
      budget: { maxIterations: 1, maxTokens: 100 },
      runtime: 'test-runtime',
      identity,
      seq: 0,
      at,
    },
    prepared: { kind: 'prepared', id: nodeId, evidence, seq: 0, at },
    materialized: {
      kind: 'materialized',
      id: nodeId,
      receipt: materialization,
      seq: 0,
      at,
    },
    executionBound: { kind: 'execution-bound', id: nodeId, binding, seq: 0, at },
    settled: {
      kind: 'settled',
      id: nodeId,
      status: 'down',
      reason: 'test terminal',
      spent: zeroSpend,
      seq: 1,
      at,
    },
  }
}

async function writeRawJournal(root: string, at: string, events: readonly SpawnEvent[]) {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-preparation-journal-'))
  const path = join(directory, 'spawn.jsonl')
  const records = [
    { kind: 'begin', root, at },
    ...events.map((event) => ({ kind: 'event', root, event })),
  ]
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  return {
    journal: new FileSpawnJournal(path),
    async cleanup() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}

async function appendAll(
  journal: InMemorySpawnJournal,
  root: string,
  at: string,
  events: readonly SpawnEvent[],
): Promise<void> {
  await journal.beginTree(root, at)
  for (const event of events) await journal.appendEvent(root, event)
}

describe('spawn journal preparation integrity', () => {
  it('rejects a raw journal that records preparation after its same-attempt binding', async () => {
    const fixture = preparationFixture({ root: 'raw-reordered' })
    const raw = await writeRawJournal(fixture.root, fixture.at, [
      fixture.spawn,
      fixture.materialized,
      fixture.executionBound,
      fixture.prepared,
    ])
    try {
      await expect(
        replaySpawnTree(raw.journal, new InMemoryResultBlobStore(), fixture.root),
      ).rejects.toThrow(/follows execution-bound/)
    } finally {
      await raw.cleanup()
    }
  })

  it('revalidates a mutated in-memory binding against its prepared attempt during replay', async () => {
    const fixture = preparationFixture({ root: 'attempt-mismatch' })
    const journal = new InMemorySpawnJournal()
    await appendAll(journal, fixture.root, fixture.at, [
      fixture.spawn,
      fixture.prepared,
      fixture.materialized,
      fixture.executionBound,
    ])
    ;(fixture.executionBound.binding as { attemptId: string }).attemptId = 'different-attempt'

    await expect(
      replaySpawnTree(journal, new InMemoryResultBlobStore(), fixture.root),
    ).rejects.toThrow(/has no matching prior preparation/)
  })

  it('rejects terminal-before-prepared order returned by an in-memory journal during replay', async () => {
    const fixture = preparationFixture({ root: 'terminal-before-prepared' })
    const hostileJournal: SpawnJournal = {
      async beginTree() {},
      async appendEvent() {},
      async loadTree() {
        return [fixture.spawn, fixture.settled, fixture.prepared]
      },
    }

    await expect(
      replaySpawnTree(hostileJournal, new InMemoryResultBlobStore(), fixture.root),
    ).rejects.toThrow(/follows a terminal event/)
  })

  it('rejects a valid raw receipt whose authored profile differs from the spawned identity', async () => {
    const fixture = preparationFixture({
      root: 'profile-mismatch',
      identityProfile: { name: 'authorized-profile' },
      receiptProfile: { name: 'different-profile' },
    })
    const raw = await writeRawJournal(fixture.root, fixture.at, [fixture.spawn, fixture.prepared])
    try {
      await expect(
        replaySpawnTree(raw.journal, new InMemoryResultBlobStore(), fixture.root),
      ).rejects.toThrow(/authored profile does not match its spawn identity/)
    } finally {
      await raw.cleanup()
    }
  })

  it('rejects materialization and binding digests that do not match prior evidence', async () => {
    const materializationFixture = preparationFixture({ root: 'materialization-profile-mismatch' })
    const firstJournal = new InMemorySpawnJournal()
    await appendAll(firstJournal, materializationFixture.root, materializationFixture.at, [
      materializationFixture.spawn,
      materializationFixture.prepared,
    ])
    await expect(
      firstJournal.appendEvent(materializationFixture.root, {
        ...materializationFixture.materialized,
        receipt: {
          ...materializationFixture.materialized.receipt,
          authoredProfileDigest: sha('9'),
        },
      }),
    ).rejects.toThrow(/does not match its prepared authored profile/)

    const bindingFixture = preparationFixture({ root: 'binding-digest-mismatch' })
    const secondJournal = new InMemorySpawnJournal()
    await appendAll(secondJournal, bindingFixture.root, bindingFixture.at, [
      bindingFixture.spawn,
      bindingFixture.materialized,
    ])
    await expect(
      secondJournal.appendEvent(bindingFixture.root, {
        ...bindingFixture.executionBound,
        binding: {
          ...bindingFixture.executionBound.binding,
          materializationReceiptDigest: sha('8'),
        },
      }),
    ).rejects.toThrow(/names a different materialization receipt/)
  })

  it('continues to replay legacy journals that never recorded preparation', async () => {
    const fixture = preparationFixture({ root: 'legacy-no-preparation' })
    const journal = new InMemorySpawnJournal()
    await appendAll(journal, fixture.root, fixture.at, [
      fixture.spawn,
      fixture.materialized,
      fixture.executionBound,
      fixture.settled,
    ])

    const replayed = await replaySpawnTree(journal, new InMemoryResultBlobStore(), fixture.root)
    expect(replayed).toHaveLength(1)
    expect(replayed[0]?.handle.executionPreparations).toBeUndefined()
    expect(replayed[0]?.handle.executionBindings).toEqual([fixture.executionBound.binding])
  })

  it('accepts a resumed node prepared again under a new attempt after its prior binding', async () => {
    const first = preparationFixture({ root: 'prepared-resume', attemptId: 'attempt-1' })
    const second = preparationFixture({ root: first.root, attemptId: 'attempt-2' })
    const secondBinding: ExecutionBoundEvent = {
      ...second.executionBound,
      binding: {
        ...second.executionBound.binding,
        materializationReceiptDigest: canonicalCandidateDigest(first.materialized.receipt),
      },
    }
    const journal = new InMemorySpawnJournal()
    await appendAll(journal, first.root, first.at, [
      first.spawn,
      first.prepared,
      first.materialized,
      first.executionBound,
      second.prepared,
      secondBinding,
    ])

    await expect(journal.loadTree(first.root)).resolves.toHaveLength(6)
  })
})
