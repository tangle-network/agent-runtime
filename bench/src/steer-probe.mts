/**
 * THE PRECONDITION PROBE for the steer-vs-no-steer experiment.
 *
 * Online steering (a supervisor watching a worker's live trace and correcting it mid-run) can only
 * help if workers actually TRIP the streaming detectors during normal runs. If a worker never loops
 * or error-streaks, there is nothing to steer on and the whole A/B is dead-on-arrival. This script
 * measures that trip rate — cheaply, on the REAL owned-loop trace path — BEFORE we spend on the
 * powered A/B (the cost gate: smoke before burn).
 *
 * It runs a `router-tools` worker (the off-box agentic loop) on small but genuinely-hard coding
 * tasks where a weak model spins, with a SAFE local toolset (read/write/list scoped to a temp dir +
 * a fixed test command — no arbitrary shell). `onToolStep` feeds `createPushTraceSource`; at settle
 * we fold the collected spans through agent-eval's published detectors (the same kernel `watchTrace`
 * folds online) and count: did it trip, with which detector, at which step. We also score the
 * deployable check (tests pass?) so we can report the steerable population = UNRESOLVED ∩ tripped.
 *
 *   ROUTER_BASE=https://router.tangle.tools/v1 ROUTER_KEY=<key> \
 *   WORKER_MODEL=deepseek-v4-flash N=3 tsx bench/src/steer-probe.mts
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  type AgentProfile,
  type AgentSpec,
  createExecutor,
  createPushTraceSource,
  watchTrace,
} from '../../src/runtime/index'
import type { ToolSpec } from '../../src/runtime/router-client'

const ROUTER_BASE = (process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1').replace(/\/$/, '')
const ROUTER_KEY = process.env.ROUTER_KEY ?? process.env.TANGLE_API_KEY ?? ''
const MODEL = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
const N = Number(process.env.N ?? '3')
const MAX_TURNS = Number(process.env.MAX_TURNS ?? '16')

if (!ROUTER_KEY) throw new Error('set ROUTER_KEY (or TANGLE_API_KEY) to the router key')

/** A task = a failing Python file + a hidden assert-based test it must satisfy. Chosen so a weak
 *  model iterates (edge cases it tends to miss on the first tries) — the band where spinning lives. */
interface Task {
  readonly id: string
  readonly solution: string
  readonly test: string
  readonly brief: string
}

const tasks: ReadonlyArray<Task> = [
  {
    id: 'roman-validate',
    brief:
      'In solution.py, implement parse_roman(s) -> int. It must parse valid Roman numerals (I,V,X,L,C,D,M) AND raise ValueError on invalid ones (e.g. "IIII", "VV", "IC", "", lowercase). test.py must pass.',
    solution: 'def parse_roman(s):\n    raise NotImplementedError\n',
    test: [
      'from solution import parse_roman',
      'assert parse_roman("IV") == 4',
      'assert parse_roman("MCMXCIV") == 1994',
      'assert parse_roman("XL") == 40',
      'for bad in ["IIII", "VV", "IC", "", "iv", "MMMM"]:',
      '    try:',
      '        parse_roman(bad); raise SystemExit(f"should have rejected {bad!r}")',
      '    except ValueError:',
      '        pass',
      'print("PASS")',
    ].join('\n'),
  },
  {
    id: 'duration-parse',
    brief:
      'In solution.py, implement parse_duration(s) -> int seconds. Supports combinations like "1h30m", "90m", "2d", "45s", "1d2h3m4s". Raise ValueError on invalid input ("", "1x", "h30m", "1.5h"). test.py must pass.',
    solution: 'def parse_duration(s):\n    raise NotImplementedError\n',
    test: [
      'from solution import parse_duration',
      'assert parse_duration("90m") == 5400',
      'assert parse_duration("1h30m") == 5400',
      'assert parse_duration("2d") == 172800',
      'assert parse_duration("1d2h3m4s") == 93784',
      'for bad in ["", "1x", "h30m", "1.5h", "abc"]:',
      '    try:',
      '        parse_duration(bad); raise SystemExit(f"should have rejected {bad!r}")',
      '    except ValueError:',
      '        pass',
      'print("PASS")',
    ].join('\n'),
  },
  {
    id: 'expr-eval',
    brief:
      'In solution.py, implement evaluate(expr) -> float for arithmetic with + - * / and parentheses, correct precedence, integer/decimal literals. Raise ValueError on malformed input. test.py must pass.',
    solution: 'def evaluate(expr):\n    raise NotImplementedError\n',
    test: [
      'from solution import evaluate',
      'assert evaluate("2+3*4") == 14',
      'assert evaluate("(2+3)*4") == 20',
      'assert abs(evaluate("10/4") - 2.5) < 1e-9',
      'assert evaluate("2*(3+(4-1))") == 12',
      'for bad in ["", "2+", "(2+3", "2**3", "a+1"]:',
      '    try:',
      '        evaluate(bad); raise SystemExit(f"should have rejected {bad!r}")',
      '    except ValueError:',
      '        pass',
      'print("PASS")',
    ].join('\n'),
  },
]

const toolDefs: ReadonlyArray<ToolSpec> = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in the working directory.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file in the working directory.',
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
      description: 'Overwrite a file in the working directory with new content.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_tests',
      description: 'Run python3 test.py in the working directory. Returns PASS or the failure output.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

/** Tools scoped to one workspace dir — path-guarded, fixed test command, no arbitrary shell. */
function makeToolExec(ws: string) {
  const safe = (p: unknown): string => {
    const rel = typeof p === 'string' ? p : ''
    const abs = resolve(ws, rel)
    if (abs !== ws && !abs.startsWith(`${ws}/`)) throw new Error(`path escapes workspace: ${rel}`)
    return abs
  }
  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case 'list_files':
        return readdirSync(ws).join('\n') || '(empty)'
      case 'read_file':
        return readFileSync(safe(args.path), 'utf8')
      case 'write_file': {
        writeFileSync(safe(args.path), String(args.content ?? ''))
        return `wrote ${args.path}`
      }
      case 'run_tests':
        try {
          const out = execFileSync('python3', ['test.py'], { cwd: ws, stdio: 'pipe', timeout: 30_000 })
          return out.toString().trim() || 'PASS'
        } catch (e) {
          const err = e as { stdout?: Buffer; stderr?: Buffer }
          return `FAIL:\n${(err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '')}`.slice(0, 800)
        }
      default:
        throw new Error(`unknown tool ${name}`)
    }
  }
}

interface RolloutResult {
  task: string
  resolved: boolean
  toolCalls: number
  turns: number
  trips: Array<{ detector: string; step: number; action: string }>
}

async function runRollout(task: Task, idx: number): Promise<RolloutResult> {
  const ws = mkdtempSync(join(tmpdir(), `steer-probe-${task.id}-`))
  writeFileSync(join(ws, 'solution.py'), task.solution)
  writeFileSync(join(ws, 'test.py'), task.test)

  // The owned-loop trace path: every tool step becomes a span on this source. We watch it ONLINE
  // with the shipped `watchTrace` (the exact path arm B would steer on) and record each trip + the
  // step it fired at. The push fan-out is synchronous, so `step` is correct inside `onSignal`.
  const { source, record } = createPushTraceSource({ runId: `${task.id}-${idx}` })
  const exec = makeToolExec(ws)
  let step = -1
  const trips: RolloutResult['trips'] = []
  watchTrace(source, {
    onSignal: (s, span) => {
      trips.push({ detector: s.detector, step, action: span.toolName })
    },
  })

  const ac = new AbortController()
  const factory = createExecutor({
    backend: 'router-tools',
    routerBaseUrl: ROUTER_BASE,
    routerKey: ROUTER_KEY,
    model: MODEL,
    tools: toolDefs,
    maxTurns: MAX_TURNS,
    executeToolCall: (name, args) => exec(name, args),
    onToolStep: (s) => {
      step += 1
      record({ toolName: s.toolName, args: s.args, status: s.status })
    },
  })
  const executor = factory(
    { profile: { name: `probe-${task.id}` } as AgentProfile, harness: null } as AgentSpec,
    { signal: ac.signal, seams: {} },
  )

  const prompt =
    `${task.brief}\n\n` +
    'You are editing files in the working directory. Use the tools one call at a time: ' +
    'read_file/list_files to inspect, write_file to edit solution.py, run_tests to check. ' +
    'Iterate until run_tests prints PASS, then reply DONE.'

  const timer = setTimeout(() => ac.abort(), 180_000)
  let resolved = false
  let turns = 0
  try {
    const res = await executor.execute({ prompt } as never, ac.signal)
    if ('spent' in res) turns = res.spent.iterations
  } catch (e) {
    console.error(`  [${task.id}#${idx}] execute error: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    clearTimeout(timer)
  }
  // Deployable check, run independently of what the model claimed.
  try {
    execFileSync('python3', ['test.py'], { cwd: ws, stdio: 'pipe', timeout: 30_000 })
    resolved = true
  } catch {
    resolved = false
  }

  const spans = await source.collect()
  rmSync(ws, { recursive: true, force: true })
  return { task: task.id, resolved, toolCalls: spans.length, turns, trips }
}

async function main(): Promise<void> {
  console.log(
    `steer-probe: model=${MODEL} N=${N}/task tasks=${tasks.length} maxTurns=${MAX_TURNS}\n` +
      'measuring: do workers TRIP the streaming detectors (the precondition for online steering)?\n',
  )
  const results: RolloutResult[] = []
  for (const task of tasks) {
    for (let i = 0; i < N; i += 1) {
      const r = await runRollout(task, i)
      results.push(r)
      const tripStr = r.trips.length
        ? r.trips.map((t) => `${t.detector}@${t.step}(${t.action})`).join(', ')
        : 'no-trip'
      console.log(
        `  ${r.task}#${i}: ${r.resolved ? 'RESOLVED' : 'unresolved'} · ${r.toolCalls} tool calls · ${r.turns} turns · trips=[${tripStr}]`,
      )
    }
  }

  // ── the precondition verdict ──
  const tripped = results.filter((r) => r.trips.length > 0)
  const unresolved = results.filter((r) => !r.resolved)
  const steerable = results.filter((r) => !r.resolved && r.trips.length > 0)
  const byDetector = new Map<string, number>()
  for (const r of results) for (const t of r.trips) byDetector.set(t.detector, (byDetector.get(t.detector) ?? 0) + 1)
  const firstTripSteps = tripped
    .map((r) => Math.min(...r.trips.map((t) => t.step)))
    .sort((a, b) => a - b)

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a')
  console.log('\n══════════ PRECONDITION VERDICT ══════════')
  console.log(`rollouts:                 ${results.length}`)
  console.log(`resolved (passed tests):  ${results.length - unresolved.length}/${results.length} (${pct(results.length - unresolved.length, results.length)})`)
  console.log(`tripped ≥1 detector:      ${tripped.length}/${results.length} (${pct(tripped.length, results.length)})`)
  console.log(`STEERABLE (unresolved ∩ tripped): ${steerable.length}/${results.length} (${pct(steerable.length, results.length)})`)
  console.log(`  of unresolved rollouts: ${steerable.length}/${unresolved.length} (${pct(steerable.length, unresolved.length)}) tripped`)
  console.log(`trips by detector:        ${[...byDetector].map(([d, c]) => `${d}=${c}`).join(', ') || 'none'}`)
  console.log(`first-trip step (sorted): [${firstTripSteps.join(', ')}]`)
  console.log('\ninterpretation:')
  if (steerable.length === 0) {
    console.log('  ❌ NO steerable rollouts — workers never both fail AND trip a detector here. Online')
    console.log('     steering has nothing to act on in this band. Pick a harder/looping domain or')
    console.log('     a different detector before funding the A/B.')
  } else {
    console.log(`  ✅ ${steerable.length} steerable rollout(s) — a non-trivial population where a worker is`)
    console.log('     failing AND a detector fires early enough to intervene. The A/B is worth running:')
    console.log('     arm A (no steer) vs arm B (steer on trip) at equal compute, n≥24, paired bootstrap.')
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
