import { describe, expect, it } from 'vitest'
import { createWorkerSlots, openSlotGroup, resolveWorkerSlots } from './worker-slots'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('worker slots', () => {
  it('queues a spawn past the bound and starts it when a slot frees', async () => {
    const slots = createWorkerSlots(2)
    const root = openSlotGroup(slots)
    const a = root.acquire(1)
    const b = root.acquire(1)
    const c = root.acquire(1)
    expect([a.granted, b.granted, c.granted]).toEqual([true, true, false])
    expect(slots.working).toBe(2)
    expect(slots.queued).toBe(1)
    let started = false
    void c.ready.then(() => {
      started = true
    })
    a.release()
    await flush()
    expect(started).toBe(true)
    expect(slots.working).toBe(2)
    expect(slots.queued).toBe(0)
    b.release()
    c.release()
    expect(slots.working).toBe(0)
  })

  it('never queues without a bound', () => {
    const slots = createWorkerSlots()
    const root = openSlotGroup(slots)
    const permits = Array.from({ length: 500 }, () => root.acquire(1))
    expect(permits.every((permit) => permit.granted)).toBe(true)
    expect(slots.working).toBe(500)
    for (const permit of permits) permit.release()
    expect(slots.working).toBe(0)
  })

  it('lends a waiting manager its slot, so a full tree still reaches depth five', async () => {
    // One slot: every level can still run because each manager lends its slot to its child.
    const slots = createWorkerSlots(1)
    const root = openSlotGroup(slots)
    const permits = []
    let group = root
    for (let depth = 1; depth <= 5; depth++) {
      const permit = group.acquire(depth)
      expect(permit.granted).toBe(true)
      permits.push(permit)
      group = openSlotGroup(slots, permit)
    }
    expect(slots.working).toBe(1)
    // A second root child waits: the one working unit belongs to the depth-five agent.
    const sibling = root.acquire(1)
    expect(sibling.granted).toBe(false)
    for (const permit of permits.reverse()) {
      permit.release()
      expect(sibling.granted).toBe(permit === permits.at(-1))
    }
    await sibling.ready
    expect(slots.working).toBe(1)
    sibling.release()
    expect(slots.working).toBe(0)
  })

  it('does not deadlock when every slot holder is a manager with a queued child', async () => {
    const slots = createWorkerSlots(3)
    const root = openSlotGroup(slots)
    const managers = [root.acquire(1), root.acquire(1), root.acquire(1)]
    const groups = managers.map((manager) => openSlotGroup(slots, manager))
    // Each manager spawns two children: the first takes over its manager's slot, the second waits.
    const first = groups.map((group) => group.acquire(2))
    const second = groups.map((group) => group.acquire(2))
    expect(first.every((permit) => permit.granted)).toBe(true)
    expect(second.some((permit) => permit.granted)).toBe(false)
    expect(slots.working).toBe(3)
    first[0]!.release()
    await second[0]!.ready
    expect(second[0]!.granted).toBe(true)
    expect(slots.working).toBe(3)
  })

  it('releases the deepest waiter first, then the oldest', async () => {
    const slots = createWorkerSlots(1)
    const root = openSlotGroup(slots)
    const holder = root.acquire(1)
    const holderGroup = openSlotGroup(slots, holder)
    const lent = holderGroup.acquire(2)
    expect(lent.granted).toBe(true)
    const shallow = root.acquire(1)
    const deepOld = holderGroup.acquire(2)
    const deepNew = holderGroup.acquire(2)
    const order: string[] = []
    void shallow.ready.then(() => order.push('shallow'))
    void deepOld.ready.then(() => order.push('deep-old'))
    void deepNew.ready.then(() => order.push('deep-new'))
    lent.release()
    await flush()
    expect(order).toEqual(['deep-old'])
    deepOld.release()
    await flush()
    expect(order).toEqual(['deep-old', 'deep-new'])
    deepNew.release()
    holder.release()
    await flush()
    expect(order).toEqual(['deep-old', 'deep-new', 'shallow'])
    shallow.release()
    expect(slots.working).toBe(0)
    expect(slots.queued).toBe(0)
  })

  it('withdraws a queued request without granting it', () => {
    const slots = createWorkerSlots(1)
    const root = openSlotGroup(slots)
    const a = root.acquire(1)
    const b = root.acquire(1)
    b.release()
    expect(slots.queued).toBe(0)
    a.release()
    expect(b.granted).toBe(false)
    expect(slots.working).toBe(0)
  })

  it('passes the slot up when a manager ends before its last child', () => {
    const slots = createWorkerSlots(1)
    const root = openSlotGroup(slots)
    const parent = root.acquire(1)
    const parentGroup = openSlotGroup(slots, parent)
    const manager = parentGroup.acquire(2)
    const managerGroup = openSlotGroup(slots, manager)
    const child = managerGroup.acquire(3)
    expect(slots.working).toBe(1)
    manager.release()
    expect(slots.working).toBe(1)
    child.release()
    // The unit went back to `parent`, which still runs.
    expect(slots.working).toBe(1)
    const next = parentGroup.acquire(2)
    expect(next.granted).toBe(true)
    expect(slots.working).toBe(1)
    next.release()
    parent.release()
    expect(slots.working).toBe(0)
  })

  it('shares one bound across trees and forces a recovered execution past it', () => {
    const slots = resolveWorkerSlots(createWorkerSlots(1))
    const treeA = openSlotGroup(slots)
    const treeB = openSlotGroup(slots)
    const a = treeA.acquire(1)
    const b = treeB.acquire(1)
    expect(b.granted).toBe(false)
    const recovered = treeB.acquire(1, { force: true })
    expect(recovered.granted).toBe(true)
    expect(slots.working).toBe(2)
    recovered.release()
    a.release()
    expect(b.granted).toBe(true)
    b.release()
    expect(slots.working).toBe(0)
  })

  it('refuses a bound that is not an integer and an allocator it did not create', () => {
    expect(() => createWorkerSlots(1.5)).toThrow(/positive safe integer/u)
    expect(() => resolveWorkerSlots({ max: 1, working: 0, queued: 0 })).toThrow(
      /createWorkerSlots/u,
    )
  })
})
