import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../errors'
import { createMcpServer } from '../server'
import {
  createEventsTools,
  InMemoryEventSubscriptionStore,
  type McpEventRecord,
  type McpEventSource,
  observerJournalEventSource,
} from './events'

function chain(seed: Array<Partial<McpEventRecord> & { payload: unknown }>): McpEventSource {
  let digest: string | undefined
  const records = seed.map((item, index) => {
    const record: McpEventRecord = {
      sequence: item.sequence ?? index + 1,
      pursuitId: item.pursuitId ?? 'pursuit-1',
      kind: item.kind ?? 'event',
      observedAt: item.observedAt ?? index + 1,
      ...(digest !== undefined ? { previousDigest: digest } : {}),
      digest: `digest-${item.sequence ?? index + 1}`,
      payload: item.payload,
    }
    digest = record.digest
    return record
  })
  return { read: async () => records }
}

describe('events subscription tools over the native journal', () => {
  it('subscribes from the high-watermark and delivers only new records', async () => {
    const source = chain([{ payload: { type: 'run_started' } }, { payload: { type: 'tool_call' } }])
    const tools = createEventsTools({ eventSource: source })
    const subscribed = (await tools.subscribeTool.handler({ key: 'inbox-1' })) as {
      subscriptionId: string
      cursor: number
    }
    expect(subscribed.cursor).toBe(2) // high-watermark at subscribe time
    const page = (await tools.fetchTool.handler({ subscriptionId: subscribed.subscriptionId })) as {
      records: McpEventRecord[]
      highWatermark: number
    }
    expect(page.records).toEqual([])
    expect(page.highWatermark).toBe(2)
  })

  it('delivers at-least-once until acked, dedupes by sequence, and never rewinds the cursor', async () => {
    const source = chain([
      { payload: { type: 'question' }, kind: 'decision' },
      { payload: { type: 'tool_call' } },
    ])
    const tools = createEventsTools({ eventSource: source })
    const subscribed = (await tools.subscribeTool.handler({ key: 'k', fromSequence: 0 })) as {
      subscriptionId: string
    }
    const first = (await tools.fetchTool.handler({
      subscriptionId: subscribed.subscriptionId,
    })) as {
      records: McpEventRecord[]
    }
    expect(first.records.map((record) => record.sequence)).toEqual([1, 2])
    // No ack yet: the same page is redelivered.
    const retry = (await tools.fetchTool.handler({
      subscriptionId: subscribed.subscriptionId,
    })) as {
      records: McpEventRecord[]
    }
    expect(retry.records.map((record) => record.sequence)).toEqual([1, 2])
    await tools.ackTool.handler({ subscriptionId: subscribed.subscriptionId, sequence: 1 })
    const afterAck = (await tools.fetchTool.handler({
      subscriptionId: subscribed.subscriptionId,
    })) as {
      records: McpEventRecord[]
      cursor: number
    }
    expect(afterAck.records.map((record) => record.sequence)).toEqual([2])
    // A stale ack is a no-op.
    await tools.ackTool.handler({ subscriptionId: subscribed.subscriptionId, sequence: 0 })
    const afterStale = (await tools.fetchTool.handler({
      subscriptionId: subscribed.subscriptionId,
    })) as {
      cursor: number
    }
    expect(afterStale.cursor).toBe(1)
  })

  it('resubscribes idempotently by key with the same id and cursor', async () => {
    const source = chain([{ payload: { type: 'a' } }])
    const tools = createEventsTools({ eventSource: source })
    const first = (await tools.subscribeTool.handler({ key: 'same-key', fromSequence: 0 })) as {
      subscriptionId: string
    }
    await tools.ackTool.handler({ subscriptionId: first.subscriptionId, sequence: 1 })
    const second = (await tools.subscribeTool.handler({ key: 'same-key' })) as {
      subscriptionId: string
      cursor: number
    }
    expect(second.subscriptionId).toBe(first.subscriptionId)
    expect(second.cursor).toBe(1)
  })

  it('filters by kind, pages by limit, and replays history from fromSequence', async () => {
    const source = chain([
      { payload: { d: 1 }, kind: 'decision' },
      { payload: { e: 2 } },
      { payload: { d: 3 }, kind: 'decision' },
      { payload: { e: 4 } },
    ])
    const tools = createEventsTools({ eventSource: source })
    const subscribed = (await tools.subscribeTool.handler({
      key: 'k',
      fromSequence: 0,
      kinds: ['decision'],
    })) as {
      subscriptionId: string
    }
    const page = (await tools.fetchTool.handler({
      subscriptionId: subscribed.subscriptionId,
      limit: 1,
    })) as {
      records: McpEventRecord[]
    }
    expect(page.records.map((record) => record.sequence)).toEqual([1])
    await tools.ackTool.handler({ subscriptionId: subscribed.subscriptionId, sequence: 1 })
    const next = (await tools.fetchTool.handler({
      subscriptionId: subscribed.subscriptionId,
      limit: 10,
    })) as {
      records: McpEventRecord[]
    }
    expect(next.records.map((record) => record.sequence)).toEqual([3])
  })

  it('expires subscriptions lazily and requires resubscribe; unsubscribe is idempotent', async () => {
    const source = chain([{ payload: { type: 'a' } }])
    let now = 1_000
    const tools = createEventsTools({ eventSource: source, now: () => now })
    const subscribed = (await tools.subscribeTool.handler({
      key: 'k',
      fromSequence: 0,
      ttlSeconds: 60,
    })) as {
      subscriptionId: string
    }
    now += 61_000
    await expect(
      tools.fetchTool.handler({ subscriptionId: subscribed.subscriptionId }),
    ).rejects.toBeInstanceOf(ValidationError)
    // Resubscribing with the same key resumes from the acknowledged cursor.
    const resumed = (await tools.subscribeTool.handler({ key: 'k', fromSequence: 0 })) as {
      subscriptionId: string
      cursor: number
    }
    expect(resumed.cursor).toBe(0)
    expect(await tools.unsubscribeTool.handler({ subscriptionId: resumed.subscriptionId })).toEqual(
      { subscriptionId: resumed.subscriptionId, removed: true },
    )
    expect(await tools.unsubscribeTool.handler({ subscriptionId: resumed.subscriptionId })).toEqual(
      { subscriptionId: resumed.subscriptionId, removed: false },
    )
  })

  it('refuses a page whose journal chain no longer links', async () => {
    const records = [
      {
        sequence: 1,
        pursuitId: 'p1',
        kind: 'event' as const,
        observedAt: 1,
        digest: 'd1',
        payload: {},
      },
      {
        sequence: 2,
        pursuitId: 'p1',
        kind: 'event' as const,
        observedAt: 2,
        previousDigest: 'd-tampered',
        digest: 'd2',
        payload: {},
      },
    ]
    const source: McpEventSource = { read: async () => records }
    const tools = createEventsTools({ eventSource: source })
    const subscribed = (await tools.subscribeTool.handler({ key: 'k', fromSequence: 0 })) as {
      subscriptionId: string
    }
    await expect(
      tools.fetchTool.handler({ subscriptionId: subscribed.subscriptionId }),
    ).rejects.toThrow(/chain verification failed/)
  })

  it('adapts the durable observer journal records verbatim', async () => {
    const adapted = observerJournalEventSource({
      read: async () => [
        {
          schemaVersion: 1,
          pursuitId: 'p1',
          sequence: 1,
          kind: 'decision',
          observedAt: 42,
          digest: 'd1',
          decision: { id: 'dec-1', runId: 'run-1', stepIndex: 0 },
        },
      ],
    })
    const records = await adapted.read()
    expect(records).toEqual([
      {
        sequence: 1,
        pursuitId: 'p1',
        kind: 'decision',
        observedAt: 42,
        digest: 'd1',
        payload: { id: 'dec-1', runId: 'run-1', stepIndex: 0 },
      },
    ])
  })

  it('serves the tools on the shared MCP server only when a source is wired', async () => {
    const absent = createMcpServer({})
    expect([...absent.tools.keys()]).not.toContain('events_subscribe')
    const present = createMcpServer({ eventSource: chain([{ payload: { type: 'a' } }]) })
    for (const name of ['events_subscribe', 'events_fetch', 'events_ack', 'events_unsubscribe']) {
      expect(present.tools.has(name)).toBe(true)
    }
    const listed = await present.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(JSON.stringify(listed)).toContain('events_subscribe')
  })

  it('rejects invalid arguments without touching the journal', async () => {
    const store = new InMemoryEventSubscriptionStore()
    const tools = createEventsTools({
      eventSource: chain([{ payload: {} }]),
      subscriptionStore: store,
    })
    await expect(tools.subscribeTool.handler({})).rejects.toBeInstanceOf(ValidationError)
    await expect(tools.subscribeTool.handler({ key: 'k', kinds: ['nope'] })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(tools.fetchTool.handler({ subscriptionId: 'unknown' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(await store.findByKey('k')).toBeNull()
  })
})
