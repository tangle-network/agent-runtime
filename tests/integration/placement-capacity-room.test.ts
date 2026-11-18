import { expect, it } from 'vitest'
import { runPlacementCapacityRoot } from './fixtures/placement-capacity-root'

it('waits out an 8 min placement refusal on one drive and completes when room returns', async () => {
  const { result, records, state } = await runPlacementCapacityRoot('success', 20 * 60_000)
  // The create waited inside the first drive: no attempt failed, paused or was charged.
  expect(records).toEqual([expect.objectContaining({ attempt: 1, stop: 'completed' })])
  expect(records[0]).not.toHaveProperty('error')
  expect(result.continuation).toMatchObject({
    ended: 'completed',
    attempts: 1,
    failureRetries: 0,
    unavailablePauses: 0,
  })
  expect(state.requests.filter((row) => row.kind === 'provision-admitted')).toHaveLength(1)
  expect(state.runs).toHaveLength(1)
  expect(state.runs[0]).toMatchObject({ status: 'completed', processResult: { exitCode: 0 } })
}, 900_000)
