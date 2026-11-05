import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import { acquireRunDirectoryLock, readRunDirectoryLock } from '../../src/durable/run-lock'
import { readFailureRecord, readSettleRecord } from '../../src/durable/settle-record'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { FileResultBlobStore } from '../../src/durable/spawn-journal/result-blob-store'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import { cancelRun, readRunCancellation } from '../../src/runtime/supervise/run-cancellation'
import { superviseRootProfile } from '../../src/runtime/supervise/supervise-root-profile'
import { nestedDriverTreeRoot } from '../../src/runtime/supervise/tree-key'

it.each(['fresh', 'retained', 'retained-named-provider', 'released', 'confirmed'] as const)(
  'settles pending native cancellation without execution ports (prior state=%s)',
  async (state) => {
    const retained = state !== 'fresh'
    const unconfirmed = retained && state !== 'released'
    const runDir = await mkdtemp(join(tmpdir(), 'cold-native-cancel-'))
    const runId = 'cold-root'
    const nestedTree = nestedDriverTreeRoot(runId, 'retained-child')
    const task = 'Do not execute this cancelled native task.'
    const profile = superviseRootProfile(
      {
        name: 'native',
        harness: 'codex',
        model: {
          provider: 'openai',
          default: 'gpt-6.1-sol',
          metadata: { credentialSource: 'subscription' },
        },
      },
      undefined,
    )
    const budget = { maxIterations: 10, maxTokens: 1000 }
    const journal = new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl'))
    try {
      if (retained) {
        const at = '2026-11-04T00:00:00.000Z'
        const blobs = new FileResultBlobStore(join(runDir, 'blobs'))
        const profileRef = contentAddress(profile)
        const taskRef = contentAddress(task)
        const identity = {
          profileDigest: canonicalAgentProfileDigest(profile),
          taskDigest: canonicalCandidateDigest(task),
        }
        await blobs.put(profileRef, profile)
        await blobs.put(taskRef, task)
        await journal.beginTree(runId, at)
        for (const id of [runId, 'retained-child', 'nested-worker']) {
          const tree = id === 'nested-worker' ? nestedTree : runId
          if (id === 'nested-worker') await journal.beginTree(tree, at)
          await journal.appendEvent(tree, {
            kind: 'spawned',
            id,
            ...(id === runId ? {} : { parent: id === 'nested-worker' ? 'retained-child' : runId }),
            ...(id === 'retained-child' ? { ownedTreeRoot: nestedTree } : {}),
            label: id,
            runtime: 'sandbox',
            budget,
            identity,
            profileRef,
            seq: 0,
            at,
          })
          await journal.appendEvent(tree, { kind: 'execution-input', id, taskRef, seq: 0, at })
          const exact = {
            idempotencyKey: `${id}-key`,
            turnId: `${id}-turn`,
            sessionId: `${id}-session`,
            executionId: `${id}-execution`,
          }
          const requestDigest = canonicalCandidateDigest({ task, id })
          await journal.appendEvent(tree, {
            kind: 'execution-admitted',
            id,
            seq: 0,
            at,
            admission: {
              phase: 'intent',
              provider: 'retained-provider',
              ...exact,
              runId: id,
              requestedProfileDigest: identity.profileDigest,
              requestDigest,
            },
          })
          await journal.appendEvent(tree, {
            kind: 'execution-admitted',
            id,
            seq: 0,
            at,
            admission: {
              phase: 'environment',
              provider: 'retained-provider',
              ...exact,
              environmentId: `${id}-box`,
            },
          })
          await journal.appendEvent(tree, {
            kind: 'execution-admitted',
            id,
            seq: 0,
            at,
            admission: {
              phase: 'dispatched',
              idempotencyKey: exact.idempotencyKey,
              turnId: exact.turnId,
              controlRef: {
                provider: 'retained-provider',
                environmentId: `${id}-box`,
                sessionId: exact.sessionId,
                executionId: exact.executionId,
                runId: id,
                requestDigest,
              },
            },
          })
          if (state === 'confirmed')
            await journal.appendEvent(tree, {
              kind: 'teardown-confirmed',
              id,
              seq: 0,
              at: '2026-11-04T00:01:00.000Z',
            })
          if (state === 'released')
            await journal.appendEvent(tree, {
              kind: 'environment-teardown',
              id,
              provider: 'retained-provider',
              environmentId: `${id}-box`,
              destroyed: true,
              seq: 0,
              at: '2026-11-04T00:01:00.000Z',
            })
        }
      }
      cancelRun(runDir, 'cold-cancel', {
        operator: 'integration',
        source: 'operator',
        reason: 'stop before entry',
      })
      const lock = await acquireRunDirectoryLock(runDir, runId)
      try {
        await expect(
          supervisePursuit(profile, task, {
            pursuitId: 'cold-cancel-proof',
            runId,
            runDir,
            budget,
          }),
        ).rejects.toThrow('held by pid')
        expect(readRunCancellation(runDir, 'cold-cancel')).toBeUndefined()
        expect(await readSettleRecord(runDir)).toBeUndefined()
      } finally {
        await lock.release()
      }
      const settled = await supervisePursuit(profile, task, {
        pursuitId: 'cold-cancel-proof',
        runId,
        runDir,
        budget,
        ...(state === 'retained-named-provider'
          ? { backend: { backend: 'provider' as const, provider: 'retained-provider' } }
          : {}),
      })
      expect(settled.result).toMatchObject({
        kind: 'no-winner',
        reason: 'cancelled',
        operationId: 'cold-cancel',
        rootProviderModel: { status: 'unknown', attempts: [], models: [] },
        tree: { root: runId },
      })
      expect(await readSettleRecord(runDir)).toEqual(settled.result)
      expect(await readFailureRecord(runDir)).toBeUndefined()
      expect(await readRunDirectoryLock(runDir)).toBeUndefined()
      const events = await journal.loadTree(runId)
      expect(events?.filter((event) => event.kind === 'execution-admitted')).toHaveLength(
        retained ? 6 : 0,
      )
      expect(
        events?.filter(
          (event) => event.kind === 'materialized' || event.kind === 'execution-bound',
        ),
      ).toHaveLength(0)
      if (state === 'confirmed') {
        // A nested driver's generic confirmation covers descendants, not its owner environment.
        const owner = expect.objectContaining({
          id: 'retained-child',
          kept: [
            {
              provider: 'retained-provider',
              environmentId: 'retained-child-box',
              keptFor: 'evidence',
            },
          ],
        })
        expect(settled.result.teardownUnconfirmed).toEqual([owner])
        expect(settled.result.teardownUnconfirmed?.[0]?.environments ?? []).toEqual([])
        expect(events?.filter((event) => event.kind === 'teardown-unconfirmed')).toEqual([owner])
      } else if (unconfirmed) {
        expect(settled.result.teardownUnconfirmed).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: runId }),
            expect.objectContaining({ id: 'retained-child' }),
            expect.objectContaining({ id: 'nested-worker' }),
          ]),
        )
      } else {
        expect(settled.result.teardownUnconfirmed ?? []).toEqual([])
      }
      expect(readRunCancellation(runDir, 'cold-cancel')).toMatchObject({
        operationId: 'cold-cancel',
        operator: 'integration',
        reason: 'stop before entry',
        effect: unconfirmed ? 'unknown' : 'cancelled',
      })
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  },
)
