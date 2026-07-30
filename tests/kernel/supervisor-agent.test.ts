import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  type CoordinationSessionOptions,
  serveCoordinationMcp,
} from '../../src/runtime/supervise/coordination-mcp'
import { bestDelivered } from '../../src/runtime/supervise/finalizer'
import { createInMemoryRunContext } from '../../src/runtime/supervise/run-context'
import {
  type AgentExecutionContext,
  type ResolveExecutor,
  type SuperviseOptions,
  supervise,
} from '../../src/runtime/supervise/supervise'
import type {
  Executor,
  ExecutorFactory,
  ExecutorResult,
  Spend,
} from '../../src/runtime/supervise/types'

const zeroSpend = (): Spend => ({
  iterations: 0,
  tokens: { input: 0, output: 0 },
  usd: 0,
  ms: 0,
})

const oneTurn = (): Spend => ({
  iterations: 1,
  tokens: { input: 2, output: 3 },
  usd: 0,
  ms: 4,
})

async function openLocalCoordination(options: CoordinationSessionOptions) {
  const handle = await serveCoordinationMcp(options)
  return {
    handle,
    profileEntry: { transport: 'http' as const, url: handle.url },
  }
}

function options(
  resolveExecutor: ResolveExecutor,
  overrides: Partial<SuperviseOptions> = {},
): SuperviseOptions {
  return {
    context: createInMemoryRunContext(),
    budget: { maxIterations: 50, maxTokens: 50_000, maxUsd: 10 },
    resolveExecutor,
    openCoordination: openLocalCoordination,
    deliverable: {
      describe: 'an object whose answer is 42',
      check: (out) => (out as { answer?: unknown })?.answer === 42,
    },
    finalizer: bestDelivered,
    perWorker: { maxIterations: 10, maxTokens: 10_000, maxUsd: 2 },
    maxLiveWorkers: null,
    maxDepth: 2,
    runId: 'strict-supervise',
    executorShutdown: 'infinity',
    workerShutdown: 'infinity',
    failureWindow: null,
    questionPolicy: 'auto',
    awaitTimeoutMs: 2_000,
    stallAfterMs: null,
    analysts: null,
    analyzeOnSettle: [],
    watchWorkers: null,
    probes: null,
    hooks: null,
    signal: null,
    allowedModels: null,
    now: () => 1_000,
    ...overrides,
  }
}

interface ScriptResult {
  readonly out: unknown
  readonly spent?: Spend
  readonly score?: number
}

function scriptedFactory(
  run: (profile: AgentProfile, task: unknown) => Promise<ScriptResult> | ScriptResult,
  seen?: AgentProfile[],
): ExecutorFactory<unknown> {
  return (spec) => {
    seen?.push(spec.profile)
    let artifact: ExecutorResult<unknown> | undefined
    const executor: Executor<unknown> = {
      runtime: 'test-executor',
      async execute(task) {
        const result = await run(spec.profile, task)
        artifact = {
          outRef: `test:${spec.profile.name ?? 'unnamed'}`,
          out: result.out,
          ...(result.score !== undefined ? { verdict: { valid: true, score: result.score } } : {}),
          spent: result.spent ?? oneTurn(),
        }
        return artifact
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact() {
        if (!artifact) throw new Error('artifact read before execution')
        return artifact
      },
    }
    return executor
  }
}

function coordinationUrl(profile: AgentProfile): string {
  const server = profile.mcp?.coordination
  if (!server || server.enabled === false || !('url' in server)) {
    throw new Error(`profile ${profile.name ?? '<unnamed>'} has no coordination URL`)
  }
  return server.url
}

async function callTool(
  profile: AgentProfile,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(coordinationUrl(profile), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = (await response.json()) as {
    error?: { message?: string }
    result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }> }
  }
  if (body.error) throw new Error(body.error.message ?? 'MCP call failed')
  const text = body.result?.content?.find((part) => part.type === 'text')?.text
  if (typeof text !== 'string') throw new Error(`tool ${name} returned no text result`)
  const value = JSON.parse(text) as unknown
  if (!value || typeof value !== 'object') throw new Error(`tool ${name} returned a scalar`)
  return value as Record<string, unknown>
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

describe('strict recursive supervise surface', () => {
  it('preserves the authored profile and adds only the live coordination entry', async () => {
    const seen: AgentProfile[] = []
    const profile = deepFreeze<AgentProfile>({
      name: 'research-leader',
      description: 'portable authored profile',
      prompt: {
        systemPrompt: 'Choose actions from evidence.',
        instructions: ['Use available tools when they help.'],
      },
      model: { default: 'provider/model', small: 'provider/small' },
      tools: { shell: true },
      mcp: {
        knowledge: { transport: 'http', url: 'https://knowledge.invalid/mcp' },
      },
      metadata: { lineage: 'pursuit-7' },
    })
    const before = structuredClone(profile)
    const result = await supervise(
      profile,
      { pursuit: 'test' },
      options(
        () =>
          scriptedFactory(
            () => ({
              out: { answer: 42 },
            }),
            seen,
          ),
        { allowedModels: ['provider/model', 'provider/small'] },
      ),
    )

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') {
      expect(result.verdict).toEqual({ valid: true, score: 1 })
    }
    expect(profile).toEqual(before)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      ...before,
      mcp: {
        ...before.mcp,
        coordination: {
          transport: 'http',
          url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
        },
      },
    })
  })

  it('runs root → child → grandchild through one resolver and refuses a fourth level', async () => {
    const calls: Array<{ profile: AgentProfile; context: AgentExecutionContext }> = []
    let depthRefusal: unknown
    const resolver: ResolveExecutor = (profile, context) => {
      calls.push({ profile, context })
      return scriptedFactory(async (executableProfile) => {
        if (profile.name === 'grandchild') {
          depthRefusal = await callTool(executableProfile, 'spawn_agent', {
            profile: { name: 'too-deep' },
            task: 'must be refused',
          })
          return { out: { answer: 42, depthRefusal } }
        }
        const childName = profile.name === 'root' ? 'child' : 'grandchild'
        await callTool(executableProfile, 'spawn_agent', {
          profile: { name: childName },
          task: `run ${childName}`,
        })
        await callTool(executableProfile, 'await_event', { kinds: ['settled'] })
        return { out: { raw: profile.name } }
      })
    }

    const context = createInMemoryRunContext()
    const result = await supervise(
      { name: 'root' },
      'solve',
      options(resolver, { context, runId: 'recursive' }),
    )

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') {
      expect(result.out).toMatchObject({ answer: 42 })
      expect(result.verdict).toEqual({ valid: true, score: 1 })
      expect(result.spentTotal).toEqual({
        iterations: 3,
        tokens: { input: 6, output: 9 },
        usd: 0,
        ms: 12,
      })
    }
    expect(depthRefusal).toMatchObject({ error: 'depth-exceeded' })
    expect(
      calls.map(({ profile, context: callContext }) => ({
        name: profile.name,
        depth: callContext.depth,
        path: callContext.path,
        frozen: Object.isFrozen(callContext) && Object.isFrozen(callContext.path),
      })),
    ).toEqual([
      { name: 'root', depth: 0, path: ['root'], frozen: true },
      { name: 'child', depth: 1, path: ['root', 'child'], frozen: true },
      {
        name: 'grandchild',
        depth: 2,
        path: ['root', 'child', 'grandchild'],
        frozen: true,
      },
    ])

    const rootEvents = await context.journal.loadTree('recursive')
    expect(rootEvents?.[0]).toMatchObject({
      kind: 'spawned',
      id: 'recursive',
      label: 'root',
    })
    expect(rootEvents?.[0]).not.toHaveProperty('runtime')
    expect(
      rootEvents?.find((event) => event.kind === 'spawned' && event.parent === 'recursive'),
    ).toMatchObject({ id: 'recursive:s0', label: 'child' })
  })

  it('checks the custom finalizer output itself and rejects an invalid returned artifact', async () => {
    const factory = scriptedFactory(() => ({ out: { answer: 7 }, spent: zeroSpend() }))
    const result = await supervise(
      { name: 'root' },
      'solve',
      options(() => factory, {
        finalizer: () => ({ answer: 9 }),
      }),
    )

    expect(result).toMatchObject({ kind: 'no-winner', reason: 'invalid-result' })
  })

  it('fails before execution when a required policy field is omitted', () => {
    const factory = scriptedFactory(() => ({ out: { answer: 42 } }))
    const configured = options(() => factory)
    const missing = { ...configured } as Partial<SuperviseOptions>
    delete missing.failureWindow

    expect(() => supervise({ name: 'root' }, 'solve', missing as SuperviseOptions)).toThrow(
      /failureWindow must be supplied explicitly/,
    )
  })
})
