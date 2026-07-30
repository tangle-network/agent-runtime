import { describe, expect, it } from 'vitest'
import { type BusEvent, type BusRecord, createEventBus } from '../../src/runtime'

type E =
  | { type: 'settled'; id: string }
  | { type: 'finding'; claim: string }
  | { type: 'question'; q: string }

// A monotonic clock so timestamp assertions are deterministic.
const fakeClock = () => {
  let t = 1000
  return () => t++
}

const freshBus = <T extends BusEvent>(now = fakeClock()) =>
  createEventBus<T>({ now, priorRecords: [], queuedPriorSeqs: [] })

describe('event bus', () => {
  it('passes the stamped record to subscribers and queues the event for pull', async () => {
    const bus = freshBus<E>()
    const seen: BusRecord<E>[] = []
    bus.subscribe((r) => {
      seen.push(r)
    })
    await bus.publish({ type: 'settled', id: 'w1' }, { priority: 0, queue: true })
    await bus.publish({ type: 'finding', claim: 'X missing' }, { priority: 0, queue: true })
    // pass-through lane: subscriber saw both immediately, stamped with seq + timestamp + priority
    expect(seen).toEqual([
      { seq: 0, at: 1000, priority: 0, event: { type: 'settled', id: 'w1' } },
      { seq: 1, at: 1001, priority: 0, event: { type: 'finding', claim: 'X missing' } },
    ])
    // standby lane: still queued for the driver to pull
    expect(bus.pending()).toBe(2)
  })

  it('pull is FIFO within a priority, and kind-filtered, draining each event once', async () => {
    const bus = freshBus<E>()
    await bus.publish({ type: 'settled', id: 'w1' }, { priority: 0, queue: true })
    await bus.publish({ type: 'finding', claim: 'a' }, { priority: 0, queue: true })
    await bus.publish({ type: 'settled', id: 'w2' }, { priority: 0, queue: true })
    // kind filter skips past the settled at the head to the first finding
    expect(bus.pull(['finding'])).toEqual({ type: 'finding', claim: 'a' })
    expect(bus.pending(['finding'])).toBe(0)
    // unfiltered pull is FIFO over what remains
    expect(bus.pull()).toEqual({ type: 'settled', id: 'w1' })
    expect(bus.pull()).toEqual({ type: 'settled', id: 'w2' })
    expect(bus.pull()).toBeUndefined()
  })

  it('pull bumps higher-priority events ahead of the queue (the blocking-question lane)', async () => {
    const bus = freshBus<E>()
    await bus.publish({ type: 'settled', id: 'w1' }, { priority: 0, queue: true })
    await bus.publish({ type: 'settled', id: 'w2' }, { priority: 0, queue: true })
    // a blocking question arrives last but jumps to the front
    await bus.publish({ type: 'question', q: 'which API version?' }, { priority: 20, queue: true })
    await bus.publish({ type: 'finding', claim: 'late finding' }, { priority: 0, queue: true })
    expect(bus.pull()).toEqual({ type: 'question', q: 'which API version?' })
    // then the rest drain FIFO at priority 0
    expect(bus.pull()).toEqual({ type: 'settled', id: 'w1' })
    expect(bus.pull()).toEqual({ type: 'settled', id: 'w2' })
    expect(bus.pull()).toEqual({ type: 'finding', claim: 'late finding' })
  })

  it('history is the full ordered audit trail; stats count throughput', async () => {
    const bus = freshBus<E>()
    await bus.publish({ type: 'settled', id: 'w1' }, { priority: 0, queue: true })
    await bus.publish({ type: 'finding', claim: 'a' }, { priority: 0, queue: true })
    await bus.publish({ type: 'question', q: 'q' }, { priority: 20, queue: true })
    bus.pull() // pulls the priority-20 question
    expect(bus.history().map((r) => r.event.type)).toEqual(['settled', 'finding', 'question'])
    expect(bus.history()[2]).toMatchObject({ seq: 2, priority: 20, at: 1002 })
    expect(bus.stats()).toEqual({
      published: 3,
      pulled: 1,
      byKind: { settled: 1, finding: 1, question: 1 },
    })
  })

  it('queue:false records to history + subscribers but never enters the pull queue', async () => {
    const bus = freshBus<E>()
    const seen: string[] = []
    bus.subscribe((r) => {
      seen.push(r.event.type)
    })
    await bus.publish({ type: 'settled', id: 'w1' }, { priority: 0, queue: true })
    await bus.publish({ type: 'question', q: 'down-leg' }, { priority: 0, queue: false })
    // The record-only event reached subscribers + the audit log...
    expect(seen).toEqual(['settled', 'question'])
    expect(bus.history().map((r) => r.event.type)).toEqual(['settled', 'question'])
    expect(bus.stats()).toMatchObject({ published: 2 })
    // ...but is invisible to the pull queue: only the queued settled is pending/pullable.
    expect(bus.pending()).toBe(1)
    expect(bus.pull()).toEqual({ type: 'settled', id: 'w1' })
    expect(bus.pull()).toBeUndefined()
  })

  it('unsubscribe stops delivery', async () => {
    const bus = freshBus<BusEvent>()
    const seen: string[] = []
    const off = bus.subscribe((r) => {
      seen.push(r.event.type)
    })
    await bus.publish({ type: 'settled' }, { priority: 0, queue: true })
    off()
    await bus.publish({ type: 'finding' }, { priority: 0, queue: true })
    expect(seen).toEqual(['settled'])
  })
})
