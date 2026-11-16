import { expect, it } from 'vitest'
import { runPlacementCapacityRoot } from './fixtures/placement-capacity-root'

it('ends a run whose deadline passes while placement is refused with a typed capacity stop', async () => {
  // Past the 10 min fixed capacity window: the one drive waits to the run's deadline.
  const { result, records } = await runPlacementCapacityRoot('deadline', 13 * 60_000)
  expect(records).toEqual([
    expect.objectContaining({
      attempt: 1,
      classification: 'unavailable',
      unavailableSignal: 'capacity_exhausted',
      stop: 'deadline',
    }),
  ])
  expect(result).toMatchObject({
    kind: 'no-winner',
    reason: 'deadline',
    continuation: { ended: 'deadline', failureRetries: 0 },
  })
}, 1_080_000)
