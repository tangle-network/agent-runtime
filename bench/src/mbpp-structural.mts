/**
 * MBPP STRUCTURAL lever — the transfer test for the HumanEval result in
 * `hev-structural.mts`: best-of-k selection + self-repair grounded ONLY on
 * VISIBLE checks, graded on HIDDEN tests the harness never shows the model.
 *
 * MBPP (sanitized, 427 tasks) has no docstring examples; the standard protocol
 * shows the model test_list[0] (it pins the function name/signature). So:
 *   VISIBLE = test_list[0] (+ TESTGEN model-written asserts, generated from the
 *             description BEFORE any candidate exists)
 *   HIDDEN  = test_list[1:] (with test_imports) — the grading suite
 * A task with <2 asserts cannot split visible/hidden and is dropped at load.
 *
 * Architecture is hev-structural.mts verbatim (kept self-contained on purpose —
 * the HumanEval rig is frozen post-verification): Phase A (harness: sample →
 * visible-check select → visible-grounded repair, all decisions locked) then
 * Phase B (hidden grading); per-call NONCE sentinels on both judges; global
 * docker semaphore; in-container timeout + exit reaper; incremental OUT jsonl;
 * per-task error rows with >15% abort; paired bootstrap + exact sign test.
 *
 * CALIBRATE=1: reference solutions through both judges (hidden self-check must
 * be ~100%; failures listed — some MBPP references are known-defective).
 *
 *   TANGLE_API_KEY=… WORKER_MODEL=meta-llama/Meta-Llama-3-8B-Instruct-Lite \
 *   ROUTER_BASE=https://api.together.xyz/v1 MBPP_JSON=/abs/sanitized-mbpp.json \
 *   N=427 K=5 REPAIRS=2 TESTGEN=6 TEMPERATURE=0.8 OUT=/abs/rows.jsonl \
 *   tsx src/mbpp-structural.mts
 */
import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractCode } from './benchmarks/humaneval'
import { type PairedLift, pairedLift, pool } from './stats.mts'

const dockerImage = 'python:3.12-slim'
const dockerTimeoutMs = Number(process.env.DOCKER_TIMEOUT_MS ?? 20000)

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

// ---------- dataset ----------

export interface MbppTask {
  taskId: number
  description: string
  /** test_list[0] — shown to the model; pins the function name/signature */
  shownAssert: string
  /** test_list[1:] — the hidden grading suite */
  hiddenAsserts: string[]
  testImports: string[]
  entryPoint: string
  /** reference solution — judge self-check only, never shown to the model */
  referenceCode: string
}

interface RawMbpp {
  task_id: number
  prompt: string
  code: string
  test_imports?: string[]
  test_list: string[]
}

/** Load sanitized MBPP, sorted by task_id. Drops (and counts) tasks that cannot
 *  split visible/hidden (<2 asserts) or whose entry point cannot be resolved.
 *  Entry point = the FIRST called name in test_list[0] that also has a
 *  `def <name>` in the reference code — `assert set(f(...)) == …` must resolve
 *  to f, not set. */
export function loadMbpp(limit: number, offset = 0): { tasks: MbppTask[]; droppedShort: number[]; droppedEntry: number[] } {
  const path = process.env.MBPP_JSON
  if (!path) throw new Error('env MBPP_JSON is required (path to sanitized-mbpp.json)')
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RawMbpp[]
  raw.sort((a, b) => a.task_id - b.task_id)
  const tasks: MbppTask[] = []
  const droppedShort: number[] = []
  const droppedEntry: number[] = []
  for (const d of raw) {
    if (!d.test_list || d.test_list.length < 2) {
      droppedShort.push(d.task_id)
      continue
    }
    const shown = d.test_list[0] as string
    const calls = [...shown.matchAll(/(\w+)\s*\(/g)].map((m) => m[1] as string)
    const entry = calls.find((c) => new RegExp(`def\\s+${c}\\s*\\(`).test(d.code))
    if (!entry) {
      droppedEntry.push(d.task_id)
      continue
    }
    tasks.push({
      taskId: d.task_id,
      description: d.prompt,
      shownAssert: shown,
      hiddenAsserts: d.test_list.slice(1),
      testImports: d.test_imports ?? [],
      entryPoint: entry,
      referenceCode: d.code,
    })
  }
  if (offset >= tasks.length) throw new Error(`OFFSET ${offset} >= usable dataset size ${tasks.length}`)
  return { tasks: tasks.slice(offset, offset + limit), droppedShort, droppedEntry }
}

const solveInstruction =
  'Write a Python function for the following task. Output the COMPLETE function definition (plus any imports it needs) inside a single ```python code block. Do not write tests or example calls.'

function basePrompt(task: MbppTask): string {
  return `${solveInstruction}\n\nTask: ${task.description}\nYour function must satisfy this example test:\n\`\`\`python\n${task.shownAssert}\n\`\`\``
}

// ---------- docker semaphore + jailed runner (mirrors hev-structural) ----------

let dockerSlots = 6
let dockerInFlight = 0
const dockerWaiters: Array<() => void> = []
async function withDockerSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (dockerInFlight >= dockerSlots) await new Promise<void>((r) => dockerWaiters.push(r))
  dockerInFlight += 1
  try {
    return await fn()
  } finally {
    dockerInFlight -= 1
    dockerWaiters.shift()?.()
  }
}

const containerPrefix = `mbpps-${process.pid}`
let containerSeq = 0

function reapContainers(): void {
  try {
    const ids = execFileSync('docker', ['ps', '-aq', '--filter', `name=${containerPrefix}`], { timeout: 10000 }).toString().trim()
    if (ids) execFileSync('docker', ['rm', '-f', ...ids.split('\n')], { timeout: 15000 })
  } catch {
    /* reaper is best-effort by design */
  }
}
process.on('SIGINT', () => {
  reapContainers()
  process.exit(130)
})
process.on('SIGTERM', () => {
  reapContainers()
  process.exit(143)
})

interface JailResult {
  exitCode: number
  stdout: string
  stderr: string
}

function runJailed(program: string): Promise<JailResult> {
  return withDockerSlot(
    () =>
      new Promise<JailResult>((resolvePromise, reject) => {
        const dir = mkdtempSync(join(tmpdir(), 'mbpps-'))
        writeFileSync(join(dir, 'p.py'), program)
        const name = `${containerPrefix}-${containerSeq++}`
        let settled = false
        const cleanup = () => {
          rmSync(dir, { recursive: true, force: true })
          execFile('docker', ['rm', '-f', name], () => {})
        }
        const finish = (res: JailResult) => {
          if (settled) return
          settled = true
          clearTimeout(backstop)
          cleanup()
          resolvePromise(res)
        }
        const fail = (e: Error) => {
          if (settled) return
          settled = true
          clearTimeout(backstop)
          cleanup()
          reject(e)
        }
        const backstop = setTimeout(() => finish({ exitCode: 124, stdout: '', stderr: 'backstop timeout (no output)' }), dockerTimeoutMs + 5000)
        const inContainerSecs = Math.ceil(dockerTimeoutMs / 1000) + 2
        execFile(
          'docker',
          [
            'run', '--rm', '--name', name, '--network=none', '--cpus=1', '--memory=512m',
            '-v', `${dir}:/w:ro`, '-w', '/w', dockerImage,
            'timeout', '-s', 'KILL', String(inContainerSecs), 'python', '/w/p.py',
          ],
          { timeout: dockerTimeoutMs + 3000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (err) {
              const e = err as NodeJS.ErrnoException & { code?: number | string }
              if (e.code === 'ENOENT') return fail(new Error('docker binary not found on PATH'))
              const se = stderr ?? ''
              if (/cannot connect to the docker daemon|is the docker daemon running|permission denied while trying to connect/i.test(se)) {
                return fail(new Error(`docker daemon unreachable: ${se.slice(0, 200)}`))
              }
              if (/(unable to find image|pull access denied|manifest unknown|error response from daemon).*(pull|repository|registry)/i.test(se)) {
                return fail(new Error(`docker image ${dockerImage} unavailable: ${se.slice(0, 200)}`))
              }
              const code = typeof e.code === 'number' ? e.code : 1
              return finish({ exitCode: code, stdout: stdout ?? '', stderr: se })
            }
            finish({ exitCode: 0, stdout: stdout ?? '', stderr: stderr ?? '' })
          },
        )
      }),
  )
}

// ---------- the visible-check judge (Phase A's ONLY signal) ----------

export interface VisibleResult {
  /** total visible checks run: shown assert + generated asserts (-1 = crashed) */
  attempted: number
  failed: number
  failureOutput: string
  pass: boolean
  sAttempted?: number
  sFailed?: number
  gAttempted?: number
  gFailed?: number
}

/** Each visible assert runs INDIVIDUALLY in try/except so one malformed line
 *  cannot zero the rest; per-assert failure text is the repair feedback. The
 *  hidden asserts (test_list[1:]) never appear here. */
function buildVisibleProgram(task: MbppTask, candidate: string, nonce: string, genTests: string[]): string {
  const shownB64 = Buffer.from(JSON.stringify([task.shownAssert]), 'utf8').toString('base64')
  const genB64 = Buffer.from(JSON.stringify(genTests), 'utf8').toString('base64')
  return `${task.testImports.join('\n')}\n${candidate}\n
import base64 as _b64, json as _json, sys as _sys
_shown = _json.loads(_b64.b64decode("${shownB64}").decode("utf8"))
_gen = _json.loads(_b64.b64decode("${genB64}").decode("utf8"))
_out = []
def _run(_tests):
    _att, _fail = 0, 0
    for _t in _tests:
        _att += 1
        try:
            exec(_t, dict(globals()))
        except Exception as _e:
            _fail += 1
            _out.append("CHECK FAILED: %s -> %s: %s" % (_t.strip()[:200], type(_e).__name__, str(_e)[:200]))
    return _att, _fail
_s_att, _s_fail = _run(_shown)
_g_att, _g_fail = _run(_gen)
_att, _fail = _s_att + _g_att, _s_fail + _g_fail
print("VISIBLE-${nonce} attempted=%d failed=%d satt=%d sfail=%d gatt=%d gfail=%d" % (_att, _fail, _s_att, _s_fail, _g_att, _g_fail))
_sys.stdout.write("\\n".join(_out)[-1500:])
_sys.exit(0 if _att > 0 and _fail == 0 else 1)
`
}

export async function runVisibleJudge(task: MbppTask, candidate: string, genTests: string[]): Promise<VisibleResult> {
  const nonce = randomBytes(8).toString('hex')
  const r = await runJailed(buildVisibleProgram(task, candidate, nonce, genTests))
  const summary = new RegExp(`VISIBLE-${nonce} attempted=(\\d+) failed=(\\d+) satt=(\\d+) sfail=(\\d+) gatt=(\\d+) gfail=(\\d+)`).exec(r.stdout)
  if (!summary) {
    const detail = (r.stderr || r.stdout).slice(-1500) || 'timed out (no output)'
    return { attempted: -1, failed: -1, failureOutput: detail, pass: false }
  }
  const attempted = Number(summary[1])
  const failed = Number(summary[2])
  const failureOutput = r.stdout.replace(summary[0], '').slice(-1500)
  return {
    attempted,
    failed,
    failureOutput,
    pass: attempted > 0 && failed === 0,
    sAttempted: Number(summary[3]),
    sFailed: Number(summary[4]),
    gAttempted: Number(summary[5]),
    gFailed: Number(summary[6]),
  }
}

function visibleScore(h: VisibleResult): number {
  if (h.attempted <= 0) return h.attempted === 0 ? 0 : -1
  // The shown assert is OFFICIAL (printed in the model's prompt); generated asserts
  // are the model's own guesses and run ~70% wrong on MBPP's one-sentence specs
  // (measured on the pilot: 71/102 failed on officially-passing code). Rank by the
  // official signal first; guesses only break ties — otherwise 6 noisy guesses
  // outvote the one reliable check and selection goes NEGATIVE.
  const sA = h.sAttempted ?? 0
  const gA = h.gAttempted ?? 0
  const sFrac = sA > 0 ? (sA - (h.sFailed ?? 0)) / sA : 0
  const gFrac = gA > 0 ? (gA - (h.gFailed ?? 0)) / gA : 0
  return sFrac + 0.001 * gFrac
}

// ---------- the hidden judge (Phase B / calibration ONLY) ----------

function buildHiddenProgram(task: MbppTask, candidate: string, nonce: string): string {
  return `${task.testImports.join('\n')}\n${candidate}\n\n${task.hiddenAsserts.join('\n')}\nprint("HIDDEN-${nonce} PASS")\n`
}

async function runHiddenJudge(task: MbppTask, candidate: string): Promise<{ pass: number; detail?: string }> {
  const nonce = randomBytes(8).toString('hex')
  const r = await runJailed(buildHiddenProgram(task, candidate, nonce))
  if (r.exitCode === 0 && r.stdout.includes(`HIDDEN-${nonce} PASS`)) return { pass: 1 }
  return { pass: 0, detail: (r.stderr || r.stdout).slice(-600) || 'timed out (no output)' }
}

// ---------- model client (mirrors hev-structural) ----------

interface ClientCfg {
  base: string
  key: string
  model: string
  maxTokens: number
  temperature: number
}

interface Completion {
  content: string
  attempts: number
  tokensIn: number
  tokensOut: number
}

async function complete(cfg: ClientCfg, messages: Array<{ role: string; content: string }>): Promise<Completion> {
  let lastErr = ''
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 240_000)
    try {
      const res = await fetch(`${cfg.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, max_tokens: cfg.maxTokens, temperature: cfg.temperature, messages }),
        signal: ctl.signal,
      })
      if (!res.ok) {
        lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
        continue
      }
      const d = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = d.choices?.[0]?.message?.content ?? ''
      if (content.trim() === '') {
        lastErr = 'empty content'
        continue
      }
      return { content, attempts: attempt, tokensIn: d.usage?.prompt_tokens ?? 0, tokensOut: d.usage?.completion_tokens ?? 0 }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`completion failed after retries: ${lastErr}`)
}

function extractRepairCode(reply: string): string {
  const fences = [...reply.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/gi)].map((m) => (m[1] ?? '').trim())
  for (let i = fences.length - 1; i >= 0; i -= 1) {
    if (/(^|\n)\s*def\s+\w+/.test(fences[i] as string)) return fences[i] as string
  }
  return extractCode(reply)
}

// ---------- TESTGEN (mirrors hev-structural; description + shown assert only) ----------

const testGenInstruction = (count: number, entry: string) =>
  `Read the following task description and example test. Write exactly ${count} single-line assert statements that test the function \`${entry}\`, based ONLY on the described behavior. Match the EXACT output type and format the example test shows (if it expects a string, expect a string; if a tuple, a tuple). Each assert must be one physical line of the form \`assert ${entry}(...) == expected\` (or a True/False check). Do NOT implement the function. Do NOT repeat the example test verbatim if you can test other cases too. Output ONLY the assert lines inside a single \`\`\`python code block.`

async function generateTests(cfg: ClientCfg, task: MbppTask, count: number): Promise<{ tests: string[]; completion: Completion }> {
  const c = await complete(cfg, [
    { role: 'user', content: `${testGenInstruction(count, task.entryPoint)}\n\nTask: ${task.description}\nExample test:\n\`\`\`python\n${task.shownAssert}\n\`\`\`` },
  ])
  const block = extractCode(c.content)
  const balanced = (s: string) => {
    let d = 0
    for (const ch of s) {
      if (ch === '(' || ch === '[' || ch === '{') d += 1
      else if (ch === ')' || ch === ']' || ch === '}') d -= 1
      if (d < 0) return false
    }
    return d === 0
  }
  const tests = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('assert ') && l.includes(task.entryPoint) && balanced(l))
    .slice(0, count)
  return { tests, completion: c }
}

// ---------- Phase A: the harness (sees ONLY visible information) ----------

interface HarnessOutcome {
  taskId: number
  samples: string[]
  visible: VisibleResult[]
  selectedIdx: number
  repairs: Array<{ code: string; visible: VisibleResult }>
  finalCode: string
  repairStop: string
  genTests: string[]
  llmCalls: number
  llmAttempts: number
  tokensIn: number
  tokensOut: number
}

async function runHarnessForTask(cfg: ClientCfg, task: MbppTask, k: number, maxRepairs: number, testGen: number): Promise<HarnessOutcome> {
  let llmCalls = 0
  let llmAttempts = 0
  let tokensIn = 0
  let tokensOut = 0
  const track = (c: Completion) => {
    llmCalls += 1
    llmAttempts += c.attempts
    tokensIn += c.tokensIn
    tokensOut += c.tokensOut
  }

  let genTests: string[] = []
  if (testGen > 0) {
    const g = await generateTests(cfg, task, testGen)
    track(g.completion)
    genTests = g.tests
  }

  const samples: string[] = []
  for (let i = 0; i < k; i += 1) {
    const c = await complete(cfg, [{ role: 'user', content: basePrompt(task) }])
    track(c)
    samples.push(extractCode(c.content))
  }
  const visible: VisibleResult[] = []
  for (const s of samples) visible.push(await runVisibleJudge(task, s, genTests))

  let selectedIdx = 0
  for (let i = 1; i < k; i += 1) {
    if (visibleScore(visible[i] as VisibleResult) > visibleScore(visible[selectedIdx] as VisibleResult)) selectedIdx = i
  }

  const selVisible = visible[selectedIdx] as VisibleResult
  let best = { code: samples[selectedIdx] as string, visible: selVisible }
  const repairs: HarnessOutcome['repairs'] = []
  let repairStop = 'already-passing'
  if (!selVisible.pass) {
    if (selVisible.attempted === 0) {
      repairStop = 'no-signal'
    } else {
      repairStop = 'rounds-exhausted'
      let current = best
      for (let r = 0; r < maxRepairs; r += 1) {
        const repairPrompt = [
          'Your Python function failed some of its checks.',
          'The task:',
          task.description,
          'It must satisfy this example test:',
          '```python',
          task.shownAssert,
          '```',
          'Your current attempt:',
          '```python',
          current.code,
          '```',
          'Result of running the checks against your attempt:',
          '```',
          current.visible.failureOutput.trim() || '(the code crashed before the checks could run)',
          '```',
          'Fix the function so the checks pass. Output the COMPLETE corrected function definition inside a single ```python code block. Do not write tests or example calls.',
        ].join('\n')
        const c = await complete(cfg, [{ role: 'user', content: repairPrompt }])
        track(c)
        const code = extractRepairCode(c.content)
        const h = await runVisibleJudge(task, code, genTests)
        repairs.push({ code, visible: h })
        if (visibleScore(h) > visibleScore(current.visible)) current = { code, visible: h }
        if (visibleScore(current.visible) > visibleScore(best.visible)) best = current
        if (h.pass) {
          repairStop = 'repaired-pass'
          break
        }
      }
    }
  }

  return { taskId: task.taskId, samples, visible, selectedIdx, repairs, finalCode: best.code, repairStop, genTests, llmCalls, llmAttempts, tokensIn, tokensOut }
}

// ---------- statistics (mirrors hev-structural) ----------

function signTestP(deltas: number[]): { pos: number; neg: number; p: number } {
  const pos = deltas.filter((d) => d > 1e-9).length
  const neg = deltas.filter((d) => d < -1e-9).length
  const m = pos + neg
  if (m === 0) return { pos, neg, p: 1 }
  const logC: number[] = [0]
  for (let i = 1; i <= m; i += 1) logC.push((logC[i - 1] as number) + Math.log(m - i + 1) - Math.log(i))
  const pmf = (x: number) => Math.exp((logC[x] as number) - m * Math.LN2)
  const extreme = Math.max(pos, neg)
  let p = 0
  for (let x = extreme; x <= m; x += 1) p += pmf(x)
  p *= 2
  if (pos === neg) p = 1
  return { pos, neg, p: Math.min(1, p) }
}

// ---------- calibration mode ----------

async function calibrate(tasks: MbppTask[]): Promise<void> {
  console.log(`=== CALIBRATION · MBPP reference solutions vs both judges · n=${tasks.length} ===`)
  const rows = await pool(tasks, 16, async (t) => {
    const hidden = await runHiddenJudge(t, t.referenceCode)
    const visible = await runVisibleJudge(t, t.referenceCode, [])
    return { id: t.taskId, hidden: hidden.pass, hiddenDetail: hidden.detail, vAttempted: visible.attempted, vFailed: visible.failed, visiblePass: visible.pass }
  })
  const hiddenPass = rows.filter((r) => r.hidden === 1)
  const visibleFail = rows.filter((r) => !r.visiblePass)
  console.log(`  hidden judge self-check: ${hiddenPass.length}/${rows.length} reference solutions pass (must be ~100%)`)
  if (hiddenPass.length < rows.length) {
    for (const r of rows.filter((x) => x.hidden !== 1)) console.log(`    hidden FAIL ${r.id}: ${(r.hiddenDetail ?? '').replace(/\n/g, ' | ').slice(0, 160)}`)
  }
  console.log(`  visible-check false-fail on reference: ${visibleFail.length}/${rows.length}`)
  if (visibleFail.length > 0) console.log(`    visible false-fail ids: ${visibleFail.map((r) => `${r.id}(${r.vFailed}/${r.vAttempted})`).join(', ')}`)
}

// ---------- main ----------

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`

interface GradedRow extends HarnessOutcome {
  hiddenSamples: number[]
  hiddenFinal: number
}

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 427)
  const k = Number(process.env.K ?? 5)
  const maxRepairs = Number(process.env.REPAIRS ?? 2)
  const offset = Number(process.env.OFFSET ?? 0)
  const temperature = Number(process.env.TEMPERATURE ?? 0.8)
  const model = process.env.WORKER_MODEL ?? 'meta-llama/Meta-Llama-3-8B-Instruct-Lite'
  const base = process.env.ROUTER_BASE ?? 'https://api.together.xyz/v1'
  const solveConc = Number(process.env.CONCURRENCY ?? 6)
  dockerSlots = Number(process.env.DOCKER_CONCURRENCY ?? 6)
  const testGen = Number(process.env.TESTGEN ?? 0)
  const out = process.env.OUT

  const { tasks, droppedShort, droppedEntry } = loadMbpp(n, offset)
  console.log(`loaded ${tasks.length} MBPP task(s); dropped ${droppedShort.length} (<2 asserts: ${droppedShort.join(',') || '-'}), ${droppedEntry.length} (entry unresolved: ${droppedEntry.join(',') || '-'})`)

  if (process.env.CALIBRATE === '1') {
    await calibrate(tasks)
    return
  }

  const cfg: ClientCfg = { base, key: must('TANGLE_API_KEY'), model, maxTokens: Number(process.env.MAX_TOKENS ?? 2500), temperature }

  console.log(`=== MBPP STRUCTURAL lever · visible=test_list[0]+gen · hidden=test_list[1:] · n=${tasks.length} k=${k} repairs<=${maxRepairs} temp=${temperature} testgen=${testGen} ===`)
  console.log(`  model=${model}  base=${base}  llm-conc=${solveConc}  docker-conc=${dockerSlots} (global semaphore)`)

  let done = 0
  let errCount = 0
  const outcomes = await pool(tasks, solveConc, async (task): Promise<HarnessOutcome | { taskId: number; error: string }> => {
    try {
      const o = await runHarnessForTask(cfg, task, k, maxRepairs, testGen)
      done += 1
      if (out) appendFileSync(`${out}.phaseA`, `${JSON.stringify({ model, temperature, k, maxRepairs, ...o })}\n`)
      process.stderr.write(
        `  [A ${done}/${tasks.length}] mbpp/${o.taskId}: sel=${o.selectedIdx} visible=${o.visible.map((h) => visibleScore(h).toFixed(2)).join('/')} repairs=${o.repairs.length} stop=${o.repairStop}\n`,
      )
      return o
    } catch (e) {
      errCount += 1
      const error = e instanceof Error ? e.message : String(e)
      if (out) appendFileSync(`${out}.phaseA`, `${JSON.stringify({ model, taskId: task.taskId, error })}\n`)
      process.stderr.write(`  [A ERROR] mbpp/${task.taskId}: ${error.slice(0, 160)}\n`)
      if (errCount > Math.max(3, 0.15 * tasks.length)) throw new Error(`aborting: ${errCount} task errors — harness-level fault, not task noise (last: ${error})`)
      return { taskId: task.taskId, error }
    }
  })

  const okOutcomes = outcomes.filter((o): o is HarnessOutcome => !('error' in o))
  const okTasks = okOutcomes.map((o) => tasks.find((t) => t.taskId === o.taskId) as MbppTask)
  if (errCount > 0) console.log(`  WARNING: ${errCount}/${tasks.length} task(s) errored in Phase A — excluded from stats, recorded in ${out ?? '(no OUT set)'}.phaseA`)

  console.log(`\n▶ Phase B: hidden grading (${okOutcomes.length} tasks × ${k} samples + finals)`)
  const graded: GradedRow[] = await pool(okOutcomes, 16, async (o, ti) => {
    const task = okTasks[ti] as MbppTask
    const hiddenSamples: number[] = []
    for (const s of o.samples) hiddenSamples.push((await runHiddenJudge(task, s)).pass)
    const finalIsSelected = o.finalCode === o.samples[o.selectedIdx]
    const hiddenFinal = finalIsSelected ? (hiddenSamples[o.selectedIdx] as number) : (await runHiddenJudge(task, o.finalCode)).pass
    const g: GradedRow = { ...o, hiddenSamples, hiddenFinal }
    if (out) appendFileSync(out, `${JSON.stringify({ model, temperature, k, maxRepairs, ...g })}\n`)
    return g
  })
  if (out) console.log(`  raw rows appended to ${out} (phase-A rows incl. errors: ${out}.phaseA)`)

  const blind1First = graded.map((g) => g.hiddenSamples[0] as number)
  const blind1Mean = graded.map((g) => g.hiddenSamples.reduce((s, x) => s + x, 0) / g.hiddenSamples.length)
  const selected = graded.map((g) => g.hiddenSamples[g.selectedIdx] as number)
  const repaired = graded.map((g) => g.hiddenFinal)
  const oracleK = graded.map((g) => (g.hiddenSamples.some((x) => x === 1) ? 1 : 0))
  const covered = graded.map((g) => (g.visible.some((h) => h.attempted > 0) ? 1 : 0))
  const rate = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const llmCallsTotal = graded.reduce((s, g) => s + g.llmCalls, 0)
  const llmAttemptsTotal = graded.reduce((s, g) => s + g.llmAttempts, 0)
  const tokensInTotal = graded.reduce((s, g) => s + g.tokensIn, 0)
  const tokensOutTotal = graded.reduce((s, g) => s + g.tokensOut, 0)
  const repairFired = graded.filter((g) => g.repairs.length > 0)

  console.log(`\n${'='.repeat(78)}`)
  console.log(`RESULTS · MBPP structural lever · n=${graded.length} · k=${k} · repairs<=${maxRepairs} · temp=${temperature} · ${model}`)
  console.log('='.repeat(78))
  console.log(`  visible-check coverage       ${pct(rate(covered))} of tasks (shown assert always present)`)
  console.log(`  blind pass@1 (mean of k)     ${pct(rate(blind1Mean))}   [PRIMARY baseline — ${k}-rep estimator]`)
  console.log(`  blind pass@1 (first sample)  ${pct(rate(blind1First))}   [single-rep reference]`)
  console.log(`  selected@1 (visible argmax)  ${pct(rate(selected))}`)
  console.log(`  repaired@1 (full harness)    ${pct(rate(repaired))}`)
  console.log(`  oracle pass@${k} (ceiling)      ${pct(rate(oracleK))}`)
  console.log(
    `  compute: ${llmCallsTotal} llm calls (${llmAttemptsTotal} incl. retries) = ${(llmCallsTotal / graded.length).toFixed(2)}/task; tokens in/out ${tokensInTotal}/${tokensOutTotal} (blind@1 spends 1 call/task)`,
  )
  console.log(`  repair fired on ${repairFired.length}/${graded.length} tasks (stop: ${['already-passing', 'no-signal', 'repaired-pass', 'rounds-exhausted'].map((s) => `${s}=${graded.filter((g) => g.repairStop === s).length}`).join(', ')})`)

  const row = (label: string, baseline: number[], treatment: number[]) => {
    const l = pairedLift(baseline, treatment)
    const st = signTestP(baseline.map((b, i) => (treatment[i] as number) - b))
    console.log(
      `  ${label.padEnd(36)} ${pp(l.point).padStart(7)}   CI [${pp(l.low)}, ${pp(l.high)}]   sign-test p=${st.p < 0.001 ? st.p.toExponential(1) : st.p.toFixed(3)} (+${st.pos}/−${st.neg})   (pairs ${l.pairs})`,
    )
    return { l, st }
  }

  console.log(`\n  PAIRED LIFTS vs blind pass@1 (mean-of-${k}) · 95% bootstrap CI (B=10000) + exact sign test:`)
  const sel = row('selected@1 − blind@1 (selection)', blind1Mean, selected)
  const rep = row('repaired@1 − blind@1 (full harness)', blind1Mean, repaired)
  row('repaired@1 − selected@1 (repair)', selected, repaired)
  row(`oracle@${k} − repaired@1 (unrealized)`, repaired, oracleK)

  const coveredIdx = graded.map((_, i) => i).filter((i) => covered[i] === 1)
  if (coveredIdx.length > 0 && coveredIdx.length < graded.length) {
    const pick = (xs: number[]) => coveredIdx.map((i) => xs[i] as number)
    console.log(`\n  COVERED-ONLY subgroup (n=${coveredIdx.length}):`)
    row('  selected@1 − blind@1', pick(blind1Mean), pick(selected))
    row('  repaired@1 − blind@1', pick(blind1Mean), pick(repaired))
  }

  const verdict = (name: string, r: { l: PairedLift; st: { p: number } }) =>
    `${name}: ${pp(r.l.point)} — ${r.l.low > 0 && r.st.p < 0.05 ? 'POSITIVE (CI excludes 0 AND sign-test p<0.05)' : r.l.high < 0 && r.st.p < 0.05 ? 'NEGATIVE' : 'n.s.'}`
  console.log(`\n  VERDICT: ${verdict('full harness', rep)}; ${verdict('selection alone', sel)}`)
}

main().catch((e) => {
  reapContainers()
  console.error(`mbpp-structural: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
