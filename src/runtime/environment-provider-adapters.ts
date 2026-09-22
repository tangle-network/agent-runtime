import type { StreamEvent } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentEvent,
  AgentSession,
  AgentTurnInput,
  AgentTurnResult,
} from '@tangle-network/agent-interface/environment-provider'
import { parseCanonicalTransportEvent } from './sandbox-events'

export class ValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ValidationError'
  }
}

export function canonicalEventFromEnvironmentEvent(
  event: AgentEnvironmentEvent,
): StreamEvent | undefined {
  if (!isRecord(event.data)) {
    throw new ValidationError('environment provider emitted an event without an object payload')
  }
  return parseCanonicalTransportEvent(
    event.type,
    event.data,
    event.normalized ?? event.data.normalized,
    'environment provider',
  )
}

export function assertSandboxInputSupported(
  input: AgentTurnInput,
  options: { allowDispatchDetach?: boolean } = {},
): void {
  if (input.detach === true && options.allowDispatchDetach !== true) {
    throw new ValidationError(
      'Sandbox 0.17 cannot admit detached turns without durable replay and ownership support',
    )
  }
  if (input.lastEventId !== undefined) {
    throw new ValidationError(
      'Sandbox 0.17 cannot admit replay cursors without durable event identity',
    )
  }
  if (input.contextTransfer) {
    throw new ValidationError(
      'Sandbox 0.17 cannot admit canonical context transfer without a receipt-capable adapter',
    )
  }
  if (input.nativeContinuation) {
    throw new ValidationError(
      'Sandbox 0.17 cannot admit native continuation without a boundary-capable adapter',
    )
  }
  if (input.controlRef) {
    throw new ValidationError(
      'Sandbox 0.17 cannot round-trip AgentRunControlRef through prompt dispatch',
    )
  }
}

export function assertSandboxReplaySupported(since: string | undefined): void {
  if (since !== undefined) {
    throw new ValidationError(
      'Sandbox 0.17 cannot admit session replay cursors without durable event identity',
    )
  }
}

export async function exactSessionResult(
  session: AgentSession,
  executionId: string | undefined,
): Promise<AgentTurnResult> {
  const result = session.result as unknown as (options?: {
    executionId?: string
  }) => Promise<AgentTurnResult>
  return result(executionId === undefined ? undefined : { executionId })
}

export async function exactSessionCancel(
  session: AgentSession,
  executionId: string | undefined,
): Promise<{ cancelled: boolean; executionId?: string }> {
  const cancel = session.cancel as unknown as (options?: {
    executionId?: string
  }) => Promise<unknown>
  const result = await cancel(executionId === undefined ? undefined : { executionId })
  const cancelled =
    result && typeof result === 'object' && 'cancelled' in result
      ? (result as { cancelled?: unknown }).cancelled === true
      : true
  return { cancelled }
}

export function terminalOutcomeFromEvents(
  events: readonly AgentEnvironmentEvent[],
  isTerminalEnvironmentEvent: (event: AgentEnvironmentEvent) => boolean,
): {
  success: boolean
  status: 'success' | 'failed'
  error?: string
} {
  const terminal = [...events].reverse().find(isTerminalEnvironmentEvent)
  if (!terminal) return { success: true, status: 'success' }
  const data = terminal.data
  const normalizedStatus =
    terminal.normalized?.type === 'status' ? terminal.normalized.status : undefined
  const status = typeof data.status === 'string' ? data.status : normalizedStatus
  const failed =
    data.success === false ||
    data.error !== undefined ||
    status === 'failed' ||
    status === 'cancelled' ||
    terminal.type === 'error' ||
    terminal.type.endsWith('.failed')
  if (!failed) return { success: true, status: 'success' }
  const error = [data.error, data.message, data.detail, data.reason].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  return {
    success: false,
    status: 'failed',
    error:
      error ?? (status === 'cancelled' ? 'provider session cancelled' : 'provider session failed'),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
