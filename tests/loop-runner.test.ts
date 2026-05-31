import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/errors'
import { coderLoopRunner, type DelegatedLoopRegistry, runDelegatedLoop } from '../src/loop-runner'
import type { CoderOutput } from '../src/profiles/coder'

const clock = () => {
  let t = 0
  return () => (t += 100)
}

describe('runDelegatedLoop — mode dispatch', () => {
  it('routes to the registered runner and returns a uniform ok result', async () => {
    const registry: DelegatedLoopRegistry = {
      research: async () => ({ grounded: 3 }),
    }
    const r = await runDelegatedLoop('research', registry, { now: clock() })
    expect(r.mode).toBe('research')
    expect(r.ok).toBe(true)
    expect(r.output).toEqual({ grounded: 3 })
    expect(r.durationMs).toBeGreaterThan(0)
  })

  it('fails loud (ConfigError) on a mode with no registered runner', async () => {
    await expect(runDelegatedLoop('audit', {})).rejects.toThrow(ConfigError)
    await expect(runDelegatedLoop('audit', {})).rejects.toThrow(
      /no runner registered for mode 'audit'/,
    )
  })

  it('captures a thrown engine as ok:false (unattended runs record, not crash)', async () => {
    const registry: DelegatedLoopRegistry = {
      'self-improve': async () => {
        throw new Error('reflection model 502')
      },
    }
    const r = await runDelegatedLoop('self-improve', registry, { now: clock() })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('reflection model 502')
    expect(r.durationMs).toBeGreaterThan(0)
  })
})

describe('coderLoopRunner — code mode over the hardened delegate', () => {
  it('runs the coder delegate and returns its winning CoderOutput', async () => {
    const out: CoderOutput = {
      branch: 'feat/fix',
      patch: 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n+ok\n',
      testResult: { passed: true, output: 'ok' },
      typecheckResult: { passed: true, output: 'ok' },
      diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
    }
    const sandboxClient = {
      async create(_o?: CreateSandboxOptions): Promise<SandboxInstance> {
        return {
          async *streamPrompt() {
            yield { type: 'result', data: { result: out } } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    }
    const runner = coderLoopRunner({
      sandboxClient,
      args: { goal: 'fix x', repoRoot: '/repo' },
    })
    const registry: DelegatedLoopRegistry = { code: runner }
    const r = await runDelegatedLoop<CoderOutput>('code', registry)
    expect(r.ok).toBe(true)
    expect(r.output?.branch).toBe('feat/fix')
  })
})

import { dynamicLoopRunner, researchLoopRunner, type VetoedFact } from '../src/loop-runner'
import type { AgentRunSpec, OutputAdapter, TopologyPlanner, Validator } from '../src/loops'
import type { FactCandidate } from '../src/mcp/kb-gate'

const neverAbort = new AbortController().signal

describe('researchLoopRunner — valid-only KB growth with remediation', () => {
  const grounded: FactCandidate = {
    claim: 'revenue was 100',
    verbatimPassage: 'revenue was 100 in 2025',
    sourceText: 'The filing notes revenue was 100 in 2025.',
  }
  const ungrounded: FactCandidate = {
    claim: 'profit was 50',
    verbatimPassage: 'profit was 50',
    sourceText: 'this source says nothing of the sort',
  }

  it('accepts grounded facts, vetoes ungrounded ones (single round, escalates the veto)', async () => {
    const runner = researchLoopRunner({ research: async () => [grounded, ungrounded] })
    const res = await runner(neverAbort)
    expect(res.rounds).toBe(1)
    expect(res.accepted).toHaveLength(1)
    expect(res.accepted[0]?.claim).toBe('revenue was 100')
    expect(res.vetoed).toHaveLength(1)
    expect(res.vetoed[0]?.vetoedBy).toBe('passage-present')
  })

  it('re-researches vetoed facts next round and accepts once grounded (correct-on-veto)', async () => {
    const research = async (round: number, vetoed: VetoedFact[]): Promise<FactCandidate[]> => {
      if (round === 0) return [grounded, ungrounded]
      // round 1: re-ground the previously-vetoed candidate with a real source
      return vetoed.map((v) => ({
        ...v.candidate,
        sourceText: 'a better source: profit was 50 last year',
      }))
    }
    const runner = researchLoopRunner({ research, maxRounds: 2 })
    const res = await runner(neverAbort)
    expect(res.rounds).toBe(2)
    expect(res.accepted.map((f) => f.claim).sort()).toEqual(['profit was 50', 'revenue was 100'])
    expect(res.vetoed).toHaveLength(0)
  })
})

describe('dynamicLoopRunner — agent-authored topology over runLoop', () => {
  interface T {
    goal: string
  }
  interface O {
    score: number
  }
  it('runs the planner-driven loop and returns a finished LoopResult', async () => {
    const moves = [{ kind: 'refine' as const, task: { goal: 'g' } }, { kind: 'stop' as const }]
    let i = 0
    const planner: TopologyPlanner<T, O> = () => moves[i++]!
    const output: OutputAdapter<O> = {
      parse: (events) => ({ score: (events.at(-1)?.data as { score?: number })?.score ?? 0 }),
    }
    const validator: Validator<O> = {
      async validate(o) {
        return { valid: o.score >= 0.5, score: o.score }
      },
    }
    const spec: AgentRunSpec<T> = {
      profile: { name: 'w' },
      name: 'w',
      taskToPrompt: (t) => t.goal,
    }
    const client = {
      async create() {
        return {
          async *streamPrompt() {
            yield { type: 'result', data: { score: 0.9 } }
          },
        } as unknown as import('@tangle-network/sandbox').SandboxInstance
      },
    }
    const runner = dynamicLoopRunner<T, O>({
      sandboxClient: client,
      planner,
      task: { goal: 'g' },
      output,
      validator,
      agentRun: spec,
    })
    const res = await runner(neverAbort)
    expect(res.decision).toBe('done')
    expect(res.winner?.output.score).toBeCloseTo(0.9, 6)
  })
})
