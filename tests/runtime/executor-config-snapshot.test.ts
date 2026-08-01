import { describe, expect, it } from 'vitest'
import type {
  AgentEnvironmentProvider,
  AgentEnvironmentProviderRegistry,
} from '../../src/runtime/environment-provider'
import {
  bindReusableExecutorExecutionId,
  captureReusableExecutorConfig,
  createExecutor,
  type ExecutorConfig,
} from '../../src/runtime/supervise/runtime'
import type { AgentSpec, ExecutorContext, Runtime } from '../../src/runtime/supervise/types'
import type { ExecCtx, SandboxClient } from '../../src/runtime/types'

const spec: AgentSpec = { profile: { name: 'snapshot-worker' }, harness: null }
const context: ExecutorContext = { signal: new AbortController().signal, seams: {} }

describe('createExecutor config intake', () => {
  it('captures every backend variant while retaining only explicit live ports', () => {
    const executeToolCall = async () => 'tool result'
    const onToolStep = () => {}
    const runGit = () => ({ stdout: '', stderr: '', exitCode: 0 })
    const runCommand = async () => ({ exitCode: 0, output: '' })
    const provider = {
      name: 'live-provider',
      capabilities: async () => {
        throw new Error('not executed')
      },
      create: async () => {
        throw new Error('not executed')
      },
    } as AgentEnvironmentProvider
    const taskToTurn = () => ({ prompt: 'live mapper' })
    const sandboxClient = {
      create: async () => {
        throw new Error('not executed')
      },
    } as SandboxClient
    const hooks = { onEvent: () => {} }
    const traceEmitter = { emit: () => {} }
    const onSandboxEvent = () => {}
    const runHandle = { observe: () => {} } as unknown as NonNullable<ExecCtx['runHandle']>

    const cases: Array<{ name: string; config: ExecutorConfig; runtime: Runtime }> = [
      {
        name: 'router',
        config: {
          backend: 'router',
          routerBaseUrl: 'http://router.test',
          routerKey: 'key',
          model: 'model',
        },
        runtime: 'router',
      },
      {
        name: 'router-tools',
        config: {
          backend: 'router-tools',
          routerBaseUrl: 'http://router.test',
          routerKey: 'key',
          model: 'model',
          tools: [],
          executeToolCall,
          onToolStep,
        },
        runtime: 'router',
      },
      {
        name: 'bridge',
        config: {
          backend: 'bridge',
          bridgeUrl: 'http://bridge.test',
          bridgeBearer: 'secret',
          model: 'model',
        },
        runtime: 'cli',
      },
      {
        name: 'cli',
        config: { backend: 'cli', bin: '/bin/true', args: ['--version'] },
        runtime: 'cli',
      },
      {
        name: 'cli-worktree',
        config: {
          backend: 'cli-worktree',
          repoRoot: '/repo',
          harness: 'codex',
          runGit,
          runCommand,
        },
        runtime: 'cli',
      },
      {
        name: 'provider',
        config: {
          backend: 'provider',
          provider,
          runtime: 'provider-runtime',
          taskToTurn,
          defaults: { workspace: { cwd: '/repo' } },
        },
        runtime: 'provider-runtime',
      },
      {
        name: 'pi',
        config: { backend: 'pi', bin: 'pi', args: ['--test'], model: 'provider/model' },
        runtime: 'pi',
      },
      {
        name: 'sandbox',
        config: {
          backend: 'sandbox',
          harness: 'codex',
          sandboxClient,
          maxIterations: 1,
          lineage: { sessionContinuity: true },
          steering: { maxTurns: 2 },
          loopCtx: {
            hooks,
            traceEmitter,
            onSandboxEvent,
            runHandle,
            traceId: 'trace-id',
            parentSpanId: 'parent-id',
          },
        },
        runtime: 'sandbox',
      },
    ]

    for (const testCase of cases) {
      const originalBackend = testCase.config.backend
      const factory = createExecutor(testCase.config)
      const mutableConfig = testCase.config as { backend: string }
      mutableConfig.backend = originalBackend === 'router' ? 'cli' : 'router'

      expect(factory(spec, context).runtime, testCase.name).toBe(testCase.runtime)
    }
  })

  it('resolves a named provider once instead of retaining a mutable registry lookup', () => {
    const providerA = {
      name: 'provider-a',
      capabilities: async () => {
        throw new Error('not executed')
      },
      create: async () => {
        throw new Error('not executed')
      },
    } as AgentEnvironmentProvider
    const providerB = { ...providerA, name: 'provider-b' } as AgentEnvironmentProvider
    let current = providerA
    const registry = {
      require: () => current,
    } as AgentEnvironmentProviderRegistry
    const factory = createExecutor({
      backend: 'provider',
      provider: 'selected-provider',
      registry,
    })
    current = providerB

    expect(factory(spec, context).runtime).toBe('provider-a')
  })

  it('rejects reusable profile overlays and fixed execution ids', () => {
    const invalid: ExecutorConfig[] = [
      {
        backend: 'bridge',
        bridgeUrl: 'http://bridge.test',
        bridgeBearer: 'secret',
        model: 'model',
        agentProfile: { name: 'late-overlay' },
      },
      {
        backend: 'bridge',
        bridgeUrl: 'http://bridge.test',
        bridgeBearer: 'secret',
        model: 'model',
        sessionId: 'SHARED',
      },
      {
        backend: 'cli-worktree',
        repoRoot: '/repo',
        harness: 'codex',
        runId: 'SHARED',
      },
      {
        backend: 'cli-worktree',
        repoRoot: '/repo',
        bridge: {
          bridgeUrl: 'http://bridge.test',
          bridgeBearer: 'secret',
          model: 'model',
          sessionId: 'SHARED',
        },
      },
    ]

    for (const config of invalid) {
      expect(() => captureReusableExecutorConfig(config, 'reusable-test')).toThrow(
        /not allowed|isolated id/,
      )
    }
  })

  it('keeps fixed ids available to explicitly single-execution factories', () => {
    const direct: ExecutorConfig[] = [
      {
        backend: 'bridge',
        bridgeUrl: 'http://bridge.test',
        bridgeBearer: 'secret',
        model: 'model',
        sessionId: 'PINNED-ONCE',
      },
      {
        backend: 'cli-worktree',
        repoRoot: '/repo',
        harness: 'codex',
        runId: 'PINNED-ONCE',
      },
    ]

    for (const config of direct) {
      const executor = createExecutor(config)(spec, context)
      expect(executor.runtime).toBe('cli')
    }
  })

  it('binds worktree and bridge backends to the supplied durable execution identity', () => {
    const bridge = captureReusableExecutorConfig(
      {
        backend: 'bridge',
        bridgeUrl: 'http://bridge.test',
        bridgeBearer: 'secret',
        model: 'model',
      },
      'bridge-test',
    )
    const worktree = captureReusableExecutorConfig(
      {
        backend: 'cli-worktree',
        repoRoot: '/repo',
        bridge: {
          bridgeUrl: 'http://bridge.test',
          bridgeBearer: 'secret',
          model: 'model',
        },
      },
      'worktree-test',
    )

    expect(bindReusableExecutorExecutionId(bridge, 'execution-a')).toMatchObject({
      backend: 'bridge',
      sessionId: 'execution-a',
    })
    expect(bindReusableExecutorExecutionId(worktree, 'execution-a')).toMatchObject({
      backend: 'cli-worktree',
      runId: 'execution-a',
    })
    expect(bindReusableExecutorExecutionId(worktree, 'execution-b')).toMatchObject({
      runId: 'execution-b',
    })
  })
})
