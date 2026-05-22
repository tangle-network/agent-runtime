import { describe, expect, it, vi } from 'vitest'
import { InMemoryDurableRunStore } from '../in-memory-store'
import {
  type RunSupervisorOptions,
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

const HANDLE: RunHandle = {
  kind: 'sandbox',
  sandboxId: 'sbx-1',
  runId: 'sbx-run-1',
  status: 'running',
}

interface ScriptEvent {
  eventId: string
  payload: number
}

/** A controllable SandboxReconnectAdapter over a fixed script of events.
 *  `start` carries the handle on the first frame; `attach` resumes past the
 *  cursor (or re-yields the boundary when `reYieldBoundary`). */
class ScriptedAdapter implements SandboxReconnectAdapter<number> {
  startCalls = 0
  attachCalls = 0
  constructor(
    private readonly script: ScriptEvent[],
    private readonly opts: { reYieldBoundary?: boolean } = {},
  ) {}

  async *start(): AsyncGenerator<SupervisedEvent<number>> {
    this.startCalls += 1
    for (const [i, e] of this.script.entries()) {
      yield { eventId: e.eventId, payload: e.payload, handle: i === 0 ? HANDLE : undefined }
    }
  }

  async *attach(
    _handle: RunHandle,
    afterEventId: string | undefined,
  ): AsyncGenerator<SupervisedEvent<number>> {
    this.attachCalls += 1
    const found = afterEventId ? this.script.findIndex((e) => e.eventId === afterEventId) : -1
    const from = found >= 0 ? found + (this.opts.reYieldBoundary ? 0 : 1) : 0
    for (let i = from; i < this.script.length; i++) {
      const e = this.script[i]!
      yield { eventId: e.eventId, payload: e.payload }
    }
  }
}

const script: ScriptEvent[] = [0, 1, 2, 3, 4, 5].map((n) => ({ eventId: `e${n}`, payload: n }))

function opts(
  store: InMemoryDurableRunStore,
  workerId: string,
  adapter: SandboxReconnectAdapter<number>,
  extra: Partial<RunSupervisorOptions<number>> = {},
): RunSupervisorOptions<number> {
  return { store, runId: 'turn-1', manifest, workerId, adapter, ...extra }
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

describe('runSupervisedTurn — fresh', () => {
  it('drains the adapter stream into the durable log and forwards it', async () => {
    const store = new InMemoryDurableRunStore()
    const sup = runSupervisedTurn(opts(store, 'w1', new ScriptedAdapter(script)))
    const out = await consume(sup.stream)

    expect(out).toEqual([0, 1, 2, 3, 4, 5])
    expect(sup.mode()).toBe('fresh')
    expect(sup.record()?.status).toBe('completed')
    const logged = await store.readStreamEvents('turn-1')
    expect(logged.map((e) => e.payload)).toEqual([0, 1, 2, 3, 4, 5])
    expect(logged.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('persists the run handle and flips it to completed on a clean drain', async () => {
    const store = new InMemoryDurableRunStore()
    const sup = runSupervisedTurn(opts(store, 'w1', new ScriptedAdapter(script)))
    await consume(sup.stream)
    expect(sup.record()?.handle).toMatchObject({ runId: 'sbx-run-1', status: 'completed' })
  })
})

describe('runSupervisedTurn — replayed', () => {
  it('a completed turn replays the logged stream without touching the adapter', async () => {
    const store = new InMemoryDurableRunStore()
    await consume(runSupervisedTurn(opts(store, 'w1', new ScriptedAdapter(script))).stream)

    const neverAdapter: SandboxReconnectAdapter<number> = {
      start() {
        throw new Error('start must not run on replay')
      },
      attach() {
        throw new Error('attach must not run on replay')
      },
    }
    const replay = runSupervisedTurn(opts(store, 'w2', neverAdapter))
    const out = await consume(replay.stream)
    expect(out).toEqual([0, 1, 2, 3, 4, 5])
    expect(replay.mode()).toBe('replayed')
  })
})

describe('runSupervisedTurn — chaos: cross-worker resume', () => {
  it('a turn killed mid-stream resumes on a fresh worker with no gap and no duplicate', async () => {
    const store = new InMemoryDurableRunStore()

    // Worker 1 drains 3 of 6 events, then its isolate "dies" — stop pulling.
    const sup1 = runSupervisedTurn(opts(store, 'w1', new ScriptedAdapter(script)))
    const partial = await consume(sup1.stream, 3)
    expect(partial).toEqual([0, 1, 2])

    // The dead worker no longer heartbeats — its lease lapses.
    store._expireLease('turn-1')
    expect(await store.readStreamEvents('turn-1')).toHaveLength(3)

    // Worker 2 picks the run up. The sandbox container outlived worker 1, so
    // the adapter still has the whole script.
    const adapter2 = new ScriptedAdapter(script)
    const sup2 = runSupervisedTurn(opts(store, 'w2', adapter2))
    const out = await consume(sup2.stream)

    expect(sup2.mode()).toBe('resumed')
    expect(adapter2.attachCalls).toBe(1)
    expect(adapter2.startCalls).toBe(0)
    // Worker 2's stream is the COMPLETE turn, each event exactly once.
    expect(out).toEqual([0, 1, 2, 3, 4, 5])
    expect(sup2.record()?.status).toBe('completed')
    // The durable log holds the full sequence with monotonic seqs — no gap.
    const logged = await store.readStreamEvents('turn-1')
    expect(logged.map((e) => e.payload)).toEqual([0, 1, 2, 3, 4, 5])
    expect(logged.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('dedups the reconnect seam when the adapter re-yields the boundary event', async () => {
    const store = new InMemoryDurableRunStore()
    const sup1 = runSupervisedTurn(opts(store, 'w1', new ScriptedAdapter(script)))
    await consume(sup1.stream, 3)
    store._expireLease('turn-1')

    // adapter2.attach re-yields the boundary event e2 (inclusive resume).
    const adapter2 = new ScriptedAdapter(script, { reYieldBoundary: true })
    const sup2 = runSupervisedTurn(opts(store, 'w2', adapter2))
    const out = await consume(sup2.stream)

    // The re-yielded e2 is idempotent on append → not double-forwarded.
    expect(out).toEqual([0, 1, 2, 3, 4, 5])
    const logged = await store.readStreamEvents('turn-1')
    expect(logged.map((e) => e.eventId)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5'])
  })

  it('survives two successive mid-stream deaths', async () => {
    const store = new InMemoryDurableRunStore()
    await consume(runSupervisedTurn(opts(store, 'w1', new ScriptedAdapter(script))).stream, 2)
    store._expireLease('turn-1')
    await consume(runSupervisedTurn(opts(store, 'w2', new ScriptedAdapter(script))).stream, 4)
    store._expireLease('turn-1')
    const sup3 = runSupervisedTurn(opts(store, 'w3', new ScriptedAdapter(script)))
    const out = await consume(sup3.stream)
    expect(out).toEqual([0, 1, 2, 3, 4, 5])
    expect((await store.readStreamEvents('turn-1')).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('runSupervisedTurn — lease + heartbeat', () => {
  it('renews the lease while draining a long turn', async () => {
    const store = new InMemoryDurableRunStore()
    const renew = vi.spyOn(store, 'renewLease')
    let clock = 0
    const sup = runSupervisedTurn(
      opts(store, 'w1', new ScriptedAdapter(script), {
        heartbeatMs: 10,
        now: () => {
          clock += 100 // each call advances well past the heartbeat window
          return clock
        },
      }),
    )
    await consume(sup.stream)
    expect(renew).toHaveBeenCalled()
  })

  it('aborts without writing terminal state when the lease is lost mid-drain', async () => {
    const store = new InMemoryDurableRunStore()
    vi.spyOn(store, 'renewLease').mockResolvedValue({ ok: false })
    let clock = 0
    const sup = runSupervisedTurn(
      opts(store, 'w1', new ScriptedAdapter(script), {
        heartbeatMs: 1,
        now: () => {
          clock += 100
          return clock
        },
      }),
    )
    await expect(consume(sup.stream)).rejects.toThrow(/lease lost/)
    // The supervisor that lost the lease must not mark the run failed —
    // the new owner owns the terminal state.
    expect(store._inspect('turn-1')?.status).not.toBe('failed')
  })
})

describe('SandboxReconnectAdapter — conformance', () => {
  it('start yields a running handle with a runId on an early frame', async () => {
    const adapter = new ScriptedAdapter(script)
    const first = await adapter.start().next()
    expect(first.done).toBe(false)
    expect(first.value?.handle).toMatchObject({ status: 'running', runId: 'sbx-run-1' })
  })

  it('attach yields only events strictly after the cursor', async () => {
    const adapter = new ScriptedAdapter(script)
    const out: number[] = []
    for await (const e of adapter.attach(HANDLE, 'e2')) out.push(e.payload)
    expect(out).toEqual([3, 4, 5])
  })

  it('attach from an undefined cursor yields the whole run', async () => {
    const adapter = new ScriptedAdapter(script)
    const out: number[] = []
    for await (const e of adapter.attach(HANDLE, undefined)) out.push(e.payload)
    expect(out).toEqual([0, 1, 2, 3, 4, 5])
  })
})
