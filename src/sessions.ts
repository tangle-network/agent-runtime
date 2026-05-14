/**
 * @stable
 *
 * Session helpers + an in-memory `RuntimeSessionStore` implementation suitable
 * for tests, scratch processes, and per-request scratch storage in serverless
 * runtimes. Durable stores (D1, postgres, Durable Objects) implement the same
 * interface from `./types`.
 */

import type { RuntimeSession, RuntimeSessionStore, RuntimeStreamEvent } from './types'

/** @internal */
export function newRuntimeSession(
  backend: string,
  requestedId?: string,
  metadata?: Record<string, unknown>,
): RuntimeSession {
  const now = nowIso()
  return {
    id: requestedId || crypto.randomUUID(),
    backend,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    metadata,
  }
}

/** @internal */
export function touchSession(session: RuntimeSession): RuntimeSession {
  return { ...session, updatedAt: nowIso() }
}

/** @internal */
export function nowIso(): string {
  return new Date().toISOString()
}

/** @stable */
export class InMemoryRuntimeSessionStore implements RuntimeSessionStore {
  private readonly sessions = new Map<string, RuntimeSession>()
  private readonly events = new Map<string, RuntimeStreamEvent[]>()

  get(sessionId: string): RuntimeSession | undefined {
    return this.sessions.get(sessionId)
  }

  put(session: RuntimeSession): void {
    this.sessions.set(session.id, session)
  }

  appendEvent(sessionId: string, event: RuntimeStreamEvent): void {
    const existing = this.events.get(sessionId) ?? []
    existing.push(event)
    this.events.set(sessionId, existing)
  }

  listEvents(sessionId: string): RuntimeStreamEvent[] {
    return [...(this.events.get(sessionId) ?? [])]
  }
}
