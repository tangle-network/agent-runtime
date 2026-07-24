/**
 * Spec-reachability — the third factory-bench admission gate.
 *
 * Gold-passes and base-fails prove the hidden tests GRADE the feature. They do
 * not prove the spec DESCRIBES it. On `factory.agent-eval.309` all seven
 * measured runs failed the same 17 of 30 hidden tests because ~11 of them
 * assert on identifiers (`keepThreshold`, `saturated`, `minTasksWithGap`) that
 * the rewritten spec never names — no builder could reach them, so the
 * instance could only ever separate arms inside an 11–13 band.
 *
 * This module answers, per hidden test: **is everything this test asserts on
 * derivable from the spec text?** It is deliberately mechanical and a LOWER
 * BOUND on unreachability — it under-approximates through local test helpers
 * rather than guessing, so a test it flags is flagged on evidence (a concrete
 * missing token), never on a heuristic hunch.
 *
 * What a test is held to require:
 *  - `module`  — the relative module specifier it imports the deliverable from
 *                (the file path contract).
 *  - `import`  — every named import taken from such a module (exported API).
 *  - `option`  — every object-literal key reachable from the arguments of a
 *                call to one of those imported symbols (the options contract).
 *  - `property`— every property name READ off a value (`r.summary.repsUnknown`),
 *                minus test-framework members, JS builtins, and names the test
 *                file declares itself.
 *  - `asserted-string` — string literals that appear in a matcher argument
 *                (`toBe('saturated')`) and NEVER as an input elsewhere in the
 *                test. Input/output asymmetry is what separates a contract
 *                value from fixture data: `'gap-task'` is fed in, `'gap'` is
 *                only ever asserted.
 *  - `message-word` — camelCase identifiers and ≥5-char lowercase words inside
 *                a regex passed to a matcher (`toThrow(/keepThreshold must …/)`).
 *                Error messages are a contract; a spec that wants them matched
 *                has to quote them.
 *
 * Matching against the spec is whole-word and case-sensitive for identifiers,
 * and stemmed/case-insensitive for prose words, so `names` in the spec covers
 * `name` in a message but `saturated` is not covered by anything.
 */

import ts from 'typescript'

export type RequirementKind = 'module' | 'import' | 'option' | 'property' | 'asserted-string' | 'message-word'

export interface Requirement {
  token: string
  kind: RequirementKind
}

export interface TestRequirements {
  /** Repo-relative judge test path. */
  file: string
  /** Vitest full name: describe titles and the test title joined by ' > '. */
  name: string
  requirements: Requirement[]
}

export interface TestReachability extends TestRequirements {
  reachable: boolean
  /** Requirements with no counterpart in the spec — why the test is unreachable. */
  missing: Requirement[]
}

export interface ReachabilityReport {
  tests: TestReachability[]
  /** Tests every requirement of which the spec provides. */
  reachable: number
  unreachable: number
  /** Full names of the unreachable tests, in file/source order. */
  unreachableNames: string[]
}

export interface JudgeTestSource {
  path: string
  source: string
}

const BLOCK_FNS = new Set(['describe', 'suite'])
const TEST_FNS = new Set(['it', 'test'])

/** Objects whose members are language surface, never the deliverable's API. */
const GLOBAL_OBJECTS = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'Number', 'Object', 'Promise',
  'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'WeakMap', 'WeakSet', 'console', 'process',
  'globalThis', 'structuredClone', 'vi', 'expect',
])

/** Test-framework members and JS builtins that carry no spec obligation. */
const MEMBER_DENYLIST = new Set([
  // vitest / chai surface
  'not', 'resolves', 'rejects', 'skip', 'only', 'todo', 'each', 'concurrent', 'sequential',
  'fails', 'runIf', 'skipIf', 'extend', 'soft', 'poll',
  // Error / Function / Object surface
  'message', 'stack', 'cause', 'constructor', 'prototype', 'call', 'apply', 'bind',
  'hasOwnProperty', 'valueOf', 'toString', 'toJSON',
  // Array / iterable
  'length', 'map', 'filter', 'reduce', 'reduceRight', 'forEach', 'find', 'findIndex', 'findLast',
  'some', 'every', 'includes', 'indexOf', 'lastIndexOf', 'slice', 'splice', 'push', 'pop',
  'shift', 'unshift', 'concat', 'join', 'sort', 'reverse', 'flat', 'flatMap', 'fill', 'at',
  'keys', 'values', 'entries', 'from', 'of', 'isArray',
  // Number / Math / JSON / Promise / String
  'isNaN', 'isInteger', 'isFinite', 'parseFloat', 'parseInt', 'toFixed', 'toPrecision',
  'floor', 'ceil', 'round', 'abs', 'sign', 'trunc', 'pow', 'sqrt', 'random', 'log', 'exp',
  'min', 'max', 'now', 'parse', 'stringify', 'then', 'catch', 'finally', 'all', 'allSettled',
  'race', 'resolve', 'reject', 'split', 'replace', 'replaceAll', 'trim', 'trimStart', 'trimEnd',
  'startsWith', 'endsWith', 'padStart', 'padEnd', 'repeat', 'charAt', 'charCodeAt', 'codePointAt',
  'toLowerCase', 'toUpperCase', 'normalize', 'match', 'matchAll', 'search', 'set', 'get', 'has',
  'add', 'delete', 'clear', 'size', 'next', 'done', 'value', 'default',
  // Node stdlib result shapes a test reads incidentally (spawnSync, fs.Stats,
  // Buffer, AbortSignal) — language surface, never the deliverable's contract.
  'status', 'stdout', 'stderr', 'signal', 'pid', 'code', 'errno', 'syscall', 'path',
  'byteLength', 'buffer', 'byteOffset', 'mode', 'uid', 'gid', 'dev', 'ino', 'nlink', 'rdev',
  'blksize', 'blocks', 'atime', 'mtime', 'ctime', 'birthtime', 'atimeMs', 'mtimeMs', 'ctimeMs',
  'isFile', 'isDirectory', 'isSymbolicLink', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'aborted', 'abort', 'reason', 'env', 'cwd', 'argv', 'platform', 'sep',
])

/** A matcher member is anything shaped `toXxx` plus the negation/await chain. */
const isMatcherMember = (name: string): boolean => /^to[A-Z]/.test(name)

const MIN_PROPERTY_LEN = 2
const MIN_STRING_LEN = 3
const MIN_PROSE_WORD_LEN = 5

/**
 * Only token-shaped literals carry a naming obligation. A contract string is an
 * enum value or a status word (`'saturated'`); a multi-word or punctuated
 * literal (`'diff --git a/src/calc.ts'`, `'verify FAILED (tests failed)'`) is
 * fixture content or prose a builder reconstructs from behavior, not a name it
 * has to invent. Restricting here keeps the gate a lower bound instead of
 * flagging every test that asserts on a log line.
 */
const CONTRACT_STRING_RE = /^[A-Za-z][A-Za-z0-9_-]{2,31}$/

interface TokenBag {
  modules: Set<string>
  imports: Set<string>
  options: Set<string>
  properties: Set<string>
  assertedStrings: Set<string>
  messageWords: Set<string>
  inputStrings: Set<string>
  /** Literal chunks of template expressions the test builds values from. */
  templateChunks: Set<string>
  locals: Set<string>
}

const emptyBag = (): TokenBag => ({
  modules: new Set(),
  imports: new Set(),
  options: new Set(),
  properties: new Set(),
  assertedStrings: new Set(),
  messageWords: new Set(),
  inputStrings: new Set(),
  templateChunks: new Set(),
  locals: new Set(),
})

const MIN_TEMPLATE_CHUNK_LEN = 6

/**
 * `expect(x).not.toContain('PATCH_LINE_90')` where the test built its fixture
 * from `` `… // PATCH_LINE_${i}` `` names nothing: the value is assembled in
 * plain sight from a template chunk. A contract string is one the test could
 * not have constructed itself.
 */
function isTemplateConstructed(value: string, chunks: Iterable<string>): boolean {
  for (const chunk of chunks) {
    for (let k = Math.min(chunk.length, value.length); k >= MIN_TEMPLATE_CHUNK_LEN; k -= 1) {
      if (value.startsWith(chunk.slice(chunk.length - k))) return true
    }
  }
  return false
}

function mergeInto(target: TokenBag, source: TokenBag): void {
  for (const key of Object.keys(target) as (keyof TokenBag)[]) {
    for (const v of source[key]) target[key].add(v)
  }
}

interface BlockRecord {
  title: string
  isTest: boolean
  parent: BlockRecord | undefined
  bag: TokenBag
}

/** Leftmost identifier of a call target: `it.skip(…)` and `it.each(…)(…)` → `it`. */
function calleeRootName(expr: ts.Expression): string | undefined {
  let cur: ts.Expression = expr
  while (ts.isPropertyAccessExpression(cur) || ts.isCallExpression(cur)) cur = cur.expression
  return ts.isIdentifier(cur) ? cur.text : undefined
}

function literalTitle(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

/** `expect(x).a.b.matcher(…)` — is this call a matcher invocation? */
function isMatcherCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false
  let cur: ts.Expression = node.expression.expression
  while (ts.isPropertyAccessExpression(cur)) cur = cur.expression
  if (ts.isAwaitExpression(cur)) cur = cur.expression
  return ts.isCallExpression(cur) && ts.isIdentifier(cur.expression) && cur.expression.text === 'expect'
}

function collectStrings(node: ts.Node, into: Set<string>): void {
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n) && n.text.length >= MIN_STRING_LEN) into.add(n.text)
    ts.forEachChild(n, visit)
  }
  visit(node)
}

/** camelCase identifiers + ≥5-char lowercase words from a regex body. */
export function messageWordsFromRegex(regexLiteral: string): string[] {
  const body = regexLiteral.replace(/^\//, '').replace(/\/[a-z]*$/, '')
  const out = new Set<string>()
  for (const word of body.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
    if (/^[a-z][a-zA-Z0-9]*[A-Z]/.test(word)) out.add(word)
    else if (/^[a-z]+$/.test(word) && word.length >= MIN_PROSE_WORD_LEN) out.add(word)
  }
  return [...out]
}

/** Object-literal keys reachable from a call's arguments (through arrays/objects only). */
function collectOptionKeys(node: ts.Node, into: Set<string>): void {
  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      const name = prop.name
      if (name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))) into.add(name.text)
      if (ts.isPropertyAssignment(prop)) collectOptionKeys(prop.initializer, into)
    }
    return
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const el of node.elements) collectOptionKeys(el, into)
    return
  }
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node)) {
    collectOptionKeys(node.expression, into)
  }
}

function declaredName(node: ts.Node, into: Set<string>): void {
  if (ts.isIdentifier(node)) {
    into.add(node.text)
    return
  }
  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
    for (const el of node.elements) {
      if (ts.isBindingElement(el)) declaredName(el.name, into)
    }
  }
}

/**
 * Parse one judge test file into per-test requirement sets.
 *
 * Tokens found outside any `it()` (file-level imports, describe-level helpers)
 * are attributed to every test beneath them — shared setup is a dependency of
 * every test that runs through it.
 */
export function extractTestRequirements(source: string, file: string): TestRequirements[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fileBag = emptyBag()
  const blocks: BlockRecord[] = []
  const byCall = new Map<ts.CallExpression, BlockRecord>()

  const blockFor = (node: ts.Node): BlockRecord | undefined => {
    let cur: ts.Node | undefined = node.parent
    while (cur !== undefined) {
      if (ts.isCallExpression(cur)) {
        const rec = byCall.get(cur)
        if (rec !== undefined) return rec
      }
      cur = cur.parent
    }
    return undefined
  }
  const bagFor = (node: ts.Node): TokenBag => blockFor(node)?.bag ?? fileBag

  // Pass 1 — block tree, so attribution has somewhere to land.
  const discover = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const root = calleeRootName(node.expression)
      const title = literalTitle(node.arguments[0])
      if (root !== undefined && title !== undefined && (BLOCK_FNS.has(root) || TEST_FNS.has(root))) {
        const rec: BlockRecord = {
          title,
          isTest: TEST_FNS.has(root),
          parent: blockFor(node),
          bag: emptyBag(),
        }
        blocks.push(rec)
        byCall.set(node, rec)
      }
    }
    ts.forEachChild(node, discover)
  }
  discover(sf)

  // Pass 2 — imports (always file-scoped) and the set of deliverable symbols.
  const deliverableSymbols = new Set<string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteralLike(stmt.moduleSpecifier)) continue
    const spec = stmt.moduleSpecifier.text
    if (!spec.startsWith('.')) continue
    fileBag.modules.add(spec.replace(/^(\.\.?\/)+/, '').replace(/\.(ts|tsx|js|mts)$/, ''))
    const bindings = stmt.importClause?.namedBindings
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        fileBag.imports.add(el.name.text)
        deliverableSymbols.add(el.name.text)
      }
    }
    if (stmt.importClause?.name !== undefined) {
      fileBag.imports.add(stmt.importClause.name.text)
      deliverableSymbols.add(stmt.importClause.name.text)
    }
  }

  // Pass 3 — everything else, attributed to its innermost enclosing block.
  const visit = (node: ts.Node): void => {
    const bag = bagFor(node)

    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      declaredName(node.name, bag.locals)
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined) {
      bag.locals.add(node.name.text)
    }

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text
      const objectIsGlobal = ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text)
      if (
        !objectIsGlobal &&
        !isMatcherMember(name) &&
        !MEMBER_DENYLIST.has(name) &&
        name.length >= MIN_PROPERTY_LEN
      ) {
        bag.properties.add(name)
      }
    }

    if (ts.isCallExpression(node)) {
      const root = calleeRootName(node.expression)
      if (root !== undefined && deliverableSymbols.has(root)) {
        for (const arg of node.arguments) collectOptionKeys(arg, bag.options)
      }
      if (isMatcherCall(node)) {
        for (const arg of node.arguments) {
          collectStrings(arg, bag.assertedStrings)
          const regexes = (n: ts.Node): void => {
            if (ts.isRegularExpressionLiteral(n)) {
              for (const w of messageWordsFromRegex(n.text)) bag.messageWords.add(w)
            }
            ts.forEachChild(n, regexes)
          }
          regexes(arg)
        }
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(sf)

  // Strings NOT in a matcher argument are inputs (fixture data), per block.
  const collectInputs = (node: ts.Node): void => {
    if (isMatcherCall(node)) {
      // The receiver `expect(<subject>)` is an input position; the matcher's
      // own arguments are the assertion and must NOT cancel themselves out.
      if (ts.isPropertyAccessExpression(node.expression)) {
        let cur: ts.Expression = node.expression.expression
        while (ts.isPropertyAccessExpression(cur)) cur = cur.expression
        collectStrings(cur, bagFor(node).inputStrings)
      }
      return
    }
    if (ts.isStringLiteralLike(node) && node.text.length >= MIN_STRING_LEN) {
      bagFor(node).inputStrings.add(node.text)
    }
    if (ts.isTemplateExpression(node)) {
      const bag = bagFor(node)
      if (node.head.text.length >= MIN_TEMPLATE_CHUNK_LEN) bag.templateChunks.add(node.head.text)
      for (const span of node.templateSpans) {
        if (span.literal.text.length >= MIN_TEMPLATE_CHUNK_LEN) bag.templateChunks.add(span.literal.text)
      }
    }
    ts.forEachChild(node, collectInputs)
  }
  collectInputs(sf)

  const out: TestRequirements[] = []
  for (const rec of blocks) {
    if (!rec.isTest) continue
    const chain: BlockRecord[] = []
    for (let cur: BlockRecord | undefined = rec; cur !== undefined; cur = cur.parent) chain.unshift(cur)
    const merged = emptyBag()
    mergeInto(merged, fileBag)
    for (const b of chain) mergeInto(merged, b.bag)

    const requirements: Requirement[] = []
    const push = (kind: RequirementKind, tokens: Iterable<string>): void => {
      for (const token of tokens) requirements.push({ token, kind })
    }
    push('module', merged.modules)
    push('import', merged.imports)
    // Option keys are API by construction (they are written INTO a call to a
    // deliverable symbol), so a same-named local never cancels one.
    push('option', merged.options)
    push(
      'property',
      [...merged.properties].filter((t) => !merged.locals.has(t) && !merged.options.has(t)),
    )
    push(
      'asserted-string',
      [...merged.assertedStrings].filter(
        (t) =>
          CONTRACT_STRING_RE.test(t) && !merged.inputStrings.has(t) && !isTemplateConstructed(t, merged.templateChunks),
      ),
    )
    push(
      'message-word',
      [...merged.messageWords].filter((t) => !merged.inputStrings.has(t)),
    )

    out.push({
      file,
      name: chain.map((b) => b.title).join(' > '),
      requirements: requirements.sort((a, b) => a.token.localeCompare(b.token)),
    })
  }
  return out
}

const stem = (w: string): string => w.replace(/(ings|ing|ies|ed|es|s)$/, '')

export interface Vocabulary {
  text: string
  words: Set<string>
  stems: Set<string>
}

/**
 * Repo-relative source paths the spec explicitly points the builder at
 * ("`DelegationTaskQueue` in `src/mcp/task-queue.ts`"). Existing symbols in
 * those files are derivable WITHOUT the spec restating them, so their contents
 * join the vocabulary. Files the spec does not name stay out — otherwise a
 * whole repo's identifiers would launder any omission (`keepThreshold` and
 * `saturated` both exist elsewhere in agent-eval at `.309`'s base, and all
 * seven measured runs still failed every test that needs them).
 */
export function specReferencedPaths(spec: string): string[] {
  const hits = spec.match(/[A-Za-z0-9_@./-]+\.(?:ts|tsx|mts|cts|js|mjs|cjs|py|go|rs)\b/g) ?? []
  return [...new Set(hits.map((h) => h.replace(/^\.\//, '')))].filter((p) => !p.startsWith('.'))
}

/** Spec text plus the contents of the base-tree files the spec names. */
export function buildVocabulary(spec: string, referencedSources: Record<string, string> = {}): Vocabulary {
  const text = [spec, ...Object.values(referencedSources)].join('\n')
  const words = new Set(text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [])
  const stems = new Set([...words].map((w) => stem(w.toLowerCase())))
  return { text, words, stems }
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Does the vocabulary provide what this requirement needs? */
export function specProvides(vocab: Vocabulary, req: Requirement): boolean {
  const { token, kind } = req
  if (kind === 'module') {
    if (vocab.text.includes(token)) return true
    const base = token.split('/').pop() ?? token
    return new RegExp(`['"\`][^'"\`]*[/]${escapeRe(base)}['"\`]`).test(vocab.text)
  }
  if (kind === 'message-word') {
    if (/[A-Z]/.test(token)) return vocab.words.has(token)
    return vocab.stems.has(stem(token.toLowerCase()))
  }
  if (!IDENT_RE.test(token)) return vocab.text.includes(token)
  return vocab.words.has(token)
}

/** Per-test reachable/unreachable with the exact tokens the spec is missing. */
export function checkSpecReachability(
  spec: string,
  files: JudgeTestSource[],
  referencedSources: Record<string, string> = {},
): ReachabilityReport {
  const index = buildVocabulary(spec, referencedSources)
  const tests: TestReachability[] = []
  for (const f of files) {
    for (const t of extractTestRequirements(f.source, f.path)) {
      const missing = t.requirements.filter((r) => !specProvides(index, r))
      tests.push({ ...t, reachable: missing.length === 0, missing })
    }
  }
  return {
    tests,
    reachable: tests.filter((t) => t.reachable).length,
    unreachable: tests.filter((t) => !t.reachable).length,
    unreachableNames: tests.filter((t) => !t.reachable).map((t) => t.name),
  }
}

/**
 * Rewrite `it(` → `it.skip(` for the named tests so an excluded test is
 * REPORTED as skipped by the judge run rather than silently counted as a
 * failure. Fail-loud on a name that matches no test — a stale exclusion would
 * otherwise shrink the denominator for nothing.
 */
export function applyTestExclusions(
  source: string,
  file: string,
  excludedNames: readonly string[],
): { source: string; skipped: string[] } {
  if (excludedNames.length === 0) return { source, skipped: [] }
  const wanted = new Set(excludedNames)
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const byCall = new Map<ts.CallExpression, { title: string; parent?: ts.CallExpression }>()

  const enclosing = (node: ts.Node): ts.CallExpression | undefined => {
    let cur: ts.Node | undefined = node.parent
    while (cur !== undefined) {
      if (ts.isCallExpression(cur) && byCall.has(cur)) return cur
      cur = cur.parent
    }
    return undefined
  }
  const fullName = (call: ts.CallExpression): string => {
    const parts: string[] = []
    let cur: ts.CallExpression | undefined = call
    while (cur !== undefined) {
      const rec = byCall.get(cur)
      if (rec === undefined) break
      parts.unshift(rec.title)
      cur = rec.parent
    }
    return parts.join(' > ')
  }

  const edits: { pos: number; text: string }[] = []
  const skipped: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const root = calleeRootName(node.expression)
      const title = literalTitle(node.arguments[0])
      if (root !== undefined && title !== undefined && (BLOCK_FNS.has(root) || TEST_FNS.has(root))) {
        const parent = enclosing(node)
        byCall.set(node, { title, ...(parent !== undefined ? { parent } : {}) })
        if (TEST_FNS.has(root)) {
          const name = fullName(node)
          if (wanted.has(name)) {
            skipped.push(name)
            if (!ts.isPropertyAccessExpression(node.expression)) {
              edits.push({ pos: node.expression.getEnd(), text: '.skip' })
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  let out = source
  for (const edit of edits.sort((a, b) => b.pos - a.pos)) {
    out = out.slice(0, edit.pos) + edit.text + out.slice(edit.pos)
  }
  return { source: out, skipped }
}
