/**
 * The platform channel: what a sandbox worker consumed BESIDE model tokens.
 *
 * A run on a subscription seat pays no marginal dollar per model call, so box wall time is the
 * only real resource it consumes. Measured on the discovery-lab fleet, 2026-09-01: 0 of 4,332
 * settled child nodes ever reported a known non-zero dollar, 44 runs reported a checked
 * `usdKnown: true` and all 44 reported `$0` — correct for a seat, and precisely why box time is
 * the number that matters. 7,331.2 box-minutes across 867 boxes in 260 runs were derivable from
 * placement timestamps and the runtime contributed none of it.
 */

import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createBudgetPool, spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { createExecutor, createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorContext,
  ExecutorResult,
  Spend,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { addSpend, zeroSpend } from '../../src/runtime/util'
import { testAgentProfile } from './test-agent-profile'

const spec: AgentSpec = {
  profile: testAgentProfile('platform-leaf', {
    harness: 'opencode',
    prompt: { systemPrompt: 'do the thing' },
  }),
  harness: 'opencode',
}

function ctx(): ExecutorContext {
  return { signal: new AbortController().signal, seams: {} }
}

async function drain(stream: AsyncIterable<UsageEvent>): Promise<UsageEvent[]> {
  const events: UsageEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * A box whose lifetime the test controls.
 *
 * The loop reads `Date.now` for both ends of the box lifetime, so the box's own `delete` moves
 * that clock: the platform bills a box until it is deleted, which is why the lifetime closes on
 * the delete rather than on the end of the stream.
 */
function timedBoxClient(opts: {
  liveMs?: number
  deleteBehavior: 'ok' | 'throws' | 'absent'
  terminal?: SandboxEvent
}) {
  const clock = { at: 1_700_000_000_000 }
  vi.spyOn(Date, 'now').mockImplementation(() => clock.at)
  const advance = () => {
    clock.at += opts.liveMs ?? 0
  }
  const del =
    opts.deleteBehavior === 'absent'
      ? {}
      : {
          async delete() {
            advance()
            if (opts.deleteBehavior === 'throws') throw new Error('platform delete refused')
          },
        }
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        id: 'box-0',
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          yield { type: 'result', data: { finalText: 'delivered' } } as SandboxEvent
          yield opts.terminal ??
            ({ type: 'done', data: { outcome: { type: 'completed' } } } as SandboxEvent)
        },
        ...del,
      } as unknown as SandboxInstance
    },
  }
}

async function settle(client: ReturnType<typeof timedBoxClient>): Promise<{
  spent: Spend
  events: UsageEvent[]
}> {
  const executor = createExecutor({ backend: 'sandbox', sandboxClient: client })(spec, ctx())
  const events = await drain(
    executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>,
  )
  return { spent: executor.resultArtifact().spent, events }
}

describe('sandbox executor reports the platform box time it consumed', () => {
  it('a box that lived 90 s reports 1.5 box-minutes, known and derived', async () => {
    const { spent } = await settle(timedBoxClient({ liveMs: 90_000, deleteBehavior: 'ok' }))

    expect(spent.boxMinutes).toBe(1.5)
    // The lifetime IS known: this loop watched both ends of it.
    expect(spent.boxMinutesKnown).toBe(true)
    // It is not a platform receipt: the platform billed no minutes, this runtime derived them.
    expect(spent.boxMinutesProvenance).toBe('estimated')
  })

  it('a box with no terminal reports unknown box time and no number at all', async () => {
    const { spent } = await settle(timedBoxClient({ liveMs: 90_000, deleteBehavior: 'absent' }))

    // A missing measurement is never a zero: a box nobody timed did not consume no time.
    expect(spent.boxMinutes).toBeUndefined()
    expect(spent.boxMinutesKnown).toBe(false)
    expect(spent.boxMinutesProvenance).toBe('uncaptured')
  })

  it('a delete the platform never acknowledged leaves the number a floor', async () => {
    const { spent } = await settle(timedBoxClient({ liveMs: 90_000, deleteBehavior: 'throws' }))

    // The box was alive for at least this long; it may have outlived the delete that failed.
    expect(spent.boxMinutes).toBe(1.5)
    expect(spent.boxMinutesKnown).toBe(false)
    expect(spent.boxMinutesProvenance).toBe('estimated')
  })

  it('a sub-second box reports a small number rather than a rounded-away zero', async () => {
    const { spent } = await settle(timedBoxClient({ liveMs: 2_000, deleteBehavior: 'ok' }))

    expect(spent.boxMinutes).toBe(0.0333)
    expect(spent.boxMinutesKnown).toBe(true)
  })

  it('never puts box time on the usage-event stream, so the conserved pool cannot reserve it', async () => {
    const { events } = await settle(timedBoxClient({ liveMs: 90_000, deleteBehavior: 'ok' }))

    expect(events.some((event) => 'boxMinutes' in event)).toBe(false)
    // The pool's own projection of the same stream carries no platform channel at all.
    const pooled = spendFromUsageEvents(events)
    expect(pooled.boxMinutes).toBeUndefined()
    expect(pooled.boxMinutesProvenance).toBeUndefined()
  })
})

describe('sandbox executor carries the SDK per-prompt cost the ledger dropped', () => {
  it('a terminal result reporting costUsd 0.108 settles usd known at 0.108', async () => {
    const { spent } = await settle(
      timedBoxClient({
        liveMs: 1_000,
        deleteBehavior: 'ok',
        // `PromptResult.costUsd` is a SIBLING of `usage`, not a member of it — the shape the SDK
        // really returns and the polled-prompt path really forwards.
        terminal: {
          type: 'result',
          data: {
            finalText: 'delivered',
            usage: { inputTokens: 4_200, outputTokens: 310 },
            costUsd: 0.108,
          },
        } as SandboxEvent,
      }),
    )

    expect(spent.usd).toBe(0.108)
    // The platform reported the number, so nothing here was catalog-priced.
    expect(spent.usdKnown).not.toBe(false)
    expect(spent.usdEstimated).toBeUndefined()
    expect(spent.tokens).toMatchObject({ input: 4_200, output: 310 })
  })

  it('a terminal result that reports no cost leaves the dollar channel unknown, not zero', async () => {
    const { spent } = await settle(
      timedBoxClient({
        liveMs: 1_000,
        deleteBehavior: 'ok',
        terminal: {
          type: 'result',
          data: { finalText: 'delivered', usage: { inputTokens: 4_200, outputTokens: 310 } },
        } as SandboxEvent,
      }),
    )

    expect(spent.usd).toBe(0)
    expect(spent.usdKnown).toBe(false)
  })
})

describe('addSpend folds the platform channel without inventing a measurement', () => {
  function boxed(over: Partial<Spend>): Spend {
    return { ...zeroSpend(), ...over }
  }

  it('sums two derived numbers and keeps the sum derived', () => {
    const summed = addSpend(
      boxed({ boxMinutes: 1.5, boxMinutesKnown: true, boxMinutesProvenance: 'estimated' }),
      boxed({ boxMinutes: 2.25, boxMinutesKnown: true, boxMinutesProvenance: 'estimated' }),
    )

    expect(summed.boxMinutes).toBe(3.75)
    expect(summed.boxMinutesKnown).toBe(true)
    expect(summed.boxMinutesProvenance).toBe('estimated')
  })

  it('degrades a platform receipt to an estimate as soon as one contributor is derived', () => {
    const summed = addSpend(
      boxed({ boxMinutes: 1, boxMinutesKnown: true, boxMinutesProvenance: 'observed' }),
      boxed({ boxMinutes: 1, boxMinutesKnown: true, boxMinutesProvenance: 'estimated' }),
    )

    expect(summed.boxMinutesProvenance).toBe('estimated')
  })

  it('makes the sum a floor when one contributor could not state its box time', () => {
    const summed = addSpend(
      boxed({ boxMinutes: 1.5, boxMinutesKnown: true, boxMinutesProvenance: 'estimated' }),
      boxed({ boxMinutesKnown: false, boxMinutesProvenance: 'uncaptured' }),
    )

    expect(summed.boxMinutes).toBe(1.5)
    expect(summed.boxMinutesKnown).toBe(false)
    expect(summed.boxMinutesProvenance).toBe('estimated')
  })

  it('reports no number when no contributor carried one', () => {
    const summed = addSpend(
      boxed({ boxMinutesKnown: false, boxMinutesProvenance: 'uncaptured' }),
      boxed({ boxMinutesKnown: false, boxMinutesProvenance: 'uncaptured' }),
    )

    expect(summed.boxMinutes).toBeUndefined()
    expect(summed.boxMinutesProvenance).toBe('uncaptured')
  })

  it('leaves work that ran no box with no platform channel at all', () => {
    const summed = addSpend(zeroSpend(), zeroSpend())

    // "Not applicable" is not the same fact as "a box ran and nobody metered it".
    expect(summed.boxMinutesProvenance).toBeUndefined()
    expect(summed.boxMinutesKnown).toBeUndefined()
  })
})

/**
 * The channel has to survive settlement, or it does not exist.
 *
 * The sandbox executor is a STREAMING executor: `scope.spawn` folds its `UsageEvent` stream into
 * the spend it journals, and box time is deliberately not on that stream — a box's minutes are
 * not known until it dies, and the conserved pool must never see them. `preserveUnknownTelemetry`
 * is therefore the only path from the terminal artifact to the durable record, and a channel it
 * does not copy is reported by the executor and dropped on the way to the journal.
 */
describe('the platform channel survives settlement into the journal and the projection', () => {
  /** A streaming worker whose terminal artifact — not its stream — states its box time. */
  function platformWorker(spent: Spend): Agent<unknown, unknown> {
    const artifact: ExecutorResult<unknown> = { outRef: 'w:done', out: 'done', spent }
    const executor: Executor<unknown> = {
      runtime: 'sandbox',
      execute() {
        return (async function* () {
          yield { kind: 'iteration' } as UsageEvent
          yield { kind: 'tokens', input: 12, output: 3 } as UsageEvent
        })()
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => artifact,
    }
    const executorSpec: AgentSpec = {
      profile: testAgentProfile('platform-worker'),
      harness: null,
      executor,
    }
    return { name: 'platform-worker', act: async () => 'done', executorSpec } as Agent<
      unknown,
      unknown
    >
  }

  async function settleThroughScope(spent: Spend) {
    const journal = new InMemorySpawnJournal()
    const root = 'platform-scope'
    await journal.beginTree(root, new Date(0).toISOString())
    const scope = createScope({
      parentId: root,
      root,
      pool: createBudgetPool({ maxIterations: 2, maxTokens: 1_000 }, Date.now()),
      journal,
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
      now: Date.now,
    })
    const spawned = scope.spawn(platformWorker(spent), 'task', {
      budget: { maxIterations: 2, maxTokens: 1_000 },
      label: 'worker',
    })
    expect(spawned.ok).toBe(true)
    const settled = await scope.next()
    const events = (await journal.loadTree(root)) ?? []
    return { settled, events }
  }

  it('journals the derived box time the executor reported, not a dropped channel', async () => {
    const { settled, events } = await settleThroughScope({
      iterations: 1,
      tokens: { input: 12, output: 3 },
      usd: 0,
      ms: 500,
      boxMinutes: 1.5,
      boxMinutesKnown: true,
      boxMinutesProvenance: 'estimated',
    })

    expect(settled?.kind).toBe('done')
    const done = events.find((event) => event.kind === 'settled')
    expect(done).toMatchObject({
      spent: { boxMinutes: 1.5, boxMinutesKnown: true, boxMinutesProvenance: 'estimated' },
    })
    // The token channel still comes from the stream, unchanged.
    expect(done).toMatchObject({ spent: { tokens: { input: 12, output: 3 } } })
  })

  it('journals an unmeasured box as uncaptured rather than dropping the fact', async () => {
    const { events } = await settleThroughScope({
      iterations: 1,
      tokens: { input: 12, output: 3 },
      usd: 0,
      ms: 500,
      boxMinutesKnown: false,
      boxMinutesProvenance: 'uncaptured',
    })

    const done = events.find((event) => event.kind === 'settled')
    expect(done).toMatchObject({
      spent: { boxMinutesKnown: false, boxMinutesProvenance: 'uncaptured' },
    })
    expect((done as { spent: Spend }).spent.boxMinutes).toBeUndefined()
  })

  it('leaves a worker that ran no box with no platform channel on its settled record', async () => {
    const { events } = await settleThroughScope({
      iterations: 1,
      tokens: { input: 12, output: 3 },
      usd: 0,
      ms: 500,
    })

    const done = events.find((event) => event.kind === 'settled') as { spent: Spend }
    expect(done.spent.boxMinutesProvenance).toBeUndefined()
    expect(done.spent.boxMinutesKnown).toBeUndefined()
  })
})
