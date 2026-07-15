import type {
  ProposeContext,
  ProposedCandidate,
  SurfaceProposer,
} from '@tangle-network/agent-eval/campaign'
import { compositeProposer } from '@tangle-network/agent-eval/campaign'
import { defineAgentProfileDiff, defineInlineResource } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { profileDiffProposer } from './profile-diff-proposer'

const context = (populationSize = 2): ProposeContext => ({
  currentSurface: JSON.stringify({
    name: 'fixture',
    prompt: { systemPrompt: 'baseline' },
    resources: { failOnError: true },
  }),
  history: [],
  findings: [],
  populationSize,
  generation: 0,
  signal: new AbortController().signal,
})

describe('profileDiffProposer', () => {
  it('puts source-grounded profile diffs and generated mutations in one candidate pool', async () => {
    const discovered = profileDiffProposer({
      proposeDiffs: () => [
        {
          diff: defineAgentProfileDiff({
            schemaVersion: 1,
            kind: 'agent-profile-diff',
            id: 'github-review-skill',
            title: 'Pinned review skill',
            rationale: 'Existing skill covers the observed review failure.',
            source: {
              kind: 'frontier-author',
              artifacts: ['https://github.com/example/skills/tree/0123456789abcdef/review'],
              notes: ['MIT license verified by the research worker.'],
            },
            set: {
              resources: {
                skills: [
                  defineInlineResource(
                    'review.SKILL.md',
                    '# Review\n\nRead the failing test before editing.',
                  ),
                ],
                failOnError: true,
              },
            },
          }),
        },
      ],
    })
    const generated: SurfaceProposer = {
      kind: 'generated',
      propose: async () => [
        {
          surface: JSON.stringify({
            name: 'fixture',
            prompt: { systemPrompt: 'generated mutation' },
            resources: { failOnError: true },
          }),
          label: 'generated prompt',
          rationale: 'Mutation proposer output.',
        },
      ],
    }

    const candidates = await compositeProposer({
      proposers: [discovered, generated],
    }).propose(context(2))

    expect(candidates).toHaveLength(2)
    const researched = candidates[0] as ProposedCandidate
    expect(researched.label).toBe('agent-profile-diff:Pinned review skill')
    expect(researched.rationale).toContain('Existing skill')
    expect(researched.rationale).toContain(
      'https://github.com/example/skills/tree/0123456789abcdef/review',
    )
    expect(researched.rationale).toMatch(/sha256:[a-f0-9]{64}/)
    expect(JSON.parse(researched.surface as string)).toMatchObject({
      name: 'fixture',
      prompt: { systemPrompt: 'baseline' },
      resources: {
        skills: [
          {
            kind: 'inline',
            name: 'review.SKILL.md',
          },
        ],
        failOnError: true,
      },
    })
    expect((candidates[1] as ProposedCandidate).label).toBe('generated:generated prompt')
  })

  it('rejects source output with fields the shared diff contract would discard', async () => {
    const proposer = profileDiffProposer({
      proposeDiffs: () => [
        {
          diff: {
            schemaVersion: 1,
            kind: 'agent-profile-diff',
            set: { prompt: { systemPrompt: 'candidate' } },
            unknownField: true,
          } as never,
        },
      ],
    })
    await expect(proposer.propose(context(1))).rejects.toThrow(/unsupported or non-canonical/)
  })

  it('drops no-op diffs and respects the shared population budget', async () => {
    const proposer = profileDiffProposer({
      proposeDiffs: () => [
        { diff: defineAgentProfileDiff({ schemaVersion: 1, kind: 'agent-profile-diff' }) },
        {
          diff: defineAgentProfileDiff({
            schemaVersion: 1,
            kind: 'agent-profile-diff',
            set: { prompt: { systemPrompt: 'baseline' } },
          }),
        },
        {
          diff: defineAgentProfileDiff({
            schemaVersion: 1,
            kind: 'agent-profile-diff',
            set: { prompt: { systemPrompt: 'first' } },
          }),
        },
        {
          diff: defineAgentProfileDiff({
            schemaVersion: 1,
            kind: 'agent-profile-diff',
            set: { prompt: { systemPrompt: 'first' } },
          }),
        },
      ],
    })
    const candidates = await proposer.propose(context(2))
    expect(candidates).toHaveLength(1)
    expect(
      JSON.parse((candidates[0] as ProposedCandidate).surface as string).prompt.systemPrompt,
    ).toBe('first')
  })
})
