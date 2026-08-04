/**
 * long-coding-env-lite — a LIGHTER cut of long-coding-env (SAME surface, ~half the functions so each
 * full-file rewrite is ~2× cheaper) tuned so a CONTINUOUS worker OSCILLATES to a low plateau while a
 * FRESH RESPAWN stays sharp. Same surface EXACTLY (an `AgenticSurface` open/tools[list_files, read_file,
 * write_file, run_tests]/call/score/close + an exported `longCodingTasks(offset,n)` supplier, seed-derived
 * + host-pytest-graded) and the SAME exported names (`longCodingEnv`, `longCodingTasks`, `referenceLib`) so
 * a runner can import this file in place of the 54-function version.
 *
 * HOW THE DIFFICULTY IS BUILT (from the TESTS, not from file size):
 *   - ~28 functions in one TINY lib.py (1–2 line bodies, string/integer ops only) — small ON PURPOSE so a
 *     SUPERVISOR arm (N workers each rewriting the WHOLE file per round) stays tractable at n=10. write_file
 *     requires the COMPLETE lib.py, so every fix is a full-file rewrite.
 *   - ~7 ADVERSARIAL cases per function (~196 host-pytest cases/seed) — each function's cases include the
 *     EXACT inputs that discriminate the convention(s) it consumes: the boundary value `HI` (inclusive vs
 *     exclusive), exact halves `STEP/2` (rounding tie up vs down), the first element at index `base` (0- vs
 *     1-based), negative numbers (the NEGATIVE format), and multi-digit magnitudes (the pad WIDTH). Guess a
 *     convention wrong and you fail a WHOLE BLOCK of cases, not one.
 *
 * THE REGIME (why continuous oscillates and a fresh respawn doesn't):
 *   - 9 SHARED, seed-derived CONVENTIONS — field SEPARATOR, NEGATIVE-number format, range BOUNDARY
 *     (inclusive/exclusive), rounding TIE direction, INDEX base (0- or 1-based), letter CASE, sort ORDER,
 *     number PAD width, and BOOLEAN rendering. Each is consumed by a whole FAMILY of >=3 functions, so its
 *     value has high blast radius: get it right and a whole family passes together; regress it in a later
 *     whole-file rewrite and that whole family fails at once.
 *   - ~10 of the 28 functions consume TWO conventions (SEP+INDEX, SEP+ORDER, NEG+SEP, NEG+PAD, BOUND+BOOL,
 *     TIE+BOUND, INDEX+CASE, ORDER+INDEX, CASE+SEP, BOUND+BOOL again), so an edit that fixes one facet can
 *     break the other — the fix-one / break-another coupling that produces oscillation.
 *   - The obvious DEFAULTS (comma, minus, inclusive, half-up, 0-based, lower, ascending, no-pad, Python
 *     bool) are seed-randomized, so a default-guessing first pass mis-implements a chunk of the suite —
 *     never one-pass-solvable. With 9 conventions only ~1/10240 seeds land on ALL defaults (>=99.9% of
 *     seeds force at least one non-default inference). run_tests dumps the FULL failing list so each re-read
 *     grows a continuous worker's context, while a fresh respawn reads it once against a clean context.
 *
 * A continuous worker accumulates the test file + many full lib.py rewrites + many long failure dumps; its
 * whole-file rewrites increasingly REGRESS earlier-correct families (high blast radius × heavy coupling), so
 * its pass-rate oscillates and plateaus LOW. A fresh respawn that re-reads ONLY the current lib.py + current
 * failing tests makes targeted fixes with no regression. The bottleneck is OSCILLATION/coupling, not
 * capability — each function is individually trivial for a fresh worker.
 *
 * Why contamination-proof: every convention value and every local constant (steps, bounds, separators,
 * widths, caps) is DERIVED FROM THE SEED and pinned ONLY by the test file's cases — the OPERATION is named,
 * the per-seed values must be inferred, so no model can have memorized the answer. Graded by REAL pytest (a
 * deployable check, never an LLM judge). All expected values are integers/strings/lists/bools (no float
 * equality), each computed by a TS reference that mirrors the Python reference.
 *
 * Calibrated at $0 (no LLM): write the reference -> assert 100% pass; the stub -> assert 0% pass; confirm
 * ~170–220 tests/seed across 28 functions. Run the self-check with:
 *   pnpm tsx examples/ablation-suite/long-coding-env-lite.ts
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgenticSurface,
  AgenticTask,
  AgenticTool,
  ArtifactHandle,
  SurfaceScore,
} from '@tangle-network/agent-runtime/kernel'

// ── Seed-derived constants (the contract no model can recall) ────────────────────
/** A well-mixed per-(seed,salt) hash. Each convention and each function draws under its OWN salt so they
 *  vary INDEPENDENTLY — no shared draw aliases two unrelated values into a learnable shortcut. */
const pick = (seed: number, salt: number, m: number): number => {
  let x = (seed ^ (salt * 0x9e3779b1)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 2246822519) >>> 0
  x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  return x % m
}

/** Serialize a TS value to a Python literal for the generated assertions. JSON string escapes are valid
 *  Python, so strings round-trip; dict/list/bool/None are emitted in Python form. No floats are produced. */
function pyLit(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error(`pyLit: non-integer ${v}`)
    return String(v)
  }
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(pyLit).join(', ')}]`
  if (typeof v === 'object')
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${JSON.stringify(k)}: ${pyLit(val)}`)
      .join(', ')}}`
  throw new Error(`pyLit: unsupported ${typeof v}`)
}

const tline = (name: string, i: number, args: ReadonlyArray<unknown>, exp: unknown): string =>
  `def test_${name}_${i}(): assert ${name}(${args.map(pyLit).join(', ')}) == ${pyLit(exp)}`

// ── The shared, seed-derived conventions (the high-blast-radius contract) ──────────
type Neg = 'minus' | 'paren' | 'trail' | 'tilde'
type BoolStyle = 'bool' | 'yn' | 'YN' | 'tf'
interface Conv {
  sep: string // field separator, shared by the split/join family
  neg: Neg // negative-number rendering, shared by the formatter family
  inclusive: boolean // range/clamp/threshold upper bound inclusive?
  tieUp: boolean // rounding ties go up (else down)?
  oneBased: boolean // positional index base (1-based else 0-based)
  upper: boolean // letter case (upper else lower) for the text family
  asc: boolean // sort order ascending (else descending)
  pad: number // zero-pad width for rendered integers (1 = no padding)
  boolStyle: BoolStyle // how a boolean is rendered (native bool, yes/no, Y/N, true/false)
}

/** Every value here is seed-derived and pinned ONLY by the test cases — never written out. The "obvious"
 *  default of each (comma/minus/inclusive/half-up/0-based/lower/ascending/no-pad/native-bool) is randomized
 *  away so a default-guessing first pass mis-implements a chunk of the suite. */
function conventions(seed: number): Conv {
  return {
    sep: [',', ';', '|', ':', '/'][pick(seed, 101, 5)]!,
    neg: (['minus', 'paren', 'trail', 'tilde'] as const)[pick(seed, 103, 4)]!,
    inclusive: pick(seed, 104, 2) === 0,
    tieUp: pick(seed, 105, 2) === 0,
    oneBased: pick(seed, 106, 2) === 0,
    upper: pick(seed, 107, 2) === 0,
    asc: pick(seed, 108, 2) === 0,
    pad: pick(seed, 109, 4) + 1, // 1..4; 1 = no padding (the default)
    boolStyle: (['bool', 'yn', 'YN', 'tf'] as const)[pick(seed, 110, 4)]!,
  }
}

const isAllDefault = (c: Conv): boolean =>
  c.sep === ',' &&
  c.neg === 'minus' &&
  c.inclusive &&
  c.tieUp &&
  !c.oneBased &&
  !c.upper &&
  c.asc &&
  c.pad === 1 &&
  c.boolStyle === 'bool'

// ── TS mirrors of each shared convention (used to compute expected values) ─────────
const tsSigned = (c: Conv, n: number): string =>
  n >= 0
    ? String(n)
    : c.neg === 'paren'
      ? `(${-n})`
      : c.neg === 'trail'
        ? `${-n}-`
        : c.neg === 'tilde'
          ? `~${-n}`
          : String(n)
const tsRound = (c: Conv, x: number, step: number): number =>
  c.tieUp
    ? Math.floor((x + Math.floor(step / 2)) / step) * step
    : Math.floor((x + Math.floor((step - 1) / 2)) / step) * step
const tsCase = (c: Conv, s: string): string => (c.upper ? s.toUpperCase() : s.toLowerCase())
const tsBase = (c: Conv): number => (c.oneBased ? 1 : 0)
const tsOrder = (c: Conv, xs: number[]): number[] => [...xs].sort((a, b) => (c.asc ? a - b : b - a))
const tsPad = (c: Conv, n: number): string => String(n).padStart(c.pad, '0')
const tsPsign = (c: Conv, n: number): string =>
  n >= 0
    ? tsPad(c, n)
    : c.neg === 'paren'
      ? `(${tsPad(c, -n)})`
      : c.neg === 'trail'
        ? `${tsPad(c, -n)}-`
        : c.neg === 'tilde'
          ? `~${tsPad(c, -n)}`
          : `-${tsPad(c, -n)}`
const tsBool = (c: Conv, b: boolean): boolean | string =>
  c.boolStyle === 'bool'
    ? b
    : c.boolStyle === 'yn'
      ? b
        ? 'yes'
        : 'no'
      : c.boolStyle === 'YN'
        ? b
          ? 'Y'
          : 'N'
        : b
          ? 'true'
          : 'false'

/** The shared Python helpers prepended to the reference lib.py (calibration only). A real worker would
 *  write something like these once and reuse them — which is exactly why a wrong value has wide blast
 *  radius. The STUB does not include them; the grader only ever calls the public functions. */
const pyHelpers = (c: Conv): string[] => {
  // Wrap a magnitude EXPRESSION (already a string of digits) in the shared NEGATIVE format.
  const negExpr = (mag: string): string =>
    c.neg === 'paren'
      ? `"(" + ${mag} + ")"`
      : c.neg === 'trail'
        ? `${mag} + "-"`
        : c.neg === 'tilde'
          ? `"~" + ${mag}`
          : `"-" + ${mag}`
  const boolBody =
    c.boolStyle === 'bool'
      ? ['    return b']
      : c.boolStyle === 'yn'
        ? ['    return "yes" if b else "no"']
        : c.boolStyle === 'YN'
          ? ['    return "Y" if b else "N"']
          : ['    return "true" if b else "false"']
  return [
    '# Shared helpers — the conventions every family reuses (values fixed per task).',
    'def _signed(n):',
    '    if n >= 0:',
    '        return str(n)',
    `    return ${negExpr('str(-n)')}`,
    '',
    'def _round(x, step):',
    c.tieUp
      ? '    return (x + step // 2) // step * step'
      : '    return (x + (step - 1) // 2) // step * step',
    '',
    'def _case(s):',
    c.upper ? '    return s.upper()' : '    return s.lower()',
    '',
    'def _pad(n):',
    `    return str(n).zfill(${c.pad})`,
    '',
    'def _psign(n):',
    '    if n >= 0:',
    '        return _pad(n)',
    `    return ${negExpr('_pad(-n)')}`,
    '',
    'def _bool(b):',
    ...boolBody,
    '',
  ]
}

// ── One function's contribution to lib.py + test_lib.py ───────────────────────────
/** The contract (`doc`) names the OPERATION and which shared convention(s) it uses, but not the values;
 *  the cases pin them. `refLines` is the correct Python (calibration only); `tests` are the pytest
 *  assertions with TS-computed expected values. */
interface FnArtifacts {
  name: string
  sig: string
  doc: string
  refLines: string[]
  tests: string[]
}

// ── The 28 function builders, grouped by the shared convention each family exercises ──
// ~10 of the 28 consume TWO conventions (marked DUAL): that cross-coupling is what makes a whole-file
// rewrite regress an earlier-correct family, producing the oscillation a continuous worker can't escape.
const builders: Array<(seed: number, c: Conv) => FnArtifacts> = [
  // ════ FAMILY A — field SEPARATOR ════
  // A1. csv_sum
  (_seed, c) => {
    const f = (s: string): number =>
      s === '' ? 0 : s.split(c.sep).reduce((a, x) => a + Number(x), 0)
    const cases: Array<[string]> = [
      [`4${c.sep}9${c.sep}2`],
      [''],
      [`20${c.sep}5`],
      [`-3${c.sep}7`],
      [`0${c.sep}0${c.sep}0`],
      ['100'],
      [`1${c.sep}2${c.sep}3${c.sep}4`],
    ]
    return {
      name: 'csv_sum',
      sig: 'csv_sum(s)',
      doc: '# csv_sum(s): split on the shared SEP and sum the integer fields. "" -> 0. Negatives allowed in the input.',
      refLines: [
        'def csv_sum(s):',
        '    if not s:',
        '        return 0',
        `    return sum(int(x) for x in s.split(${JSON.stringify(c.sep)}))`,
      ],
      tests: cases.map(([s], i) => tline('csv_sum', i, [s], f(s))),
    }
  },
  // A2. join_nums
  (_seed, c) => {
    const f = (xs: number[]): string => xs.join(c.sep)
    const cases: Array<[number[]]> = [
      [[3, 1, 2]],
      [[7]],
      [[]],
      [[-1, 2]],
      [[0]],
      [[5, 5, 5]],
      [[10, 20, 30]],
    ]
    return {
      name: 'join_nums',
      sig: 'join_nums(xs)',
      doc: '# join_nums(xs): join the integers with the shared SEP. Empty list -> "".',
      refLines: [
        'def join_nums(xs):',
        `    return ${JSON.stringify(c.sep)}.join(str(x) for x in xs)`,
      ],
      tests: cases.map(([xs], i) => tline('join_nums', i, [xs], f(xs))),
    }
  },
  // A3. nth_field — DUAL: SEP + INDEX base.
  (_seed, c) => {
    const base = tsBase(c)
    const f = (s: string, k: number): string => s.split(c.sep)[k - base]!
    const cases: Array<[string, number]> = [
      [`a${c.sep}b${c.sep}c`, base],
      [`a${c.sep}b${c.sep}c`, base + 2],
      [`p${c.sep}q${c.sep}r${c.sep}s`, base + 1],
      [`x${c.sep}y`, base],
      [`one${c.sep}two${c.sep}three`, base + 2],
      [`a${c.sep}b${c.sep}c`, base + 1],
      [`m${c.sep}n`, base + 1],
    ]
    return {
      name: 'nth_field',
      sig: 'nth_field(s, k)',
      doc: '# nth_field(s, k): the k-th field after splitting on the shared SEP, where k uses the shared INDEX base (0- or 1-based).',
      refLines: [
        'def nth_field(s, k):',
        `    return s.split(${JSON.stringify(c.sep)})[k - ${base}]`,
      ],
      tests: cases.map(([s, k], i) => tline('nth_field', i, [s, k], f(s, k))),
    }
  },
  // A4. sorted_csv — DUAL: SEP + ORDER.
  (_seed, c) => {
    const f = (s: string): string => {
      const xs = s.split(c.sep).map(Number)
      return tsOrder(c, xs).join(c.sep)
    }
    const cases: Array<[string]> = [
      [`3${c.sep}1${c.sep}2`],
      [`9${c.sep}4`],
      [`5${c.sep}5${c.sep}1`],
      [`8${c.sep}2${c.sep}6${c.sep}4`],
      ['7'],
      [`10${c.sep}3${c.sep}1`],
      [`2${c.sep}9${c.sep}5${c.sep}1`],
    ]
    return {
      name: 'sorted_csv',
      sig: 'sorted_csv(s)',
      doc: '# sorted_csv(s): split on the shared SEP, sort the integers in the shared ORDER, and re-join with the shared SEP.',
      refLines: [
        'def sorted_csv(s):',
        c.asc
          ? `    xs = sorted(int(x) for x in s.split(${JSON.stringify(c.sep)}))`
          : `    xs = sorted((int(x) for x in s.split(${JSON.stringify(c.sep)})), reverse=True)`,
        `    return ${JSON.stringify(c.sep)}.join(str(x) for x in xs)`,
      ],
      tests: cases.map(([s], i) => tline('sorted_csv', i, [s], f(s))),
    }
  },

  // ════ FAMILY B — NEGATIVE-number format ════
  // B1. fmt_signed
  (_seed, c) => {
    const f = (n: number): string => tsSigned(c, n)
    const cases: Array<[number]> = [[-5], [7], [0], [-1], [-10], [-100], [42]]
    return {
      name: 'fmt_signed',
      sig: 'fmt_signed(n)',
      doc: '# fmt_signed(n): render n as a string using the shared NEGATIVE format (non-negatives are plain decimal).',
      refLines: ['def fmt_signed(n):', '    return _signed(n)'],
      tests: cases.map(([n], i) => tline('fmt_signed', i, [n], f(n))),
    }
  },
  // B2. balance_after
  (_seed, c) => {
    const f = (start: number, xs: number[]): string =>
      tsSigned(c, start + xs.reduce((a, x) => a + x, 0))
    const cases: Array<[number, number[]]> = [
      [10, [-3, -12]],
      [5, [-5]],
      [0, [7]],
      [3, [-10]],
      [20, [-5, -5, -5]],
      [0, [-1, -2, -3]],
      [100, [-50, -50]],
    ]
    return {
      name: 'balance_after',
      sig: 'balance_after(start, xs)',
      doc: '# balance_after(start, xs): render (start + sum(xs)) with the shared NEGATIVE format (the total may be negative).',
      refLines: ['def balance_after(start, xs):', '    return _signed(start + sum(xs))'],
      tests: cases.map(([s, xs], i) => tline('balance_after', i, [s, xs], f(s, xs))),
    }
  },
  // B3. signed_csv — DUAL: NEG + SEP.
  (_seed, c) => {
    const f = (xs: number[]): string => xs.map((x) => tsSigned(c, x)).join(c.sep)
    const cases: Array<[number[]]> = [
      [[-3, 5, -1]],
      [[7]],
      [[-10]],
      [[0, -2]],
      [[5, 5]],
      [[-1, -2, -3]],
      [[12, -7]],
    ]
    return {
      name: 'signed_csv',
      sig: 'signed_csv(xs)',
      doc: '# signed_csv(xs): render each integer with the shared NEGATIVE format, then join the strings with the shared SEP.',
      refLines: [
        'def signed_csv(xs):',
        `    return ${JSON.stringify(c.sep)}.join(_signed(x) for x in xs)`,
      ],
      tests: cases.map(([xs], i) => tline('signed_csv', i, [xs], f(xs))),
    }
  },
  // B4. pad_signed — DUAL: NEG + PAD.
  (_seed, c) => {
    const f = (n: number): string => tsPsign(c, n)
    const cases: Array<[number]> = [[-5], [7], [0], [-42], [123], [-100], [8]]
    return {
      name: 'pad_signed',
      sig: 'pad_signed(n)',
      doc: '# pad_signed(n): render n with its MAGNITUDE zero-padded to the shared PAD width, then wrapped in the shared NEGATIVE format when n < 0.',
      refLines: ['def pad_signed(n):', '    return _psign(n)'],
      tests: cases.map(([n], i) => tline('pad_signed', i, [n], f(n))),
    }
  },

  // ════ FAMILY C — range BOUNDARY (inclusive/exclusive) ════
  // C1. clamp
  (seed, c) => {
    const lo = pick(seed, 3200, 9) - 4
    const hi = lo + 5 + pick(seed, 3201, 6)
    const top = c.inclusive ? hi : hi - 1
    const f = (x: number): number => (x < lo ? lo : x > top ? top : x)
    const cases: Array<[number]> = [[lo - 3], [hi + 5], [hi], [lo], [top], [lo + 1], [hi - 1]]
    return {
      name: 'clamp',
      sig: 'clamp(x)',
      doc: '# clamp(x): clamp x into [LO, HI]; whether HI itself is reachable follows the shared BOUNDARY rule (inclusive or exclusive).',
      refLines: [
        'def clamp(x):',
        `    if x < ${lo}:`,
        `        return ${lo}`,
        `    if x > ${top}:`,
        `        return ${top}`,
        '    return x',
      ],
      tests: cases.map(([x], i) => tline('clamp', i, [x], f(x))),
    }
  },
  // C2. range_size
  (_seed, c) => {
    const f = (a: number, b: number): number =>
      c.inclusive ? Math.max(0, b - a + 1) : Math.max(0, b - a)
    const cases: Array<[number, number]> = [
      [3, 7],
      [5, 5],
      [8, 5],
      [0, 0],
      [2, 3],
      [10, 4],
      [6, 6],
    ]
    return {
      name: 'range_size',
      sig: 'range_size(a, b)',
      doc: '# range_size(a, b): count of integers from a to b; whether b is counted follows the shared BOUNDARY rule. Never negative.',
      refLines: [
        'def range_size(a, b):',
        c.inclusive ? '    return max(0, b - a + 1)' : '    return max(0, b - a)',
      ],
      tests: cases.map(([a, b], i) => tline('range_size', i, [a, b], f(a, b))),
    }
  },
  // C3. in_band — DUAL: BOUNDARY + BOOL.
  (seed, c) => {
    const lo = pick(seed, 3100, 9) - 4
    const hi = lo + 5 + pick(seed, 3101, 6)
    const inb = (x: number): boolean => (c.inclusive ? x >= lo && x <= hi : x >= lo && x < hi)
    const f = (x: number): boolean | string => tsBool(c, inb(x))
    const mid = Math.floor((lo + hi) / 2)
    const cases: Array<[number]> = [[hi], [hi + 1], [hi - 1], [lo], [lo - 1], [lo + 1], [mid]]
    return {
      name: 'in_band',
      sig: 'in_band(x)',
      doc: '# in_band(x): is x in a fixed band [LO, HI]? The upper bound follows the shared BOUNDARY rule; the answer is rendered in the shared BOOLEAN style.',
      refLines: [
        'def in_band(x):',
        c.inclusive
          ? `    return _bool(${lo} <= x <= ${hi})`
          : `    return _bool(${lo} <= x < ${hi})`,
      ],
      tests: cases.map(([x], i) => tline('in_band', i, [x], f(x))),
    }
  },

  // ════ FAMILY D — rounding TIE direction ════
  // D1. round_to
  (seed, c) => {
    const step = pick(seed, 4100, 4) * 2 + 2 // 2,4,6,8
    const half = step / 2
    const f = (x: number): number => tsRound(c, x, step)
    const cases: Array<[number]> = [
      [half],
      [step + half],
      [0],
      [step],
      [step * 3],
      [half - 1],
      [step * 2 + 1],
    ]
    return {
      name: 'round_to',
      sig: 'round_to(x)',
      doc: '# round_to(x): x>=0 rounded to the nearest multiple of a fixed STEP; exact halves follow the shared TIE direction.',
      refLines: ['def round_to(x):', `    return _round(x, ${step})`],
      tests: cases.map(([x], i) => tline('round_to', i, [x], f(x))),
    }
  },
  // D2. avg_round
  (_seed, c) => {
    const f = (a: number, b: number): number => {
      const s = a + b
      const q = Math.floor(s / 2)
      return s % 2 === 1 && c.tieUp ? q + 1 : q
    }
    const cases: Array<[number, number]> = [
      [3, 4],
      [2, 3],
      [4, 4],
      [0, 1],
      [5, 5],
      [6, 7],
      [8, 8],
    ]
    return {
      name: 'avg_round',
      sig: 'avg_round(a, b)',
      doc: '# avg_round(a, b): a,b>=0 -> (a+b)/2 rounded to the nearest integer; the .5 tie follows the shared TIE direction.',
      refLines: c.tieUp
        ? [
            'def avg_round(a, b):',
            '    s = a + b',
            '    q = s // 2',
            '    if s % 2 == 1:',
            '        q += 1',
            '    return q',
          ]
        : ['def avg_round(a, b):', '    return (a + b) // 2'],
      tests: cases.map(([a, b], i) => tline('avg_round', i, [a, b], f(a, b))),
    }
  },
  // D3. round_clip — DUAL: TIE + BOUNDARY.
  (seed, c) => {
    const step = pick(seed, 4700, 4) * 2 + 2 // 2,4,6,8
    const half = step / 2
    const cap = step * (pick(seed, 4701, 3) + 3) // 3,4,5 * STEP -> a multiple of STEP
    const top = c.inclusive ? cap : cap - 1
    const f = (x: number): number => {
      const r = tsRound(c, x, step)
      return r > top ? top : r
    }
    const cases: Array<[number]> = [
      [cap - step + half],
      [cap],
      [cap + step + 1],
      [0],
      [step + half],
      [cap - step],
      [cap + half],
    ]
    return {
      name: 'round_clip',
      sig: 'round_clip(x)',
      doc: '# round_clip(x): x>=0 rounded to the nearest multiple of a fixed STEP (exact halves follow the shared TIE direction), then capped at a fixed CAP whose reachability follows the shared BOUNDARY rule.',
      refLines: [
        'def round_clip(x):',
        `    r = _round(x, ${step})`,
        `    top = ${top}`,
        '    return top if r > top else r',
      ],
      tests: cases.map(([x], i) => tline('round_clip', i, [x], f(x))),
    }
  },

  // ════ FAMILY E — INDEX base (0- or 1-based) ════
  // E1. char_at
  (_seed, c) => {
    const base = tsBase(c)
    const f = (s: string, k: number): string => s[k - base]!
    const cases: Array<[string, number]> = [
      ['abcdef', base],
      ['abcdef', base + 1],
      ['abcdef', base + 5],
      ['xyz', base],
      ['xyz', base + 2],
      ['abcdef', base + 3],
      ['pqrs', base + 1],
    ]
    return {
      name: 'char_at',
      sig: 'char_at(s, k)',
      doc: '# char_at(s, k): the character at position k, where k uses the shared INDEX base (0- or 1-based).',
      refLines: ['def char_at(s, k):', `    return s[k - ${base}]`],
      tests: cases.map(([s, k], i) => tline('char_at', i, [s, k], f(s, k))),
    }
  },
  // E2. index_of
  (_seed, c) => {
    const base = tsBase(c)
    const f = (s: string, ch: string): number => {
      const i = s.indexOf(ch)
      return i < 0 ? -1 : i + base
    }
    const cases: Array<[string, string]> = [
      ['hello', 'l'],
      ['abc', 'a'],
      ['abc', 'z'],
      ['banana', 'a'],
      ['xyz', 'x'],
      ['hello', 'o'],
      ['abc', 'c'],
    ]
    return {
      name: 'index_of',
      sig: 'index_of(s, ch)',
      doc: '# index_of(s, ch): position of the FIRST occurrence of ch using the shared INDEX base, or -1 if absent.',
      refLines: [
        'def index_of(s, ch):',
        '    i = s.find(ch)',
        `    return -1 if i < 0 else i + ${base}`,
      ],
      tests: cases.map(([s, ch], i) => tline('index_of', i, [s, ch], f(s, ch))),
    }
  },
  // E3. nth_word
  (_seed, c) => {
    const base = tsBase(c)
    const f = (s: string, k: number): string => s.split(/\s+/).filter((w) => w)[k - base]!
    const cases: Array<[string, number]> = [
      ['the quick brown fox', base],
      ['the quick brown fox', base + 1],
      ['the quick brown fox', base + 3],
      ['one two three', base + 2],
      ['solo', base],
      ['a b c', base + 1],
      ['the quick brown fox', base + 2],
    ]
    return {
      name: 'nth_word',
      sig: 'nth_word(s, k)',
      doc: '# nth_word(s, k): the k-th whitespace-separated word using the shared INDEX base.',
      refLines: ['def nth_word(s, k):', `    return s.split()[k - ${base}]`],
      tests: cases.map(([s, k], i) => tline('nth_word', i, [s, k], f(s, k))),
    }
  },

  // ════ FAMILY F — letter CASE ════
  // F1. shout
  (_seed, c) => {
    const f = (s: string): string => tsCase(c, s)
    const cases: Array<[string]> = [
      ['Hello'],
      ['abcXYZ'],
      ['MixEd'],
      ['aB'],
      ['Z'],
      ['Test123'],
      ['wOrLd'],
    ]
    return {
      name: 'shout',
      sig: 'shout(s)',
      doc: '# shout(s): convert the whole string to the shared CASE (all-upper or all-lower).',
      refLines: ['def shout(s):', '    return _case(s)'],
      tests: cases.map(([s], i) => tline('shout', i, [s], f(s))),
    }
  },
  // F2. initials
  (_seed, c) => {
    const f = (s: string): string =>
      s
        .split(/\s+/)
        .filter((w) => w)
        .map((w) => tsCase(c, w[0]!))
        .join('')
    const cases: Array<[string]> = [
      ['hello world'],
      ['the Quick brown'],
      ['solo'],
      ['a b c'],
      ['Big Data'],
      ['x y'],
      ['foo bar baz'],
    ]
    return {
      name: 'initials',
      sig: 'initials(s)',
      doc: '# initials(s): the first letter of each whitespace word, in the shared CASE, concatenated.',
      refLines: ['def initials(s):', '    return "".join(_case(w[0]) for w in s.split())'],
      tests: cases.map(([s], i) => tline('initials', i, [s], f(s))),
    }
  },
  // F3. case_at — DUAL: INDEX base + CASE.
  (_seed, c) => {
    const base = tsBase(c)
    const f = (s: string, k: number): string => tsCase(c, s[k - base]!)
    const cases: Array<[string, number]> = [
      ['aBcDeF', base],
      ['aBcDeF', base + 1],
      ['aBcDeF', base + 5],
      ['XyZ', base],
      ['XyZ', base + 2],
      ['mNoP', base + 1],
      ['aBcDeF', base + 3],
    ]
    return {
      name: 'case_at',
      sig: 'case_at(s, k)',
      doc: '# case_at(s, k): the character at position k (k uses the shared INDEX base), converted to the shared CASE.',
      refLines: ['def case_at(s, k):', `    return _case(s[k - ${base}])`],
      tests: cases.map(([s, k], i) => tline('case_at', i, [s, k], f(s, k))),
    }
  },

  // ════ FAMILY G — sort ORDER (ascending/descending) ════
  // G1. sort_nums
  (_seed, c) => {
    const f = (xs: number[]): number[] => tsOrder(c, xs)
    const cases: Array<[number[]]> = [
      [[3, 1, 2]],
      [[5]],
      [[9, 4, 7, 1]],
      [[2, 2, 1]],
      [[10, 5, 8, 3, 1]],
      [[6, 6]],
      [[4, 9, 2, 7, 5]],
    ]
    return {
      name: 'sort_nums',
      sig: 'sort_nums(xs)',
      doc: '# sort_nums(xs): the list sorted in the shared ORDER (ascending or descending).',
      refLines: ['def sort_nums(xs):', `    return sorted(xs${c.asc ? '' : ', reverse=True'})`],
      tests: cases.map(([xs], i) => tline('sort_nums', i, [xs], f(xs))),
    }
  },
  // G2. extreme
  (_seed, c) => {
    const f = (xs: number[]): number => (c.asc ? Math.min(...xs) : Math.max(...xs))
    const cases: Array<[number[]]> = [
      [[3, 1, 2]],
      [[5]],
      [[9, 4, 7]],
      [[2, 8, 5, 1]],
      [[6, 6]],
      [[10, 3, 7, 1, 9]],
      [[4, 2]],
    ]
    return {
      name: 'extreme',
      sig: 'extreme(xs)',
      doc: '# extreme(xs): the value that would come FIRST in the shared ORDER (the min if ascending, the max if descending).',
      refLines: ['def extreme(xs):', c.asc ? '    return min(xs)' : '    return max(xs)'],
      tests: cases.map(([xs], i) => tline('extreme', i, [xs], f(xs))),
    }
  },
  // G3. rank_at — DUAL: ORDER + INDEX base.
  (_seed, c) => {
    const base = tsBase(c)
    const f = (xs: number[], k: number): number => tsOrder(c, xs)[k - base]!
    const cases: Array<[number[], number]> = [
      [[3, 1, 2], base],
      [[3, 1, 2], base + 1],
      [[9, 4, 7, 1], base],
      [[5, 2, 8, 1], base + 2],
      [[6, 3], base],
      [[10, 5, 8, 3], base + 1],
      [[4, 9, 2], base + 2],
    ]
    return {
      name: 'rank_at',
      sig: 'rank_at(xs, k)',
      doc: '# rank_at(xs, k): sort xs in the shared ORDER, then return the element at position k using the shared INDEX base.',
      refLines: [
        'def rank_at(xs, k):',
        `    return sorted(xs${c.asc ? '' : ', reverse=True'})[k - ${base}]`,
      ],
      tests: cases.map(([xs, k], i) => tline('rank_at', i, [xs, k], f(xs, k))),
    }
  },

  // ════ FAMILY H — number PAD width ════
  // H1. pad_num
  (_seed, c) => {
    const f = (n: number): string => tsPad(c, n)
    const cases: Array<[number]> = [[7], [42], [0], [123], [5], [99], [8]]
    return {
      name: 'pad_num',
      sig: 'pad_num(n)',
      doc: '# pad_num(n): n>=0 rendered as a decimal string zero-padded on the left to the shared PAD width (no truncation if longer).',
      refLines: ['def pad_num(n):', '    return _pad(n)'],
      tests: cases.map(([n], i) => tline('pad_num', i, [n], f(n))),
    }
  },
  // H2. pad_list
  (_seed, c) => {
    const f = (xs: number[]): string[] => xs.map((x) => tsPad(c, x))
    const cases: Array<[number[]]> = [
      [[1, 2, 3]],
      [[42]],
      [[0]],
      [[7, 89]],
      [[100, 5]],
      [[9]],
      [[12, 3, 456]],
    ]
    return {
      name: 'pad_list',
      sig: 'pad_list(xs)',
      doc: '# pad_list(xs): each non-negative integer zero-padded to the shared PAD width; return the list of strings.',
      refLines: ['def pad_list(xs):', '    return [_pad(x) for x in xs]'],
      tests: cases.map(([xs], i) => tline('pad_list', i, [xs], f(xs))),
    }
  },

  // ════ FAMILY I — BOOLEAN rendering ════
  // I1. is_pos
  (_seed, c) => {
    const f = (n: number): boolean | string => tsBool(c, n > 0)
    const cases: Array<[number]> = [[5], [0], [-3], [1], [-1], [100], [-50]]
    return {
      name: 'is_pos',
      sig: 'is_pos(n)',
      doc: '# is_pos(n): is n strictly greater than 0? Render the answer in the shared BOOLEAN style.',
      refLines: ['def is_pos(n):', '    return _bool(n > 0)'],
      tests: cases.map(([n], i) => tline('is_pos', i, [n], f(n))),
    }
  },
  // I2. all_in_band — DUAL: BOUNDARY + BOOL.
  (seed, c) => {
    const lo = pick(seed, 3300, 9) - 4
    const hi = lo + 5 + pick(seed, 3301, 6)
    const inb = (x: number): boolean => (c.inclusive ? x >= lo && x <= hi : x >= lo && x < hi)
    const f = (xs: number[]): boolean | string => tsBool(c, xs.every(inb))
    const cases: Array<[number[]]> = [
      [[lo, hi - 1]],
      [[lo + 1, hi]],
      [[lo, hi + 1]],
      [[hi - 1]],
      [[hi]],
      [[lo, Math.floor((lo + hi) / 2)]],
      [[lo - 1, lo + 1]],
    ]
    return {
      name: 'all_in_band',
      sig: 'all_in_band(xs)',
      doc: '# all_in_band(xs): are ALL of xs within the fixed band [LO, HI] (upper bound per the shared BOUNDARY rule)? Render the answer in the shared BOOLEAN style.',
      refLines: [
        'def all_in_band(xs):',
        c.inclusive
          ? `    return _bool(all(${lo} <= x <= ${hi} for x in xs))`
          : `    return _bool(all(${lo} <= x < ${hi} for x in xs))`,
      ],
      tests: cases.map(([xs], i) => tline('all_in_band', i, [xs], f(xs))),
    }
  },
  // I3. cmp_flag — DUAL: ORDER + BOOL.
  (_seed, c) => {
    const f = (a: number, b: number): boolean | string => tsBool(c, c.asc ? a < b : a > b)
    const cases: Array<[number, number]> = [
      [3, 8],
      [8, 3],
      [5, 5],
      [1, 2],
      [9, 4],
      [2, 2],
      [7, 10],
    ]
    return {
      name: 'cmp_flag',
      sig: 'cmp_flag(a, b)',
      doc: '# cmp_flag(a, b): would a come strictly BEFORE b under the shared ORDER (a<b if ascending, a>b if descending)? Render the answer in the shared BOOLEAN style.',
      refLines: ['def cmp_flag(a, b):', `    return _bool(a ${c.asc ? '<' : '>'} b)`],
      tests: cases.map(([a, b], i) => tline('cmp_flag', i, [a, b], f(a, b))),
    }
  },
]

// ── Assemble one task's stub + test file + reference (seed-derived) ───────────────
/** Build the stub (all signatures raising NotImplementedError), the pytest file (the ENTIRE contract:
 *  the shared-convention preamble + one spec line + several cases per function), and the correct reference
 *  (shared helpers + every public function — calibration only). */
function build(seed: number): {
  stub: string
  test: string
  total: number
  reference: string
  names: string[]
} {
  const c = conventions(seed)
  const arts = builders.map((b) => b(seed, c))
  const testLines: string[] = [
    '# This file is the ENTIRE contract for lib.py. Implement every function in lib.py so all tests pass.',
    '#',
    '# SHARED CONVENTIONS (fixed for this task, the SAME across every function that uses them; infer each',
    '# value from the cases — they are NOT written out): field SEPARATOR, NEGATIVE-number format, range',
    '# BOUNDARY (inclusive/exclusive), rounding TIE direction, INDEX base (0- or 1-based), letter CASE,',
    '# sort ORDER, number PAD width, and BOOLEAN rendering. Get a convention wrong and EVERY function in',
    '# that family fails together; get it right and they pass together. About ten functions use TWO',
    '# conventions, so fixing one facet can break another.',
    '',
    `from lib import ${arts.map((a) => a.name).join(', ')}`,
    '',
  ]
  for (const a of arts) {
    testLines.push(a.doc, ...a.tests, '')
  }
  const stubLines: string[] = [
    '# Implement every function so test_lib.py passes. The exact contract — every shared convention value',
    '# and every per-function constant — lives ONLY in test_lib.py and must be inferred from the cases.',
    '# Use run_tests to see which tests fail, fix exactly those, and iterate until all pass.',
    '',
  ]
  for (const a of arts) {
    stubLines.push(`def ${a.sig}:`, '    raise NotImplementedError', '')
  }
  const refLines: string[] = [...pyHelpers(c)]
  for (const a of arts) {
    refLines.push(...a.refLines, '')
  }
  return {
    stub: stubLines.join('\n'),
    test: testLines.join('\n'),
    total: arts.reduce((s, a) => s + a.tests.length, 0),
    reference: refLines.join('\n'),
    names: arts.map((a) => a.name),
  }
}

// ── The Environment (AgenticSurface) — host pytest, no Docker. ─────────────────────
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
      ['-m', 'pytest', '-q', '--tb=no', '--color=no', '-p', 'no:cacheprovider', 'test_lib.py'],
      { cwd: dir, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  }
  const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
  const failed =
    Number(out.match(/(\d+) failed/)?.[1] ?? 0) + Number(out.match(/(\d+) error/)?.[1] ?? 0)
  return { passed, total: passed + failed }
}

/** A worker-facing report: the pass count + the NAMES of the failing tests, so the agent (and a fresh
 *  respawn) can target exactly what is broken instead of re-deriving everything. The failing list is the
 *  point: each re-read grows a continuous worker's context, while a fresh respawn reads it once against a
 *  clean context. A bare import/syntax failure (which zeroes every test) is reported distinctly so one bad
 *  write does not blind the worker. */
function runTestsReport(dir: string): string {
  let out = ''
  try {
    out = execFileSync(
      'python3',
      [
        '-m',
        'pytest',
        '-q',
        '--tb=no',
        '--color=no',
        '-rfE',
        '-p',
        'no:cacheprovider',
        'test_lib.py',
      ],
      { cwd: dir, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  }
  const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
  const failed =
    Number(out.match(/(\d+) failed/)?.[1] ?? 0) + Number(out.match(/(\d+) error/)?.[1] ?? 0)
  const failing = [...out.matchAll(/(?:FAILED|ERROR) \S*::(\S+)/g)].map((m) => m[1])
  if (passed === 0 && failing.length === 0)
    return 'COLLECTION/SYNTAX ERROR: lib.py did not import cleanly (a syntax error or a missing function). Make sure every function is defined and lib.py imports, then run_tests again.'
  const head = `${passed}/${passed + failed} tests passed.`
  if (!failing.length) return head
  const shown = failing.slice(0, 80)
  const more = failing.length > shown.length ? ` (+${failing.length - shown.length} more)` : ''
  return `${head} FAILING: ${shown.join(', ')}${more}`
}

export const longCodingEnv: AgenticSurface = {
  name: 'long-generated-coding-lite',
  async open(task) {
    const seed = Number((task.meta as { seed?: number })?.seed ?? 0)
    const { stub, test, total } = build(seed)
    const dir = mkdtempSync(join(tmpdir(), 'lcl-'))
    writeFileSync(join(dir, 'lib.py'), stub)
    writeFileSync(join(dir, 'test_lib.py'), test)
    const handle: ArtifactHandle = { id: dir, surface: 'long-generated-coding-lite' }
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
          description:
            "Read a file (e.g. test_lib.py to learn every function's contract and the shared conventions, or lib.py).",
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
            'Write the COMPLETE contents of lib.py (the implementation). test_lib.py is read-only.',
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
            'Run the test suite; returns how many passed and the NAMES of the failing tests. Use it to see what is still broken and fix exactly those, then run again.',
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
      if (p !== 'lib.py' && p !== 'test_lib.py')
        return 'ERROR: only lib.py and test_lib.py are readable'
      try {
        return readFileSync(join(ws.dir, p), 'utf8').slice(0, 200000)
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
    if (name === 'run_tests') return runTestsReport(ws.dir)
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

// ── The disjoint task supplier (train [offset, offset+n); holdout drawn past it) ──
export const longCodingTasks = async (offset: number, n: number): Promise<AgenticTask[]> =>
  Array.from({ length: n }, (_, i) => {
    const seed = offset + i
    return {
      id: `lcl-${seed}`,
      userPrompt:
        'You are a Python engineer. lib.py has ~28 small stub functions (string, integer/math, parser, ' +
        'formatter, and validator helpers). Several SHARED conventions — the field separator, the format ' +
        'for negative numbers, whether ranges are inclusive or exclusive, the rounding tie direction, the ' +
        'index base (0- or 1-based), the letter case, the sort order, the zero-pad width for rendered ' +
        'numbers, and how booleans are rendered — are FIXED for this task and reused across whole families ' +
        'of functions; each value is defined ONLY by test_lib.py and varies per task, so you must INFER it ' +
        'from the cases. Get a convention right and a whole family passes at once; get it wrong and that ' +
        'family fails together, and note that about ten functions use TWO conventions, so a fix for one ' +
        'facet can break another. WORKFLOW: read test_lib.py, implement lib.py, then call run_tests to see ' +
        'how many passed and which tests FAIL, and fix exactly those — iterate until every test passes. ' +
        'Watch the edge cases (empty inputs, zero, boundaries, rounding ties, negative numbers, the first ' +
        'index, multi-digit padding). Do not edit test_lib.py.',
      meta: { seed },
    } satisfies AgenticTask
  })

/** The correct lib.py for a seed — used ONLY by the $0 calibration self-check (never by the agent).
 *  Shared helpers + the 28 public functions, so the task is PROVABLY solvable. */
function referenceLib(seed: number): string {
  return build(seed).reference
}

// ── calibrate-before-measure ($0, no router): reference -> all pass, stub -> 0 ────
/** Prove the task is SOLVABLE (reference -> all pass), the grader DISCRIMINATES (stub -> 0), the suite is
 *  LONG ENOUGH (>=150 tests/seed), and every public function is defined. No LLM. A reference that doesn't
 *  clear means the task/grader is broken — fix it before spending. Also prints the seed's convention draw
 *  (so the intended oscillation is visible) and the fraction of seeds that force a non-default inference. */
async function calibrate(): Promise<void> {
  console.log(
    '═══ CALIBRATION ($0) — solvable + discriminating + long-enough + every-fn-defined? ═══',
  )
  let ok = true
  for (const seed of [0, 1, 2, 3, 5]) {
    const task = (await longCodingTasks(seed, 1))[0]!
    const h = await longCodingEnv.open(task)
    const stub = await longCodingEnv.score(task, h)
    await longCodingEnv.call(h, 'write_file', { path: 'lib.py', content: referenceLib(seed) })
    const ref = await longCodingEnv.score(task, h)
    await longCodingEnv.close(h)
    const c = conventions(seed)
    const { names } = build(seed)
    const refSrc = referenceLib(seed)
    const defined = names.every((nm) => new RegExp(`^def ${nm}\\(`, 'm').test(refSrc))
    const pass =
      ref.passes === ref.total &&
      ref.total >= 150 &&
      stub.passes === 0 &&
      names.length === builders.length &&
      defined
    ok &&= pass
    const conv =
      `sep='${c.sep}' neg=${c.neg} bound=${c.inclusive ? 'incl' : 'excl'} ` +
      `tie=${c.tieUp ? 'up' : 'down'} idx=${c.oneBased ? '1' : '0'} ` +
      `case=${c.upper ? 'UP' : 'low'} order=${c.asc ? 'asc' : 'desc'} ` +
      `pad=${c.pad} bool=${c.boolStyle}`
    console.log(
      `  seed ${seed}: stub ${stub.passes}/${stub.total}  →  reference ${ref.passes}/${ref.total}  ` +
        `(${ref.total} tests, ${names.length} fns)  ${pass ? '✓' : '✗ BROKEN'}\n` +
        `           conventions: ${conv}`,
    )
  }
  // Non-default-forcing rate over a wide seed sweep ($0): what fraction force >=1 non-default inference.
  let allDefault = 0
  const sweep = 5000
  for (let s = 0; s < sweep; s++) if (isAllDefault(conventions(s))) allDefault++
  const nonDefaultPct = (100 * (sweep - allDefault)) / sweep
  console.log(
    `  non-default-forcing rate: ${nonDefaultPct.toFixed(2)}% of ${sweep} seeds force >=1 non-default convention (only ${allDefault} all-default).`,
  )
  ok &&= nonDefaultPct >= 98
  console.log(
    ok
      ? `\n>>> CALIBRATED — reference 100%, stub 0%, 150+ tests across ${builders.length} functions over 9 shared, seed-derived conventions (>=98% force a non-default inference). Long-enough + solvable + discriminating; difficulty comes from ADVERSARIAL cases + cross-convention coupling, not file size. Regime: oscillation bottlenecked, fresh-respawn-favoring.`
      : '\n>>> BROKEN — fix the task/grader before spending.',
  )
  if (!ok) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`)
  calibrate().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
    process.exit(1)
  })
