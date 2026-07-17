import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertNoHiddenLeak } from './swe-jail'
import {
  assertExactCompletedWorkerSessions,
  continuationDisposition,
  continuationStateNotice,
  preferLaterCandidate,
  resolveExperimentArm,
  resolveExperimentTemperature,
  shouldAcceptContinuation,
  shouldRunContinuation,
} from './swe-structural-policy'

describe('structural experiment arms', () => {
  it('derives exactly two independent sessions without repair', () => {
    assert.deepEqual(resolveExperimentArm('independent-2'), {
      arm: 'independent-2',
      k: 2,
      repairs: 0,
      alwaysRunContinuation: false,
      persistent: false,
      workerSessions: 2,
    })
  })

  it('derives exactly one initial plus one persistent continuation session', () => {
    const preset = resolveExperimentArm('persistent-refine-2')
    assert.deepEqual(preset, {
      arm: 'persistent-refine-2',
      k: 1,
      repairs: 1,
      alwaysRunContinuation: true,
      persistent: true,
      workerSessions: 2,
    })
    assert.equal(shouldRunContinuation({ round: 1, preset }), true)
    assert.equal(shouldRunContinuation({ round: 2, preset }), false)
  })

  it('rejects every untyped arm instead of accepting free-form K/repair settings', () => {
    assert.throws(() => resolveExperimentArm('system'), /independent-2\|persistent-refine-2/)
    assert.throws(() => resolveExperimentArm(''), /independent-2\|persistent-refine-2/)
  })

  it('uses TEMPERATURE without repurposing Node TEMP as a model knob', () => {
    assert.equal(resolveExperimentTemperature({}), 0.8)
    assert.equal(resolveExperimentTemperature({ TEMPERATURE: '0.35' }), 0.35)
    assert.equal(resolveExperimentTemperature({ TEMP: '/tmp', TEMPERATURE: '0.35' }), 0.35)
    assert.throws(
      () => resolveExperimentTemperature({ TEMP: '0.8' }),
      /TEMP is the operating-system temporary-directory root.*TEMPERATURE/,
    )
    assert.throws(() => resolveExperimentTemperature({ TEMPERATURE: 'hot' }), /finite number/)
  })
})

describe('shared later-on-visible-tie policy', () => {
  it('prefers session two on a visible tie in both arm shapes', () => {
    assert.equal(preferLaterCandidate(0, 0), true)
    assert.equal(preferLaterCandidate(1, 1), true)
    assert.equal(shouldAcceptContinuation(0, 0), true)
    assert.equal(shouldAcceptContinuation(1, 1), true)
  })

  it('prefers a visible improvement and rejects a visible regression', () => {
    assert.equal(preferLaterCandidate(1, 0), true)
    assert.equal(preferLaterCandidate(0, 1), false)
    assert.equal(shouldAcceptContinuation(1, 0), true)
    assert.equal(shouldAcceptContinuation(0, 1), false)
  })

  it('never labels an identical second patch as a refinement', () => {
    assert.deepEqual(continuationDisposition(true, false), {
      finalFrom: 'session:2-identical',
      stop: 'continuation-accepted-identical',
    })
    assert.equal(continuationDisposition(true, true).finalFrom, 'session:2-refinement')
  })

  it('inherits parent state without echoing parent patch bytes into session two', () => {
    const parent = 'diff --git a/a.py b/a.py\n+gold-like-added-line\n'
    const notice = continuationStateNotice(parent)
    assert.match(notice, /already applied to this checkout/)
    assert.equal(notice.includes('gold-like-added-line'), false)
    assert.doesNotThrow(() => assertNoHiddenLeak(['+gold-like-added-line'], [{ role: 'user', content: notice }]))
  })
})

describe('exact completed worker compute', () => {
  const complete = { calls: 1, completions: 1, attemptError: null }

  it('admits exactly two completed model-backed sessions', () => {
    assert.doesNotThrow(() =>
      assertExactCompletedWorkerSessions({
        started: 2,
        completed: 2,
        sessions: [complete, complete],
        context: 'row',
      }),
    )
  })

  it('rejects an attempted-but-failed or zero-call session', () => {
    assert.throws(() =>
      assertExactCompletedWorkerSessions({
        started: 2,
        completed: 1,
        sessions: [complete, { calls: 0, completions: 0, attemptError: 'timeout' }],
        context: 'row',
      }),
      /expected exactly 2 started and completed/,
    )
    assert.throws(() =>
      assertExactCompletedWorkerSessions({
        started: 2,
        completed: 2,
        sessions: [complete, { calls: 0, completions: 1, attemptError: null }],
        context: 'row',
      }),
      /session 2 did not complete successfully/,
    )
  })
})
