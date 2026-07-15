import type {
  AgentCandidateArtifactRef,
  AgentCandidateTaskOutcomeSpec,
  AgentCandidateTaskOutputSpec,
  AgentCandidateWorkspaceManifestMaterial,
  Sha256Digest,
} from '@tangle-network/agent-interface'

import { canonicalCandidateBytes } from './digest'
import type { SealedAgentCandidateExecutorFinalCapture } from './executor-capture'
import { persistCandidateOutputArtifact } from './output-artifacts'
import type { AgentCandidateOutputArtifactPort } from './types'

export type PersistedAgentCandidateTaskCapture =
  | {
      readonly kind: 'workspace'
      readonly resultTree: string
      readonly afterState: AgentCandidateWorkspaceManifestMaterial
      readonly manifest: AgentCandidateArtifactRef
      readonly archive: AgentCandidateArtifactRef
      readonly gitDiff: AgentCandidateArtifactRef
    }
  | {
      readonly kind: 'output'
      readonly spec: AgentCandidateTaskOutputSpec
      readonly artifact: AgentCandidateArtifactRef
    }

export interface PersistedAgentCandidateExecutorCapture {
  readonly evidence: AgentCandidateArtifactRef
  readonly taskOutcome?: PersistedAgentCandidateTaskCapture
  readonly memoryAfter?: {
    readonly afterState: AgentCandidateWorkspaceManifestMaterial
    readonly manifest: AgentCandidateArtifactRef
    readonly archive: AgentCandidateArtifactRef
  }
}

/** Persist structurally valid post-stop bytes without claiming they passed outcome verification. */
export async function persistAgentCandidateExecutorCapture(
  identity: { executionId: string; executionPlanDigest: Sha256Digest },
  expected: AgentCandidateTaskOutcomeSpec,
  capture: SealedAgentCandidateExecutorFinalCapture,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  signal?: AbortSignal,
): Promise<PersistedAgentCandidateExecutorCapture> {
  const executorEvidence = capture.evidence
    ? await persistCandidateOutputArtifact(outputArtifacts, {
        executionId: identity.executionId,
        purpose: 'executor-capture',
        bytes: capture.evidence,
        signal,
      })
    : undefined
  const taskOutcome = capture.taskOutcome
    ? await persistTaskCapture(
        identity.executionId,
        expected,
        capture.taskOutcome,
        outputArtifacts,
        signal,
      )
    : undefined
  const memoryAfter = capture.memoryAfter
    ? await persistWorkspaceCapture(
        identity.executionId,
        'memory-after-manifest',
        'memory-after-archive',
        capture.memoryAfter.afterState,
        capture.memoryAfter.archive,
        outputArtifacts,
        signal,
      )
    : undefined
  const bytes = canonicalCandidateBytes({
    kind: 'agent-candidate-executor-capture',
    executionPlanDigest: identity.executionPlanDigest,
    ...(executorEvidence ? { executorEvidence } : {}),
    ...(taskOutcome ? { taskOutcome } : {}),
    ...(memoryAfter ? { memoryAfter } : {}),
  })
  const evidence = await persistCandidateOutputArtifact(outputArtifacts, {
    executionId: identity.executionId,
    purpose: 'executor-capture',
    bytes,
    signal,
  })
  return Object.freeze({
    evidence,
    ...(taskOutcome ? { taskOutcome: Object.freeze(taskOutcome) } : {}),
    ...(memoryAfter ? { memoryAfter: Object.freeze(memoryAfter) } : {}),
  })
}

async function persistTaskCapture(
  executionId: string,
  expected: AgentCandidateTaskOutcomeSpec,
  capture: NonNullable<SealedAgentCandidateExecutorFinalCapture['taskOutcome']>,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  signal?: AbortSignal,
): Promise<PersistedAgentCandidateTaskCapture> {
  if (capture.kind === 'output') {
    if (expected.kind !== 'output')
      throw new Error('captured output does not match the signed task')
    const artifact = await persistCandidateOutputArtifact(outputArtifacts, {
      executionId,
      purpose: 'task-output',
      bytes: capture.bytes,
      signal,
    })
    return {
      kind: 'output',
      spec: { mediaType: expected.mediaType, maxBytes: expected.maxBytes },
      artifact,
    }
  }
  if (expected.kind !== 'workspace') {
    throw new Error('captured workspace does not match the signed task')
  }
  const workspace = await persistWorkspaceCapture(
    executionId,
    'task-manifest',
    'task-archive',
    capture.afterState,
    capture.archive,
    outputArtifacts,
    signal,
  )
  const gitDiff = await persistCandidateOutputArtifact(outputArtifacts, {
    executionId,
    purpose: 'task-patch',
    bytes: capture.gitDiff,
    signal,
  })
  return { kind: 'workspace', resultTree: capture.resultTree, ...workspace, gitDiff }
}

async function persistWorkspaceCapture(
  executionId: string,
  manifestPurpose: 'task-manifest' | 'memory-after-manifest',
  archivePurpose: 'task-archive' | 'memory-after-archive',
  afterState: AgentCandidateWorkspaceManifestMaterial,
  archiveBytes: Uint8Array,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  signal?: AbortSignal,
): Promise<{
  afterState: AgentCandidateWorkspaceManifestMaterial
  manifest: AgentCandidateArtifactRef
  archive: AgentCandidateArtifactRef
}> {
  const manifestBytes = canonicalCandidateBytes(afterState)
  const [manifest, archive] = await Promise.all([
    persistCandidateOutputArtifact(outputArtifacts, {
      executionId,
      purpose: manifestPurpose,
      bytes: manifestBytes,
      signal,
    }),
    persistCandidateOutputArtifact(outputArtifacts, {
      executionId,
      purpose: archivePurpose,
      bytes: archiveBytes,
      signal,
    }),
  ])
  return { afterState, manifest, archive }
}
