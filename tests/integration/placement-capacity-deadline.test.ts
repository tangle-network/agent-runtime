import { expect, it } from 'vitest'
import { runPlacementCapacityRoot } from './fixtures/placement-capacity-root'

it.each([
  ['capacity', 'capacity_exhausted'],
  ['keyed', 'sandbox_create_reconciling'],
] as const)(
  'ends a run whose deadline passes while its create gets %s refusals with a typed capacity stop',
  async (refusal, signal) => {
    const { result, records } = await runPlacementCapacityRoot('deadline', refusal)
    expect(records).toEqual([
      expect.objectContaining({
        attempt: 1,
        classification: 'unavailable',
        unavailableSignal: signal,
        stop: 'deadline',
      }),
    ])
    expect(result).toMatchObject({
      kind: 'no-winner',
      reason: 'deadline',
      continuation: { ended: 'deadline', failureRetries: 0 },
    })
  },
  1_080_000,
)
