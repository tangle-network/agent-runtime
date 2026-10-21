import { type AgentProfile, profileMaterializationAxes } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  loopTierProfileMaterialization,
  PLACEMENT_POLICY,
  type PlaceExecutionInput,
  type PlacementContext,
  PlacementRefusedError,
  type PlacementRequirements,
  placeExecution,
} from '../src/placement'
import {
  type AgentPlacementInput,
  selectAgentPlacement,
} from './fixtures/platform-agent-placement-v2'

// ── The corpus: every requirement field alone and in pairs, × profiles, × contexts ──

const REQUIREMENT_FIELDS: Array<[string, PlacementRequirements]> = [
  ['harness', { harness: 'codex' }],
  ['model-other', { model: 'openai/gpt-5.5' }],
  ['model-same', { model: 'deepseek/deepseek-v4.1-flash' }],
  ['source', { source: { repo: 'o/r' } }],
  ['skills', { skills: ['sk_a'] }],
  ['env', { env: { A: '1' } }],
  ['image', { image: 'node:22' }],
  ['size', { size: 'large' }],
  ['resources', { resources: { cpu: 2 } }],
  ['fromSnapshot', { fromSnapshot: 'snap_1' }],
  ['fromSandboxId', { fromSandboxId: 'sb_1' }],
  ['resume', { resume: true }],
  ['maxRounds-1', { maxRounds: 1 }],
  ['maxRounds-3', { maxRounds: 3 }],
  ['ask', { ask: true }],
  ['ask-false', { ask: false }],
  ['connections', { connections: ['conn-slack'] }],
  ['connections-empty', { connections: [] }],
  ['objects', { objects: { prefixes: ['a/'], mode: 'read' } }],
  ['http', { http: { hosts: ['api.example.com'] } }],
]

const REQUIREMENTS: Array<[string, PlacementRequirements]> = [['none', {}], ...REQUIREMENT_FIELDS]
for (const [i, [a, first]] of REQUIREMENT_FIELDS.entries()) {
  for (const [b, second] of REQUIREMENT_FIELDS.slice(i + 1)) {
    REQUIREMENTS.push([`${a}+${b}`, { ...first, ...second }])
  }
}

const PROMPT_ONLY = { prompt: { systemPrompt: 'Classify the issue.' } }
const QA_PROFILE = {
  name: 'support-qa',
  prompt: { systemPrompt: 'Answer billing questions.', instructions: ['Cite the plan name.'] },
  model: { default: 'deepseek/deepseek-v4.1-flash', reasoningEffort: 'low' },
}
const DENY_ALL = { bash: 'deny', edit: 'deny', write: 'deny', webfetch: 'deny' }
/** The shape Hospitality's chat profile takes (hospitality-agent src/domain/workspace.ts). */
const HOSPITALITY_CHAT = {
  name: 'Concierge',
  description: 'Hospitality assistant for Test Inn',
  version: '1',
  model: { default: 'google/gemini-2.5-flash' },
  prompt: { systemPrompt: 'You are Concierge.', instructions: ['Use product tools.'] },
  tools: { bash: false, edit: false, read: false, skill: false, webfetch: false, write: false },
  permissions: { ...DENY_ALL, skill: 'deny' },
  metadata: { businessId: 'biz_1' },
}
const SKILL_REF = { kind: 'inline', name: 'checkin', content: 'Check guests in.' }
const HOSPITALITY_WITH_SKILLS = {
  ...HOSPITALITY_CHAT,
  resources: { skills: [SKILL_REF], failOnError: true },
  tools: { ...HOSPITALITY_CHAT.tools, skill: true },
  permissions: { ...DENY_ALL, skill: 'allow' },
}

const PROFILES: Array<[string, object | undefined]> = [
  ['none', undefined],
  ['prompt-only', PROMPT_ONLY],
  ['qa', QA_PROFILE],
  ['harness', { ...PROMPT_ONLY, harness: 'codex' }],
  ['tools-enabled', { ...PROMPT_ONLY, tools: { bash: true, edit: false } }],
  ['tools-disabled', { ...PROMPT_ONLY, tools: { bash: false } }],
  ['tools-skill', { ...PROMPT_ONLY, tools: { skill: true } }],
  ['mcp', { ...PROMPT_ONLY, mcp: { docs: { url: 'https://m.test' } } }],
  ['files', { ...PROMPT_ONLY, resources: { files: [] } }],
  ['skills', { ...PROMPT_ONLY, resources: { skills: [SKILL_REF] } }],
  ['skills-strict', { ...PROMPT_ONLY, resources: { skills: [SKILL_REF], failOnError: true } }],
  [
    'skills-best-effort',
    { ...PROMPT_ONLY, resources: { skills: [SKILL_REF], failOnError: false } },
  ],
  ['permissions-deny', { ...PROMPT_ONLY, permissions: DENY_ALL }],
  ['permissions-nested-deny', { ...PROMPT_ONLY, permissions: { bash: { '*': 'deny' } } }],
  ['permissions-allow', { ...PROMPT_ONLY, permissions: { bash: 'allow' } }],
  ['permissions-ask', { ...PROMPT_ONLY, permissions: { edit: 'ask' } }],
  ['append-prompt', { prompt: { appendSystemPrompt: 'Be brief.' } }],
  ['unknown-prompt-field', { prompt: { systemPrompt: 'x', persona: 'y' } }],
  ['model-reasoning-tokens', { ...PROMPT_ONLY, model: { maxReasoningTokens: 100 } }],
  ['model-small', { ...PROMPT_ONLY, model: { default: 'a/b', small: 'a/c' } }],
  ['hooks', { ...PROMPT_ONLY, hooks: { onStart: [] } }],
  ['subagents', { ...PROMPT_ONLY, subagents: { r: { prompt: { systemPrompt: 'r' } } } }],
  ['confidential', { ...PROMPT_ONLY, confidential: { required: true } }],
  ['extensions', { ...PROMPT_ONLY, extensions: { x: 1 } }],
  ['stray-top-level-leaf', { ...PROMPT_ONLY, systemPrompt: 'not a profile field' }],
  ['hospitality-chat', HOSPITALITY_CHAT],
  ['hospitality-skills', HOSPITALITY_WITH_SKILLS],
]

const CONTEXTS: PlacementContext[] = []
for (const interactive of [false, true]) {
  for (const inferenceAvailable of [true, false]) {
    for (const loopAvailable of [true, false]) {
      CONTEXTS.push({ interactive, inferenceAvailable, loopAvailable })
      if (!loopAvailable) {
        CONTEXTS.push({
          interactive,
          inferenceAvailable,
          loopAvailable,
          loopUnavailableReason: 'the worker has no Hub access on this deployment',
        })
      }
    }
  }
}

type Decision =
  | { refused: string }
  | { chosen: string; reason: string; rejected: Array<{ placement: string; reason: string }> }

function platformDecision(
  cfg: PlacementRequirements,
  profile: object | undefined,
  ctx: PlacementContext,
): Decision {
  try {
    const record = selectAgentPlacement(cfg as AgentPlacementInput, profile as AgentProfile, {
      interactive: ctx.interactive,
      inferenceAvailable: ctx.inferenceAvailable,
      workerAvailable: ctx.loopAvailable,
      ...(ctx.loopUnavailableReason !== undefined
        ? { workerUnavailableReason: ctx.loopUnavailableReason }
        : {}),
    })
    return { chosen: record.chosen, reason: record.reason, rejected: record.rejected }
  } catch (error) {
    return { refused: (error as { reason: string }).reason }
  }
}

const asPlatform = (tier: string) => (tier === 'loop' ? 'worker' : tier)

function runtimeDecision(input: PlaceExecutionInput): Decision {
  try {
    const record = placeExecution(input)
    return {
      chosen: asPlatform(record.chosen),
      reason: record.reason,
      rejected: record.rejected.map((r) => ({
        placement: asPlatform(r.placement),
        reason: r.reason,
      })),
    }
  } catch (error) {
    if (!(error instanceof PlacementRefusedError)) throw error
    return { refused: error.reason }
  }
}

interface Case {
  label: string
  cfg: PlacementRequirements
  profile: object | undefined
  context: PlacementContext
}

const CORPUS: Case[] = REQUIREMENTS.flatMap(([cfgLabel, cfg]) =>
  PROFILES.flatMap(([profileLabel, profile]) =>
    CONTEXTS.map((context) => ({
      label: `${cfgLabel} | ${profileLabel} | ${JSON.stringify(context)}`,
      cfg,
      profile,
      context,
    })),
  ),
)

describe('placeExecution parity with Platform agent-placement/2', () => {
  it('agrees with Platform on every corpus case when no opt-in is set', () => {
    const disagreements = CORPUS.filter(
      (c) =>
        JSON.stringify(
          runtimeDecision({ requirements: c.cfg, profile: c.profile, context: c.context }),
        ) !== JSON.stringify(platformDecision(c.cfg, c.profile, c.context)),
    ).map((c) => c.label)
    console.log(`placement parity: ${CORPUS.length} cases, ${disagreements.length} disagreements`)
    expect(CORPUS.length).toBeGreaterThan(50_000)
    expect(disagreements).toEqual([])
  })

  it('differs with both opt-ins only where a profile declares permissions or skills', () => {
    const touchesOptIn = (profile: object | undefined) => {
      const fields = (profile ?? {}) as Record<string, unknown>
      const tools = fields.tools as Record<string, unknown> | undefined
      return (
        fields.permissions !== undefined || fields.resources !== undefined || tools?.skill === true
      )
    }
    let differing = 0
    for (const c of CORPUS) {
      const optedIn = runtimeDecision({
        requirements: c.cfg,
        profile: c.profile,
        context: c.context,
        vacuousAxes: ['permissions'],
        inlineSkills: true,
      })
      const platform = platformDecision(c.cfg, c.profile, c.context)
      if (JSON.stringify(optedIn) === JSON.stringify(platform)) continue
      differing++
      expect(touchesOptIn(c.profile), c.label).toBe(true)
      // An opt-in only ever widens what the cheaper tiers cover: Platform kept the
      // sandbox (or refused) where the opt-in admits the loop or a single call.
      expect('refused' in platform || platform.chosen === 'sandbox', c.label).toBe(true)
    }
    expect(differing).toBeGreaterThan(0)
  })
})

describe('placeExecution opt-ins', () => {
  const ROUTED: PlacementContext = {
    interactive: false,
    inferenceAvailable: true,
    loopAvailable: true,
  }
  const PRODUCT_TOOLS: PlacementRequirements = { tools: ['hospitality.preferences.read'] }

  it('keeps a deny-only permissions map in the sandbox unless vacuousAxes names it', () => {
    const base = { requirements: PRODUCT_TOOLS, profile: HOSPITALITY_CHAT, context: ROUTED }
    const strict = placeExecution(base)
    expect(strict.chosen).toBe('sandbox')
    expect(strict.reason).toBe('profile permissions needs a sandbox')

    const routed = placeExecution({ ...base, vacuousAxes: ['permissions'] })
    expect(routed).toEqual({
      chosen: 'loop',
      policy: PLACEMENT_POLICY,
      reason:
        'tools hospitality.preferences.read need the loop, which the worker holds without a sandbox',
      coveredAxes: expect.any(Array),
      rejected: [
        { placement: 'inference', reason: 'tools hospitality.preferences.read need the loop' },
        { placement: 'sandbox', reason: 'costs more and no declared requirement needs it' },
      ],
    })
    // Every axis the profile declares, as agent-interface reads them.
    expect([...routed.coveredAxes].sort()).toEqual(
      [...profileMaterializationAxes(HOSPITALITY_CHAT as AgentProfile)].sort(),
    )
  })

  it('never counts a permission that allows or asks as vacuous', () => {
    for (const rule of ['allow', 'ask', { '*': 'allow' }]) {
      const record = placeExecution({
        profile: { ...PROMPT_ONLY, permissions: { ...DENY_ALL, bash: rule } },
        context: ROUTED,
        vacuousAxes: ['permissions'],
      })
      expect(record.chosen).toBe('sandbox')
      expect(record.reason).toBe('profile permissions needs a sandbox')
    }
  })

  it('places inlined skills on the loop, never on a single call', () => {
    const input = {
      requirements: PRODUCT_TOOLS,
      profile: HOSPITALITY_WITH_SKILLS,
      context: ROUTED,
      vacuousAxes: ['permissions'] as const,
    }
    const withoutInline = placeExecution(input)
    expect(withoutInline.chosen).toBe('sandbox')
    expect(withoutInline.reason).toBe(
      'profile permissions needs a sandbox; profile resources needs a sandbox; profile tools skill need a sandbox',
    )

    const inlined = placeExecution({ ...input, inlineSkills: true })
    expect(inlined.chosen).toBe('loop')
    expect(inlined.reason).toContain('skills are inlined by the loop')
    expect(inlined.coveredAxes).toEqual(expect.arrayContaining(['skills', 'resourceFailOnError']))

    const noProductTools = placeExecution({ ...input, requirements: {}, inlineSkills: true })
    expect(noProductTools.chosen).toBe('loop')
    expect(noProductTools.rejected[0]).toEqual({
      placement: 'inference',
      reason: 'skills are inlined by the loop',
    })
  })

  it('keeps best-effort skills and other resources in the sandbox when skills are inlined', () => {
    const bestEffort = placeExecution({
      profile: { ...PROMPT_ONLY, resources: { skills: [SKILL_REF], failOnError: false } },
      context: ROUTED,
      inlineSkills: true,
    })
    expect(bestEffort.chosen).toBe('sandbox')
    expect(bestEffort.reason).toBe('profile resources.failOnError is not supported by the worker')

    const files = placeExecution({
      profile: { ...PROMPT_ONLY, resources: { skills: [SKILL_REF], files: [] } },
      context: ROUTED,
      inlineSkills: true,
    })
    expect(files.chosen).toBe('sandbox')
    expect(files.reason).toBe('profile resources.files is not supported by the worker')
  })

  it('falls back to the sandbox, which loads skills natively, when the loop is not wired', () => {
    const record = placeExecution({
      profile: { ...PROMPT_ONLY, resources: { skills: [SKILL_REF] } },
      context: { ...ROUTED, loopAvailable: false },
      inlineSkills: true,
    })
    expect(record.chosen).toBe('sandbox')
    expect(record.rejected).toEqual([
      { placement: 'inference', reason: 'skills are inlined by the loop' },
      { placement: 'loop', reason: 'worker placement is not wired on this deployment' },
    ])
  })

  it('always runs a pinned harness in the sandbox, whatever the opt-ins', () => {
    const optIns = { vacuousAxes: ['permissions'] as const, inlineSkills: true }
    const pinnedByWork = placeExecution({
      requirements: { harness: 'opencode' },
      profile: HOSPITALITY_WITH_SKILLS,
      context: ROUTED,
      ...optIns,
    })
    expect(pinnedByWork.chosen).toBe('sandbox')
    expect(pinnedByWork.reason).toBe('harness opencode is pinned')

    const pinnedByProfile = placeExecution({
      profile: { ...HOSPITALITY_WITH_SKILLS, harness: 'opencode' },
      context: ROUTED,
      ...optIns,
    })
    expect(pinnedByProfile.chosen).toBe('sandbox')
    expect(pinnedByProfile.reason).toBe('profile harness needs a sandbox')
  })

  it('refuses a loop-only grant beside a sandbox need, before any spend', () => {
    expect(() =>
      placeExecution({
        requirements: { objects: { prefixes: ['a/'] } },
        profile: { ...PROMPT_ONLY, harness: 'codex' },
        context: ROUTED,
      }),
    ).toThrow(PlacementRefusedError)
  })
})

describe('placement tiers as profile materialization contracts', () => {
  it('carries no harness, native tool, file, MCP or skill axis on the loop tier', () => {
    for (const axis of ['harness', 'tools', 'permissions', 'mcp', 'files', 'skills', 'hooks']) {
      expect(loopTierProfileMaterialization.axes).not.toContain(axis)
    }
  })
})
