import type {
  AgentInteractiveSessionControlClaim,
  AgentInteractiveSessionControlClaimAcknowledgement,
  AgentInteractiveSessionControlClaimRequest,
  AgentInteractiveSessionRef,
} from '@tangle-network/agent-interface'
import {
  AgentInteractiveSessionControlClaimAcknowledgementSchema,
  agentExecutionPreparationReceiptSchema,
  agentInteractiveSessionControlClaimMatchesRef,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { claimRetainedInteractiveControl } from './retained-interactive-control'
import type { RetainedInteractiveRunHandle } from './retained-interactive-types'

const preparationReceipt = {
  kind: 'agent-execution-preparation' as const,
  schemaVersion: 1 as const,
  preparationId: 'preparation-1',
  requestDigest: `sha256:${'1'.repeat(64)}`,
  authoredProfileDigest: `sha256:${'2'.repeat(64)}`,
  effectiveProfileDigest: `sha256:${'2'.repeat(64)}`,
  backend: 'test-backend',
  harness: 'pi',
  harnessVersion: 'test-harness-1',
  resolvedModel: {
    requested: 'test/model',
    resolved: 'test/model',
  },
  workspace: {
    leaseId: 'workspace-lease-1',
    provider: 'test-provider',
    identityDigest: `sha256:${'3'.repeat(64)}`,
    isolation: 'per-run' as const,
    sourceSnapshotDigest: `sha256:${'4'.repeat(64)}`,
    sourceSnapshotPolicy: {
      kind: 'provider-declared' as const,
      name: 'test-snapshot',
      version: 1,
      digest: `sha256:${'5'.repeat(64)}`,
    },
    preparedWorkspaceDigest: `sha256:${'6'.repeat(64)}`,
    profileActivationDigest: `sha256:${'7'.repeat(64)}`,
  },
  axisResults: [],
  executionPlanDigest: `sha256:${'8'.repeat(64)}`,
  materializer: { name: 'test-materializer', version: '1' },
  expiresAtMs: 4102444800000,
}

const ref: AgentInteractiveSessionRef = {
  run: {
    provider: 'test-provider',
    environmentId: 'environment-1',
    sessionId: 'session-1',
    executionId: 'execution-1',
    runId: 'run-1',
    requestDigest: `sha256:${'1'.repeat(64)}`,
  },
  preparationReceipt: agentExecutionPreparationReceiptSchema.parse({
    ...preparationReceipt,
    digest: canonicalCandidateDigest(preparationReceipt),
  }),
  incarnationId: 'incarnation-1',
  startedAt: '2026-08-16T00:00:00.000Z',
}

describe('claimRetainedInteractiveControl', () => {
  it('discovers the launch generation and acquires the next exact claim', async () => {
    const requests: AgentInteractiveSessionControlClaimRequest[] = []
    const handle = interactiveHandle(async (request) => {
      requests.push(request)
      if (request.expectedGeneration === 0) {
        return acknowledgement(request, 'conflict', {
          conflictReason: 'generation_mismatch',
          currentGeneration: 1,
        })
      }
      return acknowledgement(request, 'accepted', {
        control: control(request, request.expectedGeneration + 1),
      })
    })

    const claimed = await claimRetainedInteractiveControl({ handle, holderId: 'braid-ui' })

    expect(requests.map((request) => request.expectedGeneration)).toEqual([0, 1])
    expect(requests[0]?.operationId).not.toBe(requests[1]?.operationId)
    expect(claimed).toMatchObject({ generation: 2, holderId: 'braid-ui' })
    expect(agentInteractiveSessionControlClaimMatchesRef(ref, claimed)).toBe(true)
  })

  it('reuses one operation identity when an ambiguous acquisition is retried', async () => {
    const operationIds: string[] = []
    const handle = interactiveHandle(async (request) => {
      operationIds.push(request.operationId)
      return acknowledgement(request, 'unknown', {
        message: 'transport interrupted',
        retryable: true,
      })
    })

    await expect(claimRetainedInteractiveControl({ handle, holderId: 'braid-ui' })).rejects.toThrow(
      'outcome is unknown',
    )
    await expect(claimRetainedInteractiveControl({ handle, holderId: 'braid-ui' })).rejects.toThrow(
      'outcome is unknown',
    )

    expect(operationIds).toEqual([operationIds[0], operationIds[0]])
  })

  it('follows multiple concurrent generation advances with fresh request identities', async () => {
    const requests: AgentInteractiveSessionControlClaimRequest[] = []
    const handle = interactiveHandle(async (request) => {
      requests.push(request)
      if (request.expectedGeneration === 0) {
        return acknowledgement(request, 'conflict', {
          conflictReason: 'generation_mismatch',
          currentGeneration: 2,
        })
      }
      if (request.expectedGeneration === 2) {
        return acknowledgement(request, 'conflict', {
          conflictReason: 'generation_mismatch',
          currentGeneration: 5,
        })
      }
      return acknowledgement(request, 'accepted', {
        control: control(request, request.expectedGeneration + 1),
      })
    })

    const claimed = await claimRetainedInteractiveControl({ handle, holderId: 'braid-ui' })

    expect(requests.map((request) => request.expectedGeneration)).toEqual([0, 2, 5])
    expect(new Set(requests.map((request) => request.operationId)).size).toBe(3)
    expect(new Set(requests.map((request) => request.requestDigest)).size).toBe(3)
    expect(claimed.generation).toBe(6)
  })

  it('starts from a caller-known generation', async () => {
    const requests: AgentInteractiveSessionControlClaimRequest[] = []
    const handle = interactiveHandle(async (request) => {
      requests.push(request)
      return acknowledgement(request, 'accepted', {
        control: control(request, request.expectedGeneration + 1),
      })
    })

    const claimed = await claimRetainedInteractiveControl({
      handle,
      holderId: 'braid-ui',
      expectedGeneration: 9,
    })

    expect(requests.map((request) => request.expectedGeneration)).toEqual([9])
    expect(claimed.generation).toBe(10)
  })

  it('stops before a retry when the caller aborts after a conflict', async () => {
    const controller = new AbortController()
    const requests: AgentInteractiveSessionControlClaimRequest[] = []
    const handle = interactiveHandle(async (request) => {
      requests.push(request)
      controller.abort('stop control acquisition')
      return acknowledgement(request, 'conflict', {
        conflictReason: 'generation_mismatch',
        currentGeneration: 1,
      })
    })

    await expect(
      claimRetainedInteractiveControl({
        handle,
        holderId: 'braid-ui',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError', message: 'stop control acquisition' })
    expect(requests).toHaveLength(1)
  })

  it('rejects a provider generation that does not advance', async () => {
    const handle = interactiveHandle(async (request) =>
      acknowledgement(request, 'conflict', {
        conflictReason: 'generation_mismatch',
        currentGeneration: request.expectedGeneration,
      }),
    )

    await expect(claimRetainedInteractiveControl({ handle, holderId: 'braid-ui' })).rejects.toThrow(
      'non-advancing',
    )
  })
})

function interactiveHandle(
  claim: (
    request: AgentInteractiveSessionControlClaimRequest,
  ) => Promise<AgentInteractiveSessionControlClaimAcknowledgement>,
): RetainedInteractiveRunHandle {
  return {
    ref,
    capabilities: {} as RetainedInteractiveRunHandle['capabilities'],
    claimControl: claim,
    status: async () => ({ state: 'running', ref }),
    attach: async () => {
      throw new Error('not used')
    },
    sendPrompt: async () => {
      throw new Error('not used')
    },
    stop: async () => {
      throw new Error('not used')
    },
  }
}

function control(
  request: AgentInteractiveSessionControlClaimRequest,
  generation: number,
): AgentInteractiveSessionControlClaim {
  return {
    refDigest: canonicalCandidateDigest(request.ref),
    generation,
    leaseId: `lease-${generation}`,
    holderId: request.holderId,
    expiresAt: '2099-01-01T00:00:00.000Z',
  }
}

function acknowledgement(
  request: AgentInteractiveSessionControlClaimRequest,
  status: AgentInteractiveSessionControlClaimAcknowledgement['status'],
  fields: Partial<AgentInteractiveSessionControlClaimAcknowledgement>,
): AgentInteractiveSessionControlClaimAcknowledgement {
  return AgentInteractiveSessionControlClaimAcknowledgementSchema.parse({
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    ref: request.ref,
    status,
    ...fields,
  })
}
