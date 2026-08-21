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

const context: ExecutorContext = { signal: new AbortController().signal, seams: {} }

function specFor(config: ExecutorConfig): AgentSpec {
  const harness =
    config.backend === 'bridge' || (config.backend === 'cli-worktree' && config.bridge)
      ? 'pi'
      : config.backend === 'cli-worktree'
        ? 'codex'
        : 'cli-base'
  return {
    profile: {
      name: 'snapshot-worker',
      harness,
      model: {
        provider: harness === 'codex' ? 'openai' : 'test-provider',
        default: 'test-model',
      },
    },
    harness: null,
  }
}

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
        },
        runtime: 'router',
      },
      {
        name: 'router-tools',
        config: {
          backend: 'router-tools',
          routerBaseUrl: 'http://router.test',
          routerKey: 'key',
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
        // pi is not a backend of its own: it is a bridge wire id like every other harness, and
        // the intake capture must hold for it exactly as it does for the generic bridge case.
        name: 'pi-over-bridge',
        config: {
          backend: 'bridge',
          bridgeUrl: 'http://bridge.test',
          bridgeBearer: 'secret',
        },
        runtime: 'cli',
      },
      {
        name: 'sandbox',
        config: {
          backend: 'sandbox',
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
      const spec = specFor(testCase.config)
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

    const config: ExecutorConfig = { backend: 'provider', provider: providerA }
    expect(factory(specFor(config), context).runtime).toBe('provider-a')
  })

  it('rejects fixed execution ids on reusable backends', () => {
    const invalid: ExecutorConfig[] = [
      {
        backend: 'bridge',
        bridgeUrl: 'http://bridge.test',
        bridgeBearer: 'secret',
        sessionId: 'SHARED',
      },
      {
        backend: 'cli-worktree',
        repoRoot: '/repo',
        runId: 'SHARED',
      },
      {
        backend: 'cli-worktree',
        repoRoot: '/repo',
        bridge: {
          bridgeUrl: 'http://bridge.test',
          bridgeBearer: 'secret',
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
        sessionId: 'PINNED-ONCE',
      },
      {
        backend: 'cli-worktree',
        repoRoot: '/repo',
        runId: 'PINNED-ONCE',
      },
    ]

    for (const config of direct) {
      const executor = createExecutor(config)(specFor(config), context)
      expect(executor.runtime).toBe('cli')
    }
  })

  it('refuses to attach a model credential to a non-loopback bridge', () => {
    expect(() =>
      createExecutor({
        backend: 'bridge',
        bridgeUrl: 'https://bridge.example.test',
        bridgeBearer: 'test-bearer',
        modelCredential: {
          key: 'MODEL_GATEWAY_TOKEN',
          baseUrlKey: 'MODEL_GATEWAY_BASE_URL',
          provider: { get: async () => 'secret' },
        },
      }),
    ).toThrow(/modelCredential is allowed only for a loopback bridge URL/u)
  })

  it('binds worktree and bridge backends to the supplied durable execution identity', () => {
    const bridge = captureReusableExecutorConfig(
      {
        backend: 'bridge',
        bridgeUrl: 'http://bridge.test',
        bridgeBearer: 'secret',
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

  it('refuses a backend nothing implements, by name, at the call that names it', () => {
    // The backend is data a profile, an experiment config, or a replay journal can carry, so a
    // name outside the union reaches this factory untyped. Without a refusal here the switch
    // returns undefined, createExecutor hands back a working-looking factory, and the failure
    // lands one call later as a TypeError that never mentions the backend.
    expect(() => createExecutor({ backend: 'bridge-worktree' } as never)).toThrow(
      /no backend named "bridge-worktree"; supported backends are bridge, cli, cli-worktree, provider, router, router-tools, sandbox/,
    )
  })
})
