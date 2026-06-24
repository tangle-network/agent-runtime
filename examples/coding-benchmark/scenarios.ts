/**
 * The held-out coding-task corpus — the GRADING-CRITERIA FIREWALL expressed as a type.
 * Each scenario splits its four fields by WHERE each one flows. The `fieldRouting` below
 * declares each field's `FieldDestination`; `routeCodingFields` turns a scenario into the
 * substrate's `RoutedField[]`, and `dispatch.ts` feeds those to `assertNoHiddenLeak` /
 * `gradeOnHidden` (the agent-eval hidden-criteria firewall). The honest claim: the held-out
 * suite and the rubric never touch the box during the turn; the visible tests are
 * deliberately readable by the agent (real TDD).
 */

import { type FieldDestination, type RoutedField, routeFields } from '@tangle-network/agent-eval'
import type { Scenario } from '@tangle-network/agent-eval/campaign'

/** A test file the harness writes into the box. `visibleTest` is seeded DURING the turn
 *  (the agent may read it); `heldoutTest` is seeded ONLY at grading, after the turn. */
export interface TestFile {
  path: string
  content: string
}

/** One held-out coding task. Extends the substrate `Scenario` ({ id, kind, tags }). */
export interface CodingScenario extends Scenario {
  /** ── AGENT-VISIBLE ──────────────────────────────────────────────────────
   *  The task as the agent reads it. A clean scaffold description + the ask.
   *  This is the WHOLE of what reaches the worker's context. */
  prompt: string

  /** Path (relative to the workspace root) the agent is asked to produce. The
   *  checks read this file off the box AFTER the turn; the judge scores it. */
  solutionPath: string

  /** ── DEVELOP-AGAINST (seeded during the turn, TDD-style) ─────────────────
   *  A few example tests, seeded into the box so the agent can run/read them. */
  visibleTest: TestFile

  /** ── GRADING-ONLY (the agent NEVER sees this during the turn) ────────────
   *  The held-out suite — same behavior, different inputs + edge cases the visible
   *  examples don't cover. Seeded ONLY at grading; the held-out pass rate is the
   *  PRIMARY, ungameable correctness score. Catches a hardcode-the-visible cheat. */
  heldoutTest: TestFile

  /** Extra grading context for the JUDGE only (design intent, edge cases to
   *  reward). Lives with the judge, never in the workdir. Secondary signal. */
  rubricNote: string
}

// The deterministic check commands. Invoked directly (NOT via `npx -y`, which forces
// a registry round-trip every run): a real harness box has `tsc`/`biome`/`node` on
// PATH, so these run for real there; offline the missing tool fails FAST with a
// non-zero exit (the honest offline signal), not a 20s network stall.
/** A typecheck shell command for one solution file. */
const typecheckCmd = (path: string) => `tsc --noEmit --strict --skipLibCheck ${path}`
/** A `node --test` command for one test file. The test imports the solution as a `.ts`
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
const testCmd = (testPath: string) => `node --experimental-transform-types --test ${testPath}`
/** A lint shell command for one solution file. */
const lintCmd = (path: string) => `biome check ${path}`

/**
 * A 3-task corpus (real benchmarks carry 20-50; three keeps the example readable). Each
 * is a self-contained "write one module that passes these checks" task — the shape with a
 * CORRECTABLE MIDDLE BAND (build-passes-but-quality-varies) that lets a benchmark separate
 * harnesses at all. The load-bearing invariant per task: each `heldoutTest` covers the
 * SAME behavior as its `visibleTest` with DIFFERENT inputs + extra edge cases, so a
 * hardcode-the-visible cheat passes `visibleTest` but fails `heldoutTest` (exit 1) — the
 * anti-cheat, by execution. (Power caveat at this n: see `stats.ts` / the README.)
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
    visibleTest: {
      path: 'test/rate-limiter.test.ts',
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
    // HELD-OUT: same token-bucket behavior, DIFFERENT capacities/draws + extra edge
    // cases (exact-capacity draw, zero-token draw). A solution that hardcoded the
    // visible numbers (cap 10/3/10, draws 5/4/8) cannot satisfy these.
    heldoutTest: {
      path: 'test/rate-limiter.heldout.test.ts',
      content: `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter } from '../src/rate-limiter.ts'

test('consumes within a different capacity', () => {
  const rl = new RateLimiter(7, 1)
  assert.equal(rl.tryRemove(4), true)
  assert.equal(rl.tryRemove(3), true)
})

test('allows a draw exactly equal to the remaining bucket', () => {
  const rl = new RateLimiter(6, 0)
  assert.equal(rl.tryRemove(6), true)
  assert.equal(rl.tryRemove(1), false)
})

test('rejects a draw over a different capacity', () => {
  const rl = new RateLimiter(5, 1)
  assert.equal(rl.tryRemove(6), false)
})

test('a zero-token draw always succeeds without consuming', () => {
  const rl = new RateLimiter(2, 0)
  assert.equal(rl.tryRemove(0), true)
  assert.equal(rl.tryRemove(2), true)
})
`,
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
    visibleTest: {
      path: 'test/csv.test.ts',
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
    // HELD-OUT: same RFC-4180 behaviors, DIFFERENT strings + extra edge cases (a multi-row
    // input with two records, an empty field). A parser that hardcoded the visible inputs
    // cannot satisfy these.
    heldoutTest: {
      path: 'test/csv.heldout.test.ts',
      content: `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv } from '../src/csv.ts'

test('parses a different plain row', () => {
  assert.deepEqual(parseCsv('x,y,z,w'), [['x', 'y', 'z', 'w']])
})

test('keeps a comma inside a different quoted field', () => {
  assert.deepEqual(parseCsv('p,"q,r,s"'), [['p', 'q,r,s']])
})

test('parses two records separated by a newline', () => {
  assert.deepEqual(parseCsv('a,b\\nc,d'), [['a', 'b'], ['c', 'd']])
})

test('keeps a newline inside a different quoted field', () => {
  assert.deepEqual(parseCsv('"alpha\\nbeta",gamma'), [['alpha\\nbeta', 'gamma']])
})

test('unescapes a different doubled quote', () => {
  assert.deepEqual(parseCsv('"a ""b"" c"'), [['a "b" c']])
})

test('keeps an empty field between commas', () => {
  assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']])
})
`,
    },
    rubricNote:
      'Reward a single-pass state machine over naive splitting; correct handling of a quoted ' +
      'field containing a comma, a literal newline, and an escaped quote.',
  },
  {
    // The "only the real algorithm passes" task: a capacity-bounded LRU cache. There is
    // no shortcut that satisfies the eviction tests — a bare `Map` (or `extends Map`)
    // grows without bound and fails the at-capacity held-out test.
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
    visibleTest: {
      path: 'test/lru.test.ts',
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
    // HELD-OUT: same eviction behavior, DIFFERENT capacity + key sequence + extra edge
    // cases (a re-set updates value AND refreshes recency). A cache that hardcoded the
    // visible keys/order cannot satisfy these.
    heldoutTest: {
      path: 'test/lru.heldout.test.ts',
      content: `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LruCache } from '../src/lru.ts'

test('evicts the LRU entry at a different capacity', () => {
  const c = new LruCache(3)
  c.set('p', 1)
  c.set('q', 2)
  c.set('r', 3)
  c.set('s', 4)
  assert.equal(c.get('p'), undefined)
  assert.equal(c.get('q'), 2)
  assert.equal(c.get('s'), 4)
})

test('a get refreshes recency for a different sequence', () => {
  const c = new LruCache(2)
  c.set('m', 1)
  c.set('n', 2)
  assert.equal(c.get('m'), 1)
  c.set('o', 3)
  assert.equal(c.get('n'), undefined)
  assert.equal(c.get('m'), 1)
})

test('a re-set updates the value and refreshes recency', () => {
  const c = new LruCache(2)
  c.set('a', 1)
  c.set('b', 2)
  c.set('a', 9)
  c.set('c', 3)
  assert.equal(c.get('b'), undefined)
  assert.equal(c.get('a'), 9)
  assert.equal(c.get('c'), 3)
})
`,
    },
    rubricNote:
      'Reward O(1) get/set with correct LRU eviction and recency refresh on read; an ' +
      'insertion-ordered Map with delete+re-set is the idiomatic dependency-free approach.',
  },
]

/** The deterministic check commands for a scenario — derived from its paths.
 *
 *  `dev` runs the VISIBLE example tests (seeded during the turn, what steers the refine
 *  loop). `heldout` runs the HIDDEN grading suite (seeded only at grading, never during
 *  the turn — the firewall). Eval config: the agent is told WHAT to build (the prompt)
 *  and develops against the visible tests, but is GRADED on the held-out suite it never
 *  saw, so it cannot fit the grade. */
export function checkCmds(scenario: CodingScenario): {
  typecheck: string
  dev: string
  heldout: string
  lint: string
} {
  return {
    typecheck: typecheckCmd(scenario.solutionPath),
    dev: testCmd(scenario.visibleTest.path),
    heldout: testCmd(scenario.heldoutTest.path),
    lint: lintCmd(scenario.solutionPath),
  }
}

/** The fields the coding domain owns, by name. The keys here are the names
 *  `routeCodingFields` projects each scenario into; the firewall is keyed on the
 *  DESTINATION, not the name. */
type CodingFieldName = 'prompt' | 'visibleTest' | 'heldoutTest' | 'rubricNote'

/**
 * WHERE each scenario field is allowed to flow — the firewall, declared as data.
 * `agent-eval`'s `assertNoHiddenLeak` reads these tags (not field names): a
 * `grading-only`/`judge-only` value found in the agent context is a breach.
 *
 *   - prompt        → `agent-visible`   (the task the agent reads to act)
 *   - visibleTest   → `develop-against` (seeded during the turn; the agent MAY read it — TDD)
 *   - heldoutTest   → `grading-only`    (the hidden suite; never reaches the agent)
 *   - rubricNote    → `judge-only`      (rubric context; lives with the judge, never in the box)
 */
export const fieldRouting: Readonly<Record<CodingFieldName, FieldDestination>> = {
  prompt: 'agent-visible',
  visibleTest: 'develop-against',
  heldoutTest: 'grading-only',
  rubricNote: 'judge-only',
}

/** Project a scenario into the substrate's `RoutedField[]` — each field paired with the
 *  destination `fieldRouting` declares. `dispatch.ts` hands the result to `assertNoHiddenLeak`
 *  / `gradeOnHidden`. The rendered VALUE is what the firewall substring-checks against the
 *  agent context, so the test-file fields render their CONTENT (the text that must not leak). */
export function routeCodingFields(scenario: CodingScenario): RoutedField[] {
  return routeFields<CodingFieldName>(fieldRouting, {
    prompt: scenario.prompt,
    visibleTest: scenario.visibleTest.content,
    heldoutTest: scenario.heldoutTest.content,
    rubricNote: scenario.rubricNote,
  })
}
