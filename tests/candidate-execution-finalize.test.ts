import { InMemoryTraceStore } from '@tangle-network/agent-eval'
import { afterEach, describe, expect, it } from 'vitest'
import { sealAgentCandidateExecutorFinalCapture } from '../src/candidate-execution/executor-capture'
import { finalizeAgentCandidateRun } from '../src/candidate-execution/finalize'
import {
  type SealedAgentCandidateModelSettlement,
  sealAgentCandidateModelSettlement,
} from '../src/candidate-execution/model-settlement'
import {
  persistCandidateBenchmarkResult,
  persistCandidateModelSettlement,
  persistVerifiedAgentCandidateExecutorCapture,
} from '../src/candidate-execution/outcome-evidence'
import { prepareAgentCandidateExecution } from '../src/candidate-execution/prepare'
import { assertPreparedCandidateIntegrity } from '../src/candidate-execution/prepared-state'
import {
  CANDIDATE_TRACE_TAGS,
  type PreparedAgentCandidateExecution,
} from '../src/candidate-execution/types'
import { verifyAgentCandidateBundle } from '../src/candidate-execution/verify'
import {
  candidateSha,
  cleanupCandidateFixtures,
  createCandidateExecutionFixture,
  createCandidateOutputFixture,
  replaceCandidateFixtureTask,
} from './helpers/candidate-execution-fixture'

afterEach(cleanupCandidateFixtures)

async function prepared(
  limits: {
    timeoutMs: number
    maxSteps: number
    maxModelCalls: number
    maxInputTokens: number
    maxOutputTokens: number
    maxCostUsd: number
  } = {
    timeoutMs: 1_000,
    maxSteps: 2,
    maxModelCalls: 1,
    maxInputTokens: 20,
    maxOutputTokens: 10,
    maxCostUsd: 0.1,
  },
): Promise<PreparedAgentCandidateExecution> {
  const fixture = createCandidateExecutionFixture()
  replaceCandidateFixtureTask(fixture, { limits })
  return await prepareAgentCandidateExecution(
    await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
    fixture.task,
    fixture.ports,
  )
}

async function finalizePrepared(
  execution: PreparedAgentCandidateExecution,
  capture: Parameters<typeof finalizeAgentCandidateRun>[1],
  store: InMemoryTraceStore,
  overrides: {
    settlement?: SealedAgentCandidateModelSettlement
    outputs?: ReturnType<typeof createCandidateOutputFixture>
  } = {},
) {
  const state = assertPreparedCandidateIntegrity(execution)
  const settlement =
    overrides.settlement ??
    sealAgentCandidateModelSettlement(
      {
        preparationId: state.preparationId,
        grantDigest: candidateSha('c'),
        closed: true,
        calls: [
          {
            callId: 'call-1',
            generationId: 'llm-1',
            traceSpanId: 'llm-1',
            status: 'succeeded',
            model: execution.resolvedModel.model,
            startedAtMs: 120,
            endedAtMs: 200,
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 2,
            reasoningTokens: 0,
            costUsdNanos: 10_000_000,
          },
        ],
      },
      {
        preparationId: state.preparationId,
        grantDigest: candidateSha('c'),
        model: execution.resolvedModel.model,
      },
    )
  const outputs = overrides.outputs ?? createCandidateOutputFixture()
  const expectedOutcome = state.benchmarkTask.outcome
  if (expectedOutcome.kind !== 'workspace') {
    throw new Error('finalization fixture requires a workspace outcome')
  }
  const repository = state.benchmarkTask.repository
  if (!repository) throw new Error('finalization fixture requires repository identity')
  const finalCapture = sealAgentCandidateExecutorFinalCapture(
    {
      taskOutcome: {
        kind: 'workspace' as const,
        resultTree: repository.baseTree,
        afterState: state.benchmarkTask.workspace.material,
        archive: Buffer.from('fixture unchanged task archive', 'utf8'),
        gitDiff: Buffer.alloc(0),
      },
    },
    expectedOutcome,
  )
  const [modelSettlement, verifiedCapture] = await Promise.all([
    persistCandidateModelSettlement(state, settlement, outputs.outputArtifacts),
    persistVerifiedAgentCandidateExecutorCapture(state, finalCapture, outputs.outputArtifacts, []),
  ])
  const { persistedCapture, taskOutcome } = verifiedCapture
  const benchmarkResult = await persistCandidateBenchmarkResult(
    state,
    capture.termination,
    taskOutcome,
    outputs.grader,
    outputs.outputArtifacts,
    [],
  )
  return await finalizeAgentCandidateRun(
    state,
    capture,
    store,
    execution.trace,
    settlement,
    {
      finalCapture,
      persistedCapture,
      modelSettlement,
      taskOutcome,
      benchmarkResult,
      outputArtifacts: outputs.outputArtifacts,
    },
    [],
  )
}

async function traceStore(
  execution: PreparedAgentCandidateExecution,
  overrides: {
    tags?: Record<string, string>
    model?: string
    omitUsage?: boolean
    omitModelSpan?: boolean
    toolSteps?: number
    endedAt?: number
  } = {},
): Promise<InMemoryTraceStore> {
  const store = new InMemoryTraceStore()
  await store.appendRun({
    runId: execution.trace.runId,
    scenarioId: 'task',
    startedAt: 100,
    endedAt: overrides.endedAt ?? 500,
    status: 'completed',
    tags: overrides.tags ?? execution.trace.tags,
  })
  if (!overrides.omitModelSpan) {
    await store.appendSpan({
      runId: execution.trace.runId,
      spanId: 'llm-1',
      kind: 'llm',
      name: 'model call',
      model: overrides.model ?? execution.resolvedModel.model,
      messages: [],
      startedAt: 120,
      endedAt: 200,
      status: 'ok',
      attributes: {
        'tangle.protected_model.source': 'router-settlement',
        'tangle.router.call_id': 'call-1',
        'tangle.router.generation_id': 'llm-1',
      },
      ...(overrides.omitUsage
        ? {}
        : { inputTokens: 10, outputTokens: 5, cachedTokens: 2, costUsd: 0.01 }),
    })
  }
  for (let index = 0; index < (overrides.toolSteps ?? 1); index++) {
    await store.appendSpan({
      runId: execution.trace.runId,
      spanId: `tool-${index}`,
      kind: 'tool',
      name: 'tool',
      toolName: 'exec',
      args: {},
      startedAt: 210 + index,
      endedAt: 220 + index,
      status: 'ok',
    })
  }
  return store
}

describe('protected candidate run finalization', () => {
  it('derives exact evidence and durable trace bytes from tied agent-eval spans', async () => {
    const execution = await prepared()
    const store = await traceStore(execution)
    const outputs = createCandidateOutputFixture()
    const result = await finalizePrepared(
      execution,
      { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
      store,
      { outputs },
    )
    expect(result.succeeded).toBe(true)
    if (!result.succeeded) return
    expect(result.receipt.value.trace).toMatchObject({ eventCount: 3, modelCallCount: 1 })
    expect(result.receipt.bytes.byteLength).toBeGreaterThan(0)
    const task = assertPreparedCandidateIntegrity(execution).benchmarkTask
    if (task.outcome.kind !== 'workspace') throw new Error('expected workspace task outcome')
    if (!task.repository) throw new Error('expected task repository identity')
    expect(result.receipt.value).toMatchObject({
      taskOutcome: {
        artifact: result.artifacts.taskOutcome,
        material: {
          executionPlanDigest: execution.executionPlan.value.digest,
          outcome: {
            kind: 'workspace',
            baseRepository: {
              identity: task.repository.identity,
              rootIdentity: task.repository.rootIdentity,
              commit: task.repository.baseCommit,
              tree: task.repository.baseTree,
            },
            resultRepository: {
              identity: task.repository.identity,
              rootIdentity: task.repository.rootIdentity,
              commit: expect.stringMatching(/^[0-9a-f]{40}$/),
              tree: task.repository.baseTree,
            },
          },
        },
      },
      benchmarkResult: {
        artifact: result.artifacts.benchmarkResult,
        material: {
          taskOutcomeDigest: result.receipt.value.taskOutcome.digest,
          score: 1,
          passed: true,
        },
      },
      modelSettlement: {
        artifact: result.artifacts.modelSettlement,
        material: {
          executionPlanDigest: execution.executionPlan.value.digest,
          closed: true,
          usage: {
            costUsdNanos: 10_000_000,
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 2,
            reasoningTokens: 0,
            modelCalls: 1,
          },
        },
      },
    })
    const taskOutcome = result.receipt.value.taskOutcome.material.outcome
    if (taskOutcome.kind !== 'workspace') throw new Error('expected workspace task outcome')
    await Promise.all([
      expect(outputs.outputArtifacts.read(result.artifacts.runReceipt)).resolves.toEqual(
        result.receipt.bytes,
      ),
      expect(
        outputs.outputArtifacts.read(
          result.receipt.value.taskOutcome.material.outcome.kind === 'workspace'
            ? result.receipt.value.taskOutcome.material.outcome.gitDiff.artifact
            : result.receipt.value.taskOutcome.material.outcome.artifact,
        ),
      ).resolves.toEqual(new Uint8Array()),
      expect(
        outputs.outputArtifacts.read(result.receipt.value.benchmarkResult.material.evidence),
      ).resolves.toEqual(Uint8Array.from(Buffer.from('{"reward":1}\n', 'utf8'))),
      expect(
        outputs.outputArtifacts.read(result.receipt.value.benchmarkResult.material.grader.artifact),
      ).resolves.toEqual(Uint8Array.from(Buffer.from('fixture executable grader', 'utf8'))),
    ])
    const executorCapture = JSON.parse(
      Buffer.from(await outputs.outputArtifacts.read(result.artifacts.executorCapture)).toString(
        'utf8',
      ),
    )
    expect(executorCapture).toMatchObject({
      kind: 'agent-candidate-executor-capture',
      executionPlanDigest: execution.executionPlan.value.digest,
      taskOutcome: {
        kind: 'workspace',
        gitDiff: taskOutcome.gitDiff.artifact,
      },
    })
    expect(JSON.stringify(executorCapture)).not.toContain('content')
  })

  it('returns invalid capture instead of minting zero usage when provider usage is missing', async () => {
    const execution = await prepared()
    const result = await finalizePrepared(
      execution,
      { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
      await traceStore(execution, { omitUsage: true }),
    )
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/model ledger/),
    })
  })

  it('rejects a dropped model span against the protected gateway ledger', async () => {
    const execution = await prepared()
    const result = await finalizePrepared(
      execution,
      { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
      await traceStore(execution, { omitModelSpan: true }),
    )
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/model ledger/),
    })
  })

  it('rejects trace-binding and resolved-model drift', async () => {
    const execution = await prepared()
    const badTags = {
      ...execution.trace.tags,
      [CANDIDATE_TRACE_TAGS.bundleDigest]: candidateSha('9'),
    }
    await expect(
      finalizePrepared(
        execution,
        { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
        await traceStore(execution, { tags: badTags }),
      ),
    ).resolves.toMatchObject({ succeeded: false, reason: expect.stringMatching(/not bound/) })
    await expect(
      finalizePrepared(
        execution,
        { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
        await traceStore(execution, { model: 'other-model' }),
      ),
    ).resolves.toMatchObject({ succeeded: false, reason: expect.stringMatching(/does not match/) })
  })

  it('enforces tool-step and wall-time limits from protected spans', async () => {
    const execution = await prepared()
    await expect(
      finalizePrepared(
        execution,
        { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
        await traceStore(execution, { toolSteps: 3 }),
      ),
    ).resolves.toMatchObject({ succeeded: false, reason: expect.stringMatching(/tool steps/) })
    await expect(
      finalizePrepared(
        execution,
        { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
        await traceStore(execution, { endedAt: 1_101 }),
      ),
    ).resolves.toMatchObject({ succeeded: false, reason: expect.stringMatching(/wall time/) })
  })

  it('preserves timeout usage but requires the exact frozen timeout', async () => {
    const execution = await prepared()
    const store = await traceStore(execution)
    const valid = await finalizePrepared(
      execution,
      { executionId: execution.executionId, termination: { kind: 'timeout', timeoutMs: 1_000 } },
      store,
    )
    expect(valid.succeeded).toBe(true)
    await expect(
      finalizePrepared(
        execution,
        { executionId: execution.executionId, termination: { kind: 'timeout', timeoutMs: 999 } },
        store,
      ),
    ).resolves.toMatchObject({ succeeded: false, reason: expect.stringMatching(/frozen/) })
  })

  it('reconciles decimal costs in fixed-point units', async () => {
    const execution = await prepared({
      timeoutMs: 1_000,
      maxSteps: 2,
      maxModelCalls: 2,
      maxInputTokens: 20,
      maxOutputTokens: 10,
      maxCostUsd: 0.3,
    })
    const store = new InMemoryTraceStore()
    await store.appendRun({
      runId: execution.trace.runId,
      scenarioId: 'decimal-cost',
      startedAt: 100,
      endedAt: 500,
      status: 'completed',
      tags: execution.trace.tags,
    })
    for (const [index, costUsd] of [0.1, 0.2].entries()) {
      await store.appendSpan({
        runId: execution.trace.runId,
        spanId: `llm-${index + 1}`,
        kind: 'llm',
        name: 'model call',
        model: execution.resolvedModel.model,
        messages: [],
        inputTokens: 5,
        outputTokens: 2,
        costUsd,
        startedAt: 120 + index * 100,
        endedAt: 180 + index * 100,
        status: 'ok',
        attributes: {
          'tangle.protected_model.source': 'router-settlement',
          'tangle.router.call_id': `call-${index + 1}`,
          'tangle.router.generation_id': `llm-${index + 1}`,
        },
      })
    }
    const settlement = sealAgentCandidateModelSettlement(
      {
        preparationId: assertPreparedCandidateIntegrity(execution).preparationId,
        grantDigest: candidateSha('c'),
        closed: true,
        calls: [
          {
            callId: 'call-1',
            generationId: 'llm-1',
            traceSpanId: 'llm-1',
            status: 'succeeded',
            model: execution.resolvedModel.model,
            startedAtMs: 120,
            endedAtMs: 180,
            inputTokens: 5,
            outputTokens: 2,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            costUsdNanos: 100_000_000,
          },
          {
            callId: 'call-2',
            generationId: 'llm-2',
            traceSpanId: 'llm-2',
            status: 'succeeded',
            model: execution.resolvedModel.model,
            startedAtMs: 220,
            endedAtMs: 280,
            inputTokens: 5,
            outputTokens: 2,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            costUsdNanos: 200_000_000,
          },
        ],
      },
      {
        preparationId: assertPreparedCandidateIntegrity(execution).preparationId,
        grantDigest: candidateSha('c'),
        model: execution.resolvedModel.model,
      },
    )
    const result = await finalizePrepared(
      execution,
      { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
      store,
      { settlement },
    )
    expect(result).toMatchObject({
      succeeded: true,
      receipt: {
        value: {
          modelSettlement: {
            material: { usage: { costUsdNanos: 300_000_000, modelCalls: 2 } },
          },
        },
      },
    })
  })
})
