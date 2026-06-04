// The beat-blind gate, as ONE command — the experiment that decides whether the
// diversification/selection surface (the one PR #145 defers to as "tracked separately")
// actually beats compute-matched best-of-N. Composes only LANDED pieces:
//   1. random@k corpus  — k identical-directive shots/instance (the compute control)
//   2. diverse@k corpus — k DIFFERENT strategy lenses/instance (DIVERSE=1; the bet)
//   3. selector replay  — selfConsistencySelect@k over each (corpus-replay --selector)
//   4. paired report    — bootstrap CI + Benjamini-Hochberg over both (corpus-report)
//
// The decomposition it yields:
//   random@k           = more-compute, no picking          (control)
//   selector@k (homog) = picking over IDENTICAL attempts   (#143: −8.2pp on the committed corpus)
//   diverse-selector@k = picking over DIVERSE attempts      (THE bet: does approach-diversity
//                        give self-consistency the signal identical attempts don't?)
// Beat-blind iff diverse-selector@k > random@k at significant n.
//
//   node diverse-gate.mjs            run it (generates corpora — a real worker run)
//   node diverse-gate.mjs --dry      print the plan only (no run; safe while another
//                                    sandbox run is live — zero router/sandbox contention)
//
// Knobs (env): BENCH (default hotpotqa) · N (default 30) · K (default 4) ·
//   RESEARCH=1 (local opencode, default) | SANDBOX=1 (prod sandbox web worker) · MODELS ·
//   DIVERSE_BASE (compose #145's GEPA-learned directive as the lens base — follow-on).

import { spawn } from 'node:child_process'

const DRY = process.argv.includes('--dry')
const BENCH = process.env.BENCH ?? 'hotpotqa'
const N = process.env.N ?? '30'
const K = process.env.K ?? '4'
const RANDOM_CORPUS = process.env.RANDOM_CORPUS ?? '/tmp/dg-random.jsonl'
const DIVERSE_CORPUS = process.env.DIVERSE_CORPUS ?? '/tmp/dg-diverse.jsonl'
// Worker-mode env passes through to batch-oracle unchanged (RESEARCH=1 / SANDBOX=1 / MODELS / TANGLE_API_KEY).
const passEnv = { ...process.env, BENCH, N, K }

const steps = [
  {
    label: 'random@k corpus (control — identical directive)',
    cmd: 'npx',
    args: ['tsx', 'src/run.ts', 'batch-oracle', N],
    env: { ...passEnv, CORPUS: RANDOM_CORPUS },
  },
  {
    label: 'diverse@k corpus (the bet — k distinct strategy lenses)',
    cmd: 'npx',
    args: ['tsx', 'src/run.ts', 'batch-oracle', N],
    env: { ...passEnv, CORPUS: DIVERSE_CORPUS, DIVERSE: '1' },
  },
  {
    label: 'selector@k over the CONTROL corpus (homogeneous)',
    cmd: 'npx',
    args: ['tsx', 'src/corpus-replay.mts', RANDOM_CORPUS, '--selector'],
    env: passEnv,
  },
  {
    label: 'selector@k over the DIVERSE corpus (the beat-blind number)',
    cmd: 'npx',
    // The diverse corpus records carry condition="diverse@4"; corpus-replay's
    // selector filter defaults to "random", so match the diverse condition here.
    args: ['tsx', 'src/corpus-replay.mts', DIVERSE_CORPUS, '--selector', '--condition=diverse'],
    env: passEnv,
  },
  {
    label: 'paired bootstrap CI + Benjamini-Hochberg over both corpora',
    cmd: 'npx',
    args: ['tsx', 'src/corpus-report.mts', RANDOM_CORPUS, DIVERSE_CORPUS],
    env: passEnv,
  },
]

const shellPreview = (s) => {
  const envStr = Object.entries(s.env)
    .filter(([k]) => ['BENCH', 'N', 'K', 'CORPUS', 'DIVERSE', 'RESEARCH', 'SANDBOX', 'MODELS'].includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  return `  ${envStr} ${s.cmd} ${s.args.join(' ')}`.replace(/\s+/g, ' ')
}

function runStep(s) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ ${s.label}`)
    const child = spawn(s.cmd, s.args, { cwd: process.cwd(), env: s.env, stdio: 'inherit' })
    child.on('error', reject)
    // Fail loud: a non-zero step aborts the gate (no silent partial result).
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${s.label} exited ${code}`))))
  })
}

async function main() {
  console.log(`=== beat-blind gate · BENCH=${BENCH} N=${N} K=${K} ${DRY ? '(DRY — plan only)' : ''} ===`)
  if (DRY) {
    console.log('plan (no run — zero sandbox/router contention):')
    for (const s of steps) console.log(shellPreview(s))
    console.log(
      '\nbeat-blind iff diverse-selector@k > random@k at significant n.' +
        '\nDIVERSE_BASE=<file> composes #145\'s GEPA-learned directive as the lens base (follow-on).',
    )
    return
  }
  for (const s of steps) await runStep(s)
  console.log(
    '\n=== read the gate ===\n' +
      `  random@k (control)        — from ${RANDOM_CORPUS} replay\n` +
      `  selector@k (homogeneous)  — same corpus, the pick (#143: −8.2pp on committed finsearch)\n` +
      `  diverse-selector@k        — ${DIVERSE_CORPUS} replay: THE bet\n` +
      '  beat-blind iff diverse-selector@k > random@k, significant per the BH report above.',
  )
}

main().catch((err) => {
  console.error(`diverse-gate: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
