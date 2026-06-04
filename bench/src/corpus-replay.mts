/**
 * Offline replay / score substrate over the learning-flywheel corpus
 * (docs/learning-flywheel.md, layer 1: "an offline replay + reward-model layer so
 * the controller space can be searched WITHOUT a live rollout per candidate").
 *
 * Two jobs, both READ-ONLY against the corpus:
 *
 *   1. REPLAY - for each RunRecord, take the recorded FINAL output and either
 *      (a) recompute the structural verdict from the stored per-attempt verdicts
 *          (default, zero model tokens) - proves the corpus is structurally
 *          replayable: the stored `resolved` matches the stored attempt verdicts; or
 *      (b) re-run the benchmark's OWN judge on that final output (--judge) and
 *          compare to the recorded `resolved` - proves the corpus is FAITHFULLY
 *          replayable and surfaces judge nondeterminism. For router-LLM judges
 *          (finsearchcomp) this costs JUDGE calls but NOT agent rollouts - that is
 *          the entire point of the offline layer. Deterministic judges (hotpotqa)
 *          cost nothing.
 *
 *   2. scoreCandidateOffline - the typed seam a future offline controller-search
 *      (GEPA / meta-harness over the corpus) consumes to score an ALTERNATIVE
 *      controller's output against a recorded instance without re-running the agent.
 *
 * Run:
 *   tsx src/corpus-replay.mts [corpusPath] [BENCH=finsearchcomp] [--judge]
 *   tsx src/corpus-replay.mts [corpusPath] --selector [--condition=random]
 *
 * Fail-loud: an empty or unreadable corpus is an error, never a silent zero.
 */

import { readFile } from 'node:fs/promises'
import { argv } from 'node:process'
import { fileURLToPath } from 'node:url'
import type { BenchmarkAdapter, BenchScore, BenchTask } from './benchmarks/types'
import { ADAPTERS } from './adapters'
import type { RunRecord } from './corpus'
import { selfConsistencySelect, summarizeSelector } from './selector'

/** The benchmark's own judge - the EXTERNAL, write-only anchor (learning-flywheel.md). */
export type Judge = (task: BenchTask, artifact: string) => Promise<BenchScore>

/**
 * The recorded FINAL output of a controller-run: the last attempt that actually
 * produced an output. Returns undefined when no attempt produced one (every round
 * errored / blank) - the caller treats that as an unreplayable record, not a pass.
 */
export function finalOutput(record: RunRecord): string | undefined {
  for (let i = record.attempts.length - 1; i >= 0; i -= 1) {
    const out = record.attempts[i]?.output
    if (typeof out === 'string' && out.length > 0) return out
  }
  return undefined
}

/** The stored structural verdict for the final attempt (its `valid` flag). */
function storedFinalValid(record: RunRecord): boolean {
  for (let i = record.attempts.length - 1; i >= 0; i -= 1) {
    const a = record.attempts[i]
    if (a?.output !== undefined && a.output.length > 0) return a.valid === true
  }
  return false
}

/**
 * The OFFLINE SCORING SEAM. Score a counterfactual controller output against a
 * recorded instance by replaying the benchmark's own judge on it - NOT by
 * re-running the agent. This is how a future optimizer (GEPA / meta-harness over
 * the corpus) prices a candidate steer cheaply: it proposes an alternative final
 * answer for the recorded instance, calls this, and reads back {resolved, score}
 * at the cost of one judge call (zero for deterministic judges, zero agent
 * rollouts) instead of a full live k-attempt rollout.
 *
 * The judge is the EXTERNAL anchor: it scores the candidate output and never sees
 * the recorded outcome, so the score stays write-only (no oracle leakage).
 *
 * `record` supplies the instanceId the caller must resolve to a BenchTask (the
 * judge needs the task's gold/judge-template metadata); pass the SAME judge that
 * was used to score the corpus so offline and online scores are comparable.
 */
export async function scoreCandidateOffline(
  record: RunRecord,
  candidateOutput: string,
  judge: Judge,
  task: BenchTask,
): Promise<{ resolved: boolean; score: number }> {
  if (task.id !== record.instanceId) {
    throw new Error(
      `scoreCandidateOffline: task ${JSON.stringify(task.id)} does not match record.instanceId ${JSON.stringify(record.instanceId)}`,
    )
  }
  const verdict = await judge(task, candidateOutput)
  return { resolved: verdict.resolved === true, score: verdict.score }
}

/** Parse the corpus JSONL; fail loud on empty/unreadable. */
async function readCorpus(corpusPath: string): Promise<RunRecord[]> {
  let raw: string
  try {
    raw = await readFile(corpusPath, 'utf8')
  } catch (err) {
    throw new Error(
      `corpus-replay: cannot read corpus ${corpusPath}: ${err instanceof Error ? err.message : String(err)}\n` +
        `Run a bench loop first (it appends RunRecords), or pass an existing corpus path.`,
    )
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) throw new Error(`corpus-replay: corpus ${corpusPath} is empty - nothing to replay`)
  return lines.map((l, i) => {
    try {
      return JSON.parse(l) as RunRecord
    } catch (err) {
      throw new Error(`corpus-replay: corpus ${corpusPath} line ${i + 1} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
}

/**
 * Resolve every recorded instanceId for one benchmark to its BenchTask in a single
 * loadTasks call (the judge needs the task's gold/judge metadata). Fail loud when a
 * recorded instance is absent from the live/fixture dataset - that is corpus/dataset
 * drift, not a replayable record.
 */
async function loadTaskMap(adapter: BenchmarkAdapter, ids: string[]): Promise<Map<string, BenchTask>> {
  const tasks = await adapter.loadTasks({ ids })
  const byId = new Map<string, BenchTask>()
  for (const t of tasks) byId.set(t.id, t)
  return byId
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const reJudge = args.includes('--judge')
  const positional = args.filter((a) => !a.startsWith('--'))
  const corpusPath = positional[0] ?? '/home/drew/code/agent-runtime/bench/corpus/finsearch.jsonl'
  const benchOverride = positional[1] ?? process.env.BENCH

  const records = await readCorpus(corpusPath)

  // Group by benchmark so each adapter judges only its own records.
  const byBench = new Map<string, RunRecord[]>()
  for (const r of records) {
    const bench = benchOverride ?? r.benchmark
    const list = byBench.get(bench)
    if (list) list.push(r)
    else byBench.set(bench, [r])
  }

  // --selector: score a deployable, non-oracle selector OFFLINE over the corpus.
  // Each condition-run's k attempts are the candidates; the selector picks one by
  // OUTPUT TEXT only and the pick's stored verdict is its score (zero new calls).
  // Default to the random@k condition (independent attempts = the population where
  // "can a selector beat a blind random draw?" is the honest question).
  if (args.includes('--selector')) {
    const condArg = args.find((a) => a.startsWith('--condition='))
    const condFilter = condArg ? condArg.slice('--condition='.length) : 'random'
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`
    const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`
    let any = false
    for (const [bench, recs] of byBench) {
      const slice = recs.filter((r) => r.condition.includes(condFilter))
      if (slice.length === 0) continue
      any = true
      const rep = summarizeSelector(slice, selfConsistencySelect)
      console.log(
        `\n[${bench}] selector=self-consistency · condition~="${condFilter}" · n=${rep.n}` +
          (rep.skipped > 0 ? ` (${rep.skipped} unscoreable)` : ''),
      )
      console.log(`  blind    (pass@1):        ${pct(rep.blindRate)}`)
      console.log(`  random@k (control):       ${pct(rep.randomRate)}`)
      console.log(`  selector@k (deployable):  ${pct(rep.selectorRate)}`)
      console.log(`  oracle@k (ceiling):       ${pct(rep.oracleRate)}`)
      console.log(`  ► selector − random:  ${pp(rep.dVsRandom)}   ← Phase-1 gate: does picking beat a blind draw at equal k?`)
      console.log(`  ► oracle  − selector: ${pp(rep.gapToOracle)}   (ceiling left on the table)`)
    }
    if (!any) {
      const conds = [...new Set(records.map((r) => r.condition))]
      throw new Error(
        `corpus-replay --selector: no records match condition~="${condFilter}". Available conditions: ${conds.join(', ') || '(none)'}`,
      )
    }
    return
  }

  let totalRecords = 0
  let totalReplayable = 0
  let totalJudged = 0
  let totalAgree = 0

  for (const [bench, recs] of byBench) {
    const factory = ADAPTERS[bench]
    if (!factory) {
      throw new Error(
        `corpus-replay: no adapter for benchmark ${JSON.stringify(bench)} (have: ${Object.keys(ADAPTERS).join(', ')}). ` +
          `Add it to ADAPTERS or pass the correct BENCH override.`,
      )
    }
    const adapter = factory()

    // Replayable = has a recorded final output to re-score. Records where every
    // round errored / went blank carry no output and cannot be offline-scored.
    const replayable = recs.filter((r) => finalOutput(r) !== undefined)
    totalRecords += recs.length
    totalReplayable += replayable.length

    if (!reJudge) {
      // Default: recompute the STRUCTURAL verdict from stored attempt verdicts and
      // compare to record.resolved. Zero model tokens; proves the corpus's stored
      // outcome is internally consistent with its stored per-attempt verdicts.
      let structAgree = 0
      for (const r of replayable) {
        if (storedFinalValid(r) === (r.resolved === true)) structAgree += 1
      }
      const rate = replayable.length > 0 ? structAgree / replayable.length : 0
      console.log(
        `[${bench}] structural replay: replayable n=${replayable.length}/${recs.length}  ` +
          `stored-verdict<->resolved agreement ${(rate * 100).toFixed(1)}%  (${structAgree}/${replayable.length})`,
      )
      totalJudged += replayable.length
      totalAgree += structAgree
      continue
    }

    // --judge: preflight, resolve recorded instances -> BenchTask, re-run the judge
    // on each recorded final output, compare the replayed verdict to record.resolved.
    await adapter.preflight()
    const ids = [...new Set(replayable.map((r) => r.instanceId))]
    const taskMap = await loadTaskMap(adapter, ids)

    let agree = 0
    let judged = 0
    let missing = 0
    for (const r of replayable) {
      const out = finalOutput(r)
      if (out === undefined) continue // unreachable (replayable filter), kept explicit
      const task = taskMap.get(r.instanceId)
      if (!task) {
        missing += 1
        console.warn(`[${bench}] instance ${r.instanceId} not in dataset - corpus/dataset drift; skipping`)
        continue
      }
      const verdict = await adapter.judge(task, out)
      judged += 1
      if ((verdict.resolved === true) === (r.resolved === true)) agree += 1
    }
    const rate = judged > 0 ? agree / judged : 0
    console.log(
      `[${bench}] judge replay: re-judged n=${judged}/${replayable.length}  ` +
        `replayed<->recorded agreement ${(rate * 100).toFixed(1)}%  (${agree}/${judged})` +
        (missing > 0 ? `  [${missing} instance(s) absent from dataset]` : ''),
    )
    totalJudged += judged
    totalAgree += agree
  }

  const overall = totalJudged > 0 ? totalAgree / totalJudged : 0
  console.log('')
  console.log(
    `replayable n=${totalReplayable}/${totalRecords}  ` +
      `${reJudge ? 'replayed<->recorded' : 'stored-verdict<->resolved'} agreement ${(overall * 100).toFixed(1)}%  ` +
      `(${totalAgree}/${totalJudged})${reJudge ? '' : '  [--judge to re-run the real judge]'}`,
  )
  console.log(
    'note: this is the offline replay/score substrate the controller-search ' +
      '(GEPA / meta-harness over the corpus) consumes - scoreCandidateOffline() lets it ' +
      'price a candidate steer with one judge call (zero agent rollouts) against a recorded instance.',
  )
}

// Run the CLI only when invoked directly (tsx src/corpus-replay.mts ...), so the
// scoreCandidateOffline seam can be imported as a library without firing main().
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  await main()
}
