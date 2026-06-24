/**
 * The held-out coding-task corpus — and the NO-CHEAT FIREWALL, expressed as a type.
 *
 * Every scenario splits cleanly into two halves:
 *   - `prompt`      — THE ONLY field the agent ever sees. The dispatch copies it
 *                     (and nothing else) into the worker's context.
 *   - everything else — the deterministic test fixture, the realness signals, the
 *                     rubric note — is EVAL-ONLY. It is read by eval.ts to score the
 *                     result; the fixture is SEEDED into the box (so `node --test`
 *                     has something to run) but its CONTENT is never described to the
 *                     agent, and the rubric/realness signals are never written into
 *                     the box at all. Because the two halves are different fields on
 *                     one object, "the agent can read the answer key" becomes a thing
 *                     you can SEE in one place: it would require dispatch.ts to put a
 *                     non-`prompt` field into the profile. It does not. (See the
 *                     `// FIREWALL` comment in dispatch.ts for the exact line.)
 *
 * This is the structural defense the design calls for: the firewall is a property
 * of which field flows where, not a runtime check you have to trust.
 */

import type { AuthenticitySignals } from '@tangle-network/agent-eval/authenticity'
import type { Scenario } from '@tangle-network/agent-eval/campaign'

/** A file the harness seeds into the box workspace before the run — the test the
 *  deterministic check executes. EVAL-ONLY: its content is never shown to the agent. */
export interface Fixture {
  path: string
  content: string
}

/** One held-out coding task. Extends the substrate `Scenario` ({ id, kind, tags }). */
export interface CodingScenario extends Scenario {
  /** ── AGENT-VISIBLE ──────────────────────────────────────────────────────
   *  The task as the agent reads it. A clean scaffold description + the ask.
   *  This is the WHOLE of what reaches the worker's context. */
  prompt: string

  /** ── EVAL-ONLY (the agent never reads these) ──────────────────────────── */

  /** Path (relative to the workspace root) the agent is asked to produce. The
   *  checks read this file off the box AFTER the turn; the judge scores it. */
  solutionPath: string

  /** The hidden test, seeded into the box so `node --test` has a real file to run.
   *  Seeded write-only — the agent is told WHAT to build (the prompt), never the
   *  assertions it is graded against. */
  fixture: Fixture

  /** Realness anchor input for `scoreAuthenticity` — catches a stub that compiles
   *  but fakes the hard part. Write-only to the record; never reaches the box. */
  realnessSignals: AuthenticitySignals

  /** Extra grading context for the JUDGE only (design intent, edge cases to
   *  reward). Lives with the judge, never in the workdir. */
  rubricNote: string
}

// The deterministic check commands. Invoked directly (NOT via `npx -y`, which forces
// a registry round-trip every run): a real harness box has `tsc`/`biome`/`node` on
// PATH, so these run for real there; offline the missing tool fails FAST with a
// non-zero exit (the honest offline signal), not a 20s network stall.
/** A typecheck shell command for one solution file. */
const typecheckCmd = (path: string) => `tsc --noEmit --strict --skipLibCheck ${path}`
/** A `node --test` command for one fixture. The fixture imports the solution as a `.ts`
 *  file, so we run with `--experimental-transform-types`: Node's DEFAULT type-stripping
 *  is strip-only and throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on TS that emits runtime
 *  code — including constructor PARAMETER PROPERTIES (`constructor(private x: number)`),
 *  the exact style the canonical token-bucket impl uses. Without the flag a CORRECT
 *  solution would exit 1 and score as a test failure. The flag transforms (not just
 *  strips) the types so param properties run. */
const testCmd = (fixturePath: string) => `node --experimental-transform-types --test ${fixturePath}`
/** A lint shell command for one solution file. */
const lintCmd = (path: string) => `biome check ${path}`

/**
 * A 2-task corpus. Real benchmarks carry 20-50; two keeps the example readable.
 * Both are self-contained "write one module that passes these checks" tasks — the
 * shape that has a CORRECTABLE MIDDLE BAND (build-passes-but-quality-varies), which
 * is what makes a benchmark able to separate harnesses at all.
 */
export const scenarios: CodingScenario[] = [
  {
    id: 'rate-limiter',
    kind: 'coding',
    tags: ['algorithms', 'concurrency'],
    prompt: [
      'Implement a token-bucket rate limiter in TypeScript at `src/rate-limiter.ts`.',
      'Export `class RateLimiter` with a constructor `(capacity: number, refillPerSec: number)`',
      'and a method `tryRemove(tokens: number): boolean` that returns true and consumes the',
      'tokens if enough are available (refilling continuously over elapsed wall-clock time),',
      'and false otherwise. No external dependencies.',
    ].join(' '),
    solutionPath: 'src/rate-limiter.ts',
    fixture: {
      path: 'test/rate-limiter.test.js',
      content: `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter } from '../src/rate-limiter.ts'

test('consumes when tokens available', () => {
  const rl = new RateLimiter(10, 1)
  assert.equal(rl.tryRemove(5), true)
  assert.equal(rl.tryRemove(5), true)
})

test('rejects when over capacity', () => {
  const rl = new RateLimiter(3, 1)
  assert.equal(rl.tryRemove(4), false)
})

test('rejects a second draw that exceeds the remaining bucket', () => {
  const rl = new RateLimiter(10, 0)
  assert.equal(rl.tryRemove(8), true)
  assert.equal(rl.tryRemove(8), false)
})
`,
    },
    realnessSignals: {
      label: 'token-bucket',
      requiredArtifact: /rate-limiter\.ts$/,
      // The hard part must be present: time-based refill math, not a hardcoded true.
      realImpl: /Date\.now\(\)|performance\.now\(\)|elapsed|refill/,
      realInfra: /class\s+RateLimiter/,
      // The fake: a tryRemove whose ENTIRE body is `return true` (no refill math
      // before it). Tightened so a real impl that legitimately ends in `return true`
      // is NOT flagged — the shim is "returns true with no logic", not "returns true".
      fakeShim: /tryRemove\([^)]*\)\s*:\s*boolean\s*{\s*return\s+true/,
    },
    rubricNote:
      'Reward continuous (not discrete-tick) refill, integer-safe token accounting, and ' +
      'correct behavior when tokens requested exceeds capacity (must return false, never block).',
  },
  {
    id: 'csv-parser',
    kind: 'coding',
    tags: ['parsing', 'edge-cases'],
    prompt: [
      'Implement an RFC-4180 CSV parser in TypeScript at `src/csv.ts`.',
      'Export `function parseCsv(input: string): string[][]`. It must handle quoted fields,',
      'escaped double-quotes inside quotes (""), and embedded newlines within quoted fields.',
      'No external dependencies.',
    ].join(' '),
    solutionPath: 'src/csv.ts',
    fixture: {
      path: 'test/csv.test.js',
      content: `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv } from '../src/csv.ts'

test('parses a plain row', () => {
  assert.deepEqual(parseCsv('a,b,c'), [['a', 'b', 'c']])
})

test('keeps a comma inside a quoted field', () => {
  assert.deepEqual(parseCsv('"a,b",c'), [['a,b', 'c']])
})

test('keeps a newline inside a quoted field', () => {
  assert.deepEqual(parseCsv('"line1\\nline2",b'), [['line1\\nline2', 'b']])
})

test('unescapes a doubled quote', () => {
  assert.deepEqual(parseCsv('"she said ""hi"""'), [['she said "hi"']])
})
`,
    },
    realnessSignals: {
      label: 'csv-rfc4180',
      requiredArtifact: /csv\.ts$/,
      // Real parsers track quote state char-by-char; a naive split is the fake.
      realImpl: /inQuotes|state|charAt|for\s*\(|while\s*\(/,
      realInfra: /function\s+parseCsv/,
      // The fake: splitting on comma or newline (naive parse) — the RFC-4180 cases
      // (quoted comma, embedded newline) make `.split` wrong. Matches anywhere, not
      // just line-end, so `input.split('\n').map(l => l.split(','))` is caught.
      fakeShim: /\.split\(\s*['"`](,|\\n)['"`]\s*\)/,
    },
    rubricNote:
      'Reward a single-pass state machine over naive splitting; correct handling of a quoted ' +
      'field containing a comma, a literal newline, and an escaped quote.',
  },
]

/** The deterministic check commands for a scenario — derived from its paths, in the
 *  ordered pipeline the verifier runs (typecheck → test → lint). Eval config: the
 *  agent is told WHAT to build, never the commands it is graded by. */
export function checkCmds(scenario: CodingScenario): {
  typecheck: string
  test: string
  lint: string
} {
  return {
    typecheck: typecheckCmd(scenario.solutionPath),
    test: testCmd(scenario.fixture.path),
    lint: lintCmd(scenario.solutionPath),
  }
}
