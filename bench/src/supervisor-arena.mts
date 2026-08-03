/**
 * Supervisor showdown arena — implements supervisor-lab
 * docs/results/PREREG-supervisor-showdown.md (2026-07-09) EXACTLY. The prereg is
 * the contract: task sets, arms, equal-compute rule, plan contract, and the
 * Phase A/B separation are fixed there and must not be tuned after results.
 *
 * Arms (SET=hard: the 62 problems the committed structural run ended hiddenFinal=0;
 * SET=control: 20 problems it solved — supervision must NOT move these):
 *   A — more-blind-compute control: one fresh structural round (k=5, testgen=6,
 *       <=2 repairs, Llama-3-8B temp 0.8), no evidence shown.
 *   B — self-supervisor: Llama reads the visible evidence package, writes a
 *       diagnosis+plan (no code), then the arm-A loop runs conditioned on it.
 *   C — smart supervisor: glm-4.5-air writes the plan (<=400 tokens by explicit
 *       instruction; fenced code / `def ` lines stripped + planLeaked recorded),
 *       same Llama loop conditioned on it.
 *   D — smart-solo anchor: one glm-4.5-air call, plain solve instruction.
 *
 * Evidence (arms B/C) comes ONLY from the committed run rows (EVIDENCE jsonl):
 * samples, visible-check outputs, authored asserts, repair transcript. The rows'
 * hiddenSamples/hiddenFinal fields are NEVER read into any prompt — hidden info
 * defines the task sets (already hardcoded here) and nothing else.
 *
 * Phase separation (as hev-structural.mts, whose runJailed/nonce-judge/oracle
 * this file replicates — that module runs main() on import, so its internals
 * cannot be imported without side effects):
 *   Phase A: all arm decisions from visible info only; rows appended to OUT.phaseA.
 *   Phase B: rig-local nonce-sentinel hidden judge grades every sample and the
 *   locked final, script-side; graded rows appended to OUT.
 *
 *   cd bench && ARM=A|B|C|D SET=hard|control N=… OUT=/abs/rows.jsonl \
 *   EVIDENCE=/abs/full-llama3-8b-testgen.jsonl HUMANEVAL_GZ=/abs/HumanEval.jsonl.gz \
 *   TANGLE_API_KEY=$TOGETHER_API_KEY ZAI_API_KEY=… npx tsx src/supervisor-arena.mts
 */
import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type HumanEvalTask, basePrompt, extractCode, loadHumanEval } from './benchmarks/humaneval'
import { runBenchRouterTurn } from './router-turn'
import { pool } from './stats.mts'

// ---------- pre-registered task sets (verbatim from the prereg; DO NOT EDIT) ----------

const hardIds = [
  2, 5, 10, 16, 18, 20, 21, 26, 27, 1, 33, 37, 39, 38, 41, 46, 54, 52, 62, 64, 65, 73, 75, 80, 81, 85, 84, 92, 91, 93,
  100, 99, 101, 70, 32, 103, 102, 108, 110, 112, 109, 115, 118, 119, 120, 122, 125, 126, 127, 131, 129, 130, 134, 138,
  135, 137, 140, 145, 148, 157, 160, 163,
].map((n) => `HumanEval/${n}`)

const controlIds = [0, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 17, 19, 22, 23, 24, 25, 28, 29].map((n) => `HumanEval/${n}`)

// ---------- models + list prices (per 1M tokens; printed as list-price $, not billed truth) ----------

const workerModelDefault = 'meta-llama/Meta-Llama-3-8B-Instruct-Lite'
const glmModelDefault = 'glm-4.5-air'
const listPrices: Record<string, { in: number; out: number }> = {
  [workerModelDefault]: { in: 0.1, out: 0.1 },
  [glmModelDefault]: { in: 0.2, out: 1.1 },
}

const dockerImage = 'python:3.12-slim'
const dockerTimeoutMs = Number(process.env.DOCKER_TIMEOUT_MS ?? 20000)

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

// ---------- docker semaphore + jailed runner (replicated from hev-structural) ----------

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

const containerPrefix = `supv-${process.pid}`
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

/** One python program in the jail: --network=none, cpu/mem caps, in-container
 *  `timeout -s KILL`, client timeout, backstop. Docker INFRA faults throw. */
function runJailed(program: string): Promise<JailResult> {
  return withDockerSlot(
    () =>
      new Promise<JailResult>((resolvePromise, reject) => {
        const dir = mkdtempSync(join(tmpdir(), 'supv-'))
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

// ---------- honest oracle (visible docstring doctests + authored asserts; replicated) ----------

interface HonestResult {
  attempted: number
  failed: number
  failureOutput: string
  pass: boolean
  dAttempted?: number
  dFailed?: number
  gAttempted?: number
  gFailed?: number
}

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

async function runHonestOracle(task: HumanEvalTask, candidate: string, genTests: string[] = []): Promise<HonestResult> {
  const nonce = randomBytes(8).toString('hex')
  const r = await runJailed(buildHonestProgram(task, candidate, nonce, genTests))
  const summary = new RegExp(`HONEST-${nonce} attempted=(\\d+) failed=(\\d+) datt=(\\d+) dfail=(\\d+) gatt=(\\d+) gfail=(\\d+)`).exec(r.stdout)
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
    dAttempted: Number(summary[3]),
    dFailed: Number(summary[4]),
    gAttempted: Number(summary[5]),
    gFailed: Number(summary[6]),
  }
}

function honestScore(h: HonestResult): number {
  if (h.attempted <= 0) return h.attempted === 0 ? 0 : -1
  return (h.attempted - h.failed) / h.attempted
}

// ---------- hidden judge (Phase B ONLY; nonce sentinel, not exit-0; replicated) ----------

function buildHiddenProgram(task: HumanEvalTask, candidate: string, nonce: string): string {
  return `${task.prompt}\n${candidate}\n\n${task.test}\n\ncheck(${task.entryPoint})\nprint("HIDDEN-${nonce} PASS")\n`
}

async function runHiddenJudge(task: HumanEvalTask, candidate: string): Promise<{ pass: number; detail?: string }> {
  const nonce = randomBytes(8).toString('hex')
  const r = await runJailed(buildHiddenProgram(task, candidate, nonce))
  if (r.exitCode === 0 && r.stdout.includes(`HIDDEN-${nonce} PASS`)) return { pass: 1 }
  return { pass: 0, detail: (r.stderr || r.stdout).slice(-600) || 'timed out (no output)' }
}

// ---------- model client (plain fetch; retries transient HTTP AND empty content — the
// glm-4.5-air reasoning path starves `content` when reasoning eats max_tokens) ----------

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
    try {
      const system = messages.find((message) => message.role === 'system')?.content
      const result = await runBenchRouterTurn(
        {
          routerBaseUrl: cfg.base,
          routerKey: cfg.key,
          profile: {
            name: 'supervisor-arena-agent',
            model: { provider: 'tangle-router', default: cfg.model },
            ...(system ? { prompt: { systemPrompt: system } } : {}),
          },
          temperature: cfg.temperature,
          maxTokens: cfg.maxTokens,
          timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 240_000),
        },
        { messages: messages.filter((message) => message.role !== 'system') },
      )
      if (result.usage.tokensKnown === false) throw new Error('provider omitted token usage')
      const content = result.finalText
      if (content.trim() === '') {
        lastErr = 'empty content'
        continue
      }
      return {
        content,
        attempts: attempt,
        tokensIn: result.usage.input,
        tokensOut: result.usage.output,
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(`completion failed after retries: ${lastErr}`)
}

// zai 429s above ~4 concurrent requests — a dedicated semaphore, independent of the
// task pool width, caps every glm call (plans in C, solo solves in D).
let zaiSlots = 4
let zaiInFlight = 0
const zaiWaiters: Array<() => void> = []
async function withZaiSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (zaiInFlight >= zaiSlots) await new Promise<void>((r) => zaiWaiters.push(r))
  zaiInFlight += 1
  try {
    return await fn()
  } finally {
    zaiInFlight -= 1
    zaiWaiters.shift()?.()
  }
}

// ---------- CodeT-style test generation (visible info only, BEFORE any candidate; replicated) ----------

const testGenInstruction = (count: number, entry: string) =>
  `Read the following Python function signature and docstring. Write exactly ${count} single-line assert statements that test the function \`${entry}\`, based ONLY on the behavior the docstring describes. Each assert must be one physical line of the form \`assert ${entry}(...) == expected\` (or a True/False check). Do NOT implement the function. Do NOT copy examples verbatim if you can test other cases too. Output ONLY the assert lines inside a single \`\`\`python code block.`

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

/** Prefer the LAST fenced block containing a `def` (repair replies echo the failure
 *  report in a bare fence first), else the shared extractor. */
function extractRepairCode(reply: string): string {
  const fences = [...reply.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/gi)].map((m) => (m[1] ?? '').trim())
  for (let i = fences.length - 1; i >= 0; i -= 1) {
    if (/(^|\n)\s*def\s+\w+/.test(fences[i] as string)) return fences[i] as string
  }
  return extractCode(reply)
}

// ---------- evidence package (arms B/C) — visible fields of the committed run rows ONLY ----------

/** The visible slice of a committed run row. hiddenSamples/hiddenFinal exist in the
 *  file but are deliberately absent here: parsing narrows to these fields so hidden
 *  info cannot reach a prompt by accident. */
interface EvidenceRow {
  taskId: string
  samples: string[]
  honest: HonestResult[]
  repairs: Array<{ code: string; honest: HonestResult }>
  genTests: string[]
  selectedIdx: number
}

function loadEvidence(path: string): Map<string, EvidenceRow> {
  const rows = new Map<string, EvidenceRow>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    const d = JSON.parse(line) as EvidenceRow & Record<string, unknown>
    if (!d.taskId || !Array.isArray(d.samples) || !Array.isArray(d.honest)) throw new Error(`malformed evidence row: ${line.slice(0, 120)}`)
    rows.set(d.taskId, {
      taskId: d.taskId,
      samples: d.samples,
      honest: d.honest,
      repairs: Array.isArray(d.repairs) ? d.repairs : [],
      genTests: Array.isArray(d.genTests) ? d.genTests : [],
      selectedIdx: Number(d.selectedIdx ?? 0),
    })
  }
  return rows
}

const clip = (s: string, n: number): string => {
  const t = s.trim()
  return t.length <= n ? t : `${t.slice(0, n)} …[+${t.length - n} chars trimmed]`
}

const firstLines = (code: string, n = 2): string =>
  code
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(0, n)
    .join(' | ')

const checkStatus = (h: HonestResult): string =>
  h.attempted < 0
    ? 'crashed before the visible checks could run'
    : h.attempted === 0
      ? 'no visible checks were runnable'
      : h.pass
        ? `passed all ${h.attempted} visible checks`
        : `failed ${h.failed}/${h.attempted} visible checks`

/** Problem prompt + per-attempt one-line summary (first 2 code lines + trimmed
 *  visible-check output) + authored asserts + repair outcomes, bounded to
 *  ~3000 tokens (maxChars chars). Visible information only. */
function renderEvidence(task: HumanEvalTask, ev: EvidenceRow, maxChars: number): string {
  const parts: string[] = []
  parts.push('The problem:', '```python', task.prompt.trimEnd(), '```', '')
  parts.push(`Previous attempts by the programmer, each with the result of the VISIBLE checks (docstring examples + the authored asserts listed below):`)
  ev.samples.forEach((code, i) => {
    const h = ev.honest[i] ?? { attempted: -1, failed: -1, failureOutput: '', pass: false }
    parts.push(`[attempt ${i + 1}]${i === ev.selectedIdx ? ' (selected as best)' : ''} starts: ${firstLines(code)}`)
    parts.push(`  result: ${checkStatus(h)}`)
    const fo = clip(h.failureOutput ?? '', 350)
    if (fo !== '') parts.push(`  check output: ${fo}`)
  })
  parts.push('', 'Authored asserts used as visible checks:')
  for (const t of ev.genTests) parts.push(`  ${t}`)
  if (ev.genTests.length === 0) parts.push('  (none survived filtering)')
  if (ev.repairs.length > 0) {
    parts.push('', 'Repair attempts (revisions of the selected attempt, steered by the check output):')
    ev.repairs.forEach((r, i) => {
      parts.push(`[repair ${i + 1}] starts: ${firstLines(r.code)}`)
      parts.push(`  result: ${checkStatus(r.honest)}`)
      const fo = clip(r.honest.failureOutput ?? '', 350)
      if (fo !== '') parts.push(`  check output: ${fo}`)
    })
  } else {
    parts.push('', 'No repair attempts were made on this problem.')
  }
  let text = parts.join('\n')
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…[evidence truncated at ${maxChars} chars]`
  return text
}

// ---------- supervisor plan (arms B/C): diagnose + steer, never solve ----------

const planContract =
  "Diagnose why every attempt failed and write a plan: the specific mistake, the correct approach, edge cases to handle. You may include at most 3 short illustrative expressions. Do NOT write the function; any fenced code block or line starting with 'def ' disqualifies the plan. Keep the plan under 400 tokens."

const supervisorPrompt = (evidence: string): string =>
  ["You are reviewing a programmer's previous attempts at a Python problem.", '', evidence, '', planContract].join('\n')

/** Enforce the no-code contract: strip fenced blocks and `def ` lines, record the
 *  leak (leak RATE is a pre-registered measurement, so the stripped plan is still
 *  used rather than the task being dropped). */
function stripPlanCode(raw: string): { plan: string; leaked: boolean } {
  let leaked = false
  let s = raw
  if (s.includes('```')) {
    // an unterminated fence leaks to end-of-text, so strip greedily to the closer or EOF
    const stripped = s.replace(/```[a-zA-Z]*[^\n]*\n?[\s\S]*?(?:```|$)/g, '')
    if (stripped !== s) leaked = true
    s = stripped
  }
  const lines = s.split('\n')
  const kept = lines.filter((l) => !/^\s*def\s/.test(l))
  if (kept.length !== lines.length) leaked = true
  return { plan: kept.join('\n').trim(), leaked }
}

// ---------- Phase A worker loop — the hev-structural recipe verbatim (k samples temp 0.8,
// fresh testgen, honest argmax select, <=R honest-grounded repairs); arms B/C prepend the plan ----------

interface WorkerOutcome {
  samples: string[]
  honest: HonestResult[]
  selectedIdx: number
  repairs: Array<{ code: string; honest: HonestResult }>
  finalCode: string
  repairStop: string
  genTests: string[]
  calls: number
  attempts: number
  tokensIn: number
  tokensOut: number
}

async function runWorkerLoop(cfg: ClientCfg, task: HumanEvalTask, k: number, maxRepairs: number, testGen: number, planPreamble: string | null): Promise<WorkerOutcome> {
  const samplePrompt = planPreamble === null ? basePrompt(task) : `${planPreamble}\n\n${basePrompt(task)}`
  let calls = 0
  let attempts = 0
  let tokensIn = 0
  let tokensOut = 0
  const track = (c: Completion) => {
    calls += 1
    attempts += c.attempts
    tokensIn += c.tokensIn
    tokensOut += c.tokensOut
  }

  // asserts regenerated FRESH for this arm's round, from the prompt alone (plan-free:
  // testgen is oracle authorship, not solving — conditioning it would contaminate the oracle)
  let genTests: string[] = []
  if (testGen > 0) {
    const g = await generateTests(cfg, task, testGen)
    track(g.completion)
    genTests = g.tests
  }

  const samples: string[] = []
  for (let i = 0; i < k; i += 1) {
    const c = await complete(cfg, [{ role: 'user', content: samplePrompt }])
    track(c)
    samples.push(extractCode(c.content))
  }
  const honest: HonestResult[] = []
  for (const s of samples) honest.push(await runHonestOracle(task, s, genTests))

  let selectedIdx = 0
  for (let i = 1; i < k; i += 1) {
    if (honestScore(honest[i] as HonestResult) > honestScore(honest[selectedIdx] as HonestResult)) selectedIdx = i
  }

  const selHonest = honest[selectedIdx] as HonestResult
  let best = { code: samples[selectedIdx] as string, honest: selHonest }
  const repairs: WorkerOutcome['repairs'] = []
  let repairStop = 'already-passing'
  if (!selHonest.pass) {
    if (selHonest.attempted === 0) {
      repairStop = 'no-signal'
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

  return { samples, honest, selectedIdx, repairs, finalCode: best.code, repairStop, genTests, calls, attempts, tokensIn, tokensOut }
}

// ---------- rows ----------

interface ModelSpend {
  model: string
  calls: number
  attempts: number
  tokensIn: number
  tokensOut: number
}

interface ArenaRow {
  arm: string
  set: string
  taskId: string
  k: number
  maxRepairs: number
  temperature: number
  planRaw: string | null
  plan: string | null
  planLeaked: boolean | null
  planEmptyAfterStrip: boolean | null
  evidenceChars: number | null
  genTests: string[]
  samples: string[]
  honest: HonestResult[]
  selectedIdx: number
  repairs: Array<{ code: string; honest: HonestResult }>
  finalCode: string
  repairStop: string
  worker: ModelSpend
  supervisor: ModelSpend | null
}

interface GradedRow extends ArenaRow {
  hiddenSamples: number[]
  hiddenFinal: number
}

// ---------- main ----------

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

function costLine(s: ModelSpend): string {
  const p = listPrices[s.model]
  const dollars = p ? (s.tokensIn / 1e6) * p.in + (s.tokensOut / 1e6) * p.out : null
  const d = dollars === null ? '$=null (no list price)' : `$${dollars.toFixed(4)} (list $${p?.in}/1M in, $${p?.out}/1M out)`
  return `${s.model}: in=${s.tokensIn} out=${s.tokensOut} calls=${s.calls} (attempts incl. retries=${s.attempts}) → ${d}`
}

async function main(): Promise<void> {
  const arm = must('ARM').toUpperCase()
  if (!['A', 'B', 'C', 'D'].includes(arm)) throw new Error(`ARM must be A|B|C|D, got ${arm}`)
  const setName = must('SET').toLowerCase()
  if (!['hard', 'control'].includes(setName)) throw new Error(`SET must be hard|control, got ${setName}`)
  const ids = (setName === 'hard' ? hardIds : controlIds).slice(0, Number(process.env.N ?? Number.POSITIVE_INFINITY))
  const out = must('OUT')

  const k = Number(process.env.K ?? 5)
  const maxRepairs = Number(process.env.REPAIRS ?? 2)
  const testGen = Number(process.env.TESTGEN ?? 6)
  const temperature = Number(process.env.TEMPERATURE ?? 0.8)
  const supTemperature = Number(process.env.SUPERVISOR_TEMPERATURE ?? 0.2)
  const solveConc = Number(process.env.CONCURRENCY ?? 6)
  dockerSlots = Number(process.env.DOCKER_CONCURRENCY ?? 6)
  zaiSlots = Math.min(4, Number(process.env.ZAI_CONCURRENCY ?? 4))
  const evidenceMaxChars = Number(process.env.EVIDENCE_MAX_CHARS ?? 12000)

  const workerModel = process.env.WORKER_MODEL ?? workerModelDefault
  const workerBase = process.env.ROUTER_BASE ?? 'https://api.together.xyz/v1'
  const glmModel = process.env.GLM_MODEL ?? glmModelDefault
  const glmBase = process.env.ZAI_BASE ?? 'https://api.z.ai/api/coding/paas/v4'
  const glmMaxTokens = Math.max(8000, Number(process.env.ZAI_MAX_TOKENS ?? 8000))

  const needsWorker = arm !== 'D'
  const needsGlm = arm === 'C' || arm === 'D'
  const workerCfg: ClientCfg | null = needsWorker
    ? { base: workerBase, key: process.env.TANGLE_API_KEY ?? must('TOGETHER_API_KEY'), model: workerModel, maxTokens: Number(process.env.MAX_TOKENS ?? 2500), temperature }
    : null
  const glmCfg: ClientCfg | null = needsGlm ? { base: glmBase, key: must('ZAI_API_KEY'), model: glmModel, maxTokens: glmMaxTokens, temperature: supTemperature } : null

  const all = await loadHumanEval(164, 0)
  const byId = new Map(all.map((t) => [t.taskId, t]))
  const tasks = ids.map((id) => {
    const t = byId.get(id)
    if (!t) throw new Error(`task ${id} not found in HumanEval`)
    return t
  })

  const needsEvidence = arm === 'B' || arm === 'C'
  let evidence: Map<string, EvidenceRow> | null = null
  if (needsEvidence) {
    evidence = loadEvidence(must('EVIDENCE'))
    for (const id of ids) if (!evidence.has(id)) throw new Error(`evidence row missing for ${id}`)
  }

  console.log(`=== supervisor-arena · ARM=${arm} SET=${setName} n=${tasks.length} · k=${k} repairs<=${maxRepairs} testgen=${testGen} temp=${temperature} ===`)
  console.log(`  worker=${needsWorker ? `${workerModel} @ ${workerBase}` : '(none)'}  glm=${needsGlm ? `${glmModel} @ ${glmBase} maxTokens=${glmMaxTokens} temp=${supTemperature} conc<=${zaiSlots}` : '(none)'}`)
  console.log(`  llm-conc=${solveConc} docker-conc=${dockerSlots}  evidence=${needsEvidence ? `${process.env.EVIDENCE} (<=${evidenceMaxChars} chars rendered)` : '(none)'}`)
  console.log(`  Phase A (visible-only arm decisions) → Phase B (hidden nonce-judge grading, script-side)`)

  // Phase A — per-task faults become error rows (persisted, excluded), >15% aborts loud.
  let done = 0
  let errCount = 0
  const outcomes = await pool(tasks, solveConc, async (task): Promise<ArenaRow | { taskId: string; error: string }> => {
    try {
      let planRaw: string | null = null
      let plan: string | null = null
      let planLeaked: boolean | null = null
      let planEmptyAfterStrip: boolean | null = null
      let evidenceChars: number | null = null
      let supervisor: ModelSpend | null = null

      if (arm === 'B' || arm === 'C') {
        const ev = (evidence as Map<string, EvidenceRow>).get(task.taskId) as EvidenceRow
        const rendered = renderEvidence(task, ev, evidenceMaxChars)
        evidenceChars = rendered.length
        const supCfg: ClientCfg = arm === 'C' ? (glmCfg as ClientCfg) : { ...(workerCfg as ClientCfg), temperature: supTemperature }
        const call = () => complete(supCfg, [{ role: 'user', content: supervisorPrompt(rendered) }])
        const c = arm === 'C' ? await withZaiSlot(call) : await call()
        supervisor = { model: supCfg.model, calls: 1, attempts: c.attempts, tokensIn: c.tokensIn, tokensOut: c.tokensOut }
        planRaw = c.content
        const stripped = stripPlanCode(c.content)
        plan = stripped.plan
        planLeaked = stripped.leaked
        planEmptyAfterStrip = stripped.leaked && stripped.plan === ''
      }

      let row: ArenaRow
      if (arm === 'D') {
        const c = await withZaiSlot(() => complete(glmCfg as ClientCfg, [{ role: 'user', content: basePrompt(task) }]))
        const code = extractCode(c.content)
        row = {
          arm, set: setName, taskId: task.taskId, k: 1, maxRepairs: 0, temperature: supTemperature,
          planRaw: null, plan: null, planLeaked: null, planEmptyAfterStrip: null, evidenceChars: null,
          genTests: [], samples: [code], honest: [], selectedIdx: 0, repairs: [], finalCode: code, repairStop: 'solo',
          worker: { model: glmModel, calls: 1, attempts: c.attempts, tokensIn: c.tokensIn, tokensOut: c.tokensOut },
          supervisor: null,
        }
      } else {
        // A plan stripped to nothing carries no steering signal: the loop runs
        // unconditioned (= arm A) and the row records the degenerate plan.
        const preamble = plan !== null && plan !== '' ? `A reviewer analyzed previous failed attempts: ${plan}. Follow this guidance.` : null
        const w = await runWorkerLoop(workerCfg as ClientCfg, task, k, maxRepairs, testGen, preamble)
        row = {
          arm, set: setName, taskId: task.taskId, k, maxRepairs, temperature,
          planRaw, plan, planLeaked, planEmptyAfterStrip, evidenceChars,
          genTests: w.genTests, samples: w.samples, honest: w.honest, selectedIdx: w.selectedIdx,
          repairs: w.repairs, finalCode: w.finalCode, repairStop: w.repairStop,
          worker: { model: workerModel, calls: w.calls, attempts: w.attempts, tokensIn: w.tokensIn, tokensOut: w.tokensOut },
          supervisor,
        }
      }
      done += 1
      appendFileSync(`${out}.phaseA`, `${JSON.stringify(row)}\n`)
      process.stderr.write(
        `  [A ${done}/${tasks.length}] ${task.taskId}: sel=${row.selectedIdx} honest=${row.honest.map((h) => honestScore(h).toFixed(2)).join('/')} repairs=${row.repairs.length} stop=${row.repairStop}${row.planLeaked === null ? '' : ` planLeaked=${row.planLeaked}`}\n`,
      )
      return row
    } catch (e) {
      errCount += 1
      const error = e instanceof Error ? e.message : String(e)
      appendFileSync(`${out}.phaseA`, `${JSON.stringify({ arm, set: setName, taskId: task.taskId, error })}\n`)
      process.stderr.write(`  [A ERROR] ${task.taskId}: ${error.slice(0, 160)}\n`)
      if (errCount > Math.max(3, 0.15 * tasks.length)) throw new Error(`aborting: ${errCount} task errors — harness-level fault, not task noise (last: ${error})`)
      return { taskId: task.taskId, error }
    }
  })

  const okRows = outcomes.filter((o): o is ArenaRow => !('error' in o))
  if (errCount > 0) console.log(`  WARNING: ${errCount}/${tasks.length} task(s) errored in Phase A — excluded from stats, recorded in ${out}.phaseA`)

  console.log(`\n▶ Phase B: hidden grading (${okRows.length} tasks × samples + finals)`)
  const graded: GradedRow[] = await pool(okRows, 16, async (o) => {
    const task = byId.get(o.taskId) as HumanEvalTask
    const hiddenSamples: number[] = []
    for (const s of o.samples) hiddenSamples.push((await runHiddenJudge(task, s)).pass)
    const finalIsSelected = o.finalCode === o.samples[o.selectedIdx]
    const hiddenFinal = finalIsSelected ? (hiddenSamples[o.selectedIdx] as number) : (await runHiddenJudge(task, o.finalCode)).pass
    const g: GradedRow = { ...o, hiddenSamples, hiddenFinal }
    appendFileSync(out, `${JSON.stringify(g)}\n`)
    return g
  })
  console.log(`  raw rows appended to ${out} (phase-A rows incl. errors: ${out}.phaseA)`)

  // ---------- per-arm summary ----------
  const passes = graded.filter((g) => g.hiddenFinal === 1)
  const rateName = setName === 'hard' ? 'rescue rate' : 'retention rate'
  console.log(`\n${'='.repeat(78)}`)
  console.log(`RESULTS · supervisor-arena · ARM=${arm} SET=${setName} n=${graded.length}`)
  console.log('='.repeat(78))
  console.log(`  per-problem hiddenFinal (paired analysis input):`)
  console.log(`    ${graded.map((g) => `${g.taskId.replace('HumanEval/', 'HE')}=${g.hiddenFinal}`).join(' ')}`)
  console.log(`  ${rateName}: ${passes.length}/${graded.length} = ${pct(graded.length > 0 ? passes.length / graded.length : 0)}${setName === 'hard' ? '  (every task in this set was hiddenFinal=0 in the committed run)' : '  (every task in this set was hiddenFinal=1 in the committed run)'}`)
  if (arm === 'B' || arm === 'C') {
    const leaked = graded.filter((g) => g.planLeaked === true)
    const emptied = graded.filter((g) => g.planEmptyAfterStrip === true)
    console.log(`  plan leak rate: ${leaked.length}/${graded.length} plans contained code (stripped before use; ${emptied.length} stripped to empty → ran unconditioned)`)
    const evChars = graded.map((g) => g.evidenceChars ?? 0)
    if (evChars.length > 0) console.log(`  evidence rendered chars: min=${Math.min(...evChars)} max=${Math.max(...evChars)} (cap ${evidenceMaxChars})`)
  }
  const spend = new Map<string, ModelSpend>()
  const add = (s: ModelSpend | null) => {
    if (!s) return
    const cur = spend.get(s.model) ?? { model: s.model, calls: 0, attempts: 0, tokensIn: 0, tokensOut: 0 }
    cur.calls += s.calls
    cur.attempts += s.attempts
    cur.tokensIn += s.tokensIn
    cur.tokensOut += s.tokensOut
    spend.set(s.model, cur)
  }
  for (const g of graded) {
    add(g.worker)
    add(g.supervisor)
  }
  console.log(`  spend per model:`)
  for (const s of spend.values()) console.log(`    ${costLine(s)}`)
  const stops = [...new Set(graded.map((g) => g.repairStop))]
  console.log(`  repair stops: ${stops.map((st) => `${st}=${graded.filter((g) => g.repairStop === st).length}`).join(', ')}`)
}

main().catch((e) => {
  reapContainers()
  console.error(`supervisor-arena: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
