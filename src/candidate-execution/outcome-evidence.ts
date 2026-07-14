import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BenchmarkEvaluation } from '@tangle-network/agent-eval'
import {
  type AgentCandidateArtifactRef,
  type AgentCandidateBenchmarkResultEvidence,
  type AgentCandidateModelSettlementEvidence,
  type AgentCandidateResolvedModel,
  type AgentCandidateTaskOutcomeEvidence,
  type AgentCandidateTermination,
  type AgentCandidateWorkspaceSnapshotEvidence,
  agentCandidateBenchmarkResultEvidenceSchema,
  agentCandidateModelSettlementEvidenceSchema,
  agentCandidateTaskOutcomeEvidenceSchema,
  type Sha256Digest,
} from '@tangle-network/agent-interface'

import { readMaterializedWorkspaceFiles } from './artifacts'
import { runBoundCandidateBenchmarkGrader } from './benchmark-grader'
import { canonicalCandidateBytes, immutableCandidateValue, sha256Bytes } from './digest'
import { verifyTaskOutcomePatch } from './git-materialize'
import type { SealedAgentCandidateModelSettlement } from './model-settlement'
import { persistCandidateOutputArtifact } from './output-artifacts'
import type { PreparedCandidateState } from './prepared-state'
import { assertNoProtectedBytes } from './protected-redaction'
import type {
  AgentCandidateBenchmarkGraderPort,
  AgentCandidateExecutorTaskOutcomeCapture,
  AgentCandidateOutputArtifactPort,
  VerifiedAgentCandidateTaskOutcome,
} from './types'
import { verifiedTaskOutcomeBrand } from './types'
import {
  persistCandidateWorkspaceSnapshot,
  provisionalCandidateWorkspaceSnapshot,
} from './workspace-snapshot'

export type PersistedAgentCandidateModelSettlement = AgentCandidateModelSettlementEvidence & {
  artifact: AgentCandidateArtifactRef
}

export type PersistedAgentCandidateBenchmarkResult = AgentCandidateBenchmarkResultEvidence & {
  artifact: AgentCandidateArtifactRef
}

/** Persist the closed evaluator model ledger as canonical V2 receipt evidence. */
export async function persistCandidateModelSettlement(
  state: PreparedCandidateState,
  settlement: SealedAgentCandidateModelSettlement,
  outputArtifacts: AgentCandidateOutputArtifactPort,
): Promise<PersistedAgentCandidateModelSettlement> {
  return await persistCandidateModelSettlementEvidence(
    {
      executionId: state.executionId,
      executionPlanDigest: state.executionPlan.value.digest,
      resolvedModel: state.resolvedModel,
    },
    settlement,
    outputArtifacts,
  )
}

/** Persist a closed model ledger when only durable recovery identity remains. */
export async function persistCandidateModelSettlementEvidence(
  identity: {
    executionId: string
    executionPlanDigest: Sha256Digest
    resolvedModel: AgentCandidateResolvedModel
  },
  settlement: SealedAgentCandidateModelSettlement,
  outputArtifacts: AgentCandidateOutputArtifactPort,
): Promise<PersistedAgentCandidateModelSettlement> {
  const material = {
    schemaVersion: 2 as const,
    kind: 'agent-candidate-model-settlement-material' as const,
    executionPlanDigest: identity.executionPlanDigest,
    preparationId: settlement.value.preparationId,
    grantDigest: settlement.value.grantDigest,
    closed: true as const,
    resolved: identity.resolvedModel,
    calls: settlement.value.calls.map((call) => ({
      callId: call.callId,
      generationId: call.generationId,
      traceSpanId: call.traceSpanId,
      status: call.status,
      model: call.model,
      startedAtMs: call.startedAtMs,
      endedAtMs: call.endedAtMs,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cachedInputTokens: call.cachedInputTokens ?? 0,
      reasoningTokens: call.reasoningTokens ?? 0,
      costUsdNanos: call.costUsdNanos,
    })),
    usage: settlement.fixedUsage,
  }
  const bytes = canonicalCandidateBytes(material)
  const digest = sha256Bytes(bytes)
  const artifact = await persistCandidateOutputArtifact(outputArtifacts, {
    executionId: identity.executionId,
    purpose: 'model-settlement',
    bytes,
  })
  return immutableCandidateValue(
    agentCandidateModelSettlementEvidenceSchema.parse({
      schemaVersion: 1,
      kind: 'agent-candidate-model-settlement',
      digest,
      material,
      artifact,
    }),
  ) as PersistedAgentCandidateModelSettlement
}

/** Recompute the result tree from the patch, then persist its exact task evidence. */
export async function persistVerifiedCandidateTaskOutcome(
  state: PreparedCandidateState,
  capture: AgentCandidateExecutorTaskOutcomeCapture,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  protectedValues: readonly string[],
  signal?: AbortSignal,
): Promise<VerifiedAgentCandidateTaskOutcome> {
  signal?.throwIfAborted()
  const patch = Uint8Array.from(capture.gitDiff)
  const archive = Uint8Array.from(capture.archive)
  if (archive.byteLength === 0) throw new Error('candidate task archive cannot be empty')
  assertNoProtectedBytes(patch, protectedValues)
  assertNoProtectedBytes(archive, protectedValues)
  const provisional = provisionalCandidateWorkspaceSnapshot(capture.afterState, archive)
  const afterState = provisional.material
  const repository = state.executionPlan.value.material.task.repository
  const verified = await verifyTaskOutcomePatch({
    repositoryRoot: state.roots.staging.taskRoot,
    baseCommit: repository.baseCommit,
    baseTree: repository.baseTree,
    resultTree: capture.resultTree,
    patch,
    afterState,
  })
  signal?.throwIfAborted()
  assertNoProtectedBytes(provisional.manifestBytes, protectedValues)
  await verifyTaskOutcomeArchive(state, provisional.snapshot, archive, protectedValues)
  signal?.throwIfAborted()
  const snapshot = await persistCandidateWorkspaceSnapshot(outputArtifacts, {
    executionId: state.executionId,
    material: afterState,
    archive,
    purpose: 'task',
    signal,
  })
  const gitDiff = await persistCandidateOutputArtifact(outputArtifacts, {
    executionId: state.executionId,
    purpose: 'task-patch',
    bytes: patch,
    signal,
  })
  const material = {
    schemaVersion: 1 as const,
    kind: 'agent-candidate-task-outcome-material' as const,
    executionPlanDigest: state.executionPlan.value.digest,
    baseRepository: {
      identity: repository.identity,
      rootIdentity: repository.rootIdentity,
      commit: repository.baseCommit,
      tree: repository.baseTree,
    },
    resultRepository: {
      identity: repository.identity,
      rootIdentity: repository.rootIdentity,
      commit: verified.resultCommit,
      tree: verified.resultTree,
    },
    afterState: snapshot,
    gitDiff: {
      format: 'git-diff-binary' as const,
      artifact: gitDiff,
    },
  }
  const bytes = canonicalCandidateBytes(material)
  const digest = sha256Bytes(bytes)
  const artifact = await persistCandidateOutputArtifact(outputArtifacts, {
    executionId: state.executionId,
    purpose: 'task-outcome',
    bytes,
    signal,
  })
  const evidence = immutableCandidateValue(
    agentCandidateTaskOutcomeEvidenceSchema.parse({
      schemaVersion: 1,
      kind: 'agent-candidate-task-outcome',
      digest,
      material,
      artifact,
    }),
  ) as AgentCandidateTaskOutcomeEvidence & { artifact: AgentCandidateArtifactRef }
  const storedPatch = Uint8Array.from(patch)
  return Object.freeze({
    evidence,
    get patch(): Uint8Array {
      return Uint8Array.from(storedPatch)
    },
    [verifiedTaskOutcomeBrand]: true as const,
  })
}

/** Grade only a runtime-verified outcome and persist both raw and normalized evidence. */
export async function persistCandidateBenchmarkResult(
  state: PreparedCandidateState,
  termination: AgentCandidateTermination,
  outcome: VerifiedAgentCandidateTaskOutcome,
  grader: AgentCandidateBenchmarkGraderPort,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  protectedValues: readonly string[],
  signal?: AbortSignal,
): Promise<PersistedAgentCandidateBenchmarkResult> {
  signal?.throwIfAborted()
  const frozenTermination = immutableCandidateValue(termination)
  const graded = await runBoundCandidateBenchmarkGrader({
    executionId: state.executionId,
    termination: frozenTermination,
    outcome,
    grader,
    artifacts: outputArtifacts,
    signal,
  })
  signal?.throwIfAborted()
  const evaluation = normalizeEvaluation(graded.evaluation, frozenTermination)
  const rawEvidence = Uint8Array.from(graded.evidence)
  if (rawEvidence.byteLength === 0) throw new Error('candidate benchmark evidence cannot be empty')
  assertNoProtectedBytes(rawEvidence, protectedValues)
  const evidenceRef = await persistCandidateOutputArtifact(outputArtifacts, {
    executionId: state.executionId,
    purpose: 'grader-evidence',
    bytes: rawEvidence,
    signal,
  })
  const task = state.executionPlan.value.material.task
  const material = {
    schemaVersion: 1 as const,
    kind: 'agent-candidate-benchmark-result-material' as const,
    executionPlanDigest: state.executionPlan.value.digest,
    taskOutcomeDigest: outcome.evidence.digest,
    benchmark: {
      name: task.benchmark,
      version: task.benchmarkVersion,
      taskId: task.taskId,
      splitDigest: task.splitDigest,
    },
    grader: {
      name: graded.grader.name,
      version: graded.grader.version,
      artifact: graded.grader.artifact,
    },
    evidence: evidenceRef,
    score: evaluation.score,
    passed: evaluation.passed,
    dimensions: evaluation.dimensions,
  }
  const bytes = canonicalCandidateBytes(material)
  const digest = sha256Bytes(bytes)
  const artifact = await persistCandidateOutputArtifact(outputArtifacts, {
    executionId: state.executionId,
    purpose: 'benchmark-result',
    bytes,
    signal,
  })
  return immutableCandidateValue(
    agentCandidateBenchmarkResultEvidenceSchema.parse({
      schemaVersion: 1,
      kind: 'agent-candidate-benchmark-result',
      digest,
      material,
      artifact,
    }),
  ) as PersistedAgentCandidateBenchmarkResult
}

async function verifyTaskOutcomeArchive(
  state: PreparedCandidateState,
  snapshot: AgentCandidateWorkspaceSnapshotEvidence,
  archive: Uint8Array,
  protectedValues: readonly string[],
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'agent-candidate-task-archive-'))
  try {
    await state.ports.workspaces.materialize({
      role: 'task',
      snapshot,
      archive: Uint8Array.from(archive),
      destination: root,
    })
    const files = await readMaterializedWorkspaceFiles(root, snapshot.material)
    for (const file of files) assertNoProtectedBytes(file.bytes, protectedValues)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function normalizeEvaluation(
  evaluation: BenchmarkEvaluation,
  termination: AgentCandidateTermination,
): { score: number; passed: boolean; dimensions: Array<{ name: string; score: number }> } {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    throw new Error('candidate benchmark evaluation must be an object')
  }
  assertUnitScore(evaluation.score, 'candidate benchmark score')
  if (evaluation.passed !== undefined && typeof evaluation.passed !== 'boolean') {
    throw new Error('candidate benchmark passed must be boolean')
  }
  const cleanExit = termination.kind === 'exit' && termination.exitCode === 0
  const dimensions = Object.entries(evaluation.dimensions ?? {})
    .map(([name, score]) => {
      if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name)) {
        throw new Error(`candidate benchmark dimension is not normalized: ${name}`)
      }
      assertUnitScore(score, `candidate benchmark dimension ${name}`)
      return { name, score: cleanExit ? score : 0 }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
  return {
    score: cleanExit ? evaluation.score : 0,
    passed: cleanExit && (evaluation.passed ?? evaluation.score > 0),
    dimensions,
  }
}

function assertUnitScore(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be finite and within [0, 1]`)
  }
}
