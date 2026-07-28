/**
 * Self-improving coder — the substrate's self-improvement spine, composed cleanly, on a
 * CONTAMINATION-PROOF coding task. NOTHING here is hand-rolled: the genome is an `AgentProfile`-shaped
 * worker, the task is an `AgenticSurface` (open/tools/call/score/close), and the held-out-gated
 * flywheel is `runStrategyEvolution` — which authors candidate strategies from TRAIN losses, then
 * makes ONE promotion decision on a FRESH holdout slice the search never touched (`promotionGate`,
 * a seeded paired-bootstrap CI). Adaptive data analysis is structurally impossible: the holdout is
 * disjoint by task offset and read exactly once.
 *
 * Why contamination-proof: each task is a small wire-protocol library whose constants (version,
 * separators, checksum modulus, opcode) are DERIVED FROM THE SEED and specified ONLY by the test file.
 * A frontier model cannot have memorized the fix — the exact contract is generated per task. Graded by
 * REAL pytest (a deployable check, never an LLM judge).
 *
 * IMPORTANT — the bundled task is DELIBERATELY SIMPLE (a few functions fully pinned by their tests).
 * A capable model aces it (every strategy scores 1.0), so the gate CORRECTLY returns no-promotion:
 * you cannot demonstrate self-improvement where there is no headroom — and this harness refuses to
 * pretend otherwise (calibrate-before-measure, enforced). To get a DISCRIMINATING run, swap in a task
 * with a correctable middle band (algorithmically hard generated tasks, or a real benchmark below).
 *
 * To run frontier SWE-bench instead, swap `environment`/`tasks` for the SWE-bench `Environment`
 * (bench/src/benchmarks/swe-bench.ts) — everything else is identical. (That arena is contamination-
 * SUSPECT: its bugs are public GitHub fixes a model may have memorized — report it, never claim clean.)
 *
 * Run:  TANGLE_API_KEY=<router key>  pnpm tsx examples/self-improving-coder/self-improving-coder.ts
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatClient } from '@tangle-network/agent-eval'
import {
  type AgenticSurface,
  type AgenticTask,
  type AgenticTool,
  type ArtifactHandle,
  refine,
  runStrategyEvolution,
  type SurfaceScore,
  sample,
} from '@tangle-network/agent-runtime/kernel'

// ── The contamination-proof task generator (deterministic per seed) ──────────────
/** A small wire-protocol library, fully specified by its tests, with seed-derived constants. The
 *  agent must READ the tests to infer the exact contract — it cannot recall it. Returns the stub the
 *  agent edits + the hidden-ish test file (the agent may read it; grading runs it). */
function constsFor(seed: number): { VER: string; SEP: string; MOD: number } {
  const r = (m: number) => ((seed * 2654435761) >>> 0) % m
  return {
    VER: `v${(r(900) + 100).toString(36)}`,
    SEP: ['-', '|', ':', '/', '#'][r(5)]!,
    MOD: [97, 101, 103, 107, 109][r(5)]!,
  }
}
function genTask(seed: number): { stub: string; test: string; total: number } {
  const { VER, SEP, MOD } = constsFor(seed)
  const t = (id: number, text: string) => `${VER}${SEP}${id}${SEP}${text}`
  const tests = [
    'import pytest',
    'from lib import encode, decode, checksum, valid',
    '',
    `def test_encode(): assert encode(3, "hi") == ${JSON.stringify(t(3, 'hi'))}`,
    `def test_encode_zero(): assert encode(0, "") == ${JSON.stringify(t(0, ''))}`,
    `def test_decode(): assert decode(${JSON.stringify(t(9, 'ab'))}) == {"id": 9, "text": "ab"}`,
    'def test_roundtrip(): assert decode(encode(42, "yo")) == {"id": 42, "text": "yo"}',
    `def test_checksum(): assert checksum("abc") == sum(b for b in b"abc") % ${MOD}`,
    `def test_checksum_empty(): assert checksum("") == 0`,
    `def test_valid_true(): assert valid(${JSON.stringify(t(1, 'x'))}) is True`,
    `def test_valid_bad_version(): assert valid("zz${SEP}1${SEP}x") is False`,
    `def test_valid_bad_shape(): assert valid("not a token") is False`,
    '',
  ].join('\n')
  const stub = [
    '# Implement these so test_lib.py passes. Infer the exact format from the tests.',
    'def encode(id, text):',
    '    raise NotImplementedError',
    'def decode(s):',
    '    raise NotImplementedError',
    'def checksum(text):',
    '    raise NotImplementedError',
    'def valid(s):',
    '    raise NotImplementedError',
    '',
  ].join('\n')
  return { stub, test: tests, total: 9 }
}

// ── The Environment (AgenticSurface) — host pytest, no Docker. (Docker is a swap for untrusted code.) ──
interface Ws {
  dir: string
  total: number
}
const workspaces = new Map<string, Ws>()

function pytestPassed(dir: string): { passed: number; total: number } {
  let out = ''
  try {
    out = execFileSync(
      'python3',
      ['-m', 'pytest', '-q', '--tb=no', '-p', 'no:cacheprovider', 'test_lib.py'],
      {
        cwd: dir,
        encoding: 'utf8',
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  }
  const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
  const failed =
    Number(out.match(/(\d+) failed/)?.[1] ?? 0) + Number(out.match(/(\d+) error/)?.[1] ?? 0)
  return { passed, total: passed + failed }
}

export const codingEnv: AgenticSurface = {
  name: 'generated-coding',
  async open(task) {
    const seed = Number((task.meta as { seed?: number })?.seed ?? 0)
    const { stub, test, total } = genTask(seed)
    const dir = mkdtempSync(join(tmpdir(), 'sic-'))
    writeFileSync(join(dir, 'lib.py'), stub)
    writeFileSync(join(dir, 'test_lib.py'), test)
    const handle: ArtifactHandle = { id: dir, surface: 'generated-coding' }
    workspaces.set(dir, { dir, total })
    return handle
  },
  async tools() {
    return [
      {
        type: 'function',
        function: {
          name: 'list_files',
          description: 'List the files in the workspace.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file (e.g. test_lib.py to learn the contract, or lib.py).',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description:
            'Write COMPLETE contents of lib.py (the implementation). test_lib.py is read-only.',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
          },
        },
      },
      // NO run_tests: the agent cannot iterate-until-green. It must implement correctly from READING the
      // tests — which creates real headroom and makes the STRATEGY (planning, multiple attempts) matter.
    ] satisfies AgenticTool[]
  },
  async call(handle, name, args) {
    const ws = workspaces.get(handle.id)
    if (!ws) return 'ERROR: workspace closed'
    if (name === 'list_files') return readdirSync(ws.dir).join('\n')
    if (name === 'read_file') {
      const p = String(args.path ?? '')
      if (p !== 'lib.py' && p !== 'test_lib.py')
        return 'ERROR: only lib.py and test_lib.py are readable'
      try {
        return readFileSync(join(ws.dir, p), 'utf8').slice(0, 8000)
      } catch (e) {
        return `ERROR: ${(e as Error).message}`
      }
    }
    if (name === 'write_file') {
      const p = String(args.path ?? '')
      if (p !== 'lib.py') return 'ERROR: only lib.py is writable'
      try {
        writeFileSync(join(ws.dir, 'lib.py'), String(args.content ?? ''))
        return 'wrote lib.py'
      } catch (e) {
        return `ERROR: ${(e as Error).message}`
      }
    }
    return `ERROR: unknown tool ${name}`
  },
  async score(_task, handle): Promise<SurfaceScore> {
    const ws = workspaces.get(handle.id)
    if (!ws) return { passes: 0, total: 0, errored: 1 }
    const { passed, total } = pytestPassed(ws.dir)
    return total > 0
      ? { passes: passed, total, errored: 0 }
      : { passes: 0, total: ws.total, errored: 1 }
  },
  async close(handle) {
    const ws = workspaces.get(handle.id)
    if (!ws) return
    workspaces.delete(handle.id)
    rmSync(ws.dir, { recursive: true, force: true })
  },
}

// ── The disjoint task supplier (train [0,trainN); holdout drawn past it) ──────────
export const codingTasks = async (offset: number, n: number): Promise<AgenticTask[]> =>
  Array.from({ length: n }, (_, i) => {
    const seed = offset + i
    return {
      id: `gen-${seed}`,
      systemPrompt:
        'You are a Python engineer. The library lib.py has stub functions; its exact contract is defined ONLY by ' +
        'test_lib.py. You CANNOT run the tests — read test_lib.py CAREFULLY (every assertion, every edge case) and ' +
        'implement lib.py correctly in one pass with write_file. Get the edge cases right (empty inputs, malformed ' +
        'inputs, exact formats). Do not edit test_lib.py.',
      userPrompt:
        'Read test_lib.py to learn the exact contract, then write a correct lib.py. You cannot run the tests — reason carefully.',
      meta: { seed },
    } satisfies AgenticTask
  })

/** The correct lib.py for a seed — used ONLY by the $0 calibration self-check (never by the agent). */
function referenceLib(seed: number): string {
  const { VER, SEP, MOD } = constsFor(seed)
  return [
    `VER, SEP, MOD = ${JSON.stringify(VER)}, ${JSON.stringify(SEP)}, ${MOD}`,
    'def encode(id, text): return f"{VER}{SEP}{id}{SEP}{text}"',
    'def decode(s):',
    '    v, i, t = s.split(SEP, 2)',
    '    return {"id": int(i), "text": t}',
    'def checksum(text): return sum(text.encode()) % MOD if text else 0',
    'def valid(s):',
    '    p = s.split(SEP)',
    '    return len(p) == 3 and p[0] == VER and p[1].isdigit()',
    '',
  ].join('\n')
}

/** calibrate-before-measure: prove the task is SOLVABLE (reference → all pass) and the grader
 *  DISCRIMINATES (stub → 0). $0, no router. A reference that doesn't clear means the task/grader is
 *  broken — fix it before spending. */
async function calibrate(): Promise<void> {
  console.log('═══ CALIBRATION ($0) — task solvable + grader discriminates? ═══')
  let ok = true
  for (const seed of [0, 1, 2, 7, 11]) {
    const task = (await codingTasks(seed, 1))[0]!
    const h = await codingEnv.open(task)
    const stub = await codingEnv.score(task, h)
    // write the reference, re-score
    await codingEnv.call(h, 'write_file', { path: 'lib.py', content: referenceLib(seed) })
    const ref = await codingEnv.score(task, h)
    await codingEnv.close(h)
    const pass = ref.passes === ref.total && ref.total > 0 && stub.passes === 0
    ok &&= pass
    console.log(
      `  seed ${seed}: stub ${stub.passes}/${stub.total}  →  reference ${ref.passes}/${ref.total}  ${pass ? '✓' : '✗ BROKEN'}`,
    )
  }
  console.log(
    ok
      ? '\n>>> CALIBRATED — task is solvable + the grader discriminates. Safe to run the loop.'
      : '\n>>> BROKEN — fix the task/grader before spending.',
  )
  if (!ok) process.exit(1)
}

async function main(): Promise<void> {
  if (process.env.CALIBRATE === '1') return calibrate()
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey)
    throw new Error('set TANGLE_API_KEY (the worker + the author both call the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  // The author WRITES strategy code (a `defineStrategy` module) — it needs a strong coder + a token
  // budget (thinking models return empty content without one) + a fallback. deepseek-flash can't.
  const authorModel = process.env.AUTHOR_MODEL ?? 'gemini-2.5-pro'

  // The author writes candidate-strategy .mts files into outDir, then dynamically imports them — they
  // `import '@tangle-network/agent-runtime/kernel'`, which only resolves UNDER the package (self-reference).
  // A /tmp outDir would fail to resolve it; keep it under the project root.
  const report = await (async () => {
    const outDir = mkdtempSync(join(process.cwd(), '.sic-run-'))
    try {
      return await runStrategyEvolution({
        environment: codingEnv,
        tasks: codingTasks,
        trainN: Number(process.env.TRAIN_N ?? 8),
        holdoutN: Number(process.env.HOLDOUT_N ?? 12),
        worker: {
          routerBaseUrl,
          routerKey,
          model: workerModel,
          innerTurns: Number(process.env.INNER_TURNS ?? 8),
          maxTokens: 4000,
        },
        author: {
          chat: createChatClient({
            transport: 'router',
            baseUrl: routerBaseUrl,
            apiKey: routerKey,
            defaultModel: authorModel,
          }),
          model: authorModel,
          maxTokens: 8000,
          fallbackModel: process.env.AUTHOR_FALLBACK ?? 'deepseek-v4-flash',
        },
        baselines: [sample, refine],
        budget: Number(process.env.BUDGET ?? 3),
        generations: Number(process.env.GENERATIONS ?? 2),
        populationSize: Number(process.env.POP ?? 2),
        outDir,
      })
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })()

  const v = report.verdict
  if (process.env.DUMP === '1') {
    // Autopsy: gen0 baseline scores (headroom) + every authored candidate's score/error (did they
    // lose on a saturated task, or error at runtime?).
    const r = report as unknown as Record<string, unknown>
    const slim = (x: unknown) =>
      JSON.stringify(x, (_k, val) => (typeof val === 'function' ? '[fn]' : val), 1)
    console.log('--- gen0 ---', slim(r.gen0 ?? r.gen0Champion))
    console.log('--- generations ---', slim(r.generations)?.slice(0, 3000))
  }
  console.log('\n═══ SELF-IMPROVING CODER — certified on a FROZEN holdout (no adaptive reuse) ═══')
  console.log(`worker=${workerModel}  author=${authorModel}`)
  console.log(`gen0 champion:   ${report.gen0Champion.name}`)
  console.log(`final champion:  ${report.finalChampion.name}`)
  console.log(`PROMOTED:        ${v.promoted}  (${v.reason})`)
  console.log(
    `held-out lift:   mean ${v.lift.mean.toFixed(3)}  95% CI [${v.lift.low.toFixed(3)}, ${v.lift.high.toFixed(3)}]  n=${v.n}`,
  )
  console.log(
    v.promoted
      ? '\n>>> The search taught the agent a strategy that fixes MORE on tasks it never trained on, beyond luck. Self-improvement CERTIFIED.'
      : '\n>>> No promotion: the evolved strategy did not beat gen0 on the fresh holdout beyond noise (honest null).',
  )
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
    process.exit(1)
  })
