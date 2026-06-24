/**
 * The held-out coding-task corpus — and the GRADING-CRITERIA FIREWALL, expressed as
 * a type.
 *
 * Every scenario splits into three layers by where each field flows:
 *   - `prompt`      — the only field copied into the agent's CONTEXT. The dispatch
 *                     copies it (and next-round prompts built only from check output)
 *                     into the worker; nothing else reaches the worker's context.
 *   - `fixture`     — the deterministic test. It is SEEDED into the box workspace (so
 *                     `node --test` has a file to run) and a multi-round agent with
 *                     native file tools CAN read it — this is intentional, the same as
 *                     real TDD: the test is a SPEC the agent is asked to satisfy, not
 *                     a hidden rubric. Its assertions are never described in the
 *                     prompt, but they are not hidden from the filesystem.
 *   - rubric/realness — the LLM-judge rubric note and the realness signals. These are
 *                     never written into the box at all; eval.ts reads them AFTER the
 *                     loop to score the result. THIS is what the firewall actually
 *                     protects: the grading criteria the agent can't steer toward.
 *
 * The firewall is a property of which field flows where — you can SEE it in one place
 * (it would require dispatch.ts to put a rubric/realness field into the profile, which
 * it does not; see the `// FIREWALL` comment in dispatch.ts). The honest claim is the
 * precise one: the rubric and realness signals never touch the box; the test fixture
 * is deliberately visible to the agent.
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
 *  strips) the types so param properties run.
 *
 *  NODE FLOOR: `--experimental-transform-types` and `.ts`-import test execution need
 *  Node >= 22.6 (the package's `engines.node` floor covers the offline path, which
 *  degrades gracefully when the toolchain is absent, but the test LAYER itself — live
 *  or when copied — requires Node >= 22.6). On an older Node a correct solution would
 *  fail with no hint why. */
const testCmd = (fixturePath: string) => `node --experimental-transform-types --test ${fixturePath}`
/** A lint shell command for one solution file. */
const lintCmd = (path: string) => `biome check ${path}`

/**
 * A 3-task corpus. Real benchmarks carry 20-50; three keeps the example readable.
 * Each is a self-contained "write one module that passes these checks" task — the
 * shape that has a CORRECTABLE MIDDLE BAND (build-passes-but-quality-varies), which
 * is what makes a benchmark able to separate harnesses at all.
 *
 * The realness signals on each task are tuned so the NATURAL cheat gates, not just one
 * strawman stub: a shim only reads as "real" when the actual hard-part work is present
 * (refill math / quote-state tracking / capacity eviction), and the fake patterns catch
 * the obvious shortcut regardless of decoy tokens (a `refill` param name, a stray
 * `for (`, a passthrough `Map`). The smoke test asserts each natural cheat is gated.
 *
 * POWER CAVEAT: three scenarios is far below the n the significance machinery needs to
 * separate harnesses — the paired tests demonstrate the WIRING, not a defensible claim.
 * A real run wants 20-50 tasks. `renderStats` prints this caveat when n < 6.
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
      // The hard part must be present: actual refill MATH — a clock read combined with
      // refillPerSec, or refillPerSec used in an arithmetic expression. A bare `refill`
      // identifier (e.g. a constructor param named `refillPerSec`) is NOT enough, so a
      // hollow `return true` whose only `refill` is the param name does not read as real.
      realImpl:
        /(Date\.now\(\)|performance\.now\(\))[\s\S]*refillPerSec\s*[)*]|\*\s*(this\.)?refillPerSec/,
      realInfra: /class\s+RateLimiter/,
      // The fake: a tryRemove whose body opens with `return true` (no refill math before
      // it). A real impl that legitimately ENDS in `return true` after the math is not
      // flagged — the shim is "returns true with no logic", not "returns true". Combined
      // with the tightened realImpl above, the gate (fakeShim && !realImpl) now fires on
      // a stub even when its constructor param is named `refillPerSec`.
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
      // Real parsers track quote state and walk the string char-by-char. We anchor to
      // quote-state / per-char access (`inQuotes`, `charAt(`, `input[i]`), NOT a bare
      // `for (` — a naive `for (line of input.split('\n'))` cheat has a loop but no
      // quote state, so it must not read as a real impl.
      realImpl: /inQuotes|charAt\(|input\[\s*i\s*\]|quote/i,
      realInfra: /function\s+parseCsv/,
      // The fake: splitting on comma or newline (naive parse) — the RFC-4180 cases
      // (quoted comma, embedded newline) make `.split` wrong. Matches anywhere, so the
      // naive `input.split('\n').map(l => l.split(','))` AND a `for (… input.split('\n'))`
      // loop are both caught. Any such split is the shortcut, regardless of loops around it.
      fakeShim: /\.split\(\s*['"`](,|\\n)['"`]\s*\)/,
    },
    rubricNote:
      'Reward a single-pass state machine over naive splitting; correct handling of a quoted ' +
      'field containing a comma, a literal newline, and an escaped quote.',
  },
  {
    // The "only the real algorithm passes" task: a capacity-bounded LRU cache. There is
    // no shortcut that satisfies the eviction tests — a bare `Map` (or `extends Map`)
    // grows without bound and fails the at-capacity test, AND gates on realness.
    id: 'lru-cache',
    kind: 'coding',
    tags: ['data-structures', 'eviction'],
    prompt: [
      'Implement a capacity-bounded LRU (least-recently-used) cache in TypeScript at',
      '`src/lru.ts`. Export `class LruCache<K, V>` with a constructor `(capacity: number)`,',
      'a `get(key: K): V | undefined`, and a `set(key: K, value: V): void`. On `set` past',
      'capacity, evict the least-recently-used entry; a `get` or a re-`set` counts as a use',
      '(refreshes recency). No external dependencies.',
    ].join(' '),
    solutionPath: 'src/lru.ts',
    fixture: {
      path: 'test/lru.test.js',
      content: `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LruCache } from '../src/lru.ts'

test('evicts the least-recently-used entry at capacity', () => {
  const c = new LruCache(2)
  c.set('a', 1)
  c.set('b', 2)
  c.set('c', 3)
  assert.equal(c.get('a'), undefined)
  assert.equal(c.get('b'), 2)
  assert.equal(c.get('c'), 3)
})

test('a get refreshes recency so the other key is evicted', () => {
  const c = new LruCache(2)
  c.set('a', 1)
  c.set('b', 2)
  assert.equal(c.get('a'), 1)
  c.set('c', 3)
  assert.equal(c.get('b'), undefined)
  assert.equal(c.get('a'), 1)
})

test('returns undefined for a missing key', () => {
  const c = new LruCache(2)
  assert.equal(c.get('x'), undefined)
})
`,
    },
    realnessSignals: {
      label: 'lru-cache',
      requiredArtifact: /lru\.ts$/,
      // The hard part is eviction: a delete that precedes a set (the recency move), the
      // canonical `keys().next()` oldest-key eviction, or an explicit size>=capacity
      // check. None of these appear in a no-eviction wrapper.
      realImpl:
        /\.delete\([^)]*\)[\s\S]*\.set\(|\.keys\(\)\.next\(\)|\.size\s*>=?\s*this\.capacity/,
      realInfra: /class\s+LruCache/,
      // The fake: a class that `extends Map` (no eviction override), or a `set` body that
      // is a single passthrough `.set` with no delete/size logic — the bounded-cache
      // shortcut that grows forever.
      fakeShim:
        /extends\s+Map\b|set\([^)]*\)[^{]*{\s*(this\.|return\s+)?\w+\.set\([^)]*\)\s*;?\s*}/,
    },
    rubricNote:
      'Reward O(1) get/set with correct LRU eviction and recency refresh on read; an ' +
      'insertion-ordered Map with delete+re-set is the idiomatic dependency-free approach.',
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
