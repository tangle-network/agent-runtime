/**
 *
 * Session helpers + an in-memory `RuntimeSessionStore` implementation suitable
 * for tests, scratch processes, and per-request scratch storage in serverless
 * runtimes. Durable stores (D1, postgres, Durable Objects) implement the same
 * interface from `./types`.
 *
 * @stable
 */

import { SessionMismatchError } from './errors'
import type {
  AgentBackendContext,
  AgentBackendInput,
  AgentExecutionBackend,
  RuntimeSession,
  RuntimeSessionStore,
  RuntimeStreamEvent,
} from './types'

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

interface StartOrResumeRuntimeSessionOptions<TInput extends AgentBackendInput> {
  backend: AgentExecutionBackend<TInput>
  input: TInput | (() => TInput)
  /** Smaller input used only when the backend can continue its native session. */
  continuationInput?: TInput | (() => TInput)
  context: Omit<AgentBackendContext, 'session'>
  store?: RuntimeSessionStore
  sessionId?: string
  resume?: boolean
  validateSession?: (session: RuntimeSession) => void
}

interface RuntimeSessionCall<TInput extends AgentBackendInput> {
  session: RuntimeSession
  input: TInput
  resumed: boolean
}

/** Start or resume one backend session and persist its current identity. @internal */
export async function startOrResumeRuntimeSession<TInput extends AgentBackendInput>(
  options: StartOrResumeRuntimeSessionOptions<TInput>,
): Promise<RuntimeSessionCall<TInput>> {
  const existing =
    options.resume && options.sessionId ? await options.store?.get(options.sessionId) : undefined
  if (!existing) {
    const input = resolveSessionInput(options.input)
    const session = options.backend.start
      ? await options.backend.start(input, {
          ...options.context,
          requestedSessionId: options.sessionId,
        })
      : newRuntimeSession(options.backend.kind, options.sessionId)
    assertSessionBackend(session, options.backend.kind)
    options.validateSession?.(session)
    await options.store?.put(session)
    return { session, input, resumed: false }
  }

  assertSessionBackend(existing, options.backend.kind)
  const continued = options.backend.resume !== undefined
  const input = resolveSessionInput(
    continued ? (options.continuationInput ?? options.input) : options.input,
  )
  const session = options.backend.resume
    ? await options.backend.resume(existing, input, options.context)
    : touchSession({ ...existing, status: 'active' })
  assertSessionBackend(session, options.backend.kind)
  options.validateSession?.(session)
  await options.store?.put(session)
  return { session, input, resumed: true }
}

function resolveSessionInput<TInput extends AgentBackendInput>(
  input: TInput | (() => TInput),
): TInput {
  return typeof input === 'function' ? input() : input
}

function assertSessionBackend(session: RuntimeSession, backend: string): void {
  if (session.backend !== backend) throw new SessionMismatchError(session.backend, backend)
}

/** In-memory `RuntimeSessionStore` for single-process use and tests. @stable */
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
