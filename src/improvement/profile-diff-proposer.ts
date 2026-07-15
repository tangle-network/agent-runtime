import { canonicalJson } from '@tangle-network/agent-eval'
import type {
  MutableSurface,
  ProposeContext,
  ProposedCandidate,
  SurfaceProposer,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfile,
  type AgentProfileDiff,
  changedAgentProfileAxes,
} from '@tangle-network/agent-interface'
import { canonicalCandidateDigest } from '../candidate-execution/digest'
import {
  applyExactAgentProfileDiff,
  parseExactAgentProfile,
  parseExactAgentProfileDiff,
} from '../candidate-execution/profile'

export interface AgentProfileDiffProposal {
  diff: AgentProfileDiff
  label?: string
  rationale?: string
}

export type ProfileDiffProposerContext<TFindings = unknown> = ProposeContext<TFindings> & {
  profile: AgentProfile
}

export interface ProfileDiffProposerOptions<TFindings = unknown> {
  proposeDiffs(
    context: ProfileDiffProposerContext<TFindings>,
  ): Promise<readonly AgentProfileDiffProposal[]> | readonly AgentProfileDiffProposal[]
}

/**
 * Turn exact AgentProfileDiffs from any source into full profile candidates for
 * the shared optimization loop. Research, catalogs, humans, and trace miners
 * differ only in `proposeDiffs`; measurement and promotion stay identical.
 */
export function profileDiffProposer<TFindings = unknown>(
  options: ProfileDiffProposerOptions<TFindings>,
): SurfaceProposer<TFindings> {
  return {
    kind: 'agent-profile-diff',
    async propose(ctx): Promise<Array<MutableSurface | ProposedCandidate>> {
      if (typeof ctx.currentSurface !== 'string') {
        throw new Error('profileDiffProposer requires a serialized AgentProfile surface')
      }
      const profile = parseSerializedProfile(ctx.currentSurface)
      const proposals = await options.proposeDiffs({
        ...ctx,
        profile,
      })
      const candidates: ProposedCandidate[] = []
      const normalizedBaseline = applyExactAgentProfileDiff(
        profile,
        { schemaVersion: 1, kind: 'agent-profile-diff' },
        'profile diff baseline',
      )
      const seen = new Set<string>([canonicalJson(normalizedBaseline)])
      for (const [index, proposal] of proposals.entries()) {
        if (candidates.length >= ctx.populationSize || ctx.signal.aborted) break
        const diff = parseExactAgentProfileDiff(proposal.diff, `profile diff proposal ${index}`)
        const axes = changedAgentProfileAxes(diff)
        if (axes.length === 0) continue
        const candidate = applyExactAgentProfileDiff(
          profile,
          diff,
          `profile diff candidate ${index}`,
        )
        const surface = canonicalJson(candidate)
        if (seen.has(surface)) continue
        seen.add(surface)
        candidates.push({
          surface,
          label: proposal.label ?? diff.title ?? diff.id ?? `Change ${axes.join(', ')}`,
          rationale: candidateRationale(proposal, diff, axes),
        })
      }
      return candidates
    },
  }
}

function candidateRationale(
  proposal: AgentProfileDiffProposal,
  diff: AgentProfileDiff,
  axes: readonly string[],
): string {
  const reason = proposal.rationale ?? diff.rationale ?? `Changes profile axes: ${axes.join(', ')}.`
  const source = diff.source
    ? [diff.source.kind, ...(diff.source.artifacts ?? [])].join(' · ')
    : 'source unspecified'
  return `${reason} Source: ${source}. Diff: ${canonicalCandidateDigest(diff)}.`
}

function parseSerializedProfile(surface: string): AgentProfile {
  let raw: unknown
  try {
    raw = JSON.parse(surface)
  } catch (cause) {
    throw new Error('profileDiffProposer current surface is not valid AgentProfile JSON', {
      cause,
    })
  }
  return parseExactAgentProfile(raw, 'profileDiffProposer current profile')
}
