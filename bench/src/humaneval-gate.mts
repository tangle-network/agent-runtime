/**
 * HumanEval deployable-verifier gate — the thesis test the answer-oracle benches
 * (aec-bench, finsearch) could not reach.
 *
 * The repo's deployable self-consistency selector LOSES on both aec-bench (−9.4pp)
 * and finsearch (−8.2pp): diversity opens a large ORACLE ceiling, but the selector
 * cannot capture it because those benches verify by RECOMPUTING the gold answer (an
 * oracle, not a deployable check). Code+tests is the deployable-checker regime — the
 * agent runs the task's provided tests (which it legitimately has in production) and
 * keeps a passer. This file asks: at EQUAL k, does diverse@k + a deployable
 * verifier-grounded pick beat random@k + the same pick, and beat blind@1?
 *
 * Two paired arms over the SAME tasks:
 *   random@K  — K identical-base-prompt shots/task (the compute control)
 *   diverse@K — K shots, the i-th prefixed with composeStrategies(base, K)[i]
 *
 * The DEPLOYABLE CHECKER runs each candidate against the task's own `test` in an
 * isolated `--network=none` python:3.12-slim container (hard timeout) — exit 0 = pass.
 * No gold `canonical_solution` is ever shown to the model or the selector.
 *
 * Metrics (paired across the same tasks):
 *   blind pass@1       — first attempt passes
 *   random-pass@k      — verifierGroundedSelect over the K random shots passes
 *   diverse-pass@k     — verifierGroundedSelect over the K diverse shots passes
 *   oracle@k           — any of the K passes (the ceiling)
 *   self-consistency@k — selfConsistencySelect (answer-clustering, NOT the checker)
 *                        over the diverse shots — the direct contrast with the
 *                        −8/−9pp answer-oracle selector.
 * Each delta carries a 95% paired-bootstrap CI.
 *
 *   N=20 K=4 npx tsx src/humaneval-gate.mts
 */

import { gunzipSync } from 'node:zlib'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { composeStrategies } from './directives'
import { type RouterConfig, routerChatWithUsage } from './router-client'
import { selfConsistencySelect, verifierGroundedSelect } from './selector'

const HUMANEVAL_URL = 'https://github.com/openai/human-eval/raw/master/data/HumanEval.jsonl.gz'
const dockerImage = 'python:3.12-slim'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

interface HumanEvalTask {
  taskId: string
  prompt: string
  test: string
  entryPoint: string
}

/** Pull the 164-task HumanEval JSONL.gz and parse it. Fail loud on a non-OK fetch
 *  or a malformed line — a silently-short task set would poison the gate. `offset`
 *  selects a deeper slice (the later tasks are harder) so the worker has a
 *  correctable middle band rather than a saturated easy prefix. */
async function loadHumanEval(limit: number, offset: number): Promise<HumanEvalTask[]> {
  const res = await fetch(HUMANEVAL_URL)
  if (!res.ok) throw new Error(`HumanEval fetch HTTP ${res.status}: ${HUMANEVAL_URL}`)
  const gz = Buffer.from(await res.arrayBuffer())
  const text = gunzipSync(gz).toString('utf8')
  const tasks: HumanEvalTask[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const d = JSON.parse(line) as {
      task_id?: string
      prompt?: string
      test?: string
      entry_point?: string
    }
    if (!d.task_id || !d.prompt || !d.test || !d.entry_point) {
      throw new Error(`malformed HumanEval record: ${line.slice(0, 120)}`)
    }
    tasks.push({ taskId: d.task_id, prompt: d.prompt, test: d.test, entryPoint: d.entry_point })
  }
  if (tasks.length === 0) throw new Error('HumanEval parsed to 0 tasks')
  if (offset >= tasks.length) throw new Error(`OFFSET ${offset} >= dataset size ${tasks.length}`)
  return tasks.slice(offset, offset + limit)
}

const SOLVE_INSTRUCTION =
  'Complete the following Python function. Output the COMPLETE function definition (signature, docstring optional, body) inside a single ```python code block. Include any imports the function needs. Do not write tests or example calls.'

function basePrompt(task: HumanEvalTask): string {
  return `${SOLVE_INSTRUCTION}\n\n\`\`\`python\n${task.prompt}\`\`\``
}

/** Extract the function source from a model reply: prefer a fenced ```python (or
 *  bare ```) block, else fall back to the raw text. The deployable program adds the
 *  prompt header (imports + signature context), so a candidate that returns only a
 *  body still runs; a candidate that re-defines the function shadows the header. */
function extractCode(reply: string): string {
  const fenced = reply.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
  if (fenced && typeof fenced[1] === 'string') return fenced[1].trim()
  return reply.trim()
}

/** The deployable test program: the prompt header (imports + signature/docstring the
 *  model was given), then the candidate (its def shadows the header's stub), then the
 *  task's own check() suite and the call. No gold solution anywhere. */
function buildProgram(task: HumanEvalTask, candidate: string): string {
  return `${task.prompt}\n${candidate}\n\n${task.test}\n\ncheck(${task.entryPoint})\n`
}

const dockerTimeoutMs = Number(process.env.DOCKER_TIMEOUT_MS ?? 20000)

interface CheckResult {
  /** {0,1} pass-count for this candidate (1 = the check() suite passed). */
  pass: number
}

/** Run one candidate's deployable test program in an isolated container:
 *  `docker run --rm --network=none -v <tmp>:/w -w /w <img> python /w/p.py`.
 *  Exit 0 → pass. A docker invocation error (binary missing, daemon down, image
 *  pull failure) is NOT a test failure — it throws so the harness fails loud rather
 *  than scoring every candidate 0 from a broken checker. */
function runChecker(task: HumanEvalTask, candidate: string): Promise<CheckResult> {
  const dir = mkdtempSync(join(tmpdir(), 'hev-'))
  writeFileSync(join(dir, 'p.py'), buildProgram(task, candidate))
  return new Promise<CheckResult>((resolvePromise, reject) => {
    execFile(
      'docker',
      [
        'run',
        '--rm',
        '--network=none',
        '--cpus=1',
        '--memory=512m',
        '-v',
        `${dir}:/w:ro`,
        '-w',
        '/w',
        dockerImage,
        'python',
        '/w/p.py',
      ],
      { timeout: dockerTimeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        rmSync(dir, { recursive: true, force: true })
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string }
          // ENOENT = docker binary missing; a daemon/connect failure surfaces in
          // stderr. These are infra failures, not a failed test — fail loud.
          if (e.code === 'ENOENT') {
            reject(new Error('docker binary not found on PATH — cannot run the deployable checker'))
            return
          }
          if (/cannot connect to the docker daemon|is the docker daemon running|permission denied while trying to connect/i.test(stderr)) {
            reject(new Error(`docker daemon unreachable: ${stderr.slice(0, 200)}`))
            return
          }
          if (/(unable to find image|pull access denied|manifest unknown|error response from daemon).*(pull|repository|registry)/i.test(stderr)) {
            reject(new Error(`docker image ${dockerImage} unavailable: ${stderr.slice(0, 200)}`))
            return
          }
          // killed-by-timeout or a non-zero exit from python (assert failure / error)
          // are genuine test FAILURES — score 0, do not throw.
          resolvePromise({ pass: 0 })
          return
        }
        resolvePromise({ pass: 1 })
      },
    )
  })
}

/** Bounded-concurrency pool: at most `limit` of `fn` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const idx = next
      next += 1
      if (idx >= items.length) return
      results[idx] = await fn(items[idx] as T, idx)
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker())
  await Promise.all(workers)
  return results
}

interface Attempt {
  code: string
  pass: number
}

interface TaskOutcome {
  taskId: string
  randomAttempts: Attempt[]
  diverseAttempts: Attempt[]
}

/** mulberry32 — deterministic, Math.imul (matches corpus-report's CI engine). */
function makeRng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface PairedLift {
  point: number
  low: number
  high: number
  pairs: number
  discordant: number
}

/** Paired lift = mean over tasks of (treatment − baseline), with a 95% bootstrap CI
 *  from resampling the paired tasks. Inputs are aligned {0,1} per-task outcomes. */
function pairedLift(baseline: number[], treatment: number[], bootstrapN = 10000): PairedLift {
  if (baseline.length !== treatment.length) throw new Error('pairedLift: misaligned arms')
  const n = baseline.length
  if (n === 0) throw new Error('pairedLift: no pairs')
  const deltas = baseline.map((b, i) => (treatment[i] as number) - b)
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  const point = mean(deltas)
  const discordant = deltas.filter((d) => d !== 0).length
  const rng = makeRng(0x9e3779b9)
  const rint = (m: number) => Math.floor(rng() * m)
  const boots: number[] = []
  for (let b = 0; b < bootstrapN; b += 1) {
    let acc = 0
    for (let j = 0; j < n; j += 1) acc += deltas[rint(n)] as number
    boots.push(acc / n)
  }
  boots.sort((x, y) => x - y)
  return {
    point,
    low: boots[Math.floor(0.025 * bootstrapN)] ?? Number.NaN,
    high: boots[Math.floor(0.975 * bootstrapN)] ?? Number.NaN,
    pairs: n,
    discordant,
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 20)
  const k = Number(process.env.K ?? 4)
  const offset = Number(process.env.OFFSET ?? 0)
  const model = process.env.WORKER_MODEL ?? 'gpt-5'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const solveConcurrency = Number(process.env.CONCURRENCY ?? 8)
  const dockerConcurrency = Number(process.env.DOCKER_CONCURRENCY ?? 6)

  if (!Number.isInteger(n) || n < 1) throw new Error(`N must be a positive integer, got ${process.env.N}`)
  if (!Number.isInteger(k) || k < 1) throw new Error(`K must be a positive integer, got ${process.env.K}`)
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`OFFSET must be a non-negative integer, got ${process.env.OFFSET}`)

  const cfg: RouterConfig = { routerBaseUrl, routerKey, model }

  console.log(`=== HumanEval deployable-verifier gate · N=${n} K=${k} offset=${offset} model=${model} ===`)
  console.log(`  router=${routerBaseUrl}  docker=${dockerImage} (--network=none, timeout ${dockerTimeoutMs}ms)`)

  const tasks = await loadHumanEval(n, offset)
  console.log(`loaded ${tasks.length} HumanEval task(s): ${tasks.map((t) => t.taskId).join(', ')}`)

  // Build the full work set: per task, K random + K diverse solve calls.
  type Unit = { taskIdx: number; arm: 'random' | 'diverse'; shot: number; prompt: string }
  const units: Unit[] = []
  for (let ti = 0; ti < tasks.length; ti += 1) {
    const task = tasks[ti] as HumanEvalTask
    const base = basePrompt(task)
    const diverse = composeStrategies(base, k)
    for (let s = 0; s < k; s += 1) {
      units.push({ taskIdx: ti, arm: 'random', shot: s, prompt: base })
      units.push({ taskIdx: ti, arm: 'diverse', shot: s, prompt: diverse[s] as string })
    }
  }
  console.log(`\n▶ solving ${units.length} attempts (${tasks.length} tasks × ${k} shots × 2 arms) via router, conc=${solveConcurrency}`)

  const codes = await pool(units, solveConcurrency, async (u) => {
    const res = await routerChatWithUsage(cfg, [{ role: 'user', content: u.prompt }], {
      temperature: Number(process.env.TEMPERATURE ?? '0.8'),
    })
    return extractCode(typeof res.content === 'string' ? res.content : '')
  })

  console.log(`▶ running ${codes.length} candidates through the Docker deployable checker, conc=${dockerConcurrency}`)
  const passes = await pool(units, dockerConcurrency, (u, i) => runChecker(tasks[u.taskIdx] as HumanEvalTask, codes[i] as string))

  // Regroup into per-task arms, preserving shot order.
  const outcomes: TaskOutcome[] = tasks.map((t) => ({ taskId: t.taskId, randomAttempts: [], diverseAttempts: [] }))
  units.forEach((u, i) => {
    const att: Attempt = { code: codes[i] as string, pass: (passes[i] as CheckResult).pass }
    const o = outcomes[u.taskIdx] as TaskOutcome
    if (u.arm === 'random') o.randomAttempts[u.shot] = att
    else o.diverseAttempts[u.shot] = att
  })

  // Per-task {0,1} outcomes for each metric, aligned across the same tasks.
  const blind: number[] = []
  const randomAtK: number[] = []
  const diverseAtK: number[] = []
  const oracleAtK: number[] = []
  const selfConsistencyAtK: number[] = []

  for (const o of outcomes) {
    const rPasses = o.randomAttempts.map((a) => a.pass)
    const dPasses = o.diverseAttempts.map((a) => a.pass)
    // blind = first random shot (one-shot baseline)
    blind.push((o.randomAttempts[0] as Attempt).pass)
    // random@k = verifier-grounded pick over the K random shots
    randomAtK.push((o.randomAttempts[verifierGroundedSelect(rPasses)] as Attempt).pass)
    // diverse@k = verifier-grounded pick over the K diverse shots
    diverseAtK.push((o.diverseAttempts[verifierGroundedSelect(dPasses)] as Attempt).pass)
    // oracle@k = any diverse shot passes (the ceiling the diverse arm opens)
    oracleAtK.push(dPasses.some((p) => p > 0) ? 1 : 0)
    // self-consistency@k = answer-clustering pick over the diverse shots (the
    // −8/−9pp answer-oracle selector; uses code text, NOT the checker).
    const scIdx = selfConsistencySelect(o.diverseAttempts.map((a) => a.code))
    selfConsistencyAtK.push((o.diverseAttempts[scIdx] as Attempt).pass)
  }

  const rate = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

  const blindRate = rate(blind)
  const randomRate = rate(randomAtK)
  const diverseRate = rate(diverseAtK)
  const oracleRate = rate(oracleAtK)
  const scRate = rate(selfConsistencyAtK)
  // oracle ceiling of the RANDOM arm — for the diverse-vs-random ceiling contrast.
  const randomOracleRate = rate(outcomes.map((o) => (o.randomAttempts.some((a) => a.pass > 0) ? 1 : 0)))

  console.log(`\n${'='.repeat(78)}`)
  console.log(`RESULTS · HumanEval · n=${tasks.length} tasks · k=${k} · model=${model}`)
  console.log('='.repeat(78))
  console.log(`  blind pass@1               ${pct(blindRate)}`)
  console.log(`  random-pass@k (verifier)   ${pct(randomRate)}`)
  console.log(`  diverse-pass@k (verifier)  ${pct(diverseRate)}`)
  console.log(`  oracle@k (diverse, any)    ${pct(oracleRate)}    [random-arm oracle ${pct(randomOracleRate)}]`)
  console.log(`  self-consistency@k         ${pct(scRate)}    (answer-clustering selector over the diverse set)`)

  const liftDiverseVsRandom = pairedLift(randomAtK, diverseAtK)
  const liftRandomVsBlind = pairedLift(blind, randomAtK)
  const liftDiverseVsBlind = pairedLift(blind, diverseAtK)
  const liftScVsRandom = pairedLift(randomAtK, selfConsistencyAtK)
  const liftDiverseVsScVerifier = pairedLift(selfConsistencyAtK, diverseAtK)

  const row = (label: string, l: PairedLift) =>
    console.log(
      `  ${label.padEnd(34)} ${pp(l.point).padStart(7)}   CI [${pp(l.low)}, ${pp(l.high)}]   (paired ${l.pairs}, discordant ${l.discordant})`,
    )

  console.log(`\n  PAIRED LIFTS (95% bootstrap CI, B=10000):`)
  row('diverse@k − random@k (verifier)', liftDiverseVsRandom)
  row('random@k − blind (compute)', liftRandomVsBlind)
  row('diverse@k − blind (total)', liftDiverseVsBlind)
  row('self-consistency@k − random@k', liftScVsRandom)
  row('verifier-pick − sc-pick (diverse)', liftDiverseVsScVerifier)

  const sig = (l: PairedLift) => (l.low > 0 ? 'POSITIVE (CI excludes 0)' : l.high < 0 ? 'NEGATIVE (CI excludes 0)' : 'n.s. (CI spans 0)')
  console.log(`\n  VERDICT:`)
  console.log(`    diverse@k beats blind@1?       ${liftDiverseVsBlind.point > 0 ? 'yes' : 'no'} (${pp(liftDiverseVsBlind.point)}, ${sig(liftDiverseVsBlind)})`)
  console.log(`    diverse@k beats random@k @k?   ${liftDiverseVsRandom.point > 0 ? 'yes' : 'no'} (${pp(liftDiverseVsRandom.point)}, ${sig(liftDiverseVsRandom)})`)
  console.log(`    is the diversity ceiling capturable with a deployable checker?`)
  console.log(`      diverse oracle ${pct(oracleRate)} → verifier-pick ${pct(diverseRate)} (gap ${pp(oracleRate - diverseRate)});`)
  console.log(`      contrast: the SAME diverse set under the answer-clustering selector resolves ${pct(scRate)} (verifier−sc ${pp(diverseRate - scRate)}).`)
}

main().catch((err) => {
  console.error(`humaneval-gate: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
