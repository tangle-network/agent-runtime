/**
 * OBJECT-OF-IMPROVEMENT ablation on HumanEval — the head-on test of the claim our
 * whole self-improvement line rests on: at EQUAL budget, does adding CAPABILITY
 * (a real code-execution tool) beat adding IMPROVER-cleverness (blind prompt
 * self-refinement)? Both arms get the same model, the same K rounds per task, the
 * same held-out tasks. The ONLY difference is what the budget buys:
 *
 *   IMPROVER arm  — K rounds of "critique your own function and rewrite it",
 *                   with NO execution. The classic reflect-without-a-tool loop.
 *   CAPABILITY arm — K rounds WITH a `run_python` tool: the agent executes its
 *                   function on inputs it chooses, sees real output/errors, fixes.
 *
 * Grading is a DETERMINISTIC hidden test (never shown): the task's own `check`.
 * If the capability arm wins the held-out pass rate, the object of improvement
 * (what you can DO) dominates the improver (how cleverly you rewrite) — the
 * finding the prompt-only self-improvement runs kept nulling on.
 *
 * Fast by construction: HumanEval tasks are tiny, graded in an isolated Python
 * container with a hard timeout — seconds per task. Paired
 * McNemar over the per-task pass/fail difference gives the significance.
 *
 * Run from cwd=bench:  env WORKER_MODEL=google/gemini-2.5-flash-lite N=60 K=3 \
 *   REPS=2 node_modules/.bin/tsx src/humaneval-object-ablation.mts
 */
import {
  loadHumanEval,
  extractCode,
  runPythonProgram,
  type HumanEvalTask,
} from './benchmarks/humaneval'

const ROUTER = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
const KEY = process.env.TANGLE_API_KEY
if (!KEY) throw new Error('TANGLE_API_KEY required')
const MODEL = process.env.WORKER_MODEL ?? 'google/gemini-2.5-flash-lite'
const N = Number(process.env.N ?? 60)
const OFFSET = Number(process.env.OFFSET ?? 0)
const K = Number(process.env.K ?? 3) // rounds/budget per task (equal for both arms)
const REPS = Number(process.env.REPS ?? 2)
const CONC = Number(process.env.CONCURRENCY ?? 6)
const EXEC_TIMEOUT = Number(process.env.EXEC_TIMEOUT_MS ?? 8000)

interface ChatMsg { role: string; content: string; tool_calls?: unknown; tool_call_id?: string; name?: string }
interface Tool { type: 'function'; function: { name: string; description: string; parameters: unknown } }

async function router(messages: ChatMsg[], tools?: Tool[]): Promise<{ content: string; toolCalls: { id: string; name: string; args: Record<string, unknown> }[] }> {
  const body: Record<string, unknown> = { model: MODEL, messages, temperature: 0.4 }
  if (tools) { body.tools = tools; body.tool_choice = 'auto' }
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(`${ROUTER}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
    } catch (e) { if (attempt >= 5) throw e; await sleep(800 * 2 ** attempt); continue }
    if ([408, 429, 500, 502, 503, 504, 520, 522, 524].includes(res.status)) { if (attempt >= 5) throw new Error(`router ${res.status} exhausted`); await sleep(800 * 2 ** attempt); continue }
    if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const j = (await res.json()) as { choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] }
    const m = j.choices?.[0]?.message
    const toolCalls = (m?.tool_calls ?? []).map((t) => { let args: Record<string, unknown> = {}; try { args = JSON.parse(t.function.arguments) } catch { /* keep {} */ } return { id: t.id, name: t.function.name, args } })
    return { content: m?.content ?? '', toolCalls }
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Run model-written Python in the shared networkless, resource-capped container. */
async function runPython(program: string): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const result = await runPythonProgram(program, EXEC_TIMEOUT)
  return {
    stdout: result.stdout.slice(0, 2000),
    stderr: result.stderr.slice(0, 2000),
    ok: result.exitCode === 0,
  }
}

/** The HIDDEN judge: candidate full function + the task's own check. Never shown. */
async function judge(task: HumanEvalTask, candidate: string): Promise<boolean> {
  if (!candidate.trim()) return false
  const program = `${candidate}\n\n${task.test}\n\ncheck(${task.entryPoint})\nprint("PASS")\n`
  const r = await runPython(program)
  return r.ok && r.stdout.includes('PASS')
}

const SYSTEM = 'You are an expert Python programmer. Output the COMPLETE function definition (signature + body, plus any imports) in a single ```python block. No tests, no prose outside the block.'
const userPrompt = (t: HumanEvalTask) => `Complete this function:\n\n\`\`\`python\n${t.prompt}\`\`\``

/** IMPROVER arm: K rounds of blind self-refinement — no execution, just "review and rewrite". */
async function improverArm(task: HumanEvalTask): Promise<string> {
  const messages: ChatMsg[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(task) }]
  let code = ''
  for (let round = 0; round < K; round++) {
    const { content } = await router(messages)
    code = extractCode(content) || content
    if (round < K - 1) {
      messages.push({ role: 'assistant', content })
      messages.push({ role: 'user', content: 'Carefully review your function for correctness bugs and edge cases. If it can be improved, output the corrected COMPLETE function in a python block; if it is already correct, output it again unchanged.' })
    }
  }
  return code
}

const RUN_TOOL: Tool = { type: 'function', function: { name: 'run_python', description: 'Execute a Python snippet and return its stdout/stderr. Use it to test your function on example inputs from the docstring before finalizing.', parameters: { type: 'object', properties: { code: { type: 'string', description: 'python source to run' } }, required: ['code'] } } }

/** CAPABILITY arm: K rounds WITH a real code-execution tool — write, run, see real output, fix. */
async function capabilityArm(task: HumanEvalTask): Promise<string> {
  const messages: ChatMsg[] = [
    { role: 'system', content: `${SYSTEM}\nYou have a run_python tool: test your function on the docstring's example inputs before giving your final answer. Fix any failures you observe.` },
    { role: 'user', content: userPrompt(task) },
  ]
  let code = ''
  // (K-1) tool-exploration rounds + 1 forced final answer = K calls total, matching
  // the improver arm's K blind-refine rounds (equal budget).
  for (let round = 0; round < Math.max(1, K - 1); round++) {
    const { content, toolCalls } = await router(messages, [RUN_TOOL])
    if (content && extractCode(content)) code = extractCode(content)
    messages.push({ role: 'assistant', content: content || '', ...(toolCalls.length ? { tool_calls: toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}) })
    if (toolCalls.length) {
      for (const tc of toolCalls) {
        const snippet = String(tc.args.code ?? '')
        const r = await runPython(snippet)
        messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: `stdout:\n${r.stdout}\nstderr:\n${r.stderr}\nexit_ok=${r.ok}` })
      }
    } else {
      messages.push({ role: 'user', content: 'Test your function with run_python on the docstring examples before finalizing.' })
    }
  }
  // FAIR FINAL ANSWER: the tool rounds are exploration; force one no-tool call to
  // emit the complete function. Without this, an agent that ends mid-tool-call
  // yields empty code and is unfairly scored 0 (an extraction artifact, not a
  // real "the tool hurt" signal). Only override if it produces a real block.
  {
    messages.push({ role: 'user', content: 'Now output your FINAL complete function in a single ```python block, no tools, no prose.' })
    const { content } = await router(messages)
    const finalCode = extractCode(content)
    if (finalCode.trim()) code = finalCode
  }
  return code
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i) }
  }))
  return out
}

// McNemar exact (paired): b = capability-only wins, c = improver-only wins.
function mcnemarP(b: number, c: number): number {
  const n = b + c; if (n === 0) return 1
  const k = Math.min(b, c)
  const lf = (x: number) => { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s }
  let tail = 0; for (let i = 0; i <= k; i++) tail += Math.exp(lf(n) - lf(i) - lf(n - i) - n * Math.log(2))
  return Math.min(1, 2 * tail)
}

async function main(): Promise<void> {
  if (['1', 'true'].includes((process.env.SMOKE ?? '').toLowerCase())) { console.error('SMOKE ok: humaneval-object-ablation loaded'); return }
  const tasks = await loadHumanEval(N, OFFSET)
  console.error(`=== OBJECT-OF-IMPROVEMENT ablation · HumanEval n=${tasks.length} (offset ${OFFSET}) · model=${MODEL} · K=${K} rounds · reps=${REPS} · equal budget ===`)
  // self-check the local grader on the gold solution of task 0 (never shown to the model)
  if (tasks[0]?.canonicalSolution) {
    const gold = `${tasks[0].prompt}${tasks[0].canonicalSolution}`
    console.error(`  grader self-check (gold passes): ${await judge(tasks[0], gold)}`)
  }

  // per (task, rep): run both arms; record pass/fail.
  const units = tasks.flatMap((task) => Array.from({ length: REPS }, (_, rep) => ({ task, rep })))
  let done = 0
  let capEmpty = 0
  const results = await pool(units, CONC, async ({ task }) => {
    // Per-unit resilience: a transient model failure (e.g. a weak model emitting a
    // malformed tool call → router 400) scores that arm 0 for this unit, never
    // crashes the whole run. Both arms wrapped identically so neither is favored.
    const safe = async (fn: () => Promise<string>) => { try { return await fn() } catch { return '' } }
    const [impCode, capCode] = await Promise.all([safe(() => improverArm(task)), safe(() => capabilityArm(task))])
    const [imp, cap] = await Promise.all([judge(task, impCode), judge(task, capCode)])
    done++
    // AUTOPSY: a capability-arm failure with EMPTY final code is an extraction
    // artifact (ended mid-tool-call, never emitted a final function), NOT a real
    // "the tool hurt" signal. Count it so the effect can be separated.
    if (!cap && !capCode.trim()) { capEmpty++; if (imp) console.error(`  [cap-empty] ${task.taskId} (improver passed)`) }
    if (done % 20 === 0) console.error(`  ${done}/${units.length} units`)
    return { id: task.taskId, imp, cap }
  })
  console.error(`  capability-arm empty-final-code (artifact) count: ${capEmpty}/${results.length}`)

  const impPass = results.filter((r) => r.imp).length
  const capPass = results.filter((r) => r.cap).length
  const b = results.filter((r) => r.cap && !r.imp).length // capability-only wins
  const c = results.filter((r) => !r.cap && r.imp).length // improver-only wins
  const p = mcnemarP(b, c)
  const n = results.length
  const liftPp = ((capPass - impPass) / n) * 100

  console.log('')
  console.log('=== RESULT (held-out HumanEval, equal budget) ===')
  console.log(`  IMPROVER   (blind self-refine, no tool): ${impPass}/${n} = ${((impPass / n) * 100).toFixed(1)}%`)
  console.log(`  CAPABILITY (self-built execution tool)  : ${capPass}/${n} = ${((capPass / n) * 100).toFixed(1)}%`)
  console.log(`  lift = ${liftPp >= 0 ? '+' : ''}${liftPp.toFixed(1)}pp   paired McNemar: capability-only=${b} improver-only=${c} p=${p.toFixed(4)}`)
  console.log(`  verdict: ${p < 0.05 && capPass > impPass ? 'CAPABILITY > IMPROVER (significant)' : p < 0.05 && impPass > capPass ? 'IMPROVER > CAPABILITY (significant)' : 'no significant difference'}`)
}
main().catch((e) => { console.error('MAIN:', e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1) })
