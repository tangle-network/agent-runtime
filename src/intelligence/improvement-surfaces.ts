import {
  type AgentCandidateBundle,
  type AgentCandidateExperiment,
  type AgentImprovementActivationIntent,
  type AgentImprovementActivationTarget,
  type AgentImprovementSurface,
  type AgentProfile,
  type AgentProfileDiff,
  type AgentProfileDiffRemoval,
  agentProfileDiffSchema,
  agentProfileSchema,
  defineAgentProfileDiff,
  type Sha256Digest,
} from '@tangle-network/agent-interface'

import { canonicalCandidateDigest } from '../candidate-execution/digest'
import { agentCandidateProfileAsAgentProfile } from '../candidate-execution/profile'

const changedSurfaceOrder: readonly AgentImprovementSurface[] = [
  'prompt',
  'skills',
  'tools',
  'mcp',
  'hooks',
  'subagents',
  'agent-profile',
  'memory',
  'code',
  'knowledge',
]

/** Agent improvement surfaces delivered as exact `AgentProfileDiff` replacements. */
export const AGENT_IMPROVEMENT_PROFILE_SURFACES = [
  'prompt',
  'skills',
  'tools',
  'mcp',
  'hooks',
  'subagents',
] as const satisfies readonly AgentImprovementSurface[]

export type AgentImprovementProfileSurface = (typeof AGENT_IMPROVEMENT_PROFILE_SURFACES)[number]

export interface AgentImprovementTargetProfileDiffOptions {
  id: string
  source?: AgentProfileDiff['source']
  metadata?: Record<string, unknown>
}

export type AgentImprovementActivationTargetIdentity = Pick<
  AgentImprovementActivationTarget,
  'surface' | 'identity'
>

export function deriveChangedSurfaces(
  baselineBundle: AgentCandidateBundle,
  candidateBundle: AgentCandidateBundle,
): [AgentImprovementSurface, ...AgentImprovementSurface[]] {
  if (baselineBundle.knowledge || candidateBundle.knowledge) {
    assertKnowledgeCandidatePair(baselineBundle, candidateBundle)
  }
  assertCodeCandidatePair(baselineBundle, candidateBundle)
  const baseline = improvementSurfaceValues(baselineBundle)
  const candidate = improvementSurfaceValues(candidateBundle)
  const changed = changedSurfaceOrder.filter(
    (surface) =>
      canonicalCandidateDigest(baseline[surface]) !== canonicalCandidateDigest(candidate[surface]),
  )
  if (changed.length === 0) throw new Error('candidate experiment does not change an agent surface')
  return changed as [AgentImprovementSurface, ...AgentImprovementSurface[]]
}

export function assertAgentImprovementActivationTargets(
  surfaces: readonly AgentImprovementSurface[],
  experiment: AgentCandidateExperiment,
  intent: AgentImprovementActivationIntent,
  targets: readonly AgentImprovementActivationTarget[],
): void {
  const expected = new Set(surfaces)
  const actual = new Set(targets.map((target) => target.surface))
  const sourceArm = intent === 'activate-candidate' ? 'baseline' : 'candidate'
  if (
    targets.some((target) => !target.identity.trim()) ||
    targets.some(
      (target) =>
        target.expectedBaseDigest !==
        agentImprovementTargetDigest(experiment, sourceArm, target.surface),
    ) ||
    targets.length !== surfaces.length ||
    expected.size !== actual.size ||
    [...expected].some((surface) => !actual.has(surface))
  ) {
    throw new Error('candidate activation targets must cover exactly the changed surfaces')
  }
}

/** Bind caller-owned target identities to the exact source state Runtime measured. */
export function buildAgentImprovementActivationTargets(
  surfaces: readonly AgentImprovementSurface[],
  experiment: AgentCandidateExperiment,
  intent: AgentImprovementActivationIntent,
  identities: readonly AgentImprovementActivationTargetIdentity[],
): [AgentImprovementActivationTarget, ...AgentImprovementActivationTarget[]] {
  const sourceArm = intent === 'activate-candidate' ? 'baseline' : 'candidate'
  const targets = identities.map((target) => ({
    ...target,
    expectedBaseDigest: agentImprovementTargetDigest(experiment, sourceArm, target.surface),
  }))
  assertAgentImprovementActivationTargets(surfaces, experiment, intent, targets)
  return targets as [AgentImprovementActivationTarget, ...AgentImprovementActivationTarget[]]
}

export function agentImprovementTargetDigest(
  experiment: AgentCandidateExperiment,
  arm: 'baseline' | 'candidate',
  surface: AgentImprovementSurface,
): Sha256Digest {
  if (surface === 'knowledge') {
    const knowledge = assertKnowledgeCandidatePair(experiment.baseline, experiment.candidate)
    return arm === 'baseline' ? knowledge.candidate.baseHash : knowledge.candidate.candidateHash
  }
  if (surface === 'code') assertCodeCandidatePair(experiment.baseline, experiment.candidate)
  return canonicalCandidateDigest(improvementSurfaceValues(experiment[arm])[surface])
}

export function agentImprovementTargetInput(
  bundle: AgentCandidateBundle,
  surface: AgentImprovementSurface,
): unknown {
  return improvementSurfaceValues(bundle)[surface]
}

/** Return whether a measured surface can be delivered through an agent profile. */
export function isAgentImprovementProfileSurface(
  surface: AgentImprovementSurface,
): surface is AgentImprovementProfileSurface {
  return (AGENT_IMPROVEMENT_PROFILE_SURFACES as readonly string[]).includes(surface)
}

/**
 * Replace one measured profile surface exactly, including array-valued resources.
 * Apply the returned diffs in order: a diff applies its set before its removal,
 * so exact replacement requires a reset record followed by a set record.
 */
export function agentImprovementTargetProfileDiffs(
  target: {
    surface: AgentImprovementProfileSurface
    desiredInput: unknown
  },
  options: AgentImprovementTargetProfileDiffOptions,
): [AgentProfileDiff, ...AgentProfileDiff[]] {
  const { remove, set } = improvementSurfaceReplacement(target)
  const common = {
    kind: 'agent-profile-diff' as const,
    ...(options.source ? { source: options.source } : {}),
    metadata: {
      ...(options.metadata ?? {}),
      surface: target.surface,
    },
  }
  const reset = agentProfileDiffSchema.parse(
    defineAgentProfileDiff({
      ...common,
      id: `${options.id}:${target.surface}:reset`,
      title: `Replace active ${target.surface}`,
      remove,
    }),
  ) as AgentProfileDiff
  if (!set) return [reset]
  const replacement = agentProfileDiffSchema.parse(
    defineAgentProfileDiff({
      ...common,
      id: `${options.id}:${target.surface}:set`,
      title: `Activate measured ${target.surface}`,
      set,
    }),
  ) as AgentProfileDiff
  return [reset, replacement]
}

function improvementSurfaceReplacement(target: {
  surface: AgentImprovementProfileSurface
  desiredInput: unknown
}): { remove: AgentProfileDiffRemoval; set?: AgentProfile } {
  const value = target.desiredInput
  switch (target.surface) {
    case 'prompt': {
      const prompt = exactObject(value, ['prompt'], 'prompt activation input').prompt
      assertDefined(prompt, 'prompt activation input.prompt')
      return {
        remove: { prompt: true },
        ...(prompt === null ? {} : { set: parseProfileSet({ prompt }) }),
      }
    }
    case 'skills':
      assertDefined(value, 'skills activation input')
      return {
        remove: { resources: { skills: true } },
        ...(value === null ? {} : { set: parseProfileSet({ resources: { skills: value } }) }),
      }
    case 'tools': {
      const parsed = exactObject(value, ['tools', 'resources'], 'tools activation input')
      assertDefined(parsed.tools, 'tools activation input.tools')
      assertDefined(parsed.resources, 'tools activation input.resources')
      const set = {
        ...(parsed.tools === null ? {} : { tools: parsed.tools }),
        ...(parsed.resources === null ? {} : { resources: { tools: parsed.resources } }),
      }
      return {
        remove: { tools: true, resources: { tools: true } },
        ...(Object.keys(set).length === 0 ? {} : { set: parseProfileSet(set) }),
      }
    }
    case 'mcp':
      assertDefined(value, 'mcp activation input')
      return {
        remove: { mcp: true },
        ...(value === null ? {} : { set: parseProfileSet({ mcp: value }) }),
      }
    case 'hooks':
      assertDefined(value, 'hooks activation input')
      return {
        remove: { hooks: true },
        ...(value === null ? {} : { set: parseProfileSet({ hooks: value }) }),
      }
    case 'subagents': {
      const parsed = exactObject(value, ['subagents', 'resources'], 'subagents activation input')
      assertDefined(parsed.subagents, 'subagents activation input.subagents')
      assertDefined(parsed.resources, 'subagents activation input.resources')
      const set = {
        ...(parsed.subagents === null ? {} : { subagents: parsed.subagents }),
        ...(parsed.resources === null ? {} : { resources: { agents: parsed.resources } }),
      }
      return {
        remove: { subagents: true, resources: { agents: true } },
        ...(Object.keys(set).length === 0 ? {} : { set: parseProfileSet(set) }),
      }
    }
  }
}

function assertDefined(value: unknown, label: string): void {
  if (value === undefined) throw new Error(`${label} must not be undefined`)
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`)
  }
  return record
}

function parseProfileSet(value: unknown): AgentProfile {
  return agentProfileSchema.parse(value) as AgentProfile
}

function assertKnowledgeCandidatePair(
  baselineBundle: AgentCandidateBundle,
  candidateBundle: AgentCandidateBundle,
): NonNullable<AgentCandidateBundle['knowledge']> {
  const baseline = baselineBundle.knowledge
  const candidate = candidateBundle.knowledge
  if (!baseline && !candidate) {
    throw new Error('knowledge candidate pair is not present')
  }
  if (
    !baseline ||
    !candidate ||
    canonicalCandidateDigest({ candidate: baseline.candidate, evaluation: baseline.evaluation }) !==
      canonicalCandidateDigest({ candidate: candidate.candidate, evaluation: candidate.evaluation })
  ) {
    throw new Error(
      'knowledge experiment arms must share one measured candidate and evaluation identity',
    )
  }
  return candidate
}

function assertCodeCandidatePair(
  baselineBundle: AgentCandidateBundle,
  candidateBundle: AgentCandidateBundle,
): void {
  const baseline = baselineBundle.code
  const candidate = candidateBundle.code
  if (
    canonicalCandidateDigest(baseline) === canonicalCandidateDigest(candidate) ||
    candidate.kind !== 'git-patch'
  ) {
    return
  }
  const baselineTree =
    baseline.kind === 'no-op'
      ? baseline.baseTree
      : baseline.kind === 'git-patch'
        ? baseline.candidateTree
        : undefined
  const baselineRepository = baseline.kind === 'disabled' ? undefined : baseline.repository
  if (
    baselineTree !== candidate.baseTree ||
    !baselineRepository ||
    canonicalCandidateDigest(baselineRepository) !== canonicalCandidateDigest(candidate.repository)
  ) {
    throw new Error(
      'code candidate must be based on the exact repository tree measured by the baseline arm',
    )
  }
}

function improvementSurfaceValues(
  bundle: AgentCandidateBundle,
): Record<AgentImprovementSurface, unknown> {
  const profile = agentCandidateProfileAsAgentProfile(bundle.profile)
  return {
    prompt: {
      prompt: profile.prompt ?? null,
    },
    skills: profile.resources?.skills ?? null,
    tools: {
      tools: profile.tools ?? null,
      resources: profile.resources?.tools ?? null,
    },
    mcp: profile.mcp ?? null,
    hooks: profile.hooks ?? null,
    subagents: {
      subagents: profile.subagents ?? null,
      resources: profile.resources?.agents ?? null,
    },
    'agent-profile': { profile: opaqueProfileSlice(profile), execution: bundle.execution },
    memory: {
      instructions: profile.resources?.instructions ?? null,
      executionPolicy: bundle.memory,
    },
    code: bundle.code,
    knowledge: bundle.knowledge ?? null,
  }
}

function opaqueProfileSlice(profile: AgentProfile): unknown {
  const {
    prompt: _prompt,
    tools: _tools,
    mcp: _mcp,
    hooks: _hooks,
    subagents: _subagents,
    resources,
    ...opaqueProfile
  } = profile
  const {
    instructions: _instructions,
    skills: _skills,
    tools: _resourceTools,
    agents: _agents,
    ...opaqueResources
  } = resources ?? {}
  return {
    ...opaqueProfile,
    ...(Object.keys(opaqueResources).length > 0 ? { resources: opaqueResources } : {}),
  }
}
