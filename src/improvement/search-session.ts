/**
 * What the steps of one `runSearchImprovement` share: the search's identity,
 * storage, ledgers and recorder, and the profile nodes the kernel searches
 * over. A node is the surface a proposer wrote and the exact profile it
 * materializes to, or why it does not.
 */
import type { CostLedgerHandle } from '@tangle-network/agent-eval'
import {
  type CampaignStorage,
  type MutableSurface,
  type Scenario,
  type SearchArtifactCodec,
  type SearchArtifactRef,
  type SearchExecutionIdentity,
  type SearchRecorder,
  type SearchUnknown,
  searchNodeId,
} from '@tangle-network/agent-eval/campaign'
import { redact } from '@tangle-network/agent-eval/traces'
import {
  type AgentProfile,
  type AgentProfileDiff,
  agentProfileSchema,
  applyAgentProfileDiff,
  canonicalAgentProfileDigest,
  diffAgentProfiles,
} from '@tangle-network/agent-interface'
import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import type { ImproveSearchMethod } from './improve-types'
import type { PreparedProfileImprovement } from './profile-improvement'

/** A search node: the surface a proposer wrote, and the exact profile it
 * materializes to, or why it does not. */
export interface ProfileNode {
  surface: MutableSurface
  profile: AgentProfile | null
  refusal: string | null
}

/** One search's identity, storage, ledgers and recorder. */
export interface SearchSession<TScenario extends Scenario, TArtifact> {
  readonly method: ImproveSearchMethod
  readonly prepared: PreparedProfileImprovement<TScenario, TArtifact>
  readonly storage: CampaignStorage
  readonly searchId: string
  readonly searchDir: string
  readonly costLedger: CostLedgerHandle
  readonly execution: SearchExecutionIdentity
  readonly recorder: SearchRecorder
}

/** A refusal as the ledger stores it: redacted with the share profile. */
export function searchRefusalText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return redact(message, { profile: 'share' }).value
}

/** The node a candidate surface becomes: materialized, or refused with the reason. */
export function profileNodeOf<TScenario extends Scenario, TArtifact>(
  prepared: PreparedProfileImprovement<TScenario, TArtifact>,
  candidateSurface: MutableSurface,
): ProfileNode {
  const surface = immutableCandidateValue(candidateSurface)
  try {
    return { surface, profile: prepared.materializeCandidate(surface), refusal: null }
  } catch (error) {
    return { surface, profile: null, refusal: searchRefusalText(error) }
  }
}

/**
 * The codec that also records each node's profile by node id. Placement reads a node's profile
 * to skip the lanes that refuse it, so every node the ledger holds, and every node this process
 * registers, is known before its cells are placed.
 */
export function registeringProfileCodec<TScenario extends Scenario, TArtifact>(
  prepared: PreparedProfileImprovement<TScenario, TArtifact>,
  searchId: string,
  profiles: Map<string, AgentProfile | null>,
): SearchArtifactCodec<ProfileNode> {
  const profiled = profileCodec(prepared)
  return {
    node(recorder, node) {
      const registered = profiled.node(recorder, node)
      profiles.set(searchNodeId(searchId, registered.artifactDigest), node.profile)
      return registered
    },
    diff: profiled.diff,
    load(recorder, node) {
      const loaded = profiled.load(recorder, node)
      profiles.set(node.nodeId, loaded.profile)
      return loaded
    },
  }
}

/** Profiles as search artifacts: nodes by profile digest, edges by profile diffs. */
function profileCodec<TScenario extends Scenario, TArtifact>(
  prepared: PreparedProfileImprovement<TScenario, TArtifact>,
): SearchArtifactCodec<ProfileNode> {
  const surfaceId = prepared.surface
  return {
    node(recorder, node) {
      if (node.profile) {
        const artifact = recorder.blob('agent-profile', {
          kind: 'agent-profile',
          profile: node.profile,
        })
        return {
          artifactDigest: canonicalAgentProfileDigest(node.profile),
          artifact,
          surfaces: [{ surfaceId, kind: 'agent-profile', artifact }],
        }
      }
      const artifact = recorder.blob('surface', {
        kind: 'unmaterialized-surface',
        surface: node.surface,
        refusal: node.refusal,
      })
      return {
        artifactDigest: canonicalCandidateDigest({
          kind: 'unmaterialized-surface',
          surface: node.surface,
        }),
        artifact,
        surfaces: [{ surfaceId, kind: 'agent-profile', artifact }],
      }
    },
    diff(recorder, parent, child): SearchArtifactRef | SearchUnknown {
      if (!parent.profile || !child.profile) {
        return { unknown: 'a surface that does not materialize has no profile to diff' }
      }
      const diffs: AgentProfileDiff[] = diffAgentProfiles(parent.profile, child.profile)
      const to = canonicalAgentProfileDigest(child.profile)
      if (canonicalAgentProfileDigest(diffs.reduce(applyAgentProfileDiff, parent.profile)) !== to) {
        return { unknown: 'the Interface profile diffs do not reproduce the child profile' }
      }
      return recorder.blob('diff', {
        kind: 'agent-profile-diff',
        from: canonicalAgentProfileDigest(parent.profile),
        to,
        diffs,
      })
    },
    load(recorder, node) {
      const stored = recorder.readBlob(node.artifact) as {
        kind?: unknown
        profile?: unknown
        surface?: MutableSurface
        refusal?: string | null
      }
      if (stored.kind === 'agent-profile') {
        const parsed = agentProfileSchema.safeParse(stored.profile)
        if (!parsed.success) {
          throw new Error(`improve(): node ${node.nodeId} holds an invalid AgentProfile`)
        }
        const loaded = immutableCandidateValue(parsed.data)
        return { surface: prepared.surfaceOf(loaded), profile: loaded, refusal: null }
      }
      if (stored.kind === 'unmaterialized-surface' && stored.surface !== undefined) {
        return { surface: stored.surface, profile: null, refusal: stored.refusal ?? null }
      }
      throw new Error(`improve(): node ${node.nodeId} holds no profile search artifact`)
    },
  }
}
