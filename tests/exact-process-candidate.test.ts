import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
  AgentCandidateTermination,
} from '@tangle-network/agent-interface'
import { sha256DigestSchema } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
  AgentExactProcess,
  AgentExactProcessEnvironment,
  AgentExactProcessProvider,
  AgentExactProcessStatus,
  CreateAgentExactProcessEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { hashKnowledgeBase } from '@tangle-network/agent-knowledge'
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
import type { AgentCandidateModelGrantClient } from '../src/candidate-execution/protected-model-port'
import type { AgentCandidateExecutorRequest } from '../src/candidate-execution/types'
import {
  createExactProcessCandidateExperimentExecutor,
  createProtectedExactProcessCandidateExperimentExecutor,
  exactProcessCandidateExperimentExecutionSupport,
} from '../src/intelligence/exact-process-candidate'
import { createAgentEnvironmentProviderRegistry } from '../src/runtime/environment-provider'
import {
  candidateSha,
  cleanupCandidateFixtures,
  createCandidateOutputExecutionFixture,
  createCandidateOutputFixture,
  redigestCandidateBundle,
  replaceCandidateFixtureTask,
} from './helpers/candidate-execution-fixture'

const TEST_RESOURCES = Object.freeze({ cpu: 2, memoryMb: 2_048, diskMb: 8_192 })

afterEach(cleanupCandidateFixtures)

describe('exact process candidate experiment executor', () => {
  it('composes host-owned ports with protected model grants', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 32)
    const experiment = candidateExperiment(fixture)
    const process = completedProcess('{"accepted":true}\n')
    let spawned = false
    let destroyed = false
    const environment = exactEnvironment({
      process,
      status: () => stoppedStatus(0),
      spawned: () => spawned,
      setSpawned: () => {
        spawned = true
      },
      destroy: async () => {
        destroyed = true
      },
    })
    const create = vi.fn(async (input: CreateAgentExactProcessEnvironmentInput) => {
      setEnvironmentMetadata(environment, input.metadata)
      return environment
    })
    const exact = exactProvider({ create, environment, destroyed: () => destroyed })
    const outputs = createCandidateOutputFixture()
    const grantClient: AgentCandidateModelGrantClient = {
      reserve: vi.fn(async (input) => ({
        preparationId: input.preparationId,
        digest: candidateSha('c'),
        expiresAtMs: input.expiresAtMs,
        enforcedLimits: input.limits,
        network:
          input.limits.maxModelCalls === 0
            ? { mode: 'disabled' as const }
            : { mode: 'gateway-only' as const, domains: ['router.tangle.tools'] },
      })),
      activate: vi.fn(async () => ({ env: { MODEL_GATEWAY_TOKEN: 'protected' } })),
      settle: vi.fn(async (input) => ({
        preparationId: input.preparationId,
        grantDigest: input.grantDigest,
        closed: true as const,
        calls: [],
      })),
    }
    const { models: _fixtureModels, ...hostPorts } = fixture.ports
    const adapter = createProtectedExactProcessCandidateExperimentExecutor({
      provider: environmentProvider(exact),
      resources: TEST_RESOURCES,
      hostPorts,
      model: {
        client: grantClient,
        resolveModel: async ({ requested, reasoningEffort }) => ({
          requested,
          provider: 'provider',
          model: 'model-snapshot',
          snapshot: 'model-snapshot-2026-07-01',
          reasoningEffort,
        }),
        gatewayDomain: 'router.tangle.tools',
        activationEnvNames: ['MODEL_GATEWAY_TOKEN'],
      },
      ...outputs,
      traceStore: new InMemoryTraceStore(),
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
    })

    await adapter.execute(candidateCell(experiment, fixture))

    expect(adapter.recoveryPorts.models).not.toBe(fixture.ports.models)
    expect(adapter.recoveryPorts.memory).toBe(fixture.ports.memory)
    expect(grantClient.reserve).toHaveBeenCalledOnce()
    expect(grantClient.activate).toHaveBeenCalledOnce()
    expect(grantClient.settle).toHaveBeenCalledOnce()
    expect(environment.process.spawn).toHaveBeenCalledOnce()
  })

  it('runs one exact bounded-output cell with profile and knowledge bytes', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 1_024)
    const baseline = fixture.bundle
    const knowledgeBytes = Buffer.from('# Exact runbook\nUse the verified endpoint.\n', 'utf8')
    const knowledgeMaterial = {
      kind: 'agent-candidate-workspace-manifest' as const,
      files: [
        {
          path: 'knowledge/runbook.md',
          mode: 0o644,
          sha256: embeddedCandidateArtifact(knowledgeBytes).sha256,
          byteLength: knowledgeBytes.byteLength,
        },
      ],
    }
    const knowledgeManifest = embeddedCandidateArtifact(canonicalCandidateBytes(knowledgeMaterial))
    const retrievalConfigBytes = Buffer.from('{"topK":4}\n', 'utf8')
    const hashRoot = fixture.task.stagingRoots.profileRoot
    const hashPath = join(hashRoot, 'knowledge', 'runbook.md')
    mkdirSync(dirname(hashPath), { recursive: true })
    writeFileSync(hashPath, knowledgeBytes)
    chmodSync(hashPath, 0o644)
    const candidateKnowledgeHash = sha256DigestSchema.parse(
      `sha256:${await hashKnowledgeBase(hashRoot)}`,
    )
    rmSync(join(hashRoot, 'knowledge'), { recursive: true })
    const candidate = redigestCandidateBundle(baseline, {
      profile: {
        ...baseline.profile,
        prompt: { ...baseline.profile.prompt, systemPrompt: 'Candidate prompt.' },
      },
      knowledge: {
        candidate: {
          kind: 'knowledge-improvement-candidate',
          runId: 'knowledge-run-1',
          candidateId: 'knowledge-candidate-1',
          goalHash: candidateSha('1'),
          baseHash: candidateSha('2'),
          candidateHash: candidateKnowledgeHash,
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
      const path = join(input.destination, 'knowledge', 'runbook.md')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, knowledgeBytes)
      chmodSync(path, 0o644)
    }
    const process = completedProcess('{"accepted":true}\n')
    const writes: Array<{
      path: string
      bytes: Uint8Array
      mode: number
      signal?: AbortSignal
    }> = []
    let spawned = false
    let destroyed = false
    const environment = exactEnvironment({
      process,
      status: () => stoppedStatus(0),
      spawned: () => spawned,
      setSpawned: () => {
        spawned = true
      },
      write: async (path, bytes, options) => {
        writes.push({
          path,
          bytes: Uint8Array.from(bytes),
          mode: options.mode,
          signal: options.signal,
        })
      },
      destroy: async () => {
        destroyed = true
      },
    })
    const create = vi.fn(async (input: CreateAgentExactProcessEnvironmentInput) => {
      setEnvironmentMetadata(environment, input.metadata)
      return environment
    })
    const exact = exactProvider({ create, environment, destroyed: () => destroyed })
    const provider = environmentProvider(exact)
    const registry = createAgentEnvironmentProviderRegistry([provider])
    const outputs = createCandidateOutputFixture()
    const adapter = createExactProcessCandidateExperimentExecutor({
      provider: provider.name,
      providerRegistry: registry,
      resources: TEST_RESOURCES,
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
        egress: { mode: 'strict', allowDomains: ['router.tangle.tools'] },
        resources: TEST_RESOURCES,
        metadata: expect.objectContaining({
          kind: 'agent-candidate-execution',
          provider: provider.name,
          executionId: input.executionId,
          executionPlanDigest: evidence.receipt.executionPlanDigest,
          createInputDigest: expect.stringMatching(/^sha256:/),
          outputMediaType: 'application/json',
          outputMaxBytes: 1_024,
        }),
        signal: expect.any(AbortSignal),
      }),
    )
    expect(environment.process.spawn).toHaveBeenCalledOnce()
    const [launch, spawnOperation] = vi.mocked(environment.process.spawn).mock.calls[0]!
    expect(spawnOperation?.signal).toBeInstanceOf(AbortSignal)
    expect(launch).toMatchObject({
      executable: 'codex',
      args: ['-c', 'developer_instructions="Candidate prompt."'],
      cwd: '/workspace/task',
      stdin: fixture.task.task.instruction,
      timeoutMs: 0,
    })
    expect(launch.env).toMatchObject({
      PATH: '/usr/local/bin:/usr/bin:/bin',
      MODEL_GATEWAY_TOKEN: 'protected',
      [CANDIDATE_KNOWLEDGE_ROOT_ENV]: '/workspace/task/.tangle/knowledge',
      [CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV]:
        '/workspace/task/.tangle/knowledge-retrieval-config.json',
    })
    expect(destroyed).toBe(true)
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
      expect(written?.signal).toBeInstanceOf(AbortSignal)
      expect(Buffer.from(written?.bytes ?? []).toString('utf8')).toBe(file.content)
    }
    expect(
      Buffer.from(
        writes.find((entry) => entry.path.endsWith('/knowledge/runbook.md'))?.bytes ?? [],
      ),
    ).toEqual(knowledgeBytes)
    expect(
      Buffer.from(
        writes.find((entry) => entry.path.endsWith('knowledge-retrieval-config.json'))?.bytes ?? [],
      ),
    ).toEqual(retrievalConfigBytes)
  })

  it('declares and enforces its bounded capability', async () => {
    expect(exactProcessCandidateExperimentExecutionSupport).toEqual({
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
        freshEnvironment: true,
        exactProcess: true,
        egress: ['blocked', 'strict'],
      },
    })
    expect(() =>
      createExactProcessCandidateExperimentExecutor({
        provider: { name: 'ordinary', capabilities: async () => ({}) } as AgentEnvironmentProvider,
        resources: TEST_RESOURCES,
        ports: {} as never,
        grader: {} as never,
        outputArtifacts: {} as never,
        traceStore: new InMemoryTraceStore(),
        claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
      }),
    ).toThrow(/does not implement exact processes/)

    const exact = exactProvider({
      create: vi.fn(async () => {
        throw new Error('unsupported requests must fail before environment creation')
      }),
    })
    const adapter = createExactProcessCandidateExperimentExecutor({
      provider: environmentProvider(exact),
      resources: TEST_RESOURCES,
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
    await expect(
      adapter.executor.execute(
        withRequest(request, { executable: 'codex', path: undefined }),
        {} as never,
      ),
    ).rejects.toThrow(/absolute or declare a signed PATH/)
  })

  it('blocks all egress when the signed task disables model calls', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 32)
    replaceCandidateFixtureTask(fixture, {
      limits: { ...fixture.task.task.limits, maxModelCalls: 0 },
    })
    const experiment = candidateExperiment(fixture)
    const process = completedProcess('{"accepted":true}\n')
    const { adapter, create } = exactAdapter(fixture, process, () => stoppedStatus(0))

    await adapter.execute(candidateCell(experiment, fixture))

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ egress: { mode: 'blocked' } }))
  })

  it('preserves a local immutable image id instead of constructing a registry reference', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 32)
    const manifestDigest = fixture.task.task.evaluatorTaskContainer.manifestDigest
    const localContainer = {
      ...fixture.task.task.evaluatorTaskContainer,
      image: manifestDigest,
    }
    replaceCandidateFixtureTask(fixture, { evaluatorTaskContainer: localContainer })
    fixture.ports.containers.resolve = async () => localContainer
    const process = completedProcess('{"accepted":true}\n')
    const { adapter, create } = exactAdapter(fixture, process, () => stoppedStatus(0))

    await adapter.execute(candidateCell(candidateExperiment(fixture), fixture))

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ image: manifestDigest }))
  })

  it('fails before creation when a provider does not declare the requested egress', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 32)
    const process = completedProcess('{"accepted":true}\n')
    const setup = exactAdapter(fixture, process, () => stoppedStatus(0), {
      egress: ['blocked'],
    })

    await expect(
      setup.adapter.execute(candidateCell(candidateExperiment(fixture), fixture)),
    ).rejects.toThrow(/does not declare strict exact egress/)
    expect(setup.create).not.toHaveBeenCalled()
  })

  it('recovers bounded output from exact metadata in a fresh worker', async () => {
    const executionPlanDigest = candidateSha('a')
    const process = completedProcess('{"recovered":true}\n')
    let destroyed = false
    const environment = exactEnvironment({
      id: 'environment-recovery',
      metadata: {
        kind: 'agent-candidate-execution',
        provider: 'test-exact',
        executionId: 'recovery-execution',
        executionPlanDigest,
        createInputDigest: candidateSha('b'),
        outputMaxBytes: 64,
      },
      process,
      status: () => stoppedStatus(0),
      spawned: () => true,
      destroy: async () => {
        destroyed = true
      },
    })
    const exact = exactProvider({
      create: vi.fn(async () => environment),
      environment,
      destroyed: () => destroyed,
    })
    const adapter = createExactProcessCandidateExperimentExecutor({
      provider: environmentProvider(exact),
      resources: TEST_RESOURCES,
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
    expect(destroyed).toBe(true)
  })

  it('retries a transient capability lookup during recovery', async () => {
    const executionPlanDigest = candidateSha('a')
    const environment = exactEnvironment({
      id: 'environment-capability-retry',
      metadata: {
        kind: 'agent-candidate-execution',
        provider: 'test-exact',
        executionId: 'capability-retry-execution',
        executionPlanDigest,
        createInputDigest: candidateSha('b'),
        outputMaxBytes: 64,
      },
      process: completedProcess('{"recovered":true}\n'),
      status: () => stoppedStatus(0),
      spawned: () => true,
      destroy: async () => undefined,
    })
    const exact = exactProvider({ create: vi.fn(async () => environment), environment })
    const capabilities = vi
      .fn<AgentEnvironmentProvider['capabilities']>()
      .mockRejectedValueOnce(new Error('temporary capability failure'))
      .mockResolvedValue({
        exactProcess: { egress: ['blocked', 'strict'] },
      } as AgentEnvironmentCapabilities)
    const provider = { ...environmentProvider(exact), capabilities }
    const adapter = createExactProcessCandidateExperimentExecutor({
      provider,
      resources: TEST_RESOURCES,
      ports: {} as never,
      grader: {} as never,
      outputArtifacts: {} as never,
      traceStore: new InMemoryTraceStore(),
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
    })
    const request = {
      executionId: 'capability-retry-execution',
      executionPlanDigest,
    }
    const context = {
      traceStore: new InMemoryTraceStore(),
      reason: 'failed' as const,
      signal: new AbortController().signal,
      deadlineAtMs: Date.now() + 1_000,
    }

    await expect(adapter.executor.stop(request, context)).rejects.toThrow(
      'temporary capability failure',
    )
    await expect(adapter.executor.stop(request, context)).resolves.toEqual({
      stopped: true,
    })
    expect(capabilities).toHaveBeenCalledTimes(2)
  })

  it('waits for process death after a provider accepts a kill request', async () => {
    const executionPlanDigest = candidateSha('a')
    let running = true
    let termination: AgentCandidateTermination | undefined
    let resolveWait!: (termination: AgentCandidateTermination) => void
    const wait = new Promise<AgentCandidateTermination>((resolve) => {
      resolveWait = resolve
    })
    const status = () => ({ ...stoppedStatus(137, termination), running })
    const kill = vi.fn(async () => {
      setTimeout(() => {
        running = false
        termination = { kind: 'cancelled' }
        resolveWait(termination)
      }, 5)
    })
    const process = exactProcess({
      wait: async () => await wait,
      status,
      stdout: async function* () {},
      kill,
    })
    const environment = exactEnvironment({
      id: 'environment-delayed-stop',
      metadata: {
        kind: 'agent-candidate-execution',
        provider: 'test-exact',
        executionId: 'delayed-stop-execution',
        executionPlanDigest,
        createInputDigest: candidateSha('b'),
        outputMaxBytes: 64,
      },
      process,
      status,
      spawned: () => true,
      destroy: async () => undefined,
    })
    const exact = exactProvider({ create: vi.fn(async () => environment), environment })
    const adapter = createExactProcessCandidateExperimentExecutor({
      provider: environmentProvider(exact),
      resources: TEST_RESOURCES,
      ports: {} as never,
      grader: {} as never,
      outputArtifacts: {} as never,
      traceStore: new InMemoryTraceStore(),
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
    })
    const signal = new AbortController().signal

    await adapter.executor.stop(
      { executionId: 'delayed-stop-execution', executionPlanDigest },
      {
        traceStore: new InMemoryTraceStore(),
        reason: 'failed',
        signal,
        deadlineAtMs: Date.now() + 1_000,
      },
    )

    expect(kill).toHaveBeenCalledOnce()
    expect(status()).toMatchObject({ running: false, termination: { kind: 'cancelled' } })
  })

  it('kills oversized output and destroys the failed environment', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 4)
    const experiment = candidateExperiment(fixture)
    let running = true
    let termination: AgentCandidateTermination | undefined
    let resolveWait!: (termination: AgentCandidateTermination) => void
    const wait = new Promise<AgentCandidateTermination>((resolve) => {
      resolveWait = resolve
    })
    const status = () => ({ ...stoppedStatus(137, termination), running })
    const kill = vi.fn(async () => {
      running = false
      termination = { kind: 'cancelled' }
      resolveWait(termination)
    })
    const process = exactProcess({
      wait: async () => await wait,
      status,
      stdout: async function* () {
        yield 'too-long'
      },
      kill,
    })
    const { adapter, destroyed } = exactAdapter(fixture, process, status)

    await expect(adapter.execute(candidateCell(experiment, fixture))).rejects.toThrow(
      /output exceeds/,
    )
    expect(kill).toHaveBeenCalledOnce()
    expect(destroyed()).toBe(true)
  })

  it('records the Runtime timeout and destroys the environment', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 32)
    replaceCandidateFixtureTask(fixture, {
      limits: { ...fixture.task.task.limits, timeoutMs: 100 },
    })
    const experiment = candidateExperiment(fixture)
    let running = true
    let termination: AgentCandidateTermination | undefined
    let resolveWait!: (termination: AgentCandidateTermination) => void
    const wait = new Promise<AgentCandidateTermination>((resolve) => {
      resolveWait = resolve
    })
    const status = () => ({ ...stoppedStatus(137, termination), running })
    const kill = vi.fn(async () => {
      running = false
      termination = { kind: 'cancelled' }
      resolveWait(termination)
    })
    const process = exactProcess({
      wait: async () => await wait,
      status,
      stdout: async function* () {
        yield 'partial'
      },
      kill,
    })
    const { adapter, destroyed } = exactAdapter(fixture, process, status)

    const evidence = await adapter.execute(candidateCell(experiment, fixture))
    expect(evidence.receipt.termination).toEqual({ kind: 'timeout', timeoutMs: 100 })
    expect(kill).toHaveBeenCalledOnce()
    expect(destroyed()).toBe(true)
  })

  it('fails before durable success when environment destruction is not proven', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 32)
    const experiment = candidateExperiment(fixture)
    const process = completedProcess('{"accepted":true}\n')
    const setup = exactAdapter(fixture, process, () => stoppedStatus(0), undefined, true)

    await expect(adapterExecution(setup.adapter, experiment, fixture)).rejects.toThrow(
      /resource disposal|disposal is not proven/,
    )
    expect(setup.environment.destroy).toHaveBeenCalledOnce()
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
    executionId: 'exact-process-execution-1',
    executionRoots: fixture.task.executionRoots,
    stagingRoots: fixture.task.stagingRoots,
  }
  return input
}

function completedProcess(output: string): AgentExactProcess {
  const termination = { kind: 'exit', exitCode: 0 } as const
  return exactProcess({
    wait: async () => termination,
    status: async () => stoppedStatus(0, termination),
    stdout: async function* () {
      yield output
    },
  })
}

function exactProcess(
  overrides: Partial<AgentExactProcess> & Pick<AgentExactProcess, 'wait' | 'status' | 'stdout'>,
): AgentExactProcess {
  return {
    pid: 42,
    kill: vi.fn(async () => undefined),
    stderr: async function* () {},
    ...overrides,
  }
}

function stoppedStatus(
  exitCode: number,
  termination: AgentCandidateTermination | undefined = { kind: 'exit', exitCode },
): AgentExactProcessStatus {
  return {
    pid: 42,
    running: false,
    exitCode,
    ...(termination ? { termination } : {}),
  }
}

function exactEnvironment(options: {
  id?: string
  metadata?: Record<string, unknown>
  process: AgentExactProcess
  status: () => AgentExactProcessStatus
  spawned: () => boolean
  setSpawned?: () => void
  write?: AgentExactProcessEnvironment['writeFile']
  destroy: AgentExactProcessEnvironment['destroy']
}): AgentExactProcessEnvironment {
  return {
    id: options.id ?? 'environment-candidate-test',
    provider: 'test-exact',
    metadata: options.metadata,
    process: {
      spawn: vi.fn(async () => {
        options.setSpawned?.()
        return options.process
      }),
      list: vi.fn(async () => (options.spawned() ? [options.status()] : [])),
      get: vi.fn(async () => options.process),
    },
    writeFile: vi.fn(options.write ?? (async () => undefined)),
    readFile: vi.fn(async () => new Uint8Array()),
    destroy: vi.fn(options.destroy),
  }
}

function exactProvider(options: {
  create: AgentExactProcessProvider['create']
  environment?: AgentExactProcessEnvironment
  destroyed?: () => boolean
}): AgentExactProcessProvider {
  return {
    create: options.create,
    get: vi.fn(async () =>
      options.environment && !options.destroyed?.() ? options.environment : null,
    ),
    list: vi.fn(async () =>
      options.environment && !options.destroyed?.() ? [options.environment] : [],
    ),
  }
}

function environmentProvider(
  exact: AgentExactProcessProvider,
  exactCapability: NonNullable<AgentEnvironmentCapabilities['exactProcess']> = {
    egress: ['blocked', 'strict'],
  },
): AgentEnvironmentProvider {
  return {
    name: 'test-exact',
    exactProcess: exact,
    capabilities: async () => ({ exactProcess: exactCapability }) as AgentEnvironmentCapabilities,
    create: async () => {
      throw new Error('ordinary environment creation must not run')
    },
  }
}

function setEnvironmentMetadata(
  environment: AgentExactProcessEnvironment,
  metadata: Record<string, unknown>,
): void {
  ;(environment as { metadata?: Record<string, unknown> }).metadata = metadata
}

function exactAdapter(
  fixture: ReturnType<typeof createCandidateOutputExecutionFixture>,
  process: AgentExactProcess,
  currentStatus: () => AgentExactProcessStatus,
  exactCapability?: NonNullable<AgentEnvironmentCapabilities['exactProcess']>,
  failDestroy = false,
) {
  let spawned = false
  let destroyed = false
  const environment = exactEnvironment({
    process,
    status: currentStatus,
    spawned: () => spawned,
    setSpawned: () => {
      spawned = true
    },
    destroy: async () => {
      if (failDestroy) throw new Error('environment destruction failed')
      destroyed = true
    },
  })
  const create = vi.fn(async (input: CreateAgentExactProcessEnvironmentInput) => {
    setEnvironmentMetadata(environment, input.metadata)
    return environment
  })
  const exact = exactProvider({ create, environment, destroyed: () => destroyed })
  const outputs = createCandidateOutputFixture()
  const adapter = createExactProcessCandidateExperimentExecutor({
    provider: environmentProvider(exact, exactCapability),
    resources: TEST_RESOURCES,
    ports: fixture.ports,
    ...outputs,
    traceStore: new InMemoryTraceStore(),
    claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
  })
  return { adapter, environment, create, destroyed: () => destroyed }
}

function adapterExecution(
  adapter: ReturnType<typeof exactAdapter>['adapter'],
  experiment: AgentCandidateExperiment,
  fixture: ReturnType<typeof createCandidateOutputExecutionFixture>,
) {
  return adapter.execute(candidateCell(experiment, fixture))
}

function minimalExecutorRequest(): AgentCandidateExecutorRequest {
  return {
    benchmark: {
      task: { outcome: { kind: 'output', mediaType: 'text/plain', maxBytes: 10 } },
    },
    executionPlan: {
      value: {
        material: {
          codeKind: 'disabled',
          model: { access: { network: { mode: 'disabled' } } },
        },
      },
    },
    launch: { executable: '/usr/local/bin/codex', env: {} },
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
    executable?: string
    path?: string
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
    launch: {
      ...request.launch,
      executable: change.executable ?? request.launch.executable,
      env: change.path === undefined ? {} : { PATH: change.path },
    },
    memory:
      change.memoryMode === 'isolated'
        ? ({ mode: 'isolated' } as AgentCandidateExecutorRequest['memory'])
        : request.memory,
  }
}
