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
  type AgentCandidateTaskOutcomeMaterial,
  type AgentCandidateTaskOutcomeSpec,
  type AgentCandidateTaskOutputSpec,
  type AgentCandidateTaskRepository,
  type AgentCandidateTermination,
  type AgentCandidateWorkspaceSnapshotEvidence,
  agentCandidateBenchmarkResultEvidenceSchema,
  agentCandidateModelSettlementEvidenceSchema,
  agentCandidateTaskOutcomeEvidenceSchema,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
  type Sha256Digest,
} from '@tangle-network/agent-interface'

import { readMaterializedWorkspaceFiles } from './artifacts'
import { runBoundCandidateBenchmarkGrader } from './benchmark-grader'
import {
  canonicalCandidateBytes,
  embeddedCandidateArtifact,
  immutableCandidateValue,
  sha256Bytes,
} from './digest'
import type { SealedAgentCandidateExecutorFinalCapture } from './executor-capture'
import {
  type PersistedAgentCandidateExecutorCapture,
  type PersistedAgentCandidateTaskCapture,
  persistAgentCandidateExecutorCapture,
} from './executor-capture-evidence'
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

export type PersistedAgentCandidateModelSettlement = AgentCandidateModelSettlementEvidence & {
  artifact: AgentCandidateArtifactRef
}

export type PersistedAgentCandidateBenchmarkResult = AgentCandidateBenchmarkResultEvidence & {
  artifact: AgentCandidateArtifactRef
}

/** Persist the closed evaluator model ledger as canonical receipt evidence. */
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
    kind: 'agent-candidate-model-settlement-material' as const,
    executionPlanDigest: identity.executionPlanDigest,
    preparationId: settlement.value.preparationId,
    grantDigest: settlement.value.grantDigest,
    closed: true as const,
    resolved: identity.resolvedModel,
    // The direct port validates the closed settlement before it is signed.
    usageWithinLimits: settlement.value.usageWithinLimits,
    calls: settlement.value.calls.map((call) => ({
      callId: call.callId,
      generationId: call.generationId,
      traceSpanId: call.traceSpanId,
      status: call.status,
      model: call.model,
      startedAtMs: call.startedAtMs,
      endedAtMs: call.endedAtMs,
      inputTokens: call.inputTokens,
      accountedInputTokens: call.accountedInputTokens,
      outputTokens: call.outputTokens,
      cachedInputTokens: call.cachedInputTokens ?? 0,
      reasoningTokens: call.reasoningTokens ?? 0,
      costUsdNanos: call.costUsdNanos,
      costProvenance: call.costProvenance,
    })),
    usage: settlement.usage,
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
      kind: 'agent-candidate-model-settlement',
      digest,
      material,
      artifact,
    }),
  ) as PersistedAgentCandidateModelSettlement
}

/** Verify once, persist the sealed capture once, and bind the resulting task evidence. */
export async function persistVerifiedAgentCandidateExecutorCapture(
  state: PreparedCandidateState,
  capture: SealedAgentCandidateExecutorFinalCapture,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  protectedValues: readonly string[],
  signal?: AbortSignal,
): Promise<{
  persistedCapture: PersistedAgentCandidateExecutorCapture
  taskOutcome: VerifiedAgentCandidateTaskOutcome
}> {
  signal?.throwIfAborted()
  const taskCapture = capture.taskOutcome
  if (!taskCapture) throw new Error('candidate final capture is missing the task outcome')
  if (capture.evidence) assertNoProtectedBytes(capture.evidence, protectedValues)
  const expected = state.benchmarkTask.outcome
  if (taskCapture.kind !== expected.kind) {
    throw new Error(
      `candidate captured ${taskCapture.kind} outcome does not match expected ${expected.kind} outcome`,
    )
  }
  const verified =
    taskCapture.kind === 'output' && expected.kind === 'output'
      ? verifyOutputTaskCapture(taskCapture.bytes, expected, protectedValues)
      : taskCapture.kind === 'workspace' && expected.kind === 'workspace'
        ? await verifyWorkspaceTaskCapture(state, taskCapture, protectedValues, signal)
        : undefined
  if (!verified) throw new Error('candidate task outcome kind could not be narrowed')
  await verifyMemoryCapture(state, capture, protectedValues, signal)

  const persistedCapture = await persistAgentCandidateExecutorCapture(
    {
      executionId: state.executionId,
      executionPlanDigest: state.executionPlan.value.digest,
    },
    expected,
    capture,
    outputArtifacts,
    signal,
  )
  const persisted = persistedCapture.taskOutcome
  if (!persisted || persisted.kind !== verified.kind) {
    throw new Error('persisted task capture kind changed')
  }
  const taskOutcome =
    verified.kind === 'output' && persisted.kind === 'output'
      ? await persistVerifiedOutputTaskOutcome(state, verified, persisted, outputArtifacts, signal)
      : verified.kind === 'workspace' && persisted.kind === 'workspace'
        ? await persistVerifiedWorkspaceTaskOutcome(
            state,
            verified,
            persisted,
            outputArtifacts,
            signal,
          )
        : undefined
  if (!taskOutcome) throw new Error('persisted task outcome kind could not be narrowed')
  return Object.freeze({ persistedCapture, taskOutcome })
}

interface VerifiedWorkspaceTaskCapture {
  readonly kind: 'workspace'
  readonly patch: Uint8Array
  readonly archive: Uint8Array
  readonly afterState: Extract<
    AgentCandidateExecutorTaskOutcomeCapture,
    { kind: 'workspace' }
  >['afterState']
  readonly manifestBytes: Uint8Array
  readonly resultCommit: string
  readonly resultTree: string
  readonly repository: AgentCandidateTaskRepository
}

async function verifyWorkspaceTaskCapture(
  state: PreparedCandidateState,
  capture: Extract<AgentCandidateExecutorTaskOutcomeCapture, { kind: 'workspace' }>,
  protectedValues: readonly string[],
  signal?: AbortSignal,
): Promise<VerifiedWorkspaceTaskCapture> {
  const repository = state.benchmarkTask.repository
  if (!repository) throw new Error('workspace task outcome is missing repository identity')
  const patch = Uint8Array.from(capture.gitDiff)
  const archive = Uint8Array.from(capture.archive)
  if (archive.byteLength === 0) throw new Error('candidate task archive cannot be empty')
  assertNoProtectedBytes(patch, protectedValues)
  assertNoProtectedBytes(archive, protectedValues)
  const afterState = immutableCandidateValue(capture.afterState)
  const verified = await verifyTaskOutcomePatch({
    repositoryRoot: state.roots.staging.taskRoot,
    baseCommit: repository.baseCommit,
    baseTree: repository.baseTree,
    resultTree: capture.resultTree,
    patch,
    afterState,
  })
  signal?.throwIfAborted()
  const manifestBytes = canonicalCandidateBytes(afterState)
  assertNoProtectedBytes(manifestBytes, protectedValues)
  const provisionalSnapshot = agentCandidateWorkspaceSnapshotEvidenceSchema.parse({
    kind: 'agent-candidate-workspace-snapshot',
    digest: sha256Bytes(manifestBytes),
    material: afterState,
    manifest: embeddedCandidateArtifact(manifestBytes),
    archive: embeddedCandidateArtifact(archive),
  })
  await verifyTaskOutcomeArchive(state, provisionalSnapshot, archive, protectedValues)
  signal?.throwIfAborted()
  return {
    kind: 'workspace',
    patch,
    archive,
    afterState,
    manifestBytes,
    resultCommit: verified.resultCommit,
    resultTree: verified.resultTree,
    repository,
  }
}

async function persistVerifiedWorkspaceTaskOutcome(
  state: PreparedCandidateState,
  verified: VerifiedWorkspaceTaskCapture,
  persisted: Extract<PersistedAgentCandidateTaskCapture, { kind: 'workspace' }>,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  signal?: AbortSignal,
): Promise<VerifiedAgentCandidateTaskOutcome> {
  const { afterState, manifestBytes, patch, repository } = verified
  const snapshot = agentCandidateWorkspaceSnapshotEvidenceSchema.parse({
    kind: 'agent-candidate-workspace-snapshot',
    digest: sha256Bytes(manifestBytes),
    material: afterState,
    manifest: persisted.manifest,
    archive: persisted.archive,
  })
  const material = {
    kind: 'agent-candidate-task-outcome-material' as const,
    executionPlanDigest: state.executionPlan.value.digest,
    outcome: {
      kind: 'workspace' as const,
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
        artifact: persisted.gitDiff,
      },
    },
  } satisfies AgentCandidateTaskOutcomeMaterial
  const evidence = await persistTaskOutcomeEvidence(state, material, outputArtifacts, signal)
  const storedPatch = Uint8Array.from(patch)
  return Object.freeze({
    kind: 'workspace' as const,
    evidence,
    get patch(): Uint8Array {
      return Uint8Array.from(storedPatch)
    },
    [verifiedTaskOutcomeBrand]: true as const,
  })
}

interface VerifiedOutputTaskCapture {
  readonly kind: 'output'
  readonly bytes: Uint8Array
  readonly spec: AgentCandidateTaskOutputSpec
}

function verifyOutputTaskCapture(
  capturedBytes: Uint8Array,
  expected: Extract<AgentCandidateTaskOutcomeSpec, { kind: 'output' }>,
  protectedValues: readonly string[],
): VerifiedOutputTaskCapture {
  if (capturedBytes.byteLength === 0) throw new Error('candidate task output cannot be empty')
  if (capturedBytes.byteLength > expected.maxBytes) {
    throw new Error(`candidate task output exceeds the frozen ${expected.maxBytes}-byte maximum`)
  }
  const output = Uint8Array.from(capturedBytes)
  assertNoProtectedBytes(output, protectedValues)
  return {
    kind: 'output',
    bytes: output,
    spec: { mediaType: expected.mediaType, maxBytes: expected.maxBytes },
  }
}

async function persistVerifiedOutputTaskOutcome(
  state: PreparedCandidateState,
  verified: VerifiedOutputTaskCapture,
  persisted: Extract<PersistedAgentCandidateTaskCapture, { kind: 'output' }>,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  signal?: AbortSignal,
): Promise<VerifiedAgentCandidateTaskOutcome> {
  if (
    persisted.spec.mediaType !== verified.spec.mediaType ||
    persisted.spec.maxBytes !== verified.spec.maxBytes
  ) {
    throw new Error('persisted task output changed the signed media constraints')
  }
  const material = {
    kind: 'agent-candidate-task-outcome-material' as const,
    executionPlanDigest: state.executionPlan.value.digest,
    outcome: {
      kind: 'output' as const,
      spec: verified.spec,
      artifact: persisted.artifact,
    },
  } satisfies AgentCandidateTaskOutcomeMaterial
  const evidence = await persistTaskOutcomeEvidence(state, material, outputArtifacts, signal)
  const storedOutput = Uint8Array.from(verified.bytes)
  return Object.freeze({
    kind: 'output' as const,
    evidence,
    spec: immutableCandidateValue(verified.spec),
    get bytes(): Uint8Array {
      return Uint8Array.from(storedOutput)
    },
    [verifiedTaskOutcomeBrand]: true as const,
  })
}

async function persistTaskOutcomeEvidence<Material extends AgentCandidateTaskOutcomeMaterial>(
  state: PreparedCandidateState,
  material: Material,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  signal?: AbortSignal,
): Promise<
  Omit<AgentCandidateTaskOutcomeEvidence, 'material'> & {
    material: Material
    artifact: AgentCandidateArtifactRef
  }
> {
  const bytes = canonicalCandidateBytes(material)
  const digest = sha256Bytes(bytes)
  const artifact = await persistCandidateOutputArtifact(outputArtifacts, {
    executionId: state.executionId,
    purpose: 'task-outcome',
    bytes,
    signal,
  })
  return immutableCandidateValue(
    agentCandidateTaskOutcomeEvidenceSchema.parse({
      kind: 'agent-candidate-task-outcome',
      digest,
      material,
      artifact,
    }),
  ) as Omit<AgentCandidateTaskOutcomeEvidence, 'material'> & {
    material: Material
    artifact: AgentCandidateArtifactRef
  }
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
    expectedGrader: state.benchmarkTask.grader,
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
  const material = {
    kind: 'agent-candidate-benchmark-result-material' as const,
    executionPlanDigest: state.executionPlan.value.digest,
    taskOutcomeDigest: outcome.evidence.digest,
    grader: graded.grader,
    evidence: evidenceRef,
    grading: graded.grading,
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

async function verifyMemoryCapture(
  state: PreparedCandidateState,
  capture: SealedAgentCandidateExecutorFinalCapture,
  protectedValues: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  if (state.memory.mode === 'disabled') {
    if (capture.memoryAfter) throw new Error('disabled memory cannot return an after-state')
    return
  }
  const memory = capture.memoryAfter
  if (!memory) throw new Error('isolated memory is missing its protected after-state')
  if (memory.archive.byteLength === 0) throw new Error('isolated memory archive cannot be empty')
  const manifestBytes = canonicalCandidateBytes(memory.afterState)
  assertNoProtectedBytes(manifestBytes, protectedValues)
  assertNoProtectedBytes(memory.archive, protectedValues)
  const snapshot = agentCandidateWorkspaceSnapshotEvidenceSchema.parse({
    kind: 'agent-candidate-workspace-snapshot',
    digest: sha256Bytes(manifestBytes),
    material: memory.afterState,
    manifest: embeddedCandidateArtifact(manifestBytes),
    archive: embeddedCandidateArtifact(memory.archive),
  })
  const root = await mkdtemp(join(tmpdir(), 'agent-candidate-memory-after-'))
  try {
    await state.ports.workspaces.materialize({
      role: 'memory',
      snapshot,
      archive: Uint8Array.from(memory.archive),
      destination: root,
    })
    const files = await readMaterializedWorkspaceFiles(root, memory.afterState)
    for (const file of files) assertNoProtectedBytes(file.bytes, protectedValues)
    signal?.throwIfAborted()
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
