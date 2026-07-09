/**
 * HumanEval STRUCTURAL lever — best-of-k selection + self-repair grounded ONLY on the
 * VISIBLE docstring `>>>` examples (the honest oracle), graded on the HIDDEN check()
 * suite. This is the experiment the self-improvement push identified but never ran:
 * the existing gates (`humaneval-gate.mts`, `humaneval-repair-gate.mts`) select/steer
 * on the task's own grading test — defensible in a deployable-verifier framing, but
 * NOT a benchmark-lift claim. Here the harness sees nothing the model can't already
 * read in its prompt.
 *
 * Honesty by construction — two physically separated phases:
 *   Phase A (harness): k samples/task at one temperature → honest doctest score per
 *     sample (docker, --network=none) → argmax select → ≤R repair rounds steered by
 *     the doctest FAILURE OUTPUT → final artifact locked. No access to task.test.
 *   Phase B (grading): the hidden check() suite grades every sample and every locked
 *     final. Nothing from this phase flows back.
 *
 * Judge integrity (adversarially reviewed; both spoof channels closed):
 *   - both judges print a per-call random NONCE sentinel and the verdict is parsed
 *     from that exact nonce — a candidate printing a forged summary line cannot win;
 *   - the hidden judge requires the sentinel, not exit-0 — `sys.exit(0)` before
 *     check() is a FAIL, not a pass;
 *   - containers run under an in-container `timeout -s KILL` so a hung candidate
 *     cannot outlive a crashed harness; a process-exit reaper force-removes strays.
 *
 * Estimators (paired across the same tasks, same sample batch):
 *   blind1_mean  — mean hidden-pass over ALL k samples = expected pass@1 at this
 *                  temperature (a built-in k-rep baseline; the primary control)
 *   blind1_first — hidden-pass of sample 0 (single-rep reference only)
 *   selected@1   — hidden-pass of the honest-oracle argmax sample (selection value)
 *   repaired@1   — hidden-pass of the final after honest-grounded repair (full harness)
 *   oracle@k     — any sample passes hidden (the pass@k ceiling)
 * Every lift carries a 95% paired-bootstrap CI (B=10000, seeded) AND an exact
 * two-sided sign test — the bootstrap alone is anticonservative when few tasks move.
 *
 * CALIBRATE=1 skips the model entirely: canonical solutions vs both judges →
 * hidden-judge self-check (must be ~100%) + honest-oracle coverage & false-fail rate.
 *
 *   TANGLE_API_KEY=… WORKER_MODEL=meta-llama/Meta-Llama-3-8B-Instruct-Lite \
 *   ROUTER_BASE=https://api.together.xyz/v1 HUMANEVAL_GZ=/abs/HumanEval.jsonl.gz \
 *   N=164 K=5 REPAIRS=2 TEMPERATURE=0.8 OUT=/abs/rows.jsonl tsx src/hev-structural.mts
 */
import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type HumanEvalTask, extractCode, loadHumanEval } from './benchmarks/humaneval'
import { composeStrategies } from './directives'
import { type PairedLift, pairedLift, pool } from './stats.mts'

const dockerImage = 'python:3.12-slim'
const dockerTimeoutMs = Number(process.env.DOCKER_TIMEOUT_MS ?? 20000)

const solveInstruction =
  'Complete the following Python function. Output the COMPLETE function definition (signature, docstring optional, body) inside a single ```python code block. Include any imports the function needs. Do not write tests or example calls.'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

// ---------- docker semaphore + jailed runner (shared by BOTH judges) ----------
// Phase A workers each run docker calls too, so the container count must be bounded
// by ONE global semaphore, not by whichever pool happens to wrap the caller.

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

const containerPrefix = `hevs-${process.pid}`
let containerSeq = 0

// Best-effort stray-container reap on any exit path (crash, SIGINT, clean end).
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

/** Run one python program in the jail: --network=none, cpu/mem caps, an IN-CONTAINER
 *  `timeout -s KILL` (so a hung candidate's container self-terminates even if this
 *  process dies), a client timeout, and a backstop. Docker INFRA faults (daemon,
 *  image, permission) throw — a broken checker must fail loud, not score zeros. */
function runJailed(program: string): Promise<JailResult> {
  return withDockerSlot(
    () =>
      new Promise<JailResult>((resolvePromise, reject) => {
        const dir = mkdtempSync(join(tmpdir(), 'hevs-'))
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

// ---------- the honest oracle: doctest over the VISIBLE docstring examples ----------

export interface HonestResult {
  /** total visible checks: doctest examples + model-generated asserts (0 = no
   *  signal, -1 = the candidate crashed before the oracle could run) */
  attempted: number
  failed: number
  /** doctest's failure report — the ONLY feedback the repair loop may see */
  failureOutput: string
  /** attempted > 0 && failed === 0 */
  pass: boolean
  /** split for post-hoc audit: doctest vs generated-assert counts */
  dAttempted?: number
  dFailed?: number
  gAttempted?: number
  gFailed?: number
}

/** The honest program: candidate executes (prompt header first, for its imports;
 *  candidate def shadows the stub), then doctest runs the examples taken from the
 *  STUB's `__doc__` (parsing the raw prompt text instead swallows the closing `"""`
 *  into the last example — caught by CALIBRATE=1). Verdict line carries a per-call
 *  NONCE so candidate-printed forgeries can't be parsed as the summary. task.test
 *  never appears here. */
function buildHonestProgram(task: HumanEvalTask, candidate: string, nonce: string, genTests: string[] = []): string {
  const promptB64 = Buffer.from(task.prompt, 'utf8').toString('base64')
  const entryB64 = Buffer.from(task.entryPoint, 'utf8').toString('base64')
  const genB64 = Buffer.from(JSON.stringify(genTests), 'utf8').toString('base64')
  return `${task.prompt}\n${candidate}\n
import ast as _ast, base64 as _b64, doctest as _doctest, io as _io, json as _json, sys as _sys
_prompt_text = _b64.b64decode("${promptB64}").decode("utf8")
_entry = _b64.b64decode("${entryB64}").decode("utf8")
_gen_tests = _json.loads(_b64.b64decode("${genB64}").decode("utf8"))
_stub_ns = {}
exec(_prompt_text, _stub_ns)
_doc = getattr(_stub_ns.get(_entry), "__doc__", None) or ""
try:
    _examples = _doctest.DocTestParser().get_examples(_doc)
except ValueError:
    _examples = []  # malformed docstring indentation -> no usable signal, not a crash

# Dataset-quirk normalizations, all decidable from VISIBLE output alone:
#   assertion-style examples ("f(x) == 0" with no expected output) pass iff they print True;
#   quote-style repr mismatches ("21" vs '21') compare by literal value.
class _Checker(_doctest.OutputChecker):
    def check_output(self, want, got, optionflags):
        if super().check_output(want, got, optionflags):
            return True
        if want.strip() == "" and got.strip() == "True":
            return True
        try:
            return _ast.literal_eval(want.strip()) == _ast.literal_eval(got.strip())
        except Exception:
            return False

_test = _doctest.DocTest(_examples, globs=dict(globals()), name="visible", filename="p", lineno=0, docstring=_doc)
_runner = _doctest.DocTestRunner(checker=_Checker(), verbose=False, optionflags=_doctest.NORMALIZE_WHITESPACE | _doctest.IGNORE_EXCEPTION_DETAIL)
_buf = _io.StringIO()
_res = _runner.run(_test, out=_buf.write)

# Model-generated asserts (CodeT-style; written from the prompt BEFORE any candidate
# existed). Each runs individually so one malformed assert doesn't zero the rest.
_g_att, _g_fail = 0, 0
for _t in _gen_tests:
    _g_att += 1
    try:
        exec(_t, dict(globals()))
    except Exception as _e:
        _g_fail += 1
        _buf.write("GENTEST FAILED: %s -> %s: %s\\n" % (_t.strip()[:200], type(_e).__name__, str(_e)[:200]))

_att = _res.attempted + _g_att
_fail = _res.failed + _g_fail
print("HONEST-${nonce} attempted=%d failed=%d datt=%d dfail=%d gatt=%d gfail=%d" % (_att, _fail, _res.attempted, _res.failed, _g_att, _g_fail))
_sys.stdout.write(_buf.getvalue()[-1500:])
_sys.exit(0 if _att > 0 and _fail == 0 else 1)
`
}

export async function runHonestOracle(task: HumanEvalTask, candidate: string, genTests: string[] = []): Promise<HonestResult> {
  const nonce = randomBytes(8).toString('hex')
  const r = await runJailed(buildHonestProgram(task, candidate, nonce, genTests))
  const summary = new RegExp(`HONEST-${nonce} attempted=(\\d+) failed=(\\d+) datt=(\\d+) dfail=(\\d+) gatt=(\\d+) gfail=(\\d+)`).exec(r.stdout)
  if (!summary) {
    // candidate crashed / hung before the oracle scaffold could report
    const detail = (r.stderr || r.stdout).slice(-1500) || 'timed out (no output)'
    return { attempted: -1, failed: -1, failureOutput: detail, pass: false }
  }
  const attempted = Number(summary[1])
  const failed = Number(summary[2])
  // Strip the sentinel line from the feedback shown to the repair loop — the model
  // must never learn the summary format it could try to forge.
  const failureOutput = r.stdout.replace(summary[0], '').slice(-1500)
  return {
    attempted,
    failed,
    failureOutput,
    pass: attempted > 0 && failed === 0,
    dAttempted: Number(summary[3]),
    dFailed: Number(summary[4]),
    gAttempted: Number(summary[5]),
    gFailed: Number(summary[6]),
  }
}

// ---------- CodeT-style test generation (visible info only, BEFORE any candidate) ----------

const testGenInstruction = (count: number, entry: string) =>
  `Read the following Python function signature and docstring. Write exactly ${count} single-line assert statements that test the function \`${entry}\`, based ONLY on the behavior the docstring describes. Each assert must be one physical line of the form \`assert ${entry}(...) == expected\` (or a True/False check). Do NOT implement the function. Do NOT copy examples verbatim if you can test other cases too. Output ONLY the assert lines inside a single \`\`\`python code block.`

/** One LLM call per task, before sampling. Keeps only single-line, paren-balanced
 *  asserts that reference the entry point — malformed lines are dropped here rather
 *  than poisoning every candidate's score identically. */
async function generateTests(cfg: ClientCfg, task: HumanEvalTask, count: number): Promise<{ tests: string[]; completion: Completion }> {
  const c = await complete(cfg, [
    { role: 'user', content: `${testGenInstruction(count, task.entryPoint)}\n\n\`\`\`python\n${task.prompt}\`\`\`` },
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

/** Honest score for ranking: fraction of visible examples passed; a candidate that
 *  crashed before doctest ran ranks below one that ran and failed everything. */
function honestScore(h: HonestResult): number {
  if (h.attempted <= 0) return h.attempted === 0 ? 0 : -1
  return (h.attempted - h.failed) / h.attempted
}

// ---------- the hidden judge (Phase B / calibration ONLY) ----------
// Rig-local rather than the shared runChecker: pass requires the nonce sentinel that
// check() prints AFTER succeeding — exit-0-before-check (sys.exit(0) in a candidate)
// is a fail here, where trusting the exit code alone would score it a pass.

function buildHiddenProgram(task: HumanEvalTask, candidate: string, nonce: string): string {
  return `${task.prompt}\n${candidate}\n\n${task.test}\n\ncheck(${task.entryPoint})\nprint("HIDDEN-${nonce} PASS")\n`
}

async function runHiddenJudge(task: HumanEvalTask, candidate: string): Promise<{ pass: number; detail?: string }> {
  const nonce = randomBytes(8).toString('hex')
  const r = await runJailed(buildHiddenProgram(task, candidate, nonce))
  if (r.exitCode === 0 && r.stdout.includes(`HIDDEN-${nonce} PASS`)) return { pass: 1 }
  return { pass: 0, detail: (r.stderr || r.stdout).slice(-600) || 'timed out (no output)' }
}

// ---------- model client (plain fetch; retries on transient HTTP + empty content) ----------

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
      // Reasoning models starve `content` when reasoning exhausts max_tokens — an
      // empty reply is a transient fault to retry, not a candidate to score.
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

/** Repair replies often echo the failure report in a bare ``` block before the fixed
 *  code — first-fence extraction would grab the echo. Prefer the LAST fenced block
 *  that contains a `def`, else fall back to the shared extractor. Purely mechanical
 *  parsing of the model's own reply; no task information involved. */
function extractRepairCode(reply: string): string {
  const fences = [...reply.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/gi)].map((m) => (m[1] ?? '').trim())
  for (let i = fences.length - 1; i >= 0; i -= 1) {
    if (/(^|\n)\s*def\s+\w+/.test(fences[i] as string)) return fences[i] as string
  }
  return extractCode(reply)
}

// ---------- Phase A: the harness (sees ONLY visible information) ----------

interface HarnessOutcome {
  taskId: string
  samples: string[]
  honest: HonestResult[]
  selectedIdx: number
  repairs: Array<{ code: string; honest: HonestResult }>
  finalCode: string
  /** 'already-passing' | 'no-signal' | 'repaired-pass' | 'rounds-exhausted' */
  repairStop: string
  /** model-generated asserts used as extra oracle signal ([] when TESTGEN off) */
  genTests: string[]
  llmCalls: number
  llmAttempts: number
  tokensIn: number
  tokensOut: number
}

async function runHarnessForTask(cfg: ClientCfg, task: HumanEvalTask, k: number, maxRepairs: number, testGen: number, diverse: boolean): Promise<HarnessOutcome> {
  const basePrompt = `${solveInstruction}\n\n\`\`\`python\n${task.prompt}\`\`\``
  // DIVERSE mode: each sample slot gets a distinct strategy prefix — targets the
  // all-k-samples-fail bucket, where iid resampling keeps drawing the same bug.
  const slotPrompts = diverse ? composeStrategies(basePrompt, k) : Array.from({ length: k }, () => basePrompt)
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

  // Generated tests come from the prompt alone, BEFORE any candidate exists, and
  // are frozen for every sample and repair round of this task.
  let genTests: string[] = []
  if (testGen > 0) {
    const g = await generateTests(cfg, task, testGen)
    track(g.completion)
    genTests = g.tests
  }

  const samples: string[] = []
  for (let i = 0; i < k; i += 1) {
    const c = await complete(cfg, [{ role: 'user', content: slotPrompts[i] as string }])
    track(c)
    samples.push(extractCode(c.content))
  }
  const honest: HonestResult[] = []
  for (const s of samples) honest.push(await runHonestOracle(task, s, genTests))

  // argmax by honest score, first index wins ties (deterministic; with zero
  // coverage every sample ties at 0 → sample 0 = the blind pick)
  let selectedIdx = 0
  for (let i = 1; i < k; i += 1) {
    if (honestScore(honest[i] as HonestResult) > honestScore(honest[selectedIdx] as HonestResult)) selectedIdx = i
  }

  const selHonest = honest[selectedIdx] as HonestResult
  let best = { code: samples[selectedIdx] as string, honest: selHonest }
  const repairs: HarnessOutcome['repairs'] = []
  let repairStop = 'already-passing'
  if (!selHonest.pass) {
    if (selHonest.attempted === 0) {
      repairStop = 'no-signal' // no visible examples → nothing honest to steer on
    } else {
      repairStop = 'rounds-exhausted'
      let current = best
      for (let r = 0; r < maxRepairs; r += 1) {
        const repairPrompt = [
          'Your Python function failed some of the example checks shown in its own docstring.',
          'Here is the task again:',
          '```python',
          task.prompt.trimEnd(),
          '```',
          'Your current attempt:',
          '```python',
          current.code,
          '```',
          'Result of running the docstring examples against your attempt:',
          '```',
          current.honest.failureOutput.trim() || '(the code crashed before the examples could run)',
          '```',
          'Fix the function so the docstring examples pass. Output the COMPLETE corrected function definition inside a single ```python code block. Do not write tests or example calls.',
        ].join('\n')
        const c = await complete(cfg, [{ role: 'user', content: repairPrompt }])
        track(c)
        const code = extractRepairCode(c.content)
        const h = await runHonestOracle(task, code, genTests)
        repairs.push({ code, honest: h })
        if (honestScore(h) > honestScore(current.honest)) current = { code, honest: h }
        if (honestScore(current.honest) > honestScore(best.honest)) best = current
        if (h.pass) {
          repairStop = 'repaired-pass'
          break
        }
      }
    }
  }

  return { taskId: task.taskId, samples, honest, selectedIdx, repairs, finalCode: best.code, repairStop, genTests, llmCalls, llmAttempts, tokensIn, tokensOut }
}

// ---------- statistics: exact sign test to pair with the bootstrap CI ----------
// The percentile bootstrap is anticonservative when few tasks move (4 improved / 0
// regressed at n=164 prints CI [+0.6, +4.9]pp while the exact test says p=0.125).
// The verdict requires BOTH.

function signTestP(deltas: number[]): { pos: number; neg: number; p: number } {
  const pos = deltas.filter((d) => d > 1e-9).length
  const neg = deltas.filter((d) => d < -1e-9).length
  const m = pos + neg
  if (m === 0) return { pos, neg, p: 1 }
  // two-sided exact binomial(m, 0.5) tail from the observed extreme
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

async function calibrate(tasks: HumanEvalTask[]): Promise<void> {
  console.log(`=== CALIBRATION · canonical solutions vs both judges · n=${tasks.length} ===`)
  const usable = tasks.filter((t) => t.canonicalSolution)
  if (usable.length !== tasks.length) console.log(`  WARNING: ${tasks.length - usable.length} task(s) missing canonical_solution`)
  const rows = await pool(usable, 16, async (t) => {
    const full = `${t.prompt}${t.canonicalSolution}`
    const hidden = await runHiddenJudge(t, full)
    const honest = await runHonestOracle(t, full)
    return { id: t.taskId, hidden: hidden.pass, attempted: honest.attempted, failed: honest.failed, honestPass: honest.pass }
  })
  const hiddenPass = rows.filter((r) => r.hidden === 1)
  const covered = rows.filter((r) => r.attempted > 0)
  const falseFail = covered.filter((r) => !r.honestPass)
  console.log(`  hidden judge self-check: ${hiddenPass.length}/${rows.length} canonical solutions pass (must be ~100%)`)
  if (hiddenPass.length < rows.length) console.log(`    hidden FAILS: ${rows.filter((r) => r.hidden !== 1).map((r) => r.id).join(', ')}`)
  console.log(`  honest-oracle coverage: ${covered.length}/${rows.length} tasks have >=1 parseable docstring example`)
  console.log(`    zero-coverage tasks: ${rows.filter((r) => r.attempted === 0).map((r) => r.id).join(', ') || '(none)'}`)
  console.log(`    crashed-oracle tasks (attempted=-1): ${rows.filter((r) => r.attempted < 0).map((r) => r.id).join(', ') || '(none)'}`)
  console.log(`  honest-oracle false-fail on canonical: ${falseFail.length}/${covered.length} covered tasks`)
  if (falseFail.length > 0) console.log(`    false-fail ids: ${falseFail.map((r) => `${r.id}(${r.failed}/${r.attempted})`).join(', ')}`)
  const examplesTotal = covered.reduce((s, r) => s + r.attempted, 0)
  console.log(`  examples per covered task: mean ${(examplesTotal / Math.max(1, covered.length)).toFixed(1)}`)
}

// ---------- main ----------

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`

interface GradedRow extends HarnessOutcome {
  hiddenSamples: number[]
  hiddenFinal: number
}

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 164)
  const k = Number(process.env.K ?? 5)
  const maxRepairs = Number(process.env.REPAIRS ?? 2)
  const offset = Number(process.env.OFFSET ?? 0)
  const temperature = Number(process.env.TEMPERATURE ?? 0.8)
  const model = process.env.WORKER_MODEL ?? 'meta-llama/Meta-Llama-3-8B-Instruct-Lite'
  const base = process.env.ROUTER_BASE ?? 'https://api.together.xyz/v1'
  const solveConc = Number(process.env.CONCURRENCY ?? 6)
  dockerSlots = Number(process.env.DOCKER_CONCURRENCY ?? 6)
  const testGen = Number(process.env.TESTGEN ?? 0)
  const diverse = process.env.DIVERSE === '1'
  const out = process.env.OUT

  const tasks = await loadHumanEval(n, offset)

  if (process.env.CALIBRATE === '1') {
    await calibrate(tasks)
    return
  }

  const cfg: ClientCfg = { base, key: must('TANGLE_API_KEY'), model, maxTokens: Number(process.env.MAX_TOKENS ?? 2500), temperature }

  console.log(`=== HumanEval STRUCTURAL lever · honest docstring oracle · n=${tasks.length} k=${k} repairs<=${maxRepairs} temp=${temperature} testgen=${testGen} diverse=${diverse ? 1 : 0} ===`)
  console.log(`  model=${model}  base=${base}  llm-conc=${solveConc}  docker-conc=${dockerSlots} (global semaphore)`)
  console.log(`  Phase A (harness: sample->honest-select->honest-repair) then Phase B (hidden grading)`)

  // Phase A — all harness decisions locked before any hidden grading. A per-task
  // fault becomes an error row (persisted, excluded from stats), not a lost run;
  // >15% error rate aborts loud since that means the harness itself is broken.
  let done = 0
  let errCount = 0
  const outcomes = await pool(tasks, solveConc, async (task): Promise<HarnessOutcome | { taskId: string; error: string }> => {
    try {
      const o = await runHarnessForTask(cfg, task, k, maxRepairs, testGen, diverse)
      done += 1
      if (out) appendFileSync(`${out}.phaseA`, `${JSON.stringify({ model, temperature, k, maxRepairs, ...o })}\n`)
      process.stderr.write(
        `  [A ${done}/${tasks.length}] ${o.taskId}: sel=${o.selectedIdx} honest=${o.honest.map((h) => honestScore(h).toFixed(2)).join('/')} repairs=${o.repairs.length} stop=${o.repairStop}\n`,
      )
      return o
    } catch (e) {
      errCount += 1
      const error = e instanceof Error ? e.message : String(e)
      if (out) appendFileSync(`${out}.phaseA`, `${JSON.stringify({ model, taskId: task.taskId, error })}\n`)
      process.stderr.write(`  [A ERROR] ${task.taskId}: ${error.slice(0, 160)}\n`)
      if (errCount > Math.max(3, 0.15 * tasks.length)) throw new Error(`aborting: ${errCount} task errors — harness-level fault, not task noise (last: ${error})`)
      return { taskId: task.taskId, error }
    }
  })

  const okOutcomes = outcomes.filter((o): o is HarnessOutcome => !('error' in o))
  const okTasks = okOutcomes.map((o) => tasks.find((t) => t.taskId === o.taskId) as HumanEvalTask)
  if (errCount > 0) console.log(`  WARNING: ${errCount}/${tasks.length} task(s) errored in Phase A — excluded from stats, recorded in ${out ?? '(no OUT set)'}.phaseA`)

  // Phase B — hidden grading of the locked artifacts.
  console.log(`\n▶ Phase B: hidden grading (${okOutcomes.length} tasks × ${k} samples + finals)`)
  const graded: GradedRow[] = await pool(okOutcomes, 16, async (o, ti) => {
    const task = okTasks[ti] as HumanEvalTask
    const hiddenSamples: number[] = []
    for (const s of o.samples) hiddenSamples.push((await runHiddenJudge(task, s)).pass)
    const finalIsSelected = o.finalCode === o.samples[o.selectedIdx]
    const hiddenFinal = finalIsSelected ? (hiddenSamples[o.selectedIdx] as number) : (await runHiddenJudge(task, o.finalCode)).pass
    const g: GradedRow = { ...o, hiddenSamples, hiddenFinal }
    if (out) appendFileSync(out, `${JSON.stringify({ model, temperature, k, maxRepairs, ...g })}\n`)
    return g
  })
  if (out) console.log(`  raw rows appended to ${out} (phase-A rows incl. errors: ${out}.phaseA)`)

  // Estimators (all paired over the same graded tasks).
  const blind1First = graded.map((g) => g.hiddenSamples[0] as number)
  const blind1Mean = graded.map((g) => g.hiddenSamples.reduce((s, x) => s + x, 0) / g.hiddenSamples.length)
  const selected = graded.map((g) => g.hiddenSamples[g.selectedIdx] as number)
  const repaired = graded.map((g) => g.hiddenFinal)
  const oracleK = graded.map((g) => (g.hiddenSamples.some((x) => x === 1) ? 1 : 0))
  // coverage is a task-level property; any non-crashed sample's oracle run proves it
  const covered = graded.map((g) => (g.honest.some((h) => h.attempted > 0) ? 1 : 0))
  const rate = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const llmCallsTotal = graded.reduce((s, g) => s + g.llmCalls, 0)
  const llmAttemptsTotal = graded.reduce((s, g) => s + g.llmAttempts, 0)
  const tokensInTotal = graded.reduce((s, g) => s + g.tokensIn, 0)
  const tokensOutTotal = graded.reduce((s, g) => s + g.tokensOut, 0)
  const repairFired = graded.filter((g) => g.repairs.length > 0)

  console.log(`\n${'='.repeat(78)}`)
  console.log(`RESULTS · HumanEval structural lever · n=${graded.length} · k=${k} · repairs<=${maxRepairs} · temp=${temperature} · ${model}`)
  console.log('='.repeat(78))
  console.log(`  honest-oracle coverage       ${pct(rate(covered))} of tasks (>=1 docstring example)`)
  console.log(`  blind pass@1 (mean of k)     ${pct(rate(blind1Mean))}   [PRIMARY baseline — ${k}-rep estimator]`)
  console.log(`  blind pass@1 (first sample)  ${pct(rate(blind1First))}   [single-rep reference]`)
  console.log(`  selected@1 (honest argmax)   ${pct(rate(selected))}`)
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

  // Subgroup views (report-only; the primary claim is the unconditional lift):
  const coveredIdx = graded.map((_, i) => i).filter((i) => covered[i] === 1)
  if (coveredIdx.length > 0 && coveredIdx.length < graded.length) {
    const pick = (xs: number[]) => coveredIdx.map((i) => xs[i] as number)
    console.log(`\n  COVERED-ONLY subgroup (n=${coveredIdx.length} tasks with visible examples; oracle can only act here):`)
    row('  selected@1 − blind@1', pick(blind1Mean), pick(selected))
    row('  repaired@1 − blind@1', pick(blind1Mean), pick(repaired))
  }

  const verdict = (name: string, r: { l: PairedLift; st: { p: number } }) =>
    `${name}: ${pp(r.l.point)} — ${r.l.low > 0 && r.st.p < 0.05 ? 'POSITIVE (CI excludes 0 AND sign-test p<0.05)' : r.l.high < 0 && r.st.p < 0.05 ? 'NEGATIVE' : 'n.s.'}`
  console.log(`\n  VERDICT: ${verdict('full harness', rep)}; ${verdict('selection alone', sel)}`)
}

main().catch((e) => {
  reapContainers()
  console.error(`hev-structural: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
