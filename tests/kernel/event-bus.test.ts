import { describe, expect, it } from 'vitest'
import { type BusRecord, createEventBus } from '../../src/runtime'

type E =
  | { type: 'settled'; id: string }
  | { type: 'finding'; claim: string }
  | { type: 'question'; q: string }

// A monotonic clock so timestamp assertions are deterministic.
const fakeClock = () => {
  let t = 1000
  return () => t++
}

describe('event bus', () => {
  it('keeps an event invisible until awaited subscribers commit and reuses its stamp on retry', async () => {
    const bus = createEventBus<E>(fakeClock())
    const event = { type: 'settled', id: 'w1' } as const
    const attempts: BusRecord<E>[] = []
    let fail = true
    bus.subscribe((record) => {
      attempts.push(record)
      if (fail) throw new Error('product transaction unavailable')
    })

    await expect(bus.publish(event)).rejects.toThrow('product transaction unavailable')
    expect(bus.pending()).toBe(0)
    expect(bus.pull()).toBeUndefined()
    expect(bus.history()).toEqual([])
    expect(bus.stats()).toEqual({ published: 0, pulled: 0, byKind: {} })

    fail = false
    await expect(bus.publish(event)).resolves.toMatchObject({ seq: 0, at: 1000, event })
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toBe(attempts[0])
    expect(bus.pull()).toBe(event)
    expect(bus.stats()).toEqual({ published: 1, pulled: 1, byKind: { settled: 1 } })
  })
})

describe('EventBus.onQueued — the moment a waiting consumer can pull a record', () => {
  it('fires after the record is pull-visible, never for a record-only event, until unsubscribed', async () => {
    const bus = createEventBus<{ type: 'a' | 'b' }>()
    const seen: Array<{ type: string; pending: number }> = []
    // A subscriber runs before the record is queued; onQueued runs after it.
    bus.subscribe(() => {
      seen.push({ type: 'subscriber', pending: bus.pending() })
    })
    const stop = bus.onQueued((record) => {
      seen.push({ type: record.event.type, pending: bus.pending() })
    })
    await bus.publish({ type: 'a' })
    await bus.publish({ type: 'b' }, { queue: false })
    stop()
    await bus.publish({ type: 'a' })
    expect(seen).toEqual([
      { type: 'subscriber', pending: 0 },
      { type: 'a', pending: 1 },
      { type: 'subscriber', pending: 1 },
      { type: 'subscriber', pending: 1 },
    ])
  })
})
