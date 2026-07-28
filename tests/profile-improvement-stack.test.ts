import { makeProposalFinding } from '@tangle-network/agent-eval'
import {
  gepaOptimizationMethod,
  inMemoryCampaignStorage,
  type OptimizationMethod,
  skillOptOptimizationMethod,
} from '@tangle-network/agent-eval/campaign'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../src/durable/spawn-journal'
import * as runtimeImprovement from '../src/improvement'
import { improve, officialGepa, officialSkillOpt } from '../src/improvement'
import type { ReadonlyAgentProfile } from '../src/improvement/profile-types'
import { loopUntil } from '../src/runtime/personify/combinators'
import { definePersona, runPersonified } from '../src/runtime/personify/persona'
import type { Outcome } from '../src/runtime/personify/wave-types'
import { createExecutorRegistry } from '../src/runtime/supervise/runtime'
import type {
  AgentSpec,
  DefaultVerdict,
  Executor,
  ExecutorResult,
  Settled,
  UsageEvent,
} from '../src/runtime/supervise/types'

interface ProfileScenario extends Scenario {
  kind: 'profile-stack'
}

const scenarios: ProfileScenario[] = Array.from({ length: 12 }, (_, i) => ({
  id: `profile-${i}`,
  kind: 'profile-stack' as const,
}))
const trainScenarios = scenarios.slice(0, 4)
const selectionScenarios = scenarios.slice(4, 8)
const testScenarios = scenarios.slice(8)
const executionRef = canonicalCandidateDigest({ fixture: 'profile-improvement-stack' })

const baseProfile = (): AgentProfile => ({
  name: 'incident-responder',
  prompt: { systemPrompt: 'Handle the task directly.' },
})

const improvingMethod: OptimizationMethod<ProfileScenario, { prompt: string }> = {
  name: 'scripted-complete-method',
  async optimize() {
    return {
      winnerSurface:
        'Handle the task directly.\n\nREPAIR_ON_FAILURE: after a failed draft, revise once using the failure signal.',
      cost: { totalCostUsd: 0, accountingComplete: true, incompleteReasons: [] },
    }
  },
}

const promptJudge: JudgeConfig<{ prompt: string }, ProfileScenario> = {
  name: 'prompt-has-repair-policy',
  dimensions: [{ key: 'repair_policy', description: 'Prompt contains the repair policy.' }],
  score: ({ artifact }) => {
    const composite = artifact.prompt.includes('REPAIR_ON_FAILURE') ? 1 : 0
    return { dimensions: { repair_policy: composite }, composite, notes: '' }
  },
}

async function promptAgent(
  profile: ReadonlyAgentProfile,
  _scenario: ProfileScenario,
  ctx: DispatchContext,
): Promise<{ prompt: string }> {
  const paid = await ctx.cost.runPaidCall({
    channel: 'agent',
    actor: 'profile-stack-test',
    model: 'deterministic-test@2026-07-01',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => ({ prompt: profile.prompt?.systemPrompt ?? '' }),
    receipt: () => ({
      model: 'deterministic-test@2026-07-01',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

interface LoopTask {
  readonly issue: string
}

interface LoopState {
  readonly latestAnswer: string | null
  readonly attempts: number
}

interface LoopDeliverable {
  readonly finalAnswer: string
  readonly attempts: number
}

interface SpawnSeen {
  readonly round: number
  readonly prompt: string
  readonly answer: string
}

function profileAwareRegistry(seen: SpawnSeen[]) {
  const base = createExecutorRegistry()
  return {
    register: base.register.bind(base),
    resolve<Out>(spec: AgentSpec) {
      if (!spec.executor && spec.harness === null) {
        const prompt = spec.profile.prompt?.systemPrompt ?? ''
        return {
          succeeded: true as const,
          value: (): Executor<Out> => profileLoopExecutor(prompt, seen) as Executor<Out>,
        }
      }
      return base.resolve<Out>(spec)
    },
  }
}

function profileLoopExecutor(prompt: string, seen: SpawnSeen[]): Executor<unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: 'router',
    execute(task: unknown): AsyncIterable<UsageEvent> {
      return (async function* () {
        const round =
          task && typeof task === 'object' && 'round' in task
            ? Number((task as { round: unknown }).round)
            : 0
        const canRepair = prompt.includes('REPAIR_ON_FAILURE')
        const answer = canRepair && round >= 1 ? 'fixed' : 'draft'
        const verdict: DefaultVerdict = {
          valid: answer === 'fixed',
          score: answer === 'fixed' ? 1 : 0.2,
        }
        seen.push({ round, prompt, answer })
        artifact = {
          outRef: `profile-loop:${round}:${answer}`,
          out: { answer, round },
          verdict,
          spent: { iterations: 1, tokens: { input: 4, output: 4 }, usd: 0, ms: 0 },
        }
        yield { kind: 'iteration' }
        yield { kind: 'tokens', input: 4, output: 4 }
      })()
    },
    teardown(): Promise<{ destroyed: boolean }> {
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) throw new Error('profileLoopExecutor: resultArtifact before stream drained')
      return artifact
    },
  }
}

function foldedAnswer(settled: Settled<Outcome<LoopDeliverable>>): string | null {
  if (settled.kind !== 'done') return null
  const out = settled.out as unknown
  if (!out || typeof out !== 'object' || !('answer' in out)) return null
  return String((out as { answer: unknown }).answer)
}

describe('profile improvement stack', () => {
  it('exposes complete official methods without public proposer defaults', () => {
    expect(typeof gepaOptimizationMethod).toBe('function')
    expect(typeof skillOptOptimizationMethod).toBe('function')
    expect(typeof officialGepa).toBe('function')
    expect(typeof officialSkillOpt).toBe('function')
    expect(runtimeImprovement).not.toHaveProperty('improvementDriver')
    expect(runtimeImprovement).not.toHaveProperty('profileDiffProposer')
  })

  it('runs a detached profile candidate through loopUntil()', async () => {
    const improved = await improve(baseProfile(), {
      surface: 'prompt',
      executionRef,
      method: improvingMethod,
      findings: [
        makeProposalFinding({
          analyst_id: 'test',
          proposal_origin: 'production',
          severity: 'medium',
          area: 'rollout',
          claim: 'single draft gets stuck',
          confidence: 1,
          evidence_refs: [],
        }),
      ],
      trainScenarios,
      selectionScenarios,
      testScenarios,
      judges: [promptJudge],
      agent: promptAgent,
      runDir: 'mem://profile-improvement-stack',
      storage: inMemoryCampaignStorage(),
      resamples: 40,
      confidence: 0.95,
    })

    expect(improved.decision).toBe('ship')
    const candidateProfile = improved.candidate.profile
    if (!candidateProfile) throw new Error('expected a profile candidate')
    expect(candidateProfile.prompt?.systemPrompt).toContain('REPAIR_ON_FAILURE')
    expect(baseProfile().prompt?.systemPrompt).not.toContain('REPAIR_ON_FAILURE')

    const seen: SpawnSeen[] = []
    const persona = definePersona<LoopDeliverable>({
      name: 'profile-loop-proof',
      root: { profile: candidateProfile, harness: null },
      directive: 'Run the authored incident-response profile until the issue is fixed.',
      context: { role: 'incident responder' },
      executors: { registry: profileAwareRegistry(seen) },
    })
    const shape = loopUntil<LoopTask, LoopState, LoopDeliverable>(
      { latestAnswer: null, attempts: 0 },
      {
        label: (round) => `repair-attempt:${round}`,
        step: (task, state) => ({
          issue: task.issue,
          round: state.round,
          prior: state.value.latestAnswer,
        }),
        fold: (prior, settled) => ({
          round: prior.round,
          value: {
            latestAnswer: foldedAnswer(settled),
            attempts: prior.value.attempts + 1,
          },
        }),
        until: (state) =>
          state.value.latestAnswer === 'fixed'
            ? {
                kind: 'done',
                deliverable: {
                  finalAnswer: state.value.latestAnswer,
                  attempts: state.value.attempts,
                },
              }
            : null,
      },
    )

    const result = await runPersonified<LoopTask, LoopDeliverable>({
      persona,
      shape,
      task: { issue: 'ticket is still open after first draft' },
      budget: { maxIterations: 4, maxTokens: 1_000 },
      shapeBudget: { fanout: 1, perChild: { maxIterations: 1, maxTokens: 100 } },
      runId: 'profile-improvement-stack-test',
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      now: () => 0,
    })

    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') throw new Error(`expected winner, got ${result.kind}`)
    expect(result.out.kind).toBe('done')
    if (result.out.kind !== 'done') throw new Error('expected loop to finish')
    expect(result.out.deliverable).toEqual({ finalAnswer: 'fixed', attempts: 2 })
    expect(seen.map((entry) => entry.answer)).toEqual(['draft', 'fixed'])
    expect(seen).toHaveLength(2)
    for (const entry of seen) expect(entry.prompt).toContain('REPAIR_ON_FAILURE')
  })
})
