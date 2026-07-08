import {
  gepaProposer,
  runImprovementLoop,
  runOptimization,
  skillOptProposer,
} from '@tangle-network/agent-eval/campaign'
import type {
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  Scenario,
  SurfaceProposer,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../src/durable/spawn-journal'
import { improve } from '../src/improvement'
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

const baseProfile = (): AgentProfile => ({
  name: 'incident-responder',
  prompt: { systemPrompt: 'Handle the task directly.' },
})

const improvingProposer: SurfaceProposer = {
  kind: 'scripted-gepa-slot',
  async propose() {
    return [
      {
        surface:
          'Handle the task directly.\n\nREPAIR_ON_FAILURE: after a failed draft, revise once using the failure signal.',
        label: 'repair-on-failure',
        rationale: 'Add the missing retry policy as a profile instruction.',
      },
    ]
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
  surface: MutableSurface,
  _scenario: ProfileScenario,
  ctx: DispatchContext,
): Promise<{ prompt: string }> {
  ctx.cost.observe(0.0001, 'profile-stack-test')
  ctx.cost.observeTokens({ input: 1, output: 1 })
  return { prompt: String(surface) }
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

describe('profile improvement stack — agent-eval optimizer plus runtime loop', () => {
  it('uses current agent-eval optimizer exports instead of local mutators', () => {
    expect(typeof gepaProposer).toBe('function')
    expect(typeof skillOptProposer).toBe('function')
    expect(typeof runOptimization).toBe('function')
    expect(typeof runImprovementLoop).toBe('function')
  })

  it('promotes a profile surface through improve(), then runs the promoted profile through loopUntil()', async () => {
    const improved = await improve(baseProfile(), [{ failure: 'single draft gets stuck' }], {
      surface: 'prompt',
      scenarios,
      judge: promptJudge,
      agent: promptAgent,
      generator: improvingProposer,
      budget: { generations: 1, populationSize: 1, reps: 3, holdoutFraction: 0.5 },
    })

    expect(improved.shipped).toBe(true)
    expect(improved.profile.prompt?.systemPrompt).toContain('REPAIR_ON_FAILURE')

    const seen: SpawnSeen[] = []
    const persona = definePersona<LoopDeliverable>({
      name: 'profile-loop-proof',
      root: { profile: improved.profile, harness: null },
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
