/**
 * CL-bench (Context Learning) deployable-selector gate — Tencent/Fudan's CL-bench
 * (arXiv:2602.03587) repurposed for our verifier-grounded selector question.
 *
 * CL-bench asks whether a model can learn NEW knowledge from in-context material
 * (a rule book, a framework doc, a conversation) at inference time: each record is
 * a `messages` conversation (system + context-laden turns, the final turn the task)
 * graded against expert `rubrics`. The official metric is BINARY — a task is solved
 * only if the response passes EVERY rubric (avg 63 rubrics/task). We keep that binary
 * as `resolved`, but the per-rubric pass-count gives a CONTINUOUS score (fraction of
 * rubrics satisfied) — the within-task graded variance a selector needs, which the
 * deterministic-but-pass/fail benches (aec) lacked.
 *
 * The CHECKER is the benchmark's own rubric judge (an LLM, per CL-bench's eval.py),
 * run by us at inference time — deployable, but NOT deterministic, so treat the judge
 * as a noisy verifier: we rank by the rubric FRACTION (variance-reduced over many
 * rubrics), not the binary, and the judge model + temperature are pinned for
 * test-retest stability. This is the LLM-judge analogue of the HumanEval Docker gate;
 * read a positive result as "a deployable rubric-fraction verifier captures selection
 * value on a hard context-learning domain", scoped by judge noise.
 *
 * Router-only (no sandbox): worker + judge are both router chat calls. Two paired arms
 * over the same tasks, each "shot" = one stateless completion of the final turn:
 *   random@K  — K completions over the unmodified conversation
 *   diverse@K — K completions, the i-th with a strategy lens prepended to the system turn
 * verifierGroundedSelect ranks the K shots by rubric fraction. Metrics are reported on
 * BOTH the continuous fraction (the gate-relevant signal) and the official binary.
 * Writes a corpus RunRecord/task (condition random@k) so `corpus-replay --selector` and
 * `corpus-report` consume it unchanged. Fail loud.
 *
 *   dotenvx run -f … -- env N=20 K=4 WORKER_MODEL=deepseek-chat JUDGE_MODEL=deepseek-chat \
 *     CORPUS=/tmp/clbench-ctx.jsonl tsx src/clbench-context-gate.mts
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { composeStrategies } from './directives'
import { type AttemptRecord, appendRunRecord, type RunRecord } from './corpus'
import { type RouterConfig, routerChatWithUsage } from './router-client'
import { selfConsistencySelect, verifierGroundedSelect } from './selector'

const datasetUrl = 'https://huggingface.co/datasets/tencent/CL-bench/resolve/main/CL-bench.jsonl'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

interface ChatMessage {
  role: string
  content: string
}

interface CtxTask {
  id: string
  messages: ChatMessage[]
  rubrics: string[]
  category: string
}

/** Fetch the first `count` lines of the (large, ~300MB) CL-bench JSONL via a piped
 *  `curl | head` so a smoke pulls only a few records, then slice [offset, offset+limit].
 *  A local cached file (CLBENCH_CTX_FILE) short-circuits the fetch for powered runs.
 *  Fail loud on a malformed record — a silently-short task set would poison the gate. */
function loadCtxTasks(limit: number, offset: number): CtxTask[] {
  const need = offset + limit
  // Fetch a 2-line buffer past `need`: on CL-bench's huge multi-KB records, `head`
  // closing the pipe can emit a TRUNCATED final line (SIGPIPE mid-write) → invalid
  // JSON. Fetching need+2 and parsing only the first `need` complete lines makes the
  // truncated tail land in the discarded buffer.
  const fetchN = need + 2
  let raw: string
  const cached = process.env.CLBENCH_CTX_FILE
  if (cached) {
    if (!existsSync(cached)) throw new Error(`CLBENCH_CTX_FILE not found: ${cached}`)
    raw = execFileSync('bash', ['-c', `head -n ${fetchN} ${JSON.stringify(cached)}`], { maxBuffer: 1 << 30 }).toString('utf8')
  } else {
    // -fsSL: fail on HTTP error, follow redirects (HF resolve 302s to the CDN). curl's
    // SIGPIPE (exit 23) when head closes is benign — suppress its stderr; a real fetch
    // failure surfaces as 0 parsed tasks below.
    raw = execFileSync('bash', ['-c', `curl -fsSL ${JSON.stringify(datasetUrl)} 2>/dev/null | head -n ${fetchN}`], {
      maxBuffer: 1 << 30,
    }).toString('utf8')
  }
  const tasks: CtxTask[] = []
  // Only the first `need` lines are guaranteed complete (the +2 absorbs head's tail).
  const lines = raw.split('\n').filter((l) => l.trim() !== '').slice(0, need)
  for (const line of lines) {
    const d = JSON.parse(line) as {
      messages?: ChatMessage[]
      rubrics?: unknown[]
      metadata?: { task_id?: string; context_category?: string }
    }
    const messages = d.messages
    const taskId = d.metadata?.task_id
    if (!Array.isArray(messages) || messages.length === 0 || !taskId) {
      throw new Error(`malformed CL-bench record: ${line.slice(0, 120)}`)
    }
    // Rubrics are strings or {rubric_criteria} objects (mirrors eval.py's build_rubrics_text).
    const rubrics = (d.rubrics ?? []).map((r) =>
      typeof r === 'string' ? r : String((r as { rubric_criteria?: string }).rubric_criteria ?? '').trim(),
    ).filter((r) => r.length > 0)
    if (rubrics.length === 0) throw new Error(`CL-bench record ${taskId} has no rubrics`)
    tasks.push({ id: taskId, messages, rubrics, category: d.metadata?.context_category ?? 'Unknown' })
  }
  if (tasks.length === 0) throw new Error('CL-bench parsed to 0 tasks')
  if (offset >= tasks.length) throw new Error(`OFFSET ${offset} >= fetched size ${tasks.length}`)
  return tasks.slice(offset, offset + limit)
}

/** Apply a diversity strategy lens to a conversation by prepending it to the system
 *  turn (or, if none, inserting a system turn). The non-system context turns — which
 *  carry the in-context knowledge the task is about — are never mutated. */
function diversifyMessages(messages: ChatMessage[], lensSystem: string, baseSystem: string): ChatMessage[] {
  if (messages[0]?.role === 'system') {
    return [{ role: 'system', content: lensSystem }, ...messages.slice(1)]
  }
  return [{ role: 'system', content: composeStrategies(baseSystem, 1)[0] as string }, ...messages]
}

const judgePrompt = (rubricsText: string, modelOutput: string): string =>
  'You are a rigorous, strict grading teacher. Grade the student response against the 【Rubrics】, ' +
  'checking EACH requirement independently.\n\n' +
  `【Rubrics】:\n${rubricsText}\n` +
  `【Student Response】:\n${modelOutput}\n\n` +
  'Output ONLY this JSON (no other text):\n' +
  '{\n  "status": ["yes" or "no", ... one per rubric, in order],\n  "all_pass": 0 or 1\n}\n'

interface RubricVerdict {
  /** fraction of rubrics satisfied (0..1) — the continuous within-task signal. */
  fraction: number
  /** official binary: every rubric satisfied. */
  allPass: boolean
  /** rubric count actually graded (for diagnostics). */
  graded: number
}

function parseJudge(reply: string, rubricCount: number): RubricVerdict {
  let text = reply.trim()
  if (text.startsWith('```json')) text = text.slice(7)
  if (text.startsWith('```')) text = text.slice(3)
  if (text.endsWith('```')) text = text.slice(0, -3)
  const obj = JSON.parse(text.trim()) as { status?: unknown[]; all_pass?: unknown }
  const status = Array.isArray(obj.status) ? obj.status : []
  const yes = status.filter((s) => String(s).trim().toLowerCase() === 'yes').length
  const graded = status.length > 0 ? status.length : rubricCount
  const fraction = graded > 0 ? yes / graded : 0
  // Trust an explicit all_pass when given; else derive from the per-rubric list.
  const allPass = obj.all_pass === 1 || obj.all_pass === '1' || (status.length === rubricCount && yes === rubricCount && rubricCount > 0)
  return { fraction, allPass, graded }
}

/** Grade one completion with the rubric judge. A judge API/parse failure is a real
 *  zero (the response could not be validated) — surfaced, never masked. */
async function judgeRubrics(cfg: RouterConfig, task: CtxTask, output: string): Promise<RubricVerdict> {
  if (!output.trim()) return { fraction: 0, allPass: false, graded: 0 }
  const rubricsText = task.rubrics.map((r, i) => `${i + 1}. ${r}`).join('\n')
  const res = await routerChatWithUsage(cfg, [{ role: 'user', content: judgePrompt(rubricsText, output) }], { temperature: 0 })
  return parseJudge(typeof res.content === 'string' ? res.content : '', task.rubrics.length)
}

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
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()))
  return results
}

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

/** Paired lift = mean over tasks of (treatment − baseline) with a 95% bootstrap CI.
 *  Works on continuous per-task values (rubric fractions) as well as {0,1}. */
function pairedLift(baseline: number[], treatment: number[], bootstrapN = 10000): PairedLift {
  if (baseline.length !== treatment.length) throw new Error('pairedLift: misaligned arms')
  const n = baseline.length
  if (n === 0) throw new Error('pairedLift: no pairs')
  const deltas = baseline.map((b, i) => (treatment[i] as number) - b)
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  const point = mean(deltas)
  const discordant = deltas.filter((d) => Math.abs(d) > 1e-9).length
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

interface Shot {
  output: string
  verdict: RubricVerdict
}

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 20)
  const k = Number(process.env.K ?? 4)
  const offset = Number(process.env.OFFSET ?? 0)
  const model = process.env.WORKER_MODEL ?? 'deepseek-chat'
  const judgeModel = process.env.JUDGE_MODEL ?? model
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const solveConcurrency = Number(process.env.CONCURRENCY ?? 6)
  const corpusPath = process.env.CORPUS ?? '/tmp/clbench-ctx.jsonl'
  if (!Number.isInteger(n) || n < 1) throw new Error(`N must be a positive integer, got ${process.env.N}`)
  if (!Number.isInteger(k) || k < 1) throw new Error(`K must be a positive integer, got ${process.env.K}`)

  const workerCfg: RouterConfig = { routerBaseUrl, routerKey, model }
  const judgeCfg: RouterConfig = { routerBaseUrl, routerKey, model: judgeModel }

  console.log(`=== CL-bench (Context Learning) selector gate · N=${n} K=${k} offset=${offset} ===`)
  console.log(`  worker=${model}  judge=${judgeModel} (rubric-fraction verifier)  router=${routerBaseUrl}`)
  console.log('  regime: STATELESS single completions — selector no-self-correction LOWER BOUND, judge is an LLM (noisy verifier)')

  const tasks = loadCtxTasks(n, offset)
  console.log(`loaded ${tasks.length} task(s); rubrics/task: ${tasks.map((t) => t.rubrics.length).join(',')}`)

  type Unit = { taskIdx: number; arm: 'random' | 'diverse'; shot: number; messages: ChatMessage[] }
  const units: Unit[] = []
  for (let ti = 0; ti < tasks.length; ti += 1) {
    const task = tasks[ti] as CtxTask
    const baseSystem = task.messages[0]?.role === 'system' ? (task.messages[0] as ChatMessage).content : 'You are a helpful assistant.'
    const lenses = composeStrategies(baseSystem, k)
    for (let s = 0; s < k; s += 1) {
      units.push({ taskIdx: ti, arm: 'random', shot: s, messages: task.messages })
      units.push({ taskIdx: ti, arm: 'diverse', shot: s, messages: diversifyMessages(task.messages, lenses[s] as string, baseSystem) })
    }
  }
  console.log(`\n▶ solving ${units.length} attempts (${tasks.length} tasks × ${k} shots × 2 arms) via router, conc=${solveConcurrency}`)
  const outputs = await pool(units, solveConcurrency, async (u) => {
    const res = await routerChatWithUsage(workerCfg, u.messages, { temperature: Number(process.env.TEMPERATURE ?? '0.8') })
    return typeof res.content === 'string' ? res.content : ''
  })

  console.log(`▶ grading ${outputs.length} completions with the rubric judge (${judgeModel}), conc=${solveConcurrency}`)
  const verdicts = await pool(units, solveConcurrency, (u, i) => judgeRubrics(judgeCfg, tasks[u.taskIdx] as CtxTask, outputs[i] as string))

  // Regroup into per-task arms, shot order preserved.
  const byTask = tasks.map(() => ({ random: [] as Shot[], diverse: [] as Shot[] }))
  units.forEach((u, i) => {
    const shot: Shot = { output: outputs[i] as string, verdict: verdicts[i] as RubricVerdict }
    const grp = byTask[u.taskIdx] as { random: Shot[]; diverse: Shot[] }
    if (u.arm === 'random') grp.random[u.shot] = shot
    else grp.diverse[u.shot] = shot
  })

  // Per-task aligned metrics, on BOTH the continuous fraction and the official binary.
  const fr = { blind: [] as number[], random: [] as number[], diverse: [] as number[], oracle: [] as number[], sc: [] as number[] }
  const bin = { blind: [] as number[], random: [] as number[], diverse: [] as number[], oracle: [] as number[] }
  for (const grp of byTask) {
    const rFr = grp.random.map((s) => s.verdict.fraction)
    const dFr = grp.diverse.map((s) => s.verdict.fraction)
    const rIdx = verifierGroundedSelect(rFr) // rank random shots by rubric fraction
    const dIdx = verifierGroundedSelect(dFr)
    const scIdx = selfConsistencySelect(grp.diverse.map((s) => s.output))
    fr.blind.push((grp.random[0] as Shot).verdict.fraction)
    fr.random.push((grp.random[rIdx] as Shot).verdict.fraction)
    fr.diverse.push((grp.diverse[dIdx] as Shot).verdict.fraction)
    fr.oracle.push(Math.max(...dFr))
    fr.sc.push((grp.diverse[scIdx] as Shot).verdict.fraction)
    bin.blind.push((grp.random[0] as Shot).verdict.allPass ? 1 : 0)
    bin.random.push((grp.random[rIdx] as Shot).verdict.allPass ? 1 : 0)
    bin.diverse.push((grp.diverse[dIdx] as Shot).verdict.allPass ? 1 : 0)
    bin.oracle.push(dFr.some((_, j) => (grp.diverse[j] as Shot).verdict.allPass) ? 1 : 0)
  }
  const rate = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

  console.log(`\n${'='.repeat(78)}`)
  console.log(`RESULTS · CL-bench Context Learning · n=${tasks.length} · k=${k} · worker=${model} · judge=${judgeModel}`)
  console.log('='.repeat(78))
  console.log('  — rubric FRACTION (continuous within-task signal, the gate-relevant metric) —')
  console.log(`  blind (shot 0)             ${pct(rate(fr.blind))}`)
  console.log(`  random@k (verifier-pick)   ${pct(rate(fr.random))}`)
  console.log(`  diverse@k (verifier-pick)  ${pct(rate(fr.diverse))}`)
  console.log(`  oracle@k (max fraction)    ${pct(rate(fr.oracle))}`)
  console.log(`  self-consistency@k         ${pct(rate(fr.sc))}`)
  console.log('  — official BINARY all-rubrics-pass (solving rate) —')
  console.log(`  blind ${pct(rate(bin.blind))}  random@k ${pct(rate(bin.random))}  diverse@k ${pct(rate(bin.diverse))}  oracle@k ${pct(rate(bin.oracle))}`)

  const row = (label: string, l: PairedLift) =>
    console.log(`  ${label.padEnd(36)} ${pp(l.point).padStart(7)}   CI [${pp(l.low)}, ${pp(l.high)}]   (paired ${l.pairs}, discordant ${l.discordant})`)
  console.log(`\n  PAIRED LIFTS on rubric fraction (95% bootstrap CI, B=10000):`)
  row('random@k − blind (compute)', pairedLift(fr.blind, fr.random))
  row('diverse@k − random@k (verifier)', pairedLift(fr.random, fr.diverse))
  row('diverse@k − blind (total)', pairedLift(fr.blind, fr.diverse))
  row('verifier-pick − sc-pick (diverse)', pairedLift(fr.sc, fr.diverse))
  const ceiling = pairedLift(fr.random, fr.oracle)
  row('oracle@k − random@k (ceiling)', ceiling)

  // Corpus: one RunRecord/task for the random@k arm, ranked by the rubric-fraction
  // verifier — `corpus-replay --selector=verifier` + `corpus-report` consume it.
  for (let ti = 0; ti < tasks.length; ti += 1) {
    const task = tasks[ti] as CtxTask
    const grp = byTask[ti] as { random: Shot[]; diverse: Shot[] }
    const attempts: AttemptRecord[] = grp.random.map((s, round) => ({
      round,
      prompt: 'clbench-context',
      output: s.output.slice(0, 4000),
      valid: s.verdict.allPass,
      score: s.verdict.fraction,
      eventCount: 1,
      eventTypes: { 'router.chat': 1 },
      traceTail: s.output.slice(-600),
    }))
    const record: RunRecord = {
      ts: new Date().toISOString(),
      benchmark: 'clbench-context',
      instanceId: task.id,
      condition: `random@${k}`,
      model,
      blindResolved: (grp.random[0] as Shot).verdict.allPass,
      resolved: grp.random.some((s) => s.verdict.allPass),
      attempts,
      infraError: false,
    }
    await appendRunRecord(corpusPath, record)
  }
  console.log(`\n=== wrote ${tasks.length} task(s) → ${corpusPath} · gate: tsx src/corpus-replay.mts ${corpusPath} --selector=verifier ===`)
}

main().catch((err) => {
  console.error(`clbench-context-gate: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
