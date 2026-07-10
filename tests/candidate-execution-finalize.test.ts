import { InMemoryTraceStore } from '@tangle-network/agent-eval'
import type { AgentCandidateBundle, Sha256Digest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'

import { finalizeAgentCandidateRun } from '../src/candidate-execution/finalize'
import { recordPreparedCandidateState } from '../src/candidate-execution/prepared-state'
import {
  CANDIDATE_TRACE_TAGS,
  type PreparedAgentCandidateExecution,
  preparedCandidateBrand,
} from '../src/candidate-execution/types'

const sha = (character: string): Sha256Digest => `sha256:${character.repeat(64)}`

function prepared(
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
): PreparedAgentCandidateExecution {
  const executionId = 'execution-1'
  const bundleDigest = sha('1')
  const executionPlanDigest = sha('2')
  const materializationDigest = sha('3')
  const tags = {
    [CANDIDATE_TRACE_TAGS.executionId]: executionId,
    [CANDIDATE_TRACE_TAGS.bundleDigest]: bundleDigest,
    [CANDIDATE_TRACE_TAGS.executionPlanDigest]: executionPlanDigest,
    [CANDIDATE_TRACE_TAGS.materializationReceiptDigest]: materializationDigest,
  }
  const value = {
    bundle: { digest: bundleDigest } as AgentCandidateBundle,
    executionId,
    roots: {
      execution: { taskRoot: '/task' },
      staging: { taskRoot: '/host/task', profileRoot: '/host/profile' },
    },
    profilePlan: { value: {}, bytes: new Uint8Array(), written: [] },
    executionPlan: {
      value: { digest: executionPlanDigest, material: { limits } },
      bytes: new Uint8Array(),
    },
    materializationReceipt: {
      value: {},
      bytes: new Uint8Array(),
      digest: materializationDigest,
    },
    launch: { executable: 'node', args: [], env: {}, flags: [], cwd: '/task' },
    instruction: { bytes: Buffer.from('fix the bug'), delivery: { kind: 'stdin-utf8' } },
    resolvedModel: {
      requested: 'provider/model',
      provider: 'provider',
      model: 'model-snapshot',
      snapshot: 'model-snapshot-2026-07-01',
      reasoningEffort: 'high',
    },
    protectedModelAccess: { digest: sha('4'), env: {} },
    trace: { runId: executionId, tags, env: {} },
    memory: { mode: 'disabled' },
    [preparedCandidateBrand]: true,
  } as unknown as PreparedAgentCandidateExecution
  recordPreparedCandidateState(value, {
    ports: {
      artifacts: { read: async () => new Uint8Array() },
    } as never,
  })
  return value
}

async function traceStore(
  execution: PreparedAgentCandidateExecution,
  overrides: {
    tags?: Record<string, string>
    model?: string
    omitUsage?: boolean
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
    ...(overrides.omitUsage
      ? {}
      : { inputTokens: 10, outputTokens: 5, cachedTokens: 2, costUsd: 0.01 }),
  })
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
  it('derives exact usage and an embedded trace from tied agent-eval spans', async () => {
    const execution = prepared()
    const store = await traceStore(execution)
    const result = await finalizeAgentCandidateRun(
      execution,
      { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
      store,
    )
    expect(result.succeeded).toBe(true)
    if (!result.succeeded) return
    expect(result.receipt.value.usage).toEqual({
      costUsd: 0.01,
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 2,
      modelCalls: 1,
    })
    expect(result.receipt.value.trace).toMatchObject({ eventCount: 3, modelCallCount: 1 })
    expect(result.receipt.bytes.byteLength).toBeGreaterThan(0)
  })

  it('returns invalid capture instead of minting zero usage when provider usage is missing', async () => {
    const execution = prepared()
    const result = await finalizeAgentCandidateRun(
      execution,
      { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
      await traceStore(execution, { omitUsage: true }),
    )
    expect(result).toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/missing protected/),
    })
  })

  it('rejects trace-binding and resolved-model drift', async () => {
    const execution = prepared()
    const badTags = { ...execution.trace.tags, [CANDIDATE_TRACE_TAGS.bundleDigest]: sha('9') }
    await expect(
      finalizeAgentCandidateRun(
        execution,
        { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
        await traceStore(execution, { tags: badTags }),
      ),
    ).resolves.toMatchObject({ succeeded: false, reason: expect.stringMatching(/not bound/) })
    await expect(
      finalizeAgentCandidateRun(
        execution,
        { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
        await traceStore(execution, { model: 'other-model' }),
      ),
    ).resolves.toMatchObject({ succeeded: false, reason: expect.stringMatching(/does not match/) })
  })

  it('enforces tool-step and wall-time limits from protected spans', async () => {
    const execution = prepared()
    await expect(
      finalizeAgentCandidateRun(
        execution,
        { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
        await traceStore(execution, { toolSteps: 3 }),
      ),
    ).resolves.toMatchObject({ succeeded: false, reason: expect.stringMatching(/tool steps/) })
    await expect(
      finalizeAgentCandidateRun(
        execution,
        { executionId: execution.executionId, termination: { kind: 'exit', exitCode: 0 } },
        await traceStore(execution, { endedAt: 1_101 }),
      ),
    ).resolves.toMatchObject({ succeeded: false, reason: expect.stringMatching(/wall time/) })
  })

  it('preserves timeout usage but requires the exact frozen timeout', async () => {
    const execution = prepared()
    const store = await traceStore(execution)
    const valid = await finalizeAgentCandidateRun(
      execution,
      { executionId: execution.executionId, termination: { kind: 'timeout', timeoutMs: 1_000 } },
      store,
    )
    expect(valid.succeeded).toBe(true)
    await expect(
      finalizeAgentCandidateRun(
        execution,
        { executionId: execution.executionId, termination: { kind: 'timeout', timeoutMs: 999 } },
        store,
      ),
    ).resolves.toMatchObject({ succeeded: false, reason: expect.stringMatching(/frozen/) })
  })
})
