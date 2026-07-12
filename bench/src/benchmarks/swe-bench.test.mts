import assert from 'node:assert/strict'
import test from 'node:test'
import { createSweBenchAdapter, scoreSweReport, sweEvaluationArgv } from './swe-bench'

const taskId = 'django__django-12345'

test('scoreSweReport preserves official resolved, unresolved, and empty-patch outcomes', () => {
  assert.equal(
    scoreSweReport(taskId, { submitted_ids: [taskId], completed_ids: [taskId], resolved_ids: [taskId] }).score,
    1,
  )
  assert.equal(
    scoreSweReport(taskId, { submitted_ids: [taskId], completed_ids: [taskId], unresolved_ids: [taskId] }).score,
    0,
  )
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
  assert.throws(() => scoreSweReport(taskId, { resolved_ids: [taskId] }), /lacks a completed evaluation/)
  assert.throws(
    () => scoreSweReport(taskId, { submitted_ids: [taskId, 'other__repo-1'], empty_patch_ids: [taskId] }),
    /identity mismatch/,
  )
})

test('createSweBenchAdapter accepts only positive integer evaluation timeouts', () => {
  assert.doesNotThrow(() => createSweBenchAdapter({ timeoutMs: 1_200_000 }))
  assert.throws(() => createSweBenchAdapter({ timeoutMs: 0 }), /positive integer/)
  assert.throws(() => createSweBenchAdapter({ timeoutMs: 1.5 }), /positive integer/)
})

test('SWE evaluation command preserves the requested instance image', () => {
  const argv = sweEvaluationArgv({
    predictionsPath: '/tmp/preds.json',
    runId: 'r364',
    instanceId: taskId,
    cacheLevel: 'instance',
  })
  const cacheIndex = argv.indexOf('--cache_level')
  assert.equal(argv[cacheIndex + 1], 'instance')
  assert.throws(
    () => createSweBenchAdapter({ cacheLevel: 'invalid' as 'instance' }),
    /invalid cacheLevel/,
  )
})
