import { InMemoryTraceStore } from '@tangle-network/agent-eval'
import type {
  AgentCandidateBundle,
  AgentImprovementMeasuredComparison,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type { Process, ProcessStatus, SandboxInstance } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InMemoryAgentCandidateExecutionClaimStore } from '../src/candidate-execution/claim'
import { canonicalCandidateDigest } from '../src/candidate-execution/digest'
import type { AgentCandidateExecutorRequest } from '../src/candidate-execution/types'
import {
  createAgentImprovementProposal,
  reviewAgentImprovementProposal,
} from '../src/intelligence/improvement-cycle'
import {
  createSandboxApprovedCandidateExecutor,
  sandboxApprovedCandidateExecutionSupport,
} from '../src/intelligence/sandbox-approved-candidate'
import {
  candidateSha,
  cleanupCandidateFixtures,
  createCandidateOutputExecutionFixture,
  createCandidateOutputFixture,
} from './helpers/candidate-execution-fixture'

afterEach(cleanupCandidateFixtures)

describe('Sandbox approved candidate executor', () => {
  it('runs one exact bounded-output task in a fresh strict-egress sandbox', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 1_024)
    const baselineProfile = { name: 'baseline' }
    const proposal = createAgentImprovementProposal({
      runId: 'sandbox-proposal-1',
      baselineProfile,
      findings: [],
      evaluation: measuredProfileResult(baselineProfile, fixture.bundle),
      candidateBundle: fixture.bundle,
      now: () => new Date('2026-07-13T12:00:00.000Z'),
    })
    const review = reviewAgentImprovementProposal(proposal, {
      decision: 'approve',
      reviewedBy: 'operator@example.com',
      reason: 'Held-back comparison passed.',
      now: () => new Date('2026-07-13T12:01:00.000Z'),
    })
    const status: ProcessStatus = {
      pid: 42,
      command: 'codex',
      cwd: '/workspace/task',
      running: false,
      exitCode: 0,
      startedAt: new Date('2026-07-13T12:02:00.000Z'),
      exitedAt: new Date('2026-07-13T12:02:01.000Z'),
    }
    const process = {
      wait: vi.fn(async () => 0),
      status: vi.fn(async () => status),
      stdout: async function* () {
        yield '{"accepted":true}\n'
      },
      kill: vi.fn(async () => undefined),
    } as unknown as Process
    const writes: Array<{ path: string; content: string; mode: number }> = []
    const spawnExact = vi.fn(async () => {
      spawned = true
      return process
    })
    let spawned = false
    let deleted = false
    const sandbox = {
      id: 'sandbox-candidate-1',
      metadata: undefined,
      fs: {
        write: vi.fn(async (path: string, content: string, options: { mode: number }) => {
          writes.push({ path, content, mode: options.mode })
        }),
      },
      process: {
        spawnExact,
        list: vi.fn(async () => (spawned ? [status] : [])),
        get: vi.fn(async () => process),
      },
      delete: vi.fn(async () => {
        deleted = true
      }),
    } as unknown as SandboxInstance
    const create = vi.fn(async () => sandbox)
    const outputs = createCandidateOutputFixture()
    const adapter = createSandboxApprovedCandidateExecutor({
      client: {
        create,
        get: vi.fn(async () => (deleted ? null : sandbox)),
        list: vi.fn(async () => (deleted ? [] : [sandbox])),
      },
      ports: fixture.ports,
      ...outputs,
      traceStore: new InMemoryTraceStore(),
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
      authorizeReview: async (candidateReview) => candidateReview.digest === review.digest,
    })

    const evidence = await adapter.execute({ proposal, review, task: fixture.task })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        image: `ghcr.io/example/task@sha256:${'b'.repeat(64)}`,
        publicEdge: false,
        ephemeral: true,
        bare: true,
        egressPolicy: {
          mode: 'strict',
          allowDomains: ['router.tangle.tools'],
          includeImplicitDomains: false,
        },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 120_000 }),
    )
    expect(spawnExact).toHaveBeenCalledOnce()
    const [executable, args, launch] = spawnExact.mock.calls[0]!
    expect(executable).toBe('codex')
    expect(args).toEqual(expect.any(Array))
    expect(launch).toMatchObject({
      cwd: '/workspace/task',
      stdin: fixture.task.instruction,
      timeoutMs: fixture.task.limits.timeoutMs,
    })
    expect(launch.env).not.toHaveProperty('PATH')
    expect(launch.env).toHaveProperty('MODEL_GATEWAY_TOKEN', 'protected')
    expect(writes.length).toBeGreaterThan(0)
    expect(deleted).toBe(true)
    expect(evidence).toMatchObject({
      proposalDigest: proposal.digest,
      reviewDigest: review.digest,
      succeeded: true,
      materializationReceipt: {
        profilePlan: { material: { files: expect.any(Array) } },
      },
      profileActivation: {
        profilePlan: { digest: evidence.materializationReceipt.profilePlan.digest },
        files: expect.any(Array),
      },
      receipt: {
        executorCapture: expect.objectContaining({
          sha256: expect.stringMatching(/^sha256:/),
        }),
        taskOutcome: {
          material: {
            outcome: {
              kind: 'output',
              spec: { mediaType: 'application/json', maxBytes: 1_024 },
            },
          },
        },
      },
    })
    for (const file of evidence.profileActivation.files) {
      const written = writes.find((entry) => entry.path === `/workspace/task/${file.path}`)
      expect(written?.mode).toBe(file.mode)
      expect(Buffer.from(written?.content ?? '', 'base64').toString('utf8')).toBe(file.content)
    }
    await expect(
      adapter.executor.stop(
        {
          executionId: evidence.executionId,
          executionPlanDigest: evidence.receipt.executionPlanDigest,
        },
        {
          traceStore: new InMemoryTraceStore(),
          reason: 'completed',
          signal: new AbortController().signal,
          deadlineAtMs: Date.now() + 1_000,
        },
      ),
    ).resolves.toEqual({ stopped: true })
  })

  it('declares and enforces its bounded capability instead of claiming universality', async () => {
    expect(sandboxApprovedCandidateExecutionSupport).toMatchObject({
      outcomes: ['output'],
      code: ['disabled'],
      memory: ['disabled'],
      knowledge: false,
      profile: {
        mcpTransports: ['stdio'],
        remoteMcp: false,
        tools: false,
        permissions: false,
        modes: false,
        confidential: false,
      },
    })
    const adapter = createSandboxApprovedCandidateExecutor({
      client: {
        create: vi.fn(async () => {
          throw new Error('unsupported requests must fail before sandbox creation')
        }),
        get: vi.fn(async () => null),
        list: vi.fn(async () => []),
      },
      ports: {} as never,
      grader: {} as never,
      outputArtifacts: {} as never,
      traceStore: new InMemoryTraceStore(),
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
      authorizeReview: async () => true,
    })
    const request = minimalExecutorRequest()

    await expect(
      adapter.executor.execute(
        withRequest(request, { taskOutcome: { kind: 'workspace' } }),
        {} as never,
      ),
    ).rejects.toThrow(/workspace outcomes; use Pier/)
    await expect(
      adapter.executor.execute(withRequest(request, { codeKind: 'no-op' }), {} as never),
    ).rejects.toThrow(/code workspaces; use Pier/)
    await expect(
      adapter.executor.execute(withRequest(request, { memoryMode: 'isolated' }), {} as never),
    ).rejects.toThrow(/isolated memory/)
    await expect(
      adapter.executor.execute(
        withRequest(request, { mediaType: 'application/octet-stream' }),
        {} as never,
      ),
    ).rejects.toThrow(/only UTF-8 text and JSON/)
  })
})

function measuredProfileResult(
  baselineProfile: AgentProfile,
  bundle: AgentCandidateBundle,
): AgentImprovementMeasuredComparison {
  return {
    schemaVersion: 1,
    kind: 'agent-improvement-measured-comparison',
    benchmark: { name: 'development', version: '1', splitDigest: candidateSha('f') },
    baselineProfileDigest: canonicalCandidateDigest(baselineProfile),
    candidateBundleDigest: bundle.digest,
    overall: {
      name: 'composite',
      baseline: 0,
      candidate: 1,
      delta: 1,
      confidenceInterval: {
        level: 0.95,
        lower: 1,
        upper: 1,
        method: 'paired-bootstrap',
        statistic: 'mean',
        resamples: 2_000,
      },
      n: 3,
      direction: 'higher-is-better',
      unit: 'score',
    },
    objectives: [
      {
        kind: 'objective',
        name: 'profile-quality',
        availability: 'measured',
        baseline: 0,
        candidate: 1,
        delta: 1,
        confidenceInterval: {
          level: 0.95,
          lower: 1,
          upper: 1,
          method: 'paired-bootstrap',
          statistic: 'mean',
          resamples: 2_000,
        },
        n: 3,
        direction: 'higher-is-better',
        unit: 'score',
      },
      measuredResourceObjective('cost', 'usd'),
      measuredResourceObjective('latency', 'milliseconds'),
    ],
    candidate: { label: 'measured profile' },
    decision: {
      outcome: 'ship',
      reasons: ['paired heldout interval cleared the promotion threshold'],
      contributingChecks: [{ name: 'heldout', passed: true }],
    },
    power: {
      sufficient: true,
      n: 3,
      minimumDetectableDelta: 0.5,
      confidenceLevel: 0.95,
      scaleAssumed: true,
      sharedScorerChannel: true,
      reason: 'paired sample can detect the measured effect',
    },
    provenance: {
      kind: 'agent-eval-loop',
      schema: 'tangle.loop-provenance.v2',
      runId: 'heldout-1',
      recordDigest: candidateSha('1'),
      baselineContentHash: candidateSha('2'),
      candidateContentHash: candidateSha('3'),
    },
    diff: 'measured profile replacement',
    evaluation: { generationsExplored: 1, durationMs: 1, totalCostUsd: 0 },
  }
}

function measuredResourceObjective(
  kind: 'cost' | 'latency',
  unit: 'usd' | 'milliseconds',
): AgentImprovementMeasuredComparison['objectives'][number] {
  return {
    kind,
    name: kind,
    availability: 'unavailable',
    reason: `${kind} was not captured by this fixture`,
    direction: 'lower-is-better' as const,
    unit,
  }
}

function minimalExecutorRequest(): AgentCandidateExecutorRequest {
  return {
    executionPlan: {
      value: {
        material: {
          task: { outcome: { kind: 'output', mediaType: 'text/plain', maxBytes: 10 } },
          codeKind: 'disabled',
        },
      },
    },
    inputs: {},
    memory: { mode: 'disabled' },
  } as unknown as AgentCandidateExecutorRequest
}

function withRequest(
  request: AgentCandidateExecutorRequest,
  change: {
    taskOutcome?: { kind: 'workspace' }
    codeKind?: 'no-op'
    memoryMode?: 'isolated'
    mediaType?: string
  },
): AgentCandidateExecutorRequest {
  const material = request.executionPlan.value.material
  return {
    ...request,
    executionPlan: {
      ...request.executionPlan,
      value: {
        ...request.executionPlan.value,
        material: {
          ...material,
          task: {
            ...material.task,
            outcome:
              change.taskOutcome ??
              (material.task.outcome.kind === 'output'
                ? {
                    ...material.task.outcome,
                    mediaType: change.mediaType ?? material.task.outcome.mediaType,
                  }
                : material.task.outcome),
          },
          codeKind: change.codeKind ?? material.codeKind,
        },
      },
    },
    memory:
      change.memoryMode === 'isolated'
        ? ({ mode: 'isolated' } as AgentCandidateExecutorRequest['memory'])
        : request.memory,
  }
}
