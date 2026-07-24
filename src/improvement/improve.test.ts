import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  gitWorktreeAdapter,
  inMemoryCampaignStorage,
  type OptimizationMethod,
  type OptimizationMethodInput,
  type Worktree,
  type WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'
import type {
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  Scenario,
} from '@tangle-network/agent-eval/contract'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../errors'
import { improve } from './improve'
import type { ReadonlyAgentProfile } from './profile-types'

interface TestScenario extends Scenario {
  kind: 'fixture'
}

interface TextArtifact {
  text: string
}

const trainScenarios: TestScenario[] = [{ id: 'train', kind: 'fixture' }]
const selectionScenarios: TestScenario[] = [{ id: 'selection', kind: 'fixture' }]
const testScenarios: TestScenario[] = [
  { id: 'test-a', kind: 'fixture' },
  { id: 'test-b', kind: 'fixture' },
]
const allScenarios = [...trainScenarios, ...selectionScenarios, ...testScenarios]
const executionRef = canonicalCandidateDigest({ fixture: 'improve-method' })

const improvementJudge: JudgeConfig<TextArtifact, TestScenario> = {
  name: 'improvement',
  dimensions: [{ key: 'quality', description: 'candidate contains the improvement marker' }],
  score: ({ artifact }) => {
    const quality = artifact.text.includes('improved') ? 1 : 0
    return { dimensions: { quality }, composite: quality, notes: '' }
  },
}

async function paidArtifact(
  text: string,
  _scenario: TestScenario,
  ctx: DispatchContext,
): Promise<TextArtifact> {
  const paid = await ctx.cost.runPaidCall({
    channel: 'agent',
    actor: 'test-agent',
    model: 'deterministic-test',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => ({ text }),
    receipt: () => ({
      model: 'deterministic-test',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

async function paidProfile(
  profile: ReadonlyAgentProfile,
  scenario: TestScenario,
  ctx: DispatchContext,
): Promise<TextArtifact> {
  return paidArtifact(profile.prompt?.systemPrompt ?? '', scenario, ctx)
}

function fixedMethod(
  winnerSurface: MutableSurface,
  inspect?: (input: OptimizationMethodInput<TestScenario, TextArtifact>) => void,
): OptimizationMethod<TestScenario, TextArtifact> {
  return {
    name: 'fixed-method',
    async optimize(input) {
      inspect?.(input)
      return {
        winnerSurface,
        cost: { totalCostUsd: 0, accountingComplete: true, incompleteReasons: [] },
        durationMs: 1,
      }
    },
  }
}

function methodOptions(method: OptimizationMethod<TestScenario, TextArtifact>): {
  method: OptimizationMethod<TestScenario, TextArtifact>
  executionRef: typeof executionRef
  trainScenarios: TestScenario[]
  selectionScenarios: TestScenario[]
  testScenarios: TestScenario[]
  judges: JudgeConfig<TextArtifact, TestScenario>[]
  agent: typeof paidProfile
  runDir: string
  storage: ReturnType<typeof inMemoryCampaignStorage>
  resamples: number
  confidence: number
} {
  return {
    method,
    executionRef,
    trainScenarios,
    selectionScenarios,
    testScenarios,
    judges: [improvementJudge],
    agent: paidProfile,
    runDir: `mem://improve-method-${Math.random()}`,
    storage: inMemoryCampaignStorage(),
    resamples: 40,
    confidence: 0.95,
  }
}

const promptProfile = (): AgentProfile => ({
  name: 'fixture-agent',
  prompt: { systemPrompt: 'baseline' },
})

describe('improve method execution', () => {
  it('runs a complete method without exposing final-test cases and materializes its prompt', async () => {
    let observed: OptimizationMethodInput<TestScenario, TextArtifact> | undefined
    let observedEvaluationRef = ''
    const profile = promptProfile()
    const method = fixedMethod('improved prompt', (input) => (observed = input))
    const result = await improve(profile, {
      ...methodOptions(method),
      surface: 'prompt',
      method: (context) => {
        observedEvaluationRef = context.evaluationRef
        return method
      },
    })

    expect(observed?.trainScenarios.map((scenario) => scenario.id)).toEqual(['train'])
    expect(observed?.selectionScenarios.map((scenario) => scenario.id)).toEqual(['selection'])
    expect(observed?.runOptions.dispatchRef).toBe(`improve:${observedEvaluationRef}`)
    expect(observed?.judges[0]?.judgeVersion).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(JSON.stringify(observed)).not.toContain('test-a')
    expect(result.mode).toBe('method')
    expect(result.method).toBe('fixed-method')
    expect(result.decision).toBe('ship')
    expect(result.lift).toBe(1)
    expect(result.liftInterval.low).toBeGreaterThan(0)
    expect(result.candidate.profile?.prompt?.systemPrompt).toBe('improved prompt')
    expect(profile.prompt?.systemPrompt).toBe('baseline')
    expect(Object.isFrozen(result.candidate)).toBe(true)
  })

  it('resumes an identical profile run without dispatching another agent call', async () => {
    const storage = inMemoryCampaignStorage()
    let agentCalls = 0
    const options = {
      ...methodOptions(fixedMethod('improved prompt')),
      storage,
      runDir: 'mem://improve-exact-resume',
      agent: async (
        candidate: ReadonlyAgentProfile,
        scenario: TestScenario,
        ctx: DispatchContext,
      ) => {
        agentCalls += 1
        return paidProfile(candidate, scenario, ctx)
      },
    }

    const first = await improve(promptProfile(), options)
    const callsAfterFirst = agentCalls
    const second = await improve(promptProfile(), options)

    expect(callsAfterFirst).toBeGreaterThan(0)
    expect(agentCalls).toBe(callsAfterFirst)
    expect(second.cost).toEqual(first.cost)
    expect(second.candidate.profile).toEqual(first.candidate.profile)
  })

  it('does not reuse saved measurements after executable or baseline identity changes', async () => {
    const storage = inMemoryCampaignStorage()
    const runDir = 'mem://improve-identity-change'
    let agentCalls = 0
    const options = {
      ...methodOptions(fixedMethod('improved prompt')),
      storage,
      runDir,
      agent: async (
        candidate: ReadonlyAgentProfile,
        scenario: TestScenario,
        ctx: DispatchContext,
      ) => {
        agentCalls += 1
        return paidProfile(candidate, scenario, ctx)
      },
    }
    await improve(promptProfile(), options)
    const callsAfterBaseline = agentCalls

    await improve(promptProfile(), {
      ...options,
      executionRef: canonicalCandidateDigest({ fixture: 'changed-execution' }),
    })
    expect(agentCalls).toBeGreaterThan(callsAfterBaseline)
    const callsAfterExecutionChange = agentCalls

    await improve(
      {
        ...promptProfile(),
        description: 'changed complete profile',
      },
      options,
    )
    expect(agentCalls).toBeGreaterThan(callsAfterExecutionChange)
  })

  it('requires a content-addressed executable identity', async () => {
    await expect(
      improve(promptProfile(), {
        ...methodOptions(fixedMethod('improved prompt')),
        executionRef: undefined as never,
      }),
    ).rejects.toThrow(/executionRef must be a lowercase sha256/)
    await expect(
      improve(promptProfile(), {
        ...methodOptions(fixedMethod('improved prompt')),
        executionRef: 'callback-v1' as never,
      }),
    ).rejects.toThrow(/executionRef must be a lowercase sha256/)
  })

  it('propagates caller cancellation into the optimization method', async () => {
    const controller = new AbortController()
    const reason = new Error('caller stopped improvement')
    controller.abort(reason)
    let observedAbortedSignal = false
    const method = fixedMethod('improved prompt')
    method.optimize = async (input) => {
      observedAbortedSignal = input.runOptions.signal?.aborted === true
      throw input.runOptions.signal?.reason
    }

    await expect(
      improve(promptProfile(), {
        ...methodOptions(method),
        signal: controller.signal,
      }),
    ).rejects.toThrow(reason.message)
    expect(observedAbortedSignal).toBe(true)
  })

  it('passes current findings to a method factory', async () => {
    const findings = [{ claim: 'answers omit citations' }]
    let observedFindings: readonly unknown[] | undefined
    const result = await improve(promptProfile(), {
      ...methodOptions(fixedMethod('unused')),
      findings,
      method: (context) => {
        observedFindings = context.findings
        expect(context.surface).toBe('prompt')
        expect(context.baselineSurface).toBe('baseline')
        return fixedMethod('improved prompt')
      },
    })

    expect(observedFindings).toEqual(findings)
    expect(result.decision).toBe('ship')
  })

  it('holds when the final-test interval does not clear the requested lift', async () => {
    const result = await improve(promptProfile(), {
      ...methodOptions(fixedMethod('improved prompt')),
      minimumLift: 1,
    })

    expect(result.lift).toBe(1)
    expect(result.decision).toBe('hold')
  })

  it('distinguishes train and selection boundaries in optimizer lineage', async () => {
    const extra: TestScenario = { id: 'extra', kind: 'fixture' }
    const first = await improve(promptProfile(), {
      ...methodOptions(fixedMethod('improved prompt')),
      trainScenarios: [trainScenarios[0]!, extra],
      selectionScenarios,
    })
    const second = await improve(promptProfile(), {
      ...methodOptions(fixedMethod('improved prompt')),
      trainScenarios,
      selectionScenarios: [extra, selectionScenarios[0]!],
    })

    expect(first.lineage.developmentSplitDigest).not.toBe(second.lineage.developmentSplitDigest)
  })

  it('materializes one exact inline skill', async () => {
    const profile: AgentProfile = {
      name: 'fixture-agent',
      resources: {
        failOnError: true,
        skills: [{ kind: 'inline', name: 'review', content: 'baseline skill' }],
      },
    }
    const result = await improve(profile, {
      ...methodOptions(fixedMethod('improved skill')),
      surface: 'skills',
      skills: { resourceName: 'review' },
    })

    expect(result.candidate.profile?.resources?.skills).toEqual([
      { kind: 'inline', name: 'review', content: 'improved skill' },
    ])
    expect(profile.resources?.skills).toEqual([
      { kind: 'inline', name: 'review', content: 'baseline skill' },
    ])
  })

  it.each([
    {
      surface: 'tools' as const,
      profile: { name: 'fixture-agent', tools: { Bash: true } },
      winner: '{"Read":true}',
      expected: { tools: { Read: true } },
    },
    {
      surface: 'mcp' as const,
      profile: { name: 'fixture-agent', mcp: { old: { command: 'old-server' } } },
      winner: '{"search":{"command":"new-server"}}',
      expected: { mcp: { search: { command: 'new-server' } } },
    },
    {
      surface: 'hooks' as const,
      profile: { name: 'fixture-agent', hooks: { Stop: [{ command: 'echo old' }] } },
      winner: '{"Stop":[{"command":"echo new"}]}',
      expected: { hooks: { Stop: [{ command: 'echo new' }] } },
    },
    {
      surface: 'subagents' as const,
      profile: { name: 'fixture-agent', subagents: { old: { prompt: 'Old prompt' } } },
      winner: '{"reviewer":{"prompt":"Review the result"}}',
      expected: { subagents: { reviewer: { prompt: 'Review the result' } } },
    },
    {
      surface: 'memory' as const,
      profile: {
        name: 'fixture-agent',
        resources: { failOnError: true as const, instructions: 'baseline memory' },
      },
      winner: 'improved memory',
      expected: {
        resources: { failOnError: true, instructions: 'improved memory' },
      },
    },
  ])('materializes an exact $surface profile coordinate', async (testCase) => {
    const result = await improve(testCase.profile, {
      ...methodOptions(fixedMethod(testCase.winner)),
      surface: testCase.surface,
    })

    expect(result.candidate.profile).toMatchObject(testCase.expected)
    expect(testCase.profile).not.toMatchObject(testCase.expected)
  })

  it('materializes a complete profile candidate', async () => {
    const winner = JSON.stringify({
      name: 'fixture-agent',
      prompt: { systemPrompt: 'improved whole profile' },
    })
    const result = await improve(promptProfile(), {
      ...methodOptions(fixedMethod(winner)),
      surface: 'agent-profile',
    })

    expect(result.candidate.profile).toEqual({
      name: 'fixture-agent',
      prompt: { systemPrompt: 'improved whole profile' },
    })
  })

  it('optimizes caller-defined profile components without dropping component state', async () => {
    let observedBaseline: MutableSurface | undefined
    const profile: AgentProfile = {
      name: 'fixture-agent',
      prompt: { systemPrompt: 'baseline' },
      tools: { search: false },
    }
    const winner: MutableSurface = {
      kind: 'components',
      components: {
        prompt: 'improved prompt',
        tools: '{"search":true}',
      },
    }
    const result = await improve(profile, {
      ...methodOptions(
        fixedMethod(winner, (input) => {
          observedBaseline = input.baselineSurface
        }),
      ),
      surface: 'agent-profile',
      profileComponents: {
        read: (current) => ({
          prompt: current.prompt?.systemPrompt ?? '',
          tools: JSON.stringify(current.tools ?? {}),
        }),
        apply: (current, components) => ({
          ...current,
          prompt: { ...current.prompt, systemPrompt: components.prompt },
          tools: JSON.parse(components.tools ?? '{}') as Record<string, boolean>,
        }),
      },
      agent: paidProfile,
    })

    expect(observedBaseline).toEqual({
      kind: 'components',
      components: {
        prompt: 'baseline',
        tools: '{"search":false}',
      },
    })
    expect(result.candidate.profile).toMatchObject({
      prompt: { systemPrompt: 'improved prompt' },
      tools: { search: true },
    })
    expect(profile).toMatchObject({
      prompt: { systemPrompt: 'baseline' },
      tools: { search: false },
    })
  })

  it('rejects component candidates that add or remove profile component names', async () => {
    await expect(
      improve(promptProfile(), {
        ...methodOptions(
          fixedMethod({
            kind: 'components',
            components: { prompt: 'improved prompt' },
          }),
        ),
        surface: 'agent-profile',
        profileComponents: {
          read: () => ({ prompt: 'baseline', policy: '{}' }),
          apply: (current, components) => ({
            ...current,
            prompt: { ...current.prompt, systemPrompt: components.prompt },
          }),
        },
      }),
    ).rejects.toThrow(/preserve the exact component names/)
  })

  it('rejects a profile component adapter that does not apply the measured winner', async () => {
    await expect(
      improve(promptProfile(), {
        ...methodOptions(
          fixedMethod({
            kind: 'components',
            components: { prompt: 'improved prompt' },
          }),
        ),
        surface: 'agent-profile',
        profileComponents: {
          read: (current) => ({ prompt: current.prompt?.systemPrompt ?? '' }),
          apply: (current) => ({ ...current }),
        },
        agent: paidProfile,
      }),
    ).rejects.toThrow(/round-trip every winning component/)
  })

  it('rejects a component adapter that changes unmeasured baseline fields', async () => {
    await expect(
      improve(promptProfile(), {
        ...methodOptions(
          fixedMethod({
            kind: 'components',
            components: { prompt: 'improved prompt' },
          }),
        ),
        surface: 'agent-profile',
        profileComponents: {
          read: (current) => ({ prompt: current.prompt?.systemPrompt ?? '' }),
          apply: (current, components) => ({
            ...current,
            description: 'unmeasured adapter side effect',
            prompt: { ...current.prompt, systemPrompt: components.prompt },
          }),
        },
      }),
    ).rejects.toThrow(/must reproduce the complete baseline profile exactly/)
  })

  it('scores and returns the same complete profile produced by a component mapping', async () => {
    const observed: ReadonlyAgentProfile[] = []
    const result = await improve(
      {
        name: 'fixture-agent',
        prompt: { systemPrompt: 'baseline' },
        tools: { Bash: false },
      },
      {
        ...methodOptions(
          fixedMethod({
            kind: 'components',
            components: { prompt: 'improved prompt' },
          }),
        ),
        surface: 'agent-profile',
        profileComponents: {
          read: (current) => ({ prompt: current.prompt?.systemPrompt ?? '' }),
          apply: (current, components) => ({
            ...current,
            prompt: { ...current.prompt, systemPrompt: components.prompt },
            tools: { Bash: components.prompt === 'improved prompt' },
          }),
        },
        agent: async (candidate, scenario, ctx) => {
          observed.push(candidate)
          return paidProfile(candidate, scenario, ctx)
        },
      },
    )

    const measuredWinner = observed.find(
      (candidate) =>
        candidate.prompt?.systemPrompt === 'improved prompt' && candidate.tools?.Bash === true,
    )
    expect(result.candidate.profile?.tools).toEqual({ Bash: true })
    expect(measuredWinner).toBeDefined()
    expect(result.candidate.profile).toBe(measuredWinner)
    expect(observed.every((candidate) => Object.isFrozen(candidate))).toBe(true)
    expect(observed.every((candidate) => Object.isFrozen(candidate.prompt))).toBe(true)
    expect(observed.every((candidate) => Object.isFrozen(candidate.tools))).toBe(true)
  })

  it('holds an apparent win when any run cost is incompletely accounted', async () => {
    const method = fixedMethod('improved prompt')
    method.optimize = async () => ({
      winnerSurface: 'improved prompt',
      cost: {
        totalCostUsd: 0,
        accountingComplete: false,
        incompleteReasons: ['optimizer model cost unavailable'],
      },
    })

    const result = await improve(promptProfile(), methodOptions(method))

    expect(result.liftInterval.low).toBeGreaterThan(0)
    expect(result.cost.accountingComplete).toBe(false)
    expect(result.decision).toBe('hold')
  })

  it('rejects method-reported spend above the configured total limit', async () => {
    let agentCalls = 0
    const method = fixedMethod('improved prompt')
    method.optimize = async () => ({
      winnerSurface: 'improved prompt',
      cost: {
        totalCostUsd: 2,
        accountingComplete: true,
        incompleteReasons: [],
      },
    })

    await expect(
      improve(promptProfile(), {
        ...methodOptions(method),
        costCeiling: 1,
        agent: async (candidate, scenario, context) => {
          agentCalls += 1
          return paidProfile(candidate, scenario, context)
        },
      }),
    ).rejects.toThrow(/reported cost \$2 above costCeiling \$1; refusing final scoring/)
    expect(agentCalls).toBe(0)
  })

  it('rejects an invalid method and malformed profile output', async () => {
    await expect(
      improve(promptProfile(), {
        ...methodOptions(null as never),
        method: null as never,
      }),
    ).rejects.toBeInstanceOf(ConfigError)

    await expect(
      improve(promptProfile(), {
        ...methodOptions(fixedMethod('not json')),
        surface: 'agent-profile',
      }),
    ).rejects.toThrow(/not valid JSON/)
  })

  it('requires exact resource identity for skills and curated memory', async () => {
    await expect(
      improve(
        {
          name: 'fixture-agent',
          resources: {
            failOnError: true,
            skills: [{ kind: 'inline', name: 'review', content: 'baseline skill' }],
          },
        },
        {
          ...methodOptions(fixedMethod('improved skill')),
          surface: 'skills',
        },
      ),
    ).rejects.toThrow(/requires opts\.skills\.resourceName/)

    await expect(
      improve(promptProfile(), {
        ...methodOptions(fixedMethod('improved memory')),
        surface: 'memory',
      }),
    ).rejects.toThrow(/requires profile\.resources\.failOnError/)
  })
})

function createRepo(prefix: string): {
  repoRoot: string
  git(args: string[]): string
  cleanup(): void
} {
  const repoRoot = mkdtempSync(join(tmpdir(), prefix))
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'improve@test.local'])
  git(['config', 'user.name', 'improve-test'])
  writeFileSync(join(repoRoot, 'module.txt'), 'baseline contents\n')
  git(['add', 'module.txt'])
  git(['commit', '-qm', 'baseline'])
  return {
    repoRoot,
    git,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  }
}

function worktreeCount(git: (args: string[]) => string): number {
  return git(['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length ?? 0
}

async function paidCodeText(
  surface: MutableSurface,
  _scenario: TestScenario,
  ctx: DispatchContext,
): Promise<TextArtifact> {
  if (typeof surface !== 'object' || surface === null || !('worktreeRef' in surface)) {
    throw new Error('expected a code surface')
  }
  return paidArtifact(
    readFileSync(join(String(surface.worktreeRef), 'module.txt'), 'utf8'),
    _scenario,
    ctx,
  )
}

describe('improve code execution', () => {
  it('runs candidate generation in isolated worktrees and retains only the winner', async () => {
    const repo = createRepo('improve-code-')
    try {
      let generatorCalls = 0
      const result = await improve({
        surface: 'code',
        findings: [{ claim: 'module.txt is stale' }],
        scenarios: allScenarios,
        judge: improvementJudge,
        agent: paidCodeText,
        code: {
          repoRoot: repo.repoRoot,
          generator: {
            kind: 'test-generator',
            async generate({ worktreePath }: { worktreePath: string }) {
              generatorCalls += 1
              writeFileSync(join(worktreePath, 'module.txt'), 'improved contents\n')
              return { applied: true, summary: 'updated module' }
            },
          },
        },
        promotionGate: {
          name: 'retain-test-winner',
          decide: async () => ({
            decision: 'hold' as const,
            reasons: ['exercise detached candidate retention'],
            contributingGates: [],
          }),
        },
        budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
      })

      expect(generatorCalls).toBe(1)
      expect(result.mode).toBe('code')
      expect(result.candidate.profile).toBeUndefined()
      expect(typeof result.candidate.value).toBe('object')
      if (typeof result.candidate.value === 'string' || result.candidate.value.kind !== 'code') {
        throw new Error('expected code surface')
      }
      expect(readFileSync(join(result.candidate.value.worktreeRef, 'module.txt'), 'utf8')).toBe(
        'improved contents\n',
      )
      expect(worktreeCount(repo.git)).toBe(2)
      await result.dispose()
      await result.dispose()
      expect(worktreeCount(repo.git)).toBe(1)
    } finally {
      repo.cleanup()
    }
  })

  it('retains and disposes the incumbent for a baseline-only code run', async () => {
    const repo = createRepo('improve-code-baseline-')
    try {
      const result = await improve({
        surface: 'code',
        gate: 'none',
        scenarios: allScenarios,
        judge: improvementJudge,
        agent: paidCodeText,
        code: {
          repoRoot: repo.repoRoot,
          generator: {
            kind: 'must-not-run',
            async generate() {
              throw new Error('baseline-only run must not generate')
            },
          },
        },
      })

      expect(result.decision).toBe('hold')
      if (typeof result.candidate.value === 'string' || result.candidate.value.kind !== 'code') {
        throw new Error('expected code surface')
      }
      expect(readFileSync(join(result.candidate.value.worktreeRef, 'module.txt'), 'utf8')).toBe(
        'baseline contents\n',
      )
      expect(worktreeCount(repo.git)).toBe(2)
      await result.dispose()
      expect(worktreeCount(repo.git)).toBe(1)
    } finally {
      repo.cleanup()
    }
  })

  it('cleans every worktree when candidate generation fails', async () => {
    const repo = createRepo('improve-code-reject-')
    try {
      await expect(
        improve({
          surface: 'code',
          scenarios: allScenarios,
          judge: improvementJudge,
          agent: paidCodeText,
          code: {
            repoRoot: repo.repoRoot,
            generator: {
              kind: 'rejecting-generator',
              async generate() {
                throw new Error('candidate generation failed')
              },
            },
          },
          budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
        }),
      ).rejects.toThrow(/candidate generation failed/)
      expect(worktreeCount(repo.git)).toBe(1)
    } finally {
      repo.cleanup()
    }
  })

  it('cleans the incumbent when baseline finalization fails', async () => {
    const repo = createRepo('improve-code-finalize-')
    try {
      const realWorktree = gitWorktreeAdapter({ repoRoot: repo.repoRoot })
      let discarded = 0
      const rejectingWorktree: WorktreeAdapter = {
        ...realWorktree,
        async finalize() {
          throw new Error('baseline finalization failed')
        },
        async discard(worktree: Worktree) {
          discarded += 1
          await realWorktree.discard(worktree)
        },
      }

      await expect(
        improve({
          surface: 'code',
          scenarios: allScenarios,
          judge: improvementJudge,
          agent: paidCodeText,
          code: {
            repoRoot: repo.repoRoot,
            worktree: rejectingWorktree,
            generator: {
              kind: 'unused',
              async generate() {
                throw new Error('must not generate')
              },
            },
          },
        }),
      ).rejects.toThrow(/baseline finalization failed/)
      expect(discarded).toBe(1)
      expect(worktreeCount(repo.git)).toBe(1)
    } finally {
      repo.cleanup()
    }
  })
})
