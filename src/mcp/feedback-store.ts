/**
 *
 * Feedback persistence surface for the MCP layer.
 *
 * The substrate cannot import `@tangle-network/agent-knowledge` (it would
 * induce a dependency cycle), so the store is an abstract interface. The
 * default implementation is in-memory; consumers wire their own adapter
 * (a real KbStore-backed sink, an HTTP relay to gtm-agent's knowledge
 * service, etc.) via `createMcpServer({ feedbackStore })`.
 *
 * Feedback events are append-only: every rating is a new event with a
 * fresh id, even when the same delegation is rated multiple times. The
 * caller decides how to roll up scores downstream.
 *
 * @experimental
 */

import type { DelegateFeedbackArgs, DelegationFeedbackSnapshot } from './types'

/** @experimental */
export interface FeedbackEvent {
  id: string
  refersTo: DelegateFeedbackArgs['refersTo']
  rating: DelegateFeedbackArgs['rating']
  by: DelegateFeedbackArgs['by']
  capturedAt: string
  namespace?: string
}

/** @experimental */
export interface FeedbackStore {
  /** Append a new event. Never dedupes — every rating is its own event. */
  put(event: FeedbackEvent): Promise<void>
  /**
   * List events filtered by `namespace`. When `namespace` is omitted, list
   * across all namespaces. Returns events in insertion order.
   */
  list(filter?: { namespace?: string; refersToRef?: string }): Promise<FeedbackEvent[]>
}

/** In-memory `FeedbackStore` — suitable for single-process use and tests. @experimental */
export class InMemoryFeedbackStore implements FeedbackStore {
  private readonly events: FeedbackEvent[] = []

  async put(event: FeedbackEvent): Promise<void> {
    this.events.push({ ...event })
  }

  async list(filter: { namespace?: string; refersToRef?: string } = {}): Promise<FeedbackEvent[]> {
    let out = this.events
    if (filter.namespace !== undefined) {
      out = out.filter((event) => event.namespace === filter.namespace)
    }
    if (filter.refersToRef !== undefined) {
      out = out.filter((event) => event.refersTo.ref === filter.refersToRef)
    }
    return out.map((event) => ({ ...event }))
  }
}

/**
 * Project a `FeedbackEvent` down to the snapshot shape carried on
 * `delegation_history` entries.
 *
 * @experimental
 */
export function eventToSnapshot(event: FeedbackEvent): DelegationFeedbackSnapshot {
  const snap: DelegationFeedbackSnapshot = {
    id: event.id,
    score: event.rating.score,
    by: event.by,
    notes: event.rating.notes,
    capturedAt: event.capturedAt,
  }
  if (event.rating.label) snap.label = event.rating.label
  return snap
}
