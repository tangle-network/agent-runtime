import { CostLedger } from '@tangle-network/agent-eval'
import type { CampaignCostMeter, DispatchContext } from '@tangle-network/agent-eval/campaign'
import type { AgentProfile as SandboxAgentProfile } from '@tangle-network/agent-interface'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  loopCampaignDispatch,
  loopDispatch,
  type OutputAdapter,
  superviseDispatch,
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

const sandboxProfile: SandboxAgentProfile = {
  name: 'stub',
  harness: 'opencode',
  model: { provider: 'offline', default: 'm' },
}

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
  it('runs a Runtime cell inside a plain runCampaign paid call', async () => {
    const sandboxClient = stubClient([
      { type: 'llm_call', data: { tokensIn: 120, tokensOut: 40, costUsd: 0.015, model: 'm' } },
      { type: 'result', data: { attempt: 3 } },
    ])
    const dispatch = loopCampaignDispatch<Task, Output, 'stop', FakeScenario, Output>({
      sandboxClient,
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

  it('runs a profile cell inside Eval billing and returns its winner and trace', async () => {
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

  it('settles partial terminal usage when a sandbox stream fails after spending', async () => {
    const dispatch = loopCampaignDispatch<Task, Output, 'stop', FakeScenario, Output>({
      sandboxClient: {
        async create() {
          return {
            async *streamPrompt() {
              yield {
                type: 'llm_call',
                data: { tokensIn: 33, tokensOut: 7, costUsd: 0.004, model: 'm' },
              } as SandboxEvent
              throw new Error('sandbox stream failed')
            },
          } as unknown as SandboxInstance
        },
      },
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

  it('refuses unbounded capped spend before creating a sandbox', async () => {
    let creates = 0
    const dispatch = loopCampaignDispatch<Task, Output, 'stop', FakeScenario, Output>({
      sandboxClient: {
        async create() {
          creates += 1
          throw new Error('must not dispatch')
        },
      },
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
    const dispatch = loopCampaignDispatch<Task, Output, 'stop', FakeScenario, Output>({
      sandboxClient: {
        async create() {
          creates += 1
          return stubClient([
            { type: 'llm_call', data: { tokensIn: 10, tokensOut: 5, costUsd: 0.01 } },
            { type: 'result', data: { attempt: 1 } },
          ]).create()
        },
      },
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

describe('superviseDispatch', () => {
  it('runs a recursive supervisor inside Eval billing, preserves cache classes, and passes maxTurns through', async () => {
    let calls = 0
    const dispatch = superviseDispatch<FakeScenario, { answer: number }>({
      toTask: (scenario) => ({ goal: scenario.id }),
      toSuperviseOptions: () => ({
        budget: { maxIterations: 100, maxTokens: 10_000 },
        // Zero is Runtime's uncapped-turn setting. The adapter must not substitute its own cap.
        maxTurns: 0,
        makeWorkerAgent: () => ({ name: 'unused', act: async () => ({}) }),
        deliverable: {
          check: (value) => (value as { answer?: unknown }).answer === 42,
          describe: 'an answer of 42',
        },
        router: {
          routerBaseUrl: 'http://offline.test/v1',
          routerKey: 'test',
          complete: async (body) => {
            calls += 1
            return {
              model: body.model,
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: `submit-${calls}`,
                        function: {
                          name: 'submit_result',
                          arguments: JSON.stringify({ result: { answer: calls === 18 ? 42 : 0 } }),
                        },
                      },
                    ],
                  },
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 1,
                prompt_cache: { read_tokens: 7, write_tokens: 0 },
              },
            }
          },
        },
      }),
    })
    const fake = fakeDispatchContext()

    const artifact = await dispatch(
      {
        name: 'recursive-root',
        harness: 'cli-base',
        model: { provider: 'offline', default: 'test-model' },
      },
      { id: 'recursive', kind: 'task' },
      fake.ctx,
    )

    expect(artifact).toEqual({ answer: 42 })
    expect(calls).toBe(18)
    expect(fake.ledger.list()).toEqual([
      expect.objectContaining({
        actor: 'supervise',
        model: 'test-model',
        inputTokens: 54,
        cachedTokens: 126,
        cacheWriteTokens: 0,
        outputTokens: 18,
      }),
    ])
  })

  it('leaves a partial cache split unknown instead of pricing omitted classes as zero', async () => {
    const dispatch = superviseDispatch<FakeScenario, { answer: number }>({
      toTask: (scenario) => ({ goal: scenario.id }),
      toSuperviseOptions: () => ({
        budget: { maxIterations: 10, maxTokens: 1_000 },
        makeWorkerAgent: () => ({ name: 'unused', act: async () => ({}) }),
        deliverable: {
          check: (value) => (value as { answer?: unknown }).answer === 42,
          describe: 'an answer of 42',
        },
        router: {
          routerBaseUrl: 'http://offline.test/v1',
          routerKey: 'test',
          complete: async (body) => ({
            model: body.model,
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'submit',
                      function: {
                        name: 'submit_result',
                        arguments: JSON.stringify({ result: { answer: 42 } }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 1,
              prompt_cache: { read_tokens: 7 },
            },
          }),
        },
      }),
    })
    const fake = fakeDispatchContext()

    await dispatch(
      {
        name: 'partial-cache-root',
        harness: 'cli-base',
        model: { provider: 'offline', default: 'test-model' },
      },
      { id: 'partial-cache', kind: 'task' },
      fake.ctx,
    )

    const receipt = fake.ledger.list()[0]
    expect(receipt).toMatchObject({ inputTokens: 10, outputTokens: 1 })
    expect(receipt).not.toHaveProperty('cachedTokens')
    expect(receipt).not.toHaveProperty('cacheWriteTokens')
  })

  it('leaves a mixed cache and unclassified tree unknown', async () => {
    let calls = 0
    const dispatch = superviseDispatch<FakeScenario, { answer: number }>({
      toTask: (scenario) => ({ goal: scenario.id }),
      toSuperviseOptions: () => ({
        budget: { maxIterations: 10, maxTokens: 1_000 },
        maxTurns: 2,
        makeWorkerAgent: () => ({ name: 'unused', act: async () => ({}) }),
        deliverable: {
          check: (value) => (value as { answer?: unknown }).answer === 42,
          describe: 'an answer of 42',
        },
        router: {
          routerBaseUrl: 'http://offline.test/v1',
          routerKey: 'test',
          complete: async (body) => {
            calls += 1
            return {
              model: body.model,
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: `submit-${calls}`,
                        function: {
                          name: 'submit_result',
                          arguments: JSON.stringify({ result: { answer: calls === 2 ? 42 : 0 } }),
                        },
                      },
                    ],
                  },
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 1,
                ...(calls === 1 ? { prompt_cache: { read_tokens: 7, write_tokens: 0 } } : {}),
              },
            }
          },
        },
      }),
    })
    const fake = fakeDispatchContext()

    await dispatch(
      {
        name: 'mixed-cache-root',
        harness: 'cli-base',
        model: { provider: 'offline', default: 'test-model' },
      },
      { id: 'mixed-cache', kind: 'task' },
      fake.ctx,
    )

    const receipt = fake.ledger.list()[0]
    expect(receipt).toMatchObject({ inputTokens: 20, outputTokens: 2 })
    expect(receipt).not.toHaveProperty('cachedTokens')
    expect(receipt).not.toHaveProperty('cacheWriteTokens')
  })

  it('marks a supervised provider turn with no usage receipt as incomplete', async () => {
    const dispatch = superviseDispatch<FakeScenario, { answer: number }>({
      toTask: (scenario) => ({ goal: scenario.id }),
      toSuperviseOptions: () => ({
        budget: { maxIterations: 10, maxTokens: 1_000 },
        makeWorkerAgent: () => ({ name: 'unused', act: async () => ({}) }),
        deliverable: {
          check: (value) => (value as { answer?: unknown }).answer === 42,
          describe: 'an answer of 42',
        },
        router: {
          routerBaseUrl: 'http://offline.test/v1',
          routerKey: 'test',
          complete: async (body) => ({
            model: body.model,
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'submit',
                      function: {
                        name: 'submit_result',
                        arguments: JSON.stringify({ result: { answer: 42 } }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      }),
    })
    const fake = fakeDispatchContext()

    await dispatch(
      {
        name: 'unknown-usage-root',
        harness: 'cli-base',
        model: { provider: 'offline', default: 'test-model' },
      },
      { id: 'unknown-usage', kind: 'task' },
      fake.ctx,
    )

    expect(fake.ledger.list()).toEqual([
      expect.objectContaining({ inputTokens: 0, outputTokens: 0, usageUnknown: true }),
    ])
  })

  it('records a no-winner tree before the default artifact mapping fails', async () => {
    const dispatch = superviseDispatch<FakeScenario, { answer: number }>({
      toTask: (scenario) => ({ goal: scenario.id }),
      toSuperviseOptions: () => ({
        budget: { maxIterations: 10, maxTokens: 1_000 },
        maxTurns: 1,
        makeWorkerAgent: () => ({ name: 'unused', act: async () => ({}) }),
        router: {
          routerBaseUrl: 'http://offline.test/v1',
          routerKey: 'test',
          complete: async (body) => ({
            model: body.model,
            choices: [{ message: { content: 'no deliverable' } }],
            usage: { prompt_tokens: 4, completion_tokens: 2 },
          }),
        },
      }),
    })
    const fake = fakeDispatchContext()

    await expect(
      dispatch(
        {
          name: 'no-winner-root',
          harness: 'cli-base',
          model: { provider: 'offline', default: 'test-model' },
        },
        { id: 'no-winner', kind: 'task' },
        fake.ctx,
      ),
    ).rejects.toThrow(/supervised tree ended without a winner/u)
    expect(fake.ledger.list()).toEqual([
      expect.objectContaining({ inputTokens: 4, outputTokens: 2 }),
    ])
  })

  it('refuses to flatten a GLM root and DeepSeek child into one Eval model receipt', async () => {
    const servedModels: string[] = []
    let rootTurns = 0
    const complete = async (body: Record<string, unknown>) => {
      const model = String(body.model)
      servedModels.push(model)
      if (model === 'deepseek-v4-flash') {
        return {
          model,
          choices: [{ message: { content: 'child result' } }],
          usage: { prompt_tokens: 6, completion_tokens: 2, cost_usd: 0.002 },
        }
      }

      rootTurns += 1
      if (rootTurns === 1) {
        return {
          model,
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'spawn-deepseek',
                    function: {
                      name: 'spawn_agent',
                      arguments: JSON.stringify({
                        profile: {
                          name: 'deepseek-child',
                          harness: 'cli-base',
                          model: { provider: 'deepseek', default: 'deepseek-v4-flash' },
                        },
                        task: 'return the child result',
                      }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 1, cost_usd: 0.01 },
        }
      }
      if (rootTurns === 2) {
        return {
          model,
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'await-child', function: { name: 'await_event', arguments: '{}' } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 1, cost_usd: 0.01 },
        }
      }
      return {
        model,
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'submit-root',
                  function: {
                    name: 'submit_result',
                    arguments: JSON.stringify({ result: { answer: 42 } }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 1, cost_usd: 0.01 },
      }
    }
    const dispatch = superviseDispatch<FakeScenario, { answer: number }>({
      toTask: (scenario) => ({ goal: scenario.id }),
      toSuperviseOptions: () => ({
        budget: { maxIterations: 20, maxTokens: 10_000 },
        perWorker: { maxIterations: 4, maxTokens: 1_000 },
        maxTurns: 5,
        backend: {
          backend: 'router',
          routerBaseUrl: 'http://offline.test/v1',
          routerKey: 'test',
          complete,
        },
        deliverable: {
          check: (value) =>
            (value as { answer?: unknown; content?: unknown }).answer === 42 ||
            (value as { answer?: unknown; content?: unknown }).content === 'child result',
          describe: 'the root answer or checked child result',
        },
        router: {
          routerBaseUrl: 'http://offline.test/v1',
          routerKey: 'test',
          complete,
        },
      }),
    })
    const fake = fakeDispatchContext()

    await expect(
      dispatch(
        {
          name: 'glm-root',
          harness: 'cli-base',
          model: { provider: 'zai', default: 'glm-root' },
        },
        { id: 'mixed-model', kind: 'task' },
        fake.ctx,
      ),
    ).rejects.toThrow(
      /cannot settle one Eval paid-call receipt for a tree with multiple models \(deepseek-v4-flash, glm-root\)/u,
    )
    expect(servedModels).toContain('glm-root')
    expect(servedModels).toContain('deepseek-v4-flash')
    expect(fake.ledger.list()).toEqual([
      expect.objectContaining({
        model: 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        usageUnknown: true,
        costUnknown: true,
      }),
    ])
  })
})
