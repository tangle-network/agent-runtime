/**
 * long-coding-env — a LONG, contamination-proof generated coding task built to stress the CONTEXT-
 * LIFECYCLE hypothesis (Ralph-style respawn beats a single continuous worker on long tasks). It mirrors
 * hard-coding-env's surface EXACTLY (an `AgenticSurface` open/tools[list_files,read_file,write_file,
 * run_tests]/call/score/close + an exported `longCodingTasks(offset,n)` supplier, seed-derived +
 * host-pytest-graded) but the TASK is shaped to force LENGTH and OSCILLATION, not algorithmic difficulty.
 *
 * THE REGIME THIS TASK PROBES (oscillation / context-overflow bottlenecked, fresh-respawn-favoring):
 *   - ~54 small functions in one lib.py, ~162 host-pytest cases, all individually trivial (string,
 *     integer/math, parser, formatter, validator helpers — no advanced algorithm anywhere).
 *   - ~9 SHARED, seed-derived CONVENTIONS (field SEPARATOR, NEGATIVE-number format, range BOUNDARY
 *     inclusive/exclusive, rounding TIE direction, INDEX base 0/1, letter CASE, sort ORDER, PAD
 *     width/char, YES/NO words). Each convention is consumed by a whole FAMILY of functions, so its
 *     value has high blast radius: get it right and ~6–10 functions pass together; get it wrong (or
 *     regress it in a later whole-file rewrite) and that whole family fails at once. ~7 functions
 *     consume TWO conventions, so an edit that fixes one facet can break the other.
 *   - The conventions' obvious DEFAULTS (minus signs, inclusive ranges, half-up, 0-based, ascending)
 *     are seed-randomized, so a first pass that guesses defaults mis-implements a chunk of the suite —
 *     never one-pass-solvable. run_tests dumps the FULL failing list (up to ~60 names) so every re-read
 *     grows the conversation fast, and write_file requires the COMPLETE lib.py so each fix is a full
 *     rewrite from whatever the worker is currently holding in context.
 *
 * Why a CONTINUOUS worker is expected to degrade while a FRESH RESPAWN stays sharp: both see the same
 * information (the full test file pins every convention from the cases). A continuous worker accumulates
 * the whole test file + many full lib.py rewrites + many long failure dumps; as that context bloats past
 * ~12 rounds its whole-file rewrites increasingly REGRESS earlier-correct families (high blast radius),
 * so its pass-rate oscillates and plateaus. A fresh respawn that re-reads ONLY the current lib.py + the
 * current failing tests makes targeted fixes with no regression. The bottleneck is LENGTH/OSCILLATION,
 * not capability: each function is individually solvable by a fresh worker reading its own failing cases.
 *
 * Why contamination-proof: every convention value and every local constant (factors, bounds, steps,
 * separators, prefixes) is DERIVED FROM THE SEED and pinned ONLY by the test file's cases — the OPERATION
 * is named, the per-seed values must be inferred, so no model can have memorized the answer. Graded by
 * REAL pytest (a deployable check, never an LLM judge). All expected values are integers/strings/lists/
 * bools (no float equality), each computed by a TS reference that mirrors the Python reference, so every
 * assertion is provably correct for the seed.
 *
 * Calibrated at $0 (no LLM): write the reference -> assert 100% pass; the stub -> assert 0% pass; confirm
 * ~150+ tests/seed across ~54 functions. Run the self-check with:
 *   pnpm tsx examples/ablation-suite/long-coding-env.ts
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

/** Python-style modulo (always non-negative for positive divisor), so TS expected values match Python. */
const pymod = (a: number, b: number): number => ((a % b) + b) % b

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
interface Conv {
  sep: string // field separator, shared by the split/join family
  neg: Neg // negative-number rendering, shared by the formatter family
  inclusive: boolean // range/clamp/threshold upper bound inclusive?
  tieUp: boolean // rounding ties go up (else down)?
  oneBased: boolean // positional index base (1-based else 0-based)
  upper: boolean // letter case (upper else lower) for the text family
  asc: boolean // sort order ascending (else descending)
  pad: number // fixed pad width
  padChar: string // fixed pad character
  yes: string // YES word for the predicate-format family
  no: string // NO word
}

/** Every value here is seed-derived and pinned ONLY by the test cases — never written out. The "obvious"
 *  default of each (minus/inclusive/half-up/0-based/ascending) is randomized away so a default-guessing
 *  first pass mis-implements a chunk of the suite. */
function conventions(seed: number): Conv {
  return {
    sep: [',', ';', '|', ':', '/'][pick(seed, 101, 5)]!,
    neg: (['minus', 'paren', 'trail', 'tilde'] as const)[pick(seed, 103, 4)]!,
    inclusive: pick(seed, 104, 2) === 0,
    tieUp: pick(seed, 105, 2) === 0,
    oneBased: pick(seed, 106, 2) === 0,
    upper: pick(seed, 107, 2) === 0,
    asc: pick(seed, 108, 2) === 0,
    pad: pick(seed, 109, 3) + 3, // 3..5
    padChar: ['0', ' ', '.', '*'][pick(seed, 110, 4)]!,
    yes: ['Y', 'yes', 'T', 'ok'][pick(seed, 111, 4)]!,
    no: ['N', 'no', 'F', 'no!'][pick(seed, 112, 4)]!,
  }
}

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
const tsPad = (c: Conv, s: string): string =>
  s.length >= c.pad ? s : c.padChar.repeat(c.pad - s.length) + s
const tsYN = (c: Conv, b: boolean): string => (b ? c.yes : c.no)
const tsCase = (c: Conv, s: string): string => (c.upper ? s.toUpperCase() : s.toLowerCase())
const tsBase = (c: Conv): number => (c.oneBased ? 1 : 0)
const tsOrder = (c: Conv, xs: number[]): number[] => [...xs].sort((a, b) => (c.asc ? a - b : b - a))

/** The shared Python helpers prepended to the reference lib.py (calibration only). A real worker would
 *  write something like these once and reuse them — which is exactly why a wrong value has wide blast
 *  radius. The STUB does not include them; the grader only ever calls the public functions. */
const pyHelpers = (c: Conv): string[] => {
  const negLine =
    c.neg === 'paren'
      ? '    return "(" + str(-n) + ")"'
      : c.neg === 'trail'
        ? '    return str(-n) + "-"'
        : c.neg === 'tilde'
          ? '    return "~" + str(-n)'
          : '    return str(n)'
  return [
    '# Shared helpers — the conventions every family reuses (values fixed per task).',
    'def _signed(n):',
    '    if n >= 0:',
    '        return str(n)',
    negLine,
    '',
    'def _round(x, step):',
    c.tieUp
      ? '    return (x + step // 2) // step * step'
      : '    return (x + (step - 1) // 2) // step * step',
    '',
    'def _pad(s):',
    `    return s.rjust(${c.pad}, ${JSON.stringify(c.padChar)})`,
    '',
    'def _yn(b):',
    `    return ${JSON.stringify(c.yes)} if b else ${JSON.stringify(c.no)}`,
    '',
    'def _case(s):',
    c.upper ? '    return s.upper()' : '    return s.lower()',
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

// ── The ~54 function builders, grouped by the shared convention each family exercises ──
const builders: Array<(seed: number, c: Conv) => FnArtifacts> = [
  // ════ FAMILY A — field SEPARATOR ════
  // A1. csv_sum
  (_seed, c) => {
    const f = (s: string): number =>
      s === '' ? 0 : s.split(c.sep).reduce((a, x) => a + Number(x), 0)
    const cases: Array<[string]> = [[`4${c.sep}9${c.sep}2`], [''], [`20${c.sep}5`]]
    return {
      name: 'csv_sum',
      sig: 'csv_sum(s)',
      doc: '# csv_sum(s): split on the shared SEP and sum the integer fields. "" -> 0. Negatives allowed.',
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
    const cases: Array<[number[]]> = [[[3, 1, 2]], [[7]], [[]]]
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
  // A3. field_count
  (_seed, c) => {
    const f = (s: string): number => (s === '' ? 0 : s.split(c.sep).length)
    const cases: Array<[string]> = [[`a${c.sep}b${c.sep}c`], [''], ['solo']]
    return {
      name: 'field_count',
      sig: 'field_count(s)',
      doc: '# field_count(s): number of fields after splitting on the shared SEP. "" -> 0; no SEP -> 1.',
      refLines: [
        'def field_count(s):',
        '    if not s:',
        '        return 0',
        `    return len(s.split(${JSON.stringify(c.sep)}))`,
      ],
      tests: cases.map(([s], i) => tline('field_count', i, [s], f(s))),
    }
  },
  // A4. last_field
  (_seed, c) => {
    const f = (s: string): string => {
      const i = s.lastIndexOf(c.sep)
      return i < 0 ? s : s.slice(i + c.sep.length)
    }
    const cases: Array<[string]> = [[`a${c.sep}b${c.sep}c`], ['nosep'], [`x${c.sep}y`]]
    return {
      name: 'last_field',
      sig: 'last_field(s)',
      doc: '# last_field(s): the substring after the LAST shared SEP, or the whole string if there is none.',
      refLines: ['def last_field(s):', `    return s.split(${JSON.stringify(c.sep)})[-1]`],
      tests: cases.map(([s], i) => tline('last_field', i, [s], f(s))),
    }
  },
  // A5. swap_pair
  (_seed, c) => {
    const f = (s: string): string => {
      const [a, b] = s.split(c.sep)
      return `${b}${c.sep}${a}`
    }
    const cases: Array<[string]> = [[`left${c.sep}right`], [`1${c.sep}2`], [`x${c.sep}`]]
    return {
      name: 'swap_pair',
      sig: 'swap_pair(s)',
      doc: '# swap_pair(s): "a<SEP>b" (exactly one shared SEP) -> "b<SEP>a".',
      refLines: [
        'def swap_pair(s):',
        `    a, b = s.split(${JSON.stringify(c.sep)})`,
        `    return b + ${JSON.stringify(c.sep)} + a`,
      ],
      tests: cases.map(([s], i) => tline('swap_pair', i, [s], f(s))),
    }
  },
  // A6. nth_field — DUAL: SEP + INDEX base.
  (_seed, c) => {
    const base = tsBase(c)
    const f = (s: string, k: number): string => s.split(c.sep)[k - base]!
    const cases: Array<[string, number]> = [
      [`a${c.sep}b${c.sep}c`, base],
      [`a${c.sep}b${c.sep}c`, base + 2],
      [`p${c.sep}q`, base + 1],
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
  // A7. split_take
  (_seed, c) => {
    const f = (s: string): string => s.split(c.sep)[0]!
    const cases: Array<[string]> = [[`alpha${c.sep}beta`], ['solo'], [`${c.sep}x`]]
    return {
      name: 'split_take',
      sig: 'split_take(s)',
      doc: '# split_take(s): the FIRST field after splitting on the shared SEP (a leading SEP yields "").',
      refLines: ['def split_take(s):', `    return s.split(${JSON.stringify(c.sep)})[0]`],
      tests: cases.map(([s], i) => tline('split_take', i, [s], f(s))),
    }
  },
  // A8. reverse_fields
  (_seed, c) => {
    const f = (s: string): string => s.split(c.sep).reverse().join(c.sep)
    const cases: Array<[string]> = [[`a${c.sep}b${c.sep}c`], [`x${c.sep}y`], ['solo']]
    return {
      name: 'reverse_fields',
      sig: 'reverse_fields(s)',
      doc: '# reverse_fields(s): split on the shared SEP, reverse the field order, and re-join with the shared SEP.',
      refLines: [
        'def reverse_fields(s):',
        `    return ${JSON.stringify(c.sep)}.join(reversed(s.split(${JSON.stringify(c.sep)})))`,
      ],
      tests: cases.map(([s], i) => tline('reverse_fields', i, [s], f(s))),
    }
  },

  // ════ FAMILY B — NEGATIVE-number format ════
  // B1. fmt_signed
  (_seed, c) => {
    const f = (n: number): string => tsSigned(c, n)
    const cases: Array<[number]> = [[-5], [7], [0]]
    return {
      name: 'fmt_signed',
      sig: 'fmt_signed(n)',
      doc: '# fmt_signed(n): render n as a string using the shared NEGATIVE format (non-negatives are plain).',
      refLines: ['def fmt_signed(n):', '    return _signed(n)'],
      tests: cases.map(([n], i) => tline('fmt_signed', i, [n], f(n))),
    }
  },
  // B2. fmt_delta
  (_seed, c) => {
    const f = (a: number, b: number): string => tsSigned(c, a - b)
    const cases: Array<[number, number]> = [
      [3, 8],
      [10, 10],
      [9, 2],
    ]
    return {
      name: 'fmt_delta',
      sig: 'fmt_delta(a, b)',
      doc: '# fmt_delta(a, b): render (a - b) using the shared NEGATIVE format.',
      refLines: ['def fmt_delta(a, b):', '    return _signed(a - b)'],
      tests: cases.map(([a, b], i) => tline('fmt_delta', i, [a, b], f(a, b))),
    }
  },
  // B3. with_sign_list
  (_seed, c) => {
    const f = (xs: number[]): string[] => xs.map((x) => tsSigned(c, x))
    const cases: Array<[number[]]> = [[[-1, 2, -3]], [[0]], [[-10]]]
    return {
      name: 'with_sign_list',
      sig: 'with_sign_list(xs)',
      doc: '# with_sign_list(xs): render each integer with the shared NEGATIVE format; return the list of strings.',
      refLines: ['def with_sign_list(xs):', '    return [_signed(x) for x in xs]'],
      tests: cases.map(([xs], i) => tline('with_sign_list', i, [xs], f(xs))),
    }
  },
  // B4. fmt_temp
  (seed, c) => {
    const unit = ['C', 'F', 'K', 'D'][pick(seed, 2400, 4)]!
    const f = (n: number): string => tsSigned(c, n) + unit
    const cases: Array<[number]> = [[-4], [12], [0]]
    return {
      name: 'fmt_temp',
      sig: 'fmt_temp(n)',
      doc: '# fmt_temp(n): the shared NEGATIVE format of n followed by a fixed unit letter.',
      refLines: ['def fmt_temp(n):', `    return _signed(n) + ${JSON.stringify(unit)}`],
      tests: cases.map(([n], i) => tline('fmt_temp', i, [n], f(n))),
    }
  },
  // B5. fmt_paren_sum
  (_seed, c) => {
    const f = (xs: number[]): string =>
      tsSigned(
        c,
        xs.reduce((a, x) => a + x, 0),
      )
    const cases: Array<[number[]]> = [[[2, -9, 1]], [[5, 5]], [[-3, -2]]]
    return {
      name: 'fmt_paren_sum',
      sig: 'fmt_paren_sum(xs)',
      doc: '# fmt_paren_sum(xs): render the SUM of the list with the shared NEGATIVE format.',
      refLines: ['def fmt_paren_sum(xs):', '    return _signed(sum(xs))'],
      tests: cases.map(([xs], i) => tline('fmt_paren_sum', i, [xs], f(xs))),
    }
  },
  // B6. fmt_signed_pad — DUAL: NEGATIVE format + PAD.
  (_seed, c) => {
    const f = (n: number): string => tsPad(c, tsSigned(c, n))
    const cases: Array<[number]> = [[-5], [3], [42]]
    return {
      name: 'fmt_signed_pad',
      sig: 'fmt_signed_pad(n)',
      doc: '# fmt_signed_pad(n): render n with the shared NEGATIVE format, then left-pad to the shared PAD width/char.',
      refLines: ['def fmt_signed_pad(n):', '    return _pad(_signed(n))'],
      tests: cases.map(([n], i) => tline('fmt_signed_pad', i, [n], f(n))),
    }
  },
  // B7. balance_after
  (_seed, c) => {
    const f = (start: number, xs: number[]): string =>
      tsSigned(c, start + xs.reduce((a, x) => a + x, 0))
    const cases: Array<[number, number[]]> = [
      [10, [-3, -12]],
      [5, [-5]],
      [0, [7]],
    ]
    return {
      name: 'balance_after',
      sig: 'balance_after(start, xs)',
      doc: '# balance_after(start, xs): render (start + sum(xs)) with the shared NEGATIVE format.',
      refLines: ['def balance_after(start, xs):', '    return _signed(start + sum(xs))'],
      tests: cases.map(([s, xs], i) => tline('balance_after', i, [s, xs], f(s, xs))),
    }
  },

  // ════ FAMILY C — range BOUNDARY (inclusive/exclusive) ════
  // C1. in_band
  (seed, c) => {
    const lo = pick(seed, 3100, 10) - 5
    const hi = lo + pick(seed, 3101, 10) + 6
    const f = (x: number): boolean => (c.inclusive ? x >= lo && x <= hi : x >= lo && x < hi)
    const cases: Array<[number]> = [[hi], [lo], [hi + 1]]
    return {
      name: 'in_band',
      sig: 'in_band(x)',
      doc: '# in_band(x): True iff x is in a fixed band [LO, HI]; the upper bound follows the shared BOUNDARY rule (inclusive or exclusive).',
      refLines: [
        'def in_band(x):',
        c.inclusive ? `    return ${lo} <= x <= ${hi}` : `    return ${lo} <= x < ${hi}`,
      ],
      tests: cases.map(([x], i) => tline('in_band', i, [x], f(x))),
    }
  },
  // C2. clamp
  (seed, c) => {
    const lo = pick(seed, 3200, 10) - 5
    const hi = lo + pick(seed, 3201, 10) + 6
    const top = c.inclusive ? hi : hi - 1
    const f = (x: number): number => (x < lo ? lo : x > top ? top : x)
    const cases: Array<[number]> = [[lo - 3], [hi + 5], [lo + 1]]
    return {
      name: 'clamp',
      sig: 'clamp(x)',
      doc: '# clamp(x): clamp x into [LO, HI]; whether HI itself is reachable follows the shared BOUNDARY rule.',
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
  // C3. range_size
  (_seed, c) => {
    const f = (a: number, b: number): number =>
      c.inclusive ? Math.max(0, b - a + 1) : Math.max(0, b - a)
    const cases: Array<[number, number]> = [
      [3, 7],
      [5, 5],
      [8, 5],
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
  // C4. list_range
  (_seed, c) => {
    const f = (a: number, b: number): number[] => {
      const r: number[] = []
      const end = c.inclusive ? b : b - 1
      for (let v = a; v <= end; v++) r.push(v)
      return r
    }
    const cases: Array<[number, number]> = [
      [2, 5],
      [4, 4],
      [7, 4],
    ]
    return {
      name: 'list_range',
      sig: 'list_range(a, b)',
      doc: '# list_range(a, b): the list of integers from a up to b; whether b is included follows the shared BOUNDARY rule.',
      refLines: [
        'def list_range(a, b):',
        c.inclusive ? '    return list(range(a, b + 1))' : '    return list(range(a, b))',
      ],
      tests: cases.map(([a, b], i) => tline('list_range', i, [a, b], f(a, b))),
    }
  },
  // C5. fits — DUAL: BOUNDARY + YES/NO.
  (seed, c) => {
    const lo = pick(seed, 3500, 8)
    const hi = lo + pick(seed, 3501, 8) + 5
    const f = (x: number): string => tsYN(c, c.inclusive ? x >= lo && x <= hi : x >= lo && x < hi)
    const cases: Array<[number]> = [[hi], [lo], [hi + 2]]
    return {
      name: 'fits',
      sig: 'fits(x)',
      doc: '# fits(x): the shared YES/NO word for whether x is in [LO, HI] under the shared BOUNDARY rule.',
      refLines: [
        'def fits(x):',
        c.inclusive ? `    return _yn(${lo} <= x <= ${hi})` : `    return _yn(${lo} <= x < ${hi})`,
      ],
      tests: cases.map(([x], i) => tline('fits', i, [x], f(x))),
    }
  },
  // C6. clip_high
  (seed, c) => {
    const cap = pick(seed, 3600, 40) + 20
    const top = c.inclusive ? cap : cap - 1
    const f = (x: number): number => (x > top ? top : x)
    const cases: Array<[number]> = [[cap + 5], [top - 1], [top]]
    return {
      name: 'clip_high',
      sig: 'clip_high(x)',
      doc: '# clip_high(x): cap x at a fixed maximum; whether the cap itself is the highest returnable value follows the shared BOUNDARY rule.',
      refLines: ['def clip_high(x):', `    top = ${top}`, '    return top if x > top else x'],
      tests: cases.map(([x], i) => tline('clip_high', i, [x], f(x))),
    }
  },
  // C7. in_either
  (seed, c) => {
    const lo1 = pick(seed, 3700, 6)
    const hi1 = lo1 + pick(seed, 3701, 5) + 3
    const lo2 = hi1 + pick(seed, 3702, 6) + 4
    const hi2 = lo2 + pick(seed, 3703, 5) + 3
    const inb = (x: number, lo: number, hi: number): boolean =>
      c.inclusive ? x >= lo && x <= hi : x >= lo && x < hi
    const f = (x: number): boolean => inb(x, lo1, hi1) || inb(x, lo2, hi2)
    const cases: Array<[number]> = [[hi1], [lo2], [hi2]]
    return {
      name: 'in_either',
      sig: 'in_either(x)',
      doc: '# in_either(x): True iff x lies in EITHER of two fixed bands; each upper bound follows the shared BOUNDARY rule.',
      refLines: [
        'def in_either(x):',
        c.inclusive
          ? `    return (${lo1} <= x <= ${hi1}) or (${lo2} <= x <= ${hi2})`
          : `    return (${lo1} <= x < ${hi1}) or (${lo2} <= x < ${hi2})`,
      ],
      tests: cases.map(([x], i) => tline('in_either', i, [x], f(x))),
    }
  },

  // ════ FAMILY D — rounding TIE direction ════
  // D1. round_to
  (seed, c) => {
    const step = pick(seed, 4100, 4) * 2 + 2 // 2,4,6,8
    const half = step / 2
    const f = (x: number): number => tsRound(c, x, step)
    const cases: Array<[number]> = [[half], [step + half], [step * 3]]
    return {
      name: 'round_to',
      sig: 'round_to(x)',
      doc: '# round_to(x): x>=0 rounded to the nearest multiple of a fixed STEP; exact halves follow the shared TIE direction.',
      refLines: ['def round_to(x):', `    return _round(x, ${step})`],
      tests: cases.map(([x], i) => tline('round_to', i, [x], f(x))),
    }
  },
  // D2. round_div
  (seed, c) => {
    const b = pick(seed, 4200, 3) * 2 + 2 // 2,4,6
    const half = b / 2
    const f = (a: number, d: number): number => {
      const q = Math.floor(a / d)
      const r = a - q * d
      return (c.tieUp ? 2 * r >= d : 2 * r > d) ? q + 1 : q
    }
    const cases: Array<[number, number]> = [
      [half, b],
      [b + half, b],
      [b * 3, b],
    ]
    return {
      name: 'round_div',
      sig: 'round_div(a, b)',
      doc: '# round_div(a, b): a,b>=0 -> a/b rounded to the nearest integer; exact halves follow the shared TIE direction.',
      refLines: [
        'def round_div(a, b):',
        '    q, r = divmod(a, b)',
        c.tieUp ? '    if 2 * r >= b:' : '    if 2 * r > b:',
        '        q += 1',
        '    return q',
      ],
      tests: cases.map(([a, d], i) => tline('round_div', i, [a, d], f(a, d))),
    }
  },
  // D3. avg_round
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
  // D4. snap_step
  (seed, c) => {
    const step = pick(seed, 4400, 4) * 2 + 4 // 4,6,8,10
    const half = step / 2
    const f = (x: number): number => tsRound(c, x, step)
    const cases: Array<[number]> = [[half], [step * 2 + half], [step + 1]]
    return {
      name: 'snap_step',
      sig: 'snap_step(x)',
      doc: '# snap_step(x): x>=0 snapped to the nearest multiple of a (larger) fixed STEP; exact halves follow the shared TIE direction.',
      refLines: ['def snap_step(x):', `    return _round(x, ${step})`],
      tests: cases.map(([x], i) => tline('snap_step', i, [x], f(x))),
    }
  },
  // D5. half_bucket
  (seed, c) => {
    const step = pick(seed, 4500, 3) * 2 + 2 // 2,4,6
    const half = step / 2
    const f = (x: number): number => tsRound(c, x, step) / step
    const cases: Array<[number]> = [[half], [step + half], [step * 4]]
    return {
      name: 'half_bucket',
      sig: 'half_bucket(x)',
      doc: '# half_bucket(x): x>=0 rounded to the nearest multiple of a fixed STEP (ties follow the shared TIE direction), divided by STEP to give the bucket index.',
      refLines: ['def half_bucket(x):', `    return _round(x, ${step}) // ${step}`],
      tests: cases.map(([x], i) => tline('half_bucket', i, [x], f(x))),
    }
  },
  // D6. round_list
  (seed, c) => {
    const step = pick(seed, 4600, 3) * 2 + 2 // 2,4,6
    const half = step / 2
    const f = (xs: number[]): number[] => xs.map((x) => tsRound(c, x, step))
    const cases: Array<[number[]]> = [[[half, step * 2, step + half]], [[0]], [[step * 3]]]
    return {
      name: 'round_list',
      sig: 'round_list(xs)',
      doc: '# round_list(xs): round each value to the nearest multiple of a fixed STEP; exact halves follow the shared TIE direction.',
      refLines: ['def round_list(xs):', `    return [_round(x, ${step}) for x in xs]`],
      tests: cases.map(([xs], i) => tline('round_list', i, [xs], f(xs))),
    }
  },

  // ════ FAMILY E — INDEX base (0- or 1-based) ════
  // E1. char_at
  (_seed, c) => {
    const base = tsBase(c)
    const f = (s: string, k: number): string => s[k - base]!
    const cases: Array<[string, number]> = [
      ['abcdef', base],
      ['abcdef', base + 3],
      ['xyz', base + 2],
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
      ['the quick brown', base],
      ['the quick brown', base + 2],
      ['one two', base + 1],
    ]
    return {
      name: 'nth_word',
      sig: 'nth_word(s, k)',
      doc: '# nth_word(s, k): the k-th whitespace-separated word using the shared INDEX base.',
      refLines: ['def nth_word(s, k):', `    return s.split()[k - ${base}]`],
      tests: cases.map(([s, k], i) => tline('nth_word', i, [s, k], f(s, k))),
    }
  },
  // E4. line_at
  (_seed, c) => {
    const base = tsBase(c)
    const f = (s: string, k: number): string => s.split('\n')[k - base]!
    const cases: Array<[string, number]> = [
      ['a\nb\nc', base],
      ['a\nb\nc', base + 1],
      ['x\ny', base + 1],
    ]
    return {
      name: 'line_at',
      sig: 'line_at(s, k)',
      doc: '# line_at(s, k): the k-th newline-separated line using the shared INDEX base.',
      refLines: ['def line_at(s, k):', `    return s.split("\\n")[k - ${base}]`],
      tests: cases.map(([s, k], i) => tline('line_at', i, [s, k], f(s, k))),
    }
  },
  // E5. rank_of
  (_seed, c) => {
    const base = tsBase(c)
    const f = (xs: number[], v: number): number => xs.filter((x) => x < v).length + base
    const cases: Array<[number[], number]> = [
      [[10, 20, 30], 25],
      [[10, 20, 30], 5],
      [[5, 5, 9], 9],
    ]
    return {
      name: 'rank_of',
      sig: 'rank_of(xs, v)',
      doc: '# rank_of(xs, v): (count of elements strictly less than v) offset by the shared INDEX base.',
      refLines: ['def rank_of(xs, v):', `    return sum(1 for x in xs if x < v) + ${base}`],
      tests: cases.map(([xs, v], i) => tline('rank_of', i, [xs, v], f(xs, v))),
    }
  },
  // E6. last_n_index
  (_seed, c) => {
    const base = tsBase(c)
    const f = (s: string): number => s.length - 1 + base
    const cases: Array<[string]> = [['abc'], ['x'], ['hello']]
    return {
      name: 'last_n_index',
      sig: 'last_n_index(s)',
      doc: '# last_n_index(s): the position of the LAST character using the shared INDEX base.',
      refLines: ['def last_n_index(s):', `    return len(s) - 1 + ${base}`],
      tests: cases.map(([s], i) => tline('last_n_index', i, [s], f(s))),
    }
  },

  // ════ FAMILY F — letter CASE ════
  // F1. shout
  (_seed, c) => {
    const f = (s: string): string => tsCase(c, s)
    const cases: Array<[string]> = [['Hello'], ['abcXYZ'], ['MixEd']]
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
    const cases: Array<[string]> = [['hello world'], ['the Quick brown'], ['solo']]
    return {
      name: 'initials',
      sig: 'initials(s)',
      doc: '# initials(s): the first letter of each whitespace word, in the shared CASE, concatenated.',
      refLines: ['def initials(s):', '    return "".join(_case(w[0]) for w in s.split())'],
      tests: cases.map(([s], i) => tline('initials', i, [s], f(s))),
    }
  },
  // F3. abbrev
  (_seed, c) => {
    const f = (s: string, n: number): string => tsCase(c, s.slice(0, n))
    const cases: Array<[string, number]> = [
      ['parameter', 3],
      ['xy', 5],
      ['Hello', 4],
    ]
    return {
      name: 'abbrev',
      sig: 'abbrev(s, n)',
      doc: '# abbrev(s, n): the first n characters of s, in the shared CASE.',
      refLines: ['def abbrev(s, n):', '    return _case(s[:n])'],
      tests: cases.map(([s, n], i) => tline('abbrev', i, [s, n], f(s, n))),
    }
  },
  // F4. cap_first
  (_seed, c) => {
    const f = (s: string): string => (s ? tsCase(c, s[0]!) + s.slice(1) : '')
    const cases: Array<[string]> = [['hello'], ['World'], ['']]
    return {
      name: 'cap_first',
      sig: 'cap_first(s)',
      doc: '# cap_first(s): convert only the FIRST character to the shared CASE; leave the rest unchanged. "" -> "".',
      refLines: [
        'def cap_first(s):',
        '    if not s:',
        '        return ""',
        '    return _case(s[0]) + s[1:]',
      ],
      tests: cases.map(([s], i) => tline('cap_first', i, [s], f(s))),
    }
  },
  // F5. tag_case — DUAL: CASE + SEP.
  (_seed, c) => {
    const f = (s: string): string =>
      s
        .split(/\s+/)
        .filter((w) => w)
        .map((w) => tsCase(c, w))
        .join(c.sep)
    const cases: Array<[string]> = [['red green blue'], ['Solo'], ['a b']]
    return {
      name: 'tag_case',
      sig: 'tag_case(s)',
      doc: '# tag_case(s): each whitespace word in the shared CASE, joined by the shared SEP.',
      refLines: [
        'def tag_case(s):',
        `    return ${JSON.stringify(c.sep)}.join(_case(w) for w in s.split())`,
      ],
      tests: cases.map(([s], i) => tline('tag_case', i, [s], f(s))),
    }
  },
  // F6. norm_tag
  (_seed, c) => {
    const f = (s: string): string => tsCase(c, s.split(' ').join(''))
    const cases: Array<[string]> = [['a b c'], ['Hello World'], ['x']]
    return {
      name: 'norm_tag',
      sig: 'norm_tag(s)',
      doc: '# norm_tag(s): remove single spaces and convert the result to the shared CASE.',
      refLines: ['def norm_tag(s):', '    return _case(s.replace(" ", ""))'],
      tests: cases.map(([s], i) => tline('norm_tag', i, [s], f(s))),
    }
  },

  // ════ FAMILY G — sort ORDER (ascending/descending) ════
  // G1. sort_nums
  (_seed, c) => {
    const f = (xs: number[]): number[] => tsOrder(c, xs)
    const cases: Array<[number[]]> = [[[3, 1, 2]], [[5]], [[9, 4, 7, 1]]]
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
    const cases: Array<[number[]]> = [[[3, 1, 2]], [[5]], [[9, 4, 7]]]
    return {
      name: 'extreme',
      sig: 'extreme(xs)',
      doc: '# extreme(xs): the value that would come FIRST in the shared ORDER (the min if ascending, the max if descending).',
      refLines: ['def extreme(xs):', c.asc ? '    return min(xs)' : '    return max(xs)'],
      tests: cases.map(([xs], i) => tline('extreme', i, [xs], f(xs))),
    }
  },
  // G3. top_two
  (_seed, c) => {
    const f = (xs: number[]): number[] => tsOrder(c, xs).slice(0, 2)
    const cases: Array<[number[]]> = [[[3, 1, 2, 4]], [[8, 2]], [[5, 5, 1]]]
    return {
      name: 'top_two',
      sig: 'top_two(xs)',
      doc: '# top_two(xs): the first two elements in the shared ORDER.',
      refLines: ['def top_two(xs):', `    return sorted(xs${c.asc ? '' : ', reverse=True'})[:2]`],
      tests: cases.map(([xs], i) => tline('top_two', i, [xs], f(xs))),
    }
  },
  // G4. sorted_csv — DUAL: SEP + ORDER.
  (_seed, c) => {
    const f = (s: string): string => {
      const xs = s.split(c.sep).map(Number)
      return tsOrder(c, xs).join(c.sep)
    }
    const cases: Array<[string]> = [
      [`3${c.sep}1${c.sep}2`],
      [`9${c.sep}4`],
      [`5${c.sep}5${c.sep}1`],
    ]
    return {
      name: 'sorted_csv',
      sig: 'sorted_csv(s)',
      doc: '# sorted_csv(s): split on the shared SEP, sort the integers in the shared ORDER, and re-join with the shared SEP.',
      refLines: [
        'def sorted_csv(s):',
        `    xs = sorted((int(x) for x in s.split(${JSON.stringify(c.sep)}))${c.asc ? '' : ', reverse=True'})`,
        `    return ${JSON.stringify(c.sep)}.join(str(x) for x in xs)`,
      ],
      tests: cases.map(([s], i) => tline('sorted_csv', i, [s], f(s))),
    }
  },
  // G5. dedup_sorted
  (_seed, c) => {
    const f = (xs: number[]): number[] => tsOrder(c, [...new Set(xs)])
    const cases: Array<[number[]]> = [[[3, 1, 3, 2]], [[5, 5, 5]], [[9, 1, 4, 1]]]
    return {
      name: 'dedup_sorted',
      sig: 'dedup_sorted(xs)',
      doc: '# dedup_sorted(xs): the DISTINCT values sorted in the shared ORDER.',
      refLines: [
        'def dedup_sorted(xs):',
        `    return sorted(set(xs)${c.asc ? '' : ', reverse=True'})`,
      ],
      tests: cases.map(([xs], i) => tline('dedup_sorted', i, [xs], f(xs))),
    }
  },
  // G6. order_pair
  (_seed, c) => {
    const f = (a: number, b: number): number[] =>
      c.asc ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)]
    const cases: Array<[number, number]> = [
      [3, 8],
      [5, 5],
      [9, 2],
    ]
    return {
      name: 'order_pair',
      sig: 'order_pair(a, b)',
      doc: '# order_pair(a, b): the two values arranged in the shared ORDER as a 2-element list.',
      refLines: [
        'def order_pair(a, b):',
        c.asc ? '    return [min(a, b), max(a, b)]' : '    return [max(a, b), min(a, b)]',
      ],
      tests: cases.map(([a, b], i) => tline('order_pair', i, [a, b], f(a, b))),
    }
  },

  // ════ FAMILY H — fixed-width PAD ════
  // H1. pad_num
  (_seed, c) => {
    const f = (n: number): string => tsPad(c, String(n))
    const cases: Array<[number]> = [[7], [42], [123456]]
    return {
      name: 'pad_num',
      sig: 'pad_num(n)',
      doc: '# pad_num(n): n as a string, left-padded to the shared PAD width with the shared PAD char; longer strings are unchanged.',
      refLines: ['def pad_num(n):', '    return _pad(str(n))'],
      tests: cases.map(([n], i) => tline('pad_num', i, [n], f(n))),
    }
  },
  // H2. fmt_code — DUAL: PAD + a fixed prefix.
  (seed, c) => {
    const prefix = ['ID', 'SKU', '#', 'K-'][pick(seed, 8200, 4)]!
    const f = (n: number): string => prefix + tsPad(c, String(n))
    const cases: Array<[number]> = [[7], [1234], [99999]]
    return {
      name: 'fmt_code',
      sig: 'fmt_code(n)',
      doc: '# fmt_code(n): a fixed prefix followed by n left-padded to the shared PAD width/char.',
      refLines: ['def fmt_code(n):', `    return ${JSON.stringify(prefix)} + _pad(str(n))`],
      tests: cases.map(([n], i) => tline('fmt_code', i, [n], f(n))),
    }
  },
  // H3. pad_word
  (_seed, c) => {
    const f = (s: string): string => tsPad(c, s)
    const cases: Array<[string]> = [['hi'], ['x'], ['longerword']]
    return {
      name: 'pad_word',
      sig: 'pad_word(s)',
      doc: '# pad_word(s): left-pad s to the shared PAD width with the shared PAD char; longer strings are unchanged.',
      refLines: ['def pad_word(s):', '    return _pad(s)'],
      tests: cases.map(([s], i) => tline('pad_word', i, [s], f(s))),
    }
  },
  // H4. fmt_label
  (seed, c) => {
    const suffix = ['x', 'u', '%', '!'][pick(seed, 8400, 4)]!
    const f = (n: number): string => tsPad(c, String(n)) + suffix
    const cases: Array<[number]> = [[3], [44], [123456]]
    return {
      name: 'fmt_label',
      sig: 'fmt_label(n)',
      doc: '# fmt_label(n): n left-padded to the shared PAD width/char, then a fixed suffix appended.',
      refLines: ['def fmt_label(n):', `    return _pad(str(n)) + ${JSON.stringify(suffix)}`],
      tests: cases.map(([n], i) => tline('fmt_label', i, [n], f(n))),
    }
  },

  // ════ FAMILY I — YES/NO words ════
  // I1. is_even_yn
  (_seed, c) => {
    const f = (n: number): string => tsYN(c, pymod(n, 2) === 0)
    const cases: Array<[number]> = [[4], [7], [0]]
    return {
      name: 'is_even_yn',
      sig: 'is_even_yn(n)',
      doc: '# is_even_yn(n): the shared YES word if n is even, else the shared NO word.',
      refLines: ['def is_even_yn(n):', '    return _yn(n % 2 == 0)'],
      tests: cases.map(([n], i) => tline('is_even_yn', i, [n], f(n))),
    }
  },
  // I2. positive_yn
  (_seed, c) => {
    const f = (n: number): string => tsYN(c, n > 0)
    const cases: Array<[number]> = [[5], [-3], [0]]
    return {
      name: 'positive_yn',
      sig: 'positive_yn(n)',
      doc: '# positive_yn(n): the shared YES word if n > 0, else the shared NO word.',
      refLines: ['def positive_yn(n):', '    return _yn(n > 0)'],
      tests: cases.map(([n], i) => tline('positive_yn', i, [n], f(n))),
    }
  },
  // I3. divides_yn
  (seed, c) => {
    const d = pick(seed, 9300, 7) + 2
    const f = (n: number): string => tsYN(c, pymod(n, d) === 0)
    const cases: Array<[number]> = [[d * 3], [d * 2 + 1], [0]]
    return {
      name: 'divides_yn',
      sig: 'divides_yn(n)',
      doc: '# divides_yn(n): the shared YES word if n is divisible by a fixed D, else the shared NO word.',
      refLines: ['def divides_yn(n):', `    return _yn(n % ${d} == 0)`],
      tests: cases.map(([n], i) => tline('divides_yn', i, [n], f(n))),
    }
  },
  // I4. longer_than_yn — DUAL: YES/NO + BOUNDARY.
  (seed, c) => {
    const L = pick(seed, 9400, 5) + 3
    const f = (s: string): string => tsYN(c, c.inclusive ? s.length >= L : s.length > L)
    const cases: Array<[string]> = [['x'.repeat(L)], ['x'.repeat(L + 2)], ['x'.repeat(L - 1)]]
    return {
      name: 'longer_than_yn',
      sig: 'longer_than_yn(s)',
      doc: '# longer_than_yn(s): the shared YES word if len(s) meets a fixed length L; whether L itself counts follows the shared BOUNDARY rule.',
      refLines: [
        'def longer_than_yn(s):',
        c.inclusive ? `    return _yn(len(s) >= ${L})` : `    return _yn(len(s) > ${L})`,
      ],
      tests: cases.map(([s], i) => tline('longer_than_yn', i, [s], f(s))),
    }
  },
]

// ── Assemble one task's stub + test file + reference (seed-derived) ───────────────
/** Build the stub (all signatures raising NotImplementedError), the pytest file (the ENTIRE contract:
 *  the shared-convention preamble + one spec line + a few cases per function), and the correct reference
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
    '# sort ORDER, PAD width/char, and the YES/NO words. Get a convention wrong and EVERY function in that',
    '# family fails together; get it right and they pass together. A few functions use TWO conventions.',
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
 *  respawn) can target exactly what is broken instead of re-deriving everything. The failing list is
 *  intentionally LONG (up to ~60 names) — that is the point: each re-read grows a continuous worker's
 *  context fast, while a fresh respawn reads it once against a clean context. A bare import/syntax
 *  failure (which zeroes every test) is reported distinctly so one bad write does not blind the worker. */
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
  const shown = failing.slice(0, 60)
  const more = failing.length > shown.length ? ` (+${failing.length - shown.length} more)` : ''
  return `${head} FAILING: ${shown.join(', ')}${more}`
}

export const longCodingEnv: AgenticSurface = {
  name: 'long-generated-coding',
  async open(task) {
    const seed = Number((task.meta as { seed?: number })?.seed ?? 0)
    const { stub, test, total } = build(seed)
    const dir = mkdtempSync(join(tmpdir(), 'lce-'))
    writeFileSync(join(dir, 'lib.py'), stub)
    writeFileSync(join(dir, 'test_lib.py'), test)
    const handle: ArtifactHandle = { id: dir, surface: 'long-generated-coding' }
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
      id: `lce-${seed}`,
      systemPrompt:
        'You are a Python engineer. lib.py has ~54 small stub functions (string, integer/math, parser, ' +
        'formatter, and validator helpers). Several SHARED conventions — the field separator, the format ' +
        'for negative numbers, whether ranges are inclusive or exclusive, the rounding tie direction, the ' +
        'index base (0- or 1-based), the letter case, the sort order, the pad width/char, and the yes/no ' +
        'words — are FIXED for this task and reused across whole families of functions; each value is ' +
        'defined ONLY by test_lib.py and varies per task, so you must INFER it from the cases. Get a ' +
        'convention right and a whole family passes at once; get it wrong and that family fails together. ' +
        'WORKFLOW: read test_lib.py, implement lib.py, then call run_tests to see how many passed and which ' +
        'tests FAIL, and fix exactly those — iterate until every test passes. Watch the edge cases (empty ' +
        'inputs, zero, boundaries, padding, rounding ties). Do not edit test_lib.py.',
      userPrompt:
        'Read test_lib.py, implement lib.py for every function (nailing each shared convention), then run_tests and fix the failing tests until all pass.',
      meta: { seed },
    } satisfies AgenticTask
  })

/** The correct lib.py for a seed — used ONLY by the $0 calibration self-check (never by the agent).
 *  Shared helpers + the ~54 public functions, so the task is PROVABLY solvable. */
function referenceLib(seed: number): string {
  return build(seed).reference
}

// ── calibrate-before-measure ($0, no router): reference -> all pass, stub -> 0 ────
/** Prove the task is SOLVABLE (reference -> all pass), the grader DISCRIMINATES (stub -> 0), the suite is
 *  LONG (>=150 tests/seed), and every public function is defined. No LLM. A reference that doesn't clear
 *  means the task/grader is broken — fix it before spending. Also prints the seed's convention draw so
 *  the intended oscillation (which families are on a non-default value) is visible. */
async function calibrate(): Promise<void> {
  console.log('═══ CALIBRATION ($0) — solvable + discriminating + long + every-fn-defined? ═══')
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
      `pad=${c.pad}'${c.padChar}' yn=${c.yes}/${c.no}`
    console.log(
      `  seed ${seed}: stub ${stub.passes}/${stub.total}  →  reference ${ref.passes}/${ref.total}  ` +
        `(${ref.total} tests, ${names.length} fns)  ${pass ? '✓' : '✗ BROKEN'}\n` +
        `           conventions: ${conv}`,
    )
  }
  console.log(
    ok
      ? `\n>>> CALIBRATED — reference 100%, stub 0%, 150+ tests across ${builders.length} functions over 9 shared, seed-derived conventions. Long + solvable + discriminating. Regime: oscillation / context-overflow bottlenecked, fresh-respawn-favoring.`
      : '\n>>> BROKEN — fix the task/grader before spending.',
  )
  if (!ok) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`)
  calibrate().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
    process.exit(1)
  })
