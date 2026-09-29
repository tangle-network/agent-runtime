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
import type { SandboxInstance } from '@tangle-network/sandbox'
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
  providerAsSandboxClient,
} from './environment-provider'
import type { ProviderWorkspaceCaptureReceipt } from './provider-workspace-retention'
import type { RetainedRunAdmission } from './retained-run-types'
import { runAgentRounds } from './run-loop'
import { captureBeforeDestroy } from './sandbox-evidence-retention'
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
  it.each(['sse', 'poll'] as const)(
    'captures a runAgentRounds box through the %s execution path',
    async (streaming) => {
      const artifacts = artifactStore()
      const order: string[] = []
      let recordedSnapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined
      let polledSessionId: string | undefined
      const box = {
        id: 'loop-box',
        status: 'running',
        async *streamPrompt(_prompt: string, options: { sessionId: string; executionId: string }) {
          yield {
            type: 'result',
            data: {
              finalText: 'done',
              runtimeSessionId: options.sessionId,
              executionId: options.executionId,
            },
          }
          yield {
            type: 'done',
            data: {
              outcome: { type: 'completed' },
              runtimeSessionId: options.sessionId,
              executionId: options.executionId,
            },
          }
        },
        async dispatchPrompt(_prompt: string, options: { sessionId: string; executionId: string }) {
          polledSessionId = options.sessionId
          expect(options.executionId).toBeTruthy()
          return { sessionId: options.sessionId }
        },
        session(id: string) {
          return {
            async result() {
              expect(id).toBe(polledSessionId)
              return { response: 'done', success: true, status: 'success' }
            },
          }
        },
        async delete() {
          order.push('delete')
        },
      } as unknown as SandboxInstance
      await runAgentRounds({
        driver: {
          async plan(_task: string, history: readonly unknown[]) {
            return history.length ? [] : ['task']
          },
          decide: () => 'done' as const,
        },
        agentRun: { profile: testProfile('loop-retention'), taskToPrompt: (task: string) => task },
        output: { parse: () => 'done' },
        task: 'task',
        runId: 'loop-1',
        maxIterations: 1,
        lineage: { streaming },
        ctx: {
          sandboxClient: {
            async create() {
              return box
            },
          },
        },
        evidenceRetention: {
          timeoutMs: 5_000,
          artifacts,
          async capture(context) {
            order.push('capture')
            expect(context.sandboxSessionIds).toHaveLength(1)
            const sessionId = context.sandboxSessionIds[0]!
            if (streaming === 'poll') expect(sessionId).toBe(polledSessionId)
            const executionId = context.sessionExecutionIds[sessionId]?.[0]
            expect(executionId).toBeTruthy()
            return {
              snapshot: await snapshot(artifacts, context.executionId),
              provenance: {
                status: 'reported' as const,
                environmentId: 'loop-box',
                executionId: 'loop-1',
                workspace: {
                  scannedFiles: 1,
                  scannedDirectories: 0,
                  reportedFiles: 1,
                  reportedDirectories: 0,
                  complete: true,
                },
                sessions: [
                  {
                    id: sessionId,
                    executionId: 'loop-1',
                    executionIds: [executionId!],
                    eventCountsByExecutionId: { [executionId!]: 2 },
                    backendType: 'opencode',
                    transportEvents: 'complete',
                    eventCount: 2,
                    messageCount: 1,
                    nativeSessionId: null,
                    sidecarImageDigest: `sha256:${'a'.repeat(64)}`,
                    sidecarBundleRevision: 'b'.repeat(40),
                    nativeStore: {
                      scope: 'session' as const,
                      roots: [{ scope: 'session-home' as const, path: '/home/agent' }],
                      inventory: {
                        scannedFiles: 1,
                        reportedFiles: 1,
                        scannedDirectories: 0,
                        reportedDirectories: 0,
                        scannedSymlinks: 0,
                        reportedSymlinks: 0,
                        skippedEntries: 0,
                      },
                      complete: true,
                      entries: [],
                      excludedPaths: [],
                    },
                    processStreams: {
                      complete: true,
                      streamCount: 1,
                      stdinBytes: 0,
                      stdoutBytes: 1,
                      stderrBytes: 0,
                      protocolBytes: 0,
                    },
                    nativeEvents: { complete: true, count: 1 },
                  },
                ],
                missing: [],
              },
            }
          },
          async record(receipt) {
            recordedSnapshot = receipt.snapshot
            order.push('record')
          },
        },
      })
      expect(order).toEqual(['capture', 'record', 'delete'])
      expect(recordedSnapshot).toBeDefined()
      const archive = recordedSnapshot!.archive
      if (!('locator' in archive)) throw new Error('retained archive lacks durable locator')
      const reopenedArchive = await artifacts.read(archive)
      expect(reopenedArchive.byteLength).toBeGreaterThan(0)
    },
  )
  it('records a verified raw Sandbox receipt before deleting its box', async () => {
    const artifacts = artifactStore()
    const order: string[] = []
    const box = {
      id: 'raw-box',
      async delete() {
        order.push('delete')
      },
    } as unknown as SandboxInstance
    const profile = testProfile('raw-box')
    const context = {
      box,
      executionId: 'run-1',
      profile,
      sandboxSessionIds: ['sandbox-1'],
      sessionExecutionIds: { 'sandbox-1': ['execution-1'] },
    }
    const receipt = await captureBeforeDestroy(
      {
        timeoutMs: 5_000,
        artifacts,
        async capture() {
          order.push('capture')
          return {
            snapshot: await snapshot(artifacts, 'run-1'),
            provenance: {
              status: 'reported' as const,
              environmentId: 'raw-box',
              executionId: 'run-1',
              workspace: {
                scannedFiles: 1,
                scannedDirectories: 0,
                reportedFiles: 1,
                reportedDirectories: 0,
                complete: true,
              },
              sessions: [
                {
                  id: 'sandbox-1',
                  executionId: 'run-1',
                  executionIds: ['execution-1'],
                  eventCountsByExecutionId: { 'execution-1': 1 },
                  backendType: 'opencode',
                  transportEvents: 'complete',
                  eventCount: 1,
                  messageCount: 1,
                  nativeSessionId: null,
                  sidecarImageDigest: `sha256:${'a'.repeat(64)}`,
                  sidecarBundleRevision: 'b'.repeat(40),
                  nativeStore: {
                    scope: 'session' as const,
                    roots: [{ scope: 'session-home' as const, path: '/home/agent' }],
                    inventory: {
                      scannedFiles: 1,
                      reportedFiles: 1,
                      scannedDirectories: 0,
                      reportedDirectories: 0,
                      scannedSymlinks: 0,
                      reportedSymlinks: 0,
                      skippedEntries: 0,
                    },
                    complete: true,
                    entries: [],
                    excludedPaths: [],
                  },
                  processStreams: {
                    complete: true,
                    streamCount: 1,
                    stdinBytes: 0,
                    stdoutBytes: 1,
                    stderrBytes: 0,
                    protocolBytes: 0,
                  },
                  nativeEvents: { complete: true, count: 1 },
                },
              ],
              missing: [],
            },
          }
        },
        async record() {
          order.push('record')
        },
      },
      context,
      async () => {
        await box.delete()
      },
    )
    expect(order).toEqual(['capture', 'record', 'delete'])
    expect(receipt).toMatchObject({
      boxId: 'raw-box',
      coverageComplete: true,
      sessionExecutionIds: { 'sandbox-1': ['execution-1'] },
    })
  })
  it('keeps a box when a dispatched execution is absent from the retained raw evidence', async () => {
    const artifacts = artifactStore()
    const order: string[] = []
    const box = {
      id: 'held-box',
      async delete() {
        order.push('delete')
      },
    } as unknown as SandboxInstance
    await expect(
      captureBeforeDestroy(
        {
          timeoutMs: 5_000,
          artifacts,
          async capture() {
            return {
              snapshot: await snapshot(artifacts, 'held-run'),
              provenance: {
                status: 'reported' as const,
                environmentId: 'held-box',
                executionId: 'held-run',
                workspace: {
                  scannedFiles: 0,
                  scannedDirectories: 0,
                  reportedFiles: 0,
                  reportedDirectories: 0,
                  complete: true,
                },
                sessions: [],
                missing: [],
              },
            }
          },
          async record(receipt) {
            expect(receipt.coverageComplete).toBe(false)
            expect(receipt.incompleteReason).toContain('session-1')
            order.push('record')
          },
        },
        {
          box,
          executionId: 'held-run',
          profile: testProfile('held-box'),
          sandboxSessionIds: ['session-1'],
          sessionExecutionIds: { 'session-1': ['execution-1'] },
        },
        async () => {
          await box.delete()
        },
      ),
    ).rejects.toThrow('session-1')
    expect(order).toEqual(['record'])
  })

  it.each([
    ['complete', true, 'native-1'],
    ['missing-attempts', false, null],
    ['identity-conflict', false, null],
    ['wrong-execution', false, null],
    ['missing-process', false, null],
  ] as const)(
    'reconciles %s attempt evidence before deleting the source',
    async (variant, expectedComplete, expectedNativeSessionId) => {
      const artifacts = artifactStore()
      const { provider, destroyed } = providerFor(doneStream())
      const executor = providerAsExecutor(provider, {
        workspaceRetention: {
          timeoutMs: 5_000,
          requireCompleteProvenance: true,
          artifacts,
          async capture(context) {
            return {
              snapshot: await snapshot(artifacts, context.executionId),
              provenance: {
                status: 'reported' as const,
                environmentId: context.environment.id,
                executionId: context.executionId,
                workspace: {
                  scannedFiles: 1,
                  scannedDirectories: 0,
                  reportedFiles: 1,
                  reportedDirectories: 0,
                  complete: true,
                },
                sessions: [
                  {
                    id: 'sandbox-session-1',
                    executionId: context.executionId,
                    executionIds: ['sidecar-execution-1'],
                    eventCountsByExecutionId: { 'sidecar-execution-1': 1 },
                    backendType: 'opencode',
                    transportEvents: 'complete',
                    eventCount: 1,
                    messageCount: 1,
                    nativeSessionId: variant === 'identity-conflict' ? 'other-native' : null,
                    sidecarImageDigest: `sha256:${'a'.repeat(64)}`,
                    sidecarBundleRevision: 'b'.repeat(40),
                    nativeStore: {
                      scope: 'session' as const,
                      roots: [{ scope: 'session-home' as const, path: '/home/agent' }],
                      inventory: {
                        scannedFiles: 1,
                        reportedFiles: 1,
                        scannedDirectories: 0,
                        reportedDirectories: 0,
                        scannedSymlinks: 0,
                        reportedSymlinks: 0,
                        skippedEntries: 0,
                      },
                      complete: true,
                      entries: [],
                      excludedPaths: [],
                    },
                    processStreams: {
                      complete: true,
                      streamCount: 1,
                      stdinBytes: 0,
                      stdoutBytes: 2,
                      stderrBytes: 0,
                      protocolBytes: 0,
                    },
                    nativeEvents: { complete: true, count: 1 },
                  },
                ],
                ...(variant === 'missing-attempts'
                  ? {}
                  : {
                      attempts: [
                        {
                          executionId:
                            variant === 'wrong-execution'
                              ? 'wrong-sidecar-execution'
                              : 'sidecar-execution-1',
                          ordinal: 1,
                          providerSessionId: 'provider-session-1',
                          nativeSessionIds: ['native-1'],
                          processIds: variant === 'missing-process' ? [] : ['process-1'],
                          outcome: 'succeeded' as const,
                          missingReasons: [],
                        },
                      ],
                    }),
                missing: [],
              },
            }
          },
        },
      })(
        { profile: testProfile('raw-evidence'), harness: null },
        { signal: new AbortController().signal, seams: {} },
      )
      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        /* drain */
      }
      const capture = (executor.resultArtifact().out as ProviderLeafOut).workspaceCapture
      expect(capture).toMatchObject({
        coverageComplete: expectedComplete,
        nativeSessionId: expectedNativeSessionId,
      })
      if (variant === 'complete') {
        expect(capture).toMatchObject({
          providerSessionId: null,
          provenance: {
            attempts: [
              {
                executionId: 'sidecar-execution-1',
                ordinal: 1,
                nativeSessionIds: ['native-1'],
              },
            ],
          },
        })
      } else {
        expect(capture?.incompleteReason).toBeTruthy()
      }
      expect(destroyed()).toBe(expectedComplete ? 1 : 0)
    },
  )
  it('keeps the source when complete native coverage is required but unavailable', async () => {
    const artifacts = artifactStore()
    const { provider, destroyed } = providerFor(doneStream())
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        requireCompleteProvenance: true,
        artifacts,
        async capture(context) {
          return {
            snapshot: await snapshot(artifacts, context.executionId),
            provenance: {
              status: 'reported' as const,
              environmentId: context.environment.id,
              workspace: {
                scannedFiles: 1,
                scannedDirectories: 0,
                reportedFiles: 1,
                reportedDirectories: 0,
                complete: true,
              },
              sessions: [
                {
                  id: 'session-1',
                  executionId: context.executionId,
                  transportEvents: 'complete',
                  eventCount: 1,
                  messageCount: 1,
                  nativeRollout: 'unavailable',
                },
              ],
              missing: ['Native rollout unavailable'],
            },
          }
        },
      },
    })(
      { profile: testProfile('strict-retention'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      /* drain */
    }
    const out = executor.resultArtifact().out as ProviderLeafOut
    expect(out.workspaceCapture).toMatchObject({
      coverageComplete: false,
      incompleteReason: expect.stringContaining('Native rollout unavailable'),
      snapshot: out.workspaceSnapshot,
    })
    expect((executor.resultArtifact() as { teardown?: unknown }).teardown).toMatchObject({
      failed: true,
      error: expect.stringContaining('Native rollout unavailable'),
    })
    expect(destroyed()).toBe(0)
  })
  it('retains the verified steerable archive and source when native coverage is incomplete', async () => {
    const artifacts = artifactStore()
    const profile = testProfile('steerable-strict-retention')
    const { provider, destroyed } = providerFor(doneStream())
    const receipts: ProviderWorkspaceCaptureReceipt[] = []
    const box = await providerAsSandboxClient(provider, {
      retentionIdentity: { executionId: 'node-strict', profile },
      onWorkspaceCaptured: (receipt) => {
        receipts.push(receipt)
      },
      workspaceRetention: {
        timeoutMs: 5_000,
        requireCompleteProvenance: true,
        artifacts,
        async capture(context) {
          return {
            snapshot: await snapshot(artifacts, context.executionId),
            provenance: {
              status: 'reported' as const,
              environmentId: context.environment.id,
              missing: ['Native rollout unavailable'],
            },
          }
        },
      },
    }).create({ backend: { type: 'opencode', profile } })
    await expect(box.delete()).rejects.toThrow('Native rollout unavailable')
    expect(destroyed()).toBe(0)
    expect(receipts).toMatchObject([
      {
        executionId: 'node-strict',
        environmentId: 'retention-environment',
        coverageComplete: false,
        incompleteReason: expect.stringContaining('Native rollout unavailable'),
      },
    ])
    expect(receipts[0]?.snapshot.archive).toBeDefined()
  })
  it('preserves a steerable source until its workspace is verified', async () => {
    const artifacts = artifactStore()
    const profile = testProfile('steerable-retention')
    const { provider, destroyed } = providerFor(doneStream())
    let accepted = false
    const receipts: unknown[] = []
    const box = await providerAsSandboxClient(provider, {
      retentionIdentity: { executionId: 'node-1', profile },
      onWorkspaceCaptured: (receipt) => {
        receipts.push(receipt)
      },
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          expect(context.executionId).toBe('node-1')
          expect(context.environment.id).toBe('retention-environment')
          expect(context.nativeSessionId).toBeNull()
          if (!accepted) throw new Error('archive unavailable')
          return snapshot(artifacts, context.executionId)
        },
      },
    }).create({ backend: { type: 'opencode', profile } })
    await expect(box.delete()).rejects.toThrow('archive unavailable')
    expect(destroyed()).toBe(0)
    accepted = true
    // A failed capture is not silently retried by the same box's cleanup path.
    await expect(box.delete()).rejects.toThrow('archive unavailable')
    expect(destroyed()).toBe(0)
    const retry = await providerAsSandboxClient(provider, {
      retentionIdentity: { executionId: 'node-1-retry', profile },
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    }).create({ backend: { type: 'opencode', profile } })
    await retry.delete()
    expect(destroyed()).toBe(1)
    expect(receipts).toEqual([])
  })
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
          return {
            snapshot: await snapshot(artifacts, context.executionId),
            provenance: {
              status: 'reported' as const,
              provider: context.environment.provider,
              environmentId: context.environment.id,
              missing: ['Native harness rollout unavailable'],
            },
          }
        },
      },
    })({ profile, harness: null }, { signal: new AbortController().signal, seams: {} })

    const events = executor.execute('task', new AbortController().signal)
    for await (const _event of events as AsyncIterable<UsageEvent>) {
      // Drain the provider lifecycle.
    }

    const out = executor.resultArtifact().out as ProviderLeafOut
    expect(out.workspaceSnapshot).toBeDefined()
    expect(out.workspaceCapture).toMatchObject({
      executionId: seen?.executionId,
      environmentId: environment.id,
      providerSessionId: null,
      nativeSessionId: null,
      snapshot: out.workspaceSnapshot,
      provenance: { status: 'reported', missing: ['Native harness rollout unavailable'] },
    })
    expect(seen?.environment).toBe(environment)
    expect(seen?.executionId).toBeTruthy()
    expect(seen?.profile).toBe(profile)
    expect(seen?.signal.aborted).toBe(false)
    expect(destroyed()).toBe(1)
  })

  it('refuses executor reuse while a retained source environment is still live', async () => {
    const artifacts = artifactStore()
    let creates = 0
    const { provider, destroyed } = providerFor(doneStream(), {
      create: () => {
        creates += 1
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

    await expect(async () => {
      for await (const _event of executor.execute(
        'third',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // A new run needs a new executor and materialization receipt.
      }
    }).rejects.toThrow(/already materialized/)
    expect(creates).toBe(1)
    await expect(executor.teardown('brutalKill')).resolves.toEqual({ destroyed: true })
    expect(destroyed()).toBe(1)
  })

  it('refuses a second provider run before creating an untracked environment', async () => {
    let creates = 0
    const { provider, destroyed } = providerFor(doneStream(), {
      create: () => {
        creates += 1
      },
    })
    const executor = providerAsExecutor(provider)(
      { profile: testProfile('cleanup-generation'), harness: null },
      {
        signal: new AbortController().signal,
        seams: {},
      },
    )

    for await (const _event of executor.execute(
      'first',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // The first stream destroys the shared environment.
    }
    await expect(async () => {
      for await (const _event of executor.execute(
        'second',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // A second create would have no pending materialization acknowledgement.
      }
    }).rejects.toThrow(/already materialized/)
    expect(creates).toBe(1)
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

  it('does not delete during a cancellation and teardown race', async () => {
    const artifacts = artifactStore()
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    let finish!: () => void
    const finishPromise = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { provider, destroyed } = providerFor(async function* () {
      started()
      // Deliberately ignore cancellation until teardown has returned.
      await finishPromise
      yield* []
      throw new Error('race cancelled')
    })
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    })(
      { profile: testProfile('retention-race'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    const running = (async () => {
      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // The source waits for the cancellation signal.
      }
    })()
    await startedPromise
    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    expect(destroyed()).toBe(0)
    finish()
    await expect(running).rejects.toThrow('race cancelled')
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

  it('preserves the settled failure outcome across a transient destroy retry', async () => {
    const artifacts = artifactStore()
    const outcomes: Array<ProviderWorkspaceRetentionContext['outcome']> = []
    let destroys = 0
    const { provider, destroyed } = providerFor(
      async function* () {
        yield {
          type: 'result',
          data: { finalText: 'failed', success: false, error: 'provider reported failure' },
        }
      },
      {
        destroy: async () => {
          destroys += 1
          if (destroys === 1) throw new Error('transient destroy failure')
        },
      },
    )
    const executor = providerAsExecutor(provider, {
      destroyOnSettle: false,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          outcomes.push(context.outcome)
          return await snapshot(artifacts, context.executionId)
        },
      },
    })(
      { profile: testProfile('retention-failure-outcome-retry'), harness: null },
      {
        signal: new AbortController().signal,
        seams: {},
      },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Keep cleanup explicit so both capture generations are observable.
    }

    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    await expect(executor.teardown('brutalKill')).resolves.toEqual({ destroyed: true })
    expect(outcomes).toHaveLength(2)
    expect(outcomes[0]).toMatchObject({ success: false, error: 'provider reported failure' })
    expect(outcomes[1]).toEqual(outcomes[0])
    expect(destroyed()).toBe(2)
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
