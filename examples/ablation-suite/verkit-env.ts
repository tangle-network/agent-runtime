/**
 * verkit-env — the REAL-library-reconstruction analog of long-coding-env-lite.
 *
 * The agent is handed a real, strongly-coupled, pure-Python library with every function body
 * replaced by `raise NotImplementedError` (signatures + docstrings kept) plus the library's
 * REAL pytest suite (read-only), and must re-implement the bodies until the suite passes.
 * Graded by real host pytest (a deployable check, never an LLM judge) — exactly the
 * AgenticSurface shape of long-coding-env-lite (open / tools[list_files, read_file, write_file,
 * run_tests] / call / score / close + an exported tasks supplier; run_tests returns the pass
 * count + the names of the failing tests).
 *
 * THE LIBRARY (see fixtures/verkit/PROVENANCE.md for the full recipe): python-semver 3.0.4's
 * version value type + its module-level functions, vendored as ONE module `verkit.py` and
 * RENAMED (module `semver`→`verkit`, class `Version`→`Release`, standard-name beacons scrubbed)
 * so the agent must work from the TESTS, not recall the original. Residual contamination is
 * spec-level and is documented honestly in PROVENANCE.md: the spec-covered surface
 * (basic parse/compare/bump/str) is likely memorized, but the oscillation-driving difficulty
 * lives in the library-idiosyncratic, non-spec behaviour — the prerelease natural-ordering rule
 * (mixed numeric/alphanumeric identifiers, unequal lengths), the `match` mini-language, optional
 * minor/patch parsing, tuple/dict round-trips, `__getitem__` slicing, `next_version`'s
 * prerelease interaction, the major-0 compatibility case, and the exact error contracts.
 *
 * WHY THIS IS THE OSCILLATION REGIME: one value type + 16 functions all share the same parse
 * grammar, string format, and (the hard part) prerelease ordering. A whole-file rewrite that
 * fixes one family (say, parsing) can regress another (say, comparison) because they consume the
 * SAME shared logic — the fix-one / break-another coupling a single continuous worker can't
 * escape. Unlike a parser, no single un-implemented function gates all partial credit
 * (`bump_major` can pass while `compare` fails), so the score gradient is smooth — the same shape
 * as long-coding-env-lite, but on real, coupled library code.
 *
 * SINGLE-INSTANCE CAVEAT: this is ONE fixed library, so `verkitTasks(offset, n)` yields n
 * independent TRIALS of the SAME task (distinct ids), NOT n disjoint problems. Train and holdout
 * drawn from it are the SAME library — use it for within-task topology / attempt-variance studies
 * and as a real long coding task, NOT for held-out generalization. For a disjoint, fully
 * contamination-controlled train/holdout split, use long-coding-env-lite (seed-randomized).
 *
 * Calibrated at $0 (no LLM): stub -> 0 pass, real source -> all 257 pass. Run the self-check:
 *   pnpm tsx examples/ablation-suite/verkit-env.ts
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AgenticSurface,
  AgenticTask,
  AgenticTool,
  ArtifactHandle,
  SurfaceScore,
} from '@tangle-network/agent-runtime/kernel'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'verkit')

const surfaceName = 'real-lib-verkit'
/** The single writable artifact (the implementation). The agent rewrites it whole. */
const moduleFile = 'verkit.py'
/** The pre-generated stub written into a fresh workspace (bodies -> NotImplementedError). */
const stubFile = 'verkit_stub.py'
/** The real source — used ONLY by the $0 calibration self-check, never written to a workspace. */
const realFile = 'verkit.py'
/** The library's real pytest suite + its fixture, copied read-only into the workspace. */
const testFiles = [
  'test_bump.py',
  'test_compare.py',
  'test_format.py',
  'test_parsing.py',
  'test_match.py',
  'test_replace.py',
  'test_semver.py',
  'test_index.py',
  'test_max-min.py',
  'test_immutable.py',
  'test_typeerror-274.py',
]
const supportFiles = ['conftest.py']
/** The canonical denominator: the real source passes exactly this many tests (asserted by the
 *  calibration). Scoring against a FIXED total (not the runtime passed+failed) keeps the fraction
 *  honest when a test file is blocked at collection — those tests count as 0, not as absent. */
const expectedTotal = 257

const readableFiles = new Set([moduleFile, ...testFiles, ...supportFiles])

interface Ws {
  dir: string
}
const workspaces = new Map<string, Ws>()

const pytestArgs = (extra: string[]): string[] => [
  '-m',
  'pytest',
  '-q',
  '--tb=no',
  // Force plain output: a forced-color env would wrap "FAILED"/test names in ANSI codes and
  // break the summary parsing below.
  '--color=no',
  '-p',
  'no:cacheprovider',
  '--continue-on-collection-errors',
  ...extra,
]

function runPytest(dir: string, extra: string[]): string {
  try {
    return execFileSync('python3', pytestArgs(extra), {
      cwd: dir,
      encoding: 'utf8',
      timeout: 180_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? ''
  }
}

/** Parse the pass count + whether pytest produced a recognizable result at all. */
function pytestResult(dir: string): { passed: number; ran: boolean } {
  const out = runPytest(dir, [])
  const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
  const failed = Number(out.match(/(\d+) failed/)?.[1] ?? 0)
  const errors = Number(out.match(/(\d+) error/)?.[1] ?? 0)
  return { passed, ran: passed + failed + errors > 0 }
}

/** A worker-facing report: the pass count over the fixed total + the NAMES of the failing tests
 *  (so a continuous worker — and a fresh respawn — can target exactly what is broken), plus any
 *  files BLOCKED at collection (a module-scope use of a not-yet-implemented symbol, e.g. the
 *  constructor), since those tests cannot run until that dependency is implemented. */
function runTestsReport(dir: string): string {
  const out = runPytest(dir, ['-rfE'])
  const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
  const failing = [...out.matchAll(/(?:FAILED|ERROR) \S*::(\S+)/g)].map((m) => m[1])
  const blocked = [...out.matchAll(/(?:^|\n)ERROR (\S+\.py) -/g)].map((m) => m[1])
  if (passed === 0 && failing.length === 0 && blocked.length === 0)
    return 'COLLECTION/SYNTAX ERROR: verkit.py did not import cleanly (a syntax error or a missing definition). Make sure every function and the Release class are defined and verkit.py imports, then run_tests again.'
  const head = `${passed}/${expectedTotal} tests passed.`
  const parts: string[] = []
  if (failing.length) {
    const shown = failing.slice(0, 80)
    const more = failing.length > shown.length ? ` (+${failing.length - shown.length} more)` : ''
    parts.push(`FAILING: ${shown.join(', ')}${more}`)
  }
  if (blocked.length)
    parts.push(
      `COLLECTION-BLOCKED (implement the symbols these files use at module scope, e.g. the Release constructor): ${blocked.join(', ')}`,
    )
  return parts.length ? `${head} ${parts.join(' | ')}` : head
}

export const verkitEnv: AgenticSurface = {
  name: surfaceName,
  async open(_task) {
    const dir = mkdtempSync(join(tmpdir(), 'verkit-'))
    // The writable artifact starts as the stub; the real source is never placed in a workspace.
    writeFileSync(join(dir, moduleFile), readFileSync(join(fixtureDir, stubFile), 'utf8'))
    for (const f of [...testFiles, ...supportFiles])
      writeFileSync(join(dir, f), readFileSync(join(fixtureDir, f), 'utf8'))
    const handle: ArtifactHandle = { id: dir, surface: surfaceName }
    workspaces.set(dir, { dir })
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
          description:
            'Read a file: verkit.py (the implementation), any test_*.py (the read-only suite that fully specifies the required behaviour), or conftest.py.',
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
            'Write the COMPLETE contents of verkit.py (the implementation). The test files and conftest.py are read-only.',
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
          description:
            'Run the test suite; returns how many of the tests passed and the NAMES of the failing tests (and any files blocked at collection). Use it to see what is still broken, fix exactly those, then run again.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ] satisfies AgenticTool[]
  },
  async call(handle, name, args) {
    const ws = workspaces.get(handle.id)
    if (!ws) return 'ERROR: workspace closed'
    if (name === 'list_files') return readdirSync(ws.dir).join('\n')
    if (name === 'read_file') {
      const p = String(args.path ?? '')
      if (!readableFiles.has(p)) return `ERROR: readable files are ${[...readableFiles].join(', ')}`
      try {
        return readFileSync(join(ws.dir, p), 'utf8').slice(0, 200000)
      } catch (e) {
        return `ERROR: ${(e as Error).message}`
      }
    }
    if (name === 'write_file') {
      const p = String(args.path ?? '')
      if (p !== moduleFile) return `ERROR: only ${moduleFile} is writable`
      try {
        writeFileSync(join(ws.dir, moduleFile), String(args.content ?? ''))
        return `wrote ${moduleFile}`
      } catch (e) {
        return `ERROR: ${(e as Error).message}`
      }
    }
    if (name === 'run_tests') return runTestsReport(ws.dir)
    return `ERROR: unknown tool ${name}`
  },
  async score(_task, handle): Promise<SurfaceScore> {
    const ws = workspaces.get(handle.id)
    if (!ws) return { passes: 0, total: 0, errored: 1 }
    const { passed, ran } = pytestResult(ws.dir)
    return ran
      ? { passes: passed, total: expectedTotal, errored: 0 }
      : { passes: 0, total: expectedTotal, errored: 1 }
  },
  async close(handle) {
    const ws = workspaces.get(handle.id)
    if (!ws) return
    workspaces.delete(handle.id)
    rmSync(ws.dir, { recursive: true, force: true })
  },
}

// ── The task supplier (n independent TRIALS of the one fixed task; see the SINGLE-INSTANCE
// caveat in the file header — these are NOT disjoint problems) ─────────────────────────────
export const verkitTasks = async (offset: number, n: number): Promise<AgenticTask[]> =>
  Array.from({ length: n }, (_, i) => {
    const trial = offset + i
    return {
      id: `verkit-${trial}`,
      userPrompt:
        'You are a Python engineer. verkit.py defines a Release version value type — a ' +
        'three-part MAJOR.MINOR.PATCH version with an optional prerelease and an optional build ' +
        'segment — together with about a dozen module-level helper functions over it. Every ' +
        'function body currently raises NotImplementedError; the signatures and docstrings are ' +
        'kept. Implement every body so the test suite passes. The EXACT behaviour — how versions ' +
        'parse and validate, how they are formatted back to strings, how prereleases ORDER ' +
        'against each other (including mixed numeric and alphanumeric identifiers), how the bump ' +
        'and replace helpers work, how the match-expression and comparison rules behave, and the ' +
        'precise exceptions raised on bad input — is pinned ONLY by the tests; infer it from ' +
        'them. The pieces are STRONGLY COUPLED: parsing, formatting, comparison, and the bump / ' +
        'replace functions all reuse the same shared logic, so a change that fixes one family of ' +
        'tests can regress another — watch for that. WORKFLOW: read the test files and verkit.py, ' +
        'implement verkit.py completely, then call run_tests to see how many passed and which ' +
        'tests FAIL, and fix exactly those — iterate until every test passes. Note the edge ' +
        'cases (empty / shortest inputs, leading zeros, prerelease vs build precedence, the ' +
        'first and undefined index positions, the major-0 special case, exact error messages). ' +
        'Do not edit the test files or conftest.py.',
      meta: { seed: trial },
    } satisfies AgenticTask
  })

/** The correct verkit.py — used ONLY by the $0 calibration self-check (never by the agent). */
function referenceSource(): string {
  return readFileSync(join(fixtureDir, realFile), 'utf8')
}

// ── calibrate-before-measure ($0, no router): stub -> 0, real source -> all pass ───────────
/** Prove the task is SOLVABLE (real source -> all pass), the grader DISCRIMINATES (stub -> 0),
 *  and the suite is LONG enough — all via real host pytest, no LLM. A real source that doesn't
 *  clear, or a stub that scores above 0, means the fixture/grader is broken — fix it before
 *  spending. Also prints the structural shape (files, defs, implementation lines). */
async function calibrate(): Promise<void> {
  console.log('═══ CALIBRATION ($0, host pytest, no LLM) — solvable + discriminating + long? ═══')
  const task = (await verkitTasks(0, 1))[0]!
  const h = await verkitEnv.open(task)
  const stub = await verkitEnv.score(task, h)
  const stubReport = runTestsReport(h.id) // the failing-list shape the agent sees on the stub
  await verkitEnv.call(h, 'write_file', { path: moduleFile, content: referenceSource() })
  const real = await verkitEnv.score(task, h)
  await verkitEnv.close(h)

  const realSrc = referenceSource()
  const stubSrc = readFileSync(join(fixtureDir, stubFile), 'utf8')
  const nonBlank = (s: string): number => s.split('\n').filter((l) => l.trim()).length
  const defCount = (realSrc.match(/^\s*def /gm) ?? []).length
  const implLines = nonBlank(realSrc) - nonBlank(stubSrc)

  const ok =
    stub.passes === 0 &&
    stub.errored === 0 &&
    real.passes === expectedTotal &&
    real.total === expectedTotal &&
    real.errored === 0 &&
    expectedTotal >= 80

  console.log(`  library: verkit  (python-semver 3.0.4, renamed; pure stdlib, BSD-3)`)
  console.log(`  source files: 1 (${moduleFile})   test files: ${testFiles.length}`)
  console.log(`  defs to implement (methods + module functions): ${defCount}`)
  console.log(`  implementation lines to write (real minus stub, non-blank): ${implLines}`)
  console.log(
    `  stub  -> ${stub.passes}/${stub.total} passed (errored=${stub.errored})  ` +
      `[expect 0 — the grader discriminates]`,
  )
  console.log(
    `  real  -> ${real.passes}/${real.total} passed (errored=${real.errored})  ` +
      `[expect ${expectedTotal} — the task is solvable]`,
  )
  console.log(`  failing-list shape on the stub: ${stubReport.slice(0, 240)}…`)
  console.log(
    ok
      ? `\n>>> CALIBRATED — stub 0%, real 100% over ${expectedTotal} real pytest tests across one ` +
          `strongly-coupled module (${defCount} defs, ~${implLines} impl lines). Long-enough + ` +
          `solvable + discriminating. Regime: fix-one / break-another coupling (shared ` +
          `parse/format/ordering logic), smooth partial credit — a continuous worker oscillates; ` +
          `a fresh respawn re-reads only the current file + failing tests. CONTAMINATION: ` +
          `spec-level semantics are likely memorized — see fixtures/verkit/PROVENANCE.md; the ` +
          `signal is the library-idiosyncratic, non-spec edge behaviour.`
      : '\n>>> BROKEN — fix the fixture/grader before spending.',
  )
  if (!ok) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`)
  calibrate().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
    process.exit(1)
  })
