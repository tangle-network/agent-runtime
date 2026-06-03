import assert from 'node:assert/strict'
import { randomAtK, summarizeCompare } from './compare-decomp'

// randomAtK = expected pass of a uniform-random pick among k bare shots.
assert.equal(randomAtK(0, 3), 0)
assert.equal(randomAtK(3, 3), 1)
assert.equal(randomAtK(2, 4), 0.5)
assert.equal(randomAtK(1, 0), 0, 'k=0 must not divide-by-zero')

// THE regression this fix exists to catch: a benchmark where extra compute helps
// but steering adds nothing. blind=4/10, random@k=7/10, refine=7/10. The old
// "refine − blind" reports +30pp and calls it steering; the truth is +30pp compute,
// 0pp steering. dSteer must be exactly 0.
{
  const rep = summarizeCompare({ n: 10, blind: 4, randomExp: 7, oracle: 8, refine: 7 })
  assert.equal(rep.blindRate, 0.4)
  assert.equal(rep.randomRate, 0.7)
  assert.equal(rep.refineRate, 0.7)
  assert.ok(Math.abs(rep.dCompute - 0.3) < 1e-9, 'Δcompute = random − blind = +30pp')
  assert.equal(rep.dSteer, 0, 'Δsteer must be 0 when refine == random@k — the confound the fix removes')
  // the naive (refine − blind) would have been +30pp, all of it compute
  assert.ok(Math.abs((rep.refineRate - rep.blindRate) - 0.3) < 1e-9)
}

// Real positive steering: refine beats the equal-k control.
{
  const rep = summarizeCompare({ n: 10, blind: 4, randomExp: 6, oracle: 8, refine: 8 })
  assert.ok(rep.dSteer > 0, 'refine > random@k → positive steering effect')
  assert.ok(Math.abs(rep.dSteer - 0.2) < 1e-9)
}

// Negative steering (the rung-0 shape): refine LOSES to the equal-k control.
{
  const rep = summarizeCompare({ n: 40, blind: 16, randomExp: 25, oracle: 30, refine: 19 })
  assert.ok(rep.dCompute > 0, 'more compute still helps')
  assert.ok(rep.dSteer < 0, 'steering can be net-negative even when refine > blind')
}

// Decomposition is exact: Δcompute + Δsteer == refine − blind, always.
{
  const rep = summarizeCompare({ n: 7, blind: 2, randomExp: 3.5, oracle: 5, refine: 4 })
  assert.ok(Math.abs(rep.dCompute + rep.dSteer - (rep.refineRate - rep.blindRate)) < 1e-9)
}

// Empty run: no NaNs.
{
  const rep = summarizeCompare({ n: 0, blind: 0, randomExp: 0, oracle: 0, refine: 0 })
  assert.equal(rep.dSteer, 0)
  assert.equal(rep.refineRate, 0)
}

console.log('compare-decomp.test: all assertions passed')
