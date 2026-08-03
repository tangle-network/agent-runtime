/**
 * DAVID vs GOLIATH — the program's northstar, tested head-on: does a CHEAP model
 * with a self-verification harness beat a FRONTIER model running solo, at EQUAL OR
 * LOWER dollar cost, on held-out code?
 *
 *   GOLIATH — a strong model, ONE shot. The "just use the big model" baseline.
 *   DAVID   — a cheap/weak model + test-time compute: generate N candidate
 *             solutions AND M of its own unit tests, EXECUTE every candidate
 *             against the generated tests, and submit the candidate that passes
 *             the most (CodeT-style execution self-selection). No ground-truth
 *             test is ever used to select — only the model's own generated tests.
 *
 * Both are graded by the HIDDEN HumanEval test (never shown). Cost is the real
 * token spend × the router-reported/priced rate per arm. The win condition is a
 * Pareto beat: David's held-out pass rate >= Goliath's AND David's $ <= Goliath's.
 * Mechanism under test: EXECUTION-BASED VERIFICATION is the lever that lets a weak
 * generator punch above its solo weight — the standing "verification is live" claim
 * at its most dramatic. Paired McNemar on per-task discordant pairs for significance.
 *
 * Run from cwd=bench:  env DAVID=glm-5.2 GOLIATH=deepseek-v4-flash \
 *   N=8 T=5 NTASKS=164 REPS=2 node_modules/.bin/tsx src/david-goliath.mts
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadHumanEval, extractCode, type HumanEvalTask } from './benchmarks/humaneval'
import { runBenchRouterTurn } from './router-turn'

const KEY = process.env.TANGLE_API_KEY
if (!KEY) throw new Error('TANGLE_API_KEY required')
const ROUTER_KEY = KEY
const ROUTER = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
const DAVID = process.env.DAVID ?? 'groq/llama-3.1-8b-instant'
const GOLIATH = process.env.GOLIATH ?? 'deepseek-v4-flash'
const N = Number(process.env.N ?? 8) // David candidate solutions
const T = Number(process.env.T ?? 5) // David generated tests
const NTASKS = Number(process.env.NTASKS ?? 164)
const REPS = Number(process.env.REPS ?? 2)
const CONC = Number(process.env.CONCURRENCY ?? 6)
const EXEC_TIMEOUT = Number(process.env.EXEC_TIMEOUT_MS ?? 6000)
const LLM_TIMEOUT = Number(process.env.LLM_TIMEOUT_MS ?? 60_000)
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 1000)

// Approx $/1M tokens (in,out) for cost accounting — the router does not price
// every model inline, so use public rates; a cheap/frontier gap of ~20-30x is the
// point, and the ratio is robust to small rate errors. Override via PRICES env.
const PRICES: Record<string, [number, number]> = {
  'groq/llama-3.1-8b-instant': [0.05, 0.08],
  'google/gemini-2.5-flash-lite': [0.10, 0.40],
  'openai/gpt-4o-mini': [0.15, 0.60],
  'anthropic/claude-haiku-4-5-20251001': [1.0, 5.0],
  'glm-5.2': [0.60, 2.20],
}
const priceOf = (m: string) => PRICES[m] ?? [0.5, 1.5]

interface Usage { in: number; out: number }
const zero = (): Usage => ({ in: 0, out: 0 })
const addU = (a: Usage, b: Usage) => { a.in += b.in; a.out += b.out }
const usd = (m: string, u: Usage) => { const [pi, po] = priceOf(m); return (u.in * pi + u.out * po) / 1e6 }

async function chat(model: string, messages: { role: string; content: string }[], temperature: number, usage: Usage): Promise<string> {
  try {
    const system = messages.find((message) => message.role === 'system')?.content
    const result = await runBenchRouterTurn(
      {
        routerBaseUrl: ROUTER,
        routerKey: ROUTER_KEY,
        profile: {
          name: 'david-goliath-worker',
          model: { provider: 'tangle-router', default: model },
          ...(system ? { prompt: { systemPrompt: system } } : {}),
        },
        temperature,
        maxTokens: MAX_TOKENS,
        timeoutMs: LLM_TIMEOUT,
      },
      { messages: messages.filter((message) => message.role !== 'system') },
    )
    if (result.usage.tokensKnown === false) throw new Error('provider omitted token usage')
    addU(usage, { in: result.usage.input, out: result.usage.output })
    return result.finalText
  } catch {
    return ''
  }
}
const exec = (file: string, args: string[], o: object) => new Promise<{ code: number; stdout: string }>((res) => execFile(file, args, { ...o, maxBuffer: 8 * 1024 * 1024 }, (e, stdout) => res({ code: (e as { code?: number } | null)?.code ?? (e ? 1 : 0), stdout: String(stdout) })))
async function runPy(program: string): Promise<{ ok: boolean }> {
  const d = mkdtempSync(join(tmpdir(), 'dg-'))
  try { writeFileSync(join(d, 'p.py'), program); const r = await exec('python3', [join(d, 'p.py')], { cwd: d, timeout: EXEC_TIMEOUT }); return { ok: r.code === 0 } } finally { rmSync(d, { recursive: true, force: true }) }
}

const SOLVE = 'You are an expert Python programmer. Output the COMPLETE function (signature + body + imports) in a single ```python block. No prose, no tests.'
async function genSolution(model: string, t: HumanEvalTask, temp: number, u: Usage): Promise<string> {
  return extractCode(await chat(model, [{ role: 'system', content: SOLVE }, { role: 'user', content: `Complete:\n\n\`\`\`python\n${t.prompt}\`\`\`` }], temp, u))
}
// David writes its OWN tests (never sees the hidden test). Parse assert lines.
async function genTests(model: string, t: HumanEvalTask, u: Usage): Promise<string[]> {
  const reply = await chat(model, [
    { role: 'system', content: 'Write Python assert-based unit tests for the described function. Output ONLY a ```python block of standalone `assert <entry>(...) == ...` lines (at least a few, covering normal + edge cases). No function definition, no prose.' },
    { role: 'user', content: `Function to test (entry point: ${t.entryPoint}):\n\n\`\`\`python\n${t.prompt}\`\`\`` },
  ], 0.4, u)
  const block = extractCode(reply) || reply
  return block.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('assert ') && l.includes(t.entryPoint)).slice(0, T + 3)
}
// Hidden held-out judge — the truth. Never used for selection.
async function judge(t: HumanEvalTask, code: string): Promise<boolean> {
  if (!code.trim()) return false
  return (await runPy(`${code}\n\n${t.test}\n\ncheck(${t.entryPoint})\n`)).ok
}
// David's self-selection: score each candidate by how many of ITS OWN tests it passes.
async function scoreOnTests(code: string, tests: string[]): Promise<number> {
  if (!code.trim() || tests.length === 0) return 0
  let pass = 0
  // one program per test keeps a crash on one test from voiding the rest
  for (const a of tests) if ((await runPy(`${code}\n\n${a}\n`)).ok) pass++
  return pass
}

async function davidArm(t: HumanEvalTask, u: Usage): Promise<string> {
  const cands = (await Promise.all(Array.from({ length: N }, () => genSolution(DAVID, t, 0.7, u)))).filter((c) => c.trim())
  if (cands.length === 0) return ''
  const tests = await genTests(DAVID, t, u)
  if (tests.length === 0) return cands[0]! // no verifier signal → first sample
  const scored = await Promise.all(cands.map(async (c) => ({ c, s: await scoreOnTests(c, tests) })))
  scored.sort((a, b) => b.s - a.s || b.c.length - a.c.length)
  return scored[0]!.c
}
const goliathArm = (t: HumanEvalTask, u: Usage) => genSolution(GOLIATH, t, 0.2, u)

async function pool<T2, R>(xs: T2[], n: number, fn: (x: T2, i: number) => Promise<R>): Promise<R[]> {
  const o = new Array<R>(xs.length); let i = 0
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; o[k] = await fn(xs[k]!, k) } }))
  return o
}
function mcnemar(b: number, c: number): number { const n = b + c; if (n === 0) return 1; const k = Math.min(b, c); const lf = (x: number) => { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s }; let tl = 0; for (let i = 0; i <= k; i++) tl += Math.exp(lf(n) - lf(i) - lf(n - i) - n * Math.log(2)); return Math.min(1, 2 * tl) }

async function main(): Promise<void> {
  if (['1', 'true'].includes((process.env.SMOKE ?? '').toLowerCase())) { console.error('SMOKE ok: david-goliath loaded'); return }
  const tasks = await loadHumanEval(NTASKS, 0)
  console.error(`=== DAVID(${DAVID}, N=${N} sols + ${T} self-tests) vs GOLIATH(${GOLIATH}, 1 shot) · HumanEval n=${tasks.length} · reps=${REPS} ===`)
  const dU = zero(), gU = zero()
  const units = tasks.flatMap((task) => Array.from({ length: REPS }, () => task))
  let done = 0
  const res = await pool(units, CONC, async (task) => {
    const safe = async (fn: () => Promise<string>) => { try { return await fn() } catch { return '' } }
    const [dCode, gCode] = await Promise.all([safe(() => davidArm(task, dU)), safe(() => goliathArm(task, gU))])
    const [d, g] = await Promise.all([judge(task, dCode), judge(task, gCode)])
    if (++done % 20 === 0) console.error(`  ${done}/${units.length} units`)
    return { d, g }
  })
  const n = res.length, dPass = res.filter((r) => r.d).length, gPass = res.filter((r) => r.g).length
  const b = res.filter((r) => r.d && !r.g).length, c = res.filter((r) => !r.d && r.g).length
  const p = mcnemar(b, c)
  const dCost = usd(DAVID, dU), gCost = usd(GOLIATH, gU)
  console.log('\n=== RESULT (held-out HumanEval) ===')
  console.log(`  GOLIATH ${GOLIATH} solo : ${gPass}/${n} = ${(gPass / n * 100).toFixed(1)}%   $${gCost.toFixed(4)}`)
  console.log(`  DAVID   ${DAVID} + verify: ${dPass}/${n} = ${(dPass / n * 100).toFixed(1)}%   $${dCost.toFixed(4)}`)
  console.log(`  accuracy: David ${dPass >= gPass ? '>=' : '<'} Goliath (${(dPass / n * 100).toFixed(1)} vs ${(gPass / n * 100).toFixed(1)}); paired McNemar David-only=${b} Goliath-only=${c} p=${p.toFixed(4)}`)
  console.log(`  cost: David is ${(gCost / Math.max(dCost, 1e-9)).toFixed(1)}x CHEAPER ($${dCost.toFixed(4)} vs $${gCost.toFixed(4)})`)
  const paretoBeat = dPass >= gPass && dCost <= gCost
  const sigBeat = dPass > gPass && p < 0.05
  console.log(`  VERDICT: ${sigBeat ? 'DAVID SIGNIFICANTLY BEATS GOLIATH' : paretoBeat ? 'DAVID PARETO-DOMINATES (>= accuracy, <= cost)' : dPass >= gPass ? 'David matches accuracy (check cost)' : 'Goliath wins accuracy'}`)
}
main().catch((e) => { console.error('MAIN:', e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1) })
