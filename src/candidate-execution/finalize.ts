import type { LlmSpan, Span, TraceStore } from '@tangle-network/agent-eval'
import { isLlmSpan } from '@tangle-network/agent-eval'
import type {
  AgentCandidateMemoryReceipt,
  AgentCandidateRunReceipt,
  AgentCandidateSpend,
} from '@tangle-network/agent-interface'
import {
  agentCandidateRunReceiptSchema,
  agentCandidateTerminationSchema,
} from '@tangle-network/agent-interface'

import { verifyWorkspaceSnapshotArtifacts } from './artifacts'
import {
  canonicalCandidateBytes,
  canonicalCandidateDocument,
  embeddedCandidateArtifact,
} from './digest'
import { getPreparedCandidateState } from './prepared-state'
import {
  type AgentCandidateProtectedRunCapture,
  type AgentCandidateRunFinalization,
  CANDIDATE_TRACE_TAGS,
  type PreparedAgentCandidateExecution,
  preparedCandidateBrand,
} from './types'

/** Builds a candidate run receipt exclusively from protected trace and memory evidence. */
export async function finalizeAgentCandidateRun(
  prepared: PreparedAgentCandidateExecution,
  capture: AgentCandidateProtectedRunCapture,
  traceStore: TraceStore,
): Promise<AgentCandidateRunFinalization> {
  const partial: AgentCandidateRunFinalization & { succeeded: false } = {
    succeeded: false,
    reason: 'protected run evidence was not captured',
    partial: {
      executionId: prepared.executionId,
      bundleDigest: prepared.bundle.digest,
      executionPlanDigest: prepared.executionPlan.value.digest,
      materializationReceiptDigest: prepared.materializationReceipt.digest,
    },
  }
  try {
    if (prepared[preparedCandidateBrand] !== true) {
      throw new Error('execution must come from prepareAgentCandidateExecution')
    }
    if (capture.executionId !== prepared.executionId) {
      throw new Error('protected capture execution id does not match the prepared execution')
    }
    const termination = agentCandidateTerminationSchema.parse(capture.termination)
    partial.partial.termination = termination
    if (
      termination.kind === 'timeout' &&
      termination.timeoutMs !== prepared.executionPlan.value.material.limits.timeoutMs
    ) {
      throw new Error('timeout termination does not match the frozen execution limit')
    }

    const run = await traceStore.getRun(prepared.trace.runId)
    if (!run) throw new Error(`protected trace run is missing: ${prepared.trace.runId}`)
    if (run.status === 'running' || run.endedAt === undefined) {
      throw new Error('protected trace run is not terminal')
    }
    assertTraceBindings(run.tags, prepared)

    const [spans, events, budget, artifacts] = await Promise.all([
      traceStore.spans({ runId: run.runId }),
      traceStore.events({ runId: run.runId }),
      traceStore.budget(run.runId),
      traceStore.artifacts(run.runId),
    ])
    const orderedSpans = [...spans].sort(
      (a, b) => a.startedAt - b.startedAt || compareStrings(a.spanId, b.spanId),
    )
    const orderedEvents = [...events].sort(
      (a, b) => a.timestamp - b.timestamp || compareStrings(a.eventId, b.eventId),
    )
    const orderedBudget = [...budget].sort(
      (a, b) => a.timestamp - b.timestamp || compareStrings(a.dimension, b.dimension),
    )
    const orderedArtifacts = [...artifacts].sort((a, b) =>
      compareStrings(a.artifactId, b.artifactId),
    )

    const modelSpans = orderedSpans.filter(isLlmSpan)
    const usage = protectedUsage(modelSpans, prepared.resolvedModel.model)
    enforceLimits(prepared, run.startedAt, run.endedAt, orderedSpans, usage)
    const memory = await memoryReceipt(prepared, capture)

    const traceBytes = canonicalCandidateBytes({
      schemaVersion: 1,
      run,
      spans: orderedSpans,
      events: orderedEvents,
      budget: orderedBudget,
      artifacts: orderedArtifacts,
    })
    const trace = {
      schemaVersion: 1 as const,
      artifact: embeddedCandidateArtifact(traceBytes),
      eventCount:
        1 +
        orderedSpans.length +
        orderedEvents.length +
        orderedBudget.length +
        orderedArtifacts.length,
      modelCallCount: modelSpans.length,
    }
    const document = canonicalCandidateDocument<AgentCandidateRunReceipt>({
      schemaVersion: 1,
      kind: 'agent-candidate-run',
      digestAlgorithm: 'rfc8785-sha256',
      bundleDigest: prepared.bundle.digest,
      materializationReceiptDigest: prepared.materializationReceipt.digest,
      executionPlanDigest: prepared.executionPlan.value.digest,
      memory,
      usage,
      modelUsage: { resolved: prepared.resolvedModel, usage },
      trace,
      termination,
    })
    agentCandidateRunReceiptSchema.parse(document.value)
    return { succeeded: true, receipt: document }
  } catch (error) {
    return {
      ...partial,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function assertTraceBindings(
  tags: Record<string, string> | undefined,
  prepared: PreparedAgentCandidateExecution,
): void {
  const expected = prepared.trace.tags
  for (const name of Object.values(CANDIDATE_TRACE_TAGS)) {
    if (tags?.[name] !== expected[name]) {
      throw new Error(`protected trace is not bound to prepared execution tag ${name}`)
    }
  }
}

function protectedUsage(spans: LlmSpan[], expectedModel: string): AgentCandidateSpend {
  let costUsd = 0
  let inputTokens = 0
  let outputTokens = 0
  let cachedInputTokens = 0
  let hasCachedUsage = false
  for (const span of spans) {
    if (span.model !== expectedModel) {
      throw new Error(`trace model ${span.model} does not match resolved model ${expectedModel}`)
    }
    for (const [name, value] of [
      ['inputTokens', span.inputTokens],
      ['outputTokens', span.outputTokens],
      ['costUsd', span.costUsd],
    ] as const) {
      if (value === undefined || !Number.isFinite(value) || value < 0) {
        throw new Error(`LLM span ${span.spanId} is missing protected nonnegative ${name}`)
      }
    }
    inputTokens += span.inputTokens ?? 0
    outputTokens += span.outputTokens ?? 0
    costUsd += span.costUsd ?? 0
    if (span.cachedTokens !== undefined) {
      if (!Number.isFinite(span.cachedTokens) || span.cachedTokens < 0) {
        throw new Error(`LLM span ${span.spanId} has invalid cached token usage`)
      }
      cachedInputTokens += span.cachedTokens
      hasCachedUsage = true
    }
  }
  return {
    costUsd,
    inputTokens,
    outputTokens,
    ...(hasCachedUsage ? { cachedInputTokens } : {}),
    modelCalls: spans.length,
  }
}

function enforceLimits(
  prepared: PreparedAgentCandidateExecution,
  startedAt: number,
  endedAt: number,
  spans: Span[],
  usage: AgentCandidateSpend,
): void {
  const limits = prepared.executionPlan.value.material.limits
  const wallMs = endedAt - startedAt
  if (!Number.isFinite(wallMs) || wallMs < 0 || wallMs > limits.timeoutMs) {
    throw new Error(`protected trace wall time ${wallMs} exceeds ${limits.timeoutMs}`)
  }
  const steps = spans.filter((span) => span.kind === 'tool').length
  const checks: Array<[number, number, string]> = [
    [steps, limits.maxSteps, 'tool steps'],
    [usage.modelCalls, limits.maxModelCalls, 'model calls'],
    [usage.inputTokens, limits.maxInputTokens, 'input tokens'],
    [usage.outputTokens, limits.maxOutputTokens, 'output tokens'],
    [usage.costUsd, limits.maxCostUsd, 'cost USD'],
  ]
  for (const [actual, limit, label] of checks) {
    if (actual > limit) throw new Error(`protected ${label} ${actual} exceeds ${limit}`)
  }
}

async function memoryReceipt(
  prepared: PreparedAgentCandidateExecution,
  capture: AgentCandidateProtectedRunCapture,
): Promise<AgentCandidateMemoryReceipt> {
  if (prepared.memory.mode === 'disabled') {
    if (capture.memoryAfter !== undefined) {
      throw new Error('disabled memory cannot return an after-state')
    }
    return { mode: 'disabled' }
  }
  if (!capture.memoryAfter) throw new Error('isolated memory is missing its protected after-state')
  const state = getPreparedCandidateState(prepared)
  await verifyWorkspaceSnapshotArtifacts(capture.memoryAfter, state.ports.artifacts)
  return {
    mode: 'isolated',
    scope: 'task',
    effectiveNamespace: prepared.memory.effectiveNamespace,
    resetEvidenceDigest: prepared.memory.reset.evidence.sha256,
    beforeStateDigest: prepared.memory.beforeState.digest,
    afterState: capture.memoryAfter,
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
