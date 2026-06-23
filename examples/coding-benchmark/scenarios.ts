/**
 * The held-out coding-task corpus — and the NO-CHEAT FIREWALL, expressed as a type.
 *
 * Every scenario splits cleanly into two halves:
 *   - `prompt`      — THE ONLY field the agent ever sees. The dispatch copies it
 *                     (and nothing else) into the worker's context.
 *   - everything else — the rubric note, the validator commands, the realness
 *                     signals — is EVAL-ONLY. It is read by validators.ts and
 *                     judges.ts to score the result; it is NEVER written into the
 *                     box. Because the two halves are different fields on the same
 *                     object, "the agent can read the answer key" becomes a thing
 *                     you can SEE in one place: it would require dispatch.ts to put
 *                     a non-`prompt` field into the profile. It does not. (See the
 *                     `// FIREWALL` comment in dispatch.ts for the exact line.)
 *
 * This is the structural defense the design calls for: the firewall is a property
 * of which field flows where, not a runtime check you have to trust.
 */

import type { AuthenticitySignals } from '@tangle-network/agent-eval/authenticity'
import type { Scenario } from '@tangle-network/agent-eval/campaign'

/** One held-out coding task. Extends the substrate `Scenario` ({ id, kind, tags }). */
export interface CodingScenario extends Scenario {
  /** ── AGENT-VISIBLE ──────────────────────────────────────────────────────
   *  The task as the agent reads it. A clean scaffold description + the ask.
   *  This is the WHOLE of what reaches the worker's context. */
  prompt: string

  /** ── EVAL-ONLY (never written into the box) ───────────────────────────── */

  /** Path (relative to the workspace root) the agent is asked to produce. The
   *  validators read this file off the box AFTER the turn; the judge scores it. */
  solutionPath: string

  /** Deterministic checks, run in order, in the box, BEFORE any judge. These are
   *  shell commands the harness runs against the produced code. Objective, ~$0.
   *  They are eval config — the agent is told WHAT to build, never HOW it's graded. */
  validatorCmds: {
    typecheck: string
    test: string
    lint: string
  }

  /** Drives `scoreAuthenticity` — catches a stub that compiles but fakes the
   *  hard part. Write-only to the record; the agent cannot read or steer it. */
  realnessSignals: AuthenticitySignals

  /** Extra grading context for the JUDGE only (design intent, edge cases to
   *  reward). Lives with the judge, never in the workdir. */
  rubricNote: string
}

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
    validatorCmds: {
      typecheck: 'npx tsc --noEmit src/rate-limiter.ts',
      test: 'node --test test/rate-limiter.test.js',
      lint: 'npx biome check src/rate-limiter.ts',
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
    validatorCmds: {
      typecheck: 'npx tsc --noEmit src/csv.ts',
      test: 'node --test test/csv.test.js',
      lint: 'npx biome check src/csv.ts',
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
