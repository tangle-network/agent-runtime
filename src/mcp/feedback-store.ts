/**
 *
 * Feedback persistence surface for the MCP layer.
 *
 * Feedback storage is product policy, so the MCP layer depends on this narrow
 * interface instead of choosing a knowledge store. The default implementation
 * is in-memory; consumers wire their own durable adapter via
 * `createMcpServer({ feedbackStore })`.
 *
 * Feedback events are append-only: every rating is a new event with a
 * fresh id, even when the same delegation is rated multiple times. The
 * caller decides how to roll up scores downstream.
 *
 * @stable
 */

import type { DelegateFeedbackArgs, DelegationFeedbackSnapshot } from './types'

/** @stable */
export interface FeedbackEvent {
  id: string
  refersTo: DelegateFeedbackArgs['refersTo']
  rating: DelegateFeedbackArgs['rating']
  by: DelegateFeedbackArgs['by']
  capturedAt: string
  namespace?: string
}

/** @stable */
export interface FeedbackStore {
  /** Append a new event. Never dedupes — every rating is its own event. */
  put(event: FeedbackEvent): Promise<void>
  /**
   * List events filtered by `namespace`. When `namespace` is omitted, list
   * across all namespaces. Returns events in insertion order.
   */
  list(filter?: { namespace?: string; refersToRef?: string }): Promise<FeedbackEvent[]>
}

/** In-memory `FeedbackStore` — suitable for single-process use and tests. @stable */
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
 * @stable
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
