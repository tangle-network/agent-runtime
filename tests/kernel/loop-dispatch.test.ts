import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CostLedger } from '@tangle-network/agent-eval'
import type { CampaignCostMeter, DispatchContext } from '@tangle-network/agent-eval/campaign'
import { runProfileMatrix } from '@tangle-network/agent-eval/campaign'
import {
  canonicalAgentProfileDigest,
  type AgentProfile as SandboxAgentProfile,
} from '@tangle-network/agent-interface'
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
import { supervisedTreeModelForDispatch } from '../../src/runtime/loop-dispatch'
import type {
  NodeSnapshot,
  ProviderModelExecutionEvidence,
  SupervisedResult,
} from '../../src/runtime/supervise/types'
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
    const data = [...events]
      .reverse()
      .map((event) => event.data as { attempt?: number } | undefined)
      .find((candidate) => typeof candidate?.attempt === 'number')
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
          yield { type: 'done', data: { outcome: { type: 'completed' } } } as SandboxEvent
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

const bridgeRequestDigest = `sha256:${'e'.repeat(64)}`

async function readJsonBody(req: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function submitBridgeResult(body: Record<string, unknown>): Promise<void> {
  const attachments = (body.runtime_attachments as { mcp?: Record<string, { url?: string }> })?.mcp
  const url = attachments?.['agent-runtime-coordination']?.url
  if (!url) throw new Error('bridge test request omitted the Runtime coordination attachment')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'submit-result',
      method: 'tools/call',
      params: { name: 'submit_result', arguments: { result: { answer: 42 } } },
    }),
  })
  if (!response.ok) throw new Error(`bridge test submit_result returned ${response.status}`)
}

function bridgeMaterialization(profileDigest: string, model: string): Record<string, unknown> {
  return {
    schema: 'cli-bridge.profile-materialization.v2',
    effectiveProfileDigest: profileDigest,
    harness: 'pi',
    provider: 'tangle-router',
    model,
    reasoningEffort: { requested: null, applied: null },
    workspacePlanDigest: `sha256:${'f'.repeat(64)}`,
    files: [],
    unsupported: [],
  }
}

async function startPiBridge(
  responseModel: string | undefined | ReadonlyArray<string | undefined>,
  options: { readonly unknownCost?: boolean } = {},
): Promise<{
  server: Server
  url: string
}> {
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          capabilities: {
            profileMaterialization: 'cli-bridge.profile-materialization.v2',
            usageCostProvenance: 'cli-bridge.usage-cost.v1',
            runtimeAttachments: { mcp: true },
          },
        }),
      )
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/v1/capabilities?model=')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ available: true }))
      return
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ admission: { active: 0, maxActive: 1 } }))
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404)
      res.end()
      return
    }
    const body = await readJsonBody(req)
    const profile = body.agent_profile as Record<string, unknown>
    const requestModel = String(body.model)
    const profileDigest = canonicalAgentProfileDigest(profile as unknown as SandboxAgentProfile)
    await submitBridgeResult(body)
    const usage = options.unknownCost
      ? { prompt_tokens: 11, completion_tokens: 7, cost_known: false }
      : {
          prompt_tokens: 11,
          completion_tokens: 7,
          cost: 0.01,
          cost_known: true,
          cost_provenance: 'provider-receipt',
        }
    const modelAt = (index: number): string | undefined =>
      Array.isArray(responseModel) ? responseModel[index] : responseModel
    const frames = [
      JSON.stringify({
        ...(modelAt(0) === undefined ? {} : { model: modelAt(0) }),
        choices: [{ delta: { content: 'bridge answer' } }],
      }),
      JSON.stringify({ ...(modelAt(1) === undefined ? {} : { model: modelAt(1) }), usage }),
      JSON.stringify({
        profile_materialization: bridgeMaterialization(profileDigest, requestModel),
      }),
      '[DONE]',
    ]
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'x-run-id': String(body.run_id),
      'x-run-request-digest': bridgeRequestDigest,
    })
    res.end(
      `${frames
        .map((frame, index) =>
          frame === '[DONE]' ? `data: ${frame}` : `id: ${index + 1}\ndata: ${frame}`,
        )
        .join('\n\n')}\n\n`,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}` }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
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
  const movingPiProfile = {
    name: 'pi-moving',
    harness: 'pi',
    model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
  }

  function movingPiDispatch(bridgeUrl: string) {
    return superviseDispatch<FakeScenario, { answer: number }>({
      toTask: (scenario) => ({ goal: scenario.id }),
      toSuperviseOptions: () => ({
        budget: { maxIterations: 10, maxTokens: 1_000 },
        maxTurns: 1,
        backend: { backend: 'bridge', bridgeUrl, bridgeBearer: 'test' },
        deliverable: {
          check: (value) => (value as { answer?: unknown }).answer === 42,
          describe: 'an answer of 42',
        },
      }),
    })
  }

  function modelEvidence(
    attempts: ReadonlyArray<ReadonlyArray<string>>,
    models: ReadonlyArray<string> = [...new Set(attempts.flat())],
  ): ProviderModelExecutionEvidence {
    return {
      status: 'known',
      attempts: attempts.map((observations) => ({ observations })),
      models,
    }
  }

  function identityResult(
    rootProviderModel: ProviderModelExecutionEvidence,
    child?: Partial<NodeSnapshot>,
  ): SupervisedResult<unknown> {
    const spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
    const childProviderModel = child?.providerModel
    const providerModel: ProviderModelExecutionEvidence =
      child === undefined
        ? rootProviderModel
        : child.ownedTreeRoot !== undefined
          ? {
              status: 'unknown',
              attempts: rootProviderModel.attempts,
              models: rootProviderModel.models,
              reason: 'provider-model-missing',
            }
          : childProviderModel === undefined
            ? {
                status: 'unknown',
                attempts: [...rootProviderModel.attempts, { observations: [] }],
                models: rootProviderModel.models,
                reason: 'provider-model-missing',
              }
            : rootProviderModel.status === 'unknown' || childProviderModel.status === 'unknown'
              ? {
                  status: 'unknown',
                  attempts: [...rootProviderModel.attempts, ...childProviderModel.attempts],
                  models: [...new Set([...rootProviderModel.models, ...childProviderModel.models])],
                  reason:
                    rootProviderModel.reason === 'provider-model-conflict' ||
                    childProviderModel.reason === 'provider-model-conflict'
                      ? 'provider-model-conflict'
                      : 'provider-model-missing',
                }
              : {
                  status: 'known',
                  attempts: [...rootProviderModel.attempts, ...childProviderModel.attempts],
                  models: [...new Set([...rootProviderModel.models, ...childProviderModel.models])],
                }
    return {
      kind: 'winner',
      out: {},
      outRef: `sha256:${'a'.repeat(64)}`,
      tree: {
        root: 'root',
        nodes: child
          ? [
              {
                id: 'root:s0',
                parent: 'root',
                label: 'child',
                status: 'done',
                runtime: 'router',
                budget: { maxIterations: 1, maxTokens: 1 },
                spent: spend,
                ...child,
              },
            ]
          : [],
        inFlight: 0,
        waiting: 0,
      },
      spentTotal: spend,
      rootProviderModel,
      providerModel,
    } as SupervisedResult<unknown>
  }

  it('uses only provider attempt evidence and canonicalizes bare plus qualified observations', () => {
    const served = 'tangle-router/deepseek-v4-flash@fp_provider_snapshot_matrix'
    const result = identityResult(modelEvidence([['deepseek-v4-flash', served]]), {
      materialization: {
        status: 'known',
        runtime: 'router',
        authoredProfileDigest: `sha256:${'b'.repeat(64)}`,
        effectiveProfileDigest: `sha256:${'c'.repeat(64)}`,
        backend: 'router',
        model: { status: 'known', id: 'plan-only-wrong-model' },
      } as NodeSnapshot['materialization'],
      providerModel: modelEvidence([[served]]),
    })
    expect(supervisedTreeModelForDispatch(result, movingPiProfile)).toEqual({
      kind: 'known',
      model: served,
    })
  })

  it('retains a native dated snapshot in the settled provider identity', () => {
    const served = 'openai/gpt-5.2-2025-12-11'
    const result = identityResult(modelEvidence([['gpt-5.2', served]]), {
      providerModel: modelEvidence([[served]]),
    })
    expect(supervisedTreeModelForDispatch(result, movingPiProfile)).toEqual({
      kind: 'known',
      model: served,
    })
  })

  it('ignores a Router-proven pre-provider rejection but keeps ambiguous failures unknown', () => {
    const served = 'tangle-router/deepseek-v4-flash@fp_provider_snapshot_matrix'
    const preProvider = { observations: [], providerDispatch: 'not_started' as const }
    const successfulTree = identityResult({
      status: 'known',
      attempts: [preProvider, { observations: [served] }],
      models: [served],
    })
    expect(supervisedTreeModelForDispatch(successfulTree, movingPiProfile)).toEqual({
      kind: 'known',
      model: served,
    })

    const ambiguousTree = identityResult({
      status: 'unknown',
      attempts: [preProvider, { observations: [] }],
      models: [],
      reason: 'provider-model-missing',
    })
    expect(supervisedTreeModelForDispatch(ambiguousTree, movingPiProfile)).toEqual({
      kind: 'unknown',
    })
  })

  it.each([
    [
      'zero-valued child without evidence',
      { spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 } },
    ],
    [
      'plan-only child',
      { materialization: { status: 'known', model: { status: 'known', id: 'plan-alias' } } },
    ],
    [
      'missing identity after a paid attempt',
      { providerModel: modelEvidence([['deepseek-v4-flash@fp_a'], []]) },
    ],
    [
      'mutated redundant identity fields',
      { providerModel: modelEvidence([['deepseek-v4-flash@fp_b']], ['deepseek-v4-flash@fp_a']) },
    ],
  ] as const)('fails closed for %s', (_label, child) => {
    const result = identityResult(
      modelEvidence([['deepseek-v4-flash@fp_a']]),
      child as Partial<NodeSnapshot>,
    )
    expect(supervisedTreeModelForDispatch(result, movingPiProfile)).toEqual({ kind: 'unknown' })
  })

  it('rejects mixed served snapshots and nested trees instead of flattening plan aliases', () => {
    const mixed = identityResult(modelEvidence([['deepseek-v4-flash@fp_a']]), {
      providerModel: modelEvidence([['other-model@fp_b']]),
    })
    expect(supervisedTreeModelForDispatch(mixed, movingPiProfile)).toEqual({
      kind: 'mixed',
      models: ['deepseek-v4-flash@fp_a', 'other-model@fp_b'],
    })
    const nested = identityResult(modelEvidence([['deepseek-v4-flash@fp_a']]), {
      ownedTreeRoot: 'root:s0',
      providerModel: modelEvidence([['deepseek-v4-flash@fp_a']]),
    })
    expect(supervisedTreeModelForDispatch(nested, movingPiProfile)).toEqual({ kind: 'unknown' })
  })

  it('settles a Pi moving alias from one served snapshot and runProfileMatrix accepts it', async () => {
    const servedModel = 'tangle-router/deepseek-v4-flash@fp_provider_snapshot_20260811'
    const bridge = await startPiBridge(servedModel)
    const runDir = await mkdtemp(join(tmpdir(), 'runtime-pi-model-identity-'))
    try {
      const matrix = await runProfileMatrix({
        profiles: [movingPiProfile],
        scenarios: [{ id: 'pi-moving', kind: 'task' }],
        dispatch: movingPiDispatch(bridge.url),
        runDir,
        commitSha: 'a'.repeat(40),
        integrity: 'off',
        maxConcurrency: 1,
        maxProfileConcurrency: 1,
      })

      expect(matrix.records).toHaveLength(1)
      expect(matrix.records[0]).toMatchObject({
        model: servedModel,
        terminalOutcome: 'succeeded',
        tokenUsage: { input: 11, output: 7 },
      })
    } finally {
      await closeServer(bridge.server)
      await rm(runDir, { recursive: true, force: true })
    }
  })

  it('does not treat terminal unknown-cost bookkeeping as a second provider attempt', async () => {
    const servedModel = 'tangle-router/deepseek-v4-flash@fp_terminal_unknown_cost'
    const bridge = await startPiBridge(servedModel, { unknownCost: true })
    const runDir = await mkdtemp(join(tmpdir(), 'runtime-pi-terminal-unknown-cost-'))
    try {
      const matrix = await runProfileMatrix({
        profiles: [movingPiProfile],
        scenarios: [{ id: 'pi-terminal-unknown-cost', kind: 'task' }],
        dispatch: movingPiDispatch(bridge.url),
        runDir,
        commitSha: 'a'.repeat(40),
        integrity: 'off',
        maxConcurrency: 1,
        maxProfileConcurrency: 1,
      })

      expect(matrix.records).toHaveLength(1)
      expect(matrix.records[0]).toMatchObject({
        model: servedModel,
        terminalOutcome: 'succeeded',
        tokenUsage: { input: 11, output: 7 },
      })
    } finally {
      await closeServer(bridge.server)
      await rm(runDir, { recursive: true, force: true })
    }
  })

  it('keeps a real provider attempt unknown when both identity and cost are missing', async () => {
    const bridge = await startPiBridge(undefined, { unknownCost: true })
    const fake = fakeDispatchContext()
    try {
      await expect(
        movingPiDispatch(bridge.url)(
          movingPiProfile,
          { id: 'pi-unknown-model-and-cost', kind: 'task' },
          fake.ctx,
        ),
      ).rejects.toThrow(/cannot settle one Eval paid-call receipt/u)
      expect(fake.ledger.list()).toEqual([
        expect.objectContaining({
          model: 'unknown',
          inputTokens: 0,
          outputTokens: 0,
          usageUnknown: true,
          costUnknown: true,
        }),
      ])
    } finally {
      await closeServer(bridge.server)
    }
  })

  it.each([
    ['missing provider model', undefined],
    ['bare provider model', 'deepseek-v4-flash'],
    ['mismatched provider model', 'other-model@fp_provider_snapshot_20260811'],
    [
      'mixed provider snapshots',
      [
        'tangle-router/deepseek-v4-flash@fp_provider_snapshot_a',
        'tangle-router/deepseek-v4-flash@fp_provider_snapshot_b',
      ],
    ],
  ] as const)(
    'fails closed for %s without a false known receipt',
    async (_label, responseModel) => {
      const bridge = await startPiBridge(responseModel)
      const fake = fakeDispatchContext()
      try {
        await expect(
          movingPiDispatch(bridge.url)(
            movingPiProfile,
            { id: 'pi-negative', kind: 'task' },
            fake.ctx,
          ),
        ).rejects.toThrow(/cannot settle one Eval paid-call receipt/u)
        expect(fake.ledger.list()).toEqual([
          expect.objectContaining({
            model: 'unknown',
            inputTokens: 0,
            outputTokens: 0,
            usageUnknown: true,
            costUnknown: true,
          }),
        ])
      } finally {
        await closeServer(bridge.server)
      }
    },
  )

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
        model: { provider: 'offline', default: 'test-model@2026-08-11' },
      },
      { id: 'recursive', kind: 'task' },
      fake.ctx,
    )

    expect(artifact).toEqual({ answer: 42 })
    expect(calls).toBe(18)
    expect(fake.ledger.list()).toEqual([
      expect.objectContaining({
        actor: 'supervise',
        model: 'test-model@2026-08-11',
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
        model: { provider: 'offline', default: 'test-model@2026-08-11' },
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
        model: { provider: 'offline', default: 'test-model@2026-08-11' },
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
        model: { provider: 'offline', default: 'test-model@2026-08-11' },
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
          model: { provider: 'offline', default: 'test-model@2026-08-11' },
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
                      name: 'spawn_worker',
                      arguments: JSON.stringify({
                        profile: {
                          name: 'deepseek-child',
                          harness: 'cli-base',
                          model: { provider: 'deepseek', default: 'deepseek-v4-flash@2026-08-11' },
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
          model: { provider: 'zai', default: 'glm-root@2026-08-11' },
        },
        { id: 'mixed-model', kind: 'task' },
        fake.ctx,
      ),
    ).rejects.toThrow(
      /cannot settle one Eval paid-call receipt for a tree with multiple models \(deepseek-v4-flash@2026-08-11, glm-root@2026-08-11\)/u,
    )
    expect(servedModels).toContain('glm-root@2026-08-11')
    expect(servedModels).toContain('deepseek-v4-flash@2026-08-11')
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
