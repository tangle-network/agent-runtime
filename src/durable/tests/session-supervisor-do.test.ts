import { describe, expect, it } from 'vitest'
import { InMemoryDurableRunStore } from '../in-memory-store'
import {
  ACTIVE_RUN_KEY,
  createSessionSupervisorDO,
  type DurableObjectStateLike,
  type DurableObjectStorageLike,
  type SupervisorHostConfig,
} from '../session-supervisor-do'
import {
  runSupervisedTurn,
  type SandboxReconnectAdapter,
  type SupervisedEvent,
} from '../supervisor'
import type { DurableRunManifest, RunHandle } from '../types'

const manifest = {
  projectId: 'test',
  scenarioId: 'persona-1',
  task: { id: 'task-1', intent: 'chat', domain: 'test' },
  input: { q: 'hello' },
} as unknown as DurableRunManifest

class FakeStorage implements DurableObjectStorageLike {
  map = new Map<string, unknown>()
  alarmAt: number | null = null
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined
  }
  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.map.set(key, value)
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key)
  }
  async setAlarm(scheduledTime: number): Promise<void> {
    this.alarmAt = scheduledTime
  }
}

class FakeState implements DurableObjectStateLike {
  storage = new FakeStorage()
}

/** A fixed-length scripted adapter — `start` carries the handle on frame 0,
 *  `attach` resumes strictly past the cursor. */
function scriptedAdapter(n: number): SandboxReconnectAdapter<number> {
  const ids = Array.from({ length: n }, (_, i) => i)
  return {
    async *start(): AsyncGenerator<SupervisedEvent<number>> {
      for (const i of ids) {
        const handle: RunHandle | undefined =
          i === 0 ? { kind: 'sandbox', runId: 's1', status: 'running' } : undefined
        yield { eventId: `e${i}`, payload: i, handle }
      }
    },
    async *attach(
      _handle: RunHandle,
      afterEventId: string | undefined,
    ): AsyncGenerator<SupervisedEvent<number>> {
      const found = afterEventId ? ids.findIndex((i) => `e${i}` === afterEventId) : -1
      for (let i = found + 1; i < ids.length; i++) yield { eventId: `e${i}`, payload: i }
    },
  }
}

function config(
  store: InMemoryDurableRunStore,
): SupervisorHostConfig<number, Record<string, never>> {
  return {
    async resolveRun() {
      return { store, runId: 'do-run', manifest, workerId: 'w-fetch', adapter: scriptedAdapter(4) }
    },
    async resolveOrphan(runId) {
      return { store, runId, manifest, workerId: 'w-alarm', adapter: scriptedAdapter(4) }
    },
    encodeEvent: (event) => `data: ${event}\n`,
    now: () => 1000,
  }
}

async function consume<T>(
  stream: AsyncGenerator<T>,
  limit = Number.POSITIVE_INFINITY,
): Promise<T[]> {
  const out: T[] = []
  for await (const v of stream) {
    out.push(v)
    if (out.length >= limit) break
  }
  return out
}

describe('SessionSupervisorDO — fetch', () => {
  it('streams the supervised events, arms the alarm, and clears the run on completion', async () => {
    const store = new InMemoryDurableRunStore()
    const DO = createSessionSupervisorDO(config(store))
    const state = new FakeState()
    const instance = new DO(state, {})

    const res = await instance.fetch(new Request('http://do/'))
    const text = await res.text()

    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(text).toBe('data: 0\ndata: 1\ndata: 2\ndata: 3\n')
    expect(state.storage.alarmAt).toBe(1000 + 60_000)
    // The run finished — the orphan-tracking key is cleared.
    expect(state.storage.map.has(ACTIVE_RUN_KEY)).toBe(false)
    expect((await store.readStreamEvents('do-run')).map((e) => e.payload)).toEqual([0, 1, 2, 3])
  })

  it('404s when no run resolves for the request', async () => {
    const store = new InMemoryDurableRunStore()
    const DO = createSessionSupervisorDO({
      ...config(store),
      async resolveRun() {
        return undefined
      },
    })
    const res = await new DO(new FakeState(), {}).fetch(new Request('http://do/'))
    expect(res.status).toBe(404)
  })
})

describe('SessionSupervisorDO — alarm re-attaches an orphan', () => {
  it('drives a run abandoned by a dropped response stream to completion', async () => {
    const store = new InMemoryDurableRunStore()

    // A fetch drained 2 of 4 events, then its worker died — simulate by
    // partially consuming a supervised turn and lapsing the lease.
    await consume(
      runSupervisedTurn({
        store,
        runId: 'do-run',
        manifest,
        workerId: 'w-dead',
        adapter: scriptedAdapter(4),
      }).stream,
      2,
    )
    store._expireLease('do-run')
    expect(await store.readStreamEvents('do-run')).toHaveLength(2)

    // The DO still has the run recorded; the orphan-check alarm fires.
    const DO = createSessionSupervisorDO(config(store))
    const state = new FakeState()
    await state.storage.put(ACTIVE_RUN_KEY, 'do-run')
    await new DO(state, {}).alarm()

    // The run was re-driven headlessly to completion and cleared.
    expect((await store.readStreamEvents('do-run')).map((e) => e.payload)).toEqual([0, 1, 2, 3])
    expect(store._inspect('do-run')?.status).toBe('completed')
    expect(state.storage.map.has(ACTIVE_RUN_KEY)).toBe(false)
  })

  it('is a no-op when no run is recorded', async () => {
    const store = new InMemoryDurableRunStore()
    const DO = createSessionSupervisorDO(config(store))
    await expect(new DO(new FakeState(), {}).alarm()).resolves.toBeUndefined()
  })
})
