/**
 * A `raw` transport event carries the harness's own event.
 *
 * The fixture is one real codex session recorded off the Sandbox SDK stream (a box on an OAuth
 * seat): 13 events, three of them `raw`, whose payloads name codex's own event types
 * (`thread.started`, `turn.started`, `turn.completed`). Reading such a payload as a canonical
 * type ended the stream on the first one and killed every codex worker seconds after its box
 * started, so these tests drive the fixture through the parser AND through the steerable sandbox
 * session that consumes it.
 *
 * The mismatch guard is still required for every other type: it is what catches a producer that
 * labels a canonical event one thing on the envelope and another in the payload.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  canonicalStreamEventFromSandboxEvent,
  extractLlmCallEvent,
} from '../../src/runtime/sandbox-events'
import { createInbox } from '../../src/runtime/supervise/inbox'
import { createSteerableSandboxSession } from '../../src/runtime/supervise/sandbox-session'
import type { SandboxClient } from '../../src/runtime/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

const codexSession: SandboxEvent[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'codex-session-events.json'), 'utf8'),
)

const transportTypes = [
  'start',
  'execution.started',
  'status',
  'status',
  'session.updated',
  'raw',
  'raw',
  'token',
  'message.part.updated',
  'raw',
  'status',
  'result',
  'done',
]

const rawPayloadTypes = ['thread.started', 'turn.started', 'turn.completed']

const payloadType = (event: SandboxEvent): unknown =>
  (event.data as { type?: unknown } | undefined)?.type

describe('the recorded codex session — every event survives the canonical parser', () => {
  it('is the 13-event stream the sandbox actually emitted', () => {
    expect(codexSession.map((event) => event.type)).toEqual(transportTypes)
    expect(codexSession.filter((event) => event.type === 'raw').map(payloadType)).toEqual(
      rawPayloadTypes,
    )
  })

  it('parses every event without throwing, and reads no raw payload as a canonical type', () => {
    for (const event of codexSession) {
      expect(() => canonicalStreamEventFromSandboxEvent(event)).not.toThrow()
    }
    // A harness-native payload is not a canonical event: it decodes to nothing and the consumer
    // reads it off the transport event, which still carries it verbatim.
    for (const event of codexSession.filter((item) => item.type === 'raw')) {
      expect(canonicalStreamEventFromSandboxEvent(event)).toBeUndefined()
    }
    expect(codexSession.map((event) => event.type)).toEqual(transportTypes)
    expect(codexSession.filter((event) => event.type === 'raw').map(payloadType)).toEqual(
      rawPayloadTypes,
    )
  })

  it('still decodes a raw payload that carries the canonical raw shape', () => {
    const canonical = canonicalStreamEventFromSandboxEvent({
      type: 'raw',
      data: { backend: 'codex', event: { type: 'turn.started' } },
    } as unknown as SandboxEvent)
    expect(canonical).toEqual({
      type: 'raw',
      backend: 'codex',
      event: { type: 'turn.started' },
    })
  })

  it('reports no canonical usage for the codex usage block inside turn.completed', () => {
    const completed = codexSession.find((event) => payloadType(event) === 'turn.completed')
    expect(completed).toBeDefined()
    expect(extractLlmCallEvent(completed as SandboxEvent, 'codex-worker')).toBeUndefined()
  })
})

describe('the canonical mismatch guard — kept for every non-raw type', () => {
  it('throws when the payload type disagrees with the transport type', () => {
    expect(() =>
      canonicalStreamEventFromSandboxEvent({
        type: 'status',
        data: { type: 'warning', status: 'complete' },
      } as unknown as SandboxEvent),
    ).toThrow(/canonical event type "warning" does not match transport type "status"/)
  })

  it('throws when a normalized event disagrees with the transport type', () => {
    expect(() =>
      canonicalStreamEventFromSandboxEvent({
        type: 'status',
        data: { normalized: { type: 'warning', code: 'x', message: 'y' } },
      } as unknown as SandboxEvent),
    ).toThrow(/canonical event type "warning" does not match transport type "status"/)
  })

  it('throws when a non-raw normalized event is not a canonical event at all', () => {
    expect(() =>
      canonicalStreamEventFromSandboxEvent({
        type: 'status',
        data: { normalized: { type: 'status' } },
      } as unknown as SandboxEvent),
    ).toThrow(/invalid normalized canonical event/)
  })
})

/** A box that replays the recorded codex session for its first turn. */
function replayingClient(events: SandboxEvent[], observed: string[]): SandboxClient {
  return {
    async create(): Promise<SandboxInstance> {
      return {
        id: 'codex-box',
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          for (const event of events) {
            observed.push(String(event.type))
            yield event
          }
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
}

describe('the steerable sandbox worker — a codex session runs to settlement', () => {
  it('consumes all 13 events and settles on the session text', async () => {
    const observed: string[] = []
    const session = createSteerableSandboxSession({
      controller: new AbortController(),
      // The recorded stream reports this exact served backend, so the worker's requested
      // instrument must be the same one — a mismatch is a different failure.
      profile: testAgentProfile('codex-worker', {
        harness: 'codex',
        model: { provider: 'openai', default: 'gpt-5.6-sol' },
      }),
      harness: 'codex',
      sandboxClient: replayingClient(codexSession, observed),
      inbox: createInbox(),
      taskToPrompt: (task) => String(task),
      contentRef: (prefix) => `${prefix}:ref`,
    })

    for await (const _event of session.stream('say OK', new AbortController().signal)) {
      // The assertions read the settled artifact; the usage stream is not the subject here.
    }

    expect(observed).toEqual(transportTypes)
    const artifact = session.artifact()
    expect((artifact?.out as { content?: string } | undefined)?.content).toBe('OK')
    expect(artifact?.verdict?.valid).toBe(true)
    expect(artifact?.spent.iterations).toBe(1)
  })
})
