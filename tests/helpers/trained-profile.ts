import {
  type AgentProfile,
  type AgentTrainingTask,
  agentTrainingTaskKey,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  snapshotAgentProfile,
  trainedModelIdForArtifact,
} from '@tangle-network/agent-interface'

/** Schema-valid portable training evidence; no claim of real model training. */
export function trainedProfile(profile: AgentProfile, tasks: AgentTrainingTask[]): AgentProfile {
  const members = [...tasks].sort((a, b) =>
    agentTrainingTaskKey(a) < agentTrainingTaskKey(b) ? -1 : 1,
  )
  const parent = profile.metadata?.training
  const artifactDigest = canonicalCandidateDigest({ profile, members })
  const receipt = {
    version: 1 as const,
    dataset: {
      digest: canonicalCandidateDigest({ members }),
      taskSetDigest: canonicalCandidateDigest(members),
      tasks: members,
    },
    parentProfileDigest: canonicalAgentProfileDigest(profile),
    parentReceiptDigest: parent ? canonicalCandidateDigest(parent.receipt) : null,
    executionRef: canonicalCandidateDigest({ fixture: 'training-executor' }),
    trainer: {
      mode: 'managed' as const,
      id: 'training-evidence-fixture',
      revision: canonicalCandidateDigest({ fixture: 'trainer' }),
      parameters: {},
    },
    checkpoint: {
      artifactDigest,
      artifactBytes: 1,
      routerModelId: trainedModelIdForArtifact(artifactDigest),
      servingDigest: canonicalCandidateDigest({ fixture: 'serving' }),
    },
  }
  return snapshotAgentProfile({
    ...profile,
    model: { ...profile.model, default: receipt.checkpoint.routerModelId },
    metadata: {
      ...profile.metadata,
      training: { receipt, ancestors: parent ? [parent.receipt, ...parent.ancestors] : [] },
    },
  })
}
