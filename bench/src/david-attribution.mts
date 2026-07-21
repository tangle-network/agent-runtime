/**
 * DAVID mechanism attribution — decompose the cheap-model harness's held-out
 * accuracy into what SAMPLING buys vs what VERIFICATION-SELECTION buys, so a
 * David-Goliath win is credited to the right lever (not just best-of-N luck).
 *
 * For each task, generate N candidate solutions + the model's own tests, then
 * report four numbers on the HIDDEN test:
 *   pass@1        — first candidate (no harness).
 *   mean-cand     — expected accuracy of a RANDOM candidate (sampling floor).
 *   oracle@N      — a correct candidate exists among the N (ceiling of selection).
 *   verify-select — the candidate the self-tests picked (the actual David).
 * verify-select − mean-cand = what VERIFICATION adds over blind sampling;
 * oracle@N − verify-select = the selection gap left on the table.
 *
 * Run from cwd=bench: env DAVID=groq/llama-3.1-8b-instant N=8 T=5 NTASKS=60 \
 *   node_modules/.bin/tsx src/david-attribution.mts
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadHumanEval, extractCode, type HumanEvalTask } from './benchmarks/humaneval'

const KEY = process.env.TANGLE_API_KEY!
const ROUTER = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
const DAVID = process.env.DAVID ?? 'groq/llama-3.1-8b-instant'
const N = Number(process.env.N ?? 8)
const T = Number(process.env.T ?? 5)
const NTASKS = Number(process.env.NTASKS ?? 60)
const CONC = Number(process.env.CONCURRENCY ?? 6)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function chat(messages: { role: string; content: string }[], temp: number): Promise<string> {
  for (let a = 0; ; a++) {
    try {
      const r = await fetch(`${ROUTER}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model: DAVID, messages, temperature: temp, max_tokens: 1000 }), signal: AbortSignal.timeout(60_000) })
      if ([408, 429, 500, 502, 503, 504, 520, 522, 524].includes(r.status)) { if (a >= 5) return ''; await sleep(700 * 2 ** a); continue }
      if (!r.ok) return ''
      return (((await r.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content) ?? ''
    } catch { if (a >= 5) return ''; await sleep(700 * 2 ** a) }
  }
}
const exec = (f: string, a: string[], o: object) => new Promise<number>((res) => execFile(f, a, { ...o, maxBuffer: 8e6 }, (e) => res((e as { code?: number } | null)?.code ?? (e ? 1 : 0))))
async function runPy(p: string): Promise<boolean> { const d = mkdtempSync(join(tmpdir(), 'da-')); try { writeFileSync(join(d, 'p.py'), p); return (await exec('python3', [join(d, 'p.py')], { cwd: d, timeout: 6000 })) === 0 } finally { rmSync(d, { recursive: true, force: true }) } }
const SOLVE = 'Expert Python. Output the COMPLETE function in one ```python block, no prose, no tests.'
const genSol = async (t: HumanEvalTask, temp: number) => extractCode(await chat([{ role: 'system', content: SOLVE }, { role: 'user', content: `Complete:\n\n\`\`\`python\n${t.prompt}\`\`\`` }], temp))
async function genTests(t: HumanEvalTask): Promise<string[]> {
  const b = extractCode(await chat([{ role: 'system', content: 'Write Python assert unit tests. Output ONLY a ```python block of `assert <entry>(...) == ...` lines. No function, no prose.' }, { role: 'user', content: `entry: ${t.entryPoint}\n\n\`\`\`python\n${t.prompt}\`\`\`` }], 0.4))
  return b.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('assert ') && l.includes(t.entryPoint)).slice(0, T + 3)
}
const judge = async (t: HumanEvalTask, code: string) => code.trim() ? runPy(`${code}\n\n${t.test}\n\ncheck(${t.entryPoint})\n`) : false
async function scoreTests(code: string, tests: string[]): Promise<number> { if (!code.trim() || !tests.length) return 0; let p = 0; for (const a of tests) if (await runPy(`${code}\n\n${a}\n`)) p++; return p }
async function pool<T2, R>(xs: T2[], n: number, fn: (x: T2) => Promise<R>): Promise<R[]> { const o = new Array<R>(xs.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const k = i++; o[k] = await fn(xs[k]!) } })); return o }

async function main(): Promise<void> {
  const tasks = await loadHumanEval(NTASKS, 0)
  console.error(`=== ATTRIBUTION · ${DAVID} · N=${N} sols + ${T} tests · n=${tasks.length} ===`)
  let done = 0
  const rows = await pool(tasks, CONC, async (t) => {
    const cands = (await Promise.all(Array.from({ length: N }, () => genSol(t, 0.7)))).filter((c) => c.trim())
    if (!cands.length) return { p1: 0, mean: 0, oracle: 0, sel: 0 }
    const tests = await genTests(t)
    const hidden = await Promise.all(cands.map((c) => judge(t, c))) // hidden-test pass per candidate (for attribution only)
    const selScores = tests.length ? await Promise.all(cands.map((c) => scoreTests(c, tests))) : cands.map(() => 0)
    let bi = 0; for (let i = 1; i < cands.length; i++) if (selScores[i]! > selScores[bi]! || (selScores[i]! === selScores[bi]! && cands[i]!.length > cands[bi]!.length)) bi = i
    if (++done % 15 === 0) console.error(`  ${done}/${tasks.length}`)
    return { p1: hidden[0] ? 1 : 0, mean: hidden.filter(Boolean).length / cands.length, oracle: hidden.some(Boolean) ? 1 : 0, sel: hidden[bi] ? 1 : 0 }
  })
  const n = rows.length, avg = (f: (r: typeof rows[number]) => number) => (rows.reduce((s, r) => s + f(r), 0) / n) * 100
  console.log('\n=== ATTRIBUTION (held-out) ===')
  console.log(`  pass@1 (no harness)        : ${avg((r) => r.p1).toFixed(1)}%`)
  console.log(`  mean random candidate      : ${avg((r) => r.mean).toFixed(1)}%   (sampling floor)`)
  console.log(`  verify-select (DAVID)      : ${avg((r) => r.sel).toFixed(1)}%`)
  console.log(`  oracle@N (a correct exists): ${avg((r) => r.oracle).toFixed(1)}%   (selection ceiling)`)
  console.log(`  --> verification adds over random sampling: +${(avg((r) => r.sel) - avg((r) => r.mean)).toFixed(1)}pp`)
  console.log(`  --> selection gap still on table (oracle-select): ${(avg((r) => r.oracle) - avg((r) => r.sel)).toFixed(1)}pp`)
}
main().catch((e) => { console.error('MAIN:', e instanceof Error ? e.stack : e); process.exit(1) })
