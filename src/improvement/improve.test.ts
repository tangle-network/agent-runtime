/**
 * `improve()` default-proposer resolution proof.
 *
 * The regression this guards: `improve()` maps each surface to a default
 * `SurfaceProposer` — `prompt → gepaProposer`, `skills → skillOptProposer`,
 * `memory → memoryCurationProposer`.
 * If either import resolves to `undefined` (a substrate export drift), the facade
 * does not fail at module load — it fails at CALL time, the first time a caller
 * names that surface. So a green typecheck is not enough; this test drives the
 * REAL `improve()` far enough to construct the default proposer and run the
 * baseline-only loop to a gate decision.
 *
 * It is deterministic and offline: `gate: 'none'` forces `generations = 0`, so
 * `selfImprove` runs the baseline cells only and never calls the reflection LLM
 * the proposer wraps. The stub agent reports a token-bearing cost through
 * `ctx.cost` so the substrate's backend-integrity guard (default `'assert'`)
 * sees a real backend rather than a silent-zero stub.
 */

import {
  gitWorktreeAdapter,
  type Worktree,
  type WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'
import type {
  CodeSurface,
  DispatchContext,
  JudgeConfig,
  Scenario,
  SurfaceProposer,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../errors'
import {
  type ImproveOptions,
  type ImproveSkillsOptions,
  type ImproveSurface,
  improve,
} from './improve'

// Four scenarios so the train/holdout split is non-empty at the default 0.25
// holdout fraction (a single scenario yields an empty train split).
const scenarios: Scenario[] = [
  { id: 'a', kind: 'fixture' },
  { id: 'b', kind: 'fixture' },
  { id: 'c', kind: 'fixture' },
  { id: 'd', kind: 'fixture' },
]

// A deterministic judge — every artifact scores the same. The POINT is the
// proposer wiring, not a score gradient.
const judge: JudgeConfig<{ text: string }, Scenario> = {
  name: 'stub-judge',
  dimensions: [{ key: 'q', description: 'fixture quality' }],
  score: () => ({ dimensions: { q: 0.5 }, composite: 0.5, notes: '' }),
}

const improvementJudge: JudgeConfig<{ text: string }, Scenario> = {
  name: 'improvement-judge',
  dimensions: [{ key: 'q', description: 'contains the measured improvement marker' }],
  score: ({ artifact }) => {
    const score = artifact.text.includes('improved') ? 1 : 0
    return { dimensions: { q: score }, composite: score, notes: '' }
  },
}

async function paidStubCall<T>(
  ctx: DispatchContext,
  actor: string,
  execute: () => T | Promise<T>,
): Promise<T> {
  const paid = await ctx.cost.runPaidCall({
    channel: 'agent',
    actor,
    model: 'stub-model',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => execute(),
    receipt: () => ({
      model: 'stub-model',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

// The fake dispatch enters the same paid-call path as a real backend so the
// backend-integrity check sees its explicit token and cost receipt.
async function stubAgent(
  surface: unknown,
  _scenario: Scenario,
  ctx: DispatchContext,
): Promise<{ text: string }> {
  return paidStubCall(ctx, 'stub-agent', () => ({ text: String(surface) }))
}

const promptProfile = (): AgentProfile => ({
  name: 'fixture-agent',
  prompt: { systemPrompt: 'be careful' },
})

const skillDocument = '# Fixture skill\n\nCheck the result.\n'

const skillProfile = (): AgentProfile => ({
  name: 'fixture-agent',
  resources: {
    failOnError: true,
    skills: [{ kind: 'inline', name: 'fixture-skill', content: skillDocument }],
  },
})

const memoryProfile = (document = '# Durable memory\n'): AgentProfile => ({
  name: 'fixture-agent',
  resources: {
    failOnError: true,
    instructions: { kind: 'inline', name: 'durable-memory', content: document },
  },
})

describe('improve() — default proposer resolution (substrate export drift guard)', () => {
  it("surface 'prompt' resolves gepaProposer and runs the baseline loop without crashing", async () => {
    const result = await improve(promptProfile(), [], {
      surface: 'prompt',
      gate: 'none',
      scenarios,
      judge,
      agent: stubAgent,
    })

    // The default gepaProposer was constructed (not undefined) and selfImprove
    // ran to a gate decision; a baseline-only run holds.
    expect(result.decision).toBe('hold')
    expect(result.candidate).toMatchObject({
      surface: 'prompt',
      value: 'be careful',
      profile: { prompt: { systemPrompt: 'be careful' } },
    })
  })

  it("surface 'skills' resolves skillOptProposer and runs the baseline loop without crashing", async () => {
    const result = await improve(skillProfile(), [], {
      surface: 'skills',
      gate: 'none',
      scenarios,
      judge,
      agent: stubAgent,
      skills: { resourceName: 'fixture-skill' },
    })

    expect(result.decision).toBe('hold')
    expect(result.candidate).toMatchObject({
      surface: 'skills',
      value: skillDocument,
      profile: { resources: { skills: [{ content: skillDocument }] } },
    })
  })

  it("surface 'skills' fails loud without an exact inline resource identity", async () => {
    await expect(
      improve(skillProfile(), [], {
        surface: 'skills',
        gate: 'none',
        scenarios,
        judge,
        agent: stubAgent,
      }),
    ).rejects.toThrow(/requires opts\.skills\.resourceName/)
  })

  it("surface 'memory' resolves memoryCurationProposer from exact profile instructions", async () => {
    const result = await improve(memoryProfile(), [], {
      surface: 'memory',
      gate: 'none',
      scenarios,
      judge,
      agent: stubAgent,
    })

    expect(result.decision).toBe('hold')
    expect(result.candidate.value).toBe('# Durable memory\n')
    expect(result.candidate.profile?.resources?.instructions).toEqual({
      kind: 'inline',
      name: 'durable-memory',
      content: '# Durable memory\n',
    })
    await expect(
      improve(promptProfile(), [], {
        surface: 'memory',
        gate: 'none',
        scenarios,
        judge,
        agent: stubAgent,
      }),
    ).rejects.toThrow(/requires profile\.resources\.failOnError/)
  })

  it("surface 'memory' returns a frozen profile without changing the baseline", async () => {
    const baseline = '# Durable memory\n'
    const profile = memoryProfile(baseline)
    const result = await improve(profile, [{ claim: 'improved verification lesson' }], {
      surface: 'memory',
      scenarios,
      judge: improvementJudge,
      agent: stubAgent,
      promotionGate: {
        name: 'test-ship',
        decide: async () => ({
          decision: 'ship',
          reasons: ['test candidate'],
          contributingGates: [],
        }),
      },
      budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
    })

    expect(result.decision).toBe('ship')
    expect(result.candidate.value).toContain('improved verification lesson')
    expect(result.candidate.profile?.resources?.instructions).toMatchObject({
      content: expect.stringContaining('improved verification lesson'),
    })
    expect(Object.isFrozen(result.candidate)).toBe(true)
    expect(profile.resources?.instructions).toEqual({
      kind: 'inline',
      name: 'durable-memory',
      content: baseline,
    })
  })

  it("surface 'memory' rejects a non-text candidate", async () => {
    const nonTextSurface: CodeSurface = {
      kind: 'code',
      worktreeRef: 'not-a-memory-document',
      baseRef: 'main',
      baseCommit: 'a'.repeat(40),
      baseTree: 'b'.repeat(40),
      candidateCommit: 'c'.repeat(40),
      candidateTree: 'd'.repeat(40),
      patch: {
        format: 'git-diff-binary',
        sha256: `sha256:${'e'.repeat(64)}`,
        byteLength: 1,
      },
    }
    const surfaceKindJudge: JudgeConfig<{ text: string }, Scenario> = {
      name: 'surface-kind-judge',
      dimensions: [{ key: 'q', description: 'candidate is code-tier' }],
      score: ({ artifact }) => {
        const score = artifact.text === 'code' ? 1 : 0
        return { dimensions: { q: score }, composite: score, notes: '' }
      },
    }
    const malformedMemory: SurfaceProposer = {
      kind: 'malformed-memory',
      propose: async () => [
        {
          surface: nonTextSurface,
          label: 'wrong-tier',
          rationale: 'test malformed winner',
        },
      ],
    }
    await expect(
      improve(memoryProfile(), [], {
        surface: 'memory',
        scenarios,
        judge: surfaceKindJudge,
        agent: async (surface, _scenario, ctx) => {
          return paidStubCall(ctx, 'stub-agent', () => ({
            text: typeof surface === 'string' ? 'text' : surface.kind,
          }))
        },
        generator: malformedMemory,
        promotionGate: {
          name: 'test-ship',
          decide: async () => ({
            decision: 'ship',
            reasons: ['test candidate'],
            contributingGates: [],
          }),
        },
        budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
      }),
    ).rejects.toThrow(/incompatible surface value/)
  })

  it("surface 'memory' returns a held candidate without side effects", async () => {
    const result = await improve(memoryProfile(), [], {
      surface: 'memory',
      gate: 'none',
      scenarios,
      judge,
      agent: stubAgent,
    })

    expect(result.decision).toBe('hold')
    expect(result.candidate.value).toBe('# Durable memory\n')
  })

  it('a real runDir makes the loop durable: provenance lands on the filesystem', async () => {
    const { mkdtempSync, existsSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const runDir = mkdtempSync(join(tmpdir(), 'improve-rundir-'))
    try {
      const result = await improve(promptProfile(), [], {
        surface: 'prompt',
        gate: 'none',
        scenarios,
        judge,
        agent: stubAgent,
        runDir,
      })
      expect(result.decision).toBe('hold')
      // The durable-storage default keys off a real (non-mem://) runDir: the loop
      // provenance record must survive the call on disk — this is what a 5-hour
      // search recovers from after a process death.
      expect(existsSync(join(runDir, 'loop-provenance.json'))).toBe(true)
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })

  it("surface 'skills' returns an exact profile without changing the baseline", async () => {
    // Baseline document; a scenario whose judge rewards the presence of a rule the
    // skillOpt proposer will add. A deterministic stub proposer stands in for the LLM.
    const baselineDoc = '# OR skills\n- always run a solver\n'
    const stubProposer = {
      kind: 'stub-skillopt',
      async propose(ctx: { currentSurface: unknown }) {
        // Prove the baseline surface is the DOCUMENT, not a refs array.
        expect(ctx.currentSurface).toBe(baselineDoc)
        return [
          {
            surface: `${baselineDoc}- recompute the objective before writing\n`,
            label: 'add-recompute-rule',
            rationale: 'stub',
          },
        ]
      },
    }
    // Judge: reward the document that contains the added rule.
    const docJudge: JudgeConfig<{ doc: string }, Scenario> = {
      name: 'doc-judge',
      dimensions: [{ key: 'q', description: 'has recompute rule' }],
      score: ({ artifact }) => {
        const has = artifact.doc.includes('recompute the objective')
        return { dimensions: { q: has ? 1 : 0 }, composite: has ? 1 : 0, notes: '' }
      },
    }
    const skillProfileWithRef = (): AgentProfile => ({
      name: 'fixture-agent',
      resources: {
        failOnError: true,
        skills: [{ kind: 'inline', name: 'or-skills', content: baselineDoc }],
      },
    })

    const profile = skillProfileWithRef()
    const result = await improve(profile, [], {
      surface: 'skills',
      scenarios,
      judge: docJudge,
      agent: async (surface, _s, ctx) => {
        return paidStubCall(ctx, 'stub', () => ({ doc: String(surface) }))
      },
      generator: stubProposer as never,
      skills: { resourceName: 'or-skills' },
      budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
    })

    expect(typeof result.decision).toBe('string')
    expect(result.candidate.value).toContain('recompute the objective')
    expect(result.candidate.profile?.resources?.skills?.[0]).toMatchObject({
      content: expect.stringContaining('recompute the objective'),
    })
    expect(profile.resources?.skills).toEqual([
      { kind: 'inline', name: 'or-skills', content: baselineDoc },
    ])
  })

  it.each([
    {
      surface: 'subagents' as const,
      profile: { name: 'fixture-agent', subagents: {} },
      winner: JSON.stringify({ reviewer: { prompt: 'improved review instructions' } }),
      read: (profile: AgentProfile) => profile.subagents?.reviewer?.prompt,
      expected: 'improved review instructions',
    },
    {
      surface: 'agent-profile' as const,
      profile: { name: 'fixture-agent', prompt: { systemPrompt: 'baseline' } },
      winner: JSON.stringify({
        name: 'fixture-agent',
        prompt: { systemPrompt: 'improved whole profile' },
      }),
      read: (profile: AgentProfile) => profile.prompt?.systemPrompt,
      expected: 'improved whole profile',
    },
  ])('materializes a valid $surface profile candidate', async (fixture) => {
    const result = await improve(fixture.profile, [{ finding: 'surface needs improvement' }], {
      surface: fixture.surface,
      scenarios,
      judge: improvementJudge,
      agent: stubAgent,
      generator: {
        kind: `stub-${fixture.surface}`,
        propose: async () => [
          { surface: fixture.winner, label: 'candidate', rationale: 'test candidate' },
        ],
      },
      promotionGate: {
        name: 'test-ship',
        decide: async () => ({
          decision: 'ship',
          reasons: ['test candidate'],
          contributingGates: [],
        }),
      },
      budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
    })

    expect(result.decision).toBe('ship')
    if (!result.candidate.profile) throw new Error('expected a profile candidate')
    expect(fixture.read(result.candidate.profile)).toEqual(fixture.expected)
  })

  it.each([
    {
      surface: 'skills' as const,
      profile: skillProfile(),
      skills: { resourceName: 'fixture-skill' },
      baseline: skillDocument,
      winner: 'improved skill instructions',
      read: (profile: AgentProfile) => {
        const resource = profile.resources?.skills?.[0]
        return resource?.kind === 'inline' ? resource.content : undefined
      },
    },
    {
      surface: 'subagents' as const,
      profile: { name: 'fixture-agent', subagents: {} },
      baseline: undefined,
      winner: JSON.stringify({ reviewer: { prompt: 'improved review instructions' } }),
      read: (profile: AgentProfile) => profile.subagents?.reviewer?.prompt,
    },
  ] satisfies Array<{
    surface: ImproveSurface
    profile: AgentProfile
    skills?: ImproveSkillsOptions
    baseline: string | undefined
    winner: string
    read: (profile: AgentProfile) => string | undefined
  }>)('profileDispatch runs the full immutable $surface profile for every cell', async (fixture) => {
    const seen: AgentProfile[] = []
    const result = await improve(fixture.profile, [{ finding: 'surface needs improvement' }], {
      surface: fixture.surface,
      scenarios,
      judge: improvementJudge,
      profileDispatch: async (profile, _scenario, ctx) =>
        paidStubCall(ctx, 'profile-dispatch', () => {
          seen.push(profile)
          return { text: fixture.read(profile) ?? '' }
        }),
      generator: {
        kind: `profile-dispatch-${fixture.surface}`,
        propose: async () => [
          { surface: fixture.winner, label: 'candidate', rationale: 'test candidate' },
        ],
      },
      ...(fixture.skills === undefined ? {} : { skills: fixture.skills }),
      promotionGate: {
        name: 'test-ship',
        decide: async () => ({
          decision: 'ship',
          reasons: ['test candidate'],
          contributingGates: [],
        }),
      },
      budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
    })

    expect(result.decision).toBe('ship')
    expect(seen.some((profile) => fixture.read(profile) === fixture.baseline)).toBe(true)
    expect(seen.some((profile) => fixture.read(profile)?.includes('improved'))).toBe(true)
    expect(seen.every(Object.isFrozen)).toBe(true)
    expect(fixture.read(fixture.profile)).toBe(fixture.baseline)
  })

  it("surface 'code' refuses profileDispatch before it can open a worktree", async () => {
    let dispatched = 0
    await expect(
      improve(promptProfile(), [], {
        surface: 'code',
        scenarios,
        judge,
        profileDispatch: async (_profile, _scenario, ctx) => {
          dispatched += 1
          return paidStubCall(ctx, 'profile-dispatch', () => ({ text: 'unreachable' }))
        },
        code: { repoRoot: '/tmp/must-not-be-opened' },
      }),
    ).rejects.toThrow(/cannot use profileDispatch/)
    expect(dispatched).toBe(0)
  })

  it('rejects both dispatch forms before a cell runs', async () => {
    let dispatched = 0
    const invalid = {
      surface: 'prompt',
      gate: 'none',
      scenarios,
      judge,
      agent: async (surface: unknown, scenario: Scenario, ctx: DispatchContext) => {
        dispatched += 1
        return stubAgent(surface, scenario, ctx)
      },
      profileDispatch: async (
        _profile: AgentProfile,
        _scenario: Scenario,
        ctx: DispatchContext,
      ) => {
        dispatched += 1
        return paidStubCall(ctx, 'profile-dispatch', () => ({ text: 'unreachable' }))
      },
    } as unknown as ImproveOptions<Scenario, { text: string }>

    await expect(improve(promptProfile(), [], invalid)).rejects.toThrow(/provide exactly one/)
    expect(dispatched).toBe(0)
  })

  it('rejects a missing dispatch before a cell runs', async () => {
    const invalid = {
      surface: 'prompt',
      gate: 'none',
      scenarios,
      judge,
    } as ImproveOptions<Scenario, { text: string }>

    await expect(improve(promptProfile(), [], invalid)).rejects.toThrow(/provide exactly one/)
  })

  it('rejects a config candidate that cannot form a valid AgentProfile', async () => {
    await expect(
      improve(
        { name: 'fixture-agent', subagents: {} },
        [{ finding: 'surface needs improvement' }],
        {
          surface: 'subagents',
          scenarios,
          judge: improvementJudge,
          agent: stubAgent,
          generator: {
            kind: 'stub-invalid-subagent',
            propose: async () => [
              {
                surface: JSON.stringify({ reviewer: { prompt: 'improved', maxSteps: 'many' } }),
                label: 'candidate',
                rationale: 'invalid candidate',
              },
            ],
          },
          promotionGate: {
            name: 'test-ship',
            decide: async () => ({
              decision: 'ship',
              reasons: ['exercise validation'],
              contributingGates: [],
            }),
          },
          budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
        },
      ),
    ).rejects.toThrow(/valid AgentProfile/)
  })

  it('forwards evaluation controls to the shared self-improvement loop', async () => {
    const progressKinds: string[] = []
    let provenanceCalls = 0
    let decisionCalls = 0
    const result = await improve(promptProfile(), [{ finding: 'prompt needs improvement' }], {
      surface: 'prompt',
      scenarios,
      judge: improvementJudge,
      agent: stubAgent,
      generator: {
        kind: 'stub-controls',
        propose: async () => [
          { surface: 'improved prompt', label: 'candidate', rationale: 'test candidate' },
        ],
      },
      promotionGate: {
        name: 'test-hold',
        decide: async () => {
          decisionCalls += 1
          return { decision: 'hold', reasons: ['test hold'], contributingGates: [] }
        },
      },
      onProgress: (event) => progressKinds.push(event.kind),
      onProvenance: () => {
        provenanceCalls += 1
      },
      expectUsage: 'assert',
      captureSource: 'eval-run',
      autoOnPromote: 'none',
      budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
    })

    expect(result.decision).toBe('hold')
    expect(decisionCalls).toBe(1)
    expect(provenanceCalls).toBe(1)
    expect(progressKinds).toContain('baseline.completed')
    expect(progressKinds).toContain('gate.decided')
  })

  it('a surface with no zero-config default still fails loud with ConfigError', async () => {
    // Prompt, skills, and memory have defaults; config surfaces require a
    // caller-supplied generator. This is the
    // designed boundary the proposer migration must NOT erase.
    const configSurfaces: ImproveSurface[] = ['tools', 'mcp', 'hooks', 'subagents', 'agent-profile']
    for (const surface of configSurfaces) {
      await expect(
        improve(promptProfile(), [], { surface, gate: 'none', scenarios, judge, agent: stubAgent }),
      ).rejects.toBeInstanceOf(ConfigError)
    }
  })

  it.each([
    'text',
    'external-code',
  ] as const)("surface 'code' rejects a top-level proposer before it can return $surfaceKind", async (surfaceKind) => {
    let proposerCalls = 0
    const externalCode: CodeSurface = {
      kind: 'code',
      worktreeRef: '/tmp/externally-owned-code-surface',
      baseRef: 'main',
      baseCommit: 'a'.repeat(40),
      baseTree: 'b'.repeat(40),
      candidateCommit: 'c'.repeat(40),
      candidateTree: 'd'.repeat(40),
      patch: {
        format: 'git-diff-binary',
        sha256: `sha256:${'e'.repeat(64)}`,
        byteLength: 1,
      },
    }
    const externalProposer: SurfaceProposer = {
      kind: 'externally-owned-code-test',
      async propose() {
        proposerCalls += 1
        return [
          {
            surface: surfaceKind === 'text' ? 'not-a-code-surface' : externalCode,
            label: 'unsafe external result',
            rationale: 'exercise code ownership validation',
          },
        ]
      },
    }

    await expect(
      improve(promptProfile(), [], {
        surface: 'code',
        scenarios,
        judge,
        agent: stubAgent,
        generator: externalProposer,
        code: { repoRoot: '/tmp/must-not-be-opened' },
        budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
      }),
    ).rejects.toThrow(/forbids opts\.generator/)
    expect(proposerCalls).toBe(0)
  })

  it('the default generation distiller feeds real failures to the next proposal round', async () => {
    // Judge fails scenario 'b' with a distinctive reason; everything else is perfect.
    const failingJudge: JudgeConfig<{ text: string }, Scenario> = {
      name: 'distiller-judge',
      dimensions: [{ key: 'q', description: 'fixture quality' }],
      score: ({ scenario }) =>
        scenario.id === 'b'
          ? { dimensions: { q: 0 }, composite: 0, notes: 'tour is not a permutation of 0..8' }
          : { dimensions: { q: 1 }, composite: 1, notes: 'ok' },
    }
    // Proposer stub records the findings it is handed each generation.
    const findingsSeen: unknown[][] = []
    const stubProposer = {
      kind: 'stub-recorder',
      async propose(ctx: { findings: unknown[]; populationSize: number }) {
        findingsSeen.push(ctx.findings)
        return [{ surface: `candidate-${findingsSeen.length}`, label: 'stub', rationale: 'stub' }]
      },
    }
    const result = await improve(promptProfile(), [{ seed: 'static-seed-finding' }], {
      surface: 'prompt',
      scenarios,
      judge: failingJudge,
      agent: stubAgent,
      generator: stubProposer as never,
      budget: { generations: 2, populationSize: 1, holdoutFraction: 0.25 },
    })
    expect(typeof result.decision).toBe('string')
    expect(findingsSeen.length).toBeGreaterThanOrEqual(2)
    // Current selfImprove analyzes the baseline before generation 1, so every
    // proposal round starts from measured failures instead of wasting a round
    // on the static seed.
    for (const seen of findingsSeen) {
      const round = JSON.stringify(seen)
      expect(round).toContain('"scenario":"b"')
      expect(round).toContain('not a permutation')
    }
    // The digest is TYPED on the wire: real AnalystFinding envelopes, not
    // ad-hoc {scenario, composite} objects a consumer must down-cast.
    const { isAnalystFinding } = await import('./findings')
    expect(findingsSeen[1]!.length).toBeGreaterThanOrEqual(1)
    expect(findingsSeen[1]!.every(isAnalystFinding)).toBe(true)
  })

  it('a real runDir defaults analyzeGeneration to the RAW-TRACE distiller', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const runDir = mkdtempSync(join(tmpdir(), 'improve-rawtrace-'))
    const failingJudge: JudgeConfig<{ text: string }, Scenario> = {
      name: 'failing-judge',
      dimensions: [{ key: 'q', description: 'fixture quality' }],
      score: () => ({ dimensions: { q: 0 }, composite: 0, notes: 'always failing' }),
    }
    const findingsSeen: unknown[][] = []
    const stubProposer = {
      kind: 'stub-recorder',
      async propose(ctx: { findings: unknown[]; populationSize: number }) {
        findingsSeen.push(ctx.findings)
        return [{ surface: `candidate-${findingsSeen.length}`, label: 'stub', rationale: 'stub' }]
      },
    }
    try {
      await improve(promptProfile(), [], {
        surface: 'prompt',
        scenarios,
        judge: failingJudge,
        agent: stubAgent,
        generator: stubProposer as never,
        runDir,
        budget: { generations: 2, populationSize: 1, holdoutFraction: 0.25 },
      })
      // The durable-run default is rawTraceDistiller: a later round's findings
      // are its raw-trace-context envelopes (paths into the recorded traces),
      // NOT the distilled failure digest.
      const later = findingsSeen.at(-1)!
      expect(JSON.stringify(later)).toContain('raw-trace-context')
      const { isAnalystFinding } = await import('./findings')
      expect(later.every(isAnalystFinding)).toBe(true)
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('the distiller keeps traceback-sized notes intact and clips at the 1500/500 caps', async () => {
    // A realistic executable-judge note (~1000 chars) must survive whole; a
    // runaway note is clipped to exactly 1500; a cell error is clipped to 500.
    const intactNote = `Traceback (most recent call last):\n${'  assert tour == expected\n'.repeat(38)}`
    expect(intactNote.length).toBeGreaterThan(900)
    expect(intactNote.length).toBeLessThan(1500)
    const runawayNote = 'n'.repeat(1600)
    const longError = 'e'.repeat(800)
    const cappingJudge: JudgeConfig<{ text: string }, Scenario> = {
      name: 'capping-judge',
      dimensions: [{ key: 'q', description: 'fixture quality' }],
      score: ({ scenario }) => {
        if (scenario.id === 'a') return { dimensions: { q: 0 }, composite: 0, notes: intactNote }
        if (scenario.id === 'b') return { dimensions: { q: 0 }, composite: 0, notes: runawayNote }
        return { dimensions: { q: 1 }, composite: 1, notes: 'ok' }
      },
    }
    const findingsSeen: unknown[][] = []
    const stubProposer = {
      kind: 'stub-recorder',
      async propose(ctx: { findings: unknown[]; populationSize: number }) {
        findingsSeen.push(ctx.findings)
        return [{ surface: `candidate-${findingsSeen.length}`, label: 'stub', rationale: 'stub' }]
      },
    }
    const failingAgent = async (surface: unknown, scenario: Scenario, ctx: DispatchContext) => {
      // The baseline must stay complete (an incomplete incumbent is refused),
      // so the error lands on a generation-1 candidate cell instead.
      if (scenario.id === 'c' && typeof surface === 'string' && surface.startsWith('candidate-')) {
        throw new Error(longError)
      }
      return stubAgent(surface, scenario, ctx)
    }
    await improve(promptProfile(), [], {
      surface: 'prompt',
      scenarios,
      judge: cappingJudge,
      agent: failingAgent,
      generator: stubProposer as never,
      budget: { generations: 2, populationSize: 1, holdoutFraction: 0.25 },
    })
    expect(findingsSeen.length).toBeGreaterThanOrEqual(1)
    // Rows are typed AnalystFinding envelopes; the distilled cell fields ride
    // `metadata` so consumers keep one wire shape (see generationFailureDistiller).
    const rows = findingsSeen.flat() as Array<{
      metadata?: { scenario?: string; notes?: string; error?: string }
    }>
    const intact = rows.find((row) => row.metadata?.scenario === 'a')
    expect(intact?.metadata?.notes).toBe(intactNote) // below the cap ⇒ untouched
    const clipped = rows.find((row) => row.metadata?.scenario === 'b')
    expect(clipped?.metadata?.notes).toBe('n'.repeat(1500)) // at the cap ⇒ exactly 1500
    const errored = rows.find((row) => row.metadata?.scenario === 'c')
    expect(errored?.metadata?.error).toBeDefined()
    expect(errored?.metadata?.error).toContain('e'.repeat(400))
    expect(errored?.metadata?.error?.length).toBeLessThanOrEqual(500)
  })

  it("surface 'code' + opts.code assembles the worktree pipeline and measures a candidate", async () => {
    const { execSync } = await import('node:child_process')
    const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const repoRoot = mkdtempSync(join(tmpdir(), 'improve-code-'))
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: repoRoot, stdio: 'pipe' })
    try {
      git('init -q -b main')
      git('config user.email improve@test.local')
      git('config user.name improve-test')
      writeFileSync(join(repoRoot, 'module.txt'), 'baseline contents\n')
      git('add module.txt')
      git('commit -qm baseline')

      // Byte-producer stub via the designed test seam: writes a change into the
      // candidate worktree; the driver finalizes it into a CodeSurface.
      let generatorCalls = 0
      const startingContents: string[] = []
      const measured: unknown[] = []
      const result = await improve(promptProfile(), [{ finding: 'module.txt is stale' }], {
        surface: 'code',
        scenarios,
        judge: improvementJudge,
        agent: async (surface, _scenario, ctx) => {
          return paidStubCall(ctx, 'stub-agent', () => {
            measured.push(surface)
            if (typeof surface !== 'object' || surface === null || !('worktreeRef' in surface)) {
              throw new Error('expected code surface')
            }
            return {
              text: readFileSync(join(String(surface.worktreeRef), 'module.txt'), 'utf8'),
            }
          })
        },
        code: {
          repoRoot,
          generator: {
            kind: 'stub',
            async generate({ worktreePath }) {
              generatorCalls += 1
              const current = readFileSync(join(worktreePath, 'module.txt'), 'utf8')
              startingContents.push(current)
              writeFileSync(
                join(worktreePath, 'module.txt'),
                `${current}improved ${generatorCalls}\n`,
              )
              return { applied: true, summary: 'stub improvement' }
            },
          },
        },
        promotionGate: {
          name: 'test-hold',
          decide: async () => ({
            decision: 'hold',
            reasons: ['exercise non-promoted candidate retention'],
            contributingGates: [],
          }),
        },
        budget: { generations: 2, populationSize: 1, holdoutFraction: 0.25 },
      })

      // The facade assembled a real proposer: the stub produced candidates, the
      // loop measured them (code surfaces reached the agent), and the gate decided.
      expect(generatorCalls).toBe(2)
      expect(startingContents).toEqual(['baseline contents\n', 'baseline contents\nimproved 1\n'])
      expect(result.decision).toBe('hold')
      const codeSurfaces = measured.filter(
        (m) =>
          typeof m === 'object' && m !== null && 'worktreeRef' in (m as Record<string, unknown>),
      )
      expect(codeSurfaces.length).toBeGreaterThanOrEqual(2)
      expect(
        codeSurfaces.some((surface) =>
          String((surface as { worktreeRef: string }).worktreeRef).includes('incumbent-baseline'),
        ),
      ).toBe(true)
      expect(result.candidate.profile).toBeUndefined()
      if (typeof result.candidate.value === 'string') {
        throw new Error('expected code winner')
      }
      expect(readFileSync(join(result.candidate.value.worktreeRef, 'module.txt'), 'utf8')).toBe(
        'baseline contents\nimproved 1\n',
      )
      expect(String(git('worktree list --porcelain')).match(/^worktree /gm)).toHaveLength(2)
      await result.dispose()
      await result.dispose()
      expect(String(git('worktree list --porcelain')).match(/^worktree /gm)).toHaveLength(1)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it("surface 'code' keeps the baseline worktree when a baseline-only run returns it", async () => {
    const { execSync } = await import('node:child_process')
    const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const repoRoot = mkdtempSync(join(tmpdir(), 'improve-code-baseline-'))
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: repoRoot, stdio: 'pipe' })
    try {
      git('init -q -b main')
      git('config user.email improve@test.local')
      git('config user.name improve-test')
      writeFileSync(join(repoRoot, 'module.txt'), 'baseline contents\n')
      git('add module.txt')
      git('commit -qm baseline')

      const result = await improve(promptProfile(), [], {
        surface: 'code',
        gate: 'none',
        scenarios,
        judge,
        agent: async (surface, _scenario, ctx) => {
          return paidStubCall(ctx, 'stub-agent', () => {
            if (typeof surface !== 'object' || surface === null || !('worktreeRef' in surface)) {
              throw new Error('expected code surface')
            }
            return {
              text: readFileSync(join(String(surface.worktreeRef), 'module.txt'), 'utf8'),
            }
          })
        },
        code: {
          repoRoot,
          generator: {
            kind: 'must-not-run',
            async generate() {
              throw new Error('baseline-only run must not call the generator')
            },
          },
        },
      })

      if (typeof result.candidate.value === 'string') {
        throw new Error('expected code winner')
      }
      expect(result.decision).toBe('hold')
      expect(readFileSync(join(result.candidate.value.worktreeRef, 'module.txt'), 'utf8')).toBe(
        'baseline contents\n',
      )
      expect(String(git('worktree list --porcelain')).match(/^worktree /gm)).toHaveLength(2)
      await result.dispose()
      await result.dispose()
      expect(String(git('worktree list --porcelain')).match(/^worktree /gm)).toHaveLength(1)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it.each([
    { mode: 'transient' as const, expectedWorktrees: 1, expectedErrors: 1 },
    { mode: 'persistent' as const, expectedWorktrees: 3, expectedErrors: 2 },
  ])('surface code retries $mode cleanup before rejecting without a result', async (fixture) => {
    const { execSync } = await import('node:child_process')
    const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const repoRoot = mkdtempSync(join(tmpdir(), `improve-code-${fixture.mode}-cleanup-`))
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: repoRoot, stdio: 'pipe' })
    try {
      git('init -q -b main')
      git('config user.email improve@test.local')
      git('config user.name improve-test')
      writeFileSync(join(repoRoot, 'module.txt'), 'baseline contents\n')
      git('add module.txt')
      git('commit -qm baseline')

      const realWorktree = gitWorktreeAdapter({ repoRoot })
      let discardAttempts = 0
      const flakyWorktree: WorktreeAdapter = {
        ...realWorktree,
        async discard(worktree: Worktree) {
          discardAttempts += 1
          if (fixture.mode === 'persistent' || discardAttempts === 1) {
            throw new Error(`${fixture.mode} discard failure ${discardAttempts}`)
          }
          await realWorktree.discard(worktree)
        },
      }

      let caught: unknown
      try {
        await improve(promptProfile(), [], {
          surface: 'code',
          scenarios,
          judge: improvementJudge,
          agent: async (surface, _scenario, ctx) => {
            return paidStubCall(ctx, 'stub-agent', () => {
              if (typeof surface !== 'object' || surface === null || !('worktreeRef' in surface)) {
                throw new Error('expected code surface')
              }
              return {
                text: readFileSync(join(String(surface.worktreeRef), 'module.txt'), 'utf8'),
              }
            })
          },
          code: {
            repoRoot,
            worktree: flakyWorktree,
            generator: {
              kind: 'cleanup-test',
              async generate({ worktreePath }) {
                writeFileSync(join(worktreePath, 'module.txt'), 'improved contents\n')
                return { applied: true, summary: 'improve cleanup fixture' }
              },
            },
          },
          promotionGate: {
            name: 'test-hold',
            decide: async () => ({
              decision: 'hold',
              reasons: ['exercise cleanup recovery'],
              contributingGates: [],
            }),
          },
          budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
        })
      } catch (cause) {
        caught = cause
      }

      const aggregate =
        caught instanceof AggregateError
          ? caught
          : (caught as { cause?: unknown } | undefined)?.cause
      expect(aggregate).toBeInstanceOf(AggregateError)
      expect((aggregate as AggregateError).errors).toHaveLength(fixture.expectedErrors)
      expect(discardAttempts).toBe(3)
      expect(String(git('worktree list --porcelain')).match(/^worktree /gm)).toHaveLength(
        fixture.expectedWorktrees,
      )
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it.each([
    {
      mode: 'transient' as const,
      expectedWorktrees: 1,
      expectedErrors: 2,
      expectedDiscardAttempts: 3,
    },
    {
      mode: 'persistent' as const,
      expectedWorktrees: 3,
      expectedErrors: 3,
      expectedDiscardAttempts: 6,
    },
  ])('surface code retries $mode cleanup when selfImprove rejects', async (fixture) => {
    const { execSync } = await import('node:child_process')
    const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const repoRoot = mkdtempSync(join(tmpdir(), `improve-code-${fixture.mode}-rejection-`))
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: repoRoot, stdio: 'pipe' })
    try {
      git('init -q -b main')
      git('config user.email improve@test.local')
      git('config user.name improve-test')
      writeFileSync(join(repoRoot, 'module.txt'), 'baseline contents\n')
      git('add module.txt')
      git('commit -qm baseline')

      const realWorktree = gitWorktreeAdapter({ repoRoot })
      let discardAttempts = 0
      const flakyWorktree: WorktreeAdapter = {
        ...realWorktree,
        async discard(worktree: Worktree) {
          discardAttempts += 1
          if (fixture.mode === 'persistent' || discardAttempts === 1) {
            throw new Error(`${fixture.mode} discard failure ${discardAttempts}`)
          }
          await realWorktree.discard(worktree)
        },
      }
      let caught: unknown
      try {
        await improve(promptProfile(), [], {
          surface: 'code',
          scenarios,
          judge,
          agent: async (surface, _scenario, ctx) => {
            return paidStubCall(ctx, 'stub-agent', () => {
              if (typeof surface !== 'object' || surface === null || !('worktreeRef' in surface)) {
                throw new Error('expected code surface')
              }
              return {
                text: readFileSync(join(String(surface.worktreeRef), 'module.txt'), 'utf8'),
              }
            })
          },
          code: {
            repoRoot,
            worktree: flakyWorktree,
            generator: {
              kind: 'rejecting-test',
              async generate() {
                throw new Error('candidate generation failed')
              },
            },
          },
          budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
        })
      } catch (cause) {
        caught = cause
      }

      const aggregate =
        caught instanceof AggregateError
          ? caught
          : (caught as { cause?: unknown } | undefined)?.cause
      expect(aggregate).toBeInstanceOf(AggregateError)
      expect((aggregate as AggregateError).errors).toHaveLength(fixture.expectedErrors)
      expect(discardAttempts).toBe(fixture.expectedDiscardAttempts)
      expect(String(git('worktree list --porcelain')).match(/^worktree /gm)).toHaveLength(
        fixture.expectedWorktrees,
      )
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it.each([
    { mode: 'transient' as const, expectedWorktrees: 1, expectedErrors: 2 },
    { mode: 'persistent' as const, expectedWorktrees: 2, expectedErrors: 3 },
  ])('surface code retries $mode cleanup when baseline finalization rejects', async (fixture) => {
    const { execSync } = await import('node:child_process')
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const repoRoot = mkdtempSync(join(tmpdir(), `improve-code-${fixture.mode}-finalize-`))
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: repoRoot, stdio: 'pipe' })
    try {
      git('init -q -b main')
      git('config user.email improve@test.local')
      git('config user.name improve-test')
      writeFileSync(join(repoRoot, 'module.txt'), 'baseline contents\n')
      git('add module.txt')
      git('commit -qm baseline')

      const realWorktree = gitWorktreeAdapter({ repoRoot })
      let discardAttempts = 0
      const rejectingWorktree: WorktreeAdapter = {
        ...realWorktree,
        async finalize() {
          throw new Error('baseline finalization failed')
        },
        async discard(worktree: Worktree) {
          discardAttempts += 1
          if (fixture.mode === 'persistent' || discardAttempts === 1) {
            throw new Error(`${fixture.mode} discard failure ${discardAttempts}`)
          }
          await realWorktree.discard(worktree)
        },
      }

      let caught: unknown
      try {
        await improve(promptProfile(), [], {
          surface: 'code',
          scenarios,
          judge,
          agent: stubAgent,
          code: {
            repoRoot,
            worktree: rejectingWorktree,
            generator: {
              kind: 'unused',
              async generate() {
                throw new Error('must not generate before baseline finalization')
              },
            },
          },
          budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
        })
      } catch (cause) {
        caught = cause
      }

      expect(caught).toBeInstanceOf(AggregateError)
      expect((caught as AggregateError).errors).toHaveLength(fixture.expectedErrors)
      expect(discardAttempts).toBe(2)
      expect(String(git('worktree list --porcelain')).match(/^worktree /gm)).toHaveLength(
        fixture.expectedWorktrees,
      )
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
