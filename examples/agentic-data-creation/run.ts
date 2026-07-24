/**
 * agentic-data-creation — the runnable offline demo + calibration.
 *
 * Wires the credentialless fixtures into `createDataCreationLoop`, manufactures discriminating
 * training examples from one grounding doc, and prints:
 *   1. each accepted example with its weak/strong solver scores and the gap,
 *   2. the CALIBRATION — does the gap metric actually separate? A plainly-generated (first-draft)
 *      example should show a SMALL gap; an agentic-loop-accepted one a LARGE gap (the illustrative target),
 *   3. the cost ledger, split by role (challenger vs each solver) — composed, never hand-counted.
 *
 * Run:  pnpm tsx examples/agentic-data-creation/run.ts
 */

import { createDataCreationLoop } from './agentic-data-creation'
import {
  baseInstruction,
  buildRubricJudge,
  challengerClient,
  groundingDoc,
  solverClient,
} from './offline-fixtures'

function mean(xs: number[]): number {
  return xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length
}

async function main(): Promise<void> {
  console.log('agentic-data-creation · manufacturing examples too hard for the weak solver\n')

  const result = await createDataCreationLoop({
    doc: groundingDoc,
    baseInstruction,
    challenger: challengerClient(),
    weakSolver: solverClient('weak'),
    strongSolver: solverClient('strong'),
    judge: buildRubricJudge(),
    target: 3,
    samples: 3,
    maxRetries: 4,
    // accept rule defaults to discriminativeAcceptRule at its paper thresholds
    // (strong >= 0.65, weak < 0.50, gap >= 0.20).
  })

  // 1. The accepted training set.
  console.log(`— Accepted examples (${result.accepted.length}/3 manufactured) —`)
  for (const [i, ex] of result.accepted.entries()) {
    console.log(`\n  [${i}] Q: ${ex.example.question}`)
    console.log(
      `      weak=${ex.weakScore.toFixed(2)}  strong=${ex.strongScore.toFixed(2)}  gap=${ex.gap.toFixed(2)}`,
    )
    console.log(`      ${ex.decision.reason}`)
  }

  // 2. The calibration — the gap metric must SEPARATE plain from agentic, or it is not a reward.
  const plain = mean(result.plainGaps)
  const agentic = mean(result.agenticGaps)
  console.log('\n— Calibration: does the gap metric discriminate? —')
  console.log(`  plain   (first-draft examples)  mean gap = ${plain.toFixed(2)}   (target ≈ 0.02)`)
  console.log(
    `  agentic (loop-accepted examples) mean gap = ${agentic.toFixed(2)}   (target ≈ 0.31)`,
  )
  const separates = Number.isFinite(plain) && Number.isFinite(agentic) && agentic - plain >= 0.15
  console.log(
    separates
      ? `  ✓ the accept rule separates (Δ=+${(agentic - plain).toFixed(2)}) — but these solvers are SCRIPTED, so this proves the wiring + that the rule discriminates by construction, NOT that the loop makes real data harder. The empirical gap (paper Table 1) needs the live run (real two-tier solvers); see README.`
      : `  ✗ does NOT separate (Δ=${(agentic - plain).toFixed(2)}) — the gap metric would be uninformative here.`,
  )

  // 3. Cost — runAgentRounds aggregated each worker loop; we rolled it into a CostLedger by role.
  const summary = result.cost.summary()
  console.log('\n— Cost (composed via CostLedger, not a hand-built counter) —')
  console.log(
    `  total: $${summary.totalCostUsd.toFixed(4)} over ${summary.totalCalls} recorded loops`,
  )
  for (const ch of summary.byChannel) {
    console.log(`    ${ch.channel.padEnd(14)} $${ch.costUsd.toFixed(4)}  (${ch.calls} loops)`)
  }
  const perTask = result.cost.costPerCompletedTask()
  if (perTask !== null) console.log(`  cost per accepted example: $${perTask.toFixed(4)}`)

  // 4. The corpus holds the accepted examples for a downstream trainer/consumer to read back.
  const stored = await result.corpus.query({ area: 'training-data' })
  console.log(`\n— Corpus —`)
  console.log(
    `  ${stored.length} accepted example(s) accreted into the corpus (area='training-data').`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
