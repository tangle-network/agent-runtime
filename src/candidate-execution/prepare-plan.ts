/**
 * The evaluator-owned documents of a preparation: the launch environment, the execution plan,
 * the materialization receipt, and the trace bindings that tie a run back to them.
 */

import {
  type AgentCandidateConfigValue,
  type AgentCandidateExecutionPlanEvidence,
  type AgentCandidateExecutionPlanMaterial,
  type AgentCandidateMaterializationReceipt,
  type AgentCandidateResolvedModel,
  agentCandidateExecutionPlanEvidenceSchema,
  agentCandidateExecutionPlanMaterialSchema,
  agentCandidateMaterializationReceiptSchema,
} from '@tangle-network/agent-interface'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  embeddedCandidateArtifact,
  omitTopLevelDigest,
  sha256Bytes,
} from './digest'
import {
  CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV,
  CANDIDATE_KNOWLEDGE_ROOT_ENV,
  type candidateKnowledgeExecutionPaths,
} from './knowledge'
import type { MaterializedCandidateProfile } from './prepare-workspaces'
import {
  candidateEntrypointReceipt,
  modelRoutes,
  PI_CANDIDATE_AGENT_DIR_ENV,
  PI_CANDIDATE_SESSION_DIR_ENV,
} from './profile'
import { requirePublicCandidateConfigValue } from './public-config'
import {
  type AgentCandidateExecutionPorts,
  type AgentCandidateTaskExecution,
  CANDIDATE_TRACE_ENV,
  CANDIDATE_TRACE_TAGS,
  type ResolvedAgentCandidateContainer,
  type VerifiedAgentCandidate,
} from './types'

type PublicEnvironment = Record<string, AgentCandidateConfigValue>

export type ModelReservation = Awaited<
  ReturnType<AgentCandidateExecutionPorts['models']['reserveGrant']>
>

/** The execution plan and its canonical bytes. */
export interface SealedExecutionPlan {
  readonly evidence: AgentCandidateExecutionPlanEvidence
  readonly bytes: Uint8Array
}

/** The public environment: the candidate's own, the profile's, and the evaluator's path bindings. */
export function launchEnvironment(
  candidate: VerifiedAgentCandidate,
  profile: MaterializedCandidateProfile,
  knowledgePaths: ReturnType<typeof candidateKnowledgeExecutionPaths> | undefined,
): PublicEnvironment {
  const { execution } = candidate.bundle
  const { agentPaths } = profile
  return mergePublicEnvironment(
    execution.env ?? {},
    profile.application.env,
    agentPaths
      ? {
          [PI_CANDIDATE_AGENT_DIR_ENV]: { kind: 'public' as const, value: agentPaths.agentDir },
          [PI_CANDIDATE_SESSION_DIR_ENV]: { kind: 'public' as const, value: agentPaths.sessionDir },
        }
      : {},
    execution.instructionDelivery.kind === 'utf8-file'
      ? {
          [execution.instructionDelivery.env]: {
            kind: 'public',
            value: execution.instructionDelivery.path,
          },
        }
      : {},
    knowledgePaths
      ? {
          [CANDIDATE_KNOWLEDGE_ROOT_ENV]: { kind: 'public', value: knowledgePaths.root },
          ...(knowledgePaths.retrievalConfig
            ? {
                [CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV]: {
                  kind: 'public' as const,
                  value: knowledgePaths.retrievalConfig,
                },
              }
            : {}),
        }
      : {},
  )
}

/** The plan material for one execution: workspaces, profile, model access, launch and memory. */
export function executionPlanMaterial(input: {
  candidate: VerifiedAgentCandidate
  task: AgentCandidateTaskExecution
  profile: MaterializedCandidateProfile
  container: ResolvedAgentCandidateContainer
  resolvedModel: AgentCandidateResolvedModel
  modelReservation: Pick<ModelReservation, 'digest' | 'network'>
  launch: { executable: string; args: AgentCandidateConfigValue[] }
  publicEnv: PublicEnvironment
  memory: AgentCandidateExecutionPlanMaterial['memory']
}): AgentCandidateExecutionPlanMaterial {
  const { candidate, task } = input
  const { bundle } = candidate
  return {
    kind: 'agent-candidate-execution-plan-material',
    runCell: task.runCell,
    executionId: task.executionId,
    workspaces: {
      taskRoot: task.executionRoots.taskRoot,
      ...(task.executionRoots.candidateRoot
        ? { candidateRoot: task.executionRoots.candidateRoot }
        : {}),
    },
    codeKind: bundle.code.kind,
    ...(bundle.execution.workspace ? { candidateWorkspace: bundle.execution.workspace } : {}),
    profile: input.profile.application.application,
    harness: bundle.execution.harness,
    harnessVersion: bundle.execution.harnessVersion,
    instructionDelivery: bundle.execution.instructionDelivery,
    limits: task.task.limits,
    container: input.container,
    model: {
      policy: 'single',
      resolved: input.resolvedModel,
      access: {
        kind: 'evaluator-mediated',
        grantDigest: input.modelReservation.digest,
        network: input.modelReservation.network,
      },
      routes: modelRoutes(bundle.profile, task.task.model.requested),
    },
    launch: {
      executable: input.launch.executable,
      args: input.launch.args,
      env: input.publicEnv,
      cwd: bundle.execution.cwd,
    },
    ...(bundle.knowledge ? { knowledgeManifestDigest: bundle.knowledge.snapshot.digest } : {}),
    memory: input.memory,
    network: { mode: 'disabled' },
  }
}

/** Check and canonically serialize the plan material into the plan's evidence. */
export function sealExecutionPlan(
  material: AgentCandidateExecutionPlanMaterial,
): SealedExecutionPlan {
  agentCandidateExecutionPlanMaterialSchema.parse(material)
  const bytes = canonicalCandidateBytes(material)
  const digest = canonicalCandidateDigest(material)
  if (sha256Bytes(bytes) !== digest) {
    throw new Error('execution plan canonical serializers disagree')
  }
  const evidence: AgentCandidateExecutionPlanEvidence =
    agentCandidateExecutionPlanEvidenceSchema.parse({
      kind: 'agent-candidate-execution-plan',
      digest,
      material,
      artifact: embeddedCandidateArtifact(bytes),
    })
  return { evidence, bytes }
}

/** The receipt that binds the bundle, the benchmark task, and the sealed plan together. */
export function sealMaterializationReceipt(input: {
  candidate: VerifiedAgentCandidate
  task: AgentCandidateTaskExecution
  profile: MaterializedCandidateProfile
  executionPlan: AgentCandidateExecutionPlanEvidence
  container: ResolvedAgentCandidateContainer
  resolvedModel: AgentCandidateResolvedModel
}) {
  const { candidate, task } = input
  const { bundle } = candidate
  const benchmarkTask = task.task
  const entrypoint = candidateEntrypointReceipt(candidate)
  const materializationReceipt = canonicalCandidateDocument<AgentCandidateMaterializationReceipt>({
    kind: 'agent-candidate-materialization',
    digestAlgorithm: 'rfc8785-sha256',
    bundleDigest: bundle.digest,
    benchmark: {
      suite: {
        digest: task.benchmarkSuite.digest,
        material: embeddedCandidateArtifact(
          canonicalCandidateBytes(omitTopLevelDigest(task.benchmarkSuite)),
        ),
      },
      task: {
        digest: benchmarkTask.digest,
        material: embeddedCandidateArtifact(
          canonicalCandidateBytes(omitTopLevelDigest(benchmarkTask)),
        ),
      },
    },
    profileActivation: input.profile.application.profileActivation,
    executionPlan: input.executionPlan,
    ...(bundle.execution.workspace ? { candidateWorkspace: bundle.execution.workspace } : {}),
    codeKind: bundle.code.kind,
    ...(candidate.materializedTree ? { materializedTree: candidate.materializedTree } : {}),
    harness: bundle.execution.harness,
    harnessVersion: bundle.execution.harnessVersion,
    container: input.container,
    resolvedModel: input.resolvedModel,
    ...(bundle.knowledge ? { knowledgeManifestDigest: bundle.knowledge.snapshot.digest } : {}),
    ...(entrypoint ? { entrypoint } : {}),
  })
  agentCandidateMaterializationReceiptSchema.parse(materializationReceipt.value)
  return materializationReceipt
}

/** The run id, tags and environment that tie a trace to this execution's sealed documents. */
export function candidateTraceBindings(input: {
  task: AgentCandidateTaskExecution
  bundleDigest: string
  attemptNumber: number
  preparationId: string
  executionPlanDigest: string
  materializationReceiptDigest: string
  publicEnv: PublicEnvironment
}) {
  const { task, bundleDigest, executionPlanDigest, materializationReceiptDigest } = input
  const runId = `${task.executionId}:attempt-${input.attemptNumber}:${canonicalCandidateDigest({ preparationId: input.preparationId }).slice(7, 23)}`
  const tags = {
    [CANDIDATE_TRACE_TAGS.executionId]: task.executionId,
    [CANDIDATE_TRACE_TAGS.bundleDigest]: bundleDigest,
    [CANDIDATE_TRACE_TAGS.executionPlanDigest]: executionPlanDigest,
    [CANDIDATE_TRACE_TAGS.materializationReceiptDigest]: materializationReceiptDigest,
  }
  const env = {
    [CANDIDATE_TRACE_ENV.executionId]: task.executionId,
    [CANDIDATE_TRACE_ENV.bundleDigest]: bundleDigest,
    [CANDIDATE_TRACE_ENV.executionPlanDigest]: executionPlanDigest,
    [CANDIDATE_TRACE_ENV.materializationReceiptDigest]: materializationReceiptDigest,
    [CANDIDATE_TRACE_ENV.traceRunId]: runId,
  }
  assertEnvironmentDisjoint(input.publicEnv, env)
  return { runId, tags, env }
}

export function unwrapPublicEnvironment(values: PublicEnvironment): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      requirePublicCandidateConfigValue(value, `env.${name}`),
    ]),
  )
}

function mergePublicEnvironment(...records: PublicEnvironment[]): PublicEnvironment {
  const output: PublicEnvironment = {}
  for (const record of records) {
    for (const [name, value] of Object.entries(record)) {
      const previous = output[name]
      const publicValue = requirePublicCandidateConfigValue(value, `env.${name}`)
      if (previous && requirePublicCandidateConfigValue(previous, `env.${name}`) !== publicValue) {
        throw new Error(`candidate and profile environment disagree on ${name}`)
      }
      output[name] = value
    }
  }
  return output
}

function assertEnvironmentDisjoint(
  publicEnv: PublicEnvironment,
  traceEnv: Record<string, string>,
): void {
  const seen = new Set(Object.keys(publicEnv))
  for (const name of Object.keys(traceEnv)) {
    if (seen.has(name)) throw new Error(`evaluator environment binding collides with ${name}`)
    seen.add(name)
  }
}
