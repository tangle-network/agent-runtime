import assert from 'node:assert/strict'
import { isRunRecord } from '@tangle-network/agent-eval'
import { type AttemptRecord, benchRecordToCorpusRecords, type RunRecord } from './corpus'

const measuredAttempt = (round: number, output: string, valid: boolean): AttemptRecord => ({
  round,
  prompt: `q${round}`,
  output,
  valid,
  score: valid ? 1 : 0,
  costUsd: 0.01 + round / 1000,
  tokensIn: 100 + round,
  tokensOut: 30 + round,
  wallMs: 500 + round,
  eventCount: 2,
  eventTypes: { llm_call: 1, tool_call: 1 },
})

const baseRec = (attempts: AttemptRecord[], over: Partial<RunRecord> = {}): RunRecord => ({
  ts: '2026-06-03T00:00:00.000Z',
  benchmark: 'finsearchcomp',
  instanceId: 'i1',
  condition: 'random@3',
  // canonical RunRecord requires a snapshot-pinned model; bench writes bare
  // aliases, so the happy path supplies the resolved snapshot via opts.model.
  model: 'gpt-5',
  blindResolved: attempts[0]?.valid === true,
  resolved: attempts.some((a) => a.valid === true),
  attempts,
  infraError: false,
  ...over,
})

// --- happy path: a measured run projects to one canonical CorpusRecord per attempt ---
{
  const rec = baseRec([
    measuredAttempt(0, 'alpha', false),
    measuredAttempt(1, 'beta', true),
  ])
  const { records, unmappable } = await benchRecordToCorpusRecords(rec, {
    commitSha: 'abc123',
    model: 'gpt-5-2025-08-07',
    seed: 42,
  })
  assert.equal(unmappable.length, 0, 'all measured attempts map')
  assert.equal(records.length, 2, 'one record per attempt')
  for (const r of records) {
    assert.ok(isRunRecord(r), 'each is a valid canonical RunRecord')
  }
  const [r0, r1] = records
  assert.equal(r0?.candidateId, 'random@3', 'candidateId = condition (the gate-pairing arm)')
  assert.equal(r0?.scenarioId, 'i1', 'scenarioId = instanceId (the pairing key)')
  assert.equal(r0?.seed, 42, 'opts.seed is the base seed for attempt 0')
  assert.equal(r1?.seed, 43, 'each attempt offsets the base → DISTINCT seeds')
  assert.notEqual(r0?.seed, r1?.seed, 'no (scenarioId, seed) collision across a run\'s attempts')
  assert.equal(r0?.model, 'gpt-5-2025-08-07', 'snapshot-pinned model override applied')
  assert.equal(r0?.commitSha, 'abc123')
  assert.equal(r0?.tokenUsage.input, 100, 'real tokens carried (not zeroed)')
  assert.equal(r0?.costUsd, 0.01, 'real cost carried')
  assert.equal(r0?.prompt, 'q0', 'verbatim prompt survives the validator')
  assert.equal(r0?.completion, 'alpha', 'verbatim completion survives the validator')
  assert.equal(r0?.outcome.searchScore, 0, 'search split → searchScore from attempt score')
  assert.equal(r0?.outcome.raw.valid, 0)
  assert.equal(r1?.outcome.raw.valid, 1)
  assert.notEqual(r0?.runId, r1?.runId, 'per-attempt runIds are distinct')
}

// --- unmeasured economics → unmappable, never forged with phantom zeros ---
{
  const bare: AttemptRecord = { round: 0, prompt: 'q', output: 'x', valid: true, eventCount: 0, eventTypes: {} }
  const { records, unmappable } = await benchRecordToCorpusRecords(baseRec([bare]), {
    commitSha: 'abc',
    model: 'gpt-5-2025-08-07',
  })
  assert.equal(records.length, 0, 'no record forged from unmeasured economics')
  assert.equal(unmappable.length, 1)
  assert.match(unmappable[0]!.reason, /unmeasured/, 'reason names the missing measurement')
  assert.match(unmappable[0]!.reason, /costUsd/, 'reason lists the missing fields')
}

// --- bare-alias model (no override) → unmappable with the validator's reason ---
{
  const { records, unmappable } = await benchRecordToCorpusRecords(
    baseRec([measuredAttempt(0, 'alpha', true)]),
    { commitSha: 'abc' },
  )
  assert.equal(records.length, 0, 'a bare-alias model is not a reproducibility artifact')
  assert.equal(unmappable.length, 1)
  assert.match(unmappable[0]!.reason, /invalid RunRecord/, 'surfaces the validator rejection')
  assert.match(unmappable[0]!.reason, /snapshot/, 'reason explains the snapshot-pin requirement')
}

// --- holdout split routes the score to holdoutScore ---
{
  const { records } = await benchRecordToCorpusRecords(baseRec([measuredAttempt(0, 'alpha', true)]), {
    commitSha: 'abc',
    model: 'gpt-5-2025-08-07',
    splitTag: 'holdout',
  })
  assert.equal(records.length, 1)
  assert.equal(records[0]?.splitTag, 'holdout')
  assert.equal(records[0]?.outcome.holdoutScore, 1, 'holdout split → holdoutScore')
  assert.equal(records[0]?.outcome.searchScore, undefined, 'no searchScore on a holdout record')
}

console.log('corpus.test.mts: all assertions passed')
