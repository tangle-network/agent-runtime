import { canonicalJson } from '@tangle-network/agent-eval'
import type { MutableSurface } from '@tangle-network/agent-eval/contract'
import {
  type AgentProfile,
  type AgentProfileResourceRef,
  agentProfileSchema,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import type {
  ImproveProfileComponents,
  ImproveProfileSurface,
  ImproveSkillsOptions,
  ImproveSurface,
} from './improve-types'
import type { ReadonlyAgentProfile } from './profile-types'
import {
  applyRolloutPolicyToProfile,
  normalizeRolloutPolicy,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from './rollout-policy'

export interface PreparedProfileSurface {
  surface: MutableSurface
  value: unknown
}

/** Extract the baseline optimized by a method and retain its structured value
 * so external optimizers can inspect it for private fields before serialization. */
export function prepareProfileSurface(
  profile: ReadonlyAgentProfile,
  surface: ImproveSurface,
  skills?: ImproveSkillsOptions,
  profileComponents?: ImproveProfileComponents,
): PreparedProfileSurface {
  switch (surface) {
    case 'prompt':
      return {
        surface: profile.prompt?.systemPrompt ?? '',
        value: profile.prompt?.systemPrompt ?? '',
      }
    case 'skills': {
      const value = inlineSkill(profile, skills).content
      return { surface: value, value }
    }
    case 'tools': {
      const value = profile.tools ?? {}
      return { surface: canonicalJson(value), value }
    }
    case 'mcp': {
      const value = profile.mcp ?? {}
      return { surface: canonicalJson(value), value }
    }
    case 'hooks': {
      const value = profile.hooks ?? {}
      return { surface: canonicalJson(value), value }
    }
    case 'subagents': {
      const value = profile.subagents ?? {}
      return { surface: canonicalJson(value), value }
    }
    case 'agent-profile': {
      if (profileComponents) {
        const value = profileComponents.read(profile)
        return {
          surface: componentSurface(value, 'profileComponents.read'),
          value,
        }
      }
      return { surface: canonicalJson(profile), value: profile }
    }
    case 'memory': {
      const value = profileInstructions(profile)
      return { surface: value, value }
    }
    case 'rollout-policy': {
      const policy = structuralRolloutPolicyFromProfile(profile)
      if (!policy) {
        throw new ConfigError(
          "improve(): surface 'rollout-policy' requires an existing structural rollout policy",
        )
      }
      return { surface: serializeRolloutPolicy(policy), value: policy }
    }
    case 'code':
      throw new ConfigError(
        'improve(): code requires the isolated baseline created from opts.code.repoRoot',
      )
  }
}

export function isCodeSurface(
  surface: MutableSurface | undefined,
): surface is Extract<MutableSurface, { readonly kind: 'code' }> {
  return typeof surface === 'object' && surface !== null && surface.kind === 'code'
}

type ComponentSurface = Extract<MutableSurface, { readonly kind: 'components' }>

function isComponentSurface(surface: MutableSurface | undefined): surface is ComponentSurface {
  return typeof surface === 'object' && surface !== null && surface.kind === 'components'
}

function componentSurface(
  components: Readonly<Record<string, string>>,
  source: string,
): ComponentSurface {
  const entries = validateComponents(components, source)
  return immutableCandidateValue({
    kind: 'components',
    components: Object.fromEntries(entries),
  } as ComponentSurface)
}

function validateComponents(
  components: Readonly<Record<string, string>>,
  source: string,
): Array<[string, string]> {
  if (typeof components !== 'object' || components === null || Array.isArray(components)) {
    throw new ConfigError(`improve(): ${source} must return a component record`)
  }
  const entries = Object.entries(components)
  if (entries.length === 0) {
    throw new ConfigError(`improve(): ${source} must return at least one component`)
  }
  for (const [name, value] of entries) {
    if (!name || name.trim() !== name || typeof value !== 'string') {
      throw new ConfigError(
        `improve(): ${source} must return trimmed component names with string values`,
      )
    }
  }
  return entries
}

/** Parse a JSON winner surface with a typed, contextual error. */
function parseWinnerJson<T>(winner: string, surface: ImproveSurface): T {
  try {
    return JSON.parse(winner) as T
  } catch (cause) {
    throw new ConfigError(
      `improve(): the '${surface}' candidate is not valid JSON, so it cannot form a profile candidate: ${
        (cause as Error).message
      }`,
    )
  }
}

export function assertCandidateSurfaceKind(
  surface: ImproveSurface,
  baseline: MutableSurface,
  winner: MutableSurface,
): asserts winner is MutableSurface {
  if (surface === 'code') {
    if (isCodeSurface(winner)) return
    throw new ConfigError(
      `improve(): the '${surface}' candidate returned an incompatible surface value`,
    )
  }
  if (typeof baseline === 'string') {
    if (typeof winner === 'string') return
    throw new ConfigError(
      `improve(): the '${surface}' candidate changed from a text surface to an incompatible surface value`,
    )
  }
  if (!isComponentSurface(baseline) || !isComponentSurface(winner)) {
    throw new ConfigError(
      `improve(): the '${surface}' candidate returned an incompatible surface value`,
    )
  }
  validateComponents(winner.components, `the '${surface}' candidate`)
  const baselineNames = Object.keys(baseline.components).sort()
  const winnerNames = Object.keys(winner.components).sort()
  if (
    baselineNames.length !== winnerNames.length ||
    baselineNames.some((name, index) => name !== winnerNames[index])
  ) {
    throw new ConfigError(
      `improve(): the '${surface}' candidate must preserve the exact component names`,
    )
  }
}

/** Materialize a detached profile candidate without changing the baseline. */
function materializeImprovementProfileCandidate(
  profile: AgentProfile,
  surface: ImproveProfileSurface,
  winner: MutableSurface,
  skills?: ImproveSkillsOptions,
  profileComponents?: ImproveProfileComponents,
): AgentProfile {
  let candidate: AgentProfile
  if (isComponentSurface(winner)) {
    if (surface !== 'agent-profile' || !profileComponents) {
      throw new ConfigError(
        `improve(): the '${surface}' candidate has no profile component mapping`,
      )
    }
    const winnerComponents = immutableCandidateValue({ ...winner.components })
    const applied = profileComponents.apply(profile, winnerComponents)
    const validated = validateProfileCandidate(applied, surface)
    const materializedComponents = Object.fromEntries(
      validateComponents(profileComponents.read(validated), 'profileComponents.read after apply'),
    )
    const names = Object.keys(winnerComponents)
    if (
      names.length !== Object.keys(materializedComponents).length ||
      names.some((name) => materializedComponents[name] !== winnerComponents[name])
    ) {
      throw new ConfigError(
        'improve(): profileComponents.apply must round-trip every winning component exactly',
      )
    }
    return validated
  }
  if (typeof winner !== 'string') {
    throw new ConfigError(`improve(): the '${surface}' candidate cannot form an AgentProfile`)
  }
  switch (surface) {
    case 'prompt':
      candidate = { ...profile, prompt: { ...profile.prompt, systemPrompt: winner } }
      break
    case 'skills': {
      const selectedSkill = inlineSkill(profile, skills)
      candidate = {
        ...profile,
        resources: {
          ...profile.resources,
          skills: profile.resources?.skills?.map((resource) =>
            resource === selectedSkill ? { ...resource, content: winner } : resource,
          ),
        },
      }
      break
    }
    case 'tools':
      candidate = { ...profile, tools: parseWinnerJson(winner, surface) }
      break
    case 'mcp':
      candidate = { ...profile, mcp: parseWinnerJson(winner, surface) }
      break
    case 'hooks':
      candidate = { ...profile, hooks: parseWinnerJson(winner, surface) }
      break
    case 'subagents':
      candidate = { ...profile, subagents: parseWinnerJson(winner, surface) }
      break
    case 'agent-profile':
      candidate = parseWinnerJson(winner, surface)
      break
    case 'memory':
      candidate = {
        ...profile,
        resources: {
          ...profile.resources,
          instructions: replaceProfileInstructions(profile, winner),
        },
      }
      break
    case 'rollout-policy': {
      const policy = normalizeRolloutPolicy(parseWinnerJson(winner, surface))
      if (!policy) {
        throw new ConfigError(
          `improve(): the shipped 'rollout-policy' winner is not a valid StructuralRolloutPolicy ` +
            `(integer k >= 1, repairRounds >= 0, testgen >= 0), so it cannot be applied: ${winner}`,
        )
      }
      candidate = applyRolloutPolicyToProfile(profile, policy)
      break
    }
  }
  return validateProfileCandidate(candidate, surface)
}

function validateProfileCandidate(candidate: unknown, surface: ImproveSurface): AgentProfile {
  const parsed = agentProfileSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new ConfigError(
      `improve(): the '${surface}' candidate does not produce a valid AgentProfile: ${parsed.error.message}`,
    )
  }
  return immutableCandidateValue(parsed.data)
}

export function createProfileCandidateMaterializer(
  profile: AgentProfile,
  surface: ImproveProfileSurface,
  baselineSurface: MutableSurface,
  skills?: ImproveSkillsOptions,
  profileComponents?: ImproveProfileComponents,
): (candidateSurface: MutableSurface) => AgentProfile {
  const baselineDigest = canonicalCandidateDigest(baselineSurface)
  if (profileComponents) {
    const reappliedBaseline = materializeImprovementProfileCandidate(
      profile,
      surface,
      baselineSurface,
      skills,
      profileComponents,
    )
    if (canonicalCandidateDigest(reappliedBaseline) !== canonicalCandidateDigest(profile)) {
      throw new ConfigError(
        'improve(): profileComponents.apply(profile, profileComponents.read(profile)) must reproduce the complete baseline profile exactly',
      )
    }
  }
  const candidates = new Map<Sha256Digest, AgentProfile>([[baselineDigest, profile]])
  return (candidateSurface) => {
    assertCandidateSurfaceKind(surface, baselineSurface, candidateSurface)
    const digest = canonicalCandidateDigest(candidateSurface)
    const existing = candidates.get(digest)
    if (existing) return existing
    const candidate = materializeImprovementProfileCandidate(
      profile,
      surface,
      immutableCandidateValue(candidateSurface),
      skills,
      profileComponents,
    )
    candidates.set(digest, candidate)
    return candidate
  }
}

function inlineSkill(
  profile: ReadonlyAgentProfile,
  options: ImproveSkillsOptions | undefined,
): Readonly<Extract<AgentProfileResourceRef, { kind: 'inline' }>> {
  const resourceName = options?.resourceName.trim()
  if (!resourceName) {
    throw new ConfigError(
      "improve(): surface 'skills' requires opts.skills.resourceName for one inline profile skill",
    )
  }
  assertFailClosedResources(profile, 'skills')
  const matches = (profile.resources?.skills ?? []).filter(
    (resource) => resource.name === resourceName,
  )
  if (matches.length !== 1 || matches[0]?.kind !== 'inline') {
    throw new ConfigError(
      `improve(): skill '${resourceName}' must identify exactly one inline profile resource`,
    )
  }
  return matches[0]
}

function profileInstructions(profile: ReadonlyAgentProfile): string {
  assertFailClosedResources(profile, 'memory')
  const instructions = profile.resources?.instructions
  if (instructions === undefined) return ''
  if (typeof instructions === 'string') return instructions
  if (instructions.kind === 'inline') return instructions.content
  throw new ConfigError(
    "improve(): surface 'memory' requires inline profile instructions so candidate bytes are exact",
  )
}

function replaceProfileInstructions(
  profile: AgentProfile,
  content: string,
): string | AgentProfileResourceRef {
  const instructions = profile.resources?.instructions
  if (typeof instructions !== 'object') return content
  if (instructions.kind !== 'inline') {
    throw new ConfigError(
      "improve(): surface 'memory' requires inline profile instructions so candidate bytes are exact",
    )
  }
  return { ...instructions, content }
}

function assertFailClosedResources(
  profile: ReadonlyAgentProfile,
  surface: 'skills' | 'memory',
): void {
  if (profile.resources?.failOnError !== true) {
    throw new ConfigError(
      `improve(): surface '${surface}' requires profile.resources.failOnError: true`,
    )
  }
}
