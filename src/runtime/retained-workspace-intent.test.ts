import type { AgentWorkspaceSnapshotRef, Sha256Digest } from '@tangle-network/agent-interface'
import {
  type AgentEnvironmentProvider,
  type CreateAgentEnvironmentInput,
  execOnlyEnvironmentCapabilities,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import {
  assertRetainedRunReplayMaterial,
  startRetainedRun,
} from './retained-run-start'
import type { RetainedRunIntentAdmission, RetainedRunStartMaterial } from './retained-run-types'

const hash = (value: string): Sha256Digest => `sha256:${value.repeat(64)}`
const artifact = (value: string) => ({
  locator: { kind: 'private-cas' as const, namespace: 'transfer-operation', digest: hash(value) },
  sha256: hash(value),
  byteLength: 128,
})
const snapshot: AgentWorkspaceSnapshotRef = {
  kind: 'agent-candidate-workspace-snapshot',
  digest: hash('a'),
  manifest: artifact('a'),
  archive: artifact('b'),
  source: {
    leaseId: 'source-lease',
    leaseRecordDigest: hash('c'),
    workspace: { provider: 'local', root: '/workspace/source', identityDigest: hash('d') },
    sourceSnapshotDigest: hash('e'),
    sourceSnapshotPolicy: {
      kind: 'provider-declared',
      name: 'git-working-tree',
      version: 1,
      digest: hash('f'),
    },
  },
}

async function savedIntent(environment: CreateAgentEnvironmentInput & { idempotencyKey: string }) {
  let calls = 0
  const provider: AgentEnvironmentProvider = {
    name: 'intent-provider',
    capabilities: () => {
      calls++
      return execOnlyEnvironmentCapabilities({
        read: false,
        write: false,
        exec: false,
        git: false,
        upload: false,
        download: false,
      })
    },
    create: async () => {
      calls++
      throw new Error('provider must not be reached')
    },
    get: async () => {
      calls++
      return null
    },
  }
  const replay: RetainedRunStartMaterial = {
    environment,
    turn: { prompt: 'work', turnId: 'intent-turn' },
  }
  let admission: RetainedRunIntentAdmission | undefined
  await expect(
    startRetainedRun({
      ...replay,
      provider,
      onAdmission: async (value) => {
        if (value.phase === 'intent') {
          admission = JSON.parse(JSON.stringify(value))
          throw new Error('coordinator stopped')
        }
      },
    }),
  ).rejects.toThrow(/admission/)
  if (admission === undefined) throw new Error('no intent was persisted')
  return { replay, provider, admission, calls: () => calls }
}

describe('retained admission workspace identity', () => {
  it.each(['requestedId', 'egress', 'billingOwner', 'checkpoint', 'archive', 'lease'] as const)(
    'refuses changed %s after a serialized intent before provider effects',
    async (field) => {
      const source = {
        provider: 'source',
        environmentId: 'source-env',
        sessionId: 'source-session',
        executionId: 'source-execution',
        runId: 'source-run',
        requestDigest: hash('a'),
      }
      const checkpoint = {
        checkpointId: 'checkpoint-one',
        provider: source.provider,
        source,
        idempotencyKey: 'checkpoint-operation',
        requestDigest: hash('b'),
        createdAt: '2026-10-11T00:00:00.000Z',
      }
      const environment: CreateAgentEnvironmentInput & { idempotencyKey: string } = {
        profile: { name: 'worker' },
        idempotencyKey: 'intent-key',
        requestedId: 'environment-one',
        egress: { mode: 'blocked' },
        billingOwner: 'owner-one',
        workspace: field === 'checkpoint' ? { checkpoint } : { snapshot },
      }
      const f = await savedIntent(environment)
      const changed = structuredClone(f.replay)
      if (field === 'requestedId') changed.environment.requestedId = 'environment-two'
      if (field === 'egress') changed.environment.egress = { mode: 'open' }
      if (field === 'billingOwner') changed.environment.billingOwner = 'owner-two'
      if (field === 'checkpoint')
        changed.environment.workspace!.checkpoint!.checkpointId = 'checkpoint-two'
      if (field === 'archive') changed.environment.workspace!.snapshot!.archive = artifact('c')
      if (field === 'lease')
        changed.environment.workspace!.snapshot!.source.leaseRecordDigest = hash('d')
      expect(() => assertRetainedRunReplayMaterial(f.provider, changed, f.admission)).toThrow(
        /intent conflicts/,
      )
      expect(() =>
        assertRetainedRunReplayMaterial(
          f.provider,
          JSON.parse(JSON.stringify(f.replay)),
          f.admission,
        ),
      ).not.toThrow()
      expect(f.calls()).toBe(0)
      expect(JSON.stringify(f.admission)).not.toContain('/workspace/source')
    },
  )
})
