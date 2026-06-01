/**
 * Evolve measurement: verdict robustness of attributeSteer under NOISY validator
 * scores. Real validator/judge scores jitter; if the driver/worker decision
 * margin sits inside that noise, the verdict flips run-to-run and the loop
 * mis-steers. This measures, over a labeled scenario population:
 *
 *   - flipRate   : noisy verdict calls the OPPOSITE decisive side (driver↔worker)
 *                  — the dangerous error (sends the loop the wrong way)
 *   - abstainRate: verdict goes 'mixed'/'inconclusive' when truth is decisive
 *                  — the safe error (loop just gets no strong signal)
 *   - correctRate: noisy verdict matches the noiseless (true) decisive label
 *
 * Levers: `margin` (↑ fewer flips, ↑ abstains) and `reps` (average K re-dispatches,
 * shrinks noise ~√K — strictly better, costs K× worker runs). Goal: minimize
 * flipRate on held-out scenarios at acceptable abstain/cost.
 *
 * Deterministic per seed (seeded RNG); reps over master seeds give variance.
 */
import { attributeSteer } from '../dist/loops.js'

const SIGMA = Number(process.env.SIGMA ?? 0.1) // validator score noise (std dev)
const POP = Number(process.env.POP ?? 400) // scenarios per population
const SEEDS = [1, 2, 3, 4, 5] // master seeds → reps for variance

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
function gaussian(rng) {
  const u = Math.max(1e-9, rng())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

// One labeled scenario. trueGap = driverShare_true − workerShare_true spread
// across [-0.45, 0.45] so the population spans easy → near-boundary cases.
function makeScenario(rng) {
  const actual = 0.15 + rng() * 0.2 // [0.15, 0.35]
  const trueGap = (rng() * 2 - 1) * 0.45
  // trueGap = 2*best − actual − 1  ⇒  best = (trueGap + actual + 1)/2
  const best = clamp01((trueGap + actual + 1) / 2)
  const label = trueGap > 0 ? 'driver' : 'worker'
  // Best steer + two lower decoys (under noise a decoy can occasionally win).
  const steers = [
    { trueScore: best },
    { trueScore: clamp01(best - 0.15 - rng() * 0.1) },
    { trueScore: clamp01(best - 0.3 - rng() * 0.1) },
  ]
  return { actual, steers, label, gap: Math.abs(trueGap) }
}

const output = {
  parse(events) {
    const d = events.at(-1)?.data
    return { score: typeof d?.score === 'number' ? d.score : 0 }
  },
}
const validator = { async validate(o) { return { valid: o.score >= 0.7, score: o.score } } }
const spec = { profile: { name: 'w' }, name: 'w', taskToPrompt: (t) => JSON.stringify(t) }

// Fake worker: yields the steer's TRUE score corrupted by gaussian noise. Each
// call advances the shared rng, so reps see independent samples.
function noisyClient(rng, sigma) {
  return {
    async create() {
      return {
        async *streamPrompt(message) {
          const t = JSON.parse(message)
          yield { type: 'result', data: { score: clamp01(t.trueScore + sigma * gaussian(rng)) } }
        },
      }
    },
  }
}

async function measure(seed, { margin, reps, sigma }) {
  const rng = mulberry32(seed)
  const client = noisyClient(rng, sigma)
  let flip = 0
  let abstain = 0
  let correct = 0
  for (let i = 0; i < POP; i += 1) {
    const sc = makeScenario(rng)
    const attr = await attributeSteer({
      client,
      spec,
      output,
      validator,
      iteration: { index: 1, verdict: { valid: false, score: sc.actual } },
      counterfactualSteers: sc.steers,
      margin,
      reps,
      maxConcurrency: 8,
    })
    const v = attr.verdict
    if (v === 'mixed' || v === 'inconclusive') abstain += 1
    else if (
      (sc.label === 'driver' && v === 'driver-attributable') ||
      (sc.label === 'worker' && v === 'worker-attributable')
    )
      correct += 1
    else flip += 1
  }
  return { flipRate: flip / POP, abstainRate: abstain / POP, correctRate: correct / POP }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const rng3 = (x) => x.toFixed(3)

async function sweepCell(seeds, cfg) {
  const runs = []
  for (const s of seeds) runs.push(await measure(s, cfg))
  const flips = runs.map((r) => r.flipRate)
  return {
    flip: median(flips),
    flipRange: [Math.min(...flips), Math.max(...flips)],
    abstain: median(runs.map((r) => r.abstainRate)),
    correct: median(runs.map((r) => r.correctRate)),
  }
}

const TRAIN = SEEDS
const HOLDOUT = SEEDS.map((s) => s + 100) // disjoint seed set

const GRID = []
for (const reps of [1, 3]) for (const margin of [0.0, 0.05, 0.1, 0.15, 0.2]) GRID.push({ margin, reps, sigma: SIGMA })

console.log(`attribution verdict robustness — σ=${SIGMA}, POP=${POP}, reps×seeds for variance\n`)
console.log('TRAIN (median over 5 seeds):')
console.log('reps margin | flipRate (range)      abstain  correct')
const trainResults = []
for (const cfg of GRID) {
  const r = await sweepCell(TRAIN, cfg)
  trainResults.push({ cfg, r })
  console.log(
    `  ${cfg.reps}   ${rng3(cfg.margin)} | ${rng3(r.flip)} [${rng3(r.flipRange[0])},${rng3(r.flipRange[1])}]   ${rng3(r.abstain)}    ${rng3(r.correct)}`,
  )
}

// Cost J = flipRate + 0.25·abstainRate: a dangerous mis-steer (flip) costs 4× a
// safe abstain. Pick the config minimizing J on TRAIN; tiebreak lower reps (cost).
const cost = (r) => r.flip + 0.25 * r.abstain
const best = [...trainResults].sort(
  (a, b) => cost(a.r) - cost(b.r) || a.cfg.reps - b.cfg.reps || a.cfg.margin - b.cfg.margin,
)[0]
const baseline = trainResults.find((t) => t.cfg.margin === 0.05 && t.cfg.reps === 1)

console.log(`\nBASELINE (margin=0.05, reps=1): flip=${rng3(baseline.r.flip)} abstain=${rng3(baseline.r.abstain)} correct=${rng3(baseline.r.correct)}`)
console.log(`BEST on train: margin=${best.cfg.margin} reps=${best.cfg.reps} → flip=${rng3(best.r.flip)} abstain=${rng3(best.r.abstain)} correct=${rng3(best.r.correct)}`)

// Validate the chosen config + baseline on the disjoint HOLDOUT seeds.
const bestHold = await sweepCell(HOLDOUT, best.cfg)
const baseHold = await sweepCell(HOLDOUT, baseline.cfg)
console.log(`\nHOLDOUT (disjoint seeds):`)
console.log(`  baseline m=0.05 r=1: flip=${rng3(baseHold.flip)} abstain=${rng3(baseHold.abstain)} correct=${rng3(baseHold.correct)}`)
console.log(`  best     m=${best.cfg.margin} r=${best.cfg.reps}: flip=${rng3(bestHold.flip)} abstain=${rng3(bestHold.abstain)} correct=${rng3(bestHold.correct)}`)
const flipDelta = baseHold.flip - bestHold.flip
console.log(`\nHOLDOUT flip-rate reduction (baseline − best): ${rng3(flipDelta)} (${rng3((flipDelta / Math.max(1e-9, baseHold.flip)) * 100)}% fewer mis-steers)`)
