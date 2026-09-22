import { CostLedger } from '@tangle-network/agent-eval'
import type { CampaignCostMeter, DispatchContext } from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { loopCampaignDispatch, loopDispatch } from '../../src/runtime/loop-dispatch'
import type { AgentRunSpec, OutputAdapter, Validator } from '../../src/runtime/types'
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

const agentProfile: AgentProfile = { name: 'stub', model: { default: 'm' } }

function spec(): AgentRunSpec<Task> {
  return { profile: agentProfile, name: 'agent', taskToPrompt: (task) => task.goal }
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

function stubProvider(
  events: AgentEnvironmentEvent[],
  options: { afterStream?: Error; onCreate?: () => void } = {},
): AgentEnvironmentProvider {
  let sequence = 0
  return {
    name: 'stub-provider',
    capabilities() {
      throw new Error('capabilities are not used without lineage')
    },
    async create() {
      options.onCreate?.()
      const id = `environment-${sequence++}`
      return {
        id,
        provider: 'stub-provider',
        async status() {
          return 'running'
        },
        async *stream() {
          for (const event of events) yield event
          if (options.afterStream) throw options.afterStream
        },
        async destroy() {},
      }
    },
  }
}

/** Minimal campaign DispatchContext that records what the dispatch reports. */
function fakeDispatchContext(costCeilingUsd?: number): {
  ctx: DispatchContext
  ledger: CostLedger
  spans: string[]
} {
  const ledger = new CostLedger(costCeilingUsd === undefined ? {} : { costCeilingUsd })
  const spans: string[] = []
  const cost: CampaignCostMeter = {
    runPaidCall(input) {
      return ledger.runPaidCall({
        ...input,
        channel: input.channel ?? 'agent',
        phase: 'test-cell',
        tags: { cellId: 'cell-0' },
      })
    },
  }
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
    cost,
  }
  return { ctx, ledger, spans }
}

describe('loopDispatch', () => {
  it('bridges runAgentRounds into a plain runCampaign DispatchFn for fixture-style scenarios', async () => {
    const environmentProvider = stubProvider([
      { type: 'llm_call', data: { tokensIn: 120, tokensOut: 40, costUsd: 0.015, model: 'm' } },
      { type: 'result', data: { attempt: 3 } },
    ])
    const dispatch = loopCampaignDispatch<Task, Output, 'continue' | 'stop', FakeScenario, Output>({
      environmentProvider,
      toLoopOptions: (scenario) => ({
        driver: refineDriver<Task, Output>(),
        agentRun: spec(),
        output,
        validator: passAlways,
        task: { goal: `fixture:${scenario.id}` },
        maxIterations: 1,
      }),
    })

    const fake = fakeDispatchContext()
    const artifact = await dispatch({ id: 'fixture-a', kind: 'eval-fixture' }, fake.ctx)

    expect(artifact).toEqual({ attempt: 3 })
    expect(fake.ledger.list()).toEqual([
      expect.objectContaining({
        channel: 'agent',
        phase: 'test-cell',
        actor: 'loop',
        model: 'm',
        inputTokens: 120,
        outputTokens: 40,
        actualCostUsd: 0.015,
        costUsd: 0.015,
      }),
    ])
    expect(fake.spans).toContain('loop.started')
    expect(fake.spans).toContain('loop.ended')
  })

  it('bridges runAgentRounds into a ProfileDispatchFn: returns the winner artifact, reports usage, forwards trace', async () => {
    const environmentProvider = stubProvider([
      { type: 'llm_call', data: { tokensIn: 150, tokensOut: 60, costUsd: 0.02, model: 'm' } },
      { type: 'result', data: { attempt: 2 } },
    ])
    const dispatch = loopDispatch<Task, Output, 'continue' | 'stop', FakeScenario, Output>({
      environmentProvider,
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
    const profile = { name: 'baseline', model: { default: 'test-model@2025-01-01' } }
    const artifact = await dispatch(profile, { id: 's1', kind: 'task' }, fake.ctx)

    // Returns the loop's winner output.
    expect(artifact).toEqual({ attempt: 2 })
    // Usage reported to the campaign cost meter — the integrity guard's input.
    expect(fake.ledger.list()).toEqual([
      expect.objectContaining({
        actor: 'loop',
        model: 'test-model@2025-01-01',
        inputTokens: 150,
        outputTokens: 60,
        actualCostUsd: 0.02,
        costUsd: 0.02,
      }),
    ])
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
    const environmentProvider = stubProvider([
      { type: 'llm_call', data: { tokensIn: 90, tokensOut: 20, costUsd: 0.01, model: 'm' } },
      { type: 'result', data: { attempt: 1 } },
    ])
    const dispatch = loopDispatch<Task, Output, 'continue' | 'stop', FakeScenario, Output>({
      environmentProvider,
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
    await dispatch(
      { name: 'p', model: { default: 'm@2025-01-01' } },
      { id: 's1', kind: 'task' },
      fake.ctx,
    )
    // The validator failed, but real LLM activity happened — tokens + cost MUST
    // still reach the cost meter, or the integrity guard would call it a stub.
    expect(fake.ledger.list()).toEqual([
      expect.objectContaining({
        inputTokens: 90,
        outputTokens: 20,
        actualCostUsd: 0.01,
        costUsd: 0.01,
      }),
    ])
  })

  it('settles partial terminal usage when a provider stream fails after spending', async () => {
    const environmentProvider = stubProvider(
      [
        {
          type: 'llm_call',
          data: { tokensIn: 33, tokensOut: 7, costUsd: 0.004, model: 'm' },
        },
      ],
      { afterStream: new Error('provider stream failed') },
    )
    const dispatch = loopCampaignDispatch<Task, Output, 'continue' | 'stop', FakeScenario, Output>({
      environmentProvider,
      toLoopOptions: () => ({
        driver: refineDriver<Task, Output>(),
        agentRun: spec(),
        output,
        task: { goal: 'partial failure' },
        maxIterations: 1,
      }),
    })
    const fake = fakeDispatchContext()

    await expect(dispatch({ id: 'partial', kind: 'task' }, fake.ctx)).resolves.toBeUndefined()
    expect(fake.ledger.list()).toEqual([
      expect.objectContaining({
        inputTokens: 33,
        outputTokens: 7,
        actualCostUsd: 0.004,
        costUsd: 0.004,
      }),
    ])
  })

  it('refuses a capped cell before creating an environment without a hard maximum', async () => {
    let creates = 0
    const environmentProvider = stubProvider([], {
      onCreate: () => {
        creates += 1
      },
    })
    const dispatch = loopCampaignDispatch<Task, Output, 'continue' | 'stop', FakeScenario, Output>({
      environmentProvider,
      toLoopOptions: () => ({
        driver: refineDriver<Task, Output>(),
        agentRun: spec(),
        output,
        task: { goal: 'bounded' },
        maxIterations: 1,
      }),
    })
    const fake = fakeDispatchContext(1)

    await expect(dispatch({ id: 'bounded', kind: 'task' }, fake.ctx)).rejects.toThrow(
      /hard maximumCharge before execution/,
    )
    expect(creates).toBe(0)
    expect(fake.ledger.list()).toHaveLength(0)
  })

  it('admits a capped cell when the executor supplies an enforced maximum', async () => {
    let creates = 0
    const environmentProvider = stubProvider(
      [
        { type: 'llm_call', data: { tokensIn: 10, tokensOut: 5, costUsd: 0.01 } },
        { type: 'result', data: { attempt: 1 } },
      ],
      {
        onCreate: () => {
          creates += 1
        },
      },
    )
    const dispatch = loopCampaignDispatch<Task, Output, 'continue' | 'stop', FakeScenario, Output>({
      environmentProvider,
      maximumCharge: { externallyEnforcedMaximumUsd: 0.02 },
      toLoopOptions: () => ({
        driver: refineDriver<Task, Output>(),
        agentRun: spec(),
        output,
        validator: passAlways,
        task: { goal: 'bounded' },
        maxIterations: 1,
      }),
    })
    const fake = fakeDispatchContext(1)

    await expect(dispatch({ id: 'bounded', kind: 'task' }, fake.ctx)).resolves.toEqual({
      attempt: 1,
    })
    expect(creates).toBe(1)
    expect(fake.ledger.list()).toEqual([
      expect.objectContaining({ maximumCostUsd: 0.02, costUsd: 0.01 }),
    ])
  })
})
