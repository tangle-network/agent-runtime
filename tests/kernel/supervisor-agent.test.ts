import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  type CoordinationSessionOptions,
  serveCoordinationMcp,
} from '../../src/runtime/supervise/coordination-mcp'
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
  const handle = await serveCoordinationMcp({
    ...options,
    host: '127.0.0.1',
    port: 0,
  })
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
    maxLiveWorkers: null,
    maxDepth: 2,
    runId: 'strict-supervise',
    resume: false,
    executorShutdown: 'infinity',
    workerShutdown: 'infinity',
    failureWindow: null,
    parentQuestionPort: null,
    awaitTimeoutMs: 2_000,
    stallAfterMs: null,
    analysts: null,
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
    const authoredSeen: AgentProfile[] = []
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
        (authored) => {
          authoredSeen.push(authored)
          return scriptedFactory(
            () => ({
              out: { answer: 42 },
            }),
            seen,
          )
        },
        { allowedModels: ['provider/model', 'provider/small'] },
      ),
    )

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
    expect(profile).toEqual(before)
    expect(authoredSeen).toHaveLength(1)
    expect(authoredSeen[0]).toEqual(before)
    expect(Object.isFrozen(authoredSeen[0])).toBe(true)
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
        const level = Number(profile.metadata?.level)
        if (level === 2) {
          depthRefusal = await callTool(executableProfile, 'spawn_agent', {
            profile: { metadata: { level: 3 } },
            task: 'must be refused',
            label: 'level-3',
            budget: {
              maxIterations: 1,
              maxTokens: 1_000,
              maxUsd: null,
              deadlineMs: null,
            },
          })
          return { out: { answer: 42, depthRefusal } }
        }
        const childLevel = level + 1
        const spawned = await callTool(executableProfile, 'spawn_agent', {
          profile: { metadata: { level: childLevel } },
          task: `run level ${childLevel}`,
          label: `level-${childLevel}`,
          budget: {
            maxIterations: 10,
            maxTokens: 10_000,
            maxUsd: 2,
            deadlineMs: null,
          },
        })
        await callTool(executableProfile, 'await_event', { kinds: ['settled'] })
        const child = await callTool(executableProfile, 'observe_agent', {
          workerId: spawned.workerId,
        })
        return { out: child.output }
      })
    }

    const context = createInMemoryRunContext()
    const result = await supervise(
      { metadata: { level: 0 } },
      'solve',
      options(resolver, { context, runId: 'recursive' }),
    )

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') {
      expect(result.out).toEqual({
        answer: 42,
        depthRefusal: { error: 'depth-exceeded', live: 0, freeSlots: null },
      })
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
        level: profile.metadata?.level,
        depth: callContext.depth,
        nodeId: callContext.nodeId,
        frozen: Object.isFrozen(profile) && Object.isFrozen(callContext),
      })),
    ).toEqual([
      { level: 0, depth: 0, nodeId: 'recursive', frozen: true },
      {
        level: 1,
        depth: 1,
        nodeId: 'recursive:s0',
        frozen: true,
      },
      {
        level: 2,
        depth: 2,
        nodeId: 'recursive:s0:s0',
        frozen: true,
      },
    ])

    const rootEvents = await context.journal.loadTree('recursive')
    expect(rootEvents?.[0]).toMatchObject({
      kind: 'spawned',
      id: 'recursive',
      profileDigest: calls[0]?.profile ? canonicalAgentProfileDigest(calls[0].profile) : undefined,
    })
    expect(rootEvents?.[0]).not.toHaveProperty('runtime')
    expect(
      rootEvents?.find((event) => event.kind === 'spawned' && event.parent === 'recursive'),
    ).toMatchObject({
      id: 'recursive:s0',
      label: 'level-1',
      profileDigest: calls[1]?.profile ? canonicalAgentProfileDigest(calls[1].profile) : undefined,
    })
  })

  it('retains the first explicit submission instead of fabricating or selecting a result', async () => {
    const factory = scriptedFactory(async (profile) => {
      await callTool(profile, 'submit_result', { result: { answer: 'first' } })
      await callTool(profile, 'submit_result', { result: { answer: 'later' } })
      return { out: { answer: 'terminal' }, spent: zeroSpend() }
    })
    const result = await supervise(
      {},
      'solve',
      options(() => factory),
    )

    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'first' } })
    if (result.kind === 'winner') expect(result).not.toHaveProperty('verdict')
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
