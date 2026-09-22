import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import {
  type CompletionAnalyst,
  type CompletionVerdict,
  completionAuthorizes,
  deterministicCompletion,
  sentinelCompletion,
  stopSentinel,
} from '../../src/runtime/completion'
import { runAgentRounds } from '../../src/runtime/run-loop'
import type { AgentRunSpec, OutputAdapter, Validator } from '../../src/runtime/types'
import { type ScriptedPlanner, scriptedDriver } from './refine-driver'

const output: OutputAdapter<string> = {
  parse(events) {
    let a = ''
    for (const ev of events) {
      const d = ev?.data as { answer?: unknown } | undefined
      if (typeof d?.answer === 'string') a = d.answer
    }
    return a
  },
}
// Always invalid so only the completion analyst can stop the loop.
const validator: Validator<string> = {
  async validate() {
    return { valid: false, score: 0 }
  },
}
const agentRuns: AgentRunSpec<string>[] = [
  { profile: { name: 'a' }, name: 'a', taskToPrompt: (t) => t },
]
function echoProvider(): AgentEnvironmentProvider {
  let sequence = 0
  return {
    name: 'echo',
    capabilities() {
      throw new Error('capabilities are not used without lineage')
    },
    async create(): Promise<AgentEnvironment> {
      return {
        id: `echo-${sequence++}`,
        provider: 'echo',
        async status() {
          return 'running'
        },
        async *stream(input) {
          yield {
            type: 'result',
            data: { answer: input.prompt ?? '' },
          } satisfies AgentEnvironmentEvent
        },
      }
    },
  }
}
// A planner that NEVER stops itself — only the completion analyst can end the loop.
const alwaysRefine: ScriptedPlanner<string, string> = () => ({ kind: 'refine', task: 'good' })

const run = (complete?: CompletionAnalyst<string, string>) =>
  runAgentRounds<string, string, 'continue' | 'done'>({
    driver: scriptedDriver<string, string>({
      planner: alwaysRefine,
      maxIterations: 5,
      ...(complete ? { complete } : {}),
    }),
    agentRuns,
    output,
    validator,
    task: 'start',
    ctx: { environmentProvider: echoProvider() },
    maxIterations: 5,
  })

describe('completion — authorization policy', () => {
  it('trusts deterministic, validates probabilistic by threshold', () => {
    const det = (done: boolean): CompletionVerdict => ({ done, determinism: 'deterministic' })
    const prob = (c: number): CompletionVerdict => ({
      done: true,
      determinism: 'probabilistic',
      confidence: c,
    })
    expect(completionAuthorizes(det(true))).toBe(true) // ground truth → trust
    expect(completionAuthorizes(det(false))).toBe(false)
    expect(completionAuthorizes(prob(0.9))).toBe(true) // ≥ default 0.8
    expect(completionAuthorizes(prob(0.5))).toBe(false) // below → driver does NOT end
    expect(completionAuthorizes(prob(0.5), { minConfidence: 0.4 })).toBe(true)
  })

  it('stopSentinel is unique-per-seed and deterministic', () => {
    expect(stopSentinel('node-a')).toBe(stopSentinel('node-a'))
    expect(stopSentinel('node-a')).not.toBe(stopSentinel('node-b'))
    expect(stopSentinel('x')).toMatch(/^<<<\{\{STOP:[0-9a-f]{8}\}\}>>>$/)
  })

  it('sentinelCompletion fires only when the latest output carries the sentinel', () => {
    const sent = stopSentinel('n')
    const ca = sentinelCompletion<string>(sent)
    const hist = (out: string) => [{ index: 0, output: out }] as never
    const hit = ca.assess({ task: 'q', history: hist(`done ${sent}`) }) as CompletionVerdict
    const miss = ca.assess({ task: 'q', history: hist('no sentinel here') }) as CompletionVerdict
    expect(hit.done).toBe(true)
    expect(hit.determinism).toBe('probabilistic') // agent self-judgment → driver validates
    expect(miss.done).toBe(false)
  })
})

describe('completion drives the deployable stop through the real kernel', () => {
  it('without a completion analyst, the never-stopping planner runs to the iteration cap', async () => {
    const r = await run(undefined)
    expect(r.iterations).toHaveLength(5) // hit maxIterations — nothing else stops it
  })

  it('a deterministic completion analyst ends the loop the round after the check passes', async () => {
    const complete = deterministicCompletion<string, string>((out) => ({
      passed: out === 'good',
      reasons: 'output reached good',
    }))
    const r = await run(complete)
    expect(r.decision).toBe('done')
    expect(r.iterations).toHaveLength(1) // round 0 produced 'good'; round 1's plan() stops on completion
    expect(r.winner?.output).toBe('good')
  })
})
