import { RuntimeEventEnvelopeSchema } from '@tangle-network/agent-interface'

const validTimestamp = '2026-01-01T00:00:00.000Z'

/** Validate a timestamp with the public runtime envelope contract. */
export function assertRuntimeTimestamp(value: unknown, label: string): asserts value is string {
  try {
    RuntimeEventEnvelopeSchema.parse({
      runId: 'runtime',
      eventId: 'event',
      sequence: 0,
      occurredAt: value,
      receivedAt: validTimestamp,
      event: { type: 'status', status: 'processing' },
    })
  } catch (error) {
    throw new Error(`${label} must be a valid ISO timestamp`, { cause: error })
  }
}

/** Return whether a value satisfies the public runtime timestamp contract. */
export function isRuntimeTimestamp(value: unknown): value is string {
  try {
    assertRuntimeTimestamp(value, 'occurredAt')
    return true
  } catch {
    return false
  }
}
