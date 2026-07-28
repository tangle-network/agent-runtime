/**
 * hard-coding-env — a MID-DIFFICULTY, contamination-proof generated coding task: the cheap iteration
 * substrate for optimizing the supervisor. Mirrors examples/self-improving-coder/self-improving-coder.ts
 * exactly in shape (an `AgenticSurface` open/tools/call/score/close + an exported `hardCodingTasks(offset,n)`
 * supplier, seed-derived + deterministic + graded by REAL host pytest) but the TASK has a genuinely hard
 * ALGORITHMIC CORE so a flash model lands in a CORRECTABLE MIDDLE BAND (~40-60% resolved), not 100%.
 *
 * The bundled task in self-improving-coder is SATURATED — a capable worker aces it (every strategy → 1.0),
 * so the held-out gate correctly returns no-promotion: you cannot show self-improvement where there is no
 * headroom. This task supplies the headroom: a small STACK-BASED ARITHMETIC EXPRESSION EVALUATOR with
 * operator precedence + parentheses + integer division + unary minus + structured error handling. The
 * shunting-yard / two-stack core is hard to get FULLY right in one blind pass — precedence, left-
 * associativity, unary vs binary minus, division-by-zero, and malformed-input rejection are each an
 * independent way to drop a test. ~6-8 functions, ~18 tests covering normal + edge cases (empty, nested,
 * malformed, boundary), so partial credit is fine-grained and the band is wide.
 *
 * Why contamination-proof: the tokenizer's number base, the division operator's exact glyph, and the
 * floor-vs-truncate rounding rule are DERIVED FROM THE SEED and specified ONLY by the test file. A frontier
 * model cannot have memorized the contract — the exact dialect is generated per task. Graded by REAL pytest
 * (a deployable check, never an LLM judge). Drop-in for self-improving-coder's `codingEnv`/`codingTasks`.
 *
 * Calibrated at $0 (no LLM): write the reference → assert 100% pass; the stub → assert 0% pass. Run the
 * self-check with:  CALIBRATE=1 pnpm tsx examples/ablation-suite/hard-coding-env.ts
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

// ── Seed-derived dialect (the contract no model can recall) ──────────────────────
/** The per-seed dialect of the calculator language. Every knob is read ONLY from the tests, so the agent
 *  must INFER it; none of it is guessable from the function names. */
interface Dialect {
  /** Numeric literal base: 10 (decimal) or 16 (0x-prefixed hex). Changes how the tokenizer reads numbers. */
  base: 10 | 16
  /** The integer-division operator glyph. One of these — never '/'. The test file pins which. */
  divOp: '//' | '\\' | '%/'
  /** Rounding rule for integer division of a negative result: 'floor' (Python //) or 'trunc' (toward zero). */
  rounding: 'floor' | 'trunc'
  /** The exact error string raised on any malformed / undefined-result input. */
  errStr: string
}

function dialectFor(seed: number): Dialect {
  // Per-field salt so each knob draws INDEPENDENTLY. Without it (a pure `seed % m`) every draw returns
  // the same value, aliasing base⟺rounding 100% — a spurious shortcut a model could learn, collapsing
  // the dialect's entropy. The salt makes the four knobs genuinely independent.
  const r = (m: number, salt: number) => (((seed + salt) * 2654435761 + 1013904223) >>> 0) % m
  return {
    base: r(2, 1) === 0 ? 10 : 16,
    divOp: (['//', '\\', '%/'] as const)[r(3, 2)]!,
    rounding: r(2, 3) === 0 ? 'floor' : 'trunc',
    errStr: `E${(r(9000, 4) + 1000).toString(36).toUpperCase()}`,
  }
}

/** A reference evaluator IN TYPESCRIPT, used to compute the EXPECTED values baked into the generated tests.
 *  This is the source of truth for what the Python implementation must reproduce; it never touches the
 *  agent. Mirrors the dialect exactly (base, division op semantics, rounding, error contract). */
function refEval(expr: string, d: Dialect): { ok: true; value: number } | { ok: false } {
  // Tokenize.
  type Tok = { k: 'num'; v: number } | { k: 'op'; v: string } | { k: 'lp' } | { k: 'rp' }
  const toks: Tok[] = []
  let i = 0
  const hexDigits = '0123456789abcdef'
  while (i < expr.length) {
    const c = expr[i]!
    if (c === ' ' || c === '\t') {
      i++
      continue
    }
    if (c === '(') {
      toks.push({ k: 'lp' })
      i++
      continue
    }
    if (c === ')') {
      toks.push({ k: 'rp' })
      i++
      continue
    }
    // division op (multi-char) before single-char ops
    if (expr.startsWith(d.divOp, i)) {
      toks.push({ k: 'op', v: 'div' })
      i += d.divOp.length
      continue
    }
    if (c === '+' || c === '-' || c === '*') {
      toks.push({ k: 'op', v: c })
      i++
      continue
    }
    // number
    if (d.base === 16) {
      if (c === '0' && (expr[i + 1] === 'x' || expr[i + 1] === 'X')) {
        let j = i + 2
        let lit = ''
        while (j < expr.length && hexDigits.includes(expr[j]!.toLowerCase())) {
          lit += expr[j]
          j++
        }
        if (lit === '') return { ok: false }
        toks.push({ k: 'num', v: Number.parseInt(lit, 16) })
        i = j
        continue
      }
      return { ok: false }
    }
    if (c >= '0' && c <= '9') {
      let j = i
      let lit = ''
      while (j < expr.length && expr[j]! >= '0' && expr[j]! <= '9') {
        lit += expr[j]
        j++
      }
      toks.push({ k: 'num', v: Number.parseInt(lit, 10) })
      i = j
      continue
    }
    return { ok: false }
  }
  // Pratt / precedence-climbing parser with unary minus.
  let p = 0
  const peek = (): Tok | undefined => toks[p]
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, div: 2 }
  let failed = false
  const intDiv = (a: number, b: number): number => {
    if (b === 0) {
      failed = true
      return 0
    }
    if (d.rounding === 'floor') return Math.floor(a / b)
    return Math.trunc(a / b)
  }
  const parseAtom = (): number => {
    const t = peek()
    if (!t) {
      failed = true
      return 0
    }
    if (t.k === 'op' && t.v === '-') {
      p++
      return -parseAtom()
    }
    if (t.k === 'op' && t.v === '+') {
      p++
      return parseAtom()
    }
    if (t.k === 'lp') {
      p++
      const v = parseExpr(0)
      const r = peek()
      if (r?.k !== 'rp') {
        failed = true
        return 0
      }
      p++
      return v
    }
    if (t.k === 'num') {
      p++
      return t.v
    }
    failed = true
    return 0
  }
  function parseExpr(minPrec: number): number {
    let left = parseAtom()
    for (;;) {
      const t = peek()
      if (t?.k !== 'op') break
      const pr = prec[t.v]
      if (pr === undefined || pr < minPrec) break
      p++
      const right = parseExpr(pr + 1)
      if (t.v === '+') left += right
      else if (t.v === '-') left -= right
      else if (t.v === '*') left *= right
      else if (t.v === 'div') left = intDiv(left, right)
    }
    return left
  }
  if (toks.length === 0) return { ok: false }
  const value = parseExpr(0)
  if (failed || p !== toks.length) return { ok: false }
  return { ok: true, value }
}

// ── The generated task: stub + test file (seed-derived expected values) ──────────
/** Build one task's stub (the four functions the agent implements) + its pytest file. Expected values are
 *  computed by `refEval`, so every assertion is provably correct for the dialect. `total` is the pytest
 *  count (used as the denominator if pytest itself errors out). */
function genTask(seed: number): { stub: string; test: string; total: number } {
  const d = dialectFor(seed)
  // Concrete expressions whose VALUES we compute with the reference. A mix of: precedence, left-assoc
  // subtraction/division, nested parens, unary minus, and (separately) malformed inputs that must raise.
  const n = (x: number) => (d.base === 16 ? `0x${x.toString(16)}` : `${x}`)
  // pick a few seed-varied operands so the literals differ per task (still contamination-proof)
  const r = (m: number, salt: number) => (((seed + salt) * 2654435761 + 7) >>> 0) % m
  const a = r(20, 1) + 3 // 3..22
  const b = r(9, 2) + 2 // 2..10
  const c = r(7, 3) + 2 // 2..8
  const div = d.divOp

  type Case = { expr: string; name: string }
  const goodExprs: Case[] = [
    { expr: `${n(a)} + ${n(b)} * ${n(c)}`, name: 'precedence_mul_over_add' },
    { expr: `(${n(a)} + ${n(b)}) * ${n(c)}`, name: 'parens_override' },
    { expr: `${n(a)} - ${n(b)} - ${n(c)}`, name: 'left_assoc_sub' },
    { expr: `${n(a)} ${div} ${n(b)}`, name: 'int_div' },
    { expr: `-${n(a)} ${div} ${n(b)}`, name: 'neg_int_div_rounding' },
    { expr: `-${n(b)} + ${n(a)}`, name: 'unary_minus_lead' },
    { expr: `${n(a)} * -${n(b)}`, name: 'unary_minus_after_op' },
    { expr: `((${n(a)}))`, name: 'redundant_nested_parens' },
    { expr: `${n(a)} + ${n(b)} * ${n(c)} ${div} ${n(b)}`, name: 'mixed_precedence' },
    { expr: `  ${n(a)}   *   ${n(b)}  `, name: 'whitespace_tolerant' },
    { expr: `${n(a)}`, name: 'single_number' },
    { expr: `(${n(a)} - ${n(b)}) * (${n(c)} + ${n(b)})`, name: 'two_groups' },
  ]
  const goodRows = goodExprs.map((g) => {
    const res = refEval(g.expr, d)
    if (!res.ok) throw new Error(`reference rejected a GOOD expr "${g.expr}" (seed ${seed})`)
    return { ...g, value: res.value }
  })

  // Malformed / undefined inputs that MUST raise the dialect error string.
  const badExprs: Case[] = [
    { expr: '', name: 'empty' },
    { expr: `${n(a)} +`, name: 'trailing_op' },
    { expr: `(${n(a)} + ${n(b)}`, name: 'unbalanced_open' },
    { expr: `${n(a)} ${div} 0`, name: 'div_by_zero' },
    { expr: `${n(a)} ${n(b)}`, name: 'two_numbers_no_op' },
    { expr: `${n(a)} @ ${n(b)}`, name: 'bad_char' },
  ]
  for (const bad of badExprs) {
    const res = refEval(bad.expr, d)
    if (res.ok) throw new Error(`reference ACCEPTED a BAD expr "${bad.expr}" (seed ${seed})`)
  }

  const lines: string[] = [
    'import pytest',
    'from calc import evaluate, CalcError',
    '',
    '# The calculator dialect is defined ENTIRELY by these tests. Infer it: number base, the integer-',
    '# division operator glyph, the rounding rule for negative quotients, and the error contract.',
    '',
  ]
  // good cases
  for (const g of goodRows)
    lines.push(`def test_${g.name}(): assert evaluate(${JSON.stringify(g.expr)}) == ${g.value}`)
  // error cases: evaluate raises CalcError with the exact message.
  for (const bad of badExprs) {
    lines.push(`def test_${bad.name}_raises():`)
    lines.push('    with pytest.raises(CalcError) as ei:')
    lines.push(`        evaluate(${JSON.stringify(bad.expr)})`)
    lines.push(`    assert str(ei.value) == ${JSON.stringify(d.errStr)}`)
  }
  lines.push('')
  const test = lines.join('\n')
  const total = goodRows.length + badExprs.length

  const stub = [
    '# Implement a stack/precedence-based integer calculator. The EXACT dialect (number base, the',
    '# integer-division operator, the rounding rule, the error string) is defined ONLY by test_calc.py.',
    '# Read every test carefully; you CANNOT run them. Implement evaluate() and the CalcError exception.',
    '',
    'class CalcError(Exception):',
    '    pass',
    '',
    'def tokenize(expr):',
    '    raise NotImplementedError',
    '',
    'def to_rpn(tokens):',
    '    raise NotImplementedError',
    '',
    'def eval_rpn(rpn):',
    '    raise NotImplementedError',
    '',
    'def evaluate(expr):',
    '    raise NotImplementedError',
    '',
  ].join('\n')
  return { stub, test, total }
}

// ── The Environment (AgenticSurface) — host pytest, no Docker. ────────────────────
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
      ['-m', 'pytest', '-q', '--tb=no', '--color=no', '-p', 'no:cacheprovider', 'test_calc.py'],
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

/** A worker-facing test report: the pass count + the NAMES of the failing tests, so the agent (and the
 *  supervisor's next worker) can target what is actually broken instead of guessing blind. */
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
        '-rf',
        '-p',
        'no:cacheprovider',
        'test_calc.py',
      ],
      { cwd: dir, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  }
  const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
  const failed =
    Number(out.match(/(\d+) failed/)?.[1] ?? 0) + Number(out.match(/(\d+) error/)?.[1] ?? 0)
  const failing = [...out.matchAll(/FAILED \S*::(\S+)/g)].map((m) => m[1])
  const head = `${passed}/${passed + failed} tests passed.`
  return failing.length ? `${head} FAILING: ${failing.join(', ')}` : head
}

export const hardCodingEnv: AgenticSurface = {
  name: 'hard-generated-coding',
  async open(task) {
    const seed = Number((task.meta as { seed?: number })?.seed ?? 0)
    const { stub, test, total } = genTask(seed)
    const dir = mkdtempSync(join(tmpdir(), 'hce-'))
    writeFileSync(join(dir, 'calc.py'), stub)
    writeFileSync(join(dir, 'test_calc.py'), test)
    const handle: ArtifactHandle = { id: dir, surface: 'hard-generated-coding' }
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
          description: 'Read a file (e.g. test_calc.py to learn the dialect, or calc.py).',
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
            'Write COMPLETE contents of calc.py (the implementation). test_calc.py is read-only.',
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
            'Run the test suite; returns how many passed and the NAMES of the failing tests. Use it to see what is still broken and fix exactly that.',
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
      if (p !== 'calc.py' && p !== 'test_calc.py')
        return 'ERROR: only calc.py and test_calc.py are readable'
      try {
        return readFileSync(join(ws.dir, p), 'utf8').slice(0, 8000)
      } catch (e) {
        return `ERROR: ${(e as Error).message}`
      }
    }
    if (name === 'write_file') {
      const p = String(args.path ?? '')
      if (p !== 'calc.py') return 'ERROR: only calc.py is writable'
      try {
        writeFileSync(join(ws.dir, 'calc.py'), String(args.content ?? ''))
        return 'wrote calc.py'
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
export const hardCodingTasks = async (offset: number, n: number): Promise<AgenticTask[]> =>
  Array.from({ length: n }, (_, i) => {
    const seed = offset + i
    return {
      id: `hce-${seed}`,
      systemPrompt:
        'You are a Python engineer. calc.py must implement a STACK/PRECEDENCE-based integer expression ' +
        'evaluator. Its EXACT dialect is defined ONLY by test_calc.py: the number base (decimal or 0x-hex), ' +
        'the integer-division operator glyph, the rounding rule for negative quotients (floor toward -inf vs ' +
        'truncate toward zero), and the EXACT error string. WORKFLOW: read test_calc.py, write calc.py, then ' +
        'call run_tests to see what passed and which tests FAIL, and fix exactly those — iterate until all pass. ' +
        'Get precedence, associativity, unary minus, nested parens, division-by-zero, and malformed input right. ' +
        'Do not edit test_calc.py.',
      userPrompt:
        'Read test_calc.py, implement calc.py, then run_tests and fix the failing tests until every test passes.',
      meta: { seed },
    } satisfies AgenticTask
  })

/** The correct calc.py for a seed — used ONLY by the $0 calibration self-check (never by the agent).
 *  A faithful shunting-yard implementation of the seed's dialect, so the task is PROVABLY solvable. */
function referenceLib(seed: number): string {
  const d = dialectFor(seed)
  const rounding =
    d.rounding === 'floor' ? 'a // b' : 'int(a / b) if (a < 0) != (b < 0) else a // b'
  return [
    'class CalcError(Exception):',
    '    pass',
    '',
    `_ERR = ${JSON.stringify(d.errStr)}`,
    `_BASE = ${d.base}`,
    `_DIV = ${JSON.stringify(d.divOp)}`,
    '_PREC = {"+": 1, "-": 1, "*": 2, "/": 2}',
    '',
    'def _fail():',
    '    raise CalcError(_ERR)',
    '',
    'def tokenize(expr):',
    '    toks = []',
    '    i = 0',
    '    n = len(expr)',
    '    while i < n:',
    '        c = expr[i]',
    '        if c in " \\t":',
    '            i += 1',
    '            continue',
    '        if c == "(":',
    '            toks.append(("lp", None)); i += 1; continue',
    '        if c == ")":',
    '            toks.append(("rp", None)); i += 1; continue',
    '        if expr.startswith(_DIV, i):',
    '            toks.append(("op", "/")); i += len(_DIV); continue',
    '        if c in "+-*":',
    '            toks.append(("op", c)); i += 1; continue',
    '        if _BASE == 16:',
    '            if c == "0" and i + 1 < n and expr[i+1] in "xX":',
    '                j = i + 2',
    '                while j < n and expr[j].lower() in "0123456789abcdef":',
    '                    j += 1',
    '                if j == i + 2:',
    '                    _fail()',
    '                toks.append(("num", int(expr[i:j], 16))); i = j; continue',
    '            _fail()',
    '        else:',
    '            if c.isdigit():',
    '                j = i',
    '                while j < n and expr[j].isdigit():',
    '                    j += 1',
    '                toks.append(("num", int(expr[i:j], 10))); i = j; continue',
    '            _fail()',
    '    return toks',
    '',
    'def to_rpn(tokens):',
    '    # Convert to RPN, marking unary minus/plus as "neg"/"pos". Shunting-yard.',
    '    out = []',
    '    ops = []',
    '    prev = None  # None|num|op|lp|rp',
    '    for kind, val in tokens:',
    '        if kind == "num":',
    '            out.append(("num", val)); prev = "num"',
    '        elif kind == "op":',
    '            if val in "+-" and prev in (None, "op", "lp"):',
    '                u = "neg" if val == "-" else "pos"',
    '                ops.append(("u", u))',
    '            else:',
    '                while ops and ops[-1][0] == "op" and _PREC[ops[-1][1]] >= _PREC[val]:',
    '                    out.append(ops.pop())',
    '                while ops and ops[-1][0] == "u":',
    '                    out.append(ops.pop())',
    '                ops.append(("op", val))',
    '            prev = "op"',
    '        elif kind == "lp":',
    '            ops.append(("lp", None)); prev = "lp"',
    '        elif kind == "rp":',
    '            while ops and ops[-1][0] != "lp":',
    '                out.append(ops.pop())',
    '            if not ops:',
    '                _fail()',
    '            ops.pop()',
    '            while ops and ops[-1][0] == "u":',
    '                out.append(ops.pop())',
    '            prev = "rp"',
    '    while ops:',
    '        if ops[-1][0] == "lp":',
    '            _fail()',
    '        out.append(ops.pop())',
    '    return out',
    '',
    'def eval_rpn(rpn):',
    '    st = []',
    '    for kind, val in rpn:',
    '        if kind == "num":',
    '            st.append(val)',
    '        elif kind == "u":',
    '            if not st:',
    '                _fail()',
    '            x = st.pop()',
    '            st.append(-x if val == "neg" else x)',
    '        else:',
    '            if len(st) < 2:',
    '                _fail()',
    '            b = st.pop(); a = st.pop()',
    '            if val == "+":',
    '                st.append(a + b)',
    '            elif val == "-":',
    '                st.append(a - b)',
    '            elif val == "*":',
    '                st.append(a * b)',
    '            else:',
    '                if b == 0:',
    '                    _fail()',
    `                st.append(${rounding})`,
    '    if len(st) != 1:',
    '        _fail()',
    '    return st[0]',
    '',
    'def evaluate(expr):',
    '    toks = tokenize(expr)',
    '    if not toks:',
    '        _fail()',
    '    return eval_rpn(to_rpn(toks))',
    '',
  ].join('\n')
}

// ── calibrate-before-measure ($0, no router): reference → all pass, stub → 0 ─────
/** Prove the task is SOLVABLE (reference → all pass) AND the grader DISCRIMINATES (stub → 0). No LLM. A
 *  reference that doesn't clear means the task/grader is broken — fix it before spending. Run with CALIBRATE=1. */
async function calibrate(): Promise<void> {
  console.log('═══ CALIBRATION ($0) — task solvable + grader discriminates? ═══')
  let ok = true
  for (const seed of [0, 1, 2, 3, 5, 7, 11, 13, 17, 23]) {
    const task = (await hardCodingTasks(seed, 1))[0]!
    const h = await hardCodingEnv.open(task)
    const stub = await hardCodingEnv.score(task, h)
    await hardCodingEnv.call(h, 'write_file', { path: 'calc.py', content: referenceLib(seed) })
    const ref = await hardCodingEnv.score(task, h)
    await hardCodingEnv.close(h)
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

if (import.meta.url === `file://${process.argv[1]}`)
  calibrate().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
    process.exit(1)
  })
