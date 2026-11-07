/**
 * `events_*` MCP tools — the runtime-owned piece of the agent-inbox event track (chatgpt-plugins
 * #18 / agent-runtime #1497): expose the NATIVE event journal (the durable `ObserverJournal`:
 * runtime hook events + decision points, digest-chained) via an explicit subscription lifecycle.
 * Boundaries, by design:
 * - No scheduler, no cron, no second schedule authority. Recurrence and wake-ups stay with the
 *   native trigger owners; these tools only read and acknowledge what the journal already recorded.
 * - Delivery is at-least-once until acknowledged: `events_fetch` pages from the acknowledged
 *   cursor, so a lost response is redelivered, and sequence numbers deduplicate on the client.
 * - Records are verified against the journal's digest chain on every page; a mutated, reordered
 *   or deleted tail refuses the page instead of serving unverifiable history.
 * - Subscriptions are idempotent by caller key: a reconnect resubscribes to the SAME subscription
 *   (same id, same cursor), never a duplicate stream.
 * - Optional expiry is lazy: an expired subscription reads as gone, and the caller resubscribes
 *   with the same key to resume from its cursor.
 * @experimental
 */

import { createHash, randomUUID } from 'node:crypto'
import { ValidationError } from '../../errors'
import { readRootStream } from '../../runtime/supervise/root-stream'
import type { McpToolDescriptor } from '../protocol'

/** One immutable journaled record exposed through the subscription surface. @experimental */
export interface McpEventRecord {
  readonly sequence: number
  readonly pursuitId: string
  readonly kind: 'event' | 'decision'
  readonly observedAt: number
  readonly digest: string
  /** Digest of the previous record in the journal; absent on the first record. */
  readonly previousDigest?: string
  /** The native runtime hook event or decision point, verbatim. */
  readonly payload: unknown
}

/** The native event source. The default adapter wraps a durable `ObserverJournal`. @experimental */
export interface McpEventSource {
  read(): Promise<readonly McpEventRecord[]>
}

/** Registered subscription state. The cursor is the last ACKNOWLEDGED sequence. @experimental */
export interface EventSubscription {
  readonly subscriptionId: string
  readonly key: string
  readonly kinds: readonly ('event' | 'decision')[]
  cursor: number
  readonly createdAt: number
  readonly expiresAt: number | null
}

/** Injectable subscription store. The default is in-memory; durable owners may supply their own. @experimental */
export interface EventSubscriptionStore {
  get(subscriptionId: string): Promise<EventSubscription | null>
  findByKey(key: string): Promise<EventSubscription | null>
  put(subscription: EventSubscription): Promise<void>
  delete(subscriptionId: string): Promise<void>
}

/** @experimental */
export class InMemoryEventSubscriptionStore implements EventSubscriptionStore {
  private readonly byId = new Map<string, EventSubscription>()
  private readonly byKey = new Map<string, string>()

  async get(subscriptionId: string): Promise<EventSubscription | null> {
    return this.byId.get(subscriptionId) ?? null
  }

  async findByKey(key: string): Promise<EventSubscription | null> {
    const id = this.byKey.get(key)
    return id ? (this.byId.get(id) ?? null) : null
  }

  async put(subscription: EventSubscription): Promise<void> {
    this.byId.set(subscription.subscriptionId, subscription)
    this.byKey.set(subscription.key, subscription.subscriptionId)
  }

  async delete(subscriptionId: string): Promise<void> {
    const existing = this.byId.get(subscriptionId)
    this.byId.delete(subscriptionId)
    if (existing && this.byKey.get(existing.key) === subscriptionId) this.byKey.delete(existing.key)
  }
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60
const MAX_PAGE_LIMIT = 200

function isMcpEventRecord(value: unknown): value is McpEventRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as McpEventRecord
  return (
    Number.isSafeInteger(record.sequence) &&
    record.sequence >= 0 &&
    typeof record.pursuitId === 'string' &&
    (record.kind === 'event' || record.kind === 'decision') &&
    Number.isFinite(record.observedAt) &&
    typeof record.digest === 'string' &&
    (record.previousDigest === undefined || typeof record.previousDigest === 'string')
  )
}

/** The read model: journal order, digest-chain linked. The durable journal
 * verifies record digests on read; this linkage check is the second fence that
 * refuses a page carved from reordered or spliced history. */
async function verifiedPage(
  source: McpEventSource,
  after: number,
  limit: number,
  kinds: readonly ('event' | 'decision')[],
): Promise<{ records: McpEventRecord[]; highWatermark: number }> {
  const all = (await source.read()).filter(isMcpEventRecord).sort((a, b) => a.sequence - b.sequence)
  const page: McpEventRecord[] = []
  for (let index = 0; index < all.length; index += 1) {
    const record = all[index]
    if (!record) continue
    const previous = index > 0 ? all[index - 1] : undefined
    if (previous && record.previousDigest !== previous.digest) {
      throw new ValidationError(
        'events: journal chain verification failed; refusing to serve unverifiable history',
      )
    }
    if (record.sequence > after && kinds.includes(record.kind) && page.length < limit)
      page.push(record)
  }
  const last = all[all.length - 1]
  return { records: page, highWatermark: last ? last.sequence : 0 }
}

async function currentHighWatermark(source: McpEventSource): Promise<number> {
  return (await verifiedPage(source, 0, 0, ['event', 'decision'])).highWatermark
}

function parseKinds(raw: unknown): ('event' | 'decision')[] | undefined {
  if (raw === undefined) return undefined
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every((kind) => kind === 'event' || kind === 'decision')
  ) {
    throw new ValidationError('events: `kinds` must be a non-empty array of "event" or "decision"')
  }
  return raw
}

/** @experimental */
export interface EventsToolOptions {
  eventSource: McpEventSource
  subscriptionStore?: EventSubscriptionStore
  /** Monotonic clock for expiry; injectable for tests. Default `Date.now`. */
  now?: () => number
}

function expired(subscription: EventSubscription, nowMs: number): boolean {
  return subscription.expiresAt !== null && subscription.expiresAt <= nowMs
}

async function liveSubscription(
  store: EventSubscriptionStore,
  subscriptionId: string,
  nowMs: number,
): Promise<EventSubscription> {
  const subscription = await store.get(subscriptionId)
  // An expired subscription is NOT deleted here: its row is the consumer's
  // durable resume position, and `events_subscribe` with the same key replaces
  // it while carrying the cursor. Only an explicit unsubscribe deletes.
  if (!subscription || expired(subscription, nowMs)) {
    throw new ValidationError(
      `events: unknown or expired subscription "${subscriptionId}"; resubscribe with the same key to resume from its cursor`,
    )
  }
  return subscription
}

/** Build the four `events_*` tool descriptors. Register them only when an event source is wired. @experimental */
export function createEventsTools(options: EventsToolOptions): McpToolDescriptorList {
  const source = options.eventSource
  const store = options.subscriptionStore ?? new InMemoryEventSubscriptionStore()
  const now = options.now ?? Date.now

  async function subscribe(raw: unknown): Promise<unknown> {
    if (raw === null || typeof raw !== 'object')
      throw new ValidationError('events_subscribe: arguments must be an object')
    const value = raw as Record<string, unknown>
    if (typeof value.key !== 'string' || value.key.trim().length === 0 || value.key.length > 256) {
      throw new ValidationError(
        'events_subscribe: `key` must be a non-empty string (max 256 chars)',
      )
    }
    const key = value.key.trim()
    const kinds = parseKinds(value.kinds) ?? ['event', 'decision']
    const rawFrom = value.fromSequence
    if (
      rawFrom !== undefined &&
      (typeof rawFrom !== 'number' || !Number.isSafeInteger(rawFrom) || rawFrom < 0)
    ) {
      throw new ValidationError('events_subscribe: `fromSequence` must be a non-negative integer')
    }
    const fromSequence: number | undefined = rawFrom
    const rawTtl = value.ttlSeconds
    if (
      rawTtl !== undefined &&
      (typeof rawTtl !== 'number' ||
        !Number.isSafeInteger(rawTtl) ||
        rawTtl <= 0 ||
        rawTtl > 30 * 24 * 60 * 60)
    ) {
      throw new ValidationError('events_subscribe: `ttlSeconds` must be an integer in (0, 2592000]')
    }
    const ttlSeconds = rawTtl ?? DEFAULT_TTL_SECONDS
    // Idempotent resubscribe: the same key resumes the same subscription and
    // cursor. A reconnect never creates a second stream for one consumer, and an
    // ACTIVE consumer's expiry slides: reconnecting keeps the subscription alive.
    const existing = await store.findByKey(key)
    if (existing && !expired(existing, now())) {
      const renewed: EventSubscription = { ...existing, expiresAt: now() + ttlSeconds * 1000 }
      await store.put(renewed)
      return {
        subscriptionId: renewed.subscriptionId,
        key,
        cursor: renewed.cursor,
        kinds: [...renewed.kinds],
        expiresAt: renewed.expiresAt,
      }
    }
    // An expired subscription's cursor is its consumer's durable position:
    // resubscribing with the same key resumes THERE, never at the current
    // watermark — otherwise every unacknowledged event between the two would be
    // silently skipped, breaking the at-least-once contract.
    const resumedCursor = existing ? existing.cursor : undefined
    if (existing) await store.delete(existing.subscriptionId)
    const cursor =
      fromSequence !== undefined
        ? fromSequence
        : (resumedCursor ?? (await currentHighWatermark(source)))
    const subscription: EventSubscription = {
      subscriptionId: randomUUID(),
      key,
      kinds,
      cursor,
      createdAt: now(),
      expiresAt: now() + ttlSeconds * 1000,
    }
    await store.put(subscription)
    return {
      subscriptionId: subscription.subscriptionId,
      key,
      cursor,
      kinds: [...kinds],
      expiresAt: subscription.expiresAt,
    }
  }

  async function fetch(raw: unknown): Promise<unknown> {
    if (raw === null || typeof raw !== 'object')
      throw new ValidationError('events_fetch: arguments must be an object')
    const value = raw as Record<string, unknown>
    if (typeof value.subscriptionId !== 'string' || value.subscriptionId.length === 0) {
      throw new ValidationError('events_fetch: `subscriptionId` must be a non-empty string')
    }
    const rawLimit = value.limit
    if (
      rawLimit !== undefined &&
      (typeof rawLimit !== 'number' ||
        !Number.isSafeInteger(rawLimit) ||
        rawLimit <= 0 ||
        rawLimit > MAX_PAGE_LIMIT)
    ) {
      throw new ValidationError(
        `events_fetch: \`limit\` must be an integer in (0, ${MAX_PAGE_LIMIT}]`,
      )
    }
    const limit = rawLimit ?? MAX_PAGE_LIMIT
    const subscription = await liveSubscription(store, value.subscriptionId, now())
    const page = await verifiedPage(source, subscription.cursor, limit, subscription.kinds)
    return {
      subscriptionId: subscription.subscriptionId,
      cursor: subscription.cursor,
      records: page.records.map((record) => ({
        sequence: record.sequence,
        pursuitId: record.pursuitId,
        kind: record.kind,
        observedAt: record.observedAt,
        digest: record.digest,
        payload: record.payload,
      })),
      highWatermark: page.highWatermark,
    }
  }

  async function acknowledge(raw: unknown): Promise<unknown> {
    if (raw === null || typeof raw !== 'object')
      throw new ValidationError('events_ack: arguments must be an object')
    const value = raw as Record<string, unknown>
    if (typeof value.subscriptionId !== 'string' || value.subscriptionId.length === 0) {
      throw new ValidationError('events_ack: `subscriptionId` must be a non-empty string')
    }
    if (
      typeof value.sequence !== 'number' ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0
    ) {
      throw new ValidationError('events_ack: `sequence` must be a non-negative integer')
    }
    const subscription = await liveSubscription(store, value.subscriptionId, now())
    // An acknowledgement beyond the journal's high-watermark would permanently
    // skip records that arrive later with a sequence at or below it. Only a
    // sequence the journal actually reached may be acknowledged.
    const highWatermark = await currentHighWatermark(source)
    if (value.sequence > highWatermark) {
      throw new ValidationError(
        `events_ack: \`sequence\` ${value.sequence} is beyond the journal high-watermark ${highWatermark}; acknowledge only delivered records`,
      )
    }
    // The cursor only moves forward: a duplicated or stale acknowledgement is a no-op.
    if (value.sequence > subscription.cursor) subscription.cursor = value.sequence
    await store.put(subscription)
    return { subscriptionId: subscription.subscriptionId, cursor: subscription.cursor }
  }

  async function unsubscribe(raw: unknown): Promise<unknown> {
    if (raw === null || typeof raw !== 'object')
      throw new ValidationError('events_unsubscribe: arguments must be an object')
    const value = raw as Record<string, unknown>
    if (typeof value.subscriptionId !== 'string' || value.subscriptionId.length === 0) {
      throw new ValidationError('events_unsubscribe: `subscriptionId` must be a non-empty string')
    }
    const subscription = await store.get(value.subscriptionId)
    if (!subscription) return { subscriptionId: value.subscriptionId, removed: false }
    await store.delete(value.subscriptionId)
    return { subscriptionId: value.subscriptionId, removed: true }
  }

  return {
    subscribeTool: {
      name: 'events_subscribe',
      description: [
        'Subscribe to the native runtime event journal (task events and decision points).',
        'Idempotent by `key`: reconnecting with the same key resumes the same',
        'subscription and its acknowledged cursor — never a duplicate stream.',
        'Default cursor is the current high-watermark (only new records); pass',
        '`fromSequence` to replay history. Optional `kinds` filter and `ttlSeconds`',
        'expiry. This is a read surface over recorded history: it schedules nothing',
        'and triggers nothing; recurrence and wake-ups stay with their native owners.',
      ].join('\n'),
      inputSchema: EVENTS_SUBSCRIBE_INPUT_SCHEMA as unknown as Record<string, unknown>,
      handler: subscribe,
    },
    fetchTool: {
      name: 'events_fetch',
      description: [
        'Fetch one page of journaled records after the acknowledged cursor.',
        'At-least-once: records are redelivered until `events_ack` advances the',
        'cursor; deduplicate by `sequence`. Every page is verified against the',
        'journal digest chain. An expired or unknown subscription errors: resubscribe',
        'with the same key to resume from its cursor.',
      ].join('\n'),
      inputSchema: EVENTS_FETCH_INPUT_SCHEMA as unknown as Record<string, unknown>,
      handler: fetch,
    },
    ackTool: {
      name: 'events_ack',
      description:
        'Acknowledge records up to `sequence` (forward-only). Unacknowledged records are redelivered.',
      inputSchema: EVENTS_ACK_INPUT_SCHEMA as unknown as Record<string, unknown>,
      handler: acknowledge,
    },
    unsubscribeTool: {
      name: 'events_unsubscribe',
      description: 'Remove a subscription. Idempotent; the journal itself is unaffected.',
      inputSchema: EVENTS_UNSUBSCRIBE_INPUT_SCHEMA as unknown as Record<string, unknown>,
      handler: unsubscribe,
    },
  }
}

/** @experimental */
export interface McpToolDescriptorList {
  subscribeTool: McpToolDescriptor
  fetchTool: McpToolDescriptor
  ackTool: McpToolDescriptor
  unsubscribeTool: McpToolDescriptor
}

const EVENTS_SUBSCRIBE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    key: {
      type: 'string',
      description: 'Caller-chosen idempotency key; one consumer key resumes one stream.',
    },
    kinds: {
      type: 'array',
      items: { enum: ['event', 'decision'] },
      description: 'Optional kind filter.',
    },
    fromSequence: {
      type: 'integer',
      description: 'Inclusive replay start; default: current high-watermark.',
    },
    ttlSeconds: { type: 'integer', description: 'Subscription expiry in seconds; default 86400.' },
  },
  required: ['key'],
  additionalProperties: false,
} as const

const EVENTS_FETCH_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    subscriptionId: { type: 'string' },
    limit: { type: 'integer', description: `Max records per page (max ${MAX_PAGE_LIMIT}).` },
  },
  required: ['subscriptionId'],
  additionalProperties: false,
} as const

const EVENTS_ACK_INPUT_SCHEMA = {
  type: 'object',
  properties: { subscriptionId: { type: 'string' }, sequence: { type: 'integer' } },
  required: ['subscriptionId', 'sequence'],
  additionalProperties: false,
} as const

const EVENTS_UNSUBSCRIBE_INPUT_SCHEMA = {
  type: 'object',
  properties: { subscriptionId: { type: 'string' } },
  required: ['subscriptionId'],
  additionalProperties: false,
} as const

/** Adapt the durable `ObserverJournal` (runtime hook events + decision points,
 * digest-chained by the journal itself) as the native `McpEventSource`. @experimental */
/** The structural shape the adapter accepts; satisfied by the durable `ObserverJournal`. @experimental */
export interface ObserverJournalLike {
  read(): Promise<ReadonlyArray<JournaledRecord>>
}

/** @experimental */
export interface JournaledRecord {
  readonly pursuitId: string
  readonly sequence: number
  readonly kind: 'event' | 'decision'
  readonly observedAt: number
  readonly digest: string
  readonly previousDigest?: string
  readonly event?: unknown
  readonly decision?: unknown
}

export function observerJournalEventSource(journal: ObserverJournalLike): McpEventSource {
  return {
    async read() {
      const records = await journal.read()
      return records.map((record) => ({
        sequence: record.sequence,
        pursuitId: record.pursuitId,
        kind: record.kind,
        observedAt: record.observedAt,
        digest: record.digest,
        ...(record.previousDigest !== undefined ? { previousDigest: record.previousDigest } : {}),
        payload: record.event ?? record.decision ?? null,
      }))
    },
  }
}

/** A run directory's committed root stream (or one node's stream) as an `McpEventSource` (#1565).
 *  The sequence is the line's own `seq`, which continues across drive attempts and processes, so
 *  an acknowledged cursor survives a crash and a continuation; each record carries its `attempt`.
 *  A torn tail is not served. The chain digests each record over the previous digest, so a
 *  consumer that keeps the digest at its cursor detects rewritten history on its next read. */
export function rootStreamEventSource(
  runDir: string,
  options: { readonly pursuitId: string; readonly nodeId?: string },
): McpEventSource {
  return {
    async read() {
      let previousDigest: string | undefined
      return ((await readRootStream(runDir, options)) ?? []).map((record) => {
        const digest = createHash('sha256')
          .update(`${previousDigest ?? ''}\n${JSON.stringify(record)}`)
          .digest('hex')
        const out = {
          sequence: record.seq,
          pursuitId: options.pursuitId,
          kind: 'event' as const,
          observedAt: Date.parse(record.at),
          digest,
          ...(previousDigest ? { previousDigest } : {}),
          payload: record,
        }
        previousDigest = digest
        return out
      })
    },
  }
}
