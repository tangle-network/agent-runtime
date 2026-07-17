import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { InMemoryTraceStore } from '@tangle-network/agent-eval'
import {
  type CandidateExperimentExecutionInput,
  sealCandidateBenchmarkSuite,
  sealCandidateExperiment,
} from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateBundle,
  AgentCandidateExperiment,
} from '@tangle-network/agent-interface'
import type {
  CreateSandboxOptions,
  Process,
  ProcessStatus,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InMemoryAgentCandidateExecutionClaimStore } from '../src/candidate-execution/claim'
import {
  canonicalCandidateBytes,
  embeddedCandidateArtifact,
} from '../src/candidate-execution/digest'
import {
  CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV,
  CANDIDATE_KNOWLEDGE_ROOT_ENV,
} from '../src/candidate-execution/knowledge'
import type { AgentCandidateExecutorRequest } from '../src/candidate-execution/types'
import {
  createSandboxCandidateExperimentExecutor,
  sandboxCandidateExperimentExecutionSupport,
} from '../src/intelligence/sandbox-approved-candidate'
import {
  candidateSha,
  cleanupCandidateFixtures,
  createCandidateOutputExecutionFixture,
  createCandidateOutputFixture,
  redigestCandidateBundle,
  replaceCandidateFixtureTask,
} from './helpers/candidate-execution-fixture'

afterEach(cleanupCandidateFixtures)

describe('sandbox candidate experiment executor', () => {
  it('runs one exact bounded-output cell with profile and knowledge bytes', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 1_024)
    const baseline = fixture.bundle
    const knowledgeBytes = Buffer.from('# Exact runbook\nUse the verified endpoint.\n', 'utf8')
    const knowledgeMaterial = {
      kind: 'agent-candidate-workspace-manifest' as const,
      files: [
        {
          path: 'runbook.md',
          mode: 0o644,
          sha256: embeddedCandidateArtifact(knowledgeBytes).sha256,
          byteLength: knowledgeBytes.byteLength,
        },
      ],
    }
    const knowledgeManifest = embeddedCandidateArtifact(canonicalCandidateBytes(knowledgeMaterial))
    const retrievalConfigBytes = Buffer.from('{"topK":4}\n', 'utf8')
    const candidate = redigestCandidateBundle(baseline, {
      knowledge: {
        candidate: {
          kind: 'knowledge-improvement-candidate',
          runId: 'knowledge-run-1',
          candidateId: 'knowledge-candidate-1',
          goalHash: candidateSha('1'),
          baseHash: candidateSha('2'),
          candidateHash: candidateSha('3'),
          evidenceHash: candidateSha('4'),
          promotionPlanHash: candidateSha('5'),
        },
        snapshot: {
          kind: 'agent-candidate-workspace-snapshot',
          digest: knowledgeManifest.sha256,
          material: knowledgeMaterial,
          manifest: knowledgeManifest,
          archive: embeddedCandidateArtifact(Buffer.from('knowledge-archive', 'utf8')),
        },
        retrievalConfig: embeddedCandidateArtifact(retrievalConfigBytes),
        evaluation: embeddedCandidateArtifact(Buffer.from('{"score":1}\n', 'utf8')),
      },
    })
    const experiment = candidateExperiment(fixture, candidate)
    const materialize = fixture.ports.workspaces.materialize
    fixture.ports.workspaces.materialize = async (input) => {
      if (input.role !== 'knowledge') return await materialize(input)
      const path = join(input.destination, 'runbook.md')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, knowledgeBytes)
      chmodSync(path, 0o644)
    }
    const process = completedProcess('{"accepted":true}\n')
    const writes: Array<{ path: string; content: string; mode: number }> = []
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
        spawnExact: vi.fn(async () => {
          spawned = true
          return process
        }),
        list: vi.fn(async () => (spawned ? [stoppedStatus(0)] : [])),
        get: vi.fn(async () => process),
      },
      delete: vi.fn(async () => {
        deleted = true
      }),
    } as unknown as SandboxInstance
    const create = vi.fn(async () => sandbox)
    const outputs = createCandidateOutputFixture()
    const adapter = createSandboxCandidateExperimentExecutor({
      client: {
        create,
        get: vi.fn(async () => (deleted ? null : sandbox)),
        list: vi.fn(async () => (deleted ? [] : [sandbox])),
      },
      ports: fixture.ports,
      ...outputs,
      traceStore: new InMemoryTraceStore(),
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
    })

    const input = candidateCell(experiment, fixture)
    const evidence = await adapter.execute(input)

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
        metadata: expect.objectContaining({
          kind: 'agent-candidate-execution',
          executionId: input.executionId,
          executionPlanDigest: evidence.receipt.executionPlanDigest,
          outputMediaType: 'application/json',
          outputMaxBytes: 1_024,
        }),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 120_000 }),
    )
    const spawnExact = sandbox.process.spawnExact as ReturnType<typeof vi.fn>
    expect(spawnExact).toHaveBeenCalledOnce()
    const [executable, args, launch] = spawnExact.mock.calls[0]!
    expect(executable).toBe('codex')
    expect(args).toEqual(expect.any(Array))
    expect(launch).toMatchObject({
      cwd: '/workspace/task',
      stdin: fixture.task.task.instruction,
      timeoutMs: fixture.task.task.limits.timeoutMs,
    })
    expect(launch.env).not.toHaveProperty('PATH')
    expect(launch.env).toHaveProperty('MODEL_GATEWAY_TOKEN', 'protected')
    expect(launch.env).toMatchObject({
      [CANDIDATE_KNOWLEDGE_ROOT_ENV]: '/workspace/task/.tangle/knowledge',
      [CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV]:
        '/workspace/task/.tangle/knowledge-retrieval-config.json',
    })
    expect(deleted).toBe(true)
    expect(evidence).toMatchObject({
      materializationReceipt: {
        profileActivation: { files: expect.any(Array) },
      },
      receipt: {
        bundleDigest: candidate.digest,
        executorCapture: expect.objectContaining({ sha256: expect.stringMatching(/^sha256:/) }),
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
    for (const file of evidence.materializationReceipt.profileActivation.files) {
      const written = writes.find((entry) => entry.path === `/workspace/task/${file.path}`)
      expect(written?.mode).toBe(file.mode)
      expect(Buffer.from(written?.content ?? '', 'base64').toString('utf8')).toBe(file.content)
    }
    expect(
      Buffer.from(
        writes.find((entry) => entry.path.endsWith('/knowledge/runbook.md'))?.content ?? '',
        'base64',
      ),
    ).toEqual(knowledgeBytes)
    expect(
      Buffer.from(
        writes.find((entry) => entry.path.endsWith('knowledge-retrieval-config.json'))?.content ??
          '',
        'base64',
      ),
    ).toEqual(retrievalConfigBytes)
  })

  it('declares and enforces its bounded capability', async () => {
    expect(sandboxCandidateExperimentExecutionSupport).toEqual({
      outcomes: ['output'],
      outputMediaTypes: ['text/*', 'application/json', '*+json'],
      code: ['disabled'],
      memory: ['disabled'],
      knowledge: true,
      profile: {
        mcpTransports: ['stdio'],
        remoteMcp: false,
        tools: false,
        permissions: false,
        modes: false,
        confidential: false,
      },
      isolation: {
        freshSandbox: true,
        exactProcess: true,
        egress: ['blocked', 'strict'],
      },
    })
    const adapter = createSandboxCandidateExperimentExecutor({
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

  it('blocks all sandbox egress when the signed task disables model calls', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 32)
    replaceCandidateFixtureTask(fixture, {
      limits: { ...fixture.task.task.limits, maxModelCalls: 0 },
    })
    const experiment = candidateExperiment(fixture)
    const process = completedProcess('{"accepted":true}\n')
    const { adapter, create } = sandboxAdapter(fixture, process, () => stoppedStatus(0))

    await adapter.execute(candidateCell(experiment, fixture))

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ egressPolicy: { mode: 'blocked' } }),
      expect.any(Object),
    )
  })

  it('recovers bounded output from sandbox metadata in a fresh worker', async () => {
    const executionPlanDigest = candidateSha('a')
    const process = completedProcess('{"recovered":true}\n')
    let deleted = false
    const sandbox = {
      id: 'sandbox-recovery',
      metadata: {
        kind: 'agent-candidate-execution',
        executionId: 'recovery-execution',
        executionPlanDigest,
        outputMaxBytes: 64,
      },
      process: {
        list: vi.fn(async () => [stoppedStatus(0)]),
        get: vi.fn(async () => process),
      },
      delete: vi.fn(async () => {
        deleted = true
      }),
    } as unknown as SandboxInstance
    const adapter = createSandboxCandidateExperimentExecutor({
      client: {
        create: vi.fn(async () => sandbox),
        get: vi.fn(async () => (deleted ? null : sandbox)),
        list: vi.fn(async () => (deleted ? [] : [sandbox])),
      },
      ports: {} as never,
      grader: {} as never,
      outputArtifacts: {} as never,
      traceStore: new InMemoryTraceStore(),
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
      resultTimeoutMs: 100,
    })
    const request = { executionId: 'recovery-execution', executionPlanDigest }
    const signal = new AbortController().signal

    const capture = await adapter.executor.capture(request, {
      traceStore: new InMemoryTraceStore(),
      signal,
    })
    await adapter.executor.dispose?.(request, { signal })

    expect(Buffer.from(capture.taskOutcome?.bytes ?? []).toString('utf8')).toBe(
      '{"recovered":true}\n',
    )
    expect(deleted).toBe(true)
  })

  it('kills oversized output and deletes the failed sandbox', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 4)
    const experiment = candidateExperiment(fixture)
    let running = true
    let resolveWait!: (exitCode: number) => void
    const wait = new Promise<number>((resolve) => {
      resolveWait = resolve
    })
    const status = () => ({ ...stoppedStatus(137), running })
    const kill = vi.fn(async () => {
      running = false
      resolveWait(137)
    })
    const process = {
      wait: vi.fn(async () => wait),
      status: vi.fn(async () => status()),
      stdout: async function* () {
        yield 'too-long'
      },
      kill,
    } as unknown as Process
    const { adapter, deleted } = sandboxAdapter(fixture, process, status)

    await expect(adapter.execute(candidateCell(experiment, fixture))).rejects.toThrow(
      /output exceeds/,
    )
    expect(kill).toHaveBeenCalledWith('SIGKILL', { tree: true })
    expect(deleted()).toBe(true)
  })

  it('records timeout evidence and deletes the sandbox', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 32)
    replaceCandidateFixtureTask(fixture, {
      limits: { ...fixture.task.task.limits, timeoutMs: 100 },
    })
    const experiment = candidateExperiment(fixture)
    let running = true
    let resolveWait!: (exitCode: number) => void
    const wait = new Promise<number>((resolve) => {
      resolveWait = resolve
    })
    const status = () => ({ ...stoppedStatus(137), running })
    const kill = vi.fn(async () => {
      running = false
      resolveWait(137)
    })
    const process = {
      wait: vi.fn(async () => wait),
      status: vi.fn(async () => status()),
      stdout: async function* () {
        yield 'partial'
      },
      kill,
    } as unknown as Process
    const { adapter, deleted } = sandboxAdapter(fixture, process, status)

    const evidence = await adapter.execute(candidateCell(experiment, fixture))
    expect(evidence.receipt.termination).toEqual({ kind: 'timeout', timeoutMs: 100 })
    expect(kill).toHaveBeenCalledWith('SIGKILL', { tree: true })
    expect(deleted()).toBe(true)
  })

  it('fails before durable success when sandbox deletion is not proven', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 32)
    const experiment = candidateExperiment(fixture)
    const process = completedProcess('{"accepted":true}\n')
    const status = () => stoppedStatus(0)
    const { adapter, sandbox } = sandboxAdapter(fixture, process, status, true)

    await expect(adapter.execute(candidateCell(experiment, fixture))).rejects.toThrow(
      /resource disposal|sandbox deletion failed/,
    )
    expect(sandbox.delete).toHaveBeenCalledOnce()
  })
})

function candidateExperiment(
  fixture: ReturnType<typeof createCandidateOutputExecutionFixture>,
  candidate: AgentCandidateBundle = redigestCandidateBundle(fixture.bundle, {
    profile: {
      ...fixture.bundle.profile,
      prompt: { ...fixture.bundle.profile.prompt, systemPrompt: 'Candidate prompt.' },
    },
  }),
): AgentCandidateExperiment {
  return sealCandidateExperiment({
    kind: 'agent-candidate-experiment',
    digestAlgorithm: 'rfc8785-sha256',
    baseline: fixture.bundle,
    candidate,
    candidateLineage: { source: 'human' },
    benchmark: sealCandidateBenchmarkSuite({
      tasks: [fixture.task.task],
      reps: 1,
      seeds: [101],
    }),
    policy: {
      confidenceLevel: 0.95,
      resamples: 500,
      bootstrapSeed: 1_337,
      deltaThreshold: 0,
      minProductiveRuns: 3,
      budgetUsd: 1,
      criticalDimensions: [],
      regressionTolerance: 0.05,
    },
  })
}

function candidateCell(
  experiment: AgentCandidateExperiment,
  fixture: ReturnType<typeof createCandidateOutputExecutionFixture>,
) {
  const input: CandidateExperimentExecutionInput & {
    executionId: string
    executionRoots: typeof fixture.task.executionRoots
    stagingRoots: typeof fixture.task.stagingRoots
  } = {
    experiment,
    arm: 'candidate',
    bundle: experiment.candidate,
    task: experiment.benchmark.tasks[0]!,
    benchmarkCell: {
      suiteDigest: experiment.benchmark.suite.digest,
      taskIndex: 0,
      repetition: 0,
    },
    seed: 101,
    executionId: 'sandbox-execution-1',
    executionRoots: fixture.task.executionRoots,
    stagingRoots: fixture.task.stagingRoots,
  }
  return input
}

function completedProcess(output: string): Process {
  return {
    wait: vi.fn(async () => 0),
    status: vi.fn(async () => stoppedStatus(0)),
    stdout: async function* () {
      yield output
    },
    kill: vi.fn(async () => undefined),
  } as unknown as Process
}

function stoppedStatus(exitCode: number): ProcessStatus {
  return {
    pid: 42,
    command: 'codex',
    cwd: '/workspace/task',
    running: false,
    exitCode,
    startedAt: new Date('2026-07-13T12:02:00.000Z'),
    exitedAt: new Date('2026-07-13T12:02:01.000Z'),
  }
}

function sandboxAdapter(
  fixture: ReturnType<typeof createCandidateOutputExecutionFixture>,
  process: Process,
  currentStatus: () => ProcessStatus,
  failDelete = false,
) {
  let spawned = false
  let wasDeleted = false
  const sandbox = {
    id: 'sandbox-candidate-test',
    metadata: undefined,
    fs: { write: vi.fn(async () => undefined) },
    process: {
      spawnExact: vi.fn(async () => {
        spawned = true
        return process
      }),
      list: vi.fn(async () => (spawned ? [currentStatus()] : [])),
      get: vi.fn(async () => process),
    },
    delete: vi.fn(async () => {
      if (failDelete) throw new Error('sandbox deletion failed')
      wasDeleted = true
    }),
  } as unknown as SandboxInstance
  const outputs = createCandidateOutputFixture()
  const create = vi.fn(async (options: CreateSandboxOptions) => {
    ;(sandbox as unknown as { metadata: Record<string, unknown> }).metadata = options.metadata ?? {}
    return sandbox
  })
  const adapter = createSandboxCandidateExperimentExecutor({
    client: {
      create,
      get: vi.fn(async () => (wasDeleted ? null : sandbox)),
      list: vi.fn(async () => (wasDeleted ? [] : [sandbox])),
    },
    ports: fixture.ports,
    ...outputs,
    traceStore: new InMemoryTraceStore(),
    claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
  })
  return { adapter, sandbox, create, deleted: () => wasDeleted }
}

function minimalExecutorRequest(): AgentCandidateExecutorRequest {
  return {
    benchmark: {
      task: { outcome: { kind: 'output', mediaType: 'text/plain', maxBytes: 10 } },
    },
    executionPlan: { value: { material: { codeKind: 'disabled' } } },
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
  const outcome = request.benchmark.task.outcome
  return {
    ...request,
    benchmark: {
      ...request.benchmark,
      task: {
        ...request.benchmark.task,
        outcome:
          change.taskOutcome ??
          (outcome.kind === 'output'
            ? { ...outcome, mediaType: change.mediaType ?? outcome.mediaType }
            : outcome),
      },
    },
    executionPlan: {
      ...request.executionPlan,
      value: {
        ...request.executionPlan.value,
        material: {
          ...request.executionPlan.value.material,
          codeKind: change.codeKind ?? request.executionPlan.value.material.codeKind,
        },
      },
    },
    memory:
      change.memoryMode === 'isolated'
        ? ({ mode: 'isolated' } as AgentCandidateExecutorRequest['memory'])
        : request.memory,
  }
}
