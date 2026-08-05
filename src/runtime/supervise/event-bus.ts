/**
 *
 * The child→parent message bus: the ONE pipe carrying every message a worker, sub-driver, or
 * analyst sends up to the driver — settled outputs, questions, and trace-analyst findings. It
 * unifies channels that were ad-hoc before (the settled-worker cursor, the ask-parent question
 * channel, and analyst results) into a single typed primitive with two lanes:
 *
 *   - PASS-THROUGH (`subscribe`): every published event reaches subscribers immediately — the
 *     express lane for online steering and live observation (a UI, a hook, the parent's box).
 *   - STANDBY (`pull`): events also queue so the driver consumes them on its own cadence. The queue
 *     is PRIORITY-ordered: a higher-`priority` event (a blocking question) is bumped ahead of
 *     queued settles/findings so the driver sees it first; ties resolve FIFO by publish order.
 *
 * Observability is first-class (A++): every event is stamped with a monotonic `seq` and wall-clock
 * `at`, the full ordered `history()` is retained as current-process audit evidence, and `stats()`
 * exposes published/pulled counts by kind. Subscribers receive the stamped record, not a bare event.
 *
 * The interface is transport-agnostic on purpose. Same box → this in-process queue. Cross box →
 * the SAME publish/pull/subscribe surface backed by a durable mailbox on the parent's box (children
 * POST events with at-least-once retry; payloads are blob refs so the event stays small). Consumers
 * depend only on this interface, so distribution is a transport swap, never an architecture change.
 *
 * @experimental
 */

/** Every bus event is a discriminated union member keyed by `type`. */
export interface BusEvent {
  readonly type: string
}

/** A published event stamped for ordering and observability. `seq` is the monotonic publish index;
 *  `priority` drives pull order (higher = bumped ahead); `at` is the wall-clock publish time (ms). */
export interface BusRecord<E extends BusEvent> {
  readonly seq: number
  readonly at: number
  readonly priority: number
  readonly event: E
}

export interface PublishOptions {
  /** Higher = pulled ahead of lower-priority queued events (default 0). A blocking question sets
   *  this so it bumps to the front of the driver's inbox. */
  readonly priority?: number
  /** Whether the event enters the pull queue (default true). Set `false` for record-only events —
   *  the parent→child down-leg (steer / answer / resume): they belong in `history()` and reach
   *  `subscribe` observers, but the parent must never `pull` its own outbound message back. */
  readonly queue?: boolean
}

export interface BusStats {
  readonly published: number
  readonly pulled: number
  /** Count published per event `type`. */
  readonly byKind: Readonly<Record<string, number>>
}

/** The child→parent coordination bus surface: publish, priority-ordered pull, pass-through subscribe, history, and stats.
 * @experimental In-process only — the durable cross-process mailbox this interface is designed
 * to admit is not implemented (docs/agent-managed-compute/README.md). */
export interface EventBus<E extends BusEvent> {
  /** Stamp the event, await every subscriber in order, then make it pull-visible. A subscriber
   *  failure leaves the event invisible and retrying the SAME event object reuses the exact stamp.
   *  This lets an awaited product observer commit its record before a supervisor can consume it. */
  publish(event: E, opts?: PublishOptions): Promise<BusRecord<E>>
  /** Remove and return the highest-priority QUEUED event whose type is in `kinds` (any if omitted),
   *  ties broken FIFO by `seq`; `undefined` when nothing matches. */
  pull(kinds?: ReadonlyArray<E['type']>): E | undefined
  /** Register a pass-through handler; it receives the stamped record of every event published after
   *  registration. Returns an unsubscribe fn. */
  subscribe(handler: (record: BusRecord<E>) => void | Promise<void>): () => void
  /** Count of queued, not-yet-pulled events (filtered by `kinds` when given). */
  pending(kinds?: ReadonlyArray<E['type']>): number
  /** The full ordered log of every event published in this process (audit evidence, not replay). */
  history(): ReadonlyArray<BusRecord<E>>
  /** Throughput counters for observability dashboards. */
  stats(): BusStats
}

/** Create the child→parent coordination bus: one typed pipe for settled outputs, questions, and analyst findings, with a priority-ordered pull queue and a pass-through subscribe lane.
 * @experimental In-process queue; durability is a transport swap that does not exist yet. */
export function createEventBus<E extends BusEvent>(now: () => number = Date.now): EventBus<E> {
  const queue: BusRecord<E>[] = []
  const log: BusRecord<E>[] = []
  const subscribers: Array<(record: BusRecord<E>) => void | Promise<void>> = []
  const byKind: Record<string, number> = {}
  // A failed publication is staged, not published. Coordination retains and retries the same event
  // object, so the exact BusRecord survives a lost acknowledgement and downstream idempotency keys
  // do not change between attempts.
  const staged = new WeakMap<object, BusRecord<E>>()
  let seq = 0
  let published = 0
  let pulled = 0

  const matches = (r: BusRecord<E>, kinds?: ReadonlyArray<E['type']>) =>
    !kinds || kinds.includes(r.event.type)

  // Index of the highest-priority matching record; ties resolve to the earliest `seq` (the queue is
  // maintained in publish order, so the first scan hit at the max priority is the oldest).
  const bestIndex = (kinds?: ReadonlyArray<E['type']>): number => {
    let best = -1
    let bestPriority = Number.NEGATIVE_INFINITY
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]
      if (!r || !matches(r, kinds)) continue
      if (r.priority > bestPriority) {
        best = i
        bestPriority = r.priority
      }
    }
    return best
  }

  return {
    async publish(event, opts) {
      const record =
        staged.get(event) ??
        ({ seq: seq++, at: now(), priority: opts?.priority ?? 0, event } satisfies BusRecord<E>)
      staged.set(event, record)
      // Sequential, not Promise.all: transaction observers must see causal order. Nothing enters
      // the pull queue or successful history until all observers acknowledge the record.
      for (const handler of subscribers) await handler(record)
      staged.delete(event)
      // Record-only events (the down-leg) skip the pull queue but still hit the log + subscribers.
      if (opts?.queue !== false) queue.push(record)
      log.push(record)
      published += 1
      byKind[event.type] = (byKind[event.type] ?? 0) + 1
      return record
    },
    pull(kinds) {
      const i = bestIndex(kinds)
      if (i < 0) return undefined
      pulled++
      return queue.splice(i, 1)[0]?.event
    },
    subscribe(handler) {
      subscribers.push(handler)
      return () => {
        const i = subscribers.indexOf(handler)
        if (i >= 0) subscribers.splice(i, 1)
      }
    },
    pending(kinds) {
      return kinds ? queue.filter((r) => matches(r, kinds)).length : queue.length
    },
    history() {
      return log
    },
    stats() {
      return { published, pulled, byKind: { ...byKind } }
    },
  }
}
