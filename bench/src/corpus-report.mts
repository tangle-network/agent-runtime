/**
 * Cross-benchmark corpus analysis instrument (docs/learning-flywheel.md - the
 * "corpus" + "measurement" layers).
 *
 * The corpus (one JSONL RunRecord per condition-run) is the flywheel's only durable
 * asset. This reads it back and reports, GROUPED BY benchmark x condition, the
 * numbers the doc says must hold before any rung is "earned":
 *
 *   1. resolve rate (resolved/n) + blind rate (blindResolved/n) per condition.
 *   2. the ABLATION / per-level lift, computed PAIRED across instanceIds present in
 *      BOTH conditions:
 *        more-compute effect = random@k_rate - blind_rate
 *        steering effect     = refineX@k_rate - random@k_rate   (per refine directive)
 *   3. a 95% PAIRED BOOTSTRAP CI on each lift (mulberry32 resample of instanceIds -
 *      same approach as analyze-paired.mts), with discordant-pair count (power scales
 *      with it, not with n).
 *   4. the MULTI-OBJECTIVE / clean-trace axis per condition: attempts-to-resolve,
 *      total tokens, costUsd, total eventCount - so we see correct-AND-clean, not just
 *      "did it resolve" (the doc's Pareto axis).
 *   5. honest caveats: n per group, infra-errored excluded, small n -> wide CI.
 *
 * Fails loud on an empty/unreadable corpus - a silent zero would feed the flywheel noise.
 *
 *   tsx src/corpus-report.mts [corpusPathOrDirOrGlob ...]
 *     default: bench/corpus/finsearch.jsonl
 *     accepts files, directories (merges every *.jsonl under them), and globs.
 */
import { readFile, stat } from 'node:fs/promises'
import { glob } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { RunRecord, AttemptRecord } from './corpus.ts'

const DEFAULT_CORPUS = resolve(import.meta.dirname, '..', 'corpus', 'finsearch.jsonl')
const BOOTSTRAP_N = Number(process.env.BOOTSTRAP_N ?? 10000)

// -- corpus loading -------------------------------------------------------------

/** Resolve CLI args (files / dirs / globs) to a deduped, ordered list of .jsonl files. */
async function resolveCorpusFiles(args: string[]): Promise<string[]> {
  const inputs = args.length > 0 ? args : [DEFAULT_CORPUS]
  const found = new Set<string>()
  for (const raw of inputs) {
    const looksGlob = raw.includes('*') || raw.includes('?') || raw.includes('[')
    if (looksGlob) {
      for await (const m of glob(raw)) found.add(resolve(m))
      continue
    }
    const abs = resolve(raw)
    const info = await stat(abs).catch(() => undefined)
    if (info === undefined) {
      throw new Error(`corpus path does not exist: ${abs}`)
    }
    if (info.isDirectory()) {
      for await (const m of glob('**/*.jsonl', { cwd: abs })) found.add(resolve(abs, m))
    } else {
      found.add(abs)
    }
  }
  return [...found].sort()
}

/** Parse one JSONL file into RunRecords. Throws on a malformed line - corrupt fuel
 *  must surface, never be silently skipped. */
async function loadFile(file: string): Promise<RunRecord[]> {
  const text = await readFile(file, 'utf8')
  const out: RunRecord[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined || line.trim() === '') continue
    let rec: unknown
    try {
      rec = JSON.parse(line)
    } catch (err) {
      throw new Error(`malformed JSONL at ${file}:${i + 1}: ${(err as Error).message}`)
    }
    const r = rec as Partial<RunRecord>
    if (typeof r.benchmark !== 'string' || typeof r.instanceId !== 'string' || typeof r.condition !== 'string') {
      throw new Error(`not a RunRecord at ${file}:${i + 1} (missing benchmark/instanceId/condition)`)
    }
    out.push(rec as RunRecord)
  }
  return out
}

// -- deduplication: one record per (benchmark, instance, condition) --------------

/** Collapse multiple records for the same (benchmark, instance, condition) to the
 *  LATEST by ts. We keep the latest rather than averaging because resolved/blind are
 *  booleans (a mean would silently fabricate a fractional outcome the judge never
 *  emitted); the clean-trace cost axis below uses that same latest record so every
 *  reported number comes from one real run. Returns the kept records + how many were
 *  superseded (reported in caveats). */
function dedupeLatest(records: RunRecord[]): { kept: RunRecord[]; superseded: number } {
  const byKey = new Map<string, RunRecord>()
  let superseded = 0
  for (const r of records) {
    const key = `${r.benchmark}	${r.instanceId}	${r.condition}`
    const prev = byKey.get(key)
    if (prev === undefined) {
      byKey.set(key, r)
    } else {
      superseded += 1
      // ts is an ISO string; lexical compare is chronological for ISO-8601.
      if (r.ts > prev.ts) byKey.set(key, r)
    }
  }
  return { kept: [...byKey.values()], superseded }
}

// -- clean-trace (multi-objective) aggregation ----------------------------------

interface CleanTrace {
  /** Mean rounds until the FIRST valid attempt, over resolved runs only (NaN if none). */
  meanAttemptsToResolve: number
  meanTotalTokens: number
  meanCostUsd: number
  meanEventCount: number
  /** runs that contributed to meanAttemptsToResolve (resolved runs). */
  resolvedRuns: number
}

/** Rounds (1-based) until the first valid attempt, or undefined if none was valid. */
function attemptsToResolve(attempts: AttemptRecord[]): number | undefined {
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i]?.valid === true) return i + 1
  }
  return undefined
}

function sumAttempts(attempts: AttemptRecord[], pick: (a: AttemptRecord) => number): number {
  return attempts.reduce((s, a) => s + pick(a), 0)
}

function cleanTrace(records: RunRecord[]): CleanTrace {
  const n = records.length
  let tokens = 0
  let cost = 0
  let events = 0
  const resolveRounds: number[] = []
  for (const r of records) {
    tokens += sumAttempts(r.attempts, (a) => a.tokensIn + a.tokensOut)
    cost += sumAttempts(r.attempts, (a) => a.costUsd)
    events += sumAttempts(r.attempts, (a) => a.eventCount)
    const atr = attemptsToResolve(r.attempts)
    if (atr !== undefined) resolveRounds.push(atr)
  }
  const meanOf = (xs: number[]) => (xs.length === 0 ? Number.NaN : xs.reduce((s, x) => s + x, 0) / xs.length)
  return {
    meanAttemptsToResolve: meanOf(resolveRounds),
    meanTotalTokens: n === 0 ? Number.NaN : tokens / n,
    meanCostUsd: n === 0 ? Number.NaN : cost / n,
    meanEventCount: n === 0 ? Number.NaN : events / n,
    resolvedRuns: resolveRounds.length,
  }
}

// -- paired bootstrap CI (mulberry32, identical recipe to analyze-paired.mts) ----

interface PairedLift {
  point: number
  low: number
  high: number
  median: number
  significant: boolean
  /** instanceIds present in BOTH conditions. */
  pairs: number
  /** pairs where the two conditions' outcomes differ - power scales with this. */
  discordant: number
}

/** Deterministic mulberry32 - Math.imul, no >2^53 overflow (a naive LCG gives
 *  degenerate [0,0] CIs). Seeded constant for reproducible CIs across runs. */
function makeRng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Paired lift = mean over shared instances of (treatmentOutcome - baselineOutcome),
 *  with a 95% bootstrap CI from resampling the SHARED instances (the paired unit). */
function pairedLift(
  baseline: Map<string, number>,
  treatment: Map<string, number>,
): PairedLift | undefined {
  const ids: string[] = []
  for (const id of treatment.keys()) if (baseline.has(id)) ids.push(id)
  ids.sort()
  const n = ids.length
  if (n === 0) return undefined
  const deltas = ids.map((id) => (treatment.get(id) as number) - (baseline.get(id) as number))
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  const point = mean(deltas)
  const discordant = deltas.filter((d) => d !== 0).length
  const rng = makeRng(0x9e3779b9)
  const rint = (m: number) => Math.floor(rng() * m)
  const boots: number[] = []
  for (let b = 0; b < BOOTSTRAP_N; b++) {
    let acc = 0
    for (let j = 0; j < n; j++) acc += deltas[rint(n)] as number
    boots.push(acc / n)
  }
  boots.sort((x, y) => x - y)
  const low = boots[Math.floor(0.025 * BOOTSTRAP_N)] ?? Number.NaN
  const high = boots[Math.floor(0.975 * BOOTSTRAP_N)] ?? Number.NaN
  const median = boots[Math.floor(0.5 * BOOTSTRAP_N)] ?? Number.NaN
  // Significant iff the CI excludes 0 on the side matching the point estimate's sign.
  const significant = point > 0 ? low > 0 : point < 0 ? high < 0 : false
  return { point, low, high, median, significant, pairs: n, discordant }
}

// -- formatting ------------------------------------------------------------------

const pct = (x: number) => (Number.isNaN(x) ? '  n/a' : `${(x * 100).toFixed(1)}%`)
const pp = (x: number) => (Number.isNaN(x) ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`)
const num = (x: number, d = 2) => (Number.isNaN(x) ? 'n/a' : x.toFixed(d))

function printLift(label: string, lift: PairedLift | undefined): void {
  if (lift === undefined) {
    console.log(`    ${label.padEnd(34)} - (no shared instances)`)
    return
  }
  const verdict = lift.significant ? 'SIGNIFICANT' : 'spans 0'
  console.log(
    `    ${label.padEnd(34)} ${pp(lift.point).padStart(7)}  95% CI [${pp(lift.low)}, ${pp(lift.high)}] median ${pp(lift.median)}  ${verdict}  (paired ${lift.pairs}, discordant ${lift.discordant})`,
  )
}

// -- main ----------------------------------------------------------------------

/** A condition label "refineHand@4" / "random@4" -> its family ("refineHand"/"random")
 *  and a stable sort rank (blind-most-control -> most-steered). */
function conditionFamily(condition: string): string {
  const at = condition.indexOf('@')
  return at >= 0 ? condition.slice(0, at) : condition
}

async function main(): Promise<void> {
  const files = await resolveCorpusFiles(process.argv.slice(2))
  if (files.length === 0) {
    throw new Error('no corpus files resolved from the given paths')
  }
  const all: RunRecord[] = []
  for (const f of files) all.push(...(await loadFile(f)))
  if (all.length === 0) {
    throw new Error(`corpus is empty (0 RunRecords across ${files.length} file(s)): ${files.join(', ')}`)
  }

  const { kept, superseded } = dedupeLatest(all)

  console.log(`corpus-report - ${files.length} file(s), ${all.length} record(s) read, ${kept.length} after dedupe-to-latest`)
  for (const f of files) console.log(`  * ${f}`)
  console.log(`  bootstrap B=${BOOTSTRAP_N} (paired resample of shared instanceIds)`)

  // Group by benchmark, then condition.
  const benchmarks = new Map<string, RunRecord[]>()
  for (const r of kept) {
    const arr = benchmarks.get(r.benchmark) ?? []
    arr.push(r)
    benchmarks.set(r.benchmark, arr)
  }

  for (const benchmark of [...benchmarks.keys()].sort()) {
    const benchRecords = benchmarks.get(benchmark) as RunRecord[]
    console.log(`\n== benchmark: ${benchmark} ==`)

    // Partition into clean (analyzed) vs infra-errored (excluded but counted).
    const clean = benchRecords.filter((r) => r.infraError !== true)
    const erroredCount = benchRecords.length - clean.length

    const byCondition = new Map<string, RunRecord[]>()
    for (const r of clean) {
      const arr = byCondition.get(r.condition) ?? []
      arr.push(r)
      byCondition.set(r.condition, arr)
    }
    // Order conditions: random families first (compute control), then refine families.
    const conditions = [...byCondition.keys()].sort((a, b) => {
      const fa = conditionFamily(a)
      const fb = conditionFamily(b)
      const rank = (f: string) => (f.startsWith('random') ? 0 : f.startsWith('blind') ? -1 : 1)
      return rank(fa) - rank(fb) || a.localeCompare(b)
    })

    // (1) + (4): per-condition rates and clean-trace cost.
    console.log('  per-condition (resolve / blind rate * clean-trace cost):')
    for (const condition of conditions) {
      const recs = byCondition.get(condition) as RunRecord[]
      const n = recs.length
      const resolveRate = recs.filter((r) => r.resolved === true).length / n
      const blindRate = recs.filter((r) => r.blindResolved === true).length / n
      const ct = cleanTrace(recs)
      console.log(
        `    ${condition.padEnd(16)} n=${String(n).padStart(3)}  resolve ${pct(resolveRate)}  blind ${pct(blindRate)}`,
      )
      console.log(
        `      clean-trace: attempts->resolve ${num(ct.meanAttemptsToResolve, 2)} (over ${ct.resolvedRuns} resolved)  tokens ${num(ct.meanTotalTokens, 0)}  cost $${num(ct.meanCostUsd, 4)}  events ${num(ct.meanEventCount, 1)}`,
      )
    }

    // (2) + (3): the ablation - paired lifts with bootstrap CIs.
    // Outcome maps keyed by instanceId, per condition.
    const resolvedById = (recs: RunRecord[]) => {
      const m = new Map<string, number>()
      for (const r of recs) m.set(r.instanceId, r.resolved === true ? 1 : 0)
      return m
    }
    const blindById = (recs: RunRecord[]) => {
      const m = new Map<string, number>()
      for (const r of recs) m.set(r.instanceId, r.blindResolved === true ? 1 : 0)
      return m
    }

    // more-compute = random@k.resolved - random@k.blind (blind is iter0 of the SAME
    // random run, so the pairing is exact and perfectly matched).
    const randomConditions = conditions.filter((c) => conditionFamily(c).startsWith('random'))
    const refineConditions = conditions.filter((c) => conditionFamily(c).startsWith('refine'))

    console.log('  ablation (paired lift * 95% bootstrap CI):')
    if (randomConditions.length === 0) {
      console.log('    (no random@k condition - cannot isolate the compute control; lifts unmeasurable)')
    }
    for (const rc of randomConditions) {
      const recs = byCondition.get(rc) as RunRecord[]
      printLift(`more-compute (${rc} - blind)`, pairedLift(blindById(recs), resolvedById(recs)))
    }

    // steering = refineX@k.resolved - random@k.resolved, paired across shared instances.
    // Pair each refine condition against the random condition with the SAME @k suffix
    // when present, else the lone random condition.
    for (const refc of refineConditions) {
      const k = refc.slice(refc.indexOf('@'))
      const matchRandom =
        randomConditions.find((c) => c.endsWith(k)) ?? (randomConditions.length === 1 ? randomConditions[0] : undefined)
      if (matchRandom === undefined) {
        console.log(`    steering (${refc} - random?) - no matching random@k condition`)
        continue
      }
      const baseline = resolvedById(byCondition.get(matchRandom) as RunRecord[])
      const treatment = resolvedById(byCondition.get(refc) as RunRecord[])
      printLift(`steering (${refc} - ${matchRandom})`, pairedLift(baseline, treatment))
    }

    // (5) honest caveats for this benchmark.
    const totalN = clean.length
    const minCondN = conditions.length === 0 ? 0 : Math.min(...conditions.map((c) => (byCondition.get(c) as RunRecord[]).length))
    console.log('  caveats:')
    console.log(`    * clean records: ${totalN} across ${conditions.length} condition(s); smallest condition n=${minCondN}`)
    console.log(`    * infra-errored excluded: ${erroredCount}`)
    if (minCondN > 0 && minCondN < 20) {
      console.log(`    * small n (min ${minCondN}) -> wide CI; power scales with the discordant-pair count above, not n`)
    }
  }

  if (superseded > 0) {
    console.log(`\nnote: ${superseded} record(s) superseded by a later run for the same (benchmark, instance, condition) - kept the latest by ts`)
  }
}

main().catch((err) => {
  console.error(`corpus-report failed: ${(err as Error).message}`)
  process.exit(1)
})
