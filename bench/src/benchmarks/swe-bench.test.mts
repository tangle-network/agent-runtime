import assert from 'node:assert/strict'
import test from 'node:test'
import { scoreSweReport } from './swe-bench'

const taskId = 'django__django-12345'

test('scoreSweReport preserves official resolved, unresolved, and empty-patch outcomes', () => {
  assert.equal(scoreSweReport(taskId, { submitted_ids: [taskId], resolved_ids: [taskId] }).score, 1)
  assert.equal(scoreSweReport(taskId, { submitted_ids: [taskId], unresolved_ids: [taskId] }).score, 0)
  assert.equal(scoreSweReport(taskId, { submitted_ids: [taskId], empty_patch_ids: [taskId] }).score, 0)
})

test('scoreSweReport rejects evaluator failures instead of scoring them as agent failures', () => {
  assert.throws(() => scoreSweReport(taskId, { submitted_ids: [taskId], error_ids: [taskId] }), /evaluator failed/)
  assert.throws(() => scoreSweReport(taskId, { submitted_ids: [taskId], incomplete_ids: [taskId] }), /evaluator failed/)
})

test('scoreSweReport rejects missing, ambiguous, malformed, and mismatched outcomes', () => {
  assert.throws(() => scoreSweReport(taskId, { submitted_ids: [taskId] }), /no unique outcome/)
  assert.throws(
    () => scoreSweReport(taskId, { resolved_ids: [taskId], unresolved_ids: [taskId] }),
    /no unique outcome/,
  )
  assert.throws(() => scoreSweReport(taskId, { resolved_ids: taskId }), /malformed resolved_ids/)
  assert.throws(() => scoreSweReport(taskId, { resolved_ids: ['other__repo-1'] }), /identity mismatch/)
})
