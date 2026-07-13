import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

import { InMemoryTraceStore } from '@tangle-network/agent-eval'
import { agentCandidateModelSettlementMaterialSchema } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'

import {
  candidateExecutionClaim,
  InMemoryAgentCandidateExecutionClaimStore,
} from '../src/candidate-execution/claim'
import { prepareAgentCandidateExecution } from '../src/candidate-execution/prepare'
import { recoverExpiredAgentCandidateExecution } from '../src/candidate-execution/recover'
import type {
  AgentCandidateOutputArtifactPort,
  PreparedAgentCandidateExecution,
} from '../src/candidate-execution/types'
import { verifyAgentCandidateBundle } from '../src/candidate-execution/verify'
import {
  candidateSha,
  cleanupCandidateFixtures,
  createCandidateExecutionFixture,
  emptyCandidateSnapshot,
  redigestCandidateBundle,
} from './helpers/candidate-execution-fixture'

afterEach(cleanupCandidateFixtures)

describe('expired candidate recovery', () => {
  it('uses persisted handles to prove cleanup and terminally fail a crashed attempt', async () => {
    const fixture = createCandidateExecutionFixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    let now = Date.now()
    const claimStore = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const outputArtifacts = outputArtifactPort()
    const claim = await persistedClaim(prepared, outputArtifacts)
    const acquired = await claimStore.tryClaim(claim)
    expect(acquired.acquired).toBe(true)
    now = claim.leaseExpiresAtMs
    let stops = 0
    let settlements = 0
    const originalSettle = fixture.ports.models.settleGrant
    fixture.ports.models.settleGrant = async (input) => {
      settlements++
      return await originalSettle(input)
    }
    const result = await recoverExpiredAgentCandidateExecution({
      attempt: { executionId: claim.executionId, attempt: claim.attempt },
      claimStore,
      traceStore: new InMemoryTraceStore(),
      ports: fixture.ports,
      outputArtifacts,
      now: () => now,
      executor: {
        execute: async () => {
          throw new Error('recovery must not execute')
        },
        stop: async (request, context) => {
          stops++
          expect(request).toEqual({
            executionId: claim.executionId,
            executionPlanDigest: claim.executionPlanDigest,
          })
          expect(context.signal.aborted).toBe(true)
          expect(context.deadlineAtMs).toBe(claim.leaseExpiresAtMs)
          return { stopped: true }
        },
        capture: async () => ({ evidence: Buffer.from('official recovery evidence') }),
      },
    })
    expect(result).toMatchObject({
      finished: true,
      terminal: {
        status: 'failed',
        failureClass: 'pre-model-infrastructure',
        usage: { modelCalls: 0 },
      },
    })
    const recoveredSettlement = agentCandidateModelSettlementMaterialSchema.parse(
      JSON.parse(
        Buffer.from(await outputArtifacts.read(result.terminal.modelSettlement)).toString('utf8'),
      ),
    )
    expect(recoveredSettlement).toMatchObject({
      kind: 'agent-candidate-model-settlement-material',
      executionPlanDigest: claim.executionPlanDigest,
      preparationId: claim.cleanup.preparationId,
      resolved: claim.cleanup.resolvedModel,
      usage: { modelCalls: 0, costUsdNanos: 0 },
    })

    const replay = await recoverExpiredAgentCandidateExecution({
      attempt: { executionId: claim.executionId, attempt: claim.attempt },
      claimStore,
      traceStore: new InMemoryTraceStore(),
      ports: fixture.ports,
      outputArtifacts,
      now: () => now,
      executor: {
        execute: async () => {
          throw new Error('recovery must not execute')
        },
        stop: async () => {
          throw new Error('terminal recovery must not stop twice')
        },
        capture: async () => {
          throw new Error('terminal recovery must not capture twice')
        },
      },
    })
    expect(replay).toMatchObject({ finished: false, exactReplay: true })
    expect({ stops, settlements }).toEqual({ stops: 1, settlements: 1 })
  })

  it('does no outward cleanup before expiry and records nothing when cleanup is unproven', async () => {
    const fixture = createCandidateExecutionFixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    let now = Date.now()
    const claimStore = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const outputArtifacts = outputArtifactPort()
    const claim = await persistedClaim(prepared, outputArtifacts)
    await claimStore.tryClaim(claim)
    let stops = 0
    const recover = () =>
      recoverExpiredAgentCandidateExecution({
        attempt: { executionId: claim.executionId, attempt: claim.attempt },
        claimStore,
        traceStore: new InMemoryTraceStore(),
        ports: fixture.ports,
        outputArtifacts,
        now: () => now,
        cleanupTimeoutMs: 25,
        executor: {
          execute: async () => {
            throw new Error('recovery must not execute')
          },
          stop: async () => {
            stops++
            throw new Error('process still live')
          },
          capture: async () => ({}),
        },
      })

    await expect(recover()).rejects.toThrow(/has not expired/)
    expect(stops).toBe(0)
    now = claim.leaseExpiresAtMs
    await expect(recover()).rejects.toThrow(/cleanup could not be proven/)
    expect(stops).toBe(1)
    expect(
      await claimStore.getAttempt({ executionId: claim.executionId, attempt: 1 }),
    ).not.toHaveProperty('terminal')
  })

  it('unlocks attempt two only when a recovered pre-run crash used zero model calls', async () => {
    const fixture = createCandidateExecutionFixture()
    fixture.task.attempt = {
      number: 1,
      maxAttempts: 2,
      retryPolicy: 'pre-model-infrastructure-only',
    }
    const first = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    let now = Date.now()
    const claimStore = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const outputArtifacts = outputArtifactPort()
    const firstClaim = await persistedClaim(first, outputArtifacts)
    await claimStore.tryClaim(firstClaim)
    now = firstClaim.leaseExpiresAtMs
    const recovered = await recoverExpiredAgentCandidateExecution({
      attempt: { executionId: firstClaim.executionId, attempt: 1 },
      claimStore,
      traceStore: new InMemoryTraceStore(),
      ports: fixture.ports,
      outputArtifacts,
      now: () => now,
      executor: {
        execute: async () => {
          throw new Error('recovery must not execute')
        },
        stop: async () => ({ stopped: true }),
        capture: async () => ({}),
      },
    })
    expect(recovered).toMatchObject({
      finished: true,
      terminal: { failureClass: 'pre-model-infrastructure', usage: { modelCalls: 0 } },
    })

    rmSync(fixture.task.stagingRoots.profileRoot, { recursive: true, force: true })
    mkdirSync(fixture.task.stagingRoots.profileRoot)
    fixture.task.attempt = {
      number: 2,
      maxAttempts: 2,
      retryPolicy: 'pre-model-infrastructure-only',
    }
    const second = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    await expect(
      claimStore.tryClaim(await persistedClaim(second, outputArtifacts)),
    ).resolves.toMatchObject({ acquired: true })
  })

  it('repeats idempotent cleanup after a partial recovery failure', async () => {
    const fixture = createCandidateExecutionFixture()
    fixture.bundle = redigestCandidateBundle(fixture.bundle, {
      memory: { mode: 'isolated', scope: 'task' },
    })
    const before = emptyCandidateSnapshot('recovery-before')
    fixture.ports.memory.reset = async ({ preparationId, expiresAtMs }) => ({
      preparationId,
      accessDigest: candidateSha('8'),
      expiresAtMs,
      evidence: before.manifest,
      emptyStateDigest: before.digest,
      beforeState: before,
    })
    let memoryCloses = 0
    fixture.ports.memory.close = async () => {
      memoryCloses++
      if (memoryCloses === 1) throw new Error('transient memory service failure')
      return { closed: true }
    }
    let settlements = 0
    const originalSettle = fixture.ports.models.settleGrant
    fixture.ports.models.settleGrant = async (input) => {
      settlements++
      return await originalSettle(input)
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    let now = Date.now()
    const claimStore = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const artifactStore = outputArtifactPort()
    const persistedPurposes: string[] = []
    const outputArtifacts: AgentCandidateOutputArtifactPort = {
      ...artifactStore,
      put: async (input) => {
        persistedPurposes.push(input.purpose)
        return artifactStore.put(input)
      },
    }
    const claim = await persistedClaim(prepared, outputArtifacts)
    await claimStore.tryClaim(claim)
    now = claim.leaseExpiresAtMs
    let stops = 0
    let captures = 0
    const recover = () =>
      recoverExpiredAgentCandidateExecution({
        attempt: { executionId: claim.executionId, attempt: claim.attempt },
        claimStore,
        traceStore: new InMemoryTraceStore(),
        ports: fixture.ports,
        outputArtifacts,
        now: () => now,
        executor: {
          execute: async () => {
            throw new Error('recovery must not execute')
          },
          stop: async () => {
            stops++
            return { stopped: true }
          },
          capture: async () => {
            captures++
            return { evidence: Buffer.from(`capture-${captures}`) }
          },
        },
      })

    await expect(recover()).rejects.toThrow(/cleanup could not be proven/)
    expect(persistedPurposes).toContain('executor-capture')
    expect(
      await claimStore.getAttempt({ executionId: claim.executionId, attempt: 1 }),
    ).not.toHaveProperty('terminal')
    await expect(recover()).resolves.toMatchObject({ finished: true })
    expect({ stops, captures, settlements, memoryCloses }).toEqual({
      stops: 2,
      captures: 2,
      settlements: 2,
      memoryCloses: 2,
    })
  })

  it('rejects late trace writes during recovery instead of persisting unknown credentials', async () => {
    const fixture = createCandidateExecutionFixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    let now = Date.now()
    const claimStore = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const outputArtifacts = outputArtifactPort()
    const claim = await persistedClaim(prepared, outputArtifacts)
    await claimStore.tryClaim(claim)
    now = claim.leaseExpiresAtMs
    const traceStore = new InMemoryTraceStore()

    await expect(
      recoverExpiredAgentCandidateExecution({
        attempt: { executionId: claim.executionId, attempt: claim.attempt },
        claimStore,
        traceStore,
        ports: fixture.ports,
        outputArtifacts,
        now: () => now,
        executor: {
          execute: async () => {
            throw new Error('recovery must not execute')
          },
          stop: async (_request, context) => {
            await context.traceStore.appendEvent({
              runId: claim.cleanup.traceRunId,
              eventId: 'late-secret',
              kind: 'log',
              timestamp: now,
              payload: { token: 'expired-model-token' },
            })
            return { stopped: true }
          },
          capture: async () => ({}),
        },
      }),
    ).rejects.toThrow(/cleanup could not be proven/)
    await expect(traceStore.events()).resolves.toEqual([])
    await expect(
      claimStore.getAttempt({ executionId: claim.executionId, attempt: claim.attempt }),
    ).resolves.not.toHaveProperty('terminal')
  })
})

async function persistedClaim(
  prepared: PreparedAgentCandidateExecution,
  outputArtifacts: AgentCandidateOutputArtifactPort,
) {
  const [executionPlan, materializationReceipt] = await Promise.all([
    outputArtifacts.put({
      executionId: prepared.executionId,
      purpose: 'execution-plan',
      bytes: prepared.executionPlan.bytes,
    }),
    outputArtifacts.put({
      executionId: prepared.executionId,
      purpose: 'materialization-receipt',
      bytes: prepared.materializationReceipt.bytes,
    }),
  ])
  return candidateExecutionClaim(prepared, { executionPlan, materializationReceipt })
}

function outputArtifactPort(): AgentCandidateOutputArtifactPort {
  const stored = new Map<string, Uint8Array>()
  return {
    put: async ({ purpose, bytes }) => {
      const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const
      stored.set(sha256, Uint8Array.from(bytes))
      return {
        locator: {
          kind: 's3',
          bucket: 'candidate-recovery-test',
          key: `${purpose}/${sha256}.json`,
        },
        sha256,
        byteLength: bytes.byteLength,
      }
    },
    read: async (ref) => Uint8Array.from(stored.get(ref.sha256) ?? []),
  }
}
