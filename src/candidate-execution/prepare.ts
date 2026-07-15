import { randomBytes } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve as resolveHostPath } from 'node:path'

import type {
  AgentCandidateConfigValue,
  AgentCandidateEffectiveMemory,
  AgentCandidateExecutionLimits,
  AgentCandidateExecutionPlanEvidence,
  AgentCandidateExecutionPlanMaterial,
  AgentCandidateMaterializationReceipt,
  AgentCandidateModelAccessNetwork,
  AgentCandidateResolvedModel,
} from '@tangle-network/agent-interface'
import {
  agentCandidateContainerSchema,
  agentCandidateExecutionLimitsSchema,
  agentCandidateExecutionPlanEvidenceSchema,
  agentCandidateExecutionPlanMaterialSchema,
  agentCandidateMaterializationReceiptSchema,
  agentCandidateModelAccessNetworkSchema,
  agentCandidateTaskOutcomeSpecSchema,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
  sha256DigestSchema,
} from '@tangle-network/agent-interface'
import {
  applyAgentCandidateWorkspacePlan,
  materializeCandidateProfile,
} from '@tangle-network/agent-profile-materialize'

import {
  readMaterializedWorkspaceFiles,
  readVerifiedArtifact,
  verifyMaterializedProfileWorkspace,
  verifyMaterializedWorkspace,
  verifyWorkspaceSnapshotArtifacts,
} from './artifacts'
import {
  candidateCleanupDeadline,
  candidateCleanupTimeout,
  candidateResultTimeout,
  MAX_CANDIDATE_TIMER_INTERVAL_MS,
  withinCandidateCleanupDeadline,
} from './cleanup'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  embeddedCandidateArtifact,
  sha256Bytes,
} from './digest'
import { candidateExecutionOwnerWindowMs } from './execution-window'
import { verifyTaskCheckout } from './git-materialize'
import { sealAgentCandidateModelSettlement, usdToNanos } from './model-settlement'
import { createPreparedCandidateExecution } from './prepared-state'
import { candidateMaterializerHarness, createAgentCandidateProfileActivation } from './profile'
import {
  type AgentCandidateExecutionPorts,
  type AgentCandidateTaskExecution,
  CANDIDATE_TRACE_ENV,
  CANDIDATE_TRACE_TAGS,
  type PreparedAgentCandidateExecution,
  type ResolvedAgentCandidateContainer,
  type VerifiedAgentCandidate,
} from './types'
import {
  getVerifiedCandidateState,
  verifiedArtifactBytes,
  verifiedResourceTextByDigest,
} from './verify'

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
  const cleanupTimeoutMs = candidateCleanupTimeout(options.cleanupTimeoutMs)
  const verifiedState = getVerifiedCandidateState(candidate)
  assertSameVerificationPorts(verifiedState.ports, ports)
  const bundle = candidate.bundle
  const harness = candidateMaterializerHarness(bundle.execution.harness)
  assertTaskInput(task, bundle.execution.instructionDelivery)
  const resultTimeoutMs = candidateResultTimeout(options.resultTimeoutMs, task.limits.timeoutMs)
  const ownerWindowMs = candidateExecutionOwnerWindowMs(
    task.limits.timeoutMs,
    cleanupTimeoutMs,
    resultTimeoutMs,
  )
  const reservationWindowMs = ownerWindowMs + PREPARED_HOLD_MARGIN_MS
  if (reservationWindowMs > MAX_CANDIDATE_TIMER_INTERVAL_MS) {
    throw new Error('candidate reservation window exceeds the supported timer range')
  }
  assertDisjointHostStagingRoots(task)

  const instructionBytes = Buffer.from(task.instruction, 'utf8')
  const instructionDigest = sha256Bytes(instructionBytes)

  const taskArtifacts = await verifyWorkspaceSnapshotArtifacts(task.workspace, ports.artifacts)
  await ports.workspaces.materialize({
    role: 'task',
    snapshot: task.workspace,
    archive: taskArtifacts.archive,
    destination: task.stagingRoots.taskRoot,
  })
  await verifyMaterializedWorkspace(task.stagingRoots.taskRoot, task.workspace.material, {
    ignoredProtectedRootEntries: ['.git', '.sidecar'],
  })
  if (task.repository) {
    await verifyTaskCheckout(task.stagingRoots.taskRoot, task.repository)
  }
  const taskExecutorFiles = await readMaterializedWorkspaceFiles(
    task.stagingRoots.taskRoot,
    task.workspace.material,
    { ignoredProtectedRootEntries: ['.git', '.sidecar'] },
  )

  let candidateArchive: Uint8Array | undefined
  let candidateExecutorFiles:
    | ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>
    | undefined
  if (bundle.execution.workspace) {
    if (!task.stagingRoots.candidateRoot || !task.executionRoots.candidateRoot) {
      throw new Error('active candidate execution requires host and container candidate roots')
    }
    candidateArchive = await verifiedArtifactBytes(candidate, bundle.execution.workspace.archive)
    await ports.workspaces.materialize({
      role: 'candidate',
      snapshot: bundle.execution.workspace,
      archive: candidateArchive,
      destination: task.stagingRoots.candidateRoot,
    })
    await verifyMaterializedWorkspace(
      task.stagingRoots.candidateRoot,
      bundle.execution.workspace.material,
    )
    candidateExecutorFiles = await readMaterializedWorkspaceFiles(
      task.stagingRoots.candidateRoot,
      bundle.execution.workspace.material,
    )
  } else if (task.stagingRoots.candidateRoot || task.executionRoots.candidateRoot) {
    throw new Error('disabled code cannot receive a candidate workspace root')
  }

  await assertEmptyDirectory(task.stagingRoots.profileRoot)
  const profileWorkspacePlan = materializeCandidateProfile(bundle.profile, harness, {
    resolvedResources: verifiedResourceTextByDigest(candidate),
  })
  const profileApplication = applyAgentCandidateWorkspacePlan(
    profileWorkspacePlan,
    task.stagingRoots.profileRoot,
    bundle.execution.cwd.workspace,
  )
  await verifyMaterializedProfileWorkspace(
    task.stagingRoots.profileRoot,
    profileApplication.profilePlan.material,
  )
  const profilePlanBytes = await readVerifiedArtifact(
    profileApplication.profilePlan.artifact,
    ports.artifacts,
  )
  if (
    !Buffer.from(profilePlanBytes).equals(
      Buffer.from(canonicalCandidateBytes(profileApplication.profilePlan.material)),
    )
  ) {
    throw new Error('profile materializer did not capture exact canonical plan bytes')
  }
  const profileActivation = createAgentCandidateProfileActivation(
    profileWorkspacePlan,
    profileApplication.profilePlan,
  )

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
        attempt: task.attempt,
        bundleDigest: bundle.digest,
        resolved: resolvedModel,
        limits: modelLimits(task.limits),
      }),
    candidateCleanupDeadline(cleanupTimeoutMs),
    'protected model reservation',
  )
  let preparedMemory: Awaited<ReturnType<typeof prepareMemory>> | undefined
  try {
    validateProtectedModelReservation(
      modelReservation,
      task.limits,
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
    const memory = preparedMemory.value
    const baseLaunch = buildLaunch(candidate, task, profileApplication.flags)
    const publicEnv = mergePublicEnvironment(
      bundle.execution.env ?? {},
      profileApplication.env,
      bundle.execution.instructionDelivery.kind === 'utf8-file'
        ? {
            [bundle.execution.instructionDelivery.env]: {
              kind: 'public',
              value: bundle.execution.instructionDelivery.path,
            },
          }
        : {},
    )
    const routes = modelRoutes(bundle.profile, task.model.requested)
    const executionMaterial: AgentCandidateExecutionPlanMaterial = {
      kind: 'agent-candidate-execution-plan-material',
      bundleDigest: bundle.digest,
      executionId: task.executionId,
      attempt: task.attempt,
      task: {
        benchmark: task.benchmark,
        benchmarkVersion: task.benchmarkVersion,
        taskId: task.taskId,
        splitDigest: task.splitDigest,
        instruction: {
          encoding: 'utf8',
          sha256: instructionDigest,
          byteLength: instructionBytes.byteLength,
          delivery: bundle.execution.instructionDelivery,
        },
        ...(task.repository ? { repository: task.repository } : {}),
        outcome: task.outcome,
        workspace: task.workspace,
      },
      workspaces: {
        taskRoot: task.executionRoots.taskRoot,
        ...(task.executionRoots.candidateRoot
          ? { candidateRoot: task.executionRoots.candidateRoot }
          : {}),
      },
      codeKind: bundle.code.kind,
      ...(bundle.execution.workspace ? { candidateWorkspace: bundle.execution.workspace } : {}),
      profile: profileApplication.application,
      harness: bundle.execution.harness,
      harnessVersion: bundle.execution.harnessVersion,
      container,
      model: {
        policy: 'single',
        resolved: resolvedModel,
        access: {
          kind: 'evaluator-mediated',
          grantDigest: modelReservation.digest,
          network: modelReservation.network,
        },
        routes,
      },
      grader: task.grader,
      launch: {
        executable: baseLaunch.executable,
        args: baseLaunch.args,
        env: publicEnv,
        cwd: bundle.execution.cwd,
      },
      memory,
      limits: task.limits,
      network: { mode: 'disabled' },
    }
    agentCandidateExecutionPlanMaterialSchema.parse(executionMaterial)
    const executionBytes = canonicalCandidateBytes(executionMaterial)
    const executionDigest = canonicalCandidateDigest(executionMaterial)
    if (sha256Bytes(executionBytes) !== executionDigest) {
      throw new Error('execution plan canonical serializers disagree')
    }
    const executionPlan: AgentCandidateExecutionPlanEvidence =
      agentCandidateExecutionPlanEvidenceSchema.parse({
        kind: 'agent-candidate-execution-plan',
        digest: executionDigest,
        material: executionMaterial,
        artifact: embeddedCandidateArtifact(executionBytes),
      })

    const entrypoint = candidateEntrypointReceipt(candidate)
    const materializationReceipt = canonicalCandidateDocument<AgentCandidateMaterializationReceipt>(
      {
        kind: 'agent-candidate-materialization',
        digestAlgorithm: 'rfc8785-sha256',
        bundleDigest: bundle.digest,
        profilePlan: profileApplication.profilePlan,
        executionPlan,
        ...(bundle.execution.workspace ? { candidateWorkspace: bundle.execution.workspace } : {}),
        codeKind: bundle.code.kind,
        ...(candidate.materializedTree ? { materializedTree: candidate.materializedTree } : {}),
        harness: bundle.execution.harness,
        harnessVersion: bundle.execution.harnessVersion,
        container,
        resolvedModel,
        ...(entrypoint ? { entrypoint } : {}),
      },
    )
    agentCandidateMaterializationReceiptSchema.parse(materializationReceipt.value)

    const traceRunId = `${task.executionId}:attempt-${task.attempt.number}:${canonicalCandidateDigest({ preparationId }).slice(7, 23)}`
    const traceTags = {
      [CANDIDATE_TRACE_TAGS.executionId]: task.executionId,
      [CANDIDATE_TRACE_TAGS.bundleDigest]: bundle.digest,
      [CANDIDATE_TRACE_TAGS.executionPlanDigest]: executionPlan.digest,
      [CANDIDATE_TRACE_TAGS.materializationReceiptDigest]: materializationReceipt.digest,
    }
    const traceEnv = {
      [CANDIDATE_TRACE_ENV.executionId]: task.executionId,
      [CANDIDATE_TRACE_ENV.bundleDigest]: bundle.digest,
      [CANDIDATE_TRACE_ENV.executionPlanDigest]: executionPlan.digest,
      [CANDIDATE_TRACE_ENV.materializationReceiptDigest]: materializationReceipt.digest,
      [CANDIDATE_TRACE_ENV.traceRunId]: traceRunId,
    }
    assertEnvironmentDisjoint(publicEnv, traceEnv)

    return createPreparedCandidateExecution({
      ports,
      bundle,
      executionId: task.executionId,
      roots: {
        execution: { ...task.executionRoots },
        staging: { ...task.stagingRoots },
      },
      profilePlan: {
        value: profileApplication.profilePlan,
        bytes: profilePlanBytes,
        written: [...profileApplication.application.mountPaths],
      },
      profileActivation,
      executionPlan: { value: executionPlan, bytes: executionBytes },
      materializationReceipt,
      launch: {
        executable: baseLaunch.executable,
        args: baseLaunch.args.map((value) => value.value),
        env: unwrapPublicEnvironment(publicEnv),
        flags: profileApplication.flags.map((value) => value.value),
        cwd: absoluteExecutionCwd(bundle.execution.cwd, task.executionRoots),
      },
      instruction: {
        bytes: Uint8Array.from(instructionBytes),
        delivery: bundle.execution.instructionDelivery,
      },
      resolvedModel,
      preparationId,
      reservationExpiresAtMs,
      cleanupTimeoutMs,
      resultTimeoutMs,
      modelReservation: {
        preparationId: modelReservation.preparationId,
        digest: modelReservation.digest,
        expiresAtMs: modelReservation.expiresAtMs,
        enforcedLimits: modelReservation.enforcedLimits,
        network: modelReservation.network,
      },
      executorInputs: {
        taskFiles: taskExecutorFiles,
        ...(candidateExecutorFiles ? { candidateFiles: candidateExecutorFiles } : {}),
      },
      ...(preparedMemory.accessDigest && preparedMemory.value.mode === 'isolated'
        ? {
            memoryReservation: {
              preparationId,
              accessDigest: preparedMemory.accessDigest,
              expiresAtMs: reservationExpiresAtMs,
              effectiveNamespace: preparedMemory.value.effectiveNamespace,
            },
          }
        : {}),
      trace: { runId: traceRunId, tags: traceTags, env: traceEnv },
      memory,
    })
  } catch (error) {
    const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs)
    const cleanup: Array<Promise<unknown>> = []
    if (preparedMemory?.value.mode === 'isolated') {
      const accessDigest = preparedMemory.accessDigest
      const effectiveNamespace = preparedMemory.value.effectiveNamespace
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
              grantDigest: modelReservation.digest,
              resolved: resolvedModel,
              reason: 'preparation-failed',
            }),
            {
              preparationId,
              grantDigest: modelReservation.digest,
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
    throw error
  }
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
  const requiredStrings: Array<[string, string]> = [
    ['executionId', task.executionId],
    ['benchmark', task.benchmark],
    ['benchmarkVersion', task.benchmarkVersion],
    ['taskId', task.taskId],
  ]
  if (task.outcome.kind === 'workspace' && !task.repository) {
    throw new Error('workspace task outcome requires repository identity')
  }
  if (task.repository) {
    requiredStrings.push(
      ['repository identity', task.repository.identity],
      ['repository root identity', task.repository.rootIdentity],
    )
  }
  for (const [name, value] of requiredStrings) {
    if (!value.trim()) throw new Error(`${name} must be non-empty`)
  }
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(task.executionId)) {
    throw new Error('executionId must be a stable filesystem-neutral identifier')
  }
  if (!task.instruction || !isWellFormedUnicode(task.instruction)) {
    throw new Error('task instruction must be non-empty well-formed Unicode')
  }
  sha256DigestSchema.parse(task.splitDigest)
  agentCandidateTaskOutcomeSpecSchema.parse(task.outcome)
  agentCandidateWorkspaceSnapshotEvidenceSchema.parse(task.workspace)
  agentCandidateExecutionLimitsSchema.parse(task.limits)
  if (task.repository) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(task.repository.baseCommit)) {
      throw new Error('task repository base commit is not a full Git object id')
    }
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(task.repository.baseTree)) {
      throw new Error('task repository base tree is not a full Git object id')
    }
    if (task.repository.baseCommit.length !== task.repository.baseTree.length) {
      throw new Error('task repository Git object formats disagree')
    }
  }
  for (const [name, root] of [
    ['execution task root', task.executionRoots.taskRoot],
    ['execution candidate root', task.executionRoots.candidateRoot],
    ['staging task root', task.stagingRoots.taskRoot],
    ['staging candidate root', task.stagingRoots.candidateRoot],
    ['staging profile root', task.stagingRoots.profileRoot],
  ] as const) {
    if (root === undefined) continue
    const canonical = name.startsWith('execution')
      ? posix.isAbsolute(root) && posix.normalize(root) === root
      : isAbsolute(root) && resolveHostPath(root) === root
    if (!canonical) throw new Error(`${name} must be a canonical absolute path`)
  }
  if (
    !Number.isInteger(task.attempt.number) ||
    !Number.isInteger(task.attempt.maxAttempts) ||
    task.attempt.number < 1 ||
    task.attempt.number > task.attempt.maxAttempts ||
    (task.attempt.retryPolicy === 'none' && task.attempt.maxAttempts !== 1)
  ) {
    throw new Error('task attempt policy is invalid')
  }
  const limits = task.limits
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
  if (!task.model.requested.trim()) throw new Error('evaluator model request must be non-empty')
  if (!task.grader.name.trim() || !task.grader.version.trim()) {
    throw new Error('evaluator benchmark grader identity must be non-empty')
  }
  if (!Number.isInteger(task.grader.artifact.byteLength) || task.grader.artifact.byteLength <= 0) {
    throw new Error('evaluator benchmark grader artifact must be non-empty')
  }
  sha256DigestSchema.parse(task.grader.artifact.sha256)
  if (task.evaluatorTaskContainer) {
    if (
      task.evaluatorTaskContainer.source !== 'evaluator-task-container' ||
      !task.evaluatorTaskContainer.image.trim() ||
      !task.evaluatorTaskContainer.platform.os.trim() ||
      !task.evaluatorTaskContainer.platform.architecture.trim()
    ) {
      throw new Error('evaluator task container evidence is incomplete')
    }
    sha256DigestSchema.parse(task.evaluatorTaskContainer.indexDigest)
    sha256DigestSchema.parse(task.evaluatorTaskContainer.manifestDigest)
    agentCandidateContainerSchema.parse({
      image: task.evaluatorTaskContainer.image,
      indexDigest: task.evaluatorTaskContainer.indexDigest,
    })
  }
  if (delivery.kind === 'utf8-file') {
    if (
      executionPathsOverlap(task.executionRoots.taskRoot, delivery.path) ||
      (task.executionRoots.candidateRoot !== undefined &&
        executionPathsOverlap(task.executionRoots.candidateRoot, delivery.path))
    ) {
      throw new Error('task instruction file must remain outside execution workspaces')
    }
  }
}

function executionPathsOverlap(left: string, right: string): boolean {
  const a = posix.normalize(left)
  const b = posix.normalize(right)
  return (
    a === b || b.startsWith(a === '/' ? '/' : `${a}/`) || a.startsWith(b === '/' ? '/' : `${b}/`)
  )
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

async function assertEmptyDirectory(path: string): Promise<void> {
  const stats = await lstat(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('profile staging root must be a real directory')
  }
  if ((await readdir(path)).length !== 0) {
    throw new Error('profile staging root must be empty before materialization')
  }
}

async function resolveContainer(
  candidate: VerifiedAgentCandidate,
  task: AgentCandidateTaskExecution,
  ports: AgentCandidateExecutionPorts,
): Promise<ResolvedAgentCandidateContainer> {
  const environment = candidate.bundle.execution.environment
  const pinned = environment.kind === 'pinned-container' ? environment.container : undefined
  if (environment.kind === 'evaluator-task-container' && !task.evaluatorTaskContainer) {
    throw new Error('evaluator-task-container candidate requires an evaluator-owned task image')
  }
  if (environment.kind === 'pinned-container' && task.evaluatorTaskContainer) {
    throw new Error('pinned candidate containers cannot be replaced by a task image')
  }
  const resolved = await ports.containers.resolve({
    candidate: pinned,
    evaluatorTaskContainer: task.evaluatorTaskContainer,
  })
  if (resolved.source !== environment.kind) throw new Error('resolved container source drifted')
  if (pinned && (resolved.image !== pinned.image || resolved.indexDigest !== pinned.indexDigest)) {
    throw new Error('resolved pinned container does not match the candidate image index')
  }
  if (
    task.evaluatorTaskContainer &&
    JSON.stringify(resolved) !== JSON.stringify(task.evaluatorTaskContainer)
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
  if (hints?.default !== undefined && hints.default !== task.model.requested) {
    throw new Error('candidate model preference conflicts with the evaluator-owned model')
  }
  if (
    hints?.reasoningEffort !== undefined &&
    hints.reasoningEffort !== task.model.reasoningEffort
  ) {
    throw new Error('candidate reasoning effort conflicts with the evaluator-owned effort')
  }
  const resolved = await ports.models.resolve({
    requested: task.model.requested,
    harness: candidate.bundle.execution.harness,
    reasoningEffort: task.model.reasoningEffort,
  })
  if (
    resolved.requested !== task.model.requested ||
    resolved.reasoningEffort !== task.model.reasoningEffort
  ) {
    throw new Error('model resolver drifted from the evaluator-owned request')
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
  const taskSegment = canonicalCandidateDigest({ taskId: task.taskId }).slice(7)
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

function buildLaunch(
  candidate: VerifiedAgentCandidate,
  task: AgentCandidateTaskExecution,
  profileFlags: AgentCandidateConfigValue[],
): { executable: string; args: AgentCandidateConfigValue[] } {
  const launch = candidate.bundle.execution.launch
  if (launch.kind === 'container-command') {
    return { executable: launch.executable, args: [...(launch.args ?? []), ...profileFlags] }
  }
  const candidateRoot = task.executionRoots.candidateRoot
  if (!candidateRoot) throw new Error('candidate entrypoint requires a container candidate root')
  const entrypoint = posix.join(candidateRoot, launch.entrypoint)
  const candidateArgs = launch.args ?? []
  if (launch.interpreter) {
    return {
      executable: launch.interpreter,
      args: [{ kind: 'public', value: entrypoint }, ...candidateArgs, ...profileFlags],
    }
  }
  return { executable: entrypoint, args: [...candidateArgs, ...profileFlags] }
}

function mergePublicEnvironment(
  ...records: Array<Record<string, AgentCandidateConfigValue>>
): Record<string, AgentCandidateConfigValue> {
  const output: Record<string, AgentCandidateConfigValue> = {}
  for (const record of records) {
    for (const [name, value] of Object.entries(record)) {
      const previous = output[name]
      if (previous && previous.value !== value.value) {
        throw new Error(`candidate and profile environment disagree on ${name}`)
      }
      output[name] = value
    }
  }
  return output
}

function unwrapPublicEnvironment(
  values: Record<string, AgentCandidateConfigValue>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.value]))
}

function modelRoutes(
  profile: VerifiedAgentCandidate['bundle']['profile'],
  requested: string,
): AgentCandidateExecutionPlanMaterial['model']['routes'] {
  const routes: AgentCandidateExecutionPlanMaterial['model']['routes'] = [
    { kind: 'primary', requested },
  ]
  if (profile.model?.small) routes.push({ kind: 'small', requested })
  for (const name of Object.keys(profile.modes ?? {}).sort()) {
    if (profile.modes?.[name]?.model) routes.push({ kind: 'mode', name, requested })
  }
  for (const name of Object.keys(profile.subagents ?? {}).sort()) {
    if (profile.subagents?.[name]?.model) routes.push({ kind: 'subagent', name, requested })
  }
  return routes
}

function candidateEntrypointReceipt(
  candidate: VerifiedAgentCandidate,
): { path: string; sha256: `sha256:${string}`; byteLength: number } | undefined {
  const launch = candidate.bundle.execution.launch
  const workspace = candidate.bundle.execution.workspace
  if (launch.kind !== 'candidate-entrypoint' || !workspace) return undefined
  const file = workspace.material.files.find((entry) => entry.path === launch.entrypoint)
  if (!file) throw new Error('candidate entrypoint is absent from the verified workspace')
  return { path: file.path, sha256: file.sha256, byteLength: file.byteLength }
}

function absoluteExecutionCwd(
  cwd: VerifiedAgentCandidate['bundle']['execution']['cwd'],
  roots: AgentCandidateTaskExecution['executionRoots'],
): string {
  const root = cwd.workspace === 'task' ? roots.taskRoot : roots.candidateRoot
  if (!root) throw new Error('candidate cwd is missing its execution workspace root')
  const absolute = cwd.path === '.' ? root : posix.join(root, cwd.path)
  if (absolute !== root && !absolute.startsWith(`${root}/`)) {
    throw new Error('candidate cwd escapes its execution workspace')
  }
  return absolute
}

function validateProtectedModelReservation(
  reservation: {
    preparationId: string
    digest: string
    expiresAtMs: number
    enforcedLimits: {
      maxModelCalls: number
      maxInputTokens: number
      maxOutputTokens: number
      maxCostUsd: number
    }
    network: AgentCandidateModelAccessNetwork
  },
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

function assertEnvironmentDisjoint(
  publicEnv: Record<string, AgentCandidateConfigValue>,
  traceEnv: Record<string, string>,
): void {
  const seen = new Set(Object.keys(publicEnv))
  for (const name of Object.keys(traceEnv)) {
    if (seen.has(name)) throw new Error(`evaluator environment binding collides with ${name}`)
    seen.add(name)
  }
}

function modelLimits(limits: AgentCandidateExecutionLimits): {
  maxModelCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  maxCostUsd: number
} {
  return {
    maxModelCalls: limits.maxModelCalls,
    maxInputTokens: limits.maxInputTokens,
    maxOutputTokens: limits.maxOutputTokens,
    maxCostUsd: limits.maxCostUsd,
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
