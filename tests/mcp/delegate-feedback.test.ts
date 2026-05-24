import { describe, expect, it } from 'vitest'
import { InMemoryFeedbackStore } from '../../src/mcp/feedback-store'
import { DelegationTaskQueue } from '../../src/mcp/task-queue'
import {
  createDelegateFeedbackHandler,
  DELEGATE_FEEDBACK_DESCRIPTION,
  validateDelegateFeedbackArgs,
} from '../../src/mcp/tools/delegate-feedback'

describe('validateDelegateFeedbackArgs', () => {
  it('requires refersTo, rating, and by', () => {
    expect(() => validateDelegateFeedbackArgs({})).toThrow()
    expect(() =>
      validateDelegateFeedbackArgs({
        refersTo: { kind: 'delegation', ref: 'dlg-1' },
        rating: { score: 1, notes: 'good' },
      }),
    ).toThrow(/`by`/)
  })

  it('clamps score validity to [0, 1]', () => {
    expect(() =>
      validateDelegateFeedbackArgs({
        refersTo: { kind: 'delegation', ref: 'r' },
        rating: { score: 1.1, notes: 'oops' },
        by: 'agent',
      }),
    ).toThrow(RangeError)
  })

  it('rejects unknown labels', () => {
    expect(() =>
      validateDelegateFeedbackArgs({
        refersTo: { kind: 'delegation', ref: 'r' },
        rating: { score: 0.5, notes: 'n', label: 'maybe' },
        by: 'agent',
      }),
    ).toThrow(TypeError)
  })

  it('accepts the three refersTo.kind values', () => {
    for (const kind of ['delegation', 'artifact', 'outcome'] as const) {
      const out = validateDelegateFeedbackArgs({
        refersTo: { kind, ref: 'r' },
        rating: { score: 0.5, notes: 'n' },
        by: 'agent',
      })
      expect(out.refersTo.kind).toBe(kind)
    }
  })
})

describe('createDelegateFeedbackHandler', () => {
  it('persists every event without deduping (append-only)', async () => {
    const queue = new DelegationTaskQueue()
    const store = new InMemoryFeedbackStore()
    const handler = createDelegateFeedbackHandler({ queue, store })
    const args = {
      refersTo: { kind: 'artifact' as const, ref: 'file://x' },
      rating: { score: 0.8, notes: 'looks ok' },
      by: 'agent' as const,
    }
    const a = await handler(args)
    const b = await handler(args)
    expect(a.id).not.toBe(b.id)
    expect((await store.list()).length).toBe(2)
  })

  it('isolates events by namespace', async () => {
    const queue = new DelegationTaskQueue()
    const store = new InMemoryFeedbackStore()
    const handler = createDelegateFeedbackHandler({ queue, store })
    await handler({
      refersTo: { kind: 'outcome', ref: 'x' },
      rating: { score: 0.5, notes: 'n' },
      by: 'user',
      namespace: 'a',
    })
    await handler({
      refersTo: { kind: 'outcome', ref: 'x' },
      rating: { score: 0.5, notes: 'n' },
      by: 'user',
      namespace: 'b',
    })
    expect((await store.list({ namespace: 'a' })).length).toBe(1)
    expect((await store.list({ namespace: 'b' })).length).toBe(1)
    expect((await store.list({ namespace: 'c' })).length).toBe(0)
  })

  it('attaches the feedback snapshot to the queue record when refersTo.kind === "delegation"', async () => {
    const queue = new DelegationTaskQueue()
    const store = new InMemoryFeedbackStore()
    const submitted = queue.submit({
      profile: 'coder',
      args: { goal: 'g', repoRoot: '/r' },
      run: async () => ({}) as never,
    })
    await new Promise((r) => setImmediate(r))
    const handler = createDelegateFeedbackHandler({ queue, store })
    const { id } = await handler({
      refersTo: { kind: 'delegation', ref: submitted.taskId },
      rating: { score: 0.9, notes: 'great patch', label: 'good' },
      by: 'user',
    })
    const [entry] = queue.history()
    expect(entry?.feedback?.length).toBe(1)
    expect(entry?.feedback?.[0]?.id).toBe(id)
    expect(entry?.feedback?.[0]?.label).toBe('good')
  })

  it('does not attach when refersTo.kind is artifact/outcome', async () => {
    const queue = new DelegationTaskQueue()
    const store = new InMemoryFeedbackStore()
    const submitted = queue.submit({
      profile: 'coder',
      args: { goal: 'g', repoRoot: '/r' },
      run: async () => ({}) as never,
    })
    await new Promise((r) => setImmediate(r))
    const handler = createDelegateFeedbackHandler({ queue, store })
    await handler({
      refersTo: { kind: 'artifact', ref: submitted.taskId },
      rating: { score: 0.1, notes: 'mistake — wrong kind' },
      by: 'agent',
    })
    const [entry] = queue.history()
    expect(entry?.feedback).toBeUndefined()
  })

  it('description explains kind variants', () => {
    expect(DELEGATE_FEEDBACK_DESCRIPTION).toMatch(/delegation/)
    expect(DELEGATE_FEEDBACK_DESCRIPTION).toMatch(/artifact/)
    expect(DELEGATE_FEEDBACK_DESCRIPTION).toMatch(/outcome/)
  })
})
