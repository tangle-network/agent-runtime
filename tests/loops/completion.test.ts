import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  type CompletionVerdict,
  completionAuthorizes,
  createDynamicDriver,
  deterministicCompletion,
  type OutputAdapter,
  runLoop,
  sentinelCompletion,
  stopSentinel,
  type TopologyPlanner,
  type Validator,
} from '../../src/loops'

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
// Always-invalid validator: the ORACLE never stops the loop, so any stop is the completion
// analyst's doing (the deployable, non-oracle stop) — not verdict short-circuit.
const validator: Validator<string> = {
  async validate() {
    return { valid: false, score: 0 }
  },
}
const agentRuns: AgentRunSpec<string>[] = [
  { profile: { name: 'a' }, name: 'a', taskToPrompt: (t) => t },
]
function echoClient() {
  return {
    async create(_o?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        async *streamPrompt(message: string) {
          yield { type: 'result', data: { answer: message } } satisfies SandboxEvent
        },
      } as unknown as SandboxInstance
    },
  }
}
// A planner that NEVER stops itself — only the completion analyst can end the loop.
const alwaysRefine: TopologyPlanner<string, string> = () => ({ kind: 'refine', task: 'good' })

const run = (complete?: Parameters<typeof createDynamicDriver<string, string>>[0]['complete']) =>
  runLoop<string, string, 'continue' | 'done'>({
    driver: createDynamicDriver<string, string>({
      planner: alwaysRefine,
      maxIterations: 5,
      complete,
    }),
    agentRuns,
    output,
    validator,
    task: 'start',
    ctx: { sandboxClient: echoClient() },
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
