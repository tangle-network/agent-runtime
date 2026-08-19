import { describe, expect, it } from 'vitest'
import { extractTransportEventIdentity } from './sandbox-transport-events'

describe('extractTransportEventIdentity', () => {
  it('keeps the CLI Bridge replay cursor separate from canonical identity', () => {
    expect(
      extractTransportEventIdentity({
        id: '1',
        data: { cursor: '1', eventId: 'run-1:1' },
        providerEvent: { eventId: 'run-1:1' },
      }),
    ).toEqual({ eventId: 'run-1:1', cursor: '1' })
  })

  it('rejects disagreement between canonical identity sources', () => {
    expect(() =>
      extractTransportEventIdentity({
        id: '1',
        data: { cursor: '1', eventId: 'run-1:1' },
        providerEvent: { eventId: 'run-1:2' },
      }),
    ).toThrow('canonical identities disagree')
  })

  it('uses providerEvent.eventId when the data payload has no canonical identity', () => {
    expect(
      extractTransportEventIdentity({
        id: '1',
        data: { cursor: '1' },
        providerEvent: { eventId: 'run-1:1' },
      }),
    ).toEqual({ eventId: 'run-1:1', cursor: '1' })
  })

  it('retains the top-level id fallback for legacy events without canonical identity', () => {
    expect(
      extractTransportEventIdentity({
        id: 'legacy-event',
        data: { cursor: 'legacy-cursor' },
      }),
    ).toEqual({ eventId: 'legacy-event', cursor: 'legacy-cursor' })
  })
})
