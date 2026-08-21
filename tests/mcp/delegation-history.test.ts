import { describe, expect, it } from 'vitest'
import { InMemoryFeedbackStore } from '../../src/mcp/feedback-store'
import { DelegationTaskQueue } from '../../src/mcp/task-queue'
import { createDelegateFeedbackHandler } from '../../src/mcp/tools/delegate-feedback'
import {
  createDelegationHistoryHandler,
  validateDelegationHistoryArgs,
} from '../../src/mcp/tools/delegation-history'
import { delegationProfiles } from '../../src/mcp/types'

function settleTwice(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => setImmediate(() => resolve()))
  })
}

describe('validateDelegationHistoryArgs', () => {
  it('accepts an empty object', () => {
    expect(validateDelegationHistoryArgs({})).toEqual({})
  })
  it('rejects an out-of-range limit', () => {
    expect(() => validateDelegationHistoryArgs({ limit: 501 })).toThrow(RangeError)
  })
  it('rejects an unknown profile', () => {
    expect(() => validateDelegationHistoryArgs({ profile: 'judge' })).toThrow(TypeError)
  })
  it('accepts every profile a delegation record can carry', () => {
    // `delegate_ui_audit` is the only tool in the product that submits to the queue, and it
    // submits `ui-auditor`. A filter that refuses it cannot read the only history that exists.
    for (const profile of delegationProfiles) {
      expect(validateDelegationHistoryArgs({ profile })).toEqual({ profile })
    }
  })
})

describe('createDelegationHistoryHandler', () => {
  it('filters by namespace, profile, since', async () => {
    let ts = 1_700_000_000_000
    const queue = new DelegationTaskQueue({
      now: () => {
        ts += 1000
        return new Date(ts).toISOString()
      },
    })
    queue.submit({
      profile: 'coder',
      args: { goal: 'g', repoRoot: '/r' },
      namespace: 'a',
      run: async () => ({}) as never,
    })
    queue.submit({
      profile: 'researcher',
      args: { question: 'q', namespace: 'a' },
      namespace: 'a',
      run: async () => ({}) as never,
    })
    queue.submit({
      profile: 'coder',
      args: { goal: 'g2', repoRoot: '/r' },
      namespace: 'b',
      run: async () => ({}) as never,
    })
    await settleTwice()
    const handler = createDelegationHistoryHandler({ queue })
    const all = await handler({})
    expect(all.delegations.length).toBe(3)
    const aOnly = await handler({ namespace: 'a' })
    expect(aOnly.delegations.length).toBe(2)
    expect(aOnly.delegations.every((entry) => entry.namespace === 'a')).toBe(true)
    const coderOnly = await handler({ profile: 'coder' })
    expect(coderOnly.delegations.every((entry) => entry.profile === 'coder')).toBe(true)
    expect(coderOnly.delegations.length).toBe(2)
  })

  it('honors limit', async () => {
    const queue = new DelegationTaskQueue()
    for (let i = 0; i < 5; i += 1) {
      queue.submit({
        profile: 'coder',
        args: { goal: `g${i}`, repoRoot: '/r' },
        run: async () => ({}) as never,
      })
    }
    await settleTwice()
    const handler = createDelegationHistoryHandler({ queue })
    const limited = await handler({ limit: 2 })
    expect(limited.delegations.length).toBe(2)
  })

  it('surfaces feedback cross-references inline', async () => {
    const queue = new DelegationTaskQueue()
    const store = new InMemoryFeedbackStore()
    const submitted = queue.submit({
      profile: 'coder',
      args: { goal: 'g', repoRoot: '/r' },
      run: async () => ({}) as never,
    })
    await settleTwice()
    const feedback = createDelegateFeedbackHandler({ queue, store })
    await feedback({
      refersTo: { kind: 'delegation', ref: submitted.taskId },
      rating: { score: 0.7, notes: 'shipped' },
      by: 'user',
    })
    const history = await createDelegationHistoryHandler({ queue })({})
    const entry = history.delegations.find((e) => e.taskId === submitted.taskId)
    expect(entry?.feedback?.[0]?.notes).toBe('shipped')
  })

  it('filters by `since`', async () => {
    let ts = 1_700_000_000_000
    const queue = new DelegationTaskQueue({
      now: () => {
        ts += 1000
        return new Date(ts).toISOString()
      },
    })
    queue.submit({
      profile: 'coder',
      args: { goal: 'g1', repoRoot: '/r' },
      run: async () => ({}) as never,
    })
    await settleTwice()
    const cutoff = new Date(ts + 500).toISOString()
    queue.submit({
      profile: 'coder',
      args: { goal: 'g2', repoRoot: '/r' },
      run: async () => ({}) as never,
    })
    await settleTwice()
    const handler = createDelegationHistoryHandler({ queue })
    const recent = await handler({ since: cutoff })
    expect(recent.delegations.length).toBe(1)
    const [delegation] = recent.delegations
    if (delegation === undefined) throw new Error('expected the recent delegation')
    expect((delegation.args as { goal: string }).goal).toBe('g2')
  })
})
