import {
  type AgentProfile,
  type AgentProfileDiff,
  defineInlineResource,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'

import {
  type AgentProfileImprovementActivationOperation,
  agentImprovementProfileSurfaceDigest,
  createAgentImprovementActivation,
  createAgentImprovementActivationResult,
  createAgentImprovementProposal,
  executeAgentImprovementActivation,
  type ProfileImprovementActivationTransitionInput,
  prepareAgentImprovementProfileActivation,
  reviewAgentImprovementProposal,
} from '../src/intelligence'
import { improvementFinding } from './helpers/improvement-method-fixture'
import { createProfileImprovementFixture } from './helpers/profile-improvement-fixture'

const base: AgentProfile = {
  name: 'support',
  prompt: { systemPrompt: 'Old prompt' },
  tools: { Bash: true },
  resources: {
    skills: [defineInlineResource('old.SKILL.md', 'Old skill')],
  },
}

function target(surface: 'prompt' | 'skills', desiredInput: unknown, desiredProfile: AgentProfile) {
  return {
    surface,
    identity: 'profile-1',
    expectedBaseDigest: agentImprovementProfileSurfaceDigest(base, surface),
    desiredDigest: agentImprovementProfileSurfaceDigest(desiredProfile, surface),
    desiredInput,
  }
}

function mapNonEmpty<T, U>(values: readonly [T, ...T[]], map: (value: T) => U): [U, ...U[]] {
  const [first, ...rest] = values
  return [map(first), ...rest.map(map)]
}

async function captureProfileTransition(
  intent: 'activate-candidate' | 'restore-baseline',
): Promise<{
  fixture: ReturnType<typeof createProfileImprovementFixture>
  transition: ProfileImprovementActivationTransitionInput
}> {
  const fixture = createProfileImprovementFixture()
  const proposal = createAgentImprovementProposal({
    runId: fixture.evaluation.provenance.runId,
    findings: [improvementFinding],
    evaluation: fixture.evaluation,
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  })
  const review = reviewAgentImprovementProposal(proposal, {
    decision: 'approve',
    reviewedBy: 'operator@example.com',
    reason: 'The exact profile change passed paired held-out work.',
    now: () => new Date('2026-07-24T00:01:00.000Z'),
  })
  const activation = createAgentImprovementActivation(proposal, review, {
    intent,
    targets: [
      { surface: 'prompt', identity: 'tenant/default/profile' },
      { surface: 'skills', identity: 'tenant/default/profile' },
    ],
    fundingOwner: 'tenant/default',
    authorizedBy: 'operator@example.com',
    expiresAt: '2026-07-24T00:10:00.000Z',
    now: () => new Date('2026-07-24T00:02:00.000Z'),
  })
  let captured: ProfileImprovementActivationTransitionInput | undefined

  const result = await executeAgentImprovementActivation(
    { proposal, review, activation },
    {
      transition: async (input) => {
        if (input.kind !== 'profile-improvement') {
          throw new Error('expected a profile improvement transition')
        }
        captured = input
        return createAgentImprovementActivationResult(input, {
          completedAt: '2026-07-24T00:03:00.000Z',
          outcome: {
            status: 'already-applied',
            targets: mapNonEmpty(input.targets, (activationTarget) => ({
              surface: activationTarget.surface,
              identity: activationTarget.identity,
              currentDigest: activationTarget.desiredDigest,
            })),
          },
        })
      },
      now: () => new Date('2026-07-24T00:03:00.000Z'),
    },
  )

  if (!captured) throw new Error('profile improvement transition was not captured')
  if (result.outcome.status !== 'already-applied') {
    throw new Error('profile improvement transition did not pass public result validation')
  }
  return { fixture, transition: captured }
}

function bindProfileTransition(
  transition: ProfileImprovementActivationTransitionInput,
  operation: AgentProfileImprovementActivationOperation,
  sourceStateDigest: Sha256Digest,
  desiredStateDigest: Sha256Digest,
): ProfileImprovementActivationTransitionInput {
  return {
    ...transition,
    sourceStateDigest,
    desiredStateDigest,
    operation,
    targets: mapNonEmpty(transition.targets, (activationTarget) => ({
      ...activationTarget,
      expectedBaseDigest: sourceStateDigest,
      desiredDigest: desiredStateDigest,
      desiredInput: operation,
    })),
  }
}

describe('prepareAgentImprovementProfileActivation', () => {
  it('prepares exact multi-surface replacements while preserving unrelated fields', () => {
    const desired: AgentProfile = {
      ...base,
      prompt: { systemPrompt: 'Measured prompt' },
      resources: {
        ...base.resources,
        skills: [defineInlineResource('measured.SKILL.md', 'Measured skill')],
      },
    }
    const prepared = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['profile-1', base]]),
      targets: [
        target('prompt', { prompt: desired.prompt }, desired),
        target('skills', desired.resources?.skills, desired),
      ],
    })

    expect(prepared.status).toBe('apply')
    if (prepared.status !== 'apply') throw new Error('expected apply')
    expect(prepared.replacements).toEqual([{ identity: 'profile-1', profile: desired }])
    expect(prepared.targets).toHaveLength(2)
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(Object.isFrozen(prepared.replacements)).toBe(true)
    expect(Object.isFrozen(prepared.replacements[0]?.profile)).toBe(true)
    expect(JSON.parse(JSON.stringify(prepared))).toEqual(prepared)
  })

  it('distinguishes missing, already applied, and conflicting profiles', () => {
    const desired: AgentProfile = { ...base, prompt: { systemPrompt: 'Measured prompt' } }
    const activationTarget = target('prompt', { prompt: desired.prompt }, desired)
    const missing = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map(),
      targets: [activationTarget],
    })
    expect(missing).toEqual({ status: 'missing', identities: ['profile-1'] })

    const applied = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['profile-1', desired]]),
      targets: [activationTarget],
    })
    expect(applied.status).toBe('already-applied')

    const conflict = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([
        ['profile-1', { ...base, prompt: { systemPrompt: 'Changed elsewhere' } }],
      ]),
      targets: [activationTarget],
    })
    expect(conflict.status).toBe('conflict')
  })

  it('rejects duplicate identity and surface pairs', () => {
    const desired: AgentProfile = { ...base, prompt: { systemPrompt: 'Measured prompt' } }
    const activationTarget = target('prompt', { prompt: desired.prompt }, desired)
    expect(() =>
      prepareAgentImprovementProfileActivation({
        currentByIdentity: new Map([['profile-1', base]]),
        targets: [activationTarget, activationTarget],
      }),
    ).toThrow('agent profile activation repeats a target')
  })

  it('represents removal as an absent canonical field', () => {
    const desired: AgentProfile = { name: base.name, tools: base.tools, resources: base.resources }
    const prepared = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['profile-1', base]]),
      targets: [target('prompt', { prompt: null }, desired)],
    })

    expect(prepared.status).toBe('apply')
    if (prepared.status !== 'apply') throw new Error('expected apply')
    const profile = prepared.replacements[0].profile
    expect(Object.hasOwn(profile, 'prompt')).toBe(false)
    expect(Object.isFrozen(profile)).toBe(true)
    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile)
  })

  it('applies profile changes in order and becomes already applied after the write', async () => {
    const { fixture, transition: captured } = await captureProfileTransition('activate-candidate')
    const changes: [AgentProfileDiff, AgentProfileDiff] = [
      {
        kind: 'agent-profile-diff',
        id: 'remove-old-prompt',
        remove: { prompt: true },
      },
      {
        kind: 'agent-profile-diff',
        id: 'set-final-prompt',
        set: { prompt: { systemPrompt: 'The second ordered change wins.' } },
      },
    ]
    const operation: AgentProfileImprovementActivationOperation = {
      kind: 'apply-change',
      changes,
    }
    const desiredProfile: AgentProfile = {
      ...fixture.baselineProfile,
      prompt: { systemPrompt: 'The second ordered change wins.' },
    }
    const desiredStateDigest = fixture.stateDigest(desiredProfile)
    const transition = bindProfileTransition(
      captured,
      operation,
      fixture.stateDigest(fixture.baselineProfile),
      desiredStateDigest,
    )
    const stateDigest = vi.fn(({ profile }: { profile: AgentProfile }) =>
      fixture.stateDigest(profile),
    )

    const prepared = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['tenant/default/profile', fixture.baselineProfile]]),
      profileTransition: transition,
      stateDigest,
    })

    expect(prepared.status).toBe('apply')
    if (prepared.status !== 'apply') throw new Error('expected an ordered profile replacement')
    expect(prepared.replacements).toEqual([
      { identity: 'tenant/default/profile', profile: desiredProfile },
    ])
    expect(fixture.baselineProfile.prompt?.systemPrompt).toBe('Answer directly.')

    const firstRetry = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['tenant/default/profile', prepared.replacements[0].profile]]),
      profileTransition: transition,
      stateDigest,
    })
    const secondRetry = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['tenant/default/profile', prepared.replacements[0].profile]]),
      profileTransition: transition,
      stateDigest,
    })
    const expectedAlreadyApplied = {
      status: 'already-applied',
      targets: transition.targets.map((activationTarget) => ({
        surface: activationTarget.surface,
        identity: activationTarget.identity,
        currentDigest: desiredStateDigest,
      })),
    }
    expect(firstRetry).toEqual(expectedAlreadyApplied)
    expect(secondRetry).toEqual(expectedAlreadyApplied)
    expect(Object.isFrozen(firstRetry)).toBe(true)
  })

  it('restores retained state through the product resolver', async () => {
    const { fixture, transition } = await captureProfileTransition('restore-baseline')
    const resolveState = vi.fn(() => fixture.baselineProfile)
    const stateDigest = vi.fn(({ profile }: { profile: AgentProfile }) =>
      fixture.stateDigest(profile),
    )

    const prepared = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['tenant/default/profile', fixture.candidateProfile]]),
      profileTransition: transition,
      stateDigest,
      resolveState,
    })

    expect(resolveState).toHaveBeenCalledOnce()
    expect(resolveState).toHaveBeenCalledWith({
      identity: 'tenant/default/profile',
      stateDigest: fixture.stateDigest(fixture.baselineProfile),
    })
    expect(stateDigest).toHaveBeenCalledWith({
      identity: 'tenant/default/profile',
      profile: fixture.candidateProfile,
    })
    expect(stateDigest).toHaveBeenCalledWith({
      identity: 'tenant/default/profile',
      profile: fixture.baselineProfile,
    })
    expect(prepared.status).toBe('apply')
    if (prepared.status !== 'apply') throw new Error('expected a retained profile replacement')
    expect(prepared.replacements).toEqual([
      { identity: 'tenant/default/profile', profile: fixture.baselineProfile },
    ])
  })

  it('reports retained state as unavailable when no resolver can provide it', async () => {
    const { fixture, transition } = await captureProfileTransition('restore-baseline')
    const input = {
      currentByIdentity: new Map([['tenant/default/profile', fixture.candidateProfile]]),
      profileTransition: transition,
      stateDigest: ({ profile }: { profile: AgentProfile }) => fixture.stateDigest(profile),
    }
    const expected = {
      status: 'unavailable',
      code: 'PROFILE_STATE_UNAVAILABLE',
      identities: ['tenant/default/profile'],
      requiredStateDigest: fixture.stateDigest(fixture.baselineProfile),
    }

    expect(prepareAgentImprovementProfileActivation(input)).toEqual(expected)
    const unresolved = vi.fn(() => undefined)
    expect(
      prepareAgentImprovementProfileActivation({ ...input, resolveState: unresolved }),
    ).toEqual(expected)
    expect(unresolved).toHaveBeenCalledOnce()
  })

  it('reports a conflict from the product whole-state digest', async () => {
    const { fixture, transition } = await captureProfileTransition('activate-candidate')
    const changedElsewhere: AgentProfile = {
      ...fixture.baselineProfile,
      prompt: { systemPrompt: 'Changed by another writer.' },
    }
    const currentDigest = fixture.stateDigest(changedElsewhere)
    const stateDigest = vi.fn(({ profile }: { profile: AgentProfile }) =>
      fixture.stateDigest(profile),
    )

    const prepared = prepareAgentImprovementProfileActivation({
      currentByIdentity: new Map([['tenant/default/profile', changedElsewhere]]),
      profileTransition: transition,
      stateDigest,
    })

    expect(prepared).toEqual({
      status: 'conflict',
      targets: transition.targets.map((activationTarget) => ({
        surface: activationTarget.surface,
        identity: activationTarget.identity,
        currentDigest,
      })),
    })
    expect(currentDigest).not.toBe(transition.sourceStateDigest)
    expect(currentDigest).not.toBe(transition.desiredStateDigest)
    expect(stateDigest).toHaveBeenCalledTimes(transition.targets.length)
  })

  it('rejects profile transitions split across shared-state identities', async () => {
    const { fixture, transition } = await captureProfileTransition('activate-candidate')
    const [first, second, ...remaining] = transition.targets
    if (!second) throw new Error('expected prompt and skills targets')
    const splitTargets: ProfileImprovementActivationTransitionInput['targets'] = [
      first,
      { ...second, identity: 'tenant/default/profile-b' },
      ...remaining,
    ]
    const stateDigest = vi.fn(({ profile }: { profile: AgentProfile }) =>
      fixture.stateDigest(profile),
    )

    expect(() =>
      prepareAgentImprovementProfileActivation({
        currentByIdentity: new Map([
          ['tenant/default/profile', fixture.baselineProfile],
          ['tenant/default/profile-b', fixture.baselineProfile],
        ]),
        profileTransition: { ...transition, targets: splitTargets },
        stateDigest,
      }),
    ).toThrow('profile improvement activation targets must name one profile identity')
    expect(stateDigest).not.toHaveBeenCalled()
  })

  it('rejects retained state whose whole-state digest does not match the request', async () => {
    const { fixture, transition } = await captureProfileTransition('restore-baseline')
    const wrongState: AgentProfile = {
      ...fixture.baselineProfile,
      prompt: { systemPrompt: 'This is not the retained baseline.' },
    }

    expect(() =>
      prepareAgentImprovementProfileActivation({
        currentByIdentity: new Map([['tenant/default/profile', fixture.candidateProfile]]),
        profileTransition: transition,
        stateDigest: ({ profile }) => fixture.stateDigest(profile),
        resolveState: () => wrongState,
      }),
    ).toThrow('profile improvement activation did not produce tenant/default/profile')
  })
})
