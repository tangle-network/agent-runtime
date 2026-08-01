import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { InMemoryTraceStore, type TraceStore } from '@tangle-network/agent-eval'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InMemoryAgentCandidateExecutionClaimStore } from '../src/candidate-execution/claim'
import { sha256Bytes } from '../src/candidate-execution/digest'
import { disposePreparedAgentCandidateExecution } from '../src/candidate-execution/dispose'
import { executePreparedAgentCandidate } from '../src/candidate-execution/execute'
import { prepareAgentCandidateExecution } from '../src/candidate-execution/prepare'
import type {
  AgentCandidateExecutorPort,
  AgentCandidateExecutorRequest,
} from '../src/candidate-execution/types'
import { verifyAgentCandidateBundle } from '../src/candidate-execution/verify'
import {
  captureAgentCandidateWorkspaceFiles,
  createAgentCandidateWorkspacePort,
} from '../src/candidate-execution/workspace-archive'
import {
  bindCandidateFixtureBundle,
  candidateBundle,
  candidateSha,
  cleanupCandidateFixtures,
  createCandidateExecutionFixture,
  createCandidateOutputExecutionFixture,
  createCandidateOutputFixture,
  emptyCandidateSnapshot,
  redigestCandidateBundle,
  replaceCandidateFixtureAttempt,
  replaceCandidateFixtureTask,
  unchangedTaskOutcomeCapture,
} from './helpers/candidate-execution-fixture'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  cleanupCandidateFixtures()
})

async function terminalTrace(
  request: AgentCandidateExecutorRequest,
  store: TraceStore,
  endedAt = 200,
) {
  await store.appendRun({
    runId: request.trace.runId,
    scenarioId: 'candidate-execution',
    startedAt: 100,
    endedAt,
    status: 'completed',
    tags: { ...request.trace.tags },
  })
}

interface TestExecutor {
  execute: AgentCandidateExecutorPort['execute']
  stop: AgentCandidateExecutorPort['stop']
  capture?: AgentCandidateExecutorPort['capture']
  dispose?: AgentCandidateExecutorPort['dispose']
}

function options(
  executor: TestExecutor,
  traceStore = new InMemoryTraceStore(),
  claimStore = new InMemoryAgentCandidateExecutionClaimStore(),
) {
  const outputs = createCandidateOutputFixture()
  const requests = new Map<string, AgentCandidateExecutorRequest>()
  return {
    executor: {
      execute: async (...args: Parameters<AgentCandidateExecutorPort['execute']>) => {
        requests.set(args[0].executionId, args[0])
        return await executor.execute(...args)
      },
      stop: executor.stop,
      ...(executor.dispose !== undefined ? { dispose: executor.dispose } : {}),
      capture: async (
        stopRequest: Parameters<AgentCandidateExecutorPort['capture']>[0],
        context: Parameters<AgentCandidateExecutorPort['capture']>[1],
      ) => {
        const capture = executor.capture ? await executor.capture(stopRequest, context) : {}
        if (capture.taskOutcome) return capture
        const request = requests.get(stopRequest.executionId)
        if (!request) throw new Error('fixture capture has no execution request')
        const outcome = request.benchmark.task.outcome
        if (outcome.kind !== 'workspace') {
          throw new Error('fixture fallback requires a workspace outcome')
        }
        const repository = request.benchmark.task.repository
        if (!repository) throw new Error('fixture fallback requires repository identity')
        return {
          ...capture,
          taskOutcome: {
            kind: 'workspace' as const,
            resultTree: repository.baseTree,
            afterState: request.benchmark.task.workspace.material,
            archive: Buffer.from('fixture unchanged task archive', 'utf8'),
            gitDiff: Buffer.alloc(0),
          },
        }
      },
    },
    traceStore,
    claimStore,
    ...outputs,
  }
}

describe('atomic prepared candidate execution', () => {
  it('reveals credentials only to one trusted executor and returns a durable receipt', async () => {
    const fixture = createCandidateExecutionFixture()
    bindCandidateFixtureBundle(
      fixture,
      candidateBundle({
        env: {
          PATH: { kind: 'public', value: '/usr/local/bin:/usr/bin:/bin' },
          PUBLIC_MODE: { kind: 'public', value: 'fixture' },
        },
      }),
    )
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    expect(JSON.stringify(prepared)).not.toContain('MODEL_GATEWAY_TOKEN')
    expect(JSON.stringify(prepared)).not.toContain('protected')

    const traceStore = new InMemoryTraceStore()
    let observed: AgentCandidateExecutorRequest | undefined
    let stopped = 0
    const executor: TestExecutor = {
      execute: async (request, context) => {
        observed = request
        expect(context.traceStore).not.toBe(traceStore)
        expect(context.signal.aborted).toBe(false)
        expect(context.deadlineAtMs).toBeGreaterThan(Date.now())
        expect(request.launch.env).toMatchObject({
          PUBLIC_MODE: 'fixture',
          MODEL_GATEWAY_TOKEN: 'protected',
          TANGLE_CANDIDATE_EXECUTION_ID: prepared.executionId,
        })
        expect(request.launch.env.PATH).toBe('/usr/local/bin:/usr/bin:/bin')
        expect(request.hardLimits).toEqual({ timeoutMs: fixture.task.task.limits.timeoutMs })
        expect(request.observedLimits).toEqual({ maxSteps: fixture.task.task.limits.maxSteps })
        expect(request.executionPlan.value.material.model.access.network).toEqual({
          mode: 'gateway-only',
          domains: ['router.tangle.tools'],
        })
        expect(Buffer.from(request.inputs.task.files[0]?.bytes ?? []).toString('utf8')).toBe(
          'export const value = 1\n',
        )
        await terminalTrace(request, traceStore)
        return {
          executionId: request.executionId,
          termination: { kind: 'exit', exitCode: 0 },
        }
      },
      stop: async () => {
        stopped++
        return { stopped: true }
      },
      capture: async () => {
        if (!observed) throw new Error('candidate executor did not receive its request')
        const changedBytes = Buffer.from('export const value = 2\n')
        const taskRoot = fixture.task.stagingRoots.taskRoot
        writeFileSync(join(taskRoot, 'source.ts'), changedBytes, { mode: 0o644 })
        execFileSync('git', ['add', 'source.ts'], { cwd: taskRoot })
        const resultTree = execFileSync('git', ['write-tree'], {
          cwd: taskRoot,
          encoding: 'utf8',
        }).trim()
        const gitDiff = execFileSync('git', ['diff', '--cached', '--binary', 'HEAD'], {
          cwd: taskRoot,
        })
        const captured = await captureAgentCandidateWorkspaceFiles(
          observed.inputs.task.files.map((file) => ({
            path: file.path,
            mode: file.mode,
            bytes: file.path === 'source.ts' ? changedBytes : Uint8Array.from(file.bytes),
          })),
        )
        return {
          taskOutcome: {
            kind: 'workspace',
            resultTree,
            afterState: captured.snapshot.material,
            archive: captured.archive,
            gitDiff,
          },
        }
      },
    }

    const executionOptions = options(executor, traceStore)
    const result = await executePreparedAgentCandidate(prepared, executionOptions)
    expect(observed).toBeDefined()
    expect(stopped).toBe(1)
    if (!result.succeeded) throw new Error(result.reason)
    expect(result).toMatchObject({
      succeeded: true,
      receipt: {
        value: {
          executorCapture: expect.objectContaining({
            sha256: expect.stringMatching(/^sha256:/),
          }),
          modelSettlement: {
            material: { usage: { modelCalls: 0, costUsdNanos: 0 } },
          },
          benchmarkResult: {
            material: {
              score: 1,
              passed: true,
              grader: { name: 'fixture-executable-grader', version: '1.0.0' },
            },
          },
        },
      },
    })
    await expect(
      executionOptions.outputArtifacts.read(result.artifacts.runReceipt),
    ).resolves.toEqual(result.receipt.bytes)
    expect(result.receipt.value.executorCapture).toEqual(result.artifacts.executorCapture)
  })

  it('grades and receipts exact normal-agent output through the shared execution path', async () => {
    const fixture = createCandidateOutputExecutionFixture('application/json', 1_024)
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    const output = Buffer.from('{"recommendation":"add focused failure recovery"}\n', 'utf8')
    const executionOptions = options(
      {
        execute: async (request) => {
          await terminalTrace(request, traceStore)
          return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
        },
        stop: async () => ({ stopped: true }),
        capture: async () => ({
          taskOutcome: { kind: 'output', bytes: output },
        }),
      },
      traceStore,
    )
    let gradedOutput = Buffer.alloc(0)
    executionOptions.grader = {
      ...executionOptions.grader,
      run: async (input) => {
        if (input.outcome.kind !== 'output') throw new Error('expected output outcome')
        gradedOutput = Buffer.from(input.outcome.bytes)
        return await createCandidateOutputFixture().grader.run(input)
      },
    }

    const result = await executePreparedAgentCandidate(prepared, executionOptions)
    if (!result.succeeded) throw new Error(result.reason)
    const captured = result.receipt.value.taskOutcome.material.outcome
    if (captured.kind !== 'output') throw new Error('expected output receipt')
    expect(gradedOutput).toEqual(output)
    await expect(executionOptions.outputArtifacts.read(captured.artifact)).resolves.toEqual(
      Uint8Array.from(output),
    )
    expect(result.receipt.value.benchmarkResult.material).toMatchObject({
      taskOutcomeDigest: result.receipt.value.taskOutcome.digest,
      score: 1,
      passed: true,
    })
  })

  it('publishes a referenced final receipt for a task archive larger than 28,254,720 bytes', async () => {
    const fixture = createCandidateExecutionFixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    const largeSource = Buffer.alloc(28_254_721)
    let largeArchive: Uint8Array | undefined
    fixture.ports.workspaces.materialize = createAgentCandidateWorkspacePort().materialize
    const executionOptions = options(
      {
        execute: async (request) => {
          await terminalTrace(request, traceStore)
          return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
        },
        stop: async () => ({ stopped: true }),
        capture: async () => {
          const taskRoot = fixture.task.stagingRoots.taskRoot
          writeFileSync(join(taskRoot, 'source.ts'), largeSource, { mode: 0o644 })
          execFileSync('git', ['add', 'source.ts'], { cwd: taskRoot })
          const resultTree = execFileSync('git', ['write-tree'], {
            cwd: taskRoot,
            encoding: 'utf8',
          }).trim()
          const gitDiff = execFileSync('git', ['diff', '--cached', '--binary', 'HEAD'], {
            cwd: taskRoot,
          })
          const captured = await captureAgentCandidateWorkspaceFiles(
            [{ path: 'source.ts', mode: 0o644, bytes: largeSource }],
            { limits: { maxEmbeddedArtifactBytes: 32 * 1024 * 1024 } },
          )
          largeArchive = captured.archive
          return {
            taskOutcome: {
              kind: 'workspace',
              resultTree,
              afterState: captured.snapshot.material,
              archive: captured.archive,
              gitDiff,
            },
          }
        },
      },
      traceStore,
    )

    const result = await executePreparedAgentCandidate(prepared, executionOptions)
    if (!result.succeeded) throw new Error(result.reason)
    if (!largeArchive) throw new Error('executor did not capture its large task archive')
    const taskOutcome = result.receipt.value.taskOutcome.material.outcome
    if (taskOutcome.kind !== 'workspace') throw new Error('expected workspace task outcome')
    const afterState = taskOutcome.afterState
    const archive = afterState.archive
    expect(archive).toMatchObject({
      byteLength: largeArchive.byteLength,
      sha256: sha256Bytes(largeArchive),
      locator: { kind: 's3' },
    })
    expect('content' in archive).toBe(false)
    expect(afterState.manifest).toMatchObject({ locator: { kind: 's3' } })
    expect('content' in afterState.manifest).toBe(false)
    expect(result.receipt.bytes.byteLength).toBeLessThan(100_000)
    expect(result.receipt.value).toMatchObject({
      modelSettlement: {
        material: {
          usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsdNanos: 0 },
        },
      },
      trace: { modelCallCount: 0 },
    })
    const persistedArchive = await executionOptions.outputArtifacts.read(archive)
    expect(persistedArchive.byteLength).toBe(largeArchive.byteLength)
    expect(sha256Bytes(persistedArchive)).toBe(archive.sha256)
    const executorCapture = await executionOptions.outputArtifacts.read(
      result.artifacts.executorCapture,
    )
    expect(executorCapture.byteLength).toBeLessThan(100_000)
    expect(Buffer.from(executorCapture).toString('utf8')).not.toContain('content')
    await expect(
      executionOptions.outputArtifacts.read(result.artifacts.runReceipt),
    ).resolves.toEqual(result.receipt.bytes)
  })

  it('authors paid model spans only from the closed router ledger', async () => {
    const fixture = createCandidateExecutionFixture()
    fixture.ports.models.settleGrant = async ({ preparationId }) => ({
      preparationId,
      grantDigest: candidateSha('c'),
      closed: true,
      calls: [
        {
          callId: 'call-paid-success',
          generationId: 'generation-paid-success',
          traceSpanId: 'generation-paid-success',
          status: 'succeeded',
          model: 'model-snapshot',
          startedAtMs: 120,
          endedAtMs: 180,
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 2,
          reasoningTokens: 1,
          costUsdNanos: 10_000_000,
          costProvenance: 'observed',
        },
      ],
    })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    const result = await executePreparedAgentCandidate(
      prepared,
      options(
        {
          execute: async (request, context) => {
            await expect(
              context.traceStore.appendSpan({
                runId: request.trace.runId,
                spanId: 'candidate-authored-model-span',
                kind: 'llm',
                name: 'untrusted model usage',
                model: request.resolvedModel.model,
                messages: [],
                startedAt: 120,
              }),
            ).rejects.toThrow(/cannot author protected model spans/)
            await terminalTrace(request, context.traceStore)
            return {
              executionId: request.executionId,
              termination: { kind: 'exit', exitCode: 0 },
            }
          },
          stop: async () => ({ stopped: true }),
        },
        traceStore,
      ),
    )
    if (!result.succeeded) throw new Error(result.reason)
    expect(result.receipt.value).toMatchObject({
      modelSettlement: {
        material: {
          usage: {
            modelCalls: 1,
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 2,
            reasoningTokens: 1,
            costUsdNanos: 10_000_000,
          },
          calls: [
            {
              generationId: 'generation-paid-success',
              traceSpanId: 'generation-paid-success',
              startedAtMs: 120,
              endedAtMs: 180,
              costUsdNanos: 10_000_000,
            },
          ],
        },
      },
    })
    expect(await traceStore.spans({ runId: prepared.trace.runId })).toEqual([
      expect.objectContaining({
        spanId: 'generation-paid-success',
        kind: 'llm',
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 2,
        reasoningTokens: 1,
        costUsd: 0.01,
        startedAt: 120,
        endedAt: 180,
        attributes: expect.objectContaining({
          'tangle.protected_model.source': 'router-settlement',
        }),
      }),
    ])
  })

  it('rejects pre-launch staging mutation before activation or executor access', async () => {
    const fixture = createCandidateExecutionFixture(true)
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    if (!fixture.candidateRoot) throw new Error('active fixture root is missing')
    writeFileSync(join(fixture.candidateRoot, 'run.js'), 'tampered-after-prepare\n')
    let activations = 0
    let executions = 0
    let settlements = 0
    fixture.ports.models.activateGrant = async () => {
      activations++
      return { env: { MODEL_GATEWAY_TOKEN: 'protected' } }
    }
    fixture.ports.models.settleGrant = async ({ preparationId }) => {
      settlements++
      return { preparationId, grantDigest: candidateSha('c'), closed: true, calls: [] }
    }
    const result = await executePreparedAgentCandidate(
      prepared,
      options({
        execute: async () => {
          executions++
          throw new Error('must not execute')
        },
        stop: async () => ({ stopped: true }),
        capture: async () => ({}),
      }),
    )
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/do not match the signed manifest/),
      usage: { modelCalls: 0 },
    })
    expect({ activations, executions, settlements }).toEqual({
      activations: 0,
      executions: 0,
      settlements: 1,
    })
  })

  it('refuses activation when slow claim persistence consumed the execution window', async () => {
    vi.useFakeTimers({ now: Date.now() })
    const fixture = createCandidateExecutionFixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const baseStore = new InMemoryAgentCandidateExecutionClaimStore({ now: () => Date.now() })
    let activations = 0
    fixture.ports.models.activateGrant = async () => {
      activations++
      return { env: { MODEL_GATEWAY_TOKEN: 'protected' } }
    }
    const claimStore = {
      tryClaim: async (claim: Parameters<typeof baseStore.tryClaim>[0]) => {
        const result = await baseStore.tryClaim(claim)
        vi.setSystemTime(Date.now() + fixture.task.task.limits.timeoutMs + 1)
        return result
      },
      getAttempt: (attempt: Parameters<typeof baseStore.getAttempt>[0]) =>
        baseStore.getAttempt(attempt),
      markCandidateMayRun: (lease: Parameters<typeof baseStore.markCandidateMayRun>[0]) =>
        baseStore.markCandidateMayRun(lease),
      stageTerminal: (
        lease: Parameters<typeof baseStore.stageTerminal>[0],
        result: Parameters<typeof baseStore.stageTerminal>[1],
      ) => baseStore.stageTerminal(lease, result),
      finish: (
        lease: Parameters<typeof baseStore.finish>[0],
        terminalDigest: Parameters<typeof baseStore.finish>[1],
      ) => baseStore.finish(lease, terminalDigest),
      recoverExpired: (
        attempt: Parameters<typeof baseStore.recoverExpired>[0],
        evidence: Parameters<typeof baseStore.recoverExpired>[1],
      ) => baseStore.recoverExpired(attempt, evidence),
    }
    const result = await executePreparedAgentCandidate(
      prepared,
      options(
        {
          execute: async () => {
            throw new Error('must not execute')
          },
          stop: async () => ({ stopped: true }),
        },
        new InMemoryTraceStore(),
        claimStore,
      ),
    )
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/no longer covers/),
      usage: { modelCalls: 0 },
    })
    expect(activations).toBe(0)
  })

  it('does not launch when phase persistence consumes the frozen execution window', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const fixture = createCandidateExecutionFixture()
    replaceCandidateFixtureTask(fixture, {
      limits: { ...fixture.task.task.limits, timeoutMs: 100 },
    })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
      { cleanupTimeoutMs: 25, resultTimeoutMs: 100 },
    )
    const baseStore = new InMemoryAgentCandidateExecutionClaimStore({ now: () => Date.now() })
    const claimStore = {
      tryClaim: (claim: Parameters<typeof baseStore.tryClaim>[0]) => baseStore.tryClaim(claim),
      getAttempt: (attempt: Parameters<typeof baseStore.getAttempt>[0]) =>
        baseStore.getAttempt(attempt),
      markCandidateMayRun: async (lease: Parameters<typeof baseStore.markCandidateMayRun>[0]) => {
        const result = await baseStore.markCandidateMayRun(lease)
        vi.setSystemTime(Date.now() + fixture.task.task.limits.timeoutMs)
        return result
      },
      stageTerminal: (
        lease: Parameters<typeof baseStore.stageTerminal>[0],
        terminal: Parameters<typeof baseStore.stageTerminal>[1],
      ) => baseStore.stageTerminal(lease, terminal),
      finish: (
        lease: Parameters<typeof baseStore.finish>[0],
        terminalDigest: Parameters<typeof baseStore.finish>[1],
      ) => baseStore.finish(lease, terminalDigest),
      recoverExpired: (
        attempt: Parameters<typeof baseStore.recoverExpired>[0],
        evidence: Parameters<typeof baseStore.recoverExpired>[1],
      ) => baseStore.recoverExpired(attempt, evidence),
    }
    let executions = 0
    const result = await executePreparedAgentCandidate(
      prepared,
      options(
        {
          execute: async () => {
            executions++
            throw new Error('must not execute')
          },
          stop: async () => ({ stopped: true }),
        },
        new InMemoryTraceStore(),
        claimStore,
      ),
    )

    expect(executions).toBe(0)
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/deadline elapsed while persisting its launch phase/),
      usage: { modelCalls: 0 },
    })
    await expect(
      baseStore.getAttempt({ executionId: prepared.executionId, attempt: 1 }),
    ).resolves.toMatchObject({ terminal: { status: 'failed', failureClass: 'unknown' } })
  })

  it('publishes after every post-run phase consumes nearly its full reserved interval', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const advanceClock = (durationMs: number) => vi.setSystemTime(Date.now() + durationMs)
    const cleanupTimeoutMs = 100
    const fixture = createCandidateExecutionFixture()
    replaceCandidateFixtureTask(fixture, {
      limits: { ...fixture.task.task.limits, timeoutMs: 1_000 },
    })
    fixture.ports.models.settleGrant = async ({ preparationId }) => {
      advanceClock(cleanupTimeoutMs - 1)
      return { preparationId, grantDigest: candidateSha('c'), closed: true, calls: [] }
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
      { cleanupTimeoutMs },
    )
    const traceStore = new InMemoryTraceStore()
    const baseStore = new InMemoryAgentCandidateExecutionClaimStore({ now: () => Date.now() })
    const claimStore = {
      tryClaim: (claim: Parameters<typeof baseStore.tryClaim>[0]) => baseStore.tryClaim(claim),
      getAttempt: (attempt: Parameters<typeof baseStore.getAttempt>[0]) =>
        baseStore.getAttempt(attempt),
      markCandidateMayRun: (lease: Parameters<typeof baseStore.markCandidateMayRun>[0]) =>
        baseStore.markCandidateMayRun(lease),
      stageTerminal: async (
        lease: Parameters<typeof baseStore.stageTerminal>[0],
        terminal: Parameters<typeof baseStore.stageTerminal>[1],
      ) => {
        advanceClock(5_000)
        return await baseStore.stageTerminal(lease, terminal)
      },
      finish: async (
        lease: Parameters<typeof baseStore.finish>[0],
        terminalDigest: Parameters<typeof baseStore.finish>[1],
      ) => {
        advanceClock(4_999)
        return await baseStore.finish(lease, terminalDigest)
      },
      recoverExpired: (
        attempt: Parameters<typeof baseStore.recoverExpired>[0],
        evidence: Parameters<typeof baseStore.recoverExpired>[1],
      ) => baseStore.recoverExpired(attempt, evidence),
    }
    const outputs = createCandidateOutputFixture()
    let advancedModelEvidence = false
    const outputArtifacts = {
      read: outputs.outputArtifacts.read,
      put: async (input: Parameters<typeof outputs.outputArtifacts.put>[0]) => {
        if (input.purpose === 'model-settlement' && !advancedModelEvidence) {
          advancedModelEvidence = true
          advanceClock(cleanupTimeoutMs - 1)
        }
        return await outputs.outputArtifacts.put(input)
      },
    }
    const result = await executePreparedAgentCandidate(prepared, {
      executor: {
        execute: async (request, context) => {
          vi.setSystemTime(context.deadlineAtMs - 1)
          await terminalTrace(request, traceStore)
          return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
        },
        stop: async () => {
          advanceClock(cleanupTimeoutMs - 1)
          return { stopped: true }
        },
        capture: async () => ({ taskOutcome: unchangedTaskOutcomeCapture(fixture) }),
      },
      grader: {
        ...outputs.grader,
        run: async (input) => {
          advanceClock(cleanupTimeoutMs - 1)
          return await outputs.grader.run(input)
        },
      },
      outputArtifacts,
      traceStore,
      claimStore,
      cleanupTimeoutMs,
    })

    if (!result.succeeded) throw new Error(result.reason)
    const attempt = await baseStore.getAttempt({ executionId: prepared.executionId, attempt: 1 })
    expect(attempt?.terminal?.status).toBe('succeeded')
    expect(Date.now()).toBeLessThanOrEqual(attempt?.claim.leaseExpiresAtMs ?? 0)
  })

  it('allows executable grading to exceed cleanup time inside its frozen result budget', async () => {
    const fixture = createCandidateExecutionFixture()
    replaceCandidateFixtureTask(fixture, {
      limits: { ...fixture.task.task.limits, timeoutMs: 1_000 },
    })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
      { cleanupTimeoutMs: 10, resultTimeoutMs: 100 },
    )
    const traceStore = new InMemoryTraceStore()
    const outputs = createCandidateOutputFixture()
    vi.useFakeTimers({ now: Date.now() })
    let markGraderStarted!: () => void
    const graderStarted = new Promise<void>((resolve) => {
      markGraderStarted = resolve
    })
    const pending = executePreparedAgentCandidate(prepared, {
      ...options(
        {
          execute: async (request) => {
            await terminalTrace(request, traceStore)
            return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
          },
          stop: async () => ({ stopped: true }),
          capture: async () => ({
            taskOutcome: unchangedTaskOutcomeCapture(fixture),
          }),
        },
        traceStore,
      ),
      grader: {
        ...outputs.grader,
        run: async (input) => {
          markGraderStarted()
          await new Promise((resolve) => setTimeout(resolve, 50))
          return await outputs.grader.run(input)
        },
      },
      outputArtifacts: outputs.outputArtifacts,
      cleanupTimeoutMs: 10,
      resultTimeoutMs: 100,
    })

    await graderStarted
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toMatchObject({ succeeded: true })
  })

  it('cancels over-budget grading without any output appearing after terminal failure', async () => {
    const fixture = createCandidateExecutionFixture()
    replaceCandidateFixtureTask(fixture, {
      limits: { ...fixture.task.task.limits, timeoutMs: 1_000 },
    })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
      { cleanupTimeoutMs: 25, resultTimeoutMs: 50 },
    )
    const traceStore = new InMemoryTraceStore()
    const outputs = createCandidateOutputFixture()
    const persistedPurposes: string[] = []
    const outputArtifacts = {
      read: outputs.outputArtifacts.read,
      put: async (input: Parameters<typeof outputs.outputArtifacts.put>[0]) => {
        input.signal?.throwIfAborted()
        persistedPurposes.push(input.purpose)
        return await outputs.outputArtifacts.put(input)
      },
    }
    vi.useFakeTimers({ now: Date.now() })
    let markGraderStarted!: () => void
    const graderStarted = new Promise<void>((resolve) => {
      markGraderStarted = resolve
    })
    const pending = executePreparedAgentCandidate(prepared, {
      ...options(
        {
          execute: async (request) => {
            await terminalTrace(request, traceStore)
            return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
          },
          stop: async () => ({ stopped: true }),
          capture: async () => ({
            taskOutcome: unchangedTaskOutcomeCapture(fixture),
          }),
        },
        traceStore,
      ),
      grader: {
        ...outputs.grader,
        run: async (input) => {
          markGraderStarted()
          await new Promise((resolve) => setTimeout(resolve, 100))
          return await outputs.grader.run(input)
        },
      },
      outputArtifacts,
      cleanupTimeoutMs: 25,
      resultTimeoutMs: 50,
    })

    await graderStarted
    await vi.advanceTimersByTimeAsync(50)
    const result = await pending
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/result deadline/),
    })
    const purposesAtTerminalFailure = [...persistedPurposes]
    await vi.advanceTimersByTimeAsync(100)
    await Promise.resolve()
    expect(persistedPurposes).toEqual(purposesAtTerminalFailure)
    expect(persistedPurposes).not.toContain('grader-evidence')
    expect(persistedPurposes).not.toContain('benchmark-result')
    expect(persistedPurposes).not.toContain('trace')
    expect(persistedPurposes).not.toContain('run-receipt')
  })

  it('allows disposal to retry an unproven pre-claim cleanup', async () => {
    const fixture = createCandidateExecutionFixture(true)
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    if (!fixture.candidateRoot) throw new Error('active fixture root is missing')
    writeFileSync(join(fixture.candidateRoot, 'run.js'), 'tampered-after-prepare\n')
    let settlements = 0
    fixture.ports.models.settleGrant = async ({ preparationId }) => {
      settlements++
      if (settlements === 1) throw new Error('transient gateway failure')
      return {
        preparationId,
        grantDigest: candidateSha('c'),
        closed: true,
        calls: [],
      }
    }
    const result = await executePreparedAgentCandidate(
      prepared,
      options({
        execute: async () => {
          throw new Error('must not execute')
        },
        stop: async () => ({ stopped: true }),
        capture: async () => ({}),
      }),
    )
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/cleanup remains incomplete/),
    })
    await expect(disposePreparedAgentCandidateExecution(prepared)).resolves.toEqual({
      disposed: true,
    })
    expect(settlements).toBe(2)
  })

  it('executes detached original bytes when staging changes after its final check', async () => {
    const fixture = createCandidateExecutionFixture(true)
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    if (!fixture.candidateRoot) throw new Error('active fixture root is missing')
    fixture.ports.models.activateGrant = async () => {
      writeFileSync(join(fixture.candidateRoot as string, 'run.js'), 'concurrent-replacement\n')
      return { env: { MODEL_GATEWAY_TOKEN: 'protected' } }
    }
    const traceStore = new InMemoryTraceStore()
    const result = await executePreparedAgentCandidate(
      prepared,
      options(
        {
          execute: async (request) => {
            expect(
              Buffer.from(request.inputs.candidate?.files[0]?.bytes ?? []).toString('utf8'),
            ).toBe('#!/usr/bin/env node\n')
            const detached = request.inputs.candidate?.files[0]?.bytes
            detached?.fill(0)
            expect(
              Buffer.from(request.inputs.candidate?.files[0]?.bytes ?? []).toString('utf8'),
            ).toBe('#!/usr/bin/env node\n')
            await terminalTrace(request, traceStore)
            return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
          },
          stop: async () => ({ stopped: true }),
        },
        traceStore,
      ),
    )
    expect(result.succeeded).toBe(true)
  })

  it('withholds a receipt when process death has no captured task outcome', async () => {
    const fixture = createCandidateExecutionFixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    const result = await executePreparedAgentCandidate(prepared, {
      executor: {
        execute: async (request) => {
          await terminalTrace(request, traceStore)
          return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
        },
        stop: async () => ({ stopped: true }),
        capture: async () => ({}),
      },
      traceStore,
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
      ...createCandidateOutputFixture(),
    })
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/without a captured task outcome/),
      usage: { modelCalls: 0, costUsdNanos: 0 },
    })
  })

  it('rejects candidate-authored score fields in the final capture before grading', async () => {
    const fixture = createCandidateExecutionFixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    let graderCalls = 0
    const outputs = createCandidateOutputFixture()
    const result = await executePreparedAgentCandidate(prepared, {
      executor: {
        execute: async (request) => {
          await terminalTrace(request, traceStore)
          return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
        },
        stop: async () => ({ stopped: true }),
        capture: async () =>
          ({
            taskOutcome: unchangedTaskOutcomeCapture(fixture),
            score: 1,
          }) as never,
      },
      grader: {
        ...outputs.grader,
        run: async (input) => {
          graderCalls++
          return await outputs.grader.run(input)
        },
      },
      outputArtifacts: outputs.outputArtifacts,
      traceStore,
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
    })
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/unknown field score/),
      usage: { modelCalls: 0, costUsdNanos: 0 },
    })
    expect(graderCalls).toBe(0)
  })

  it('rejects candidate-authored score fields in the execution capture before grading', async () => {
    const fixture = createCandidateExecutionFixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    let graderCalls = 0
    const outputs = createCandidateOutputFixture()
    const result = await executePreparedAgentCandidate(prepared, {
      executor: {
        execute: async (request) => {
          await terminalTrace(request, traceStore)
          return {
            executionId: request.executionId,
            termination: { kind: 'exit', exitCode: 0 },
            score: 1,
          } as never
        },
        stop: async () => ({ stopped: true }),
        capture: async () => ({
          taskOutcome: unchangedTaskOutcomeCapture(fixture),
        }),
      },
      grader: {
        ...outputs.grader,
        run: async (input) => {
          graderCalls++
          return await outputs.grader.run(input)
        },
      },
      outputArtifacts: outputs.outputArtifacts,
      traceStore,
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
    })
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/unknown field score/),
      usage: { modelCalls: 0, costUsdNanos: 0 },
    })
    expect(graderCalls).toBe(0)
  })

  it('allows exactly one concurrent invocation of the same prepared value', async () => {
    const fixture = createCandidateExecutionFixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    const claimStore = new InMemoryAgentCandidateExecutionClaimStore()
    let executions = 0
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const didStart = new Promise<void>((resolve) => {
      started = resolve
    })
    const executor: TestExecutor = {
      execute: async (request) => {
        executions++
        started()
        await wait
        await terminalTrace(request, traceStore)
        return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
      },
      stop: async () => ({ stopped: true }),
    }
    const first = executePreparedAgentCandidate(prepared, options(executor, traceStore, claimStore))
    await didStart
    const second = await executePreparedAgentCandidate(
      prepared,
      options(executor, traceStore, claimStore),
    )
    release()
    const firstResult = await first
    expect(firstResult.succeeded).toBe(true)
    expect(second).toMatchObject({ succeeded: false, reason: expect.stringMatching(/already/) })
    expect(executions).toBe(1)
  })

  it('keeps independently prepared reservations isolated when one loses the durable claim', async () => {
    const fixture = createCandidateExecutionFixture()
    const openPreparations = new Set<string>()
    const closedPreparations = new Set<string>()
    let activePreparation: string | undefined
    fixture.ports.models.reserveGrant = async ({ preparationId, expiresAtMs, limits }) => {
      openPreparations.add(preparationId)
      return {
        preparationId,
        digest: candidateSha('c'),
        expiresAtMs,
        enforcedLimits: limits,
        network:
          limits.maxModelCalls === 0
            ? { mode: 'disabled' as const }
            : { mode: 'gateway-only' as const, domains: ['router.tangle.tools'] },
      }
    }
    fixture.ports.models.activateGrant = async ({ preparationId }) => {
      if (!openPreparations.has(preparationId) || closedPreparations.has(preparationId)) {
        throw new Error('activation used a closed preparation')
      }
      activePreparation = preparationId
      return { env: { MODEL_GATEWAY_TOKEN: `protected-${preparationId}` } }
    }
    fixture.ports.models.settleGrant = async ({ preparationId }) => {
      if (!openPreparations.has(preparationId)) throw new Error('unknown preparation')
      closedPreparations.add(preparationId)
      return {
        preparationId,
        grantDigest: candidateSha('c'),
        closed: true,
        calls: [],
      }
    }

    const verified = await verifyAgentCandidateBundle(fixture.bundle, fixture.ports)
    const firstPrepared = await prepareAgentCandidateExecution(
      verified,
      fixture.task,
      fixture.ports,
    )
    rmSync(fixture.task.stagingRoots.profileRoot, { recursive: true })
    mkdirSync(fixture.task.stagingRoots.profileRoot)
    const secondPrepared = await prepareAgentCandidateExecution(
      verified,
      fixture.task,
      fixture.ports,
    )
    expect(firstPrepared.trace.runId).not.toBe(secondPrepared.trace.runId)

    const traceStore = new InMemoryTraceStore()
    const claimStore = new InMemoryAgentCandidateExecutionClaimStore()
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const didStart = new Promise<void>((resolve) => {
      started = resolve
    })
    const executor: TestExecutor = {
      execute: async (request) => {
        started()
        await wait
        await terminalTrace(request, traceStore)
        return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
      },
      stop: async () => ({ stopped: true }),
    }

    const first = executePreparedAgentCandidate(
      firstPrepared,
      options(executor, traceStore, claimStore),
    )
    await didStart
    const loser = await executePreparedAgentCandidate(
      secondPrepared,
      options(executor, traceStore, claimStore),
    )
    expect(loser).toMatchObject({ succeeded: false, reason: expect.stringMatching(/claimed/) })
    expect(activePreparation).toBeDefined()
    expect(closedPreparations.has(activePreparation as string)).toBe(false)
    expect(closedPreparations.size).toBe(1)

    release()
    expect((await first).succeeded).toBe(true)
    expect(closedPreparations.size).toBe(2)
  })

  it('settles and records paid usage when the executor fails', async () => {
    const fixture = createCandidateExecutionFixture()
    const secret = 'sk-runtime-secret-123456789'
    let closed = false
    let settlementReads = 0
    const serveLateCall = () => {
      if (closed) throw new Error('grant is closed')
    }
    fixture.ports.models.activateGrant = async () => ({
      env: { MODEL_GATEWAY_TOKEN: secret },
    })
    fixture.ports.models.settleGrant = async ({ preparationId }) => {
      settlementReads++
      closed = true
      return {
        preparationId,
        grantDigest: candidateSha('c'),
        closed: true,
        calls: [
          {
            callId: 'call-paid-1',
            generationId: 'generation-paid-1',
            traceSpanId: 'generation-paid-1',
            status: 'failed',
            model: 'model-snapshot',
            startedAtMs: 100,
            endedAtMs: 150,
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            costUsdNanos: 10_000_000,
            costProvenance: 'observed',
          },
        ],
      }
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const result = await executePreparedAgentCandidate(
      prepared,
      options({
        execute: async () => Promise.reject(new Error(`container failed with ${secret}`)),
        stop: async () => ({ stopped: true }),
      }),
    )
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.not.stringContaining(secret),
      usage: { modelCalls: 1, inputTokens: 10, outputTokens: 5, costUsdNanos: 10_000_000 },
    })
    expect(result.reason).toContain('[redacted:candidate-access]')
    expect({ closed, settlementReads }).toEqual({ closed: true, settlementReads: 1 })
    expect(serveLateCall).toThrow(/closed/)
  })

  it('owns the deadline, aborts, waits for process death, and then settles', async () => {
    const fixture = createCandidateExecutionFixture()
    replaceCandidateFixtureTask(fixture, {
      limits: { ...fixture.task.task.limits, timeoutMs: 15 },
    })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    let observedSignal: AbortSignal | undefined
    let timeoutRequest: AgentCandidateExecutorRequest | undefined
    let stoppedAfterAbort = false
    let settledAfterStop = false
    fixture.ports.models.settleGrant = async ({ preparationId }) => {
      settledAfterStop = stoppedAfterAbort
      return { preparationId, grantDigest: candidateSha('c'), closed: true, calls: [] }
    }
    vi.useFakeTimers({ now: Date.now() })
    const startedAt = Date.now()
    let markExecutorStarted!: () => void
    const executorStarted = new Promise<void>((resolve) => {
      markExecutorStarted = resolve
    })
    const pending = executePreparedAgentCandidate(
      prepared,
      options(
        {
          execute: async (request, context) => {
            timeoutRequest = request
            observedSignal = context.signal
            markExecutorStarted()
            return await new Promise((_resolve, reject) => {
              context.signal.addEventListener('abort', () => reject(context.signal.reason), {
                once: true,
              })
            })
          },
          stop: async (_request, context) => {
            expect(context.reason).toBe('timeout')
            expect(context.signal).not.toBe(observedSignal)
            expect(context.signal.aborted).toBe(false)
            expect(context.deadlineAtMs).toBe(startedAt + 15 + 30_000)
            stoppedAfterAbort = observedSignal?.aborted === true
            if (!timeoutRequest) throw new Error('timeout executor never received its request')
            await terminalTrace(timeoutRequest, traceStore, 115)
            return { stopped: true }
          },
        },
        traceStore,
      ),
    )
    await executorStarted
    await vi.advanceTimersByTimeAsync(15)
    const result = await pending
    expect(Date.now()).toBe(startedAt + 15)
    expect({ stoppedAfterAbort, settledAfterStop }).toEqual({
      stoppedAfterAbort: true,
      settledAfterStop: true,
    })
    expect(result).toMatchObject({
      succeeded: true,
      receipt: { value: { termination: { kind: 'timeout', timeoutMs: 15 } } },
    })
  })

  it('cannot turn a stop acknowledgement after the frozen deadline into an exit success', async () => {
    const fixture = createCandidateExecutionFixture()
    replaceCandidateFixtureTask(fixture, {
      limits: { ...fixture.task.task.limits, timeoutMs: 15 },
    })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    vi.useFakeTimers({ now: Date.now() })
    let markStopStarted!: () => void
    const stopStarted = new Promise<void>((resolve) => {
      markStopStarted = resolve
    })
    const pending = executePreparedAgentCandidate(prepared, {
      ...options(
        {
          execute: async (request) => {
            await terminalTrace(request, traceStore, 105)
            return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
          },
          stop: async () => {
            markStopStarted()
            await new Promise((resolve) => setTimeout(resolve, 30))
            return { stopped: true }
          },
        },
        traceStore,
      ),
      cleanupTimeoutMs: 100,
    })
    await stopStarted
    await vi.advanceTimersByTimeAsync(30)
    const result = await pending
    expect(result).toMatchObject({
      succeeded: true,
      receipt: { value: { termination: { kind: 'timeout', timeoutMs: 15 } } },
    })
  })

  it('bounds a hanging process stop and leaves the claim for explicit recovery', async () => {
    const fixture = createCandidateExecutionFixture()
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    const claimStore = new InMemoryAgentCandidateExecutionClaimStore()
    const startedAt = Date.now()
    const result = await executePreparedAgentCandidate(prepared, {
      ...options(
        {
          execute: async (request) => {
            await terminalTrace(request, traceStore)
            return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
          },
          stop: async () => await new Promise<never>(() => undefined),
        },
        traceStore,
      ),
      cleanupTimeoutMs: 20,
    })
    expect(Date.now() - startedAt).toBeLessThan(250)
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/termination is not proven/),
      usage: { modelCalls: 0 },
    })
  })

  it('withholds a receipt but still revokes model access when process death is unproven', async () => {
    const fixture = createCandidateExecutionFixture()
    let settlements = 0
    let disposals = 0
    fixture.ports.models.settleGrant = async ({ preparationId }) => {
      settlements++
      return { preparationId, grantDigest: candidateSha('c'), closed: true, calls: [] }
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    const result = await executePreparedAgentCandidate(
      prepared,
      options(
        {
          execute: async (request) => {
            await terminalTrace(request, traceStore)
            return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
          },
          stop: async () => {
            throw new Error('container death not observed')
          },
          dispose: async () => {
            disposals++
            return { disposed: true }
          },
        },
        traceStore,
      ),
    )
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/death not observed/),
      usage: { modelCalls: 0 },
    })
    expect({ settlements, disposals }).toEqual({ settlements: 1, disposals: 1 })
  })

  it('leaves unknown settlement unfinished so a retry cannot guess zero spend', async () => {
    const claimStore = new InMemoryAgentCandidateExecutionClaimStore()
    const first = createCandidateExecutionFixture()
    replaceCandidateFixtureAttempt(first, {
      number: 1,
      maxAttempts: 2,
      retryPolicy: 'pre-model-infrastructure-only',
    })
    first.ports.models.settleGrant = async () => {
      throw new Error('gateway settlement unavailable')
    }
    const firstPrepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(first.bundle, first.ports),
      first.task,
      first.ports,
    )
    const firstResult = await executePreparedAgentCandidate(
      firstPrepared,
      options(
        {
          execute: async () => {
            throw new Error('infrastructure failed')
          },
          stop: async () => ({ stopped: true }),
        },
        new InMemoryTraceStore(),
        claimStore,
      ),
    )
    expect(firstResult).toMatchObject({ succeeded: false, usage: null })

    rmSync(first.task.stagingRoots.profileRoot, { recursive: true })
    mkdirSync(first.task.stagingRoots.profileRoot)
    replaceCandidateFixtureAttempt(first, {
      number: 2,
      maxAttempts: 2,
      retryPolicy: 'pre-model-infrastructure-only',
    })
    const retryPrepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(first.bundle, first.ports),
      first.task,
      first.ports,
    )
    let retryExecutions = 0
    const retryResult = await executePreparedAgentCandidate(
      retryPrepared,
      options(
        {
          execute: async () => {
            retryExecutions++
            throw new Error('retry must not execute')
          },
          stop: async () => ({ stopped: true }),
        },
        new InMemoryTraceStore(),
        claimStore,
      ),
    )
    expect(retryResult).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/prior-attempt-running/),
    })
    expect(retryExecutions).toBe(0)
  })

  it('admits a zero-call retry only for an explicit pre-model infrastructure failure', async () => {
    const fixture = createCandidateExecutionFixture()
    replaceCandidateFixtureAttempt(fixture, {
      number: 1,
      maxAttempts: 2,
      retryPolicy: 'pre-model-infrastructure-only',
    })
    const claimStore = new InMemoryAgentCandidateExecutionClaimStore()
    let activations = 0
    fixture.ports.models.activateGrant = async () => {
      activations++
      if (activations === 1) throw new Error('model gateway unavailable before launch')
      return { env: { MODEL_GATEWAY_TOKEN: 'protected' } }
    }
    const firstPrepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const firstTraceStore = new InMemoryTraceStore()
    const first = await executePreparedAgentCandidate(
      firstPrepared,
      options(
        {
          execute: async () => {
            throw new Error('executor must not run before model activation')
          },
          stop: async () => ({ stopped: true }),
        },
        firstTraceStore,
        claimStore,
      ),
    )
    expect(first).toMatchObject({ succeeded: false, usage: { modelCalls: 0 } })

    rmSync(fixture.task.stagingRoots.profileRoot, { recursive: true })
    mkdirSync(fixture.task.stagingRoots.profileRoot)
    replaceCandidateFixtureAttempt(fixture, {
      number: 2,
      maxAttempts: 2,
      retryPolicy: 'pre-model-infrastructure-only',
    })
    const retryPrepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    const retry = await executePreparedAgentCandidate(
      retryPrepared,
      options(
        {
          execute: async (request) => {
            await terminalTrace(request, traceStore)
            return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
          },
          stop: async () => ({ stopped: true }),
        },
        traceStore,
        claimStore,
      ),
    )
    expect(retry.succeeded).toBe(true)
  })

  it('closes isolated memory and persists a large after-state archive by reference', async () => {
    const fixture = createCandidateExecutionFixture()
    bindCandidateFixtureBundle(
      fixture,
      redigestCandidateBundle(fixture.bundle, {
        memory: { mode: 'isolated', scope: 'task' },
      }),
    )
    const before = emptyCandidateSnapshot('before')
    const after = emptyCandidateSnapshot('after')
    const order: string[] = []
    fixture.ports.memory.reset = async ({ preparationId, expiresAtMs }) => ({
      preparationId,
      accessDigest: candidateSha('8'),
      expiresAtMs,
      evidence: before.manifest,
      emptyStateDigest: before.digest,
      beforeState: before,
    })
    fixture.ports.memory.activate = async ({ effectiveNamespace }) => ({
      env: { TANGLE_MEMORY_NAMESPACE: effectiveNamespace },
    })
    fixture.ports.memory.close = async () => {
      order.push('memory-close')
      return { closed: true }
    }
    fixture.ports.models.settleGrant = async ({ preparationId }) => {
      order.push('model-settle')
      return { preparationId, grantDigest: candidateSha('c'), closed: true, calls: [] }
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    if (prepared.memory.mode !== 'isolated') throw new Error('isolated memory was not prepared')
    const traceStore = new InMemoryTraceStore()
    const largeMemoryArchive = Buffer.alloc(4_000_001, 0x5a)
    const result = await executePreparedAgentCandidate(
      prepared,
      options(
        {
          execute: async (request) => {
            expect(request.launch.env.TANGLE_MEMORY_NAMESPACE).toBe(
              prepared.memory.effectiveNamespace,
            )
            await terminalTrace(request, traceStore)
            return {
              executionId: request.executionId,
              termination: { kind: 'exit', exitCode: 0 },
            }
          },
          stop: async () => {
            order.push('process-stop')
            return { stopped: true }
          },
          capture: async () => {
            return {
              memoryAfter: {
                afterState: after.material,
                archive: largeMemoryArchive,
              },
            }
          },
        },
        traceStore,
      ),
    )
    expect(result.succeeded).toBe(true)
    expect(order).toEqual(['process-stop', 'memory-close', 'model-settle'])
    if (!result.succeeded || result.receipt.value.memory.mode !== 'isolated') return
    const archive = result.receipt.value.memory.afterState.archive
    expect(archive).toMatchObject({
      byteLength: largeMemoryArchive.byteLength,
      sha256: sha256Bytes(largeMemoryArchive),
      locator: { kind: 's3' },
    })
    expect('content' in archive).toBe(false)
  })

  it('rejects a compressed protected value in isolated memory before persisting memory evidence', async () => {
    const fixture = createCandidateExecutionFixture()
    bindCandidateFixtureBundle(
      fixture,
      redigestCandidateBundle(fixture.bundle, {
        memory: { mode: 'isolated', scope: 'task' },
      }),
    )
    const before = emptyCandidateSnapshot('secret-memory-before')
    fixture.ports.memory.reset = async ({ preparationId, expiresAtMs }) => ({
      preparationId,
      accessDigest: candidateSha('8'),
      expiresAtMs,
      evidence: before.manifest,
      emptyStateDigest: before.digest,
      beforeState: before,
    })
    fixture.ports.memory.activate = async () => ({ env: { TANGLE_MEMORY_ACCESS: 'memory-access' } })
    fixture.ports.memory.close = async () => ({ closed: true })
    const secret = 'sk-memory-secret-123456789'
    fixture.ports.models.activateGrant = async () => ({ env: { MODEL_GATEWAY_TOKEN: secret } })
    const originalMaterialize = fixture.ports.workspaces.materialize
    fixture.ports.workspaces.materialize = async (input) => {
      if (input.role !== 'memory') return await originalMaterialize(input)
      const output = join(input.destination, 'notes.txt')
      writeFileSync(output, Buffer.from(secret, 'utf8'))
      chmodSync(output, 0o644)
    }
    const memoryBytes = Buffer.from(secret, 'utf8')
    const afterState = {
      kind: 'agent-candidate-workspace-manifest' as const,
      files: [
        {
          path: 'notes.txt',
          mode: 0o644 as const,
          sha256: sha256Bytes(memoryBytes),
          byteLength: memoryBytes.byteLength,
        },
      ],
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    const outputs = createCandidateOutputFixture()
    const purposes: string[] = []
    const result = await executePreparedAgentCandidate(prepared, {
      executor: {
        execute: async (request) => {
          await terminalTrace(request, traceStore)
          return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
        },
        stop: async () => ({ stopped: true }),
        capture: async () => ({
          taskOutcome: unchangedTaskOutcomeCapture(fixture),
          memoryAfter: { afterState, archive: gzipSync(memoryBytes) },
        }),
      },
      grader: outputs.grader,
      outputArtifacts: {
        read: outputs.outputArtifacts.read,
        put: async (input) => {
          purposes.push(input.purpose)
          return await outputs.outputArtifacts.put(input)
        },
      },
      traceStore,
      claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
    })

    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/protected value/),
    })
    expect(purposes).not.toContain('memory-after-manifest')
    expect(purposes).not.toContain('memory-after-archive')
  })

  it('redacts protected values from spans, events, artifacts, and receipt bytes', async () => {
    const fixture = createCandidateExecutionFixture()
    const secret = 'sk-redaction-proof-123456789'
    fixture.ports.models.activateGrant = async () => ({
      env: { MODEL_GATEWAY_TOKEN: secret },
    })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const traceStore = new InMemoryTraceStore()
    const executionOptions = options(
      {
        execute: async (request, context) => {
          await terminalTrace(request, context.traceStore)
          await context.traceStore.appendSpan({
            runId: request.trace.runId,
            spanId: 'tool-secret',
            kind: 'tool',
            name: 'tool',
            toolName: 'exec',
            args: {
              token: secret,
              [secret]: Buffer.from(secret, 'utf8').toString('base64url'),
            },
            result: secret,
            startedAt: 110,
            endedAt: 120,
            status: 'ok',
          })
          await context.traceStore.appendEvent({
            runId: request.trace.runId,
            eventId: 'event-secret',
            kind: 'log',
            timestamp: 130,
            payload: { message: secret },
          })
          await context.traceStore.appendArtifact({
            runId: request.trace.runId,
            artifactId: 'artifact-secret',
            contentType: 'text/plain',
            sizeBytes: secret.length,
            hash: '0'.repeat(64),
            inlineContent: secret,
          })
          return { executionId: request.executionId, termination: { kind: 'exit', exitCode: 0 } }
        },
        stop: async () => ({ stopped: true }),
      },
      traceStore,
    )
    const result = await executePreparedAgentCandidate(prepared, executionOptions)
    if (!result.succeeded) throw new Error(result.reason)
    const traceJson = Buffer.from(
      await executionOptions.outputArtifacts.read(result.receipt.value.trace.artifact),
    ).toString('utf8')
    expect(traceJson).not.toContain(secret)
    expect(traceJson).not.toContain(Buffer.from(secret, 'utf8').toString('base64url'))
    expect(traceJson).toContain('[redacted:candidate-access]')
    expect(Buffer.from(result.receipt.bytes).toString('utf8')).not.toContain(secret)
    expect(
      JSON.stringify({
        spans: await traceStore.spans({ runId: prepared.trace.runId }),
        events: await traceStore.events({ runId: prepared.trace.runId }),
        artifacts: await traceStore.artifacts(prepared.trace.runId),
      }),
    ).not.toContain(secret)
  })

  it('rejects protected environment collisions before executor access', async () => {
    const fixture = createCandidateExecutionFixture()
    bindCandidateFixtureBundle(
      fixture,
      candidateBundle({
        env: {
          PATH: { kind: 'public', value: '/usr/local/bin:/usr/bin:/bin' },
          PUBLIC_MODE: { kind: 'public', value: 'fixture' },
        },
      }),
    )
    fixture.ports.models.activateGrant = async () => ({ env: { PUBLIC_MODE: 'secret-value' } })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    let executions = 0
    const result = await executePreparedAgentCandidate(
      prepared,
      options({
        execute: async () => {
          executions++
          throw new Error('must not execute')
        },
        stop: async () => ({ stopped: true }),
      }),
    )
    expect(result).toMatchObject({ succeeded: false, reason: expect.stringMatching(/collides/) })
    expect(executions).toBe(0)
  })
})
