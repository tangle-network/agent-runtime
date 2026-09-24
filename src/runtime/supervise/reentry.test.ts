import { describe, expect, it } from 'vitest'
import type { ManagerReentryState } from '../../mcp/tools/coordination'
import { composeReentryTask } from './reentry'

const state: ManagerReentryState = {
  journalRows: 14,
  journalReadTo: 9,
  live: [{ id: 'run:s1', label: 'verifier', status: 'running' }],
  settled: [{ id: 'run:s0', status: 'done', valid: false, delivered: false }],
  waiting: [{ type: 'settled', worker: 'run:s0' }],
  unacknowledged: [{ seq: 4, type: 'finding', worker: 'run:s0', attempt: 1 }],
  lastRejection: { at: 0, reason: 'result.token is missing' },
}

const { lastRejection: _lastRejection, ...withoutRejection } = state

describe('composeReentryTask', () => {
  it('gives a replacement environment the objective, the contract, and the run state', () => {
    const task = composeReentryTask({
      originalTask: 'Fetch the holder token and submit it.',
      contract: 'an object {token}',
      reentry: { reason: 'driver-failure', failure: 'Sandbox not found', retry: 1 },
      continuity: {
        session: 'new',
        environment: 'replaced',
        previousEnvironmentId: 'sandbox-1',
        workspace: 'lost',
      },
      state,
      attempt: 2,
    })
    expect(task).toContain('re-entering a run that is already in progress (driver attempt 2)')
    expect(task).toContain('Your previous turn ended before it finished (retry 1)')
    // The failure text is infrastructure detail; a director told it investigates infrastructure.
    expect(task).not.toContain('Sandbox not found')
    expect(task).toContain('Your previous environment (sandbox-1) is gone')
    expect(task).toContain('Fetch the holder token and submit it.')
    expect(task).toContain('It expects: an object {token}')
    expect(task).toContain('call read_journal with sinceRow 9')
    expect(task).toContain('Workers running: run:s1 (verifier, running)')
    expect(task).toContain('run:s0 (done, did not pass its check, not yet received)')
    expect(task).toContain('Events waiting for you in await_event: 1 (settled from run:s0)')
    expect(task).toContain('#4 finding from run:s0')
    expect(task).toContain('Your last submit_result was refused: result.token is missing')
  })

  it('tells a director re-entered after a pause only that its turn was interrupted', () => {
    const task = composeReentryTask({
      originalTask: 'Fetch the holder token and submit it.',
      reentry: { reason: 'upstream-unavailable', signal: 'provider_quota_exhausted', pause: 3 },
      continuity: { session: 'continued', environment: 'same', workspace: 'kept' },
      state,
      attempt: 4,
    })
    expect(task).toContain('Your previous turn was interrupted before it finished')
    // The operator owns the upstream: no provider, code or pause count reaches the director.
    expect(task).not.toContain('provider_quota_exhausted')
    expect(task).not.toMatch(/quota|provider|pause/iu)
    expect(task).toContain('Fetch the holder token and submit it.')
    expect(task).toContain('call read_journal with sinceRow 9')
  })

  it('sends only the unmet items and what changed into a proven-continuous session', () => {
    const task = composeReentryTask({
      originalTask: 'Fetch the holder token and submit it.',
      reentry: {
        reason: 'unmet-contract',
        steer: 'The completion check has not passed.',
        reprompt: 1,
      },
      continuity: { session: 'continued', environment: 'same', workspace: 'kept' },
      state: { ...withoutRejection, unacknowledged: [] },
      attempt: 2,
    })
    expect(task.startsWith('The completion check has not passed.')).toBe(true)
    expect(task).not.toContain('Fetch the holder token')
    expect(task).toContain('Events waiting for you in await_event: 1')
    expect(task).toContain('Workers settled that you have not received: run:s0')
  })

  it('still carries the objective when an unmet re-prompt lands in a session it cannot prove', () => {
    const task = composeReentryTask({
      originalTask: { program: 'factory', prompt: 'Build the product.' },
      reentry: { reason: 'unmet-contract', steer: 'Submit the product packet.', reprompt: 2 },
      continuity: { session: 'new', environment: 'unknown', workspace: 'unknown' },
      state: {
        journalRows: 0,
        journalReadTo: 0,
        live: [],
        settled: [],
        waiting: [],
        unacknowledged: [],
      },
      attempt: 3,
    })
    expect(task).toContain('"prompt": "Build the product."')
    expect(task).toContain('What is still unmet:')
    expect(task).toContain('Submit the product packet.')
    expect(task).toContain('Workers running: none.')
  })
})
