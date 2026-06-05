import type { DispatchContext } from '@tangle-network/agent-eval/campaign'
import type {
  CreateSandboxOptions,
  AgentProfile as SandboxAgentProfile,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  loopDispatch,
  type OutputAdapter,
  type Validator,
} from '../../src/runtime'
import { refineDriver } from './refine-driver'

interface Task {
  goal: string
}
interface Output {
  attempt: number
}
interface FakeScenario {
  id: string
  kind: string
}

const sandboxProfile: SandboxAgentProfile = { name: 'stub' }

function spec(): AgentRunSpec<Task> {
  return { profile: sandboxProfile, name: 'agent', taskToPrompt: (t) => t.goal }
}

const output: OutputAdapter<Output> = {
  parse: (events) => {
    const data = events.at(-1)?.data as { attempt?: number } | undefined
    return { attempt: typeof data?.attempt === 'number' ? data.attempt : -1 }
  },
}

const passAlways: Validator<Output> = {
  async validate(out) {
    return { valid: true, score: 1, scores: { attempt: out.attempt } }
  },
}

function stubClient(events: SandboxEvent[]): {
  create(opts?: CreateSandboxOptions): Promise<SandboxInstance>
} {
  return {
    async create() {
      return {
        async *streamPrompt() {
          for (const e of events) yield e
        },
      } as unknown as SandboxInstance
    },
  }
}

/** Minimal campaign DispatchContext that records what the dispatch reports. */
function fakeDispatchContext(): {
  ctx: DispatchContext
  observed: Array<{ usd: number; src: string }>
  tokens: { input: number; output: number }
  spans: string[]
} {
  const observed: Array<{ usd: number; src: string }> = []
  const tokens = { input: 0, output: 0 }
  const spans: string[] = []
  const ctx: DispatchContext = {
    cellId: 'cell-0',
    rep: 0,
    seed: 1,
    signal: new AbortController().signal,
    trace: {
      span(name: string) {
        spans.push(name)
        return { end() {}, setAttribute() {} }
      },
      async flush() {},
    },
    artifacts: {
      async write() {
        return 'p'
      },
      async writeJson() {
        return 'p'
      },
    },
    cost: {
      observe(usd: number, src: string) {
        observed.push({ usd, src })
      },
      observeTokens(u: { input: number; output: number }) {
        tokens.input += u.input
        tokens.output += u.output
      },
      current() {
        return 0
      },
      tokens() {
        return tokens
      },
    },
  }
  return { ctx, observed, tokens, spans }
}

describe('loopDispatch', () => {
  it('bridges runLoop into a ProfileDispatchFn: returns the winner artifact, reports usage, forwards trace', async () => {
    const sandboxClient = stubClient([
      { type: 'llm_call', data: { tokensIn: 150, tokensOut: 60, costUsd: 0.02, model: 'm' } },
      { type: 'result', data: { attempt: 2 } },
    ])
    const dispatch = loopDispatch<Task, Output, 'stop', FakeScenario, Output>({
      sandboxClient,
      toLoopOptions: (scenario) => ({
        driver: refineDriver<Task, Output>(),
        agentRun: spec(),
        output,
        validator: passAlways,
        task: { goal: scenario.id },
        maxIterations: 1,
      }),
    })

    const fake = fakeDispatchContext()
    const profile = { id: 'baseline', model: 'test-model@2025-01-01' }
    const artifact = await dispatch(profile, { id: 's1', kind: 'task' }, fake.ctx)

    // Returns the loop's winner output.
    expect(artifact).toEqual({ attempt: 2 })
    // Usage reported to the campaign cost meter — the integrity guard's input.
    expect(fake.observed).toEqual([{ usd: 0.02, src: 'loop' }])
    expect(fake.tokens).toEqual({ input: 150, output: 60 })
    // Loop trace events forwarded into the campaign trace as spans.
    expect(fake.spans).toContain('loop.started')
    expect(fake.spans).toContain('loop.ended')
  })

  it('reports usage even when the run fails the validator (real activity must NOT read as a stub)', async () => {
    const failAlways: Validator<Output> = {
      async validate() {
        return { valid: false, score: 0, scores: {}, notes: 'no' }
      },
    }
    const sandboxClient = stubClient([
      { type: 'llm_call', data: { tokensIn: 90, tokensOut: 20, costUsd: 0.01, model: 'm' } },
      { type: 'result', data: { attempt: 1 } },
    ])
    const dispatch = loopDispatch<Task, Output, 'stop', FakeScenario, Output>({
      sandboxClient,
      toLoopOptions: (scenario) => ({
        driver: refineDriver<Task, Output>(),
        agentRun: spec(),
        output,
        validator: failAlways,
        task: { goal: scenario.id },
        maxIterations: 1,
      }),
    })
    const fake = fakeDispatchContext()
    await dispatch({ id: 'p', model: 'm@2025-01-01' }, { id: 's1', kind: 'task' }, fake.ctx)
    // The validator failed, but real LLM activity happened — tokens + cost MUST
    // still reach the cost meter, or the integrity guard would call it a stub.
    expect(fake.tokens).toEqual({ input: 90, output: 20 })
    expect(fake.observed).toEqual([{ usd: 0.01, src: 'loop' }])
  })
})
