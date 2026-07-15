import {
  agentCandidateExecutionPlanEvidenceSchema,
  agentCandidateMaterializationReceiptSchema,
  agentCandidateProfilePlanEvidenceSchema,
} from '@tangle-network/agent-interface'

import { verifyMaterializedProfileWorkspace, verifyMaterializedWorkspace } from './artifacts'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  immutableCandidateValue,
  omitTopLevelDigest,
  sha256Bytes,
} from './digest'
import { verifyTaskCheckout } from './git-materialize'
import type {
  AgentCandidateExecutionPorts,
  AgentCandidateExecutorRequest,
  AgentCandidateProtectedModelActivation,
  AgentCandidateProtectedModelReservation,
  PreparedAgentCandidateExecution,
} from './types'
import { CANDIDATE_TRACE_ENV, CANDIDATE_TRACE_TAGS, preparedCandidateBrand } from './types'
import { workspaceTaskRepository } from './workspace-task'

export interface PreparedCandidateState {
  ports: AgentCandidateExecutionPorts
  bundle: PreparedAgentCandidateExecution['bundle']
  executionId: string
  roots: PreparedAgentCandidateExecution['roots']
  profilePlan: PreparedAgentCandidateExecution['profilePlan']
  executionPlan: PreparedAgentCandidateExecution['executionPlan']
  materializationReceipt: PreparedAgentCandidateExecution['materializationReceipt']
  launch: PreparedAgentCandidateExecution['launch']
  instruction: PreparedAgentCandidateExecution['instruction']
  resolvedModel: PreparedAgentCandidateExecution['resolvedModel']
  preparationId: string
  reservationExpiresAtMs: number
  cleanupTimeoutMs: number
  resultTimeoutMs: number
  modelReservation: AgentCandidateProtectedModelReservation
  executorInputs: {
    taskFiles: ReadonlyArray<{
      path: string
      mode: number
      bytes: Uint8Array
    }>
    candidateFiles?: ReadonlyArray<{
      path: string
      mode: number
      bytes: Uint8Array
    }>
    profileFiles: ReadonlyArray<{
      path: string
      mode: number
      bytes: Uint8Array
    }>
  }
  memoryReservation?: {
    preparationId: string
    accessDigest: `sha256:${string}`
    expiresAtMs: number
    effectiveNamespace: string
  }
  knowledge?: PreparedAgentCandidateExecution['knowledge']
  trace: PreparedAgentCandidateExecution['trace']
  memory: PreparedAgentCandidateExecution['memory']
}

const stateByExecution = new WeakMap<PreparedAgentCandidateExecution, PreparedCandidateState>()
const lifecycleByExecution = new WeakMap<
  PreparedAgentCandidateExecution,
  {
    status:
      | 'prepared'
      | 'claiming'
      | 'claimed'
      | 'running'
      | 'settling'
      | 'disposing'
      | 'succeeded'
      | 'failed'
      | 'disposal-failed'
      | 'cleanup-failed'
      | 'disposed'
  }
>()

export function createPreparedCandidateExecution(
  input: PreparedCandidateState,
): PreparedAgentCandidateExecution {
  const state = detachPreparedCandidateState(input)
  assertPrivateCandidateIntegrity(state)
  const prepared = Object.freeze({
    bundle: state.bundle,
    executionId: state.executionId,
    roots: state.roots,
    profilePlan: evidenceView(state.profilePlan),
    executionPlan: evidenceView(state.executionPlan),
    materializationReceipt: state.materializationReceipt,
    launch: state.launch,
    instruction: bytesView(state.instruction, 'bytes'),
    resolvedModel: state.resolvedModel,
    ...(state.knowledge ? { knowledge: knowledgeView(state.knowledge) } : {}),
    trace: state.trace,
    memory: state.memory,
    [preparedCandidateBrand]: true as const,
  })
  stateByExecution.set(prepared, state)
  lifecycleByExecution.set(prepared, { status: 'prepared' })
  return prepared
}

export function getPreparedCandidateState(
  prepared: PreparedAgentCandidateExecution,
): PreparedCandidateState {
  const state = stateByExecution.get(prepared)
  if (!state || prepared[preparedCandidateBrand] !== true) {
    throw new Error('execution must come from prepareAgentCandidateExecution')
  }
  return state
}

/** Revalidates the exact private bytes immediately before execution or finalization. */
export function assertPreparedCandidateIntegrity(
  prepared: PreparedAgentCandidateExecution,
): PreparedCandidateState {
  const state = getPreparedCandidateState(prepared)
  assertPrivateCandidateIntegrity(state)
  return state
}

/** Atomically reserves this in-memory prepared value before the first await. */
export function beginPreparedCandidateClaim(
  prepared: PreparedAgentCandidateExecution,
): PreparedCandidateState {
  const state = assertPreparedCandidateIntegrity(prepared)
  transitionLifecycle(prepared, ['prepared'], 'claiming')
  return state
}

/** Claim an unexecuted preparation for explicit resource disposal. */
export function beginPreparedCandidateDisposal(
  prepared: PreparedAgentCandidateExecution,
): PreparedCandidateState {
  const state = assertPreparedCandidateIntegrity(prepared)
  transitionLifecycle(prepared, ['prepared', 'disposal-failed', 'cleanup-failed'], 'disposing')
  return state
}

export function markPreparedCandidateClaimed(prepared: PreparedAgentCandidateExecution): void {
  transitionLifecycle(prepared, ['claiming'], 'claimed')
}

/** Reveal protected values only after the durable claim and workspace checks succeed. */
export function beginPreparedCandidateRun(
  prepared: PreparedAgentCandidateExecution,
  modelAccess: AgentCandidateProtectedModelActivation,
  memoryAccess?: { env: Readonly<Record<string, string>> },
): { state: PreparedCandidateState; request: AgentCandidateExecutorRequest } {
  const state = assertPreparedCandidateIntegrity(prepared)
  assertProtectedEnvironment(state, modelAccess.env, memoryAccess?.env)
  transitionLifecycle(prepared, ['claimed'], 'running')
  const completeEnvironment = immutableCandidateValue({
    ...state.launch.env,
    ...modelAccess.env,
    ...(memoryAccess?.env ?? {}),
    ...state.trace.env,
  })
  const material = state.executionPlan.value.material
  const request = Object.freeze({
    executionId: state.executionId,
    inputs: Object.freeze({
      task: workspaceInputView(material.task.workspace, state.executorInputs.taskFiles),
      ...(material.candidateWorkspace && state.executorInputs.candidateFiles
        ? {
            candidate: workspaceInputView(
              material.candidateWorkspace,
              state.executorInputs.candidateFiles,
            ),
          }
        : {}),
      profile: Object.freeze({
        files: Object.freeze(
          state.executorInputs.profileFiles.map((file) => profileFileView(file)),
        ),
      }),
    }),
    roots: state.roots.execution,
    profilePlan: evidenceView(state.profilePlan),
    executionPlan: evidenceView(state.executionPlan),
    materializationReceipt: state.materializationReceipt,
    launch: immutableCandidateValue({ ...state.launch, env: completeEnvironment }),
    instruction: bytesView(state.instruction, 'bytes'),
    resolvedModel: state.resolvedModel,
    hardLimits: Object.freeze({ timeoutMs: state.executionPlan.value.material.limits.timeoutMs }),
    observedLimits: Object.freeze({ maxSteps: state.executionPlan.value.material.limits.maxSteps }),
    ...(state.knowledge ? { knowledge: knowledgeView(state.knowledge) } : {}),
    trace: state.trace,
    memory: state.memory,
  })
  return { state, request }
}

export function consumePreparedCandidateExecution(
  prepared: PreparedAgentCandidateExecution,
  outcome: 'succeeded' | 'failed' | 'disposed' | 'disposal-failed' | 'cleanup-failed',
): void {
  transitionLifecycle(
    prepared,
    outcome === 'disposed' || outcome === 'disposal-failed' ? ['disposing'] : ['settling'],
    outcome,
  )
}

export function beginPreparedCandidateSettlement(prepared: PreparedAgentCandidateExecution): void {
  transitionLifecycle(prepared, ['claiming', 'claimed', 'running'], 'settling')
}

/** Rechecks every mutable staging byte immediately before handing control to an executor. */
export async function assertPreparedCandidateWorkspaces(
  state: PreparedCandidateState,
): Promise<void> {
  const plan = state.executionPlan.value.material
  await verifyMaterializedWorkspace(state.roots.staging.taskRoot, plan.task.workspace.material, {
    ignoredProtectedRootEntries: ['.git', '.sidecar'],
  })
  await verifyTaskCheckout(state.roots.staging.taskRoot, workspaceTaskRepository(plan.task))
  await verifyMaterializedProfileWorkspace(
    state.roots.staging.profileRoot,
    state.profilePlan.value.material,
  )
  if (plan.candidateWorkspace) {
    const candidateRoot = state.roots.staging.candidateRoot
    if (!candidateRoot) throw new Error('prepared candidate staging root is missing')
    await verifyMaterializedWorkspace(candidateRoot, plan.candidateWorkspace.material)
  } else if (state.roots.staging.candidateRoot !== undefined) {
    throw new Error('disabled candidate unexpectedly has a staging root')
  }
}

function detachPreparedCandidateState(input: PreparedCandidateState): PreparedCandidateState {
  const profilePlan = immutableCandidateValue(
    agentCandidateProfilePlanEvidenceSchema.parse(input.profilePlan.value),
  )
  const executionPlan = immutableCandidateValue(
    agentCandidateExecutionPlanEvidenceSchema.parse(input.executionPlan.value),
  )
  const receiptValue = immutableCandidateValue(
    agentCandidateMaterializationReceiptSchema.parse(input.materializationReceipt.value),
  )
  const materializationReceipt = canonicalCandidateDocument(
    omitTopLevelDigest(receiptValue),
  ) as PreparedAgentCandidateExecution['materializationReceipt']
  if (materializationReceipt.digest !== input.materializationReceipt.digest) {
    throw new Error('materialization receipt digest changed while sealing prepared execution')
  }
  return Object.freeze({
    ports: input.ports,
    bundle: input.bundle,
    executionId: input.executionId,
    roots: immutableCandidateValue(input.roots),
    profilePlan: Object.freeze({
      value: profilePlan,
      bytes: Uint8Array.from(input.profilePlan.bytes),
      written: Object.freeze([...input.profilePlan.written]),
    }),
    executionPlan: Object.freeze({
      value: executionPlan,
      bytes: Uint8Array.from(input.executionPlan.bytes),
    }),
    materializationReceipt,
    launch: immutableCandidateValue(input.launch),
    instruction: Object.freeze({
      bytes: Uint8Array.from(input.instruction.bytes),
      delivery: immutableCandidateValue(input.instruction.delivery),
    }),
    resolvedModel: immutableCandidateValue(input.resolvedModel),
    preparationId: input.preparationId,
    reservationExpiresAtMs: input.reservationExpiresAtMs,
    cleanupTimeoutMs: input.cleanupTimeoutMs,
    resultTimeoutMs: input.resultTimeoutMs,
    modelReservation: immutableCandidateValue(input.modelReservation),
    executorInputs: Object.freeze({
      taskFiles: immutableExecutorFiles(input.executorInputs.taskFiles),
      ...(input.executorInputs.candidateFiles
        ? { candidateFiles: immutableExecutorFiles(input.executorInputs.candidateFiles) }
        : {}),
      profileFiles: Object.freeze(
        input.executorInputs.profileFiles.map((file) =>
          Object.freeze({ ...file, bytes: Uint8Array.from(file.bytes) }),
        ),
      ),
    }),
    ...(input.memoryReservation
      ? { memoryReservation: immutableCandidateValue(input.memoryReservation) }
      : {}),
    ...(input.knowledge
      ? {
          knowledge: Object.freeze({
            candidate: immutableCandidateValue(input.knowledge.candidate),
            snapshot: immutableCandidateValue(input.knowledge.snapshot),
            files: immutableExecutorFiles(input.knowledge.files),
            ...(input.knowledge.retrievalConfig
              ? { retrievalConfig: Uint8Array.from(input.knowledge.retrievalConfig) }
              : {}),
          }),
        }
      : {}),
    trace: immutableCandidateValue(input.trace),
    memory: immutableCandidateValue(input.memory),
  })
}

function assertPrivateCandidateIntegrity(state: PreparedCandidateState): void {
  const bundleMaterial = omitTopLevelDigest(state.bundle)
  if (canonicalCandidateDigest(bundleMaterial) !== state.bundle.digest) {
    throw new Error('prepared candidate bundle no longer matches its digest')
  }
  assertPlanEvidence(state.profilePlan.value, state.profilePlan.bytes, 'profile plan')
  assertPlanEvidence(state.executionPlan.value, state.executionPlan.bytes, 'execution plan')
  agentCandidateExecutionPlanEvidenceSchema.parse(state.executionPlan.value)

  const receipt = agentCandidateMaterializationReceiptSchema.parse(
    state.materializationReceipt.value,
  )
  const receiptBytes = canonicalCandidateBytes(omitTopLevelDigest(receipt))
  if (
    canonicalCandidateDigest(omitTopLevelDigest(receipt)) !== state.materializationReceipt.digest ||
    !Buffer.from(receiptBytes).equals(Buffer.from(state.materializationReceipt.bytes))
  ) {
    throw new Error('prepared materialization receipt no longer matches its canonical bytes')
  }

  const instruction = state.executionPlan.value.material.task.instruction
  if (
    sha256Bytes(state.instruction.bytes) !== instruction.sha256 ||
    state.instruction.bytes.byteLength !== instruction.byteLength ||
    JSON.stringify(state.instruction.delivery) !== JSON.stringify(instruction.delivery)
  ) {
    throw new Error('prepared instruction no longer matches the signed execution plan')
  }
  if (
    !/^candidate-preparation-v1\.[A-Za-z0-9_-]{43}$/.test(state.preparationId) ||
    !Number.isSafeInteger(state.reservationExpiresAtMs) ||
    state.reservationExpiresAtMs <= 0 ||
    !Number.isSafeInteger(state.cleanupTimeoutMs) ||
    state.cleanupTimeoutMs <= 0 ||
    !Number.isSafeInteger(state.resultTimeoutMs) ||
    state.resultTimeoutMs <= 0 ||
    JSON.stringify(state.resolvedModel) !==
      JSON.stringify(state.executionPlan.value.material.model.resolved) ||
    state.modelReservation.digest !== state.executionPlan.value.material.model.access.grantDigest ||
    state.modelReservation.preparationId !== state.preparationId ||
    state.modelReservation.expiresAtMs !== state.reservationExpiresAtMs ||
    canonicalCandidateDigest(state.modelReservation.network) !==
      canonicalCandidateDigest(state.executionPlan.value.material.model.access.network) ||
    canonicalCandidateDigest(state.modelReservation.enforcedLimits) !==
      canonicalCandidateDigest(modelLimits(state.executionPlan.value.material.limits))
  ) {
    throw new Error('prepared model access no longer matches the signed execution plan')
  }
  assertExecutorInputs(state)
  assertPreparedKnowledge(state)
  if (
    (state.memory.mode === 'isolated' && !state.memoryReservation) ||
    (state.memory.mode === 'disabled' && state.memoryReservation)
  ) {
    throw new Error('prepared memory reservation does not match the signed execution plan')
  }
  if (
    state.memory.mode === 'isolated' &&
    state.memoryReservation &&
    (state.memoryReservation.preparationId !== state.preparationId ||
      state.memoryReservation.expiresAtMs !== state.reservationExpiresAtMs ||
      state.memoryReservation.effectiveNamespace !== state.memory.effectiveNamespace)
  ) {
    throw new Error('prepared memory reservation identity no longer matches the execution')
  }
  if (JSON.stringify(state.memory) !== JSON.stringify(state.executionPlan.value.material.memory)) {
    throw new Error('prepared memory no longer matches the signed execution plan')
  }

  const expectedTags = {
    [CANDIDATE_TRACE_TAGS.executionId]: state.executionId,
    [CANDIDATE_TRACE_TAGS.bundleDigest]: state.bundle.digest,
    [CANDIDATE_TRACE_TAGS.executionPlanDigest]: state.executionPlan.value.digest,
    [CANDIDATE_TRACE_TAGS.materializationReceiptDigest]: state.materializationReceipt.digest,
  }
  const expectedTraceEnvironment = {
    [CANDIDATE_TRACE_ENV.executionId]: state.executionId,
    [CANDIDATE_TRACE_ENV.bundleDigest]: state.bundle.digest,
    [CANDIDATE_TRACE_ENV.executionPlanDigest]: state.executionPlan.value.digest,
    [CANDIDATE_TRACE_ENV.materializationReceiptDigest]: state.materializationReceipt.digest,
    [CANDIDATE_TRACE_ENV.traceRunId]: state.trace.runId,
  }
  if (
    !state.trace.runId.startsWith(
      `${state.executionId}:attempt-${state.executionPlan.value.material.attempt.number}:`,
    ) ||
    canonicalCandidateDigest(state.trace.tags) !== canonicalCandidateDigest(expectedTags) ||
    canonicalCandidateDigest(state.trace.env) !== canonicalCandidateDigest(expectedTraceEnvironment)
  ) {
    throw new Error('prepared trace identity no longer matches the signed execution')
  }
}

function assertPlanEvidence(
  evidence:
    | PreparedAgentCandidateExecution['profilePlan']['value']
    | PreparedAgentCandidateExecution['executionPlan']['value'],
  bytes: Uint8Array,
  label: string,
): void {
  const expected = canonicalCandidateBytes(evidence.material)
  if (
    sha256Bytes(expected) !== evidence.digest ||
    !Buffer.from(expected).equals(Buffer.from(bytes)) ||
    evidence.artifact.sha256 !== evidence.digest ||
    evidence.artifact.byteLength !== bytes.byteLength ||
    !('content' in evidence.artifact) ||
    !Buffer.from(evidence.artifact.content, 'base64').equals(Buffer.from(bytes))
  ) {
    throw new Error(`prepared ${label} no longer matches its canonical bytes`)
  }
}

function evidenceView<T extends { value: unknown; bytes: Uint8Array }>(evidence: T): T {
  const bytes = Uint8Array.from(evidence.bytes)
  return Object.freeze({
    ...evidence,
    get bytes(): Uint8Array {
      return Uint8Array.from(bytes)
    },
  })
}

function bytesView<T extends { bytes: Uint8Array }>(value: T, key: 'bytes'): T {
  const bytes = Uint8Array.from(value.bytes)
  return Object.freeze({
    ...value,
    get [key](): Uint8Array {
      return Uint8Array.from(bytes)
    },
  })
}

function knowledgeView(
  knowledge: NonNullable<PreparedAgentCandidateExecution['knowledge']>,
): NonNullable<PreparedAgentCandidateExecution['knowledge']> {
  const retrievalConfig = knowledge.retrievalConfig
    ? Uint8Array.from(knowledge.retrievalConfig)
    : undefined
  return Object.freeze({
    candidate: knowledge.candidate,
    snapshot: knowledge.snapshot,
    files: Object.freeze(knowledge.files.map((file) => profileFileView(file))),
    ...(retrievalConfig
      ? {
          get retrievalConfig(): Uint8Array {
            return Uint8Array.from(retrievalConfig)
          },
        }
      : {}),
  })
}

function workspaceInputView(
  snapshot: AgentCandidateExecutorRequest['inputs']['task']['snapshot'],
  sourceFiles: PreparedCandidateState['executorInputs']['taskFiles'],
): AgentCandidateExecutorRequest['inputs']['task'] {
  return Object.freeze({
    snapshot,
    files: Object.freeze(sourceFiles.map((file) => profileFileView(file))),
  })
}

function profileFileView(
  source: PreparedCandidateState['executorInputs']['profileFiles'][number],
): AgentCandidateExecutorRequest['inputs']['profile']['files'][number] {
  const bytes = Uint8Array.from(source.bytes)
  return Object.freeze({
    path: source.path,
    mode: source.mode,
    get bytes(): Uint8Array {
      return Uint8Array.from(bytes)
    },
  })
}

function assertExecutorInputs(state: PreparedCandidateState): void {
  const material = state.executionPlan.value.material
  assertWorkspaceExecutorFiles(state.executorInputs.taskFiles, material.task.workspace.material)
  if (material.candidateWorkspace) {
    if (!state.executorInputs.candidateFiles) {
      throw new Error('prepared candidate executor files are missing')
    }
    assertWorkspaceExecutorFiles(
      state.executorInputs.candidateFiles,
      material.candidateWorkspace.material,
    )
  } else if (state.executorInputs.candidateFiles) {
    throw new Error('disabled candidate has executor files')
  }

  const expectedFiles = state.profilePlan.value.material.files
  if (state.executorInputs.profileFiles.length !== expectedFiles.length) {
    throw new Error('prepared profile executor files do not match the signed profile plan')
  }
  for (let index = 0; index < expectedFiles.length; index++) {
    const expected = expectedFiles[index]
    const actual = state.executorInputs.profileFiles[index]
    if (
      !expected ||
      !actual ||
      actual.path !== expected.relPath ||
      actual.mode !== expected.mode ||
      sha256Bytes(actual.bytes) !== expected.contentSha256
    ) {
      throw new Error('prepared profile executor files do not match the signed profile plan')
    }
  }
}

function assertPreparedKnowledge(state: PreparedCandidateState): void {
  const expected = state.bundle.knowledge
  const actual = state.knowledge
  if (!expected || !actual) {
    if (expected || actual)
      throw new Error('prepared knowledge does not match the candidate bundle')
    return
  }
  if (
    canonicalCandidateDigest(actual.candidate) !== canonicalCandidateDigest(expected.candidate) ||
    canonicalCandidateDigest(actual.snapshot) !== canonicalCandidateDigest(expected.snapshot) ||
    state.executionPlan.value.material.knowledgeManifestDigest !== expected.snapshot.digest
  ) {
    throw new Error('prepared knowledge identity does not match the candidate bundle')
  }
  assertWorkspaceExecutorFiles(actual.files, expected.snapshot.material)
  if (!expected.retrievalConfig || !actual.retrievalConfig) {
    if (expected.retrievalConfig || actual.retrievalConfig) {
      throw new Error('prepared knowledge retrieval config does not match the candidate bundle')
    }
    return
  }
  if (
    actual.retrievalConfig.byteLength !== expected.retrievalConfig.byteLength ||
    sha256Bytes(actual.retrievalConfig) !== expected.retrievalConfig.sha256
  ) {
    throw new Error('prepared knowledge retrieval config does not match the candidate bundle')
  }
}

function assertWorkspaceExecutorFiles(
  actualFiles: PreparedCandidateState['executorInputs']['taskFiles'],
  expected: PreparedAgentCandidateExecution['executionPlan']['value']['material']['task']['workspace']['material'],
): void {
  if (actualFiles.length !== expected.files.length) {
    throw new Error('prepared workspace executor files do not match the signed manifest')
  }
  for (let index = 0; index < expected.files.length; index++) {
    const actual = actualFiles[index]
    const planned = expected.files[index]
    if (
      !actual ||
      !planned ||
      actual.path !== planned.path ||
      actual.mode !== planned.mode ||
      actual.bytes.byteLength !== planned.byteLength ||
      sha256Bytes(actual.bytes) !== planned.sha256
    ) {
      throw new Error('prepared workspace executor files do not match the signed manifest')
    }
  }
}

function immutableExecutorFiles(
  files: PreparedCandidateState['executorInputs']['taskFiles'],
): ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }> {
  return Object.freeze(
    files.map((file) => Object.freeze({ ...file, bytes: Uint8Array.from(file.bytes) })),
  )
}

function modelLimits(
  limits: PreparedAgentCandidateExecution['executionPlan']['value']['material']['limits'],
): AgentCandidateProtectedModelReservation['enforcedLimits'] {
  return {
    maxModelCalls: limits.maxModelCalls,
    maxInputTokens: limits.maxInputTokens,
    maxOutputTokens: limits.maxOutputTokens,
    maxCostUsd: limits.maxCostUsd,
  }
}

function transitionLifecycle(
  prepared: PreparedAgentCandidateExecution,
  expected: ReadonlyArray<
    | 'prepared'
    | 'claiming'
    | 'claimed'
    | 'running'
    | 'settling'
    | 'disposing'
    | 'succeeded'
    | 'failed'
    | 'disposal-failed'
    | 'cleanup-failed'
    | 'disposed'
  >,
  next:
    | 'claiming'
    | 'claimed'
    | 'running'
    | 'settling'
    | 'disposing'
    | 'succeeded'
    | 'failed'
    | 'disposal-failed'
    | 'cleanup-failed'
    | 'disposed',
): void {
  const lifecycle = lifecycleByExecution.get(prepared)
  if (!lifecycle || !expected.includes(lifecycle.status)) {
    throw new Error(`prepared candidate execution is already ${lifecycle?.status ?? 'unknown'}`)
  }
  lifecycle.status = next
}

function assertProtectedEnvironment(
  state: PreparedCandidateState,
  modelEnvironment: Readonly<Record<string, string>>,
  memoryEnvironment: Readonly<Record<string, string>> | undefined,
): void {
  const seen = new Set([...Object.keys(state.launch.env), ...Object.keys(state.trace.env)])
  for (const [name, value] of [
    ...Object.entries(modelEnvironment),
    ...Object.entries(memoryEnvironment ?? {}),
  ]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== 'string' || value.length < 8) {
      throw new Error('protected model activation contains an invalid environment binding')
    }
    if (seen.has(name)) {
      throw new Error(`protected model activation collides with environment binding ${name}`)
    }
    seen.add(name)
  }
}
