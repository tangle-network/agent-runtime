import type {
  AgentImprovementActivationTargetState,
  AgentImprovementActivationTargetTransition,
  AgentProfile,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import { agentProfileImprovementArmSchema } from '@tangle-network/agent-interface'

import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import {
  applyExactAgentProfileDiff,
  omitUndefinedObjectFields,
  parseExactAgentProfile,
} from '../candidate-execution/profile'
import type {
  AgentImprovementActivationTargetPlan,
  ProfileImprovementActivationTransitionInput,
} from './activation'
import {
  type AgentImprovementProfileSurface,
  type AgentProfileMeasuredSurface,
  agentImprovementProfileSurfaceDigest,
  agentImprovementTargetProfileDiffs,
  assertProfileImprovementTargetsShareIdentity,
  isAgentProfileMeasuredSurface,
} from './improvement-surfaces'

export type AgentImprovementProfileActivationTarget = Omit<
  AgentImprovementActivationTargetPlan,
  'surface'
> & {
  surface: AgentImprovementProfileSurface
}

type AgentProfileImprovementTransitionTarget = Omit<
  AgentImprovementActivationTargetPlan,
  'surface'
> & {
  surface: AgentProfileMeasuredSurface
}

export type AgentImprovementProfileTargetState = Omit<
  AgentImprovementActivationTargetState,
  'surface'
> & { surface: AgentProfileMeasuredSurface }

export type AgentImprovementProfileTargetTransition = Omit<
  AgentImprovementActivationTargetTransition,
  'surface'
> & { surface: AgentProfileMeasuredSurface }

export interface AgentImprovementProfileReplacement {
  identity: string
  profile: AgentProfile
}

export interface AgentImprovementProfileStateDigestInput {
  identity: string
  profile: AgentProfile
}

/** Product-defined hash of the complete profile state that actually runs. */
export type AgentImprovementProfileStateDigest = (
  input: AgentImprovementProfileStateDigestInput,
) => Sha256Digest

export interface AgentImprovementProfileStateResolverInput {
  identity: string
  stateDigest: Sha256Digest
}

/** Product-owned retained-state lookup used only for an explicit restore. */
export type AgentImprovementProfileStateResolver = (
  input: AgentImprovementProfileStateResolverInput,
) => AgentProfile | undefined

export type AgentImprovementProfileActivationInput =
  | {
      currentByIdentity: ReadonlyMap<string, AgentProfile>
      targets: readonly [
        AgentImprovementProfileActivationTarget,
        ...AgentImprovementProfileActivationTarget[],
      ]
    }
  | {
      currentByIdentity: ReadonlyMap<string, AgentProfile>
      profileTransition: ProfileImprovementActivationTransitionInput
      stateDigest: AgentImprovementProfileStateDigest
      resolveState?: AgentImprovementProfileStateResolver
    }

export type AgentImprovementProfileActivationPreparation =
  | {
      status: 'missing'
      identities: readonly string[]
    }
  | {
      status: 'unavailable'
      code: 'PROFILE_STATE_UNAVAILABLE'
      identities: readonly string[]
      requiredStateDigest: Sha256Digest
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

interface CurrentProfiles {
  identities: string[]
  byIdentity: Map<string, AgentProfile>
}

/**
 * Compare product-owned profiles with an exact measured transition and prepare
 * all-or-none replacements. The product owns locking, persistence, and retained
 * state; Runtime owns the profile diff semantics and digest checks.
 */
export function prepareAgentImprovementProfileActivation(
  input: AgentImprovementProfileActivationInput,
): AgentImprovementProfileActivationPreparation {
  if ('profileTransition' in input) {
    const targets = profileTargets(input.profileTransition.targets)
    assertUniqueProfileTargets(targets)
    const current = readCurrentProfiles(input.currentByIdentity, targets)
    if ('status' in current) return immutableCandidateValue(current)
    return prepareProfileImprovementActivation(input, targets, current)
  }
  const targets = input.targets
  assertUniqueProfileTargets(targets)
  const current = readCurrentProfiles(input.currentByIdentity, targets)
  if ('status' in current) return immutableCandidateValue(current)
  return prepareSurfaceReplacementActivation(targets, current)
}

function prepareSurfaceReplacementActivation(
  targets: readonly [
    AgentImprovementProfileActivationTarget,
    ...AgentImprovementProfileActivationTarget[],
  ],
  currentProfiles: CurrentProfiles,
): AgentImprovementProfileActivationPreparation {
  const current = targets.map((target) => {
    const profile = currentProfiles.byIdentity.get(target.identity)
    if (!profile) throw new Error(`missing agent profile ${target.identity}`)
    return {
      target,
      currentDigest: agentImprovementProfileSurfaceDigest(profile, target.surface),
    }
  })
  const states = targetStates(current)

  if (current.every(({ target, currentDigest }) => currentDigest === target.desiredDigest)) {
    return immutableCandidateValue({ status: 'already-applied', targets: states })
  }
  if (current.some(({ target, currentDigest }) => currentDigest !== target.expectedBaseDigest)) {
    return immutableCandidateValue({ status: 'conflict', targets: states })
  }

  const profiles = new Map<string, AgentProfile>()
  for (const identity of currentProfiles.identities) {
    const currentProfile = currentProfiles.byIdentity.get(identity)
    if (!currentProfile) throw new Error(`missing agent profile ${identity}`)
    const profile = targets
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

  for (const target of targets) {
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
  return appliedProfileReplacement(currentProfiles.identities, profiles, targets)
}

function prepareProfileImprovementActivation(
  input: Extract<AgentImprovementProfileActivationInput, { profileTransition: unknown }>,
  targets: readonly [
    AgentProfileImprovementTransitionTarget,
    ...AgentProfileImprovementTransitionTarget[],
  ],
  currentProfiles: CurrentProfiles,
): AgentImprovementProfileActivationPreparation {
  const transition = input.profileTransition
  assertProfileTransitionTargets(transition, targets)
  const current = targets.map((target) => {
    const profile = currentProfiles.byIdentity.get(target.identity)
    if (!profile) throw new Error(`missing agent profile ${target.identity}`)
    return {
      target,
      currentDigest: profileStateDigest(input.stateDigest, target.identity, profile),
    }
  })
  const states = targetStates(current)

  if (current.every(({ currentDigest }) => currentDigest === transition.desiredStateDigest)) {
    return immutableCandidateValue({ status: 'already-applied', targets: states })
  }
  if (current.some(({ currentDigest }) => currentDigest !== transition.sourceStateDigest)) {
    return immutableCandidateValue({ status: 'conflict', targets: states })
  }

  const profiles = new Map<string, AgentProfile>()
  for (const identity of currentProfiles.identities) {
    const currentProfile = currentProfiles.byIdentity.get(identity)
    if (!currentProfile) throw new Error(`missing agent profile ${identity}`)
    const profile =
      transition.operation.kind === 'apply-change'
        ? transition.operation.changes.reduce(
            (value, diff) =>
              applyExactAgentProfileDiff(value, diff, `profile improvement activation ${identity}`),
            currentProfile,
          )
        : restoreProfileState(input.resolveState, identity, transition.desiredStateDigest)
    if (!profile) {
      return immutableCandidateValue({
        status: 'unavailable',
        code: 'PROFILE_STATE_UNAVAILABLE',
        identities: currentProfiles.identities,
        requiredStateDigest: transition.desiredStateDigest,
      })
    }
    const parsed = parseExactAgentProfile(
      omitUndefinedObjectFields(profile, `profile improvement activation ${identity}`),
      `profile improvement activation ${identity}`,
    )
    if (profileStateDigest(input.stateDigest, identity, parsed) !== transition.desiredStateDigest) {
      throw new Error(`profile improvement activation did not produce ${identity}`)
    }
    profiles.set(identity, immutableCandidateValue(parsed))
  }

  return appliedProfileReplacement(currentProfiles.identities, profiles, targets)
}

function restoreProfileState(
  resolveState: AgentImprovementProfileStateResolver | undefined,
  identity: string,
  stateDigest: Sha256Digest,
): AgentProfile | undefined {
  return resolveState?.({ identity, stateDigest })
}

function assertProfileTransitionTargets(
  transition: ProfileImprovementActivationTransitionInput,
  targets: readonly AgentProfileImprovementTransitionTarget[],
): void {
  assertProfileImprovementTargetsShareIdentity(targets)
  const operationDigest = canonicalCandidateDigest(transition.operation)
  if (
    targets.some(
      (target) =>
        target.expectedBaseDigest !== transition.sourceStateDigest ||
        target.desiredDigest !== transition.desiredStateDigest ||
        canonicalCandidateDigest(target.desiredInput) !== operationDigest,
    )
  ) {
    throw new Error('profile improvement targets do not match their transition')
  }
}

function appliedProfileReplacement(
  identities: readonly string[],
  profiles: ReadonlyMap<string, AgentProfile>,
  targets: readonly [
    AgentProfileImprovementTransitionTarget,
    ...AgentProfileImprovementTransitionTarget[],
  ],
): AgentImprovementProfileActivationPreparation {
  return immutableCandidateValue({
    status: 'apply',
    replacements: identities.map((identity) => {
      const profile = profiles.get(identity)
      if (!profile) throw new Error(`missing prepared agent profile ${identity}`)
      return { identity, profile }
    }) as [AgentImprovementProfileReplacement, ...AgentImprovementProfileReplacement[]],
    targets: targets.map((target) => ({
      surface: target.surface,
      identity: target.identity,
      beforeDigest: target.expectedBaseDigest,
      afterDigest: target.desiredDigest,
    })) as [AgentImprovementProfileTargetTransition, ...AgentImprovementProfileTargetTransition[]],
  })
}

function targetStates(
  current: readonly {
    target: AgentProfileImprovementTransitionTarget
    currentDigest: Sha256Digest
  }[],
): [AgentImprovementProfileTargetState, ...AgentImprovementProfileTargetState[]] {
  const first = current[0]
  if (!first) throw new Error('agent profile activation requires a target')
  return current.map(({ target, currentDigest }) => ({
    surface: target.surface,
    identity: target.identity,
    currentDigest,
  })) as [AgentImprovementProfileTargetState, ...AgentImprovementProfileTargetState[]]
}

function profileStateDigest(
  stateDigest: AgentImprovementProfileStateDigest,
  identity: string,
  profile: AgentProfile,
): Sha256Digest {
  return agentProfileImprovementArmSchema.parse({ stateDigest: stateDigest({ identity, profile }) })
    .stateDigest
}

function readCurrentProfiles(
  currentByIdentity: ReadonlyMap<string, AgentProfile>,
  targets: readonly AgentProfileImprovementTransitionTarget[],
): CurrentProfiles | { status: 'missing'; identities: string[] } {
  const identities = [...new Set(targets.map((target) => target.identity))].sort()
  const missing = identities.filter((identity) => !currentByIdentity.has(identity))
  if (missing.length > 0) return { status: 'missing', identities: missing }
  return {
    identities,
    byIdentity: new Map(
      identities.map((identity) => {
        const profile = currentByIdentity.get(identity)
        if (!profile) throw new Error(`missing agent profile ${identity}`)
        const label = `agent profile activation ${identity}`
        return [identity, parseExactAgentProfile(omitUndefinedObjectFields(profile, label), label)]
      }),
    ),
  }
}

function profileTargets(
  targets: readonly AgentImprovementActivationTargetPlan[],
): [AgentProfileImprovementTransitionTarget, ...AgentProfileImprovementTransitionTarget[]] {
  if (!targets.every((target) => isAgentProfileMeasuredSurface(target.surface))) {
    throw new Error('agent profile activation contains an unsupported surface')
  }
  const first = targets[0]
  if (!first) throw new Error('agent profile activation requires a target')
  return targets as [
    AgentProfileImprovementTransitionTarget,
    ...AgentProfileImprovementTransitionTarget[],
  ]
}

function assertUniqueProfileTargets(
  targets: readonly AgentProfileImprovementTransitionTarget[],
): void {
  const targetKeys = targets.map((target) => `${target.identity}\u0000${target.surface}`)
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new Error('agent profile activation repeats a target')
  }
}
