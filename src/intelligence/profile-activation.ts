import type {
  AgentImprovementActivationTargetState,
  AgentImprovementActivationTargetTransition,
  AgentProfile,
} from '@tangle-network/agent-interface'

import { immutableCandidateValue } from '../candidate-execution/digest'
import {
  applyExactAgentProfileDiff,
  omitUndefinedObjectFields,
  parseExactAgentProfile,
} from '../candidate-execution/profile'
import type { AgentImprovementActivationTargetPlan } from './activation'
import {
  type AgentImprovementProfileSurface,
  agentImprovementProfileSurfaceDigest,
  agentImprovementTargetProfileDiffs,
} from './improvement-surfaces'

export type AgentImprovementProfileActivationTarget = Omit<
  AgentImprovementActivationTargetPlan,
  'surface'
> & {
  surface: AgentImprovementProfileSurface
}

export type AgentImprovementProfileTargetState = Omit<
  AgentImprovementActivationTargetState,
  'surface'
> & { surface: AgentImprovementProfileSurface }

export type AgentImprovementProfileTargetTransition = Omit<
  AgentImprovementActivationTargetTransition,
  'surface'
> & { surface: AgentImprovementProfileSurface }

export interface AgentImprovementProfileReplacement {
  identity: string
  profile: AgentProfile
}

export type AgentImprovementProfileActivationPreparation =
  | {
      status: 'missing'
      identities: readonly string[]
    }
  | {
      status: 'already-applied' | 'conflict'
      targets: [AgentImprovementProfileTargetState, ...AgentImprovementProfileTargetState[]]
    }
  | {
      status: 'apply'
      replacements: [AgentImprovementProfileReplacement, ...AgentImprovementProfileReplacement[]]
      targets: [
        AgentImprovementProfileTargetTransition,
        ...AgentImprovementProfileTargetTransition[],
      ]
    }

/**
 * Compare product-owned profiles with an exact measured transition and prepare
 * the all-or-none replacements. The caller owns locking, persistence, and the
 * durable activation receipt; this function owns profile semantics only.
 * Profiles stay in product-owned stores, so this returns replacements instead
 * of owning the transition callbacks used by Runtime-owned knowledge stores.
 */
export function prepareAgentImprovementProfileActivation(input: {
  currentByIdentity: ReadonlyMap<string, AgentProfile>
  targets: readonly [
    AgentImprovementProfileActivationTarget,
    ...AgentImprovementProfileActivationTarget[],
  ]
}): AgentImprovementProfileActivationPreparation {
  const targetKeys = input.targets.map((target) => `${target.identity}\u0000${target.surface}`)
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new Error('agent profile activation repeats a target')
  }

  const identities = [...new Set(input.targets.map((target) => target.identity))].sort()
  const missing = identities.filter((identity) => !input.currentByIdentity.has(identity))
  if (missing.length > 0) {
    return immutableCandidateValue({ status: 'missing', identities: missing })
  }

  const currentProfiles = new Map(
    identities.map((identity) => {
      const profile = input.currentByIdentity.get(identity)
      if (!profile) throw new Error(`missing agent profile ${identity}`)
      const label = `agent profile activation ${identity}`
      return [identity, parseExactAgentProfile(omitUndefinedObjectFields(profile, label), label)]
    }),
  )
  const current = input.targets.map((target) => {
    const profile = currentProfiles.get(target.identity)
    if (!profile) throw new Error(`missing agent profile ${target.identity}`)
    return {
      target,
      currentDigest: agentImprovementProfileSurfaceDigest(profile, target.surface),
    }
  })
  const states = current.map(({ target, currentDigest }) => ({
    surface: target.surface,
    identity: target.identity,
    currentDigest,
  })) as [AgentImprovementProfileTargetState, ...AgentImprovementProfileTargetState[]]

  if (current.every(({ target, currentDigest }) => currentDigest === target.desiredDigest)) {
    return immutableCandidateValue({ status: 'already-applied', targets: states })
  }
  if (current.some(({ target, currentDigest }) => currentDigest !== target.expectedBaseDigest)) {
    return immutableCandidateValue({ status: 'conflict', targets: states })
  }

  const profiles = new Map<string, AgentProfile>()
  for (const identity of identities) {
    const currentProfile = currentProfiles.get(identity)
    if (!currentProfile) throw new Error(`missing agent profile ${identity}`)
    const profile = input.targets
      .filter((target) => target.identity === identity)
      .flatMap((target) =>
        agentImprovementTargetProfileDiffs(target, {
          id: `${target.identity}:${target.desiredDigest}`,
          metadata: { identity },
        }),
      )
      .reduce(
        (value, diff) =>
          applyExactAgentProfileDiff(value, diff, `agent profile activation ${identity}`),
        currentProfile,
      )
    profiles.set(identity, immutableCandidateValue(profile))
  }

  for (const target of input.targets) {
    const profile = profiles.get(target.identity)
    if (
      !profile ||
      agentImprovementProfileSurfaceDigest(profile, target.surface) !== target.desiredDigest
    ) {
      throw new Error(
        `agent profile activation did not produce ${target.identity}:${target.surface}`,
      )
    }
  }

  return immutableCandidateValue({
    status: 'apply',
    replacements: identities.map((identity) => {
      const profile = profiles.get(identity)
      if (!profile) throw new Error(`missing prepared agent profile ${identity}`)
      return { identity, profile }
    }) as [AgentImprovementProfileReplacement, ...AgentImprovementProfileReplacement[]],
    targets: input.targets.map((target) => ({
      surface: target.surface,
      identity: target.identity,
      beforeDigest: target.expectedBaseDigest,
      afterDigest: target.desiredDigest,
    })) as [AgentImprovementProfileTargetTransition, ...AgentImprovementProfileTargetTransition[]],
  })
}
