/**
 * `runDurableTurn` tests — fresh run, replay, mid-stream crash re-run,
 * concurrent-attempt rejection. Run identically against all three stores
 * (InMemory / FileSystem / D1-over-sqlite) via the shared matrix, so the
 * turn primitive is proven on every backend a product could use.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  D1DurableRunStore,
  DurableRunLeaseHeldError,
  type DurableRunManifest,
  type DurableRunStore,
  FileSystemDurableRunStore,
  InMemoryDurableRunStore,
  runDurableTurn,
} from '../index'
import { createSqliteD1 } from './sqlite-d1-adapter'

const SCHEMA_SQL = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')

interface FakeEvent {
  type: string
  text?: string
}

function makeManifest(turnIndex = 0): DurableRunManifest {
  return {
    projectId: 'test-product',
    scenarioId: 'thread-1',
    task: {
      id: `chat:thread-1:${turnIndex}`,
      intent: 'unit-test chat turn',
      domain: 'test',
      requiredKnowledge: [],
      metadata: { turnIndex },
    },
    input: { userMessage: `q-${turnIndex}` },
  }
}

/** A producer that yields N text deltas then a final event. Records whether
 *  it was constructed so tests can prove the replay path skips it. */
function fakeProducer(opts: { chunks: string[]; onConstruct?: () => void; throwAfter?: number }) {
  opts.onConstruct?.()
  let assembled = ''
  async function* stream(): AsyncGenerator<FakeEvent, void, unknown> {
    let emitted = 0
    for (const chunk of opts.chunks) {
      if (opts.throwAfter !== undefined && emitted >= opts.throwAfter) {
        throw new Error('producer exploded mid-stream')
      }
      assembled += chunk
      yield { type: 'delta', text: chunk }
      emitted += 1
    }
    yield { type: 'result', text: assembled }
  }
  return {
    stream: stream(),
    finalText: () => assembled,
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
      const dir = mkdtempSync(join(tmpdir(), 'durable-turn-test-'))
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

for (const kind of storeKinds) {
  describe(`runDurableTurn / ${kind.name}`, () => {
    let store: DurableRunStore
    let cleanup: () => void

    beforeEach(() => {
      const made = kind.factory()
      store = made.store
      cleanup = made.cleanup
    })

    afterEach(async () => {
      await store.close()
      cleanup()
    })

    it('fresh run forwards producer events live and checkpoints final text', async () => {
      let constructed = 0
      const handle = runDurableTurn<FakeEvent>({
        store,
        runId: 'chat:thread-1:0',
        manifest: makeManifest(0),
        workerId: 'worker-a',
        produce: () =>
          fakeProducer({ chunks: ['Hello', ', ', 'world'], onConstruct: () => (constructed += 1) }),
        replayEvent: (text) => ({ type: 'result', text }),
      })

      const events: FakeEvent[] = []
      for await (const e of handle.stream) events.push(e)

      expect(constructed).toBe(1)
      expect(handle.replayed()).toBe(false)
      expect(events).toEqual([
        { type: 'delta', text: 'Hello' },
        { type: 'delta', text: ', ' },
        { type: 'delta', text: 'world' },
        { type: 'result', text: 'Hello, world' },
      ])
      expect(handle.finalText()).toBe('Hello, world')
      expect(handle.record()?.status).toBe('completed')
    })

    it('replay emits one synthetic event and never constructs the producer', async () => {
      // First attempt — completes, checkpoints.
      const first = runDurableTurn<FakeEvent>({
        store,
        runId: 'chat:thread-1:1',
        manifest: makeManifest(1),
        workerId: 'worker-a',
        produce: () => fakeProducer({ chunks: ['cached ', 'answer'] }),
        replayEvent: (text) => ({ type: 'result', text }),
      })
      for await (const _ of first.stream) {
        /* drain */
      }
      expect(first.replayed()).toBe(false)

      // Second attempt — same runId. Producer must NOT be constructed.
      let constructed = 0
      const replay = runDurableTurn<FakeEvent>({
        store,
        runId: 'chat:thread-1:1',
        manifest: makeManifest(1),
        workerId: 'worker-b',
        produce: () => fakeProducer({ chunks: ['x'], onConstruct: () => (constructed += 1) }),
        replayEvent: (text) => ({ type: 'result', text }),
      })
      const events: FakeEvent[] = []
      for await (const e of replay.stream) events.push(e)

      expect(constructed).toBe(0)
      expect(replay.replayed()).toBe(true)
      expect(replay.finalText()).toBe('cached answer')
      expect(events).toEqual([{ type: 'result', text: 'cached answer' }])
    })

    it('mid-stream crash re-runs the turn from the top (no partial replay)', async () => {
      // First attempt explodes after 1 event.
      let firstConstructs = 0
      const first = runDurableTurn<FakeEvent>({
        store,
        runId: 'chat:thread-1:2',
        manifest: makeManifest(2),
        workerId: 'worker-a',
        produce: () =>
          fakeProducer({
            chunks: ['partial', '-lost'],
            throwAfter: 1,
            onConstruct: () => (firstConstructs += 1),
          }),
        replayEvent: (text) => ({ type: 'result', text }),
      })
      const firstEvents: FakeEvent[] = []
      await expect(
        (async () => {
          for await (const e of first.stream) firstEvents.push(e)
        })(),
      ).rejects.toThrow('producer exploded mid-stream')
      expect(firstConstructs).toBe(1)
      expect(first.record()?.status).toBe('failed')

      // Second attempt — the failed step is NOT replayed; the producer runs
      // again and the turn completes cleanly.
      let secondConstructs = 0
      const second = runDurableTurn<FakeEvent>({
        store,
        runId: 'chat:thread-1:2',
        manifest: makeManifest(2),
        workerId: 'worker-a',
        produce: () =>
          fakeProducer({ chunks: ['recovered'], onConstruct: () => (secondConstructs += 1) }),
        replayEvent: (text) => ({ type: 'result', text }),
      })
      const secondEvents: FakeEvent[] = []
      for await (const e of second.stream) secondEvents.push(e)

      expect(secondConstructs).toBe(1)
      expect(second.replayed()).toBe(false)
      expect(second.finalText()).toBe('recovered')
      expect(secondEvents).toEqual([
        { type: 'delta', text: 'recovered' },
        { type: 'result', text: 'recovered' },
      ])
    })

    it('the accumulate hook builds final text when the producer reports none', async () => {
      // Producer whose finalText() stays empty — accumulate must fill it.
      function emptyFinalProducer() {
        async function* stream(): AsyncGenerator<FakeEvent, void, unknown> {
          yield { type: 'delta', text: 'a' }
          yield { type: 'delta', text: 'b' }
        }
        return { stream: stream(), finalText: () => '' }
      }
      const handle = runDurableTurn<FakeEvent>({
        store,
        runId: 'chat:thread-1:3',
        manifest: makeManifest(3),
        workerId: 'worker-a',
        produce: emptyFinalProducer,
        replayEvent: (text) => ({ type: 'result', text }),
        accumulate: (event, current) =>
          event.type === 'delta' ? current + (event.text ?? '') : undefined,
      })
      for await (const _ of handle.stream) {
        /* drain */
      }
      expect(handle.finalText()).toBe('ab')

      // Replay must return the accumulated text.
      const replay = runDurableTurn<FakeEvent>({
        store,
        runId: 'chat:thread-1:3',
        manifest: makeManifest(3),
        workerId: 'worker-b',
        produce: emptyFinalProducer,
        replayEvent: (text) => ({ type: 'result', text }),
      })
      const events: FakeEvent[] = []
      for await (const e of replay.stream) events.push(e)
      expect(events).toEqual([{ type: 'result', text: 'ab' }])
    })

    it('rejects a concurrent attempt while the first turn holds the lease', async () => {
      // Start the first turn but do NOT drain it — lease stays held.
      const first = runDurableTurn<FakeEvent>({
        store,
        runId: 'chat:thread-1:4',
        manifest: makeManifest(4),
        workerId: 'worker-a',
        leaseMs: 60_000,
        produce: () => fakeProducer({ chunks: ['slow'] }),
        replayEvent: (text) => ({ type: 'result', text }),
      })
      // Pump the first stream just enough to claim the lease (startOrResume
      // runs on the first `.next()`).
      const firstIter = first.stream[Symbol.asyncIterator]()
      await firstIter.next()

      // Concurrent worker on the same runId must be rejected.
      const second = runDurableTurn<FakeEvent>({
        store,
        runId: 'chat:thread-1:4',
        manifest: makeManifest(4),
        workerId: 'worker-b',
        leaseMs: 60_000,
        produce: () => fakeProducer({ chunks: ['concurrent'] }),
        replayEvent: (text) => ({ type: 'result', text }),
      })
      await expect(
        (async () => {
          for await (const _ of second.stream) {
            /* drain */
          }
        })(),
      ).rejects.toBeInstanceOf(DurableRunLeaseHeldError)

      // Drain the first to release the lease cleanly.
      for await (const _ of { [Symbol.asyncIterator]: () => firstIter }) {
        /* drain remainder */
      }
    })
  })
}
