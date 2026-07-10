import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve as resolveHostPath } from 'node:path'

import type {
  AgentCandidateConfigValue,
  AgentCandidateEffectiveMemory,
  AgentCandidateExecutionPlanEvidence,
  AgentCandidateExecutionPlanMaterialV1,
  AgentCandidateMaterializationReceipt,
  AgentCandidateResolvedModel,
  HarnessType,
} from '@tangle-network/agent-interface'
import {
  agentCandidateContainerSchema,
  agentCandidateExecutionLimitsSchema,
  agentCandidateExecutionPlanEvidenceSchema,
  agentCandidateExecutionPlanMaterialSchema,
  agentCandidateMaterializationReceiptSchema,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
  sha256DigestSchema,
} from '@tangle-network/agent-interface'
import {
  applyAgentCandidateWorkspacePlan,
  type HarnessId,
  materializeCandidateProfile,
} from '@tangle-network/agent-profile-materialize'

import {
  readVerifiedArtifact,
  verifyMaterializedProfileWorkspace,
  verifyMaterializedWorkspace,
  verifyWorkspaceSnapshotArtifacts,
} from './artifacts'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  embeddedCandidateArtifact,
  sha256Bytes,
} from './digest'
import { verifyTaskCheckout } from './git-materialize'
import { recordPreparedCandidateState } from './prepared-state'
import {
  type AgentCandidateExecutionPorts,
  type AgentCandidateTaskExecution,
  CANDIDATE_TRACE_ENV,
  CANDIDATE_TRACE_TAGS,
  type PreparedAgentCandidateExecution,
  preparedCandidateBrand,
  type ResolvedAgentCandidateContainer,
  type VerifiedAgentCandidate,
} from './types'
import {
  getVerifiedCandidateState,
  verifiedArtifactBytes,
  verifiedResourceTextByDigest,
} from './verify'

const MATERIALIZER_HARNESSES = new Set<HarnessType>([
  'claude-code',
  'claude',
  'claudish',
  'nanoclaw',
  'codex',
  'opencode',
  'kimi-code',
  'kimi',
  'pi',
  'gemini',
  'hermes',
  'openclaw',
])

/** Materializes a verified candidate into one immutable evaluator-owned execution plan. */
export async function prepareAgentCandidateExecution(
  candidate: VerifiedAgentCandidate,
  task: AgentCandidateTaskExecution,
  ports: AgentCandidateExecutionPorts,
): Promise<PreparedAgentCandidateExecution> {
  const verifiedState = getVerifiedCandidateState(candidate)
  assertSameVerificationPorts(verifiedState.ports, ports)
  const bundle = candidate.bundle
  const harness = materializerHarness(bundle.execution.harness)
  assertTaskInput(task, bundle.execution.instructionDelivery)
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
  await verifyTaskCheckout(task.stagingRoots.taskRoot, task.repository)

  let candidateArchive: Uint8Array | undefined
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

  const container = await resolveContainer(candidate, task, ports)
  const resolvedModel = await resolveModel(candidate, task, ports)
  const protectedModelAccess = await ports.models.grant({
    executionId: task.executionId,
    resolved: resolvedModel,
    limits: task.limits,
  })
  validateProtectedModelGrant(protectedModelAccess)
  const preparedMemory = await prepareMemory(candidate, task, ports)
  const memory = preparedMemory.value
  const knowledge = bundle.knowledge
    ? {
        snapshotId: bundle.knowledge.snapshotId,
        manifestDigest: bundle.knowledge.manifest.sha256,
        manifest: await verifiedArtifactBytes(candidate, bundle.knowledge.manifest),
      }
    : undefined

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
  const executionMaterial: AgentCandidateExecutionPlanMaterialV1 = {
    schemaVersion: 1,
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
      repository: task.repository,
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
      access: { kind: 'evaluator-mediated', grantDigest: protectedModelAccess.digest },
      routes,
    },
    launch: {
      executable: baseLaunch.executable,
      args: baseLaunch.args,
      env: publicEnv,
      cwd: bundle.execution.cwd,
    },
    ...(bundle.knowledge ? { knowledgeManifestDigest: bundle.knowledge.manifest.sha256 } : {}),
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
      schemaVersion: 1,
      kind: 'agent-candidate-execution-plan',
      digest: executionDigest,
      material: executionMaterial,
      artifact: embeddedCandidateArtifact(executionBytes),
    })

  const entrypoint = candidateEntrypointReceipt(candidate)
  const materializationReceipt = canonicalCandidateDocument<AgentCandidateMaterializationReceipt>({
    schemaVersion: 1,
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
    ...(bundle.knowledge ? { knowledgeManifestDigest: bundle.knowledge.manifest.sha256 } : {}),
    ...(entrypoint ? { entrypoint } : {}),
  })
  agentCandidateMaterializationReceiptSchema.parse(materializationReceipt.value)

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
    [CANDIDATE_TRACE_ENV.traceRunId]: task.executionId,
  }
  assertEnvironmentDisjoint(
    publicEnv,
    protectedModelAccess.env,
    preparedMemory.protectedEnv,
    traceEnv,
  )

  const prepared: PreparedAgentCandidateExecution = {
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
    protectedModelAccess: {
      digest: protectedModelAccess.digest,
      env: Object.freeze({ ...protectedModelAccess.env }),
    },
    ...(preparedMemory.protectedEnv
      ? { protectedMemoryAccess: Object.freeze({ ...preparedMemory.protectedEnv }) }
      : {}),
    ...(knowledge ? { knowledge } : {}),
    trace: { runId: task.executionId, tags: traceTags, env: traceEnv },
    memory,
    [preparedCandidateBrand]: true,
  }
  recordPreparedCandidateState(prepared, { ports })
  return prepared
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
    ['repository identity', task.repository.identity],
    ['repository root identity', task.repository.rootIdentity],
  ]
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
  agentCandidateWorkspaceSnapshotEvidenceSchema.parse(task.workspace)
  agentCandidateExecutionLimitsSchema.parse(task.limits)
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(task.repository.baseCommit)) {
    throw new Error('task repository base commit is not a full Git object id')
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(task.repository.baseTree)) {
    throw new Error('task repository base tree is not a full Git object id')
  }
  if (task.repository.baseCommit.length !== task.repository.baseTree.length) {
    throw new Error('task repository Git object formats disagree')
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
  if (!task.model.requested.trim()) throw new Error('evaluator model request must be non-empty')
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

function materializerHarness(harness: HarnessType): HarnessId {
  if (!MATERIALIZER_HARNESSES.has(harness)) {
    throw new Error(
      `sealed candidate profile materialization is unsupported for harness ${harness}`,
    )
  }
  return harness as HarnessId
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
): Promise<{
  value: AgentCandidateEffectiveMemory
  protectedEnv?: Readonly<Record<string, string>>
}> {
  const policy = candidate.bundle.memory
  if (policy.mode === 'disabled') return { value: { mode: 'disabled' } }
  const seed = policy.seed ? await verifiedArtifactBytes(candidate, policy.seed) : undefined
  const effectiveNamespace = `candidate/${candidate.bundle.digest.slice(7, 23)}/${task.executionId}/${canonicalCandidateDigest({ taskId: task.taskId }).slice(7)}`
  const reset = await ports.memory.reset({
    executionId: task.executionId,
    effectiveNamespace,
    ...(seed ? { seed } : {}),
    ...(policy.seed ? { seedDigest: policy.seed.sha256 } : {}),
  })
  await readVerifiedArtifact(reset.evidence, ports.artifacts)
  await verifyWorkspaceSnapshotArtifacts(reset.beforeState, ports.artifacts)
  validateProtectedEnvironment(reset.env, 'memory')
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
    protectedEnv: reset.env,
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
): AgentCandidateExecutionPlanMaterialV1['model']['routes'] {
  const routes: AgentCandidateExecutionPlanMaterialV1['model']['routes'] = [
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

function validateProtectedModelGrant(grant: {
  digest: string
  env: Readonly<Record<string, string>>
}): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(grant.digest)) {
    throw new Error('protected model grant has an invalid identity digest')
  }
  validateProtectedEnvironment(grant.env, 'model grant')
}

function validateProtectedEnvironment(env: Readonly<Record<string, string>>, label: string): void {
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== 'string') {
      throw new Error(`protected ${label} contains an invalid environment binding`)
    }
  }
}

function assertEnvironmentDisjoint(
  publicEnv: Record<string, AgentCandidateConfigValue>,
  protectedEnv: Readonly<Record<string, string>>,
  protectedMemoryEnv: Readonly<Record<string, string>> | undefined,
  traceEnv: Record<string, string>,
): void {
  const seen = new Set(Object.keys(publicEnv))
  for (const name of [
    ...Object.keys(protectedEnv),
    ...Object.keys(protectedMemoryEnv ?? {}),
    ...Object.keys(traceEnv),
  ]) {
    if (seen.has(name)) throw new Error(`evaluator environment binding collides with ${name}`)
    seen.add(name)
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
