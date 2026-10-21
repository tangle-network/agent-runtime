/**
 * The three host staging roots of a preparation: the task workspace, the candidate workspace,
 * and the profile workspace, each materialized and verified against its signed material.
 */

import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyAgentCandidateWorkspacePlan } from '@tangle-network/agent-profile-materialize'
import {
  readMaterializedWorkspaceFiles,
  readVerifiedArtifact,
  verifyMaterializedProfileWorkspace,
  verifyMaterializedWorkspace,
  verifyWorkspaceSnapshotArtifacts,
} from './artifacts'
import { canonicalCandidateBytes } from './digest'
import { verifyTaskCheckout } from './git-materialize'
import { candidateProfileAgentPaths, materializeAgentCandidateProfilePlan } from './profile'
import type {
  AgentCandidateExecutionPorts,
  AgentCandidateTaskExecution,
  VerifiedAgentCandidate,
} from './types'
import { verifiedArtifactBytes, verifiedResourceTextByDigest } from './verify'

export type ExecutorWorkspaceFiles = Awaited<ReturnType<typeof readMaterializedWorkspaceFiles>>

/** The profile workspace as materialized and verified, with the bytes of its canonical plan. */
export interface MaterializedCandidateProfile {
  readonly workspacePlan: ReturnType<typeof materializeAgentCandidateProfilePlan>
  readonly agentPaths: ReturnType<typeof candidateProfileAgentPaths>
  readonly application: ReturnType<typeof applyAgentCandidateWorkspacePlan>
  readonly planBytes: Uint8Array
}

export async function materializeTaskWorkspace(
  task: AgentCandidateTaskExecution,
  ports: AgentCandidateExecutionPorts,
): Promise<ExecutorWorkspaceFiles> {
  const benchmarkTask = task.task
  const taskArtifacts = await verifyWorkspaceSnapshotArtifacts(
    benchmarkTask.workspace,
    ports.artifacts,
  )
  await ports.workspaces.materialize({
    role: 'task',
    snapshot: benchmarkTask.workspace,
    archive: taskArtifacts.archive,
    destination: task.stagingRoots.taskRoot,
  })
  await verifyMaterializedWorkspace(task.stagingRoots.taskRoot, benchmarkTask.workspace.material, {
    ignoredProtectedRootEntries: ['.git', '.sidecar'],
  })
  if (benchmarkTask.repository) {
    await verifyTaskCheckout(task.stagingRoots.taskRoot, benchmarkTask.repository)
  }
  return readMaterializedWorkspaceFiles(
    task.stagingRoots.taskRoot,
    benchmarkTask.workspace.material,
    {
      ignoredProtectedRootEntries: ['.git', '.sidecar'],
    },
  )
}

/** The candidate's own workspace files, or undefined when its code is disabled. */
export async function materializeCandidateWorkspace(
  candidate: VerifiedAgentCandidate,
  task: AgentCandidateTaskExecution,
  ports: AgentCandidateExecutionPorts,
): Promise<ExecutorWorkspaceFiles | undefined> {
  const workspace = candidate.bundle.execution.workspace
  if (!workspace) {
    if (task.stagingRoots.candidateRoot || task.executionRoots.candidateRoot) {
      throw new Error('disabled code cannot receive a candidate workspace root')
    }
    return undefined
  }
  if (!task.stagingRoots.candidateRoot || !task.executionRoots.candidateRoot) {
    throw new Error('active candidate execution requires host and container candidate roots')
  }
  const archive = await verifiedArtifactBytes(candidate, workspace.archive)
  await ports.workspaces.materialize({
    role: 'candidate',
    snapshot: workspace,
    archive,
    destination: task.stagingRoots.candidateRoot,
  })
  await verifyMaterializedWorkspace(task.stagingRoots.candidateRoot, workspace.material)
  return readMaterializedWorkspaceFiles(task.stagingRoots.candidateRoot, workspace.material)
}

/** Materialize the profile into its empty staging root and check the plan's exact bytes. */
export async function stageCandidateProfile(
  candidate: VerifiedAgentCandidate,
  task: AgentCandidateTaskExecution,
  ports: AgentCandidateExecutionPorts,
): Promise<MaterializedCandidateProfile> {
  const { bundle } = candidate
  await assertEmptyDirectory(task.stagingRoots.profileRoot)
  const workspacePlan = materializeAgentCandidateProfilePlan({
    profile: bundle.profile,
    harness: bundle.execution.harness,
    launch: bundle.execution.launch,
    workspace: bundle.execution.cwd.workspace,
    workspaces: {
      taskRoot: task.executionRoots.taskRoot,
      ...(task.executionRoots.candidateRoot
        ? { candidateRoot: task.executionRoots.candidateRoot }
        : {}),
    },
    resolvedResources: verifiedResourceTextByDigest(candidate),
  })
  const agentPaths = candidateProfileAgentPaths(workspacePlan, task.executionRoots.profileRoot)
  const agentStagingRoot = workspacePlan.files.some((file) => file.root === 'agent')
    ? await mkdtemp(join(tmpdir(), 'tangle-candidate-profile-agent-'))
    : undefined
  let application: ReturnType<typeof applyAgentCandidateWorkspacePlan>
  try {
    application = applyAgentCandidateWorkspacePlan(
      workspacePlan,
      task.stagingRoots.profileRoot,
      bundle.execution.cwd.workspace,
      agentStagingRoot ? { agentDir: agentStagingRoot } : undefined,
    )
    await verifyMaterializedProfileWorkspace(
      task.stagingRoots.profileRoot,
      application.profileActivation.profilePlan.material,
    )
    if (agentStagingRoot) {
      await verifyMaterializedProfileWorkspace(
        agentStagingRoot,
        application.profileActivation.profilePlan.material,
        'agent',
      )
    }
  } finally {
    if (agentStagingRoot) {
      await rm(agentStagingRoot, { recursive: true, force: true })
    }
  }
  const planBytes = await readVerifiedArtifact(
    application.profileActivation.profilePlan.artifact,
    ports.artifacts,
  )
  if (
    !Buffer.from(planBytes).equals(
      Buffer.from(canonicalCandidateBytes(application.profileActivation.profilePlan.material)),
    )
  ) {
    throw new Error('profile materializer did not capture exact canonical plan bytes')
  }
  return { workspacePlan, agentPaths, application, planBytes }
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
