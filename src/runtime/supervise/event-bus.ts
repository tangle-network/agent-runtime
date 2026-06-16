/**
 * @experimental
 *
 * The child→parent message bus: the ONE pipe carrying every message a worker, sub-driver, or
 * analyst sends up to the driver — settled outputs, questions, and trace-analyst findings. It
 * unifies three channels that were ad-hoc before (the settled-worker cursor, the ask-parent
 * question channel, and analyst results) into a single typed primitive with two lanes:
 *
 *   - PASS-THROUGH (`subscribe`): every published event reaches subscribers immediately — the
 *     express lane for online steering and live observation (a UI, a hook, the parent's box).
 *   - STANDBY (`pull`): events also queue so the driver consumes them on its own cadence (and a
 *     blocking question parks the worker until its answer arrives) — the accumulative lane.
 *
 * The interface is transport-agnostic on purpose. Same box → this in-process queue. Cross box →
 * the SAME publish/pull/subscribe surface backed by a durable mailbox on the parent's box (children
 * POST events with at-least-once retry; payloads are blob refs so the event stays small). Consumers
 * depend only on this interface, so distribution is a transport swap, never an architecture change.
 */

/** Every bus event is a discriminated union member keyed by `type`. */
export interface BusEvent {
  readonly type: string
}

export interface EventBus<E extends BusEvent> {
  /** Push an event: queue it for `pull`, then deliver to every `subscribe` handler in order. */
  publish(event: E): Promise<void>
  /** Remove and return the oldest QUEUED event whose type is in `kinds` (any type if omitted);
   *  `undefined` when nothing matches. The pass-through copy already went to subscribers. */
  pull(kinds?: ReadonlyArray<E['type']>): E | undefined
  /** Register a pass-through handler; it receives every event published after registration. */
  subscribe(handler: (event: E) => void | Promise<void>): void
  /** Count of queued, not-yet-pulled events (filtered by `kinds` when given). */
  pending(kinds?: ReadonlyArray<E['type']>): number
}

export function createEventBus<E extends BusEvent>(): EventBus<E> {
  const queue: E[] = []
  const subscribers: Array<(event: E) => void | Promise<void>> = []
  const matches = (e: E, kinds?: ReadonlyArray<E['type']>) => !kinds || kinds.includes(e.type)
  return {
    async publish(event) {
      queue.push(event)
      // Sequential, not Promise.all: a subscriber that steers off this event must observe a
      // consistent order, and a throwing subscriber must not silently drop siblings' delivery.
      for (const handler of subscribers) await handler(event)
    },
    pull(kinds) {
      const index = queue.findIndex((e) => matches(e, kinds))
      if (index < 0) return undefined
      return queue.splice(index, 1)[0]
    },
    subscribe(handler) {
      subscribers.push(handler)
    },
    pending(kinds) {
      return kinds ? queue.filter((e) => matches(e, kinds)).length : queue.length
    },
  }
}
