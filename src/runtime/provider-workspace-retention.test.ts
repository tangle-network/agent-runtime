import type {
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentExactRunControlRef,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type { AgentTurnInput } from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import {
  type AgentCandidateOutputArtifactPort,
  captureAgentCandidateWorkspaceFiles,
} from '../candidate-execution'
import { sha256Bytes } from '../candidate-execution/digest'
import {
  type ProviderLeafOut,
  type ProviderWorkspaceRetentionContext,
  providerAsExecutor,
} from './environment-provider'
import type { RetainedRunAdmission } from './retained-run-types'
import type { RetainedExecutorContext } from './supervise/retained-executor'
import { retainedExecutorSeamKey } from './supervise/retained-executor'
import type { UsageEvent } from './supervise/types'

type MemoryArtifacts = AgentCandidateOutputArtifactPort & {
  readonly bytes: Map<string, Uint8Array>
}

function testProfile(name: string): AgentProfile {
  return {
    name,
    harness: 'opencode',
    model: { provider: 'offline', default: 'offline-test-model' },
  }
}

function artifactStore(): MemoryArtifacts {
  const bytes = new Map<string, Uint8Array>()
  return {
    bytes,
    async put({ bytes: input, signal }) {
      signal?.throwIfAborted()
      const digest = sha256Bytes(input)
      bytes.set(digest.slice(7), Uint8Array.from(input))
      return {
        locator: { kind: 's3', bucket: 'provider-retention-tests', key: digest.slice(7) },
        sha256: digest,
        byteLength: input.byteLength,
      }
    },
    async read(reference) {
      const stored = bytes.get(reference.sha256.slice(7))
      if (stored === undefined) throw new Error(`missing artifact ${reference.sha256}`)
      return Uint8Array.from(stored)
    },
  }
}

async function snapshot(
  artifacts: AgentCandidateOutputArtifactPort,
  executionId: string,
): Promise<AgentCandidateWorkspaceSnapshotEvidence> {
  const captured = await captureAgentCandidateWorkspaceFiles(
    [
      {
        path: 'helper.mjs',
        mode: 0o644,
        bytes: Uint8Array.from(Buffer.from('portable workspace\n')),
      },
    ],
    { artifactPersistence: { executionId, outputArtifacts: artifacts } },
  )
  return captured.snapshot
}

function capabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: true,
      systemPrompt: { replace: true, append: true },
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: {
        files: true,
        instructions: true,
        tools: true,
        skills: true,
        agents: true,
        commands: true,
      },
      hooks: true,
      modes: true,
      runtimeUpdate: true,
      validation: true,
    },
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: true, list: true, messages: true },
    workspace: { read: true, write: true, exec: true, git: true, upload: true, download: true },
    branching: { checkpoint: true, fork: true },
    placement: true,
    usage: true,
    confidential: true,
  }
}

function providerFor(
  stream: (input: AgentTurnInput) => AsyncIterable<AgentEnvironmentEvent>,
  options: {
    readonly id?: string
    readonly create?: () => void
    readonly destroy?: () => Promise<void>
  } = {},
): { provider: AgentEnvironmentProvider; environment: AgentEnvironment; destroyed: () => number } {
  let destroyCount = 0
  const environment: AgentEnvironment = {
    id: options.id ?? 'retention-environment',
    provider: 'provider-workspace-retention-test',
    status: async () => 'running',
    stream,
    async destroy() {
      destroyCount += 1
      await options.destroy?.()
    },
  }
  const provider: AgentEnvironmentProvider = {
    name: environment.provider,
    capabilities,
    async create() {
      options.create?.()
      return environment
    },
  }
  return { provider, environment, destroyed: () => destroyCount }
}

function pendingRetainedProvider(): AgentEnvironmentProvider {
  const providerName = 'retained-provider-workspace-retention-test'
  let destroyCount = 0
  let environment: AgentEnvironment | undefined
  const provider: AgentEnvironmentProvider = {
    name: providerName,
    capabilities: () => ({
      ...capabilities(),
      retainedControl: {
        exactRunIdentity: true,
        resultIdentity: true,
        eventIdentity: true,
        cancellationIdempotency: true,
      },
    }),
    async create() {
      environment = {
        id: 'retained-workspace-environment',
        provider: providerName,
        status: async () => 'running',
        async *stream() {
          yield* []
        },
        async dispatch(input) {
          const sessionId = input.sessionId ?? 'retained-workspace-session'
          const executionId = input.executionId ?? 'retained-workspace-execution'
          const controlRef: AgentExactRunControlRef = {
            runId: 'retained-workspace-run',
            provider: providerName,
            environmentId: 'retained-workspace-environment',
            sessionId,
            executionId,
            requestDigest: `sha256:${'1'.repeat(64)}`,
          }
          return { id: sessionId, provider: providerName, controlRef }
        },
        session(sessionId, options) {
          const controlRef = options?.controlRef
          if (!controlRef) throw new Error('retained test requires an exact control reference')
          return {
            id: sessionId,
            controlRef,
            status: async () => 'running',
            async *events() {
              yield* []
            },
            async result() {
              throw new Error('retained result unavailable')
            },
            async cancel() {},
            async prompt() {
              return { text: '', success: true, sessionId: controlRef.sessionId }
            },
          }
        },
        async destroy() {
          destroyCount += 1
        },
      }
      return environment
    },
    async get(id) {
      return environment?.id === id ? environment : null
    },
  }
  return provider
}

function doneStream(text = 'done') {
  return async function* (): AsyncIterable<AgentEnvironmentEvent> {
    yield { type: 'done', data: { finalText: text } }
  }
}

describe('provider workspace retention', () => {
  it('captures and verifies a normal stream before destroying its source', async () => {
    const artifacts = artifactStore()
    const profile = testProfile('retention-normal')
    const { provider, environment, destroyed } = providerFor(doneStream())
    let seen: ProviderWorkspaceRetentionContext | undefined
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          seen = context
          return await snapshot(artifacts, context.executionId)
        },
      },
    })({ profile, harness: null }, { signal: new AbortController().signal, seams: {} })

    const events = executor.execute('task', new AbortController().signal)
    for await (const _event of events as AsyncIterable<UsageEvent>) {
      // Drain the provider lifecycle.
    }

    const out = executor.resultArtifact().out as ProviderLeafOut
    expect(out.workspaceSnapshot).toBeDefined()
    expect(seen?.environment).toBe(environment)
    expect(seen?.executionId).toBeTruthy()
    expect(seen?.profile).toBe(profile)
    expect(seen?.signal.aborted).toBe(false)
    expect(destroyed()).toBe(1)
  })

  it('refuses executor reuse while a retained source environment is still live', async () => {
    const artifacts = artifactStore()
    let creates = 0
    let failCreate = false
    const { provider, destroyed } = providerFor(doneStream(), {
      create: () => {
        creates += 1
        if (failCreate) throw new Error('next create failed')
      },
    })
    const executor = providerAsExecutor(provider, {
      destroyOnSettle: false,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    })(
      { profile: testProfile('retention-live-reuse'), harness: null },
      {
        signal: new AbortController().signal,
        seams: {},
      },
    )
    for await (const _event of executor.execute(
      'first',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Leave the source live with destroyOnSettle=false.
    }
    expect(creates).toBe(1)

    await expect(async () => {
      for await (const _event of executor.execute(
        'second',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // The reuse guard runs before provider.create.
      }
    }).rejects.toThrow(/still live/)
    expect(creates).toBe(1)
    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: true })
    expect(destroyed()).toBe(1)

    failCreate = true
    await expect(async () => {
      for await (const _event of executor.execute(
        'third',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // The provider create fails before a new environment is published.
      }
    }).rejects.toThrow('next create failed')
    expect(creates).toBe(2)
    await expect(executor.teardown('brutalKill')).resolves.toEqual({ destroyed: true })
    expect(destroyed()).toBe(1)
  })

  it('keeps a failed stream source alive because no settled artifact can carry its snapshot', async () => {
    const artifacts = artifactStore()
    const { provider, destroyed } = providerFor(async function* () {
      yield* []
      throw new Error('stream failed')
    })
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    })(
      { profile: testProfile('retention-failed'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )

    await expect(async () => {
      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // The stream fails before it yields a terminal event.
      }
    }).rejects.toThrow('stream failed')
    expect(destroyed()).toBe(0)
    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    expect(destroyed()).toBe(0)
  })

  it('keeps a cancelled stream source alive and records a cancelled capture outcome', async () => {
    const artifacts = artifactStore()
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const { provider, destroyed } = providerFor(async function* (input) {
      started()
      await new Promise<never>((_resolve, reject) => {
        if (input.signal?.aborted) {
          reject(new Error('stream cancelled'))
          return
        }
        input.signal?.addEventListener('abort', () => reject(new Error('stream cancelled')), {
          once: true,
        })
      })
    })
    let outcome: unknown
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => {
          outcome = context.outcome
          return snapshot(artifacts, context.executionId)
        },
      },
    })(
      { profile: testProfile('retention-cancelled'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    const signal = new AbortController()
    const running = (async () => {
      for await (const _event of executor.execute(
        'task',
        signal.signal,
      ) as AsyncIterable<UsageEvent>) {
        // Wait for cancellation.
      }
    })()
    await startedPromise
    await executor.cancel?.({ operationId: 'cancel-retention' })
    await expect(running).rejects.toThrow()
    expect(outcome).toMatchObject({ success: false, errorCode: 'cancelled' })
    expect(destroyed()).toBe(0)
  })

  it.each(['corrupt', 'missing'] as const)(
    'preserves the source when the %s archive cannot be read',
    async (kind) => {
      const artifacts = artifactStore()
      const stored = await snapshot(artifacts, `persist-${kind}`)
      if (!('locator' in stored.archive))
        throw new Error('test snapshot must use a durable archive')
      const key = stored.archive.sha256.slice(7)
      if (kind === 'corrupt') artifacts.bytes.set(key, Uint8Array.from(Buffer.from('corrupt')))
      else artifacts.bytes.delete(key)
      const { provider, destroyed } = providerFor(doneStream())
      const executor = providerAsExecutor(provider, {
        workspaceRetention: {
          timeoutMs: 5_000,
          artifacts,
          capture: async () => stored,
        },
      })(
        { profile: testProfile(`retention-${kind}`), harness: null },
        { signal: new AbortController().signal, seams: {} },
      )

      await expect(async () => {
        for await (const _event of executor.execute(
          'task',
          new AbortController().signal,
        ) as AsyncIterable<UsageEvent>) {
          // Verification fails before source destruction.
        }
      }).rejects.toThrow(/artifact|archive|digest|length/)
      expect(destroyed()).toBe(0)
      await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    },
  )

  it('bounds a late capture and never lets its completion authorize destruction', async () => {
    const artifacts = artifactStore()
    const { provider, destroyed } = providerFor(doneStream())
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 10,
        artifacts,
        async capture(context) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return await snapshot(artifacts, context.executionId)
        },
      },
    })(
      { profile: testProfile('retention-timeout'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )

    await expect(async () => {
      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // The capture barrier times out after the stream has settled.
      }
    }).rejects.toThrow(/timed out|aborted/)
    expect(destroyed()).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(destroyed()).toBe(0)
  })

  it('coalesces duplicate teardown calls after one verified capture', async () => {
    const artifacts = artifactStore()
    let releaseDestroy!: () => void
    const destroyGate = new Promise<void>((resolve) => {
      releaseDestroy = resolve
    })
    const { provider, destroyed } = providerFor(doneStream(), {
      destroy: async () => await destroyGate,
    })
    const executor = providerAsExecutor(provider, {
      destroyOnSettle: false,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    })(
      { profile: testProfile('retention-duplicate-teardown'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Keep the source alive until the explicit teardown calls below.
    }

    const first = executor.teardown('brutalKill')
    const second = executor.teardown('brutalKill')
    await Promise.resolve()
    expect(destroyed()).toBe(1)
    releaseDestroy()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { destroyed: true },
      { destroyed: true },
    ])
  })

  it('retries an ordinary teardown after a transient destroy failure', async () => {
    let attempts = 0
    const { provider, destroyed } = providerFor(doneStream(), {
      destroy: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('transient destroy failure')
      },
    })
    const executor = providerAsExecutor(provider, { destroyOnSettle: false })(
      { profile: testProfile('retention-retry'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Keep cleanup explicit so both attempts are observable.
    }

    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    await expect(executor.teardown('brutalKill')).resolves.toEqual({ destroyed: true })
    expect(destroyed()).toBe(2)
  })

  it('preserves the source when recapture finds changed live bytes after a failed destroy', async () => {
    const artifacts = artifactStore()
    let captures = 0
    let destroys = 0
    const { provider, destroyed } = providerFor(doneStream(), {
      destroy: async () => {
        destroys += 1
        if (destroys === 1) throw new Error('transient destroy failure')
      },
    })
    const executor = providerAsExecutor(provider, {
      destroyOnSettle: false,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          captures += 1
          return (
            await captureAgentCandidateWorkspaceFiles(
              [
                {
                  path: 'revision.txt',
                  mode: 0o644,
                  bytes: Uint8Array.from(Buffer.from(`revision-${captures}`)),
                },
              ],
              {
                artifactPersistence: {
                  executionId: context.executionId,
                  outputArtifacts: artifacts,
                },
              },
            )
          ).snapshot
        },
      },
    })(
      { profile: testProfile('retention-recapture'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Keep cleanup explicit.
    }

    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    expect(captures).toBe(2)
    expect(destroyed()).toBe(1)
  })

  it('keeps a retained failed execution alive through teardown and release', async () => {
    const artifacts = artifactStore()
    const provider = pendingRetainedProvider()
    const admissions: RetainedRunAdmission[] = []
    const retained: RetainedExecutorContext = {
      executionId: 'retained-workspace-execution',
      preserveEnvironment: true,
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {},
    }
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    })(
      { profile: testProfile('retention-retained-release'), harness: null },
      {
        signal: new AbortController().signal,
        seams: { [retainedExecutorSeamKey]: retained },
      },
    )

    await expect(async () => {
      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // The fixture omits a terminal event, so the retained execution remains pending.
      }
    }).rejects.toThrow(/retained result unavailable|requires reconciliation/)
    const receipts = await executor.releaseRetained?.(new AbortController().signal)
    expect(receipts).toHaveLength(1)
    expect(receipts?.[0]).toMatchObject({ destroyed: false })
    expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
  })

  it('detaches a mutable callback snapshot before verification and publication', async () => {
    const artifacts = artifactStore()
    const { provider } = providerFor(doneStream())
    let callbackSnapshot!: AgentCandidateWorkspaceSnapshotEvidence
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          callbackSnapshot = structuredClone(
            await snapshot(artifacts, context.executionId),
          ) as AgentCandidateWorkspaceSnapshotEvidence
          return callbackSnapshot
        },
      },
    })(
      { profile: testProfile('retention-detached'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Drain the normal stream.
    }
    const published = (executor.resultArtifact().out as ProviderLeafOut).workspaceSnapshot
    if (!published) throw new Error('expected published workspace snapshot')
    expect(published).not.toBe(callbackSnapshot)
    expect(Object.isFrozen(published)).toBe(true)
    ;(callbackSnapshot as { digest: string }).digest = `sha256:${'0'.repeat(64)}`
    expect(published.digest).not.toBe(callbackSnapshot.digest)
  })
})
