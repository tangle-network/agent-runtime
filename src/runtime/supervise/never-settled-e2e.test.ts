import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  AgentSession,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../durable/spawn-journal'
import { providerAsExecutor } from '../environment-provider'
import { createBudgetPool } from './budget'
import { createExecutorRegistry } from './runtime'
import { createScope, releaseRetainedEnvironments } from './scope'
import type { AgentProfile, Executor, ExecutorFactory } from './types'

const retainedRequestDigest = `sha256:${'a'.repeat(64)}` as const

function capabilities() {
  return {
    profile: {
      namedProfiles: true,
      systemPrompt: { replace: true, append: true },
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: { files: true, instructions: true },
      runtimeUpdate: true,
      validation: true,
    },
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: true, list: true, messages: true },
    retainedControl: {
      exactRunIdentity: true,
      resultIdentity: true,
      eventIdentity: true,
      cancellationIdempotency: true,
    },
    workspace: {
      read: false,
      write: false,
      exec: false,
      git: false,
      upload: false,
      download: false,
    },
    branching: { checkpoint: false, fork: false },
    placement: false,
    usage: false,
    confidential: false,
  }
}

/** A retained provider whose sandbox stops mid-turn: the event stream throws and `result()`
 *  rejects, which is exactly the production shape (HTTP 409 "Sandbox is not running"). */
function stoppedSandboxProvider(destroyOutcome: 'ok' | 'throw') {
  const calls = { destroy: 0, get: 0 }
  let controlRef: Record<string, unknown> | undefined
  const session: AgentSession = {
    id: 'ses-1',
    get controlRef() {
      return controlRef as never
    },
    status: async () => 'running',
    // eslint-disable-next-line require-yield
    async *events() {
      throw new Error('HTTP 409: Sandbox is not running (status: stopped)')
    },
    result: async () => {
      throw new Error('HTTP 409: Sandbox is not running (status: stopped)')
    },
    prompt: async () => ({ text: '', success: false }),
    cancel: async () => {},
  }
  const environment: AgentEnvironment = {
    id: 'environment-1',
    provider: 'stopped-sandbox',
    status: async () => 'running',
    async *stream() {
      yield* []
    },
    async dispatch(input) {
      controlRef = {
        runId: 'run-1',
        provider: 'stopped-sandbox',
        environmentId: 'environment-1',
        sessionId: (input as { sessionId?: string }).sessionId ?? 'ses-1',
        executionId: (input as { executionId?: string }).executionId ?? 'exe-1',
        requestDigest: retainedRequestDigest,
      }
      return {
        id: controlRef.sessionId as string,
        provider: 'stopped-sandbox',
        controlRef: controlRef as never,
      }
    },
    session(id) {
      Object.defineProperty(session, 'id', { value: id, configurable: true })
      return session
    },
    async destroy() {
      calls.destroy += 1
      if (destroyOutcome === 'throw')
        throw new Error('HTTP 409: Sandbox is not running (status: stopped)')
    },
  }
  const provider: AgentEnvironmentProvider = {
    name: 'stopped-sandbox',
    capabilities: () => capabilities() as never,
    create: async () => environment,
    get: async (id) => {
      calls.get += 1
      return id === 'environment-1' ? environment : null
    },
  }
  return { provider, calls }
}

const profile: AgentProfile = {
  name: 'retained-worker',
  harness: 'claude-code',
  model: { provider: 'fixture', default: 'fixture/model' },
}

describe('never-settled e2e: a retained child whose sandbox stopped', () => {
  it.each(['ok', 'throw'] as const)(
    'reports what releaseRetained answers when destroy %ss',
    async (destroyOutcome) => {
      const { provider } = stoppedSandboxProvider(destroyOutcome)
      const journal = new InMemorySpawnJournal()
      const blobs = new InMemoryResultBlobStore()
      await journal.beginTree('root', new Date(0).toISOString())
      const scope = createScope({
        parentId: 'root',
        root: 'root',
        journal,
        blobs,
        pool: createBudgetPool({ maxIterations: 4, maxTokens: 10_000 }, 0),
        executors: createExecutorRegistry(),
        seams: {},
        depth: 0,
        signal: new AbortController().signal,
      })
      const inner = providerAsExecutor(provider)
      let built: Executor<unknown> | undefined
      const factory: ExecutorFactory<unknown> = (spec, ctx) => {
        built = inner(spec, ctx)
        return built
      }
      const spawned = scope.spawn(
        Object.assign(
          { name: profile.name!, act: async () => 'unused' },
          { executorSpec: { profile, harness: null, executorFactory: factory } },
        ),
        'task',
        { label: 'retained', budget: { maxIterations: 1, maxTokens: 1000 } },
      )
      expect(spawned.ok).toBe(true)
      const settled = await scope.next()
      const before = (await journal.loadTree('root')) ?? []
      console.log(`[${destroyOutcome}] settled.kind =`, settled?.kind)
      console.log(
        `[${destroyOutcome}] settled fields =`,
        JSON.stringify({
          retainedExecution: (settled as Record<string, unknown>)?.retainedExecution,
          retainedPendingCause: (settled as Record<string, unknown>)?.retainedPendingCause,
          reason: String((settled as Record<string, unknown>)?.reason).slice(0, 120),
        }),
      )
      console.log(
        `[${destroyOutcome}] journal BEFORE sweep =`,
        JSON.stringify(
          before.reduce<Record<string, number>>((a, e) => {
            a[e.kind] = (a[e.kind] ?? 0) + 1
            return a
          }, {}),
        ),
      )
      console.log(
        `[${destroyOutcome}] executor.releaseRetained bound =`,
        typeof built?.releaseRetained,
      )
      await releaseRetainedEnvironments(scope)
      const after = (await journal.loadTree('root')) ?? []
      console.log(
        `[${destroyOutcome}] journal AFTER sweep =`,
        JSON.stringify(
          after.reduce<Record<string, number>>((a, e) => {
            a[e.kind] = (a[e.kind] ?? 0) + 1
            return a
          }, {}),
        ),
      )
      for (const e of after)
        if (e.kind === 'environment-teardown' || e.kind === 'settled')
          console.log(`[${destroyOutcome}]   ${e.kind}:`, JSON.stringify(e).slice(0, 260))
      // What a second, direct call answers, to name the branch releaseRetained took.
      const direct = await built?.releaseRetained?.(new AbortController().signal)
      console.log(`[${destroyOutcome}] direct releaseRetained() =`, JSON.stringify(direct))
      expect(after.some((e) => e.kind === 'settled')).toBe(true)
    },
  )
})
