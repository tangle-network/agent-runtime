import type { StreamEvent } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { envelopeRuntimeEvents, type RuntimeStreamEventEnvelope } from '../runtime-event-envelope'
import { sanitizeRuntimeStreamEvent } from '../sanitize'
import { runtimeStreamServerSentEvent } from '../sse'
import type { AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { providerAsExecutor } from './environment-provider'
import { mapSandboxCanonicalEvent } from './sandbox-events'
import {
  type AgentTurnBackend,
  streamAgentTurn,
} from './stream-agent-turn'
import { streamAgentTurnEnvelopes } from './stream-agent-turn-envelope'

const occurredAt = '2026-08-02T03:00:00.000Z'

const canonicalEvents: StreamEvent[] = [
  {
    type: 'message.part.updated',
    part: {
      id: 'part-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'text',
      text: 'hello',
    },
    delta: 'hello',
  },
  { type: 'tool-heartbeat', toolName: 'shell', partId: 'part-1', elapsedMs: 10 },
  {
    type: 'tool-slow',
    toolName: 'shell',
    partId: 'part-1',
    elapsedMs: 1_000,
    thresholdMs: 500,
  },
  { type: 'model-processing', phase: 'thinking', elapsedMs: 5 },
  { type: 'status', status: 'completed', detail: 'done' },
  { type: 'warning', code: 'slow', message: 'slow response' },
  { type: 'raw', backend: 'pi', event: { vendor: true } },
  {
    type: 'session.updated',
    sessionId: 'session-1',
    time: { created: 1, updated: 2 },
  },
  {
    type: 'interaction',
    request: {
      id: 'interaction-1',
      kind: 'question',
      title: 'Continue?',
      answerSpec: { fields: [] },
    },
  },
  { type: 'interaction.cancel', id: 'interaction-1', reason: 'done' },
  {
    type: 'plan.submitted',
    plan: {
      id: 'plan-1',
      revision: 1,
      body: '1. Continue',
      submittedAt: occurredAt,
    },
  },
]

describe.each([
  ['box', boxBackend()],
  ['executor', executorBackend()],
] as const)('canonical event preservation through %s turns', (_name, backend) => {
  it('keeps every canonical kind and its source identity', async () => {
    const envelopes = await collect(
      streamAgentTurnEnvelopes(backend, 'run the turn', {
        runId: 'runtime-run',
        now: () => Date.parse('2026-08-02T03:01:00.000Z'),
      }),
    )
    const canonical = envelopes.filter(
      (envelope): envelope is CanonicalRuntimeEventEnvelope =>
        envelope.event.type === 'canonical_event',
    )

    expect(canonical).toHaveLength(canonicalEvents.length)
    expect(canonical.map((envelope) => envelope.event.event)).toEqual(canonicalEvents)
    expect(canonical.map((envelope) => envelope.event.eventId)).toEqual(
      canonicalEvents.map((_, index) => `event-${index}`),
    )
    expect(canonical.map((envelope) => envelope.event.cursor)).toEqual(
      canonicalEvents.map((_, index) => `cursor-${index}`),
    )
    expect(canonical.map((envelope) => envelope.event.sequence)).toEqual(
      canonicalEvents.map((_, index) => index),
    )
    expect(canonical.map((envelope) => envelope.event.occurredAt)).toEqual(
      canonicalEvents.map(() => occurredAt),
    )
    expect(canonical.map((envelope) => envelope.runId)).toEqual(
      canonicalEvents.map(() => 'runtime-run'),
    )
    expect(canonical.map((envelope) => envelope.eventId)).toEqual(
      canonicalEvents.map((_, index) => `event-${index}`),
    )
    expect(canonical.map((envelope) => envelope.cursor)).toEqual(
      canonicalEvents.map((_, index) => `cursor-${index}`),
    )
    expect(canonical.map((envelope) => envelope.occurredAt)).toEqual(
      canonicalEvents.map(() => occurredAt),
    )
    expect(envelopes.map((envelope) => envelope.sequence)).toEqual(
      envelopes.map((_, index) => index),
    )
  })
})

describe('chat event identity', () => {
  it('rejects envelope streams when the chat backend cannot provide durable identity', async () => {
    await expect(
      collect(
        streamAgentTurnEnvelopes(chatBackend(), 'run the turn', {
          runId: 'chat-run',
        }),
      ),
    ).rejects.toThrow(/requires a backend with durable event identity/)
  })
})

describe('canonical telemetry redaction', () => {
  it('redacts provider payloads, messages, tools, interactions, and plans by default', () => {
    const sentinel = 'CANONICAL_SECRET_SENTINEL'
    const event: RuntimeStreamEvent = {
      type: 'canonical_event',
      event: {
        type: 'message.part.updated',
        part: {
          id: 'part-secret',
          sessionID: 'session-secret',
          messageID: 'message-secret',
          type: 'tool',
          tool: 'shell',
          state: {
            status: 'completed',
            input: { authorization: sentinel },
            output: { response: sentinel },
          },
        },
        delta: sentinel,
      },
    }
    const sensitiveEvents: RuntimeStreamEvent[] = [
      event,
      {
        type: 'canonical_event',
        event: {
          type: 'raw',
          backend: 'provider',
          event: { authorization: sentinel, secret: sentinel },
        },
      },
      {
        type: 'canonical_event',
        event: {
          type: 'interaction',
          request: {
            id: 'interaction-secret',
            kind: 'permission',
            title: sentinel,
            body: sentinel,
            subject: { type: 'command', command: sentinel },
            answerSpec: {
              fields: [
                {
                  type: 'text',
                  name: 'answer',
                  label: sentinel,
                  default: sentinel,
                  required: true,
                },
              ],
            },
            default: { outcome: 'accepted', data: { answer: sentinel } },
          },
        },
      },
      {
        type: 'canonical_event',
        event: {
          type: 'plan.submitted',
          plan: {
            id: 'plan-secret',
            revision: 1,
            body: sentinel,
            submittedAt: occurredAt,
          },
        },
      },
    ]

    for (const sensitiveEvent of sensitiveEvents) {
      const sanitized = sanitizeRuntimeStreamEvent(sensitiveEvent)
      const telemetry = JSON.stringify(sanitized)
      const sse = runtimeStreamServerSentEvent(sensitiveEvent)
      expect(telemetry).not.toContain(sentinel)
      expect(sse).not.toContain(sentinel)
    }
  })

  it('preserves canonical payloads only with the explicit control-payload opt-in', () => {
    const sentinel = 'CANONICAL_OPT_IN_SENTINEL'
    const event: RuntimeStreamEvent = {
      type: 'canonical_event',
      event: { type: 'raw', backend: 'provider', event: { secret: sentinel } },
    }

    expect(sanitizeRuntimeStreamEvent(event, { includeControlPayloads: true })).toMatchObject({
      event: event.event,
    })
    expect(runtimeStreamServerSentEvent(event, { includeControlPayloads: true })).toContain(
      sentinel,
    )
  })
})

describe('canonical sandbox validation', () => {
  it('separates transport identity stored beside fallback canonical data', () => {
    expect(
      mapSandboxCanonicalEvent({
        type: 'status',
        data: {
          status: 'completed',
          eventId: 'event-fallback',
          cursor: 'cursor-fallback',
          sequence: 7,
          occurredAt,
        },
      }),
    ).toEqual({
      type: 'canonical_event',
      event: { type: 'status', status: 'completed' },
      eventId: 'event-fallback',
      cursor: 'cursor-fallback',
      sequence: 7,
      occurredAt,
      timestamp: occurredAt,
    })
  })

  it('rejects embedded event types that disagree with the transport discriminator', () => {
    expect(() =>
      mapSandboxCanonicalEvent({
        type: 'status',
        data: { type: 'warning', status: 'completed' },
      }),
    ).toThrow('does not match transport type')
  })

  it('rejects a normalized event whose type disagrees with the transport discriminator', () => {
    expect(() =>
      mapSandboxCanonicalEvent({
        type: 'status',
        data: { normalized: { type: 'warning', code: 'mismatch', message: 'wrong type' } },
      }),
    ).toThrow('does not match transport type')
  })

  it('fails closed when an adapter claims an invalid normalized event', async () => {
    expect(() =>
      mapSandboxCanonicalEvent({
        type: 'status',
        id: 'event-invalid',
        data: {
          normalized: { type: 'status', status: 'not-a-real-status' },
        },
      }),
    ).toThrow('invalid normalized canonical event')

    const events = await collect(
      streamAgentTurn(
        {
          kind: 'box',
          box: sandboxBox([
            {
              type: 'status',
              id: 'event-invalid',
              data: {
                normalized: { type: 'status', status: 'not-a-real-status' },
              },
            },
          ]),
        },
        'run',
      ),
    )
    expect(events.some((event) => event.type === 'canonical_event')).toBe(false)
    expect(events.find((event) => event.type === 'backend_error')).toMatchObject({
      message: 'sandbox emitted an invalid normalized canonical event',
    })
  })
})

describe('runtime event identity', () => {
  it('rejects an event with no durable source identity instead of inventing an id', async () => {
    async function* events(): AsyncIterable<RuntimeStreamEvent> {
      yield {
        type: 'canonical_event',
        event: { type: 'status', status: 'processing' },
        eventId: 'runtime-1',
      }
      yield { type: 'text_delta', text: 'next' }
    }

    await expect(
      collect(
        envelopeRuntimeEvents(events(), {
          runId: 'collision-run',
          identity(event) {
            return event.type === 'canonical_event' ? { eventId: event.eventId } : undefined
          },
        }),
      ),
    ).rejects.toThrow('runtime event source has no durable event id or replay cursor')
  })

  it.each([
    ['occurredAt', { occurredAt: 'not-an-iso-timestamp' }],
    ['receivedAt', { receivedAt: 'not-an-iso-timestamp' }],
  ] as const)(
    'rejects an invalid %s timestamp before emitting an envelope',
    async (_label, identity) => {
      async function* events(): AsyncIterable<RuntimeStreamEvent> {
        yield { type: 'canonical_event', event: { type: 'status', status: 'completed' } }
      }

      await expect(
        collect(
          envelopeRuntimeEvents(events(), {
            runId: 'timestamp-run',
            now: () => Date.parse('2026-08-02T03:01:00.000Z'),
            identity: () => identity,
          }),
        ),
      ).rejects.toThrow(/must be a valid ISO timestamp/)
    },
  )
})

type CanonicalRuntimeEventEnvelope = Omit<RuntimeStreamEventEnvelope, 'event'> & {
  event: Extract<RuntimeStreamEvent, { type: 'canonical_event' }>
}

function boxBackend(): AgentTurnBackend {
  return { kind: 'box', box: sandboxBox(canonicalSandboxEvents()) }
}

function executorBackend(): AgentTurnBackend {
  const environment: AgentEnvironment = {
    id: 'executor-environment',
    provider: 'executor-provider',
    status: async () => 'running',
    async *stream(): AsyncIterable<AgentEnvironmentEvent> {
      for (const [index, event] of canonicalEvents.entries()) {
        const { type, ...payload } = event
        yield {
          type,
          id: `event-${index}`,
          data: { ...payload, cursor: `cursor-${index}`, sequence: index, occurredAt },
        }
      }
      yield { type: 'result', data: { finalText: 'done' } }
    },
  }
  const provider: AgentEnvironmentProvider = {
    name: 'executor-provider',
    capabilities: retainedCapabilities,
    create: async () => environment,
  }
  return {
    kind: 'executor',
    factory: providerAsExecutor(provider, { destroyOnSettle: false }),
  }
}

function chatBackend(): AgentTurnBackend {
  const backend: AgentExecutionBackend = {
    kind: 'chat-test',
    async *stream() {
      yield { type: 'text_delta', text: 'chat output without a durable event id' }
    },
  }
  return { kind: 'chat', backend }
}

function canonicalSandboxEvents(): SandboxEvent[] {
  return [
    ...canonicalEvents.map((event, index) => {
      const { type, ...data } = event
      return {
        type,
        data,
        id: `event-${index}`,
        cursor: `cursor-${index}`,
        sequence: index,
        occurredAt,
      } as SandboxEvent
    }),
    { type: 'result', data: { finalText: 'done' } },
  ]
}

function sandboxBox(events: SandboxEvent[]): SandboxInstance {
  return {
    id: 'sandbox-box',
    async *streamPrompt() {
      for (const event of events) yield event
    },
    delete: async () => {},
  } as unknown as SandboxInstance
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = []
  for await (const event of events) collected.push(event)
  return collected
}

function retainedCapabilities() {
  return {
    profile: {
      namedProfiles: true,
      systemPrompt: true,
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
