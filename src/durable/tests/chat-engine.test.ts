/**
 * `DurableChatTurnEngine` tests — the orchestration contract every product
 * chat handler depends on. Run against all three stores so the engine is
 * proven on every backend. Covers: lifecycle envelope, NDJSON encoding,
 * replay-skips-persist (no double-write), hook ordering, the failure
 * envelope, the per-event side channel, and the pre-persist transform.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  type ChatStreamEvent,
  D1DurableRunStore,
  DurableChatTurnEngine,
  type DurableRunStore,
  FileSystemDurableRunStore,
  InMemoryDurableRunStore,
} from '../index'
import { createSqliteD1 } from './sqlite-d1-adapter'

const SCHEMA_SQL = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')

/** Drain an NDJSON ReadableStream into parsed events. */
async function drain(body: ReadableStream<Uint8Array>): Promise<ChatStreamEvent[]> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: ChatStreamEvent[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (;;) {
      const nl = buffer.indexOf('\n')
      if (nl === -1) break
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) events.push(JSON.parse(line) as ChatStreamEvent)
    }
  }
  if (buffer.trim()) events.push(JSON.parse(buffer.trim()) as ChatStreamEvent)
  return events
}

/** A producer that streams the given text as two part-updates + a result. */
function textProducer(text: string, onConstruct?: () => void) {
  return () => {
    onConstruct?.()
    async function* stream(): AsyncGenerator<ChatStreamEvent, void, unknown> {
      yield { type: 'message.part.updated', data: { part: { type: 'text' }, delta: text } }
      yield { type: 'result', data: { finalText: text } }
    }
    return { stream: stream(), finalText: () => text }
  }
}

const storeKinds = [
  {
    name: 'InMemoryDurableRunStore',
    factory: () => ({ store: new InMemoryDurableRunStore(), cleanup: () => undefined }),
  },
  {
    name: 'FileSystemDurableRunStore',
    factory: () => {
      const dir = mkdtempSync(join(tmpdir(), 'chat-engine-test-'))
      return {
        store: new FileSystemDurableRunStore(dir),
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
      }
    },
  },
  {
    name: 'D1DurableRunStore (better-sqlite3)',
    factory: () => {
      const handle = createSqliteD1()
      handle.raw.exec(SCHEMA_SQL)
      return {
        store: new D1DurableRunStore(handle.db),
        cleanup: () => handle.close(),
      }
    },
  },
] as const

const IDENTITY = { tenantId: 'ws-1', sessionId: 'thread-1', userId: 'user-1', turnIndex: 0 }

for (const kind of storeKinds) {
  describe(`DurableChatTurnEngine / ${kind.name}`, () => {
    let store: DurableRunStore
    let cleanup: () => void
    const engine = new DurableChatTurnEngine()

    beforeEach(() => {
      const made = kind.factory()
      store = made.store
      cleanup = made.cleanup
    })

    afterEach(async () => {
      await store.close()
      cleanup()
    })

    it('wraps the turn in the session.run.* lifecycle envelope', async () => {
      const persisted: string[] = []
      const { body, contentType } = engine.runTurn({
        identity: IDENTITY,
        userMessage: 'hello',
        projectId: 'legal-agent',
        domain: 'legal',
        store,
        hooks: {
          produce: textProducer('Hi there.'),
          persistAssistantMessage: async ({ finalText }) => {
            persisted.push(finalText)
          },
        },
      })
      expect(contentType).toBe('application/x-ndjson')
      const events = await drain(body)

      expect(events[0]?.type).toBe('session.run.started')
      expect(events.at(-1)?.type).toBe('session.run.completed')
      expect(events.some((e) => e.type === 'message.part.updated')).toBe(true)
      expect(events.some((e) => e.type === 'result')).toBe(true)
      expect(persisted).toEqual(['Hi there.'])
    })

    it('runs hooks in order: persist → onTurnComplete, after the stream', async () => {
      const order: string[] = []
      const { body } = engine.runTurn({
        identity: IDENTITY,
        userMessage: 'q',
        projectId: 'gtm-agent',
        domain: 'gtm',
        store,
        hooks: {
          produce: textProducer('answer'),
          persistAssistantMessage: async () => {
            order.push('persist')
          },
          onTurnComplete: async () => {
            order.push('postProcess')
          },
        },
      })
      await drain(body)
      expect(order).toEqual(['persist', 'postProcess'])
    })

    it('replay skips the producer AND skips persist/post-process (no double-write)', async () => {
      let constructs = 0
      let persists = 0
      let postProcesses = 0
      const hooks = {
        produce: textProducer('cached', () => (constructs += 1)),
        persistAssistantMessage: async () => {
          persists += 1
        },
        onTurnComplete: async () => {
          postProcesses += 1
        },
      }
      // First attempt — fresh.
      await drain(
        engine.runTurn({
          identity: IDENTITY,
          userMessage: 'q',
          projectId: 'creative-agent',
          domain: 'creative',
          store,
          hooks,
        }).body,
      )
      // Second attempt — same identity → replay.
      const replayEvents = await drain(
        engine.runTurn({
          identity: IDENTITY,
          userMessage: 'q',
          projectId: 'creative-agent',
          domain: 'creative',
          store,
          hooks,
        }).body,
      )

      expect(constructs).toBe(1) // producer built once
      expect(persists).toBe(1) // assistant message persisted once
      expect(postProcesses).toBe(1) // post-process ran once
      expect(replayEvents.some((e) => e.type === 'result')).toBe(true)
      const completed = replayEvents.find((e) => e.type === 'session.run.completed')
      expect(completed?.data?.replayed).toBe(true)
    })

    it('a producer failure becomes error + session.run.failed, stream still closes', async () => {
      const { body } = engine.runTurn({
        identity: IDENTITY,
        userMessage: 'q',
        projectId: 'tax-agent',
        domain: 'tax',
        store,
        hooks: {
          produce: () => {
            async function* stream(): AsyncGenerator<ChatStreamEvent, void, unknown> {
              yield { type: 'message.part.updated', data: { delta: 'partial' } }
              throw new Error('backend exploded')
            }
            return { stream: stream(), finalText: () => '' }
          },
          persistAssistantMessage: async () => undefined,
        },
      })
      const events = await drain(body)
      expect(events[0]?.type).toBe('session.run.started')
      const err = events.find((e) => e.type === 'error')
      expect(err?.data?.message).toBe('backend exploded')
      expect(events.at(-1)?.type).toBe('session.run.failed')
    })

    it('onEvent side channel receives every emitted event', async () => {
      const broadcast: string[] = []
      const { body } = engine.runTurn({
        identity: IDENTITY,
        userMessage: 'q',
        projectId: 'gtm-agent',
        domain: 'gtm',
        store,
        hooks: {
          produce: textProducer('x'),
          persistAssistantMessage: async () => undefined,
          onEvent: (event) => {
            broadcast.push(event.type)
          },
        },
      })
      const events = await drain(body)
      // Side channel saw exactly what the client saw.
      expect(broadcast).toEqual(events.map((e) => e.type))
    })

    it('transformFinalText alters what is persisted, not the live stream', async () => {
      let persisted = ''
      const { body } = engine.runTurn({
        identity: IDENTITY,
        userMessage: 'q',
        projectId: 'legal-agent',
        domain: 'legal',
        store,
        hooks: {
          produce: textProducer('SSN 123-45-6789'),
          transformFinalText: (t) => t.replace(/\d{3}-\d{2}-\d{4}/, '[REDACTED]'),
          persistAssistantMessage: async ({ finalText }) => {
            persisted = finalText
          },
        },
      })
      const events = await drain(body)
      // Live stream still carries the raw text.
      const result = events.find((e) => e.type === 'result')
      expect(result?.data?.finalText).toBe('SSN 123-45-6789')
      // Persisted copy is redacted.
      expect(persisted).toBe('SSN [REDACTED]')
    })

    it('a throwing persist hook is swallowed — the turn still completes', async () => {
      const { body } = engine.runTurn({
        identity: IDENTITY,
        userMessage: 'q',
        projectId: 'legal-agent',
        domain: 'legal',
        store,
        hooks: {
          produce: textProducer('ok'),
          persistAssistantMessage: async () => {
            throw new Error('db down')
          },
        },
      })
      const events = await drain(body)
      // Persist failure must not turn into session.run.failed.
      expect(events.at(-1)?.type).toBe('session.run.completed')
    })
  })
}
