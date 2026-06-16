import { describe, expect, it } from 'vitest'
import { type BusEvent, createEventBus } from '../../src/runtime'

type E =
  | { type: 'settled'; id: string }
  | { type: 'finding'; claim: string }
  | { type: 'question'; q: string }

describe('event bus', () => {
  it('passes every event to subscribers and queues it for pull', async () => {
    const bus = createEventBus<E>()
    const seen: E[] = []
    bus.subscribe((e) => {
      seen.push(e)
    })
    await bus.publish({ type: 'settled', id: 'w1' })
    await bus.publish({ type: 'finding', claim: 'X missing' })
    // pass-through lane: subscriber saw both immediately
    expect(seen).toEqual([
      { type: 'settled', id: 'w1' },
      { type: 'finding', claim: 'X missing' },
    ])
    // standby lane: still queued for the driver to pull
    expect(bus.pending()).toBe(2)
  })

  it('pull is FIFO and kind-filtered, draining each event once', async () => {
    const bus = createEventBus<E>()
    await bus.publish({ type: 'settled', id: 'w1' })
    await bus.publish({ type: 'finding', claim: 'a' })
    await bus.publish({ type: 'settled', id: 'w2' })
    // kind filter skips past the settled at the head to the first finding
    expect(bus.pull(['finding'])).toEqual({ type: 'finding', claim: 'a' })
    expect(bus.pending(['finding'])).toBe(0)
    // unfiltered pull is FIFO over what remains
    expect(bus.pull()).toEqual({ type: 'settled', id: 'w1' })
    expect(bus.pull()).toEqual({ type: 'settled', id: 'w2' })
    expect(bus.pull()).toBeUndefined()
  })

  it('subscribers registered after a publish do not receive the earlier event', async () => {
    const bus = createEventBus<BusEvent>()
    await bus.publish({ type: 'settled' })
    const late: BusEvent[] = []
    bus.subscribe((e) => {
      late.push(e)
    })
    await bus.publish({ type: 'finding' })
    expect(late).toEqual([{ type: 'finding' }])
  })
})
