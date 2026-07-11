import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Span, TraceStore } from '@tangle-network/agent-eval'
import { isLlmSpan, REDACTION_VERSION } from '@tangle-network/agent-eval'
import type {
  AgentCandidateBenchmarkResultEvidence,
  AgentCandidateMemoryReceipt,
  AgentCandidateModelSettlementEvidence,
  AgentCandidateRunReceiptV2,
  AgentCandidateSpend,
  AgentCandidateTermination,
} from '@tangle-network/agent-interface'
import {
  agentCandidateRunReceiptV2Schema,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
} from '@tangle-network/agent-interface'

import { readMaterializedWorkspaceFiles } from './artifacts'
import {
  canonicalCandidateBytes,
  canonicalCandidateDocument,
  embeddedCandidateArtifact,
  sha256Bytes,
} from './digest'
import {
  sealAgentCandidateExecutorFinalCapture,
  sealAgentCandidateProtectedRunCapture,
} from './executor-capture'
import {
  assertTraceMatchesModelSettlement,
  type SealedAgentCandidateModelSettlement,
  usdToNanos,
} from './model-settlement'
import { persistCandidateOutputArtifact } from './output-artifacts'
import type { PreparedCandidateState } from './prepared-state'
import {
  assertNoProtectedBytes,
  type ProtectedRedactionReport,
  redactProtectedReason,
  redactProtectedValue,
} from './protected-redaction'
import {
  type AgentCandidateExecutorFinalCapture,
  type AgentCandidateOutputArtifactPort,
  type AgentCandidateProtectedRunCapture,
  type AgentCandidateRunFinalization,
  CANDIDATE_TRACE_TAGS,
  type VerifiedAgentCandidateTaskOutcome,
} from './types'

interface CandidateFinalizationEvidence {
  finalCapture: AgentCandidateExecutorFinalCapture
  modelSettlement: AgentCandidateModelSettlementEvidence & {
    artifact: import('@tangle-network/agent-interface').AgentCandidateArtifactRef
  }
  taskOutcome: VerifiedAgentCandidateTaskOutcome
  benchmarkResult: AgentCandidateBenchmarkResultEvidence & {
    artifact: import('@tangle-network/agent-interface').AgentCandidateArtifactRef
  }
  outputArtifacts: AgentCandidateOutputArtifactPort
}

/** Builds a candidate run receipt exclusively from protected trace and memory evidence. */
export async function finalizeAgentCandidateRun(
  state: PreparedCandidateState,
  capture: AgentCandidateProtectedRunCapture,
  traceStore: TraceStore,
  settlement: SealedAgentCandidateModelSettlement,
  evidence: CandidateFinalizationEvidence,
  protectedValues: readonly string[],
  writeRedactionReport?: ProtectedRedactionReport,
  signal?: AbortSignal,
): Promise<AgentCandidateRunFinalization> {
  let termination: AgentCandidateTermination | undefined
  try {
    signal?.throwIfAborted()
    const protectedCapture = sealAgentCandidateProtectedRunCapture(capture)
    if (protectedCapture.executionId !== state.executionId) {
      throw new Error('protected capture execution id does not match the prepared execution')
    }
    termination = protectedCapture.termination
    if (
      termination.kind === 'timeout' &&
      termination.timeoutMs !== state.executionPlan.value.material.limits.timeoutMs
    ) {
      throw new Error('timeout termination does not match the frozen execution limit')
    }

    const run = await traceStore.getRun(state.trace.runId)
    if (!run) throw new Error(`protected trace run is missing: ${state.trace.runId}`)
    if (run.status === 'running' || run.endedAt === undefined) {
      throw new Error('protected trace run is not terminal')
    }
    assertTraceBindings(run.tags, state)

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
    assertTraceMatchesModelSettlement(modelSpans, settlement)
    const usage = settlement.usage
    enforceLimits(state, run.startedAt, run.endedAt, orderedSpans, settlement)
    const finalCapture = sealAgentCandidateExecutorFinalCapture(evidence.finalCapture)
    const memory = await memoryReceipt(
      state,
      finalCapture,
      evidence.outputArtifacts,
      protectedValues,
      signal,
    )

    const redacted = redactProtectedValue(
      {
        schemaVersion: 1,
        run: { ...run, redactionVersion: REDACTION_VERSION },
        spans: orderedSpans,
        events: orderedEvents,
        budget: orderedBudget,
        artifacts: orderedArtifacts,
      },
      protectedValues,
    )
    const combinedByRule = { ...(writeRedactionReport?.byRule ?? {}) }
    for (const [rule, count] of Object.entries(redacted.report.byRule)) {
      combinedByRule[rule] = (combinedByRule[rule] ?? 0) + count
    }
    const traceMaterial = {
      ...(redacted.value as Record<string, unknown>),
      evaluatorLimits: { resultTimeoutMs: state.resultTimeoutMs },
      redaction: {
        version: REDACTION_VERSION,
        redactionCount:
          (writeRedactionReport?.redactionCount ?? 0) + redacted.report.redactionCount,
        byRule: combinedByRule,
      },
    }
    const traceBytes = canonicalCandidateBytes(traceMaterial)
    assertNoProtectedBytes(traceBytes, protectedValues)
    const traceArtifact = await persistCandidateOutputArtifact(evidence.outputArtifacts, {
      executionId: state.executionId,
      purpose: 'trace',
      bytes: traceBytes,
      signal,
    })
    const trace = {
      schemaVersion: 1 as const,
      artifact: traceArtifact,
      eventCount:
        1 +
        orderedSpans.length +
        orderedEvents.length +
        orderedBudget.length +
        orderedArtifacts.length,
      modelCallCount: modelSpans.length,
    }
    const document = canonicalCandidateDocument<AgentCandidateRunReceiptV2>({
      schemaVersion: 2,
      kind: 'agent-candidate-run',
      digestAlgorithm: 'rfc8785-sha256',
      bundleDigest: state.bundle.digest,
      materializationReceiptDigest: state.materializationReceipt.digest,
      executionPlanDigest: state.executionPlan.value.digest,
      memory,
      usage,
      modelUsage: { resolved: state.resolvedModel, usage },
      trace,
      termination,
      fixedUsage: settlement.fixedUsage,
      modelSettlement: evidence.modelSettlement,
      taskOutcome: evidence.taskOutcome.evidence,
      benchmarkResult: evidence.benchmarkResult,
    })
    agentCandidateRunReceiptV2Schema.parse(document.value)
    const runReceipt = await persistCandidateOutputArtifact(evidence.outputArtifacts, {
      executionId: state.executionId,
      purpose: 'run-receipt',
      bytes: document.bytes,
      signal,
    })
    return {
      succeeded: true,
      receipt: document,
      artifacts: {
        modelSettlement: evidence.modelSettlement.artifact,
        taskOutcome: evidence.taskOutcome.evidence.artifact,
        benchmarkResult: evidence.benchmarkResult.artifact,
        runReceipt,
      },
    }
  } catch (error) {
    return {
      ...failedAgentCandidateRun(
        state,
        redactProtectedReason(
          error instanceof Error ? error.message : String(error),
          protectedValues,
        ),
        termination,
        settlement.usage,
      ),
    }
  }
}

function assertTraceBindings(
  tags: Record<string, string> | undefined,
  state: PreparedCandidateState,
): void {
  const expected = state.trace.tags
  for (const name of Object.values(CANDIDATE_TRACE_TAGS)) {
    if (tags?.[name] !== expected[name]) {
      throw new Error(`protected trace is not bound to prepared execution tag ${name}`)
    }
  }
}

function enforceLimits(
  state: PreparedCandidateState,
  startedAt: number,
  endedAt: number,
  spans: Span[],
  settlement: SealedAgentCandidateModelSettlement,
): void {
  const limits = state.executionPlan.value.material.limits
  const usage = settlement.usage
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
  ]
  for (const [actual, limit, label] of checks) {
    if (actual > limit) throw new Error(`protected ${label} ${actual} exceeds ${limit}`)
  }
  if (settlement.costUsdNanos > usdToNanos(limits.maxCostUsd, 'frozen maxCostUsd')) {
    throw new Error(`protected cost USD ${usage.costUsd} exceeds ${limits.maxCostUsd}`)
  }
}

async function memoryReceipt(
  state: PreparedCandidateState,
  capture: AgentCandidateExecutorFinalCapture,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  protectedValues: readonly string[],
  signal?: AbortSignal,
): Promise<AgentCandidateMemoryReceipt> {
  signal?.throwIfAborted()
  if (state.memory.mode === 'disabled') {
    if (capture.memoryAfter !== undefined) {
      throw new Error('disabled memory cannot return an after-state')
    }
    return { mode: 'disabled' }
  }
  if (!capture.memoryAfter) throw new Error('isolated memory is missing its protected after-state')
  const afterState = capture.memoryAfter.afterState
  const archive = Uint8Array.from(capture.memoryAfter.archive)
  if (archive.byteLength === 0) throw new Error('isolated memory archive cannot be empty')
  const manifestBytes = canonicalCandidateBytes(afterState)
  assertNoProtectedBytes(manifestBytes, protectedValues)
  assertNoProtectedBytes(archive, protectedValues)
  const provisionalSnapshot = agentCandidateWorkspaceSnapshotEvidenceSchema.parse({
    schemaVersion: 1,
    kind: 'agent-candidate-workspace-snapshot',
    digest: sha256Bytes(manifestBytes),
    material: afterState,
    manifest: embeddedCandidateArtifact(manifestBytes),
    archive: embeddedCandidateArtifact(archive),
  })
  const root = await mkdtemp(join(tmpdir(), 'agent-candidate-memory-after-'))
  try {
    await state.ports.workspaces.materialize({
      role: 'memory',
      snapshot: provisionalSnapshot,
      archive: Uint8Array.from(archive),
      destination: root,
    })
    const files = await readMaterializedWorkspaceFiles(root, afterState)
    for (const file of files) assertNoProtectedBytes(file.bytes, protectedValues)
    signal?.throwIfAborted()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  const [manifest, archiveRef] = await Promise.all([
    persistCandidateOutputArtifact(outputArtifacts, {
      executionId: state.executionId,
      purpose: 'memory-after-manifest',
      bytes: manifestBytes,
      signal,
    }),
    persistCandidateOutputArtifact(outputArtifacts, {
      executionId: state.executionId,
      purpose: 'memory-after-archive',
      bytes: archive,
      signal,
    }),
  ])
  const snapshot = agentCandidateWorkspaceSnapshotEvidenceSchema.parse({
    schemaVersion: 1,
    kind: 'agent-candidate-workspace-snapshot',
    digest: sha256Bytes(manifestBytes),
    material: afterState,
    manifest,
    archive: archiveRef,
  })
  return {
    mode: 'isolated',
    scope: 'task',
    effectiveNamespace: state.memory.effectiveNamespace,
    resetEvidenceDigest: state.memory.reset.evidence.sha256,
    beforeStateDigest: state.memory.beforeState.digest,
    afterState: snapshot,
  }
}

export function failedAgentCandidateRun(
  state: PreparedCandidateState,
  reason: string,
  termination?: AgentCandidateTermination,
  usage: AgentCandidateSpend | null = null,
): AgentCandidateRunFinalization & { succeeded: false } {
  return {
    succeeded: false,
    reason,
    partial: {
      executionId: state.executionId,
      bundleDigest: state.bundle.digest,
      executionPlanDigest: state.executionPlan.value.digest,
      materializationReceiptDigest: state.materializationReceipt.digest,
      ...(termination ? { termination } : {}),
    },
    usage,
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
