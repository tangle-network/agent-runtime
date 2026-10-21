import { randomBytes } from 'node:crypto'
import { isAbsolute, relative, resolve as resolveHostPath } from 'node:path'
import {
  type AgentCandidateEffectiveMemory,
  type AgentCandidateExecutionLimits,
  type AgentCandidateResolvedModel,
  agentCandidateBenchmarkSuiteSchema,
  agentCandidateBenchmarkTaskSchema,
  agentCandidateContainerSchema,
  agentCandidateExecutionLimitsSchema,
  agentCandidateModelAccessNetworkSchema,
  agentCandidateRunCellSchema,
  agentCandidateTaskOutcomeSpecSchema,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
  type Sha256Digest,
  sha256DigestSchema,
} from '@tangle-network/agent-interface'
import { errorMessage } from '../runtime/util'
import { readVerifiedArtifact, verifyWorkspaceSnapshotArtifacts } from './artifacts'
import {
  candidateCleanupDeadline,
  candidateCleanupTimeout,
  candidateResultTimeout,
  MAX_CANDIDATE_TIMER_INTERVAL_MS,
  withinCandidateCleanupDeadline,
} from './cleanup'
import { canonicalCandidateDigest, omitTopLevelDigest } from './digest'
import { isWellFormedUnicode } from './exact-object'
import { assertAgentCandidateExecutionRoots, executionPathsOverlap } from './execution-roots'
import { candidateExecutionOwnerWindowMs } from './execution-window'
import { candidateKnowledgeExecutionPaths, prepareAgentCandidateKnowledge } from './knowledge'
import { sealAgentCandidateModelSettlement, usdToNanos } from './model-settlement'
import {
  candidateTraceBindings,
  executionPlanMaterial,
  launchEnvironment,
  type ModelReservation,
  sealExecutionPlan,
  sealMaterializationReceipt,
  unwrapPublicEnvironment,
} from './prepare-plan'
import {
  type ExecutorWorkspaceFiles,
  type MaterializedCandidateProfile,
  materializeCandidateWorkspace,
  materializeTaskWorkspace,
  stageCandidateProfile,
} from './prepare-workspaces'
import { createPreparedCandidateExecution } from './prepared-state'
import { absoluteExecutionCwd, buildLaunch, exactProfileExecutorFiles } from './profile'
import { modelLimits } from './protected-model-port'
import { requirePublicCandidateConfigValue } from './public-config'
import type {
  AgentCandidateExecutionPorts,
  AgentCandidateTaskExecution,
  PreparedAgentCandidateExecution,
  ResolvedAgentCandidateContainer,
  VerifiedAgentCandidate,
} from './types'
import { getVerifiedCandidateState, verifiedArtifactBytes } from './verify'

const MIN_RESERVATION_TTL_MS = 15 * 60_000
const PREPARED_HOLD_MARGIN_MS = 5 * 60_000

export interface PrepareAgentCandidateExecutionOptions {
  cleanupTimeoutMs?: number
  /** Maximum time for task verification, executable grading, and receipt construction. */
  resultTimeoutMs?: number
}

/** Materializes a verified candidate into one immutable evaluator-owned execution plan. */
export async function prepareAgentCandidateExecution(
  candidate: VerifiedAgentCandidate,
  task: AgentCandidateTaskExecution,
  ports: AgentCandidateExecutionPorts,
  options: PrepareAgentCandidateExecutionOptions = {},
): Promise<PreparedAgentCandidateExecution> {
  const { cleanupTimeoutMs, resultTimeoutMs, reservationWindowMs } = checkPreparation(
    candidate,
    task,
    ports,
    options,
  )
  const bundle = candidate.bundle
  const benchmarkTask = task.task
  const instructionBytes = Buffer.from(benchmarkTask.instruction, 'utf8')
  const taskExecutorFiles = await materializeTaskWorkspace(task, ports)
  const candidateExecutorFiles = await materializeCandidateWorkspace(candidate, task, ports)
  const profile = await stageCandidateProfile(candidate, task, ports)

  const container = await resolveContainer(candidate, task, ports)
  const resolvedModel = await resolveModel(candidate, task, ports)
  const preparationId = `candidate-preparation.${randomBytes(32).toString('base64url')}`
  const reservationExpiresAtMs = Date.now() + Math.max(MIN_RESERVATION_TTL_MS, reservationWindowMs)
  const modelReservation = await withinCandidateCleanupDeadline(
    () =>
      ports.models.reserveGrant({
        executionId: task.executionId,
        preparationId,
        expiresAtMs: reservationExpiresAtMs,
        attempt: attemptOf(task),
        bundleDigest: bundle.digest,
        resolved: resolvedModel,
        limits: modelLimits(benchmarkTask.limits),
      }),
    candidateCleanupDeadline(cleanupTimeoutMs),
    'protected model reservation',
  )
  let preparedMemory: Awaited<ReturnType<typeof prepareMemory>> | undefined
  try {
    validateProtectedModelReservation(
      modelReservation,
      benchmarkTask.limits,
      preparationId,
      reservationExpiresAtMs,
    )
    preparedMemory = await prepareMemory(
      candidate,
      task,
      ports,
      preparationId,
      reservationExpiresAtMs,
      cleanupTimeoutMs,
    )
    return await assemblePrepared({
      candidate,
      task,
      ports,
      cleanupTimeoutMs,
      resultTimeoutMs,
      taskExecutorFiles,
      candidateExecutorFiles,
      profile,
      container,
      resolvedModel,
      preparationId,
      reservationExpiresAtMs,
      modelReservation,
      preparedMemory,
      instructionBytes,
    })
  } catch (error) {
    await cleanupFailedPreparation(
      {
        task,
        ports,
        preparationId,
        cleanupTimeoutMs,
        modelGrantDigest: modelReservation.digest,
        resolvedModel,
        ...(preparedMemory?.value.mode === 'isolated'
          ? {
              memory: {
                accessDigest: preparedMemory.accessDigest,
                effectiveNamespace: preparedMemory.value.effectiveNamespace,
              },
            }
          : {}),
      },
      error,
    )
    throw error
  }
}

const attemptOf = (task: AgentCandidateTaskExecution) =>
  ({
    number: task.runCell.attempt,
    maxAttempts: task.task.attempt.maxAttempts,
    retryPolicy: task.task.attempt.retryPolicy,
  }) as const

/** Check the call before any compute, and size its timeouts and reservation window. */
function checkPreparation(
  candidate: VerifiedAgentCandidate,
  task: AgentCandidateTaskExecution,
  ports: AgentCandidateExecutionPorts,
  options: PrepareAgentCandidateExecutionOptions,
): { cleanupTimeoutMs: number; resultTimeoutMs: number; reservationWindowMs: number } {
  const cleanupTimeoutMs = candidateCleanupTimeout(options.cleanupTimeoutMs)
  const verifiedState = getVerifiedCandidateState(candidate)
  assertSameVerificationPorts(verifiedState.ports, ports)
  const bundle = candidate.bundle
  if (task.runCell.bundleDigest !== bundle.digest) {
    throw new Error('candidate experiment cell does not bind the verified bundle')
  }
  const benchmarkTask = task.task
  assertTaskInput(task, bundle.execution.instructionDelivery)
  const resultTimeoutMs = candidateResultTimeout(
    options.resultTimeoutMs,
    benchmarkTask.limits.timeoutMs,
  )
  const ownerWindowMs = candidateExecutionOwnerWindowMs(
    benchmarkTask.limits.timeoutMs,
    cleanupTimeoutMs,
    resultTimeoutMs,
  )
  const reservationWindowMs = ownerWindowMs + PREPARED_HOLD_MARGIN_MS
  if (reservationWindowMs > MAX_CANDIDATE_TIMER_INTERVAL_MS) {
    throw new Error('candidate reservation window exceeds the supported timer range')
  }
  assertDisjointHostStagingRoots(task)
  return { cleanupTimeoutMs, resultTimeoutMs, reservationWindowMs }
}

/** Everything a preparation holds once its protected access is reserved. */
interface PreparationHold {
  candidate: VerifiedAgentCandidate
  task: AgentCandidateTaskExecution
  ports: AgentCandidateExecutionPorts
  cleanupTimeoutMs: number
  resultTimeoutMs: number
  taskExecutorFiles: ExecutorWorkspaceFiles
  candidateExecutorFiles: ExecutorWorkspaceFiles | undefined
  profile: MaterializedCandidateProfile
  container: ResolvedAgentCandidateContainer
  resolvedModel: AgentCandidateResolvedModel
  preparationId: string
  reservationExpiresAtMs: number
  modelReservation: ModelReservation
  preparedMemory: Awaited<ReturnType<typeof prepareMemory>>
  instructionBytes: Buffer
}

/** Seal the plan and receipt over what the preparation staged and reserved, and freeze it. */
async function assemblePrepared(hold: PreparationHold): Promise<PreparedAgentCandidateExecution> {
  const { candidate, task, ports, profile, container, resolvedModel, preparedMemory } = hold
  const { bundle } = candidate
  const memory = preparedMemory.value
  const knowledge = await prepareAgentCandidateKnowledge(candidate, ports, task.runCell.arm)
  const knowledgePaths = knowledge
    ? candidateKnowledgeExecutionPaths(
        task.executionRoots.taskRoot,
        knowledge.retrievalConfig !== undefined,
      )
    : undefined
  const baseLaunch = buildLaunch(candidate, task, profile.application.flags)
  const publicEnv = launchEnvironment(candidate, profile, knowledgePaths)
  const executionPlan = sealExecutionPlan(
    executionPlanMaterial({
      candidate,
      task,
      profile,
      container,
      resolvedModel,
      modelReservation: hold.modelReservation,
      launch: baseLaunch,
      publicEnv,
      memory,
    }),
  )
  const materializationReceipt = sealMaterializationReceipt({
    candidate,
    task,
    profile,
    executionPlan: executionPlan.evidence,
    container,
    resolvedModel,
  })
  const trace = candidateTraceBindings({
    task,
    bundleDigest: bundle.digest,
    attemptNumber: task.runCell.attempt,
    preparationId: hold.preparationId,
    executionPlanDigest: executionPlan.evidence.digest,
    materializationReceiptDigest: materializationReceipt.digest,
    publicEnv,
  })
  const { modelReservation } = hold
  return createPreparedCandidateExecution({
    ports,
    bundle,
    benchmarkSuite: task.benchmarkSuite,
    benchmarkTask: task.task,
    executionId: task.executionId,
    roots: {
      execution: { ...task.executionRoots },
      staging: { ...task.stagingRoots },
    },
    profilePlan: {
      value: profile.application.profileActivation.profilePlan,
      bytes: profile.planBytes,
      written: [...profile.application.application.mountPaths],
    },
    profileActivation: profile.application.profileActivation,
    executionPlan: { value: executionPlan.evidence, bytes: executionPlan.bytes },
    materializationReceipt,
    launch: {
      executable: baseLaunch.executable,
      args: baseLaunch.args.map((value, index) =>
        requirePublicCandidateConfigValue(value, `launch.args[${index}]`),
      ),
      env: unwrapPublicEnvironment(publicEnv),
      flags: profile.application.flags.map((value, index) =>
        requirePublicCandidateConfigValue(value, `profile.flags[${index}]`),
      ),
      cwd: absoluteExecutionCwd(bundle.execution.cwd, task.executionRoots),
    },
    instruction: {
      bytes: Uint8Array.from(hold.instructionBytes),
      delivery: bundle.execution.instructionDelivery,
    },
    resolvedModel,
    preparationId: hold.preparationId,
    reservationExpiresAtMs: hold.reservationExpiresAtMs,
    cleanupTimeoutMs: hold.cleanupTimeoutMs,
    resultTimeoutMs: hold.resultTimeoutMs,
    modelReservation: {
      preparationId: modelReservation.preparationId,
      digest: modelReservation.digest,
      expiresAtMs: modelReservation.expiresAtMs,
      enforcedLimits: modelReservation.enforcedLimits,
      network: modelReservation.network,
    },
    executorInputs: {
      taskFiles: hold.taskExecutorFiles,
      ...(hold.candidateExecutorFiles ? { candidateFiles: hold.candidateExecutorFiles } : {}),
      profileFiles: exactProfileExecutorFiles(
        profile.workspacePlan.files,
        profile.application.profileActivation.profilePlan.material.files,
      ),
    },
    ...(preparedMemory.accessDigest && memory.mode === 'isolated'
      ? {
          memoryReservation: {
            preparationId: hold.preparationId,
            accessDigest: preparedMemory.accessDigest,
            expiresAtMs: hold.reservationExpiresAtMs,
            effectiveNamespace: memory.effectiveNamespace,
          },
        }
      : {}),
    ...(knowledge ? { knowledge } : {}),
    trace,
    memory,
  })
}

function assertSameVerificationPorts(
  verified: AgentCandidateExecutionPorts | { artifacts: unknown; repositories: unknown },
  execution: AgentCandidateExecutionPorts,
): void {
  if (
    verified.artifacts !== execution.artifacts ||
    verified.repositories !== execution.repositories
  ) {
    throw new Error(
      'prepare must use the same artifact and repository ports that verified the bundle',
    )
  }
}

function assertTaskInput(
  task: AgentCandidateTaskExecution,
  delivery: VerifiedAgentCandidate['bundle']['execution']['instructionDelivery'],
): void {
  const benchmarkTask = agentCandidateBenchmarkTaskSchema.parse(task.task)
  const benchmarkSuite = agentCandidateBenchmarkSuiteSchema.parse(task.benchmarkSuite)
  const runCell = agentCandidateRunCellSchema.parse(task.runCell)
  const requiredStrings: Array<[string, string]> = [
    ['executionId', task.executionId],
    ['benchmark', benchmarkTask.benchmark.name],
    ['benchmarkVersion', benchmarkTask.benchmark.version],
    ['taskId', benchmarkTask.scenario.id],
  ]
  if (benchmarkTask.outcome.kind === 'workspace' && !benchmarkTask.repository) {
    throw new Error('workspace task outcome requires repository identity')
  }
  if (benchmarkTask.repository) {
    requiredStrings.push(
      ['repository identity', benchmarkTask.repository.identity],
      ['repository root identity', benchmarkTask.repository.rootIdentity],
    )
  }
  for (const [name, value] of requiredStrings) {
    if (!value.trim()) throw new Error(`${name} must be non-empty`)
  }
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(task.executionId)) {
    throw new Error('executionId must be a stable filesystem-neutral identifier')
  }
  if (!benchmarkTask.instruction || !isWellFormedUnicode(benchmarkTask.instruction)) {
    throw new Error('task instruction must be non-empty well-formed Unicode')
  }
  if (
    canonicalCandidateDigest(omitTopLevelDigest(benchmarkTask)) !== benchmarkTask.digest ||
    canonicalCandidateDigest(omitTopLevelDigest(benchmarkSuite)) !== benchmarkSuite.digest ||
    canonicalCandidateDigest(omitTopLevelDigest(runCell)) !== runCell.digest
  ) {
    throw new Error('candidate experiment cell contains an invalid content digest')
  }
  const cellIndex = runCell.taskIndex * benchmarkSuite.reps + runCell.repetition
  if (
    runCell.suiteDigest !== benchmarkSuite.digest ||
    runCell.taskDigest !== benchmarkTask.digest ||
    benchmarkSuite.taskDigests[runCell.taskIndex] !== benchmarkTask.digest ||
    runCell.repetition >= benchmarkSuite.reps ||
    benchmarkSuite.seeds[cellIndex] !== runCell.seed ||
    runCell.attempt > benchmarkTask.attempt.maxAttempts
  ) {
    throw new Error('candidate experiment cell does not match its signed suite and task')
  }
  sha256DigestSchema.parse(benchmarkTask.benchmark.splitDigest)
  agentCandidateTaskOutcomeSpecSchema.parse(benchmarkTask.outcome)
  agentCandidateWorkspaceSnapshotEvidenceSchema.parse(benchmarkTask.workspace)
  agentCandidateExecutionLimitsSchema.parse(benchmarkTask.limits)
  if (benchmarkTask.repository) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(benchmarkTask.repository.baseCommit)) {
      throw new Error('task repository base commit is not a full Git object id')
    }
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(benchmarkTask.repository.baseTree)) {
      throw new Error('task repository base tree is not a full Git object id')
    }
    if (benchmarkTask.repository.baseCommit.length !== benchmarkTask.repository.baseTree.length) {
      throw new Error('task repository Git object formats disagree')
    }
  }
  assertAgentCandidateExecutionRoots(task.executionRoots)
  for (const [name, root] of [
    ['staging task root', task.stagingRoots.taskRoot],
    ['staging candidate root', task.stagingRoots.candidateRoot],
    ['staging profile root', task.stagingRoots.profileRoot],
  ] as const) {
    if (root === undefined) continue
    const canonical = isAbsolute(root) && resolveHostPath(root) === root
    if (!canonical) throw new Error(`${name} must be a canonical absolute path`)
  }
  if (
    !Number.isInteger(runCell.attempt) ||
    !Number.isInteger(benchmarkTask.attempt.maxAttempts) ||
    runCell.attempt < 1 ||
    runCell.attempt > benchmarkTask.attempt.maxAttempts ||
    (benchmarkTask.attempt.retryPolicy === 'none' && benchmarkTask.attempt.maxAttempts !== 1)
  ) {
    throw new Error('task attempt policy is invalid')
  }
  const limits = benchmarkTask.limits
  if (
    !Number.isInteger(limits.timeoutMs) ||
    limits.timeoutMs <= 0 ||
    limits.timeoutMs > MAX_CANDIDATE_TIMER_INTERVAL_MS ||
    !Number.isInteger(limits.maxSteps) ||
    limits.maxSteps <= 0 ||
    !Number.isInteger(limits.maxModelCalls) ||
    limits.maxModelCalls < 0 ||
    !Number.isInteger(limits.maxInputTokens) ||
    limits.maxInputTokens < 0 ||
    !Number.isInteger(limits.maxOutputTokens) ||
    limits.maxOutputTokens < 0 ||
    !Number.isFinite(limits.maxCostUsd) ||
    limits.maxCostUsd < 0
  ) {
    throw new Error('task execution limits are invalid')
  }
  usdToNanos(limits.maxCostUsd, 'task maxCostUsd')
  if (!benchmarkTask.model.requested.trim()) {
    throw new Error('evaluator model request must be non-empty')
  }
  if (!benchmarkTask.grader.name.trim() || !benchmarkTask.grader.version.trim()) {
    throw new Error('evaluator benchmark grader identity must be non-empty')
  }
  if (
    !Number.isInteger(benchmarkTask.grader.artifact.byteLength) ||
    benchmarkTask.grader.artifact.byteLength <= 0
  ) {
    throw new Error('evaluator benchmark grader artifact must be non-empty')
  }
  sha256DigestSchema.parse(benchmarkTask.grader.artifact.sha256)
  if (benchmarkTask.evaluatorTaskContainer) {
    if (
      benchmarkTask.evaluatorTaskContainer.source !== 'evaluator-task-container' ||
      !benchmarkTask.evaluatorTaskContainer.image.trim() ||
      !benchmarkTask.evaluatorTaskContainer.platform.os.trim() ||
      !benchmarkTask.evaluatorTaskContainer.platform.architecture.trim()
    ) {
      throw new Error('evaluator task container evidence is incomplete')
    }
    sha256DigestSchema.parse(benchmarkTask.evaluatorTaskContainer.indexDigest)
    sha256DigestSchema.parse(benchmarkTask.evaluatorTaskContainer.manifestDigest)
    agentCandidateContainerSchema.parse({
      image: benchmarkTask.evaluatorTaskContainer.image,
      indexDigest: benchmarkTask.evaluatorTaskContainer.indexDigest,
    })
  }
  if (delivery.kind === 'utf8-file') {
    if (
      [
        task.executionRoots.taskRoot,
        task.executionRoots.candidateRoot,
        task.executionRoots.profileRoot,
      ].some((root) => root !== undefined && executionPathsOverlap(root, delivery.path))
    ) {
      throw new Error('task instruction file must remain outside execution workspaces')
    }
  }
}

function assertDisjointHostStagingRoots(task: AgentCandidateTaskExecution): void {
  const roots = [
    task.stagingRoots.taskRoot,
    task.stagingRoots.candidateRoot,
    task.stagingRoots.profileRoot,
  ]
    .filter((value): value is string => value !== undefined)
    .map((value) => resolveHostPath(value))
  for (let left = 0; left < roots.length; left++) {
    for (let right = left + 1; right < roots.length; right++) {
      const a = roots[left]
      const b = roots[right]
      if (a && b && (a === b || isContainedPath(a, b) || isContainedPath(b, a))) {
        throw new Error('host task, candidate, and profile staging roots must be disjoint')
      }
    }
  }
}

function isContainedPath(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

async function resolveContainer(
  candidate: VerifiedAgentCandidate,
  task: AgentCandidateTaskExecution,
  ports: AgentCandidateExecutionPorts,
): Promise<ResolvedAgentCandidateContainer> {
  const environment = candidate.bundle.execution.environment
  const evaluatorTaskContainer = task.task.evaluatorTaskContainer
  const pinned = environment.kind === 'pinned-container' ? environment.container : undefined
  if (environment.kind === 'evaluator-task-container' && !evaluatorTaskContainer) {
    throw new Error('evaluator-task-container candidate requires an evaluator-owned task image')
  }
  if (environment.kind === 'pinned-container' && evaluatorTaskContainer) {
    throw new Error('pinned candidate containers cannot be replaced by a task image')
  }
  const resolved = await ports.containers.resolve({
    candidate: pinned,
    evaluatorTaskContainer,
  })
  if (resolved.source !== environment.kind) throw new Error('resolved container source drifted')
  if (pinned && (resolved.image !== pinned.image || resolved.indexDigest !== pinned.indexDigest)) {
    throw new Error('resolved pinned container does not match the candidate image index')
  }
  if (
    evaluatorTaskContainer &&
    canonicalCandidateDigest(resolved) !== canonicalCandidateDigest(evaluatorTaskContainer)
  ) {
    throw new Error('resolved task container does not match evaluator-owned image evidence')
  }
  return resolved
}

async function resolveModel(
  candidate: VerifiedAgentCandidate,
  task: AgentCandidateTaskExecution,
  ports: AgentCandidateExecutionPorts,
): Promise<AgentCandidateResolvedModel> {
  const hints = candidate.bundle.profile.model
  const expected = task.task.model
  if (hints?.default !== undefined && hints.default !== expected.requested) {
    throw new Error('candidate model preference conflicts with the evaluator-owned model')
  }
  if (hints?.reasoningEffort !== undefined && hints.reasoningEffort !== expected.reasoningEffort) {
    throw new Error('candidate reasoning effort conflicts with the evaluator-owned effort')
  }
  const resolved = await ports.models.resolve({
    requested: expected.requested,
    harness: candidate.bundle.execution.harness,
    reasoningEffort: expected.reasoningEffort,
  })
  if (canonicalCandidateDigest(resolved) !== canonicalCandidateDigest(expected)) {
    throw new Error('model resolver drifted from the signed benchmark model')
  }
  return resolved
}

async function prepareMemory(
  candidate: VerifiedAgentCandidate,
  task: AgentCandidateTaskExecution,
  ports: AgentCandidateExecutionPorts,
  preparationId: string,
  expiresAtMs: number,
  cleanupTimeoutMs: number,
): Promise<{
  value: AgentCandidateEffectiveMemory
  accessDigest?: `sha256:${string}`
}> {
  const policy = candidate.bundle.memory
  if (policy.mode === 'disabled') return { value: { mode: 'disabled' } }
  const seed = policy.seed ? await verifiedArtifactBytes(candidate, policy.seed) : undefined
  const executionSegment = canonicalCandidateDigest({ executionId: task.executionId }).slice(7)
  const taskSegment = canonicalCandidateDigest({ taskDigest: task.task.digest }).slice(7)
  const preparationSegment = canonicalCandidateDigest({ preparationId }).slice(7, 23)
  const effectiveNamespace = `candidate/${candidate.bundle.digest.slice(7, 23)}/${executionSegment}/${taskSegment}/${preparationSegment}`
  const reset = await withinCandidateCleanupDeadline(
    () =>
      ports.memory.reset({
        executionId: task.executionId,
        preparationId,
        expiresAtMs,
        effectiveNamespace,
        ...(seed ? { seed } : {}),
        ...(policy.seed ? { seedDigest: policy.seed.sha256 } : {}),
      }),
    candidateCleanupDeadline(cleanupTimeoutMs),
    'isolated memory reset',
  )
  try {
    if (
      reset.preparationId !== preparationId ||
      reset.expiresAtMs !== expiresAtMs ||
      !/^sha256:[a-f0-9]{64}$/.test(reset.accessDigest)
    ) {
      throw new Error('isolated memory reservation is not scoped to this preparation')
    }
    await readVerifiedArtifact(reset.evidence, ports.artifacts)
    await verifyWorkspaceSnapshotArtifacts(reset.beforeState, ports.artifacts)
    return {
      value: {
        mode: 'isolated',
        scope: 'task',
        effectiveNamespace,
        reset: {
          kind: 'fresh',
          evidence: reset.evidence,
          emptyStateDigest: reset.emptyStateDigest,
        },
        beforeState: reset.beforeState,
        ...(policy.seed ? { seedDigest: policy.seed.sha256 } : {}),
      },
      accessDigest: reset.accessDigest,
    }
  } catch (error) {
    try {
      const closed = await withinCandidateCleanupDeadline(
        () =>
          ports.memory.close({
            executionId: task.executionId,
            preparationId,
            accessDigest: reset.accessDigest,
            effectiveNamespace,
            reason: 'preparation-failed',
          }),
        candidateCleanupDeadline(cleanupTimeoutMs),
        'invalid isolated memory reset cleanup',
      )
      if (closed.closed !== true || Object.keys(closed).some((key) => key !== 'closed')) {
        throw new Error('invalid isolated memory reset did not acknowledge closure')
      }
    } catch (closeError) {
      throw new Error('isolated memory preparation and cleanup both failed', {
        cause: new AggregateError([error, closeError]),
      })
    }
    throw error
  }
}

function validateProtectedModelReservation(
  reservation: ModelReservation,
  expectedLimits: AgentCandidateExecutionLimits,
  preparationId: string,
  expiresAtMs: number,
): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(reservation.digest)) {
    throw new Error('protected model reservation has an invalid identity digest')
  }
  if (reservation.preparationId !== preparationId || reservation.expiresAtMs !== expiresAtMs) {
    throw new Error('protected model reservation is not scoped to this preparation')
  }
  const limits = modelLimits(expectedLimits)
  if (canonicalCandidateDigest(reservation.enforcedLimits) !== canonicalCandidateDigest(limits)) {
    throw new Error('protected model reservation does not enforce the frozen model limits')
  }
  const expectedNetworkMode = limits.maxModelCalls === 0 ? 'disabled' : 'gateway-only'
  const network = agentCandidateModelAccessNetworkSchema.parse(reservation.network)
  if (network.mode !== expectedNetworkMode) {
    throw new Error('protected model reservation has the wrong network policy for its call limit')
  }
}

/** The reservations a preparation holds, as far as it got. */
interface HeldPreparationAccess {
  readonly task: AgentCandidateTaskExecution
  readonly ports: AgentCandidateExecutionPorts
  readonly preparationId: string
  readonly cleanupTimeoutMs: number
  readonly modelGrantDigest: Sha256Digest
  readonly resolvedModel: AgentCandidateResolvedModel
  /** The isolated memory reservation, once prepared. */
  readonly memory?: { accessDigest: Sha256Digest | undefined; effectiveNamespace: string }
}

/**
 * Close the isolated memory and settle the model grant of a preparation that failed. Throws a
 * combined error, with `cause` set to the preparation's own, when a cleanup fails too.
 */
async function cleanupFailedPreparation(
  held: HeldPreparationAccess,
  error: unknown,
): Promise<void> {
  const { task, ports, preparationId, resolvedModel } = held
  const cleanupDeadlineAtMs = candidateCleanupDeadline(held.cleanupTimeoutMs)
  const cleanup: Array<Promise<unknown>> = []
  if (held.memory !== undefined) {
    const { accessDigest, effectiveNamespace } = held.memory
    if (!accessDigest) throw new Error('isolated memory preparation is missing access identity')
    cleanup.push(
      withinCandidateCleanupDeadline(
        async () => {
          const closed = await ports.memory.close({
            executionId: task.executionId,
            preparationId,
            accessDigest,
            effectiveNamespace,
            reason: 'preparation-failed',
          })
          if (closed.closed !== true || Object.keys(closed).some((key) => key !== 'closed')) {
            throw new Error('failed preparation did not close isolated memory access')
          }
        },
        cleanupDeadlineAtMs,
        'failed preparation memory cleanup',
      ),
    )
  }
  cleanup.push(
    withinCandidateCleanupDeadline(
      async () => {
        const settlement = sealAgentCandidateModelSettlement(
          await ports.models.settleGrant({
            executionId: task.executionId,
            preparationId,
            grantDigest: held.modelGrantDigest,
            resolved: resolvedModel,
            reason: 'preparation-failed',
          }),
          {
            preparationId,
            grantDigest: held.modelGrantDigest,
            model: resolvedModel.model,
          },
        )
        if (settlement.usage.modelCalls !== 0) {
          throw new Error('failed preparation unexpectedly contains model calls')
        }
      },
      cleanupDeadlineAtMs,
      'failed preparation model cleanup',
    ),
  )
  const cleanupResults = await Promise.allSettled(cleanup)
  const cleanupErrors = cleanupResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (cleanupErrors.length > 0) {
    throw new Error(
      `candidate preparation failed and protected access cleanup failed: ${cleanupErrors.map(errorMessage).join('; ')}`,
      { cause: error },
    )
  }
}
