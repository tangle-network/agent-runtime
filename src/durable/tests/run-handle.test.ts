/**
 * `runReconnectableTurn` tests — the cross-worker sandbox-reconnect path.
 *
 * Run identically against InMemory / FileSystem / D1-over-sqlite so the
 * handle registry is proven on every store a product could deploy on.
 *
 * Each test names the regression it defends:
 *   - "fresh turn registers a handle"        — handle is checkpointed at step 0
 *   - "retry with running handle reconnects" — fresh worker calls reconnect,
 *                                              NOT produce; the 15-min turn is
 *                                              not re-run from the top
 *   - "completed handle replays"             — a finished turn replays cached
 *                                              text, neither produce nor
 *                                              reconnect runs
 *   - "running handle, no reconnect = rerun" — tcloud substrate (no replay
 *                                              endpoint) falls through to a
 *                                              clean re-run
 *   - "reconnect failure fails the run"      — a replay-endpoint error is not
 *                                              swallowed; the turn step fails
 *   - "register advances the cursor"         — the last-observed SSE cursor is
 *                                              persisted for the replay GET
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  D1DurableRunStore,
  type DurableRunManifest,
  type DurableRunStore,
  FileSystemDurableRunStore,
  InMemoryDurableRunStore,
  type ReconnectableProduce,
  type ReconnectProduce,
  type RunHandle,
  runReconnectableTurn,
} from '../index'
import { createSqliteD1 } from './sqlite-d1-adapter'

const SCHEMA_SQL = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')

interface FakeEvent {
  type: string
  text?: string
  runId?: string
}

function makeManifest(turnIndex = 0): DurableRunManifest {
  return {
    projectId: 'test-product',
    scenarioId: 'thread-1',
    task: {
      id: `chat:thread-1:${turnIndex}`,
      intent: 'unit-test reconnectable turn',
      domain: 'test',
      requiredKnowledge: [],
      metadata: { turnIndex },
    },
    input: { userMessage: `q-${turnIndex}` },
  }
}

/**
 * A fake sandbox producer. Emits an `execution.started` event carrying a run
 * id (the producer registers the handle on it, mirroring how a real product
 * watches `streamPrompt`), then text deltas, then a result. `throwAt` makes
 * it explode after that many *yielded* events to simulate a mid-turn crash.
 */
function sandboxProducer(opts: {
  sandboxId: string
  sessionId: string
  runId: string
  chunks: string[]
  register: (handle: RunHandle) => void
  onConstruct?: () => void
  throwAt?: number
}) {
  opts.onConstruct?.()
  let assembled = ''
  async function* stream(): AsyncGenerator<FakeEvent, void, unknown> {
    let emitted = 0
    // streamPrompt yields execution.started first — the product registers the
    // run handle here, mid-turn, before any expensive work.
    opts.register({
      kind: 'sandbox',
      sandboxId: opts.sandboxId,
      sessionId: opts.sessionId,
      runId: opts.runId,
      status: 'running',
    })
    yield { type: 'execution.started', runId: opts.runId }
    emitted += 1
    for (let i = 0; i < opts.chunks.length; i++) {
      if (opts.throwAt !== undefined && emitted >= opts.throwAt) {
        throw new Error('worker isolate died mid-turn')
      }
      assembled += opts.chunks[i]
      // advance the replay cursor as frames arrive
      opts.register({
        kind: 'sandbox',
        sandboxId: opts.sandboxId,
        sessionId: opts.sessionId,
        runId: opts.runId,
        status: 'running',
        cursor: `evt-${i}`,
      })
      yield { type: 'delta', text: opts.chunks[i] }
      emitted += 1
    }
    yield { type: 'result', text: assembled }
  }
  return { stream: stream(), finalText: () => assembled }
}

const storeKinds = [
  {
    name: 'InMemoryDurableRunStore',
    factory: () => ({ store: new InMemoryDurableRunStore(), cleanup: () => undefined }),
  },
  {
    name: 'FileSystemDurableRunStore',
    factory: () => {
      const dir = mkdtempSync(join(tmpdir(), 'run-handle-test-'))
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
  describe(`runReconnectableTurn / ${kind.name}`, () => {
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

    it('a fresh turn registers a run handle and checkpoints final text', async () => {
      const handle = runReconnectableTurn<FakeEvent>({
        store,
        runId: 'chat:thread-1:0',
        manifest: makeManifest(0),
        workerId: 'worker-a',
        produce: ({ register }) =>
          sandboxProducer({
            sandboxId: 'sbx-1',
            sessionId: 'sess-1',
            runId: 'run-1',
            chunks: ['Hello', ', ', 'world'],
            register,
          }),
        replayEvent: (text) => ({ type: 'result', text }),
      })

      const events: FakeEvent[] = []
      for await (const e of handle.stream) events.push(e)

      expect(handle.mode()).toBe('fresh')
      expect(handle.finalText()).toBe('Hello, world')
      expect(handle.record()?.status).toBe('completed')
      // handle was registered, and the final state reflects turn completion
      const h = handle.handle()
      expect(h).toBeDefined()
      expect(h?.kind).toBe('sandbox')
      expect(h?.sandboxId).toBe('sbx-1')
      expect(h?.sessionId).toBe('sess-1')
      expect(h?.runId).toBe('run-1')
      expect(h?.status).toBe('completed')
      // the handle is durably persisted at step 0
      const persisted = await store.loadStep('chat:thread-1:0', 0)
      expect(persisted?.status).toBe('completed')
      expect((persisted?.result as { handle: RunHandle }).handle.sandboxId).toBe('sbx-1')
    })

    it('a retry with a running handle reconnects instead of re-running produce', async () => {
      const runId = 'chat:thread-1:1'
      const manifest = makeManifest(1)

      // ── Attempt 1: worker-a starts the turn, crashes mid-stream ───────
      let firstProduces = 0
      const first = runReconnectableTurn<FakeEvent>({
        store,
        runId,
        manifest,
        workerId: 'worker-a',
        produce: ({ register }) => {
          firstProduces += 1
          return sandboxProducer({
            sandboxId: 'sbx-2',
            sessionId: 'sess-2',
            runId: 'run-2',
            chunks: ['long', '-turn', '-work'],
            register,
            throwAt: 2, // dies after execution.started + 1 delta
          })
        },
        replayEvent: (text) => ({ type: 'result', text }),
      })
      await expect(
        (async () => {
          for await (const _ of first.stream) {
            /* drain until the crash */
          }
        })(),
      ).rejects.toThrow('worker isolate died mid-turn')
      expect(firstProduces).toBe(1)
      // the handle survived the crash in `running` state
      const survived = await store.loadStep(runId, 0)
      expect((survived?.result as { handle: RunHandle }).handle.status).toBe('running')

      // ── Attempt 2: worker-b retries — must reconnect, NOT produce ─────
      let secondProduces = 0
      let reconnectedWith: RunHandle | undefined
      const reconnect: ReconnectProduce<FakeEvent> = (h) => {
        reconnectedWith = h
        // the replay endpoint streams the rest of the turn from the cursor
        let assembled = '[replayed] full answer'
        async function* stream(): AsyncGenerator<FakeEvent, void, unknown> {
          yield { type: 'delta', text: '[replayed] full answer' }
          yield { type: 'result', text: assembled }
        }
        return { stream: stream(), finalText: () => assembled }
      }
      const second = runReconnectableTurn<FakeEvent>({
        store,
        runId,
        manifest,
        workerId: 'worker-b',
        produce: ({ register }) => {
          secondProduces += 1
          return sandboxProducer({
            sandboxId: 'sbx-2',
            sessionId: 'sess-2',
            runId: 'run-2',
            chunks: ['should', '-not', '-run'],
            register,
          })
        },
        reconnect,
        replayEvent: (text) => ({ type: 'result', text }),
      })
      const events: FakeEvent[] = []
      for await (const e of second.stream) events.push(e)

      // produce was NOT called again — the 15-min turn was not restarted
      expect(secondProduces).toBe(0)
      expect(second.mode()).toBe('reconnected')
      // reconnect received the handle the crashed worker checkpointed
      expect(reconnectedWith?.sandboxId).toBe('sbx-2')
      expect(reconnectedWith?.runId).toBe('run-2')
      expect(reconnectedWith?.cursor).toBe('evt-0') // last cursor before crash
      expect(second.finalText()).toBe('[replayed] full answer')
      expect(second.record()?.status).toBe('completed')
      expect(events).toEqual([
        { type: 'delta', text: '[replayed] full answer' },
        { type: 'result', text: '[replayed] full answer' },
      ])
    })

    it('a completed handle replays cached text — neither produce nor reconnect runs', async () => {
      const runId = 'chat:thread-1:2'
      const manifest = makeManifest(2)

      // Attempt 1 completes cleanly.
      const first = runReconnectableTurn<FakeEvent>({
        store,
        runId,
        manifest,
        workerId: 'worker-a',
        produce: ({ register }) =>
          sandboxProducer({
            sandboxId: 'sbx-3',
            sessionId: 'sess-3',
            runId: 'run-3',
            chunks: ['cached ', 'result'],
            register,
          }),
        replayEvent: (text) => ({ type: 'result', text }),
      })
      for await (const _ of first.stream) {
        /* drain */
      }
      expect(first.mode()).toBe('fresh')

      // Attempt 2 — same runId. Worker died after the turn finished but before
      // the response reached the client. Must replay, run nothing.
      let produces = 0
      let reconnects = 0
      const second = runReconnectableTurn<FakeEvent>({
        store,
        runId,
        manifest,
        workerId: 'worker-b',
        produce: ({ register }) => {
          produces += 1
          return sandboxProducer({
            sandboxId: 'sbx-3',
            sessionId: 'sess-3',
            runId: 'run-3',
            chunks: ['x'],
            register,
          })
        },
        reconnect: () => {
          reconnects += 1
          async function* stream(): AsyncGenerator<FakeEvent, void, unknown> {
            yield { type: 'result', text: 'wrong' }
          }
          return { stream: stream(), finalText: () => 'wrong' }
        },
        replayEvent: (text) => ({ type: 'result', text }),
      })
      const events: FakeEvent[] = []
      for await (const e of second.stream) events.push(e)

      expect(produces).toBe(0)
      expect(reconnects).toBe(0)
      expect(second.mode()).toBe('replayed')
      expect(second.finalText()).toBe('cached result')
      expect(events).toEqual([{ type: 'result', text: 'cached result' }])
    })

    it('a running handle with no reconnect callback falls through to a re-run', async () => {
      const runId = 'chat:thread-1:3'
      const manifest = makeManifest(3)

      // Attempt 1 — a tcloud-style turn (no reconnect) crashes mid-stream.
      const tcloudProduce: ReconnectableProduce<FakeEvent> = ({ register }) => {
        register({ kind: 'tcloud', status: 'running' })
        let assembled = ''
        async function* stream(): AsyncGenerator<FakeEvent, void, unknown> {
          assembled += 'partial'
          yield { type: 'delta', text: 'partial' }
          throw new Error('tcloud turn crashed')
        }
        return { stream: stream(), finalText: () => assembled }
      }
      const first = runReconnectableTurn<FakeEvent>({
        store,
        runId,
        manifest,
        workerId: 'worker-a',
        produce: tcloudProduce,
        replayEvent: (text) => ({ type: 'result', text }),
        // no reconnect — tcloud has no cross-process replay endpoint
      })
      await expect(
        (async () => {
          for await (const _ of first.stream) {
            /* drain */
          }
        })(),
      ).rejects.toThrow('tcloud turn crashed')

      // Attempt 2 — running handle exists but reconnect is absent: re-run.
      let produces = 0
      const second = runReconnectableTurn<FakeEvent>({
        store,
        runId,
        manifest,
        workerId: 'worker-a',
        produce: ({ register }) => {
          produces += 1
          register({ kind: 'tcloud', status: 'running' })
          let assembled = ''
          async function* stream(): AsyncGenerator<FakeEvent, void, unknown> {
            assembled += 'recovered'
            yield { type: 'delta', text: 'recovered' }
            yield { type: 'result', text: assembled }
          }
          return { stream: stream(), finalText: () => assembled }
        },
        replayEvent: (text) => ({ type: 'result', text }),
      })
      const events: FakeEvent[] = []
      for await (const e of second.stream) events.push(e)

      expect(produces).toBe(1) // re-ran from the top
      expect(second.mode()).toBe('rerun')
      expect(second.finalText()).toBe('recovered')
      expect(events).toEqual([
        { type: 'delta', text: 'recovered' },
        { type: 'result', text: 'recovered' },
      ])
    })

    it('a reconnect-stream failure fails the run — the error is not swallowed', async () => {
      const runId = 'chat:thread-1:4'
      const manifest = makeManifest(4)

      // Attempt 1 crashes mid-turn, leaving a running handle.
      const first = runReconnectableTurn<FakeEvent>({
        store,
        runId,
        manifest,
        workerId: 'worker-a',
        produce: ({ register }) =>
          sandboxProducer({
            sandboxId: 'sbx-5',
            sessionId: 'sess-5',
            runId: 'run-5',
            chunks: ['a', 'b'],
            register,
            throwAt: 2,
          }),
        replayEvent: (text) => ({ type: 'result', text }),
      })
      await expect(
        (async () => {
          for await (const _ of first.stream) {
            /* drain */
          }
        })(),
      ).rejects.toThrow('worker isolate died mid-turn')

      // Attempt 2 reconnects, but the replay endpoint itself errors.
      const second = runReconnectableTurn<FakeEvent>({
        store,
        runId,
        manifest,
        workerId: 'worker-b',
        produce: ({ register }) =>
          sandboxProducer({
            sandboxId: 'sbx-5',
            sessionId: 'sess-5',
            runId: 'run-5',
            chunks: ['x'],
            register,
          }),
        reconnect: () => {
          async function* stream(): AsyncGenerator<FakeEvent, void, unknown> {
            yield { type: 'delta', text: 'partial-replay' }
            throw new Error('replay endpoint returned 410 Gone')
          }
          return { stream: stream(), finalText: () => '' }
        },
        replayEvent: (text) => ({ type: 'result', text }),
      })
      await expect(
        (async () => {
          for await (const _ of second.stream) {
            /* drain */
          }
        })(),
      ).rejects.toThrow('replay endpoint returned 410 Gone')
      expect(second.mode()).toBe('reconnected')
      expect(second.record()?.status).toBe('failed')
      // the turn step is marked failed so a further retry re-runs cleanly
      const turnStep = await store.loadStep(runId, 1)
      expect(turnStep?.status).toBe('failed')
    })

    it('register advances the persisted cursor as frames stream', async () => {
      const runId = 'chat:thread-1:5'
      const handle = runReconnectableTurn<FakeEvent>({
        store,
        runId,
        manifest: makeManifest(5),
        workerId: 'worker-a',
        produce: ({ register }) =>
          sandboxProducer({
            sandboxId: 'sbx-6',
            sessionId: 'sess-6',
            runId: 'run-6',
            chunks: ['one', 'two', 'three'],
            register,
          }),
        replayEvent: (text) => ({ type: 'result', text }),
      })
      for await (const _ of handle.stream) {
        /* drain */
      }
      // three deltas streamed → last cursor observed was evt-2; after
      // completion the persisted handle is flipped to `completed`.
      const persisted = await store.loadStep(runId, 0)
      const h = (persisted?.result as { handle: RunHandle }).handle
      expect(h.status).toBe('completed')
      expect(h.cursor).toBe('evt-2')
      expect(h.runId).toBe('run-6')
    })
  })
}
