import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentInteractiveSessionControlClaim,
  type AgentInteractiveSessionControlClaimRequest,
  type AgentInteractiveSessionRef,
  AgentInteractiveSessionRefSchema,
  type AgentInteractiveSessionStart,
  type AgentInteractiveSessionStopCommand,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import {
  InteractiveSessionHandle,
  type InteractiveSessionHost,
  type SandboxInstance,
  type SandboxRuntimeCapabilities,
  type TerminalStream,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { sandboxClientAsProvider } from './environment-provider'
import {
  reconnectRetainedInteractiveRun,
  startRetainedInteractiveRun,
} from './retained-interactive'
import { claimRetainedInteractiveControl } from './retained-interactive-control'
import type { SandboxClient } from './types'

const profile: AgentProfile = {
  name: 'Sandbox interactive worker',
  harness: 'codex',
  model: { default: 'openai/gpt-5' },
}

describe('Sandbox interactive environment adapter', () => {
  it('reconstructs the public SDK terminal and preserves replay across detach', async () => {
    const fixture = interactiveSandboxFixture()
    const handle = await startRetainedInteractiveRun({
      provider: fixture.provider,
      environment: { profile, idempotencyKey: 'sandbox-interactive-environment' },
      interactiveIdempotencyKey: 'sandbox-interactive-process',
      initialPrompt: 'Inspect the workspace.',
      onAdmission: async () => {},
    })

    const firstControl = await claimRetainedInteractiveControl({
      handle,
      holderId: 'first-runtime',
    })
    const firstPending = handle.attach({ control: firstControl })
    const retryPending = handle.attach({ control: firstControl })
    const [first, retried] = await Promise.all([firstPending, retryPending])
    expect(retried).toBe(first)
    await first.input({ data: 'first input' })
    await first.detach()
    await expect(collect(first.events({ since: 0 }))).resolves.toEqual([
      { type: 'ready' },
      { type: 'output', seq: 1, data: 'one' },
      { type: 'output', seq: 2, data: 'two' },
    ])

    const reconnected = await reconnectRetainedInteractiveRun({
      provider: fixture.provider,
      ref: handle.ref,
    })
    if (!reconnected) throw new Error('expected the retained Sandbox session')
    const second = await reconnected.attach({ control: firstControl })
    await second.detach()
    await expect(collect(second.events({ since: 2 }))).resolves.toEqual([
      { type: 'output', seq: 3, data: 'three' },
    ])

    expect(fixture.attachCalls).toBe(2)
    expect(fixture.environmentReads).toBe(1)
    expect(fixture.closedConnections).toBe(2)
    expect(fixture.stopCalls).toBe(0)
    expect(fixture.inputs).toEqual(['first input'])
  })

  it('aborts an in-flight public SDK attach', async () => {
    const fixture = interactiveSandboxFixture({ hangAttach: true })
    const handle = await startRetainedInteractiveRun({
      provider: fixture.provider,
      environment: { profile, idempotencyKey: 'sandbox-abort-environment' },
      interactiveIdempotencyKey: 'sandbox-abort-process',
      onAdmission: async () => {},
    })
    const control = await claimRetainedInteractiveControl({
      handle,
      holderId: 'aborting-runtime',
    })
    const abort = new AbortController()
    const pending = handle.attach({ control }, { signal: abort.signal })
    await fixture.waitForAttach()
    abort.abort(new Error('stop interactive attach'))

    await expect(pending).rejects.toThrow('stop interactive attach')
    expect(fixture.attachCalls).toBe(1)
  })

  it('omits interactive methods when the deployment does not claim them', async () => {
    const fixture = interactiveSandboxFixture({ deploymentCapabilities: null })
    const environment = await fixture.provider.create({ profile })

    expect(environment.capabilities?.interactiveAgent).toBeUndefined()
    expect(environment.startInteractive).toBeUndefined()
    expect(environment.interactive).toBeUndefined()
  })

  it('fails closed when deployment capability discovery fails', async () => {
    const fixture = interactiveSandboxFixture({
      deploymentCapabilities: new Error('capability endpoint unavailable'),
    })
    const environment = await fixture.provider.create({ profile })

    expect(environment.capabilities?.interactiveAgent).toBeUndefined()
    expect(environment.startInteractive).toBeUndefined()
    expect(environment.interactive).toBeUndefined()
  })

  it('does not advertise retained sessions without environment rediscovery', async () => {
    const fixture = interactiveSandboxFixture({ rediscover: false })

    await expect(fixture.provider.capabilities()).resolves.not.toHaveProperty('interactiveAgent')
    expect(fixture.provider.get).toBeUndefined()
  })

  it('disables interactive controls when the SDK lacks the exact terminal adapter', async () => {
    const fixture = interactiveSandboxFixture({ exactTerminalAdapter: false })
    const environment = await fixture.provider.create({ profile })

    expect(environment.capabilities?.interactiveAgent).toBeUndefined()
    expect(environment.startInteractive).toBeUndefined()
    expect(environment.interactive).toBeUndefined()
  })

  it('does not publish a process that settled during start', async () => {
    const fixture = interactiveSandboxFixture({ settledOnStart: true })

    await expect(
      startRetainedInteractiveRun({
        provider: fixture.provider,
        environment: { profile, idempotencyKey: 'sandbox-settled-environment' },
        interactiveIdempotencyKey: 'sandbox-settled-process',
        onAdmission: async () => {},
      }),
    ).rejects.toThrow('settled before attachment')
  })
})

function interactiveSandboxFixture(
  options: {
    exactTerminalAdapter?: boolean
    hangAttach?: boolean
    rediscover?: boolean
    settledOnStart?: boolean
    deploymentCapabilities?: SandboxRuntimeCapabilities | Error | null
  } = {},
): {
  provider: ReturnType<typeof sandboxClientAsProvider>
  readonly attachCalls: number
  readonly environmentReads: number
  readonly closedConnections: number
  readonly stopCalls: number
  readonly inputs: string[]
  waitForAttach(): Promise<void>
} {
  let ref: AgentInteractiveSessionRef | undefined
  let control: AgentInteractiveSessionControlClaim | undefined
  let generation = 1
  let attachCalls = 0
  let environmentReads = 0
  let closedConnections = 0
  let stopCalls = 0
  const inputs: string[] = []

  const host = {
    async _startInteractive(_id: string, request: AgentInteractiveSessionStart) {
      ref ??= interactiveRef(request)
      control ??= controlFor(ref, 'sandbox-start', generation)
      if (options.settledOnStart) {
        return {
          state: 'exited' as const,
          ref,
          control,
          endedAt: '2026-08-28T00:00:01.000Z',
          reason: 'exited' as const,
          exitCode: 0,
        }
      }
      return { state: 'running' as const, ref, control, streamUrl: '/terminal' }
    },
    async _sendInteractivePrompt(
      _id: string,
      command: { operationId: string; requestDigest: string },
    ) {
      return {
        ...command,
        ref: requiredRef(ref),
        control: requiredControl(control),
        status: 'accepted' as const,
      }
    },
    async _stopInteractive(_id: string, command: AgentInteractiveSessionStopCommand) {
      stopCalls += 1
      return { ...command, status: 'accepted' as const, effect: 'stopped' as const }
    },
    async _stopInteractiveLifecycle() {
      const exactRef = requiredRef(ref)
      return {
        operationId: 'sandbox-lifecycle-stop',
        requestDigest: digest('e'),
        ref: exactRef,
        control: requiredControl(control),
        status: 'accepted' as const,
        effect: 'stopped' as const,
      }
    },
    async _claimInteractiveControl(
      _id: string,
      request: AgentInteractiveSessionControlClaimRequest,
    ) {
      const exactRef = requiredRef(ref)
      if (request.expectedGeneration !== generation) {
        return {
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          ref: exactRef,
          status: 'conflict' as const,
          conflictReason: 'generation_mismatch' as const,
          currentGeneration: generation,
        }
      }
      generation += 1
      control = controlFor(exactRef, request.holderId, generation)
      return {
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        ref: exactRef,
        status: 'accepted' as const,
        control,
      }
    },
    async _releaseInteractiveControl() {},
    async _interactiveStatus() {
      return { state: 'running' as const, ref: requiredRef(ref) }
    },
    async _attachInteractive(
      _id: string,
      _ref: AgentInteractiveSessionRef,
      request: {
        handlers?: {
          onReady?: (ready: ReturnType<typeof terminalReady>) => void
          onOutput?: (sequence: number, bytes: Uint8Array) => void
        }
      },
      requestOptions?: { signal?: AbortSignal },
    ): Promise<TerminalStream> {
      attachCalls += 1
      if (options.hangAttach) {
        await waitForAbort(requestOptions?.signal)
      }
      const ready = terminalReady(attachCalls)
      request.handlers?.onReady?.(ready)
      const output = attachCalls === 1 ? ['one', 'two'] : ['one', 'two', 'three']
      for (const [index, text] of output.entries()) {
        request.handlers?.onOutput?.(index + 1, new TextEncoder().encode(text))
      }
      return {
        connectionId: ready.connectionId,
        isOpen: true,
        ready,
        write(data: string) {
          inputs.push(data)
        },
        resize() {},
        async close() {
          closedConnections += 1
        },
      } as unknown as TerminalStream
    },
    async _interactiveTerminalInfo(_id: string, terminalId: string) {
      return {
        sessionId: terminalId,
        connectionId: `connection-${attachCalls}`,
        name: 'Sandbox agent',
        shell: '/bin/bash',
        command: 'codex',
        cwd: '/workspace',
        cols: 120,
        rows: 40,
        createdAt: '2026-08-28T00:00:00.000Z',
        lastActivityAt: '2026-08-28T00:00:01.000Z',
        isRunning: true,
      }
    },
  } as unknown as InteractiveSessionHost

  const box = {
    id: 'sandbox-interactive',
    status: 'running',
    async capabilities() {
      if (options.deploymentCapabilities instanceof Error) {
        throw options.deploymentCapabilities
      }
      return options.deploymentCapabilities === undefined
        ? sandboxRuntimeCapabilities()
        : options.deploymentCapabilities
    },
    session(sessionId: string) {
      if (options.exactTerminalAdapter === false) {
        return {
          id: sessionId,
          interactive: () => ({}),
        }
      }
      return {
        id: sessionId,
        interactive(handleOptions = {}) {
          return new InteractiveSessionHandle(host, sessionId, handleOptions)
        },
      }
    },
    async *streamPrompt() {},
    async snapshot() {
      return { snapshotId: 'snapshot-1' }
    },
    async delete() {},
  } as unknown as SandboxInstance
  const client = {
    async create() {
      return box
    },
    ...(options.rediscover === false
      ? {}
      : {
          async get(id: string) {
            environmentReads += 1
            return id === box.id ? box : null
          },
        }),
  } as SandboxClient & { get?(id: string): Promise<SandboxInstance | null> }
  const provider = sandboxClientAsProvider(client)

  return Object.defineProperties(
    {
      provider,
      inputs,
      async waitForAttach() {
        for (let attempt = 0; attempt < 40 && attachCalls === 0; attempt += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        expect(attachCalls).toBe(1)
      },
    },
    {
      attachCalls: { get: () => attachCalls },
      environmentReads: { get: () => environmentReads },
      closedConnections: { get: () => closedConnections },
      stopCalls: { get: () => stopCalls },
    },
  ) as ReturnType<typeof interactiveSandboxFixture>
}

function interactiveRef(request: AgentInteractiveSessionStart): AgentInteractiveSessionRef {
  const preparationReceipt = {
    kind: 'agent-execution-preparation' as const,
    schemaVersion: 1 as const,
    preparationId: 'sandbox-preparation',
    requestDigest: request.run.requestDigest,
    authoredProfileDigest: request.requestedProfileDigest,
    effectiveProfileDigest: request.requestedProfileDigest,
    backend: 'sandbox',
    harness: request.profile.harness,
    harnessVersion: '1.0.0',
    resolvedModel: {
      requested: request.profile.model?.default ?? 'default',
      resolved: request.profile.model?.default ?? 'default',
    },
    workspace: {
      leaseId: 'sandbox-workspace-lease',
      provider: request.run.provider,
      identityDigest: digest('1'),
      isolation: 'per-run' as const,
      sourceSnapshotDigest: digest('2'),
      sourceSnapshotPolicy: {
        kind: 'provider-declared' as const,
        name: 'sandbox-source',
        version: 1,
        digest: digest('3'),
      },
      preparedWorkspaceDigest: digest('4'),
      profileActivationDigest: digest('5'),
    },
    axisResults: [],
    executionPlanDigest: digest('6'),
    materializer: { name: 'sandbox', version: '1' },
    expiresAtMs: 4_102_444_800_000,
  }
  return AgentInteractiveSessionRefSchema.parse({
    run: request.run,
    preparationReceipt: {
      ...preparationReceipt,
      digest: canonicalCandidateDigest(preparationReceipt),
    },
    incarnationId: 'sandbox-incarnation',
    startedAt: '2026-08-28T00:00:00.000Z',
  })
}

function controlFor(
  ref: AgentInteractiveSessionRef,
  holderId: string,
  generation: number,
): AgentInteractiveSessionControlClaim {
  return {
    refDigest: canonicalCandidateDigest(ref),
    generation,
    leaseId: `sandbox-control-${generation}`,
    holderId,
    expiresAt: '2099-01-01T00:00:00.000Z',
  }
}

function terminalReady(attachCount: number) {
  return {
    connectionId: `connection-${attachCount}`,
    sessionId: 'retained-session:sandbox-interactive-environment:sandbox-interactive-process',
    restored: attachCount > 1,
    detachTimeoutMs: 300_000,
    attachCount,
    cursors: { earliest: 0, latest: attachCount === 1 ? 2 : 3 },
  }
}

function sandboxRuntimeCapabilities(): SandboxRuntimeCapabilities {
  return {
    schema: 1,
    agentInterface: '1.6.0',
    sidecarVersion: 'test',
    image: 'test',
    dispatch: { runControlRef: true, executionIdOnAdmission: true },
    cancel: { canonicalRunCancellation: true, digestBound: true, idempotent: true },
    runs: { executionScopedStatus: true, eventReplay: true },
    interactions: { responseDedupe: true },
    interactiveAgent: {
      start: true,
      control: true,
      status: true,
      attach: true,
      reattach: true,
      sendPrompt: true,
      input: true,
      resize: true,
      stop: true,
    },
  }
}

function requiredRef(ref: AgentInteractiveSessionRef | undefined): AgentInteractiveSessionRef {
  if (!ref) throw new Error('interactive process did not start')
  return ref
}

function requiredControl(
  control: AgentInteractiveSessionControlClaim | undefined,
): AgentInteractiveSessionControlClaim {
  if (!control) throw new Error('interactive process has no control')
  return control
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64).slice(0, 64)}`
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const rejectForAbort = () => {
      reject(signal?.reason instanceof Error ? signal.reason : new Error('attach aborted'))
    }
    signal?.addEventListener('abort', rejectForAbort, { once: true })
    if (signal?.aborted) rejectForAbort()
  })
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const event of events) values.push(event)
  return values
}
