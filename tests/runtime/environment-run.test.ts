import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentSession,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import {
  type EnvironmentDeliverable,
  EnvironmentRunAbortError,
  openEnvironmentRun,
} from '../../src/runtime/environment-run'
import type { AgentRunSpec } from '../../src/runtime/types'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'

interface FakeProviderOptions {
  read?: (path: string) => string | Promise<string>
  sessionLive?: boolean
  onStream?: (callIndex: number) => void
  events?: AgentEnvironmentEvent[]
  onEvent?: (eventIndex: number) => void
}

interface StreamCall {
  environmentId: string
  sessionId?: string
  timeoutMs?: number
  signal?: AbortSignal
}

function fakeCapabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: true,
      systemPrompt: true,
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
    branching: { checkpoint: false, fork: false },
    placement: false,
    usage: true,
    confidential: false,
  }
}

function createFakeProvider(options: FakeProviderOptions = {}) {
  const streamCalls: StreamCall[] = []
  const created: string[] = []
  const destroyed: string[] = []
  const readPaths: string[] = []
  const environments = new Map<string, AgentEnvironment>()
  let environmentSequence = 0

  function makeSession(id: string): AgentSession {
    return {
      id,
      async status() {
        return options.sessionLive === false ? null : 'completed'
      },
      async *events(): AsyncIterable<AgentEnvironmentEvent> {},
      async result() {
        return { text: 'done', success: true, sessionId: id }
      },
      async prompt() {
        return { text: 'done', success: true, sessionId: id }
      },
      async cancel() {},
    }
  }

  function makeEnvironment(id: string): AgentEnvironment {
    return {
      id,
      provider: 'fake-provider',
      async status() {
        return 'running'
      },
      async *stream(input): AsyncIterable<AgentEnvironmentEvent> {
        streamCalls.push({
          environmentId: id,
          sessionId: input.sessionId,
          timeoutMs: input.timeoutMs,
          signal: input.signal,
        })
        options.onStream?.(streamCalls.length)
        const events = options.events ?? [
          {
            type: 'result',
            data: { ok: true, text: 'streamed' },
          } satisfies AgentEnvironmentEvent,
        ]
        let index = 0
        for (const event of events) {
          if (input.signal?.aborted) {
            const error = new Error('aborted')
            error.name = 'AbortError'
            throw error
          }
          yield event
          index += 1
          options.onEvent?.(index)
        }
      },
      session: makeSession,
      async read(path) {
        readPaths.push(path)
        if (options.read) return options.read(path)
        return 'diff --git a/x b/x'
      },
      async destroy() {
        destroyed.push(id)
      },
    }
  }

  const provider: AgentEnvironmentProvider = {
    name: 'fake-provider',
    capabilities: fakeCapabilities,
    async create() {
      const id = `environment-${environmentSequence++}`
      created.push(id)
      const environment = makeEnvironment(id)
      environments.set(id, environment)
      return environment
    },
    async get(id) {
      return environments.get(id) ?? null
    },
  }

  return { provider, streamCalls, created, destroyed, readPaths, environments }
}

function spec(name = 'worker'): AgentRunSpec<string> {
  return { profile: { name }, name, taskToPrompt: (task) => task }
}

function backendSpec(name = 'worker'): AgentRunSpec<string> {
  return {
    profile: { name },
    name,
    taskToPrompt: (task) => task,
    environment: { backend: 'opencode' },
  }
}

const eventsDeliverable: EnvironmentDeliverable<{ text: string }> = {
  kind: 'events',
  fromEvents: (events) => ({
    text: String((events.at(-1)?.data as { text?: string } | undefined)?.text ?? ''),
  }),
}

function artifactDeliverable(
  path: string,
): EnvironmentDeliverable<{ raw: string; eventCount: number }> {
  return {
    kind: 'artifact',
    path,
    fromArtifact: (raw, events) => ({ raw, eventCount: events.length }),
  }
}

describe('openEnvironmentRun events deliverable', () => {
  it('parses drained events and exposes the environment and session after start', async () => {
    const { provider, streamCalls, created } = createFakeProvider()
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
    })

    const turn = await run.turn('solve it')

    expect(turn.output).toEqual({ text: 'streamed' })
    expect(turn.events).toHaveLength(1)
    expect(created).toHaveLength(1)
    expect(streamCalls).toHaveLength(1)
    expect(run.environment.id).toBe('environment-0')
    expect(run.sessionId).toBe(streamCalls[0]!.sessionId)
    expect(run.sessionId).toBeDefined()
  })
})

describe('openEnvironmentRun event observation', () => {
  it('forwards start and resume events with stable turn metadata', async () => {
    const streamed: AgentEnvironmentEvent[] = [
      { type: 'token', data: { text: 'working' } },
      { type: 'result', data: { text: 'done' } },
    ]
    const { provider } = createFakeProvider({ events: streamed, sessionLive: true })
    const seen: Array<{
      type: string
      turnIndex: number
      turnKind: 'start' | 'resume'
      agentRunName: string
    }> = []
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec('researcher'),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
      onEnvironmentEvent: (event, metadata) => {
        seen.push({ type: event.type, ...metadata })
      },
    })

    await run.turn('turn 1')
    await run.turn('turn 2')

    expect(seen).toEqual([
      { type: 'token', turnIndex: 0, turnKind: 'start', agentRunName: 'researcher' },
      { type: 'result', turnIndex: 0, turnKind: 'start', agentRunName: 'researcher' },
      { type: 'token', turnIndex: 1, turnKind: 'resume', agentRunName: 'researcher' },
      { type: 'result', turnIndex: 1, turnKind: 'resume', agentRunName: 'researcher' },
    ])
  })

  it('protects collected events from observer mutation', async () => {
    const streamed: AgentEnvironmentEvent[] = [
      {
        type: 'result',
        data: { text: 'original', usage: { inputTokens: 3 } },
      },
    ]
    const { provider } = createFakeProvider({ events: streamed })
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
      onEnvironmentEvent: (event) => {
        const data = event.data as {
          text: string
          usage: { inputTokens: number }
        }
        data.text = 'mutated'
        data.usage.inputTokens = 999
      },
    })

    const turn = await run.turn('go')

    expect(turn.events[0]?.data).toEqual({
      text: 'original',
      usage: { inputTokens: 3 },
    })
    expect(turn.output).toEqual({ text: 'original' })
  })

  it('does not wait for observers or fail when they throw or reject', async () => {
    const streamed: AgentEnvironmentEvent[] = [
      { type: 'token', data: { text: 'one' } },
      { type: 'token', data: { text: 'two' } },
      { type: 'result', data: { text: 'done' } },
    ]
    const { provider } = createFakeProvider({ events: streamed })
    let calls = 0
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
      onEnvironmentEvent: () => {
        calls += 1
        if (calls === 1) throw new Error('observer threw')
        if (calls === 2) return Promise.reject(new Error('observer rejected'))
        return new Promise<void>(() => {})
      },
    })

    await expect(run.turn('go')).resolves.toMatchObject({
      output: { text: 'done' },
    })
    expect(calls).toBe(3)
  })
})

describe('openEnvironmentRun artifact deliverable', () => {
  it('reads and maps a workspace-relative artifact after the turn drains', async () => {
    const { provider, readPaths } = createFakeProvider({ read: () => 'PATCH-CONTENT' })
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: artifactDeliverable('solution.patch'),
      signal: new AbortController().signal,
    })

    const turn = await run.turn('write the patch')

    expect(turn.output).toEqual({ raw: 'PATCH-CONTENT', eventCount: 1 })
    expect(readPaths).toEqual(['solution.patch'])
  })

  it('fails after exhausting artifact read retries', async () => {
    const { provider, readPaths } = createFakeProvider({
      read: () => {
        throw new Error('outside allowed roots')
      },
    })
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: artifactDeliverable('solution.patch'),
      signal: new AbortController().signal,
      readRetryDelayMs: 0,
    })

    await expect(run.turn('write the patch')).rejects.toThrow(
      'failed to read artifact "solution.patch" after 4 attempts: outside allowed roots',
    )
    expect(readPaths).toHaveLength(4)
  })

  it('recovers from transient read failures', async () => {
    let calls = 0
    const { provider } = createFakeProvider({
      read: () => {
        calls += 1
        if (calls < 3) throw new Error('Resource not found: unknown')
        return 'RECOVERED-PATCH'
      },
    })
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: artifactDeliverable('solution.patch'),
      signal: new AbortController().signal,
      readRetryDelayMs: 0,
    })

    const turn = await run.turn('write the patch')

    expect(turn.output).toEqual({ raw: 'RECOVERED-PATCH', eventCount: 1 })
    expect(calls).toBe(3)
  })
})

describe('openEnvironmentRun session continuation', () => {
  it('reattaches an existing provider environment and session', async () => {
    const { provider, streamCalls } = createFakeProvider({ sessionLive: true })
    const environment = await provider.create({ profile: spec().profile })
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
      resumeFrom: {
        environmentId: environment.id,
        sessionId: 'persisted-session',
      },
    })

    await expect(run.turn('continue')).resolves.toMatchObject({
      output: { text: 'streamed' },
    })
    expect(streamCalls).toEqual([
      expect.objectContaining({
        environmentId: environment.id,
        sessionId: 'persisted-session',
      }),
    ])
    await run.close()
  })

  it('forwards turn options while retaining ownership of session and signal', async () => {
    const { provider, streamCalls } = createFakeProvider({ sessionLive: true })
    const signal = new AbortController().signal
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal,
      turn: { timeoutMs: 420_000 },
    })

    await run.turn('turn 1')
    await run.turn('turn 2')

    expect(streamCalls).toHaveLength(2)
    expect(streamCalls.map((call) => call.timeoutMs)).toEqual([420_000, 420_000])
    expect(streamCalls.every((call) => call.signal !== undefined)).toBe(true)
    expect(streamCalls.every((call) => call.signal !== signal)).toBe(true)
    expect(streamCalls[1]!.signal).not.toBe(streamCalls[0]!.signal)
    expect(streamCalls[1]!.sessionId).toBe(streamCalls[0]!.sessionId)
  })

  it('reuses one environment and session', async () => {
    const { provider, streamCalls, created } = createFakeProvider({ sessionLive: true })
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
    })

    await run.turn('turn 1')
    await run.turn('turn 2')

    expect(created).toHaveLength(1)
    expect(streamCalls).toHaveLength(2)
    expect(streamCalls[1]!.environmentId).toBe(streamCalls[0]!.environmentId)
    expect(streamCalls[1]!.sessionId).toBe(streamCalls[0]!.sessionId)
  })

  it('fails when the provider no longer recognizes the resumed session', async () => {
    const { provider } = createFakeProvider({ sessionLive: false })
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
    })

    await run.turn('turn 1')

    await expect(run.turn('turn 2')).rejects.toThrow(/no longer recognizes session/)
  })
})

describe('openEnvironmentRun lifecycle rules', () => {
  it('runs beforeStart after creation and before the first stream pull', async () => {
    const { provider, streamCalls } = createFakeProvider()
    const seen: Array<{ environmentId: string; sessionId: string; streams: number }> = []
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
      beforeStart: ({ environment, sessionId }) => {
        seen.push({
          environmentId: environment.id,
          sessionId,
          streams: streamCalls.length,
        })
      },
    })

    await run.turn('turn 1')

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ environmentId: 'environment-0', streams: 0 })
    expect(streamCalls).toHaveLength(1)
    expect(streamCalls[0]!.sessionId).toBe(seen[0]!.sessionId)
  })

  it('fails before streaming when beforeStart throws', async () => {
    const { provider, streamCalls, destroyed } = createFakeProvider()
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
      beforeStart: () => {
        throw new Error('setup failed')
      },
    })

    await expect(run.turn('turn 1')).rejects.toThrow(/setup failed/)
    expect(streamCalls).toHaveLength(0)
    expect(destroyed).toEqual(['environment-0'])
  })

  it('rejects environment and session access before start', async () => {
    const { provider } = createFakeProvider()
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
    })

    expect(() => run.environment).toThrow(/before start/)
    expect(() => run.sessionId).toThrow(/before start/)
  })

  it('allows close before start without creating or destroying an environment', async () => {
    const { provider, created, destroyed } = createFakeProvider()
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
    })

    await expect(run.close()).resolves.toBeUndefined()
    expect(created).toHaveLength(0)
    expect(destroyed).toHaveLength(0)
  })

  it('destroys a started environment on close', async () => {
    const { provider, destroyed } = createFakeProvider()
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
    })

    await run.turn('turn 1')
    await run.close()

    expect(destroyed).toEqual(['environment-0'])
  })
})

describe('openEnvironmentRun cancellation', () => {
  it('preserves drained events and skips the artifact read when cancelled before reading', async () => {
    const controller = new AbortController()
    const partialEvents: AgentEnvironmentEvent[] = [
      { type: 'step', data: { index: 0 } },
      { type: 'step', data: { index: 1 } },
    ]
    const { provider, readPaths } = createFakeProvider({
      events: partialEvents,
      onEvent: (index) => {
        if (index === partialEvents.length) controller.abort()
      },
    })
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: artifactDeliverable('solution.patch'),
      signal: controller.signal,
    })

    const error = await run.turn('write the patch').then(
      () => {
        throw new Error('expected cancellation')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(EnvironmentRunAbortError)
    expect((error as Error).name).toBe('AbortError')
    expect((error as EnvironmentRunAbortError).events).toEqual(partialEvents)
    expect(readPaths).toHaveLength(0)
  })

  it('preserves only events drained before mid-stream cancellation', async () => {
    const controller = new AbortController()
    const observed: string[] = []
    const streamed: AgentEnvironmentEvent[] = [
      { type: 'step', data: { index: 0 } },
      { type: 'step', data: { index: 1 } },
      { type: 'result', data: { ok: true } },
    ]
    const { provider } = createFakeProvider({
      events: streamed,
      onEvent: (index) => {
        if (index === 1) controller.abort()
      },
    })
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: controller.signal,
      onEnvironmentEvent: (event) => {
        observed.push(event.type)
        throw new Error('observer failure must not mask cancellation')
      },
    })

    const error = await run.turn('go').then(
      () => {
        throw new Error('expected cancellation')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(EnvironmentRunAbortError)
    expect((error as EnvironmentRunAbortError).events).toEqual([streamed[0]])
    expect(observed).toEqual(['step'])
  })

  it('preserves events and the last read error when cancelled during retries', async () => {
    const controller = new AbortController()
    const partialEvents: AgentEnvironmentEvent[] = [{ type: 'result', data: { ok: true } }]
    let reads = 0
    const { provider } = createFakeProvider({
      events: partialEvents,
      read: () => {
        reads += 1
        controller.abort()
        throw new Error('Resource not found: still flushing')
      },
    })
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: artifactDeliverable('solution.patch'),
      signal: controller.signal,
      readRetryDelayMs: 0,
    })

    const error = await run.turn('write the patch').then(
      () => {
        throw new Error('expected cancellation')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(EnvironmentRunAbortError)
    expect((error as EnvironmentRunAbortError).events).toEqual(partialEvents)
    expect((error as EnvironmentRunAbortError).readError).toMatch(/still flushing/)
    expect(reads).toBe(1)
  })
})

describe('openEnvironmentRun runtime hooks', () => {
  it('emits run and turn lifecycle events for start, resume, and close', async () => {
    const { provider } = createFakeProvider({ sessionLive: true })
    const events: RuntimeHookEvent[] = []
    let timestamp = 1_000
    const run = await openEnvironmentRun({
      provider,
      agentRun: backendSpec('coder'),
      deliverable: artifactDeliverable('solution.patch'),
      signal: new AbortController().signal,
      hooks: { onEvent: (event) => void events.push(event) },
      runId: 'bench-run-1',
      scenarioId: 'case-1',
      now: () => timestamp++,
    })

    await run.turn('first turn')
    await run.turn('second turn')
    await run.close()

    expect(
      events.map((event) => `${event.target}:${event.phase}:${event.stepIndex ?? '-'}`),
    ).toEqual([
      'agent.run:before:-',
      'agent.turn:before:0',
      'agent.turn:after:0',
      'agent.turn:before:1',
      'agent.turn:after:1',
      'agent.run:after:-',
    ])
    expect(events.every((event) => event.runId === 'bench-run-1')).toBe(true)
    expect(events.every((event) => event.scenarioId === 'case-1')).toBe(true)
    expect(events.every((event) => event.metadata?.producer === 'openEnvironmentRun')).toBe(true)
    expect(events[0]!.payload).toMatchObject({
      agentName: 'coder',
      profileName: 'coder',
      provider: 'fake-provider',
      backend: 'opencode',
      deliverableKind: 'artifact',
      deliverablePath: 'solution.patch',
      turnCount: 0,
    })
    expect(events[2]!.payload).toMatchObject({
      agentName: 'coder',
      turnKind: 'start',
      promptChars: 'first turn'.length,
      eventCount: 1,
      eventTypes: { result: 1 },
      sessionId: expect.any(String),
      environmentId: 'environment-0',
    })
    expect(events[4]!.payload).toMatchObject({
      turnKind: 'resume',
      promptChars: 'second turn'.length,
      eventCount: 1,
      eventTypes: { result: 1 },
      sessionId: (events[2]!.payload as { sessionId: string }).sessionId,
      environmentId: 'environment-0',
    })
    expect(events[5]!.payload).toMatchObject({
      turnCount: 2,
      sessionId: (events[2]!.payload as { sessionId: string }).sessionId,
      environmentId: 'environment-0',
    })
  })

  it('keeps hook failures non-fatal and reports them through onHookError', async () => {
    const { provider } = createFakeProvider()
    const hookErrors: string[] = []
    const run = await openEnvironmentRun({
      provider,
      agentRun: spec(),
      deliverable: eventsDeliverable,
      signal: new AbortController().signal,
      hooks: {
        onEvent: () => {
          throw new Error('hook down')
        },
        onHookError: (error, context) => {
          hookErrors.push(`${context.hook}:${context.target}:${context.phase}:${error.message}`)
        },
      },
      runId: 'bench-run-2',
    })

    const turn = await run.turn('still runs')

    expect(turn.output).toEqual({ text: 'streamed' })
    expect(hookErrors).toContain('onEvent:agent.run:before:hook down')
    expect(hookErrors).toContain('onEvent:agent.turn:after:hook down')
  })
})
