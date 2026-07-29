import {
  type AgentCandidateBundle,
  type AgentCandidateExperiment,
  type AgentImprovementActivationIntent,
  type AgentImprovementActivationTarget,
  type AgentImprovementEvaluation,
  type AgentImprovementSurface,
  type AgentProfile,
  type AgentProfileDiff,
  type AgentProfileDiffRemoval,
  type AgentProfileImprovementChange,
  type AgentProfileImprovementExperiment,
  agentProfileDiffSchema,
  agentProfileSchema,
  changedProfileImprovementSurfaces,
  defineAgentProfileDiff,
  type Sha256Digest,
} from '@tangle-network/agent-interface'

import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import {
  agentCandidateProfileAsAgentProfile,
  applyExactAgentProfileDiff,
  omitUndefinedObjectFields,
  parseExactAgentProfile,
} from '../candidate-execution/profile'

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

/**
 * Profile changes eligible for the product-owned measured comparison path.
 * The six directly deliverable profile surfaces retain their granular labels;
 * any residual profile axis also adds the complete `agent-profile` surface.
 */
export const AGENT_PROFILE_MEASURED_SURFACES = [
  ...AGENT_IMPROVEMENT_PROFILE_SURFACES,
  'agent-profile',
] as const satisfies readonly AgentImprovementSurface[]

export type AgentProfileMeasuredSurface = (typeof AGENT_PROFILE_MEASURED_SURFACES)[number]

type ProfileDifferHandledField =
  | 'name'
  | 'description'
  | 'version'
  | 'tags'
  | 'prompt'
  | 'model'
  | 'harness'
  | 'permissions'
  | 'tools'
  | 'mcp'
  | 'connections'
  | 'subagents'
  | 'resources'
  | 'hooks'
  | 'modes'
  | 'confidential'
  | 'metadata'
  | 'extensions'
type MissingProfileDifferField = Exclude<keyof AgentProfile, ProfileDifferHandledField>
const profileDifferIsExhaustive: MissingProfileDifferField extends never ? true : never = true
void profileDifferIsExhaustive

type ProfileResourceDifferHandledField =
  | 'files'
  | 'tools'
  | 'skills'
  | 'agents'
  | 'commands'
  | 'instructions'
  | 'failOnError'
type MissingProfileResourceDifferField = Exclude<
  keyof NonNullable<AgentProfile['resources']>,
  ProfileResourceDifferHandledField
>
const profileResourceDifferIsExhaustive: MissingProfileResourceDifferField extends never
  ? true
  : never = true
void profileResourceDifferIsExhaustive

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
  experiment: AgentImprovementEvaluation['experiment'],
  intent: AgentImprovementActivationIntent,
  targets: readonly AgentImprovementActivationTarget[],
): void {
  if (isProfileImprovementExperiment(experiment)) {
    assertProfileImprovementTargetsShareIdentity(targets)
  }
  const expected = new Set(surfaces)
  const actual = new Set(targets.map((target) => target.surface))
  const sourceArm = intent === 'activate-candidate' ? 'baseline' : 'candidate'
  if (
    !(isProfileImprovementExperiment(experiment)
      ? sameAgentImprovementSurfaceSet(surfaces, activationExperimentChangedSurfaces(experiment))
      : sameOrderedSurfaces(surfaces, activationExperimentChangedSurfaces(experiment))) ||
    targets.some((target) => !target.identity.trim()) ||
    targets.some(
      (target) =>
        target.expectedBaseDigest !== activationTargetDigest(experiment, sourceArm, target.surface),
    ) ||
    targets.length !== surfaces.length ||
    expected.size !== actual.size ||
    [...expected].some((surface) => !actual.has(surface))
  ) {
    throw new Error('agent improvement activation targets must cover exactly the changed surfaces')
  }
}

/** One opaque profile-state transition can change only one complete profile record. */
export function assertProfileImprovementTargetsShareIdentity(
  targets: readonly Pick<AgentImprovementActivationTarget, 'identity'>[],
): void {
  if (new Set(targets.map((target) => target.identity)).size !== 1) {
    throw new Error('profile improvement activation targets must name one profile identity')
  }
}

/** Bind caller-owned target identities to the exact source state Runtime measured. */
export function buildAgentImprovementActivationTargets(
  surfaces: readonly AgentImprovementSurface[],
  experiment: AgentImprovementEvaluation['experiment'],
  intent: AgentImprovementActivationIntent,
  identities: readonly AgentImprovementActivationTargetIdentity[],
): [AgentImprovementActivationTarget, ...AgentImprovementActivationTarget[]] {
  const sourceArm = intent === 'activate-candidate' ? 'baseline' : 'candidate'
  const targets = identities.map((target) => ({
    ...target,
    expectedBaseDigest: activationTargetDigest(experiment, sourceArm, target.surface),
  }))
  assertAgentImprovementActivationTargets(surfaces, experiment, intent, targets)
  return targets as [AgentImprovementActivationTarget, ...AgentImprovementActivationTarget[]]
}

/** Exact host-owned profile state for every changed profile surface. */
export function agentProfileImprovementStateDigest(
  experiment: AgentProfileImprovementExperiment,
  arm: 'baseline' | 'candidate',
): Sha256Digest {
  return experiment[arm].stateDigest
}

/** Map Interface's current profile-improvement contract to Runtime-deliverable surfaces. */
export function profileImprovementChangedSurfaces(
  change: AgentProfileImprovementChange,
): [AgentProfileMeasuredSurface, ...AgentProfileMeasuredSurface[]] {
  const surfaces = changedProfileImprovementSurfaces(change)
  if (
    surfaces.length === 0 ||
    !surfaces.every((surface): surface is AgentProfileMeasuredSurface =>
      isAgentProfileMeasuredSurface(surface),
    )
  ) {
    throw new Error('profile improvement experiment does not change a supported surface')
  }
  return surfaces as [AgentProfileMeasuredSurface, ...AgentProfileMeasuredSurface[]]
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

function activationTargetDigest(
  experiment: AgentImprovementEvaluation['experiment'],
  arm: 'baseline' | 'candidate',
  surface: AgentImprovementSurface,
): Sha256Digest {
  if (isProfileImprovementExperiment(experiment)) {
    if (!activationExperimentChangedSurfaces(experiment).includes(surface)) {
      throw new Error('profile improvement activation targets an unchanged surface')
    }
    return agentProfileImprovementStateDigest(experiment, arm)
  }
  return agentImprovementTargetDigest(experiment, arm, surface)
}

function activationExperimentChangedSurfaces(
  experiment: AgentImprovementEvaluation['experiment'],
): [AgentImprovementSurface, ...AgentImprovementSurface[]] {
  if (!isProfileImprovementExperiment(experiment)) {
    return deriveChangedSurfaces(experiment.baseline, experiment.candidate)
  }
  return profileImprovementChangedSurfaces(experiment.change)
}

function isProfileImprovementExperiment(
  experiment: AgentImprovementEvaluation['experiment'],
): experiment is AgentProfileImprovementExperiment {
  return experiment.kind === 'agent-profile-improvement-experiment'
}

function sameOrderedSurfaces(
  left: readonly AgentImprovementSurface[],
  right: readonly AgentImprovementSurface[],
): boolean {
  return left.length === right.length && left.every((surface, index) => surface === right[index])
}

/** Profile-change surface order is presentation only; its measured contract is set-based. */
export function sameAgentImprovementSurfaceSet(
  left: readonly AgentImprovementSurface[],
  right: readonly AgentImprovementSurface[],
): boolean {
  return left.length === right.length && left.every((surface) => right.includes(surface))
}

/** Return whether a measured surface can be delivered through an agent profile. */
export function isAgentImprovementProfileSurface(
  surface: AgentImprovementSurface,
): surface is AgentImprovementProfileSurface {
  return (AGENT_IMPROVEMENT_PROFILE_SURFACES as readonly string[]).includes(surface)
}

/** Return whether a surface is eligible for shared profile measurement. */
export function isAgentProfileMeasuredSurface(
  surface: string,
): surface is AgentProfileMeasuredSurface {
  return (AGENT_PROFILE_MEASURED_SURFACES as readonly string[]).includes(surface)
}

/**
 * Return the canonical current-state input for one profile-deliverable improvement target.
 * Missing slots become `null`; tools and subagents include both their direct and resource slots.
 * Unrelated profile fields are excluded. The result matches `agentImprovementTargetInput` for the
 * same profile inside a candidate bundle.
 */
export function agentImprovementProfileSurfaceInput(
  profile: AgentProfile,
  surface: AgentImprovementProfileSurface,
): unknown {
  const parsed = parseExactAgentProfile(
    omitUndefinedObjectFields(profile, 'agent improvement profile'),
    'agent improvement profile',
  )
  return immutableCandidateValue(profileSurfaceInput(parsed, surface))
}

function profileSurfaceInput(
  profile: AgentProfile,
  surface: AgentImprovementProfileSurface,
): unknown {
  switch (surface) {
    case 'prompt':
      return { prompt: profile.prompt ?? null }
    case 'skills':
      return profile.resources?.skills ?? null
    case 'tools':
      return {
        tools: profile.tools ?? null,
        resources: profile.resources?.tools ?? null,
      }
    case 'mcp':
      return profile.mcp ?? null
    case 'hooks':
      return profile.hooks ?? null
    case 'subagents':
      return {
        subagents: profile.subagents ?? null,
        resources: profile.resources?.agents ?? null,
      }
  }
}

/** Return the `Sha256Digest` of one profile surface using Runtime's canonical candidate digest. */
export function agentImprovementProfileSurfaceDigest(
  profile: AgentProfile,
  surface: AgentImprovementProfileSurface,
): Sha256Digest {
  return canonicalCandidateDigest(agentImprovementProfileSurfaceInput(profile, surface))
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

/**
 * Derive the ordered profile patch that changes one executable profile into
 * another, then prove the patch preserves the complete candidate state.
 */
export function agentImprovementProfileDiffs(
  baselineInput: AgentProfile,
  candidateInput: AgentProfile,
  options: AgentImprovementTargetProfileDiffOptions,
): [AgentProfileDiff, ...AgentProfileDiff[]] {
  const baseline = parseExactAgentProfile(
    omitUndefinedObjectFields(baselineInput, 'profile improvement baseline'),
    'profile improvement baseline',
  )
  const candidate = parseExactAgentProfile(
    omitUndefinedObjectFields(candidateInput, 'profile improvement candidate'),
    'profile improvement candidate',
  )
  if (canonicalCandidateDigest(baseline) === canonicalCandidateDigest(candidate)) {
    throw new Error('profile improvement candidate does not change the profile')
  }
  const completeChanges = completeAgentProfileReplacementDiffs(baseline, candidate, options)
  const applied = completeChanges.reduce(
    (profile, change) =>
      applyExactAgentProfileDiff(profile, change, 'complete profile improvement candidate change'),
    baseline,
  )
  if (canonicalCandidateDigest(applied) !== canonicalCandidateDigest(candidate)) {
    throw new Error('complete profile improvement change did not reproduce the candidate')
  }
  return completeChanges
}

function completeAgentProfileReplacementDiffs(
  baseline: AgentProfile,
  candidate: AgentProfile,
  options: AgentImprovementTargetProfileDiffOptions,
): [AgentProfileDiff, ...AgentProfileDiff[]] {
  const remove: AgentProfileDiffRemoval = {}
  const set: AgentProfile = {}
  if (
    profileValuesDiffer(baseline.name, candidate.name) ||
    profileValuesDiffer(baseline.description, candidate.description) ||
    profileValuesDiffer(baseline.version, candidate.version)
  ) {
    remove.identity = true
    if (candidate.name !== undefined) set.name = candidate.name
    if (candidate.description !== undefined) set.description = candidate.description
    if (candidate.version !== undefined) set.version = candidate.version
  }
  if (profileValuesDiffer(baseline.tags, candidate.tags)) {
    remove.tags = true
    if (candidate.tags !== undefined) set.tags = candidate.tags
  }
  if (profileValuesDiffer(baseline.prompt, candidate.prompt)) {
    remove.prompt = true
    if (candidate.prompt !== undefined) set.prompt = candidate.prompt
  }
  if (profileValuesDiffer(baseline.model, candidate.model)) {
    remove.model = true
    if (candidate.model !== undefined) set.model = candidate.model
  }
  if (profileValuesDiffer(baseline.harness, candidate.harness)) {
    remove.harness = true
    if (candidate.harness !== undefined) set.harness = candidate.harness
  }
  if (profileValuesDiffer(baseline.permissions, candidate.permissions)) {
    remove.permissions = true
    if (candidate.permissions !== undefined) set.permissions = candidate.permissions
  }
  if (profileValuesDiffer(baseline.tools, candidate.tools)) {
    remove.tools = true
    if (candidate.tools !== undefined) set.tools = candidate.tools
  }
  if (profileValuesDiffer(baseline.mcp, candidate.mcp)) {
    remove.mcp = true
    if (candidate.mcp !== undefined) set.mcp = candidate.mcp
  }
  if (profileValuesDiffer(baseline.connections, candidate.connections)) {
    remove.connections = true
    if (candidate.connections !== undefined) set.connections = candidate.connections
  }
  if (profileValuesDiffer(baseline.subagents, candidate.subagents)) {
    remove.subagents = true
    if (candidate.subagents !== undefined) set.subagents = candidate.subagents
  }
  replaceChangedProfileResources(baseline.resources, candidate.resources, remove, set)
  if (profileValuesDiffer(baseline.hooks, candidate.hooks)) {
    remove.hooks = true
    if (candidate.hooks !== undefined) set.hooks = candidate.hooks
  }
  if (profileValuesDiffer(baseline.modes, candidate.modes)) {
    remove.modes = true
    if (candidate.modes !== undefined) set.modes = candidate.modes
  }
  if (profileValuesDiffer(baseline.confidential, candidate.confidential)) {
    remove.confidential = true
    if (candidate.confidential !== undefined) set.confidential = candidate.confidential
  }
  if (profileValuesDiffer(baseline.metadata, candidate.metadata)) {
    remove.metadata = true
    if (candidate.metadata !== undefined) set.metadata = candidate.metadata
  }
  if (profileValuesDiffer(baseline.extensions, candidate.extensions)) {
    remove.extensions = true
    if (candidate.extensions !== undefined) set.extensions = candidate.extensions
  }
  if (Object.keys(remove).length === 0) {
    throw new Error('complete profile differ found no changed fields')
  }
  const common = {
    kind: 'agent-profile-diff' as const,
    ...(options.source ? { source: options.source } : {}),
    metadata: {
      ...(options.metadata ?? {}),
      surface: 'agent-profile',
    },
  }
  const reset = agentProfileDiffSchema.parse(
    defineAgentProfileDiff({
      ...common,
      id: `${options.id}:agent-profile:reset`,
      title: 'Reset changed agent profile fields',
      remove,
    }),
  ) as AgentProfileDiff
  if (Object.keys(set).length === 0) return [reset]
  const replacement = agentProfileDiffSchema.parse(
    defineAgentProfileDiff({
      ...common,
      id: `${options.id}:agent-profile:set`,
      title: 'Set changed agent profile fields',
      set,
    }),
  ) as AgentProfileDiff
  return [reset, replacement]
}

function replaceChangedProfileResources(
  baseline: AgentProfile['resources'],
  candidate: AgentProfile['resources'],
  remove: AgentProfileDiffRemoval,
  set: AgentProfile,
): void {
  if (!profileValuesDiffer(baseline, candidate)) return
  const resourceRemoval: Exclude<AgentProfileDiffRemoval['resources'], true | undefined> = {}
  const resourceSet: NonNullable<AgentProfile['resources']> = {}
  let changedSubfields = 0

  if (profileValuesDiffer(baseline?.files, candidate?.files)) {
    changedSubfields += 1
    resourceRemoval.files = true
    if (candidate?.files !== undefined) resourceSet.files = candidate.files
  }
  if (profileValuesDiffer(baseline?.tools, candidate?.tools)) {
    changedSubfields += 1
    resourceRemoval.tools = true
    if (candidate?.tools !== undefined) resourceSet.tools = candidate.tools
  }
  if (profileValuesDiffer(baseline?.skills, candidate?.skills)) {
    changedSubfields += 1
    resourceRemoval.skills = true
    if (candidate?.skills !== undefined) resourceSet.skills = candidate.skills
  }
  if (profileValuesDiffer(baseline?.agents, candidate?.agents)) {
    changedSubfields += 1
    resourceRemoval.agents = true
    if (candidate?.agents !== undefined) resourceSet.agents = candidate.agents
  }
  if (profileValuesDiffer(baseline?.commands, candidate?.commands)) {
    changedSubfields += 1
    resourceRemoval.commands = true
    if (candidate?.commands !== undefined) resourceSet.commands = candidate.commands
  }
  if (profileValuesDiffer(baseline?.instructions, candidate?.instructions)) {
    changedSubfields += 1
    resourceRemoval.instructions = true
    if (candidate?.instructions !== undefined) resourceSet.instructions = candidate.instructions
  }
  if (profileValuesDiffer(baseline?.failOnError, candidate?.failOnError)) {
    changedSubfields += 1
    resourceRemoval.failOnError = true
    if (candidate?.failOnError !== undefined) resourceSet.failOnError = candidate.failOnError
  }

  if (changedSubfields === 0) {
    remove.resources = true
    if (candidate !== undefined) set.resources = candidate
    return
  }
  remove.resources = resourceRemoval
  if (Object.keys(resourceSet).length > 0) set.resources = resourceSet
}

function profileValuesDiffer(baseline: unknown, candidate: unknown): boolean {
  const comparable = (value: unknown) =>
    value === undefined ? { present: false } : { present: true, value }
  return (
    canonicalCandidateDigest(comparable(baseline)) !==
    canonicalCandidateDigest(comparable(candidate))
  )
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
    prompt: agentImprovementProfileSurfaceInput(profile, 'prompt'),
    skills: agentImprovementProfileSurfaceInput(profile, 'skills'),
    tools: agentImprovementProfileSurfaceInput(profile, 'tools'),
    mcp: agentImprovementProfileSurfaceInput(profile, 'mcp'),
    hooks: agentImprovementProfileSurfaceInput(profile, 'hooks'),
    subagents: agentImprovementProfileSurfaceInput(profile, 'subagents'),
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
