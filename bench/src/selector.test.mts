import assert from 'node:assert/strict'
import type { AttemptRecord, RunRecord } from './corpus'
import {
  bootstrapDeltaCI,
  flipRate,
  normalizeAnswer,
  scoreSelectorOnRun,
  scoreVerifierSelectorOnRun,
  selfConsistencySelect,
  summarizeSelector,
  summarizeVerifierSelector,
  verifierGroundedSelect,
} from './selector'

// --- verifierGroundedSelect: highest pass-count, ties → earliest, validation ---
assert.equal(verifierGroundedSelect([0, 3, 1]), 1, 'highest pass-count wins')
assert.equal(verifierGroundedSelect([2, 2, 1]), 0, 'tie → earliest')
assert.equal(verifierGroundedSelect([0, 0, 0]), 0, 'all-zero → earliest')
assert.equal(verifierGroundedSelect([1]), 0, 'single candidate')
assert.equal(verifierGroundedSelect([false ? 1 : 0, 1]), 1, 'boolean pass/fail as {0,1}')
assert.throws(() => verifierGroundedSelect([]), /no candidate pass-counts/)
assert.throws(() => verifierGroundedSelect([0, -1]), /invalid pass-count/)
assert.throws(() => verifierGroundedSelect([0, Number.NaN]), /invalid pass-count/)

// --- normalizeAnswer ---
assert.equal(normalizeAnswer('  The Paris.  '), 'paris')
assert.equal(normalizeAnswer('"London"'), 'london')
assert.equal(normalizeAnswer('a Cat'), 'cat')
assert.equal(normalizeAnswer('New   York'), 'new york')

// --- selfConsistencySelect: majority, ties, single ---
assert.equal(selfConsistencySelect(['Paris', 'Paris', 'London']), 0, 'largest cluster')
assert.equal(selfConsistencySelect(['London', 'Paris', 'Paris']), 1, 'first member of the largest cluster')
assert.equal(selfConsistencySelect(['a', 'b']), 0, 'tie → earliest cluster')
assert.equal(selfConsistencySelect(['only']), 0)
assert.throws(() => selfConsistencySelect([]), /no candidate outputs/)

// helper: build a RunRecord whose attempts carry (output, valid)
const att = (output: string, valid: boolean): AttemptRecord => ({
  round: 0,
  prompt: '',
  output,
  valid,
  score: valid ? 1 : 0,
  costUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  eventCount: 0,
  eventTypes: {},
})
const rec = (atts: AttemptRecord[], blind = atts[0]?.valid === true): RunRecord => ({
  ts: '',
  benchmark: 'test',
  instanceId: 'i',
  condition: 'random@3',
  model: 'm',
  blindResolved: blind,
  resolved: atts.some((a) => a.valid === true),
  attempts: atts,
  infraError: false,
})

// --- THE firewall regression ---
// Majority answer is WRONG (valid=false), a minority answer is RIGHT (valid=true).
// A non-oracle self-consistency selector must pick the wrong majority — proving it
// ranked on OUTPUT TEXT only and never read `valid`. An oracle would pick the right
// one; that this picks wrong is the honest, deployable behavior.
{
  const r = rec([att('Paris', false), att('Paris', false), att('London', true)])
  const o = scoreSelectorOnRun(r, selfConsistencySelect)
  assert.ok(o)
  assert.equal(o.selectorResolved, false, 'selector picked the wrong majority — it cannot see valid')
  assert.equal(o.oracle, true, 'an oracle COULD have recovered it (London was right)')
  assert.ok(Math.abs(o.randomExpected - 1 / 3) < 1e-9, 'random@3 = 1/3 here')
}

// --- selector beats random when the majority correlates with correctness ---
// Across instances where the right answer is usually the majority, selector@k > random@k.
{
  const records: RunRecord[] = [
    rec([att('A', true), att('A', true), att('B', false)]), // majority right
    rec([att('X', true), att('Y', false), att('X', true)]), // majority right
    rec([att('Q', false), att('Q', false), att('R', true)]), // majority wrong (selector loses this one)
  ]
  const s = summarizeSelector(records, selfConsistencySelect)
  assert.equal(s.n, 3)
  // selector resolves 2/3 (first two), random expected = (2/3 + 2/3 + 1/3)/3 = 5/9
  assert.ok(Math.abs(s.selectorRate - 2 / 3) < 1e-9)
  assert.ok(Math.abs(s.randomRate - 5 / 9) < 1e-9)
  assert.ok(s.dVsRandom > 0, 'self-consistency beats random when majority correlates with correctness')
  assert.ok(s.selectorRate <= s.oracleRate + 1e-9, 'selector can never exceed the oracle ceiling')
  assert.ok(Math.abs(s.gapToOracle - (s.oracleRate - s.selectorRate)) < 1e-9)
}

// --- unscoreable record (no outputs) is skipped, not counted as a pass ---
{
  const blank: RunRecord = {
    ts: '', benchmark: 'test', instanceId: 'i', condition: 'random@3', model: 'm',
    blindResolved: false, resolved: false, infraError: true,
    attempts: [{ round: 0, prompt: '', costUsd: 0, tokensIn: 0, tokensOut: 0, eventCount: 0, eventTypes: {} }],
  }
  assert.equal(scoreSelectorOnRun(blank, selfConsistencySelect), null)
  const s = summarizeSelector([blank], selfConsistencySelect)
  assert.equal(s.n, 0)
  assert.equal(s.skipped, 1)
}

// --- test-retest: a deterministic selector against itself never flips (the floor) ---
{
  const records = [rec([att('A', true), att('A', true), att('B', false)]), rec([att('X', true), att('Y', false)])]
  assert.equal(flipRate(records, selfConsistencySelect, selfConsistencySelect), 0)
}

// --- verifier-grounded selection over a CONTINUOUS graded reward ---
// An attempt carrying an arbitrary deployable-checker score (commit0 pass-rate /
// aec verify.py partial credit). resolve = score >= 1 (full credit).
const attS = (score: number, output = `out-${score}`): AttemptRecord => ({
  round: 0,
  prompt: '',
  output,
  valid: score >= 1,
  score,
  costUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  eventCount: 0,
  eventTypes: {},
})
const recS = (scores: number[]): RunRecord => ({
  ts: '', benchmark: 'aec', instanceId: 'i', condition: 'random@4', model: 'm',
  blindResolved: (scores[0] ?? 0) >= 1,
  resolved: scores.some((s) => s >= 1),
  attempts: scores.map((s, i) => ({ ...attS(s), round: i })),
  infraError: false,
})

// the verifier picks argmax(score); the picked reward == the max (best-of-k)
{
  const o = scoreVerifierSelectorOnRun(recS([0.2, 0.9, 0.5, 0.1]))
  assert.ok(o)
  assert.ok(Math.abs(o.selectorReward - 0.9) < 1e-9, 'verifier picks the highest-scoring attempt')
  assert.ok(Math.abs(o.oracleReward - 0.9) < 1e-9, 'oracle = max = selector on the continuous metric')
  assert.ok(Math.abs(o.randomReward - 0.425) < 1e-9, 'random = mean of the four scores')
  assert.ok(Math.abs(o.blindReward - 0.2) < 1e-9, 'blind = round-1 score')
  assert.equal(o.selectorResolved, false, 'no attempt hit full credit here')
}

// the GATE on a band that lives entirely below full-credit (the aec failure mode):
// binary resolve = 0 everywhere, yet verifier-select beats a blind draw on reward.
{
  const records = [recS([0.2, 0.8, 0.5, 0.3]), recS([0.1, 0.6, 0.9, 0.4]), recS([0.5, 0.5, 0.5, 0.5])]
  const r = summarizeVerifierSelector(records)
  assert.equal(r.n, 3)
  assert.equal(r.skipped, 0)
  assert.equal(r.selectorResolveRate, 0, 'nothing fully resolves — binary metric is dead here')
  assert.equal(r.oracleResolveRate, 0)
  // selector reward = mean(0.8,0.9,0.5)=0.7333; random = mean(0.45,0.5,0.5)=0.4833
  assert.ok(Math.abs(r.selectorReward - 0.7333333) < 1e-5)
  assert.ok(Math.abs(r.randomReward - 0.4833333) < 1e-5)
  assert.ok(r.rewardVsRandom > 0, 'verifier-select beats a blind draw on the continuous reward')
  assert.ok(Math.abs(r.selectorReward - r.oracleReward) < 1e-9, 'selector == oracle on continuous reward by construction')
  // the third instance is concordant-zero (all scores equal → delta 0) → 2/3 discordant
  assert.equal(r.ci.discordant, 2, 'flat-reward instances contribute a zero delta')
  assert.ok(r.ci.lo <= r.rewardVsRandom && r.rewardVsRandom <= r.ci.hi, 'point estimate inside its CI')
}

// bootstrap is deterministic (same input → same CI) and signs correctly
{
  const a = bootstrapDeltaCI([0.1, 0.2, 0.3, 0.25, 0.15])
  const b = bootstrapDeltaCI([0.1, 0.2, 0.3, 0.25, 0.15])
  assert.deepEqual(a, b, 'deterministic seed → identical CI')
  assert.ok(a.lo > 0, 'an all-positive delta vector is significantly > 0')
  assert.equal(bootstrapDeltaCI([]).p, 1, 'empty → p=1')
}

// unscoreable (no checker score on any attempt) is skipped, not counted
{
  const noScore: RunRecord = {
    ts: '', benchmark: 'aec', instanceId: 'i', condition: 'random@4', model: 'm',
    blindResolved: false, resolved: false, infraError: false,
    attempts: [{ round: 0, prompt: '', output: 'x', costUsd: 0, tokensIn: 0, tokensOut: 0, eventCount: 0, eventTypes: {} }],
  }
  assert.equal(scoreVerifierSelectorOnRun(noScore), null)
  const r = summarizeVerifierSelector([noScore])
  assert.equal(r.n, 0)
  assert.equal(r.skipped, 1)
}

console.log('selector.test: all assertions passed')
