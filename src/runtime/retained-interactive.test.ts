import {
  type AgentInteractiveSession,
  type AgentInteractiveSessionRef,
  AgentInteractiveSessionRefSchema,
  type AgentInteractiveSessionStart,
  type AgentProfile,
  type AgentTerminalSession,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { RetainedInteractiveAdmissionError, RetainedInteractiveBindingError } from '../errors'
import {
  reconnectRetainedInteractiveRun,
  recoverRetainedInteractiveRun,
  startRetainedInteractiveRun,
} from './retained-interactive'
import type { RetainedInteractiveAdmission } from './retained-run-types'

const profile: AgentProfile = {
  name: 'Braid product engineer',
  harness: 'pi',
  model: {
    provider: 'tangle-router',
    default: 'deepseek/deepseek-v4-pro',
    reasoningEffort: 'high',
  },
}

describe('retained interactive runs', () => {
  it('starts one exact native TUI without dispatching a headless turn', async () => {
    const fixture = interactiveProvider()
    const admissions: RetainedInteractiveAdmission[] = []

    const handle = await startRetainedInteractiveRun({
      provider: fixture.provider,
      environment: { profile, idempotencyKey: 'workspace-1' },
      interactiveIdempotencyKey: 'native-turn-1',
      initialPrompt: 'Inspect this workspace.',
      cols: 120,
      rows: 40,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
    })

    expect(fixture.createCalls).toBe(1)
    expect(fixture.dispatchCalls).toBe(0)
    expect(fixture.processStarts).toBe(1)
    expect(admissions.map((admission) => admission.phase)).toEqual([
      'interactive_intent',
      'interactive_environment',
      'interactive_started',
    ])
    expect(admissions[0]).toMatchObject({
      phase: 'interactive_intent',
      provider: 'test-provider',
      idempotencyKey: 'workspace-1',
      interactiveIdempotencyKey: 'native-turn-1',
      sessionId: 'retained-session:workspace-1:native-turn-1',
      executionId: 'retained-execution:workspace-1:native-turn-1',
      runId: expect.stringMatching(/^interactive-intent-run:/u),
      requestedProfileDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    })
    expect(admissions[1]).toMatchObject({
      phase: 'interactive_environment',
      request: { initialPrompt: 'Inspect this workspace.', cols: 120, rows: 40 },
    })
    expect(handle.ref.run.sessionId).toBe('retained-session:workspace-1:native-turn-1')
    expect((await handle.status()).state).toBe('running')
    await handle.sendPrompt('Run tests.')
    expect(fixture.prompts).toEqual(['Run tests.'])
    expect((await handle.attach()).ref.parentExecutionId).toBe(handle.ref.run.executionId)
  })

  it('replays a persisted intent after a crash before environment create', async () => {
    const fixture = interactiveProvider()
    const admissions: RetainedInteractiveAdmission[] = []
    let crash = true
    const onAdmission = async (admission: RetainedInteractiveAdmission): Promise<void> => {
      admissions.push(admission)
      if (crash && admission.phase === 'interactive_intent') {
        throw new Error('simulated crash after intent')
      }
    }

    await expect(
      startRetainedInteractiveRun({
        provider: fixture.provider,
        environment: {
          profile,
          idempotencyKey: 'workspace-intent-crash',
          env: { API_TOKEN: 'secret-value' },
          secrets: ['sandbox-secret'],
          providerOptions: { credential: 'provider-secret' },
        },
        interactiveIdempotencyKey: 'native-intent-crash',
        initialPrompt: 'Inspect this workspace.',
        onAdmission,
      }),
    ).rejects.toMatchObject({ phase: 'interactive_intent' })

    const intent = admissions.find((admission) => admission.phase === 'interactive_intent')
    if (intent?.phase !== 'interactive_intent') {
      throw new Error('expected interactive intent admission')
    }
    expect(fixture.createCalls).toBe(0)
    expect(fixture.environmentCreations).toBe(0)
    expect(fixture.processStarts).toBe(0)
    expect(JSON.stringify(intent)).not.toContain('secret-value')
    expect(JSON.stringify(intent)).not.toContain('sandbox-secret')
    expect(JSON.stringify(intent)).not.toContain('provider-secret')

    crash = false
    const recovered = await recoverRetainedInteractiveRun({
      provider: fixture.provider,
      admission: intent,
      replay: {
        environment: {
          profile,
          idempotencyKey: 'workspace-intent-crash',
          env: { API_TOKEN: 'secret-value' },
          secrets: ['sandbox-secret'],
          providerOptions: { credential: 'provider-secret' },
        },
        interactiveIdempotencyKey: 'native-intent-crash',
        initialPrompt: 'Inspect this workspace.',
      },
      onAdmission,
    })

    expect(recovered?.ref.run.sessionId).toBe(
      'retained-session:workspace-intent-crash:native-intent-crash',
    )
    expect(fixture.createCalls).toBe(1)
    expect(fixture.environmentCreations).toBe(1)
    expect(fixture.processStarts).toBe(1)
    expect(admissions.map((admission) => admission.phase)).toEqual([
      'interactive_intent',
      'interactive_environment',
      'interactive_started',
    ])
  })

  it('reuses one environment after a crash after create but before environment admission', async () => {
    const fixture = interactiveProvider()
    const admissions: RetainedInteractiveAdmission[] = []
    let crash = true
    const onAdmission = async (admission: RetainedInteractiveAdmission): Promise<void> => {
      admissions.push(admission)
      if (crash && admission.phase === 'interactive_environment') {
        throw new Error('simulated crash after create')
      }
    }

    await expect(
      startRetainedInteractiveRun({
        provider: fixture.provider,
        environment: { profile, idempotencyKey: 'workspace-create-crash' },
        interactiveIdempotencyKey: 'native-create-crash',
        onAdmission,
      }),
    ).rejects.toMatchObject({ phase: 'interactive_environment' })

    const intent = admissions.find((admission) => admission.phase === 'interactive_intent')
    if (intent?.phase !== 'interactive_intent') {
      throw new Error('expected interactive intent admission')
    }
    expect(fixture.createCalls).toBe(1)
    expect(fixture.environmentCreations).toBe(1)
    expect(fixture.processStarts).toBe(0)

    crash = false
    const recovered = await recoverRetainedInteractiveRun({
      provider: fixture.provider,
      admission: intent,
      replay: {
        environment: { profile, idempotencyKey: 'workspace-create-crash' },
        interactiveIdempotencyKey: 'native-create-crash',
      },
      onAdmission,
    })

    expect(recovered).toBeDefined()
    expect(fixture.createCalls).toBe(2)
    expect(fixture.environmentCreations).toBe(1)
    expect(fixture.processStarts).toBe(1)
    expect(admissions.filter((admission) => admission.phase === 'interactive_intent')).toHaveLength(
      1,
    )
  })

  it('rejects changed replay material before provider create', async () => {
    const fixture = interactiveProvider()
    const admissions: RetainedInteractiveAdmission[] = []
    await startRetainedInteractiveRun({
      provider: fixture.provider,
      environment: { profile, idempotencyKey: 'workspace-replay-conflict' },
      interactiveIdempotencyKey: 'native-replay-conflict',
      initialPrompt: 'Original request.',
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
    })
    const intent = admissions.find((admission) => admission.phase === 'interactive_intent')
    if (intent?.phase !== 'interactive_intent') {
      throw new Error('expected interactive intent admission')
    }
    const createCallsBeforeReplay = fixture.createCalls
    const processStartsBeforeReplay = fixture.processStarts

    await expect(
      recoverRetainedInteractiveRun({
        provider: fixture.provider,
        admission: intent,
        replay: {
          environment: { profile, idempotencyKey: 'workspace-replay-conflict' },
          interactiveIdempotencyKey: 'native-replay-conflict',
          initialPrompt: 'Changed request.',
        },
        onAdmission: async () => {},
      }),
    ).rejects.toThrow('interactive intent conflicts with replay material')
    expect(fixture.createCalls).toBe(createCallsBeforeReplay)
    expect(fixture.processStarts).toBe(processStartsBeforeReplay)
  })

  it('recovers a lost start response by replaying the same process identity', async () => {
    const fixture = interactiveProvider({ loseFirstStartResponse: true })
    const admissions: RetainedInteractiveAdmission[] = []
    const onAdmission = async (admission: RetainedInteractiveAdmission): Promise<void> => {
      admissions.push(admission)
    }

    await expect(
      startRetainedInteractiveRun({
        provider: fixture.provider,
        environment: { profile, idempotencyKey: 'workspace-loss' },
        interactiveIdempotencyKey: 'native-loss',
        onAdmission,
      }),
    ).rejects.toThrow('start response lost')
    const environmentAdmission = admissions.find(
      (admission) => admission.phase === 'interactive_environment',
    )
    if (environmentAdmission?.phase !== 'interactive_environment') {
      throw new Error('expected interactive environment admission')
    }

    const recovered = await recoverRetainedInteractiveRun({
      provider: fixture.provider,
      admission: environmentAdmission,
      onAdmission,
    })

    expect(recovered?.ref.run).toEqual(environmentAdmission.request.run)
    expect(fixture.startCalls).toBe(2)
    expect(fixture.processStarts).toBe(1)
    expect(admissions.at(-1)).toMatchObject({
      phase: 'interactive_started',
      ref: { incarnationId: 'incarnation-1' },
    })
  })

  it('keeps the environment and does not start when its admission cannot persist', async () => {
    const fixture = interactiveProvider()
    let failure: unknown

    try {
      await startRetainedInteractiveRun({
        provider: fixture.provider,
        environment: { profile, idempotencyKey: 'workspace-environment-admission' },
        interactiveIdempotencyKey: 'native-environment-admission',
        onAdmission: async (admission) => {
          if (admission.phase === 'interactive_environment') {
            throw new Error('journal unavailable')
          }
        },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(RetainedInteractiveAdmissionError)
    expect((failure as RetainedInteractiveAdmissionError).phase).toBe('interactive_environment')
    expect(fixture.createCalls).toBe(1)
    expect(fixture.startCalls).toBe(0)
    expect(fixture.processStarts).toBe(0)
    expect(fixture.destroyCalls).toBe(0)
  })

  it('detaches and deeply freezes the exact record before the durability hook sees it', async () => {
    const fixture = interactiveProvider()
    let failure: unknown

    try {
      await startRetainedInteractiveRun({
        provider: fixture.provider,
        environment: { profile, idempotencyKey: 'workspace-immutable-admission' },
        interactiveIdempotencyKey: 'native-immutable-admission',
        onAdmission: async (admission) => {
          if (admission.phase !== 'interactive_environment') return
          expect(Object.isFrozen(admission)).toBe(true)
          expect(Object.isFrozen(admission.request)).toBe(true)
          expect(Object.isFrozen(admission.request.profile)).toBe(true)
          expect(Object.isFrozen(admission.request.profile.model)).toBe(true)
          ;(admission.request.profile as { name: string }).name = 'mutated by hook'
        },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(RetainedInteractiveAdmissionError)
    const admissionFailure = failure as RetainedInteractiveAdmissionError
    expect(admissionFailure.admission).toMatchObject({
      phase: 'interactive_environment',
      request: { profile: { name: 'Braid product engineer' } },
    })
    expect(Object.isFrozen(admissionFailure.admission)).toBe(true)
    if (admissionFailure.admission.phase === 'interactive_environment') {
      expect(Object.isFrozen(admissionFailure.admission.request.profile)).toBe(true)
    }
    expect(fixture.startCalls).toBe(0)
    expect(fixture.processStarts).toBe(0)
  })

  it('keeps and recovers one process when its started admission cannot persist', async () => {
    const fixture = interactiveProvider()
    const admissions: RetainedInteractiveAdmission[] = []
    let failure: unknown

    try {
      await startRetainedInteractiveRun({
        provider: fixture.provider,
        environment: { profile, idempotencyKey: 'workspace-started-admission' },
        interactiveIdempotencyKey: 'native-started-admission',
        onAdmission: async (admission) => {
          admissions.push(admission)
          if (admission.phase === 'interactive_started') {
            throw new Error('journal unavailable')
          }
        },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(RetainedInteractiveAdmissionError)
    expect((failure as RetainedInteractiveAdmissionError).phase).toBe('interactive_started')
    expect(fixture.processStarts).toBe(1)
    expect(fixture.destroyCalls).toBe(0)
    const environmentAdmission = admissions.find(
      (admission) => admission.phase === 'interactive_environment',
    )
    if (environmentAdmission?.phase !== 'interactive_environment') {
      throw new Error('expected interactive environment admission')
    }

    const recoveredAdmissions: RetainedInteractiveAdmission[] = []
    const recovered = await recoverRetainedInteractiveRun({
      provider: fixture.provider,
      admission: environmentAdmission,
      onAdmission: async (admission) => {
        recoveredAdmissions.push(admission)
      },
    })

    expect(recovered?.ref.run).toEqual(environmentAdmission.request.run)
    expect(fixture.startCalls).toBe(2)
    expect(fixture.processStarts).toBe(1)
    expect(recoveredAdmissions).toHaveLength(1)
    expect(recoveredAdmissions[0]).toMatchObject({
      phase: 'interactive_started',
      ref: { incarnationId: 'incarnation-1' },
    })
  })

  it('rejects corrupted recovery coordinates before contacting the process', async () => {
    const fixture = interactiveProvider()
    const admissions: RetainedInteractiveAdmission[] = []
    await startRetainedInteractiveRun({
      provider: fixture.provider,
      environment: { profile, idempotencyKey: 'workspace-recovery-binding' },
      interactiveIdempotencyKey: 'native-recovery-binding',
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
    })
    const environmentAdmission = admissions.find(
      (admission) => admission.phase === 'interactive_environment',
    )
    if (environmentAdmission?.phase !== 'interactive_environment') {
      throw new Error('expected interactive environment admission')
    }
    const startsBeforeRecovery = fixture.startCalls

    await expect(
      recoverRetainedInteractiveRun({
        provider: fixture.provider,
        admission: { ...environmentAdmission, environmentId: 'sandbox-other' },
        onAdmission: async () => {},
      }),
    ).rejects.toThrow('does not match its recovery coordinates')
    await expect(
      recoverRetainedInteractiveRun({
        provider: fixture.provider,
        admission: {
          ...environmentAdmission,
          interactiveIdempotencyKey: 'native-other',
        },
        onAdmission: async () => {},
      }),
    ).rejects.toThrow('does not match its recovery coordinates')
    expect(fixture.startCalls).toBe(startsBeforeRecovery)
  })

  it('reconnects only after the provider proves the exact incarnation', async () => {
    const fixture = interactiveProvider()
    const handle = await start(fixture.provider)
    const reconnected = await reconnectRetainedInteractiveRun({
      provider: fixture.provider,
      ref: handle.ref,
    })
    expect(reconnected?.ref).toEqual(handle.ref)

    fixture.statusRef = { ...handle.ref, incarnationId: 'replacement-incarnation' }
    let statusFailure: unknown
    try {
      await handle.status()
    } catch (error) {
      statusFailure = error
    }
    expect(statusFailure).toBeInstanceOf(RetainedInteractiveBindingError)
    const statusBinding = statusFailure as RetainedInteractiveBindingError
    expect(statusBinding.returned.status?.ref.incarnationId).toBe('replacement-incarnation')
    expect(Object.isFrozen(statusBinding.returned)).toBe(true)
    expect(Object.isFrozen(statusBinding.returned.status)).toBe(true)
    await expect(
      reconnectRetainedInteractiveRun({ provider: fixture.provider, ref: handle.ref }),
    ).rejects.toThrow('status for another interactive process')
  })

  it('rejects provider substitution and a terminal from another execution', async () => {
    const wrongStart = interactiveProvider({ returnWrongRun: true })
    let bindingFailure: unknown
    try {
      await start(wrongStart.provider)
    } catch (error) {
      bindingFailure = error
    }
    expect(bindingFailure).toBeInstanceOf(RetainedInteractiveBindingError)
    const binding = bindingFailure as RetainedInteractiveBindingError
    expect(binding.requested).toMatchObject({ profile })
    expect(binding.returned.ref?.run.runId).toBe(`${binding.requested.run.runId}-other`)
    expect(Object.isFrozen(binding.requested)).toBe(true)
    expect(Object.isFrozen(binding.requested.profile)).toBe(true)
    expect(Object.isFrozen(binding.returned)).toBe(true)
    expect(Object.isFrozen(binding.returned.ref)).toBe(true)
    expect(wrongStart.destroyCalls).toBe(0)

    const wrongTerminal = interactiveProvider({ returnWrongTerminal: true })
    const handle = await start(wrongTerminal.provider)
    await expect(handle.attach()).rejects.toThrow(
      'attached a terminal from another interactive run',
    )
  })

  it('does not copy malformed provider start data or destroy the environment', async () => {
    const malformed = interactiveProvider({ returnMalformedRef: true })
    let failure: unknown
    try {
      await start(malformed.provider)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(RetainedInteractiveBindingError)
    const binding = failure as RetainedInteractiveBindingError
    expect(binding.returned).toEqual({})
    expect(binding.requested.profile).toEqual(profile)
    expect(malformed.destroyCalls).toBe(0)
  })

  it.each(['capabilities', 'create', 'start'] as const)(
    'cancels a hanging provider %s call',
    async (hangAt) => {
      const fixture = interactiveProvider({ hangAt })
      const controller = new AbortController()
      const pending = start(fixture.provider, controller.signal)
      await waitForHangingCall(fixture, 1)
      controller.abort(`cancel ${hangAt}`)

      await expect(pending).rejects.toMatchObject({
        name: 'AbortError',
        message: `cancel ${hangAt}`,
      })
      expect(fixture.hangingCalls).toBe(1)
    },
  )

  it.each(['status', 'attach', 'sendPrompt', 'stop'] as const)(
    'cancels a hanging interactive %s call',
    async (hangAt) => {
      const fixture = interactiveProvider({ hangAt })
      const handle = await start(fixture.provider)
      const controller = new AbortController()
      const pending =
        hangAt === 'status'
          ? handle.status({ signal: controller.signal })
          : hangAt === 'attach'
            ? handle.attach(undefined, { signal: controller.signal })
            : hangAt === 'sendPrompt'
              ? handle.sendPrompt('continue', { signal: controller.signal })
              : handle.stop({ signal: controller.signal })
      await waitForHangingCall(fixture, 1)
      controller.abort(`cancel ${hangAt}`)

      await expect(pending).rejects.toMatchObject({
        name: 'AbortError',
        message: `cancel ${hangAt}`,
      })
      expect(fixture.hangingCalls).toBe(1)
    },
  )

  it('cancels hanging provider lookup during recovery and reconnect', async () => {
    const fixture = interactiveProvider()
    const admissions: RetainedInteractiveAdmission[] = []
    const handle = await startRetainedInteractiveRun({
      provider: fixture.provider,
      environment: { profile, idempotencyKey: 'workspace-lookup-cancel' },
      interactiveIdempotencyKey: 'native-lookup-cancel',
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
    })
    const admission = admissions.find((candidate) => candidate.phase === 'interactive_environment')
    if (admission?.phase !== 'interactive_environment') {
      throw new Error('expected interactive environment admission')
    }
    fixture.hangAt = 'get'

    const recoverController = new AbortController()
    const recovering = recoverRetainedInteractiveRun({
      provider: fixture.provider,
      admission,
      onAdmission: async () => {},
      signal: recoverController.signal,
    })
    await waitForHangingCall(fixture, 1)
    recoverController.abort('cancel recover')
    await expect(recovering).rejects.toMatchObject({
      name: 'AbortError',
      message: 'cancel recover',
    })

    const reconnectController = new AbortController()
    const reconnecting = reconnectRetainedInteractiveRun({
      provider: fixture.provider,
      ref: handle.ref,
      signal: reconnectController.signal,
    })
    await waitForHangingCall(fixture, 2)
    reconnectController.abort('cancel reconnect')
    await expect(reconnecting).rejects.toMatchObject({
      name: 'AbortError',
      message: 'cancel reconnect',
    })
    expect(fixture.hangingCalls).toBe(2)
  })

  it('fails before allocation when capability or caller authority is absent', async () => {
    const incomplete = interactiveProvider({ completeCapabilities: false })
    await expect(start(incomplete.provider)).rejects.toThrow(
      'cannot control an exact interactive agent',
    )
    expect(incomplete.createCalls).toBe(0)

    const aborted = interactiveProvider()
    const controller = new AbortController()
    controller.abort(new Error('caller stopped'))
    await expect(start(aborted.provider, controller.signal)).rejects.toThrow('caller stopped')
    expect(aborted.createCalls).toBe(0)
  })
})

async function start(provider: AgentEnvironmentProvider, signal?: AbortSignal) {
  return startRetainedInteractiveRun({
    provider,
    environment: { profile, idempotencyKey: 'workspace-default' },
    interactiveIdempotencyKey: 'native-default',
    onAdmission: async () => {},
    signal,
  })
}

interface ProviderFixture {
  readonly provider: AgentEnvironmentProvider
  readonly prompts: string[]
  readonly createCalls: number
  readonly environmentCreations: number
  readonly dispatchCalls: number
  readonly startCalls: number
  readonly processStarts: number
  readonly destroyCalls: number
  readonly hangingCalls: number
  hangAt?: HangPoint
  statusRef?: AgentInteractiveSessionRef
}

type HangPoint =
  | 'capabilities'
  | 'create'
  | 'get'
  | 'start'
  | 'status'
  | 'attach'
  | 'sendPrompt'
  | 'stop'

function interactiveProvider(
  options: {
    completeCapabilities?: boolean
    hangAt?: HangPoint
    loseFirstStartResponse?: boolean
    returnMalformedRef?: boolean
    returnWrongRun?: boolean
    returnWrongTerminal?: boolean
  } = {},
): ProviderFixture {
  const fixture = {
    prompts: [] as string[],
    createCalls: 0,
    environmentCreations: 0,
    dispatchCalls: 0,
    startCalls: 0,
    processStarts: 0,
    destroyCalls: 0,
    hangingCalls: 0,
    statusRef: undefined as AgentInteractiveSessionRef | undefined,
  }
  const environmentKeys = new Set<string>()
  let hangAt = options.hangAt
  let ref: AgentInteractiveSessionRef | undefined
  let lost = false
  const terminal = (): AgentTerminalSession => ({
    ref: {
      terminalSessionId: 'terminal-1',
      parentExecutionId: options.returnWrongTerminal ? 'another-execution' : ref!.run.executionId,
      name: 'pi',
      shell: '/bin/sh',
      command: 'pi',
      cwd: '/workspace',
      cols: 120,
      rows: 40,
      createdAt: '2026-08-16T00:00:00.000Z',
      lastActivityAt: '2026-08-16T00:00:00.000Z',
      expiresAt: '2026-08-17T00:00:00.000Z',
      isRunning: true,
      attachCount: 1,
    },
    cursors: { earliest: 0, latest: 0 },
    input: async () => {},
    resize: async () => {},
    detach: async () => ({ status: 'detached', terminalSessionId: 'terminal-1' }),
    close: async () => ({ status: 'closed', terminalSessionId: 'terminal-1' }),
    async *events() {},
  })
  const session = (): AgentInteractiveSession => ({
    ref: ref!,
    status: async () => {
      if (hangAt === 'status') {
        fixture.hangingCalls += 1
        return neverPending()
      }
      return { state: 'running' as const, ref: fixture.statusRef ?? ref! }
    },
    attach: async () => {
      if (hangAt === 'attach') {
        fixture.hangingCalls += 1
        return neverPending()
      }
      return terminal()
    },
    sendPrompt: async (prompt: string) => {
      if (hangAt === 'sendPrompt') {
        fixture.hangingCalls += 1
        return neverPending()
      }
      fixture.prompts.push(prompt)
    },
    stop: async () => {
      if (hangAt === 'stop') {
        fixture.hangingCalls += 1
        return neverPending()
      }
      return {
        state: 'exited' as const,
        ref: fixture.statusRef ?? ref!,
        endedAt: '2026-08-16T01:00:00.000Z',
        reason: 'stopped' as const,
      }
    },
  })
  const environment: AgentEnvironment = {
    id: 'sandbox-1',
    provider: 'test-provider',
    status: async () => 'running',
    async *stream() {},
    dispatch: async () => {
      fixture.dispatchCalls += 1
      throw new Error('headless dispatch must not run')
    },
    startInteractive: async (request: AgentInteractiveSessionStart) => {
      if (hangAt === 'start') {
        fixture.hangingCalls += 1
        return neverPending()
      }
      fixture.startCalls += 1
      if (!ref) {
        fixture.processStarts += 1
        const run = options.returnWrongRun
          ? { ...request.run, runId: `${request.run.runId}-other` }
          : request.run
        ref = AgentInteractiveSessionRefSchema.parse({
          run,
          requestedProfileDigest: request.requestedProfileDigest,
          admittedProfileDigest: request.requestedProfileDigest,
          incarnationId: 'incarnation-1',
          harness: request.profile.harness,
          startedAt: '2026-08-16T00:00:00.000Z',
        })
      }
      if (options.returnMalformedRef) return 42 as unknown as AgentInteractiveSessionRef
      if (options.loseFirstStartResponse && !lost) {
        lost = true
        throw new Error('start response lost')
      }
      return ref
    },
    interactive: () => session(),
    destroy: async () => {
      fixture.destroyCalls += 1
    },
  }
  const provider: AgentEnvironmentProvider = {
    name: 'test-provider',
    capabilities: async () => {
      if (hangAt === 'capabilities') {
        fixture.hangingCalls += 1
        return neverPending()
      }
      return interactiveCapabilities(options.completeCapabilities !== false)
    },
    create: async (input) => {
      if (hangAt === 'create') {
        fixture.hangingCalls += 1
        return neverPending()
      }
      fixture.createCalls += 1
      if (input.idempotencyKey !== undefined && !environmentKeys.has(input.idempotencyKey)) {
        environmentKeys.add(input.idempotencyKey)
        fixture.environmentCreations += 1
      }
      return environment
    },
    get: async (id) => {
      if (hangAt === 'get') {
        fixture.hangingCalls += 1
        return neverPending()
      }
      return id === environment.id ? environment : null
    },
  }
  return Object.defineProperties(
    { provider, prompts: fixture.prompts },
    {
      createCalls: { get: () => fixture.createCalls },
      environmentCreations: { get: () => fixture.environmentCreations },
      dispatchCalls: { get: () => fixture.dispatchCalls },
      startCalls: { get: () => fixture.startCalls },
      processStarts: { get: () => fixture.processStarts },
      destroyCalls: { get: () => fixture.destroyCalls },
      hangingCalls: { get: () => fixture.hangingCalls },
      hangAt: {
        get: () => hangAt,
        set: (value: HangPoint | undefined) => {
          hangAt = value
        },
      },
      statusRef: {
        get: () => fixture.statusRef,
        set: (value: AgentInteractiveSessionRef | undefined) => {
          fixture.statusRef = value
        },
      },
    },
  ) as ProviderFixture
}

function neverPending<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

async function waitForHangingCall(fixture: ProviderFixture, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && fixture.hangingCalls < expected; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  expect(fixture.hangingCalls).toBeGreaterThanOrEqual(expected)
}

function interactiveCapabilities(complete: boolean): AgentEnvironmentCapabilities {
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
    workspace: { read: true, write: true, exec: true, git: true, upload: true, download: true },
    branching: { checkpoint: true, fork: true },
    placement: true,
    usage: true,
    confidential: false,
    interactiveAgent: {
      start: true,
      status: true,
      attach: true,
      reattach: complete,
      sendPrompt: true,
      input: true,
      resize: true,
      stop: true,
    },
  }
}
