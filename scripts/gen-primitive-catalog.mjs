#!/usr/bin/env node
// Primitive-catalog generator — the never-stale anti-reinvention inventory.
//
// Emits docs/api/primitive-catalog.md: a flat, grouped list of every primitive an
// agent should REUSE rather than re-implement, with each entry's name, import path,
// and one-line summary read LIVE from source. It is the mechanical companion to the
// hand-curated judgment in docs/canonical-api.md (§2 decision table + the AgentProfile
// law): canonical-api.md says WHICH to reach for and what NOT to build; this catalog
// proves WHAT exists, so the judgment can never silently cite a renamed/removed symbol
// and the inventory can never drift behind the code.
//
// Two source families, both read at generation time from the INSTALLED packages so the
// catalog tracks the exact versions this repo resolves:
//   (a) agent-runtime's OWN public surface — every subpath in this package.json `exports`.
//   (b) the agent-eval SUBSTRATE primitives agents should reuse — a small curated map of
//       category -> exports-map subpath (the JUDGE / AUTHENTICITY / VERIFICATION /
//       STATISTICS / CAMPAIGN / TOKEN+USAGE surfaces the canonical doc points agents at).
//       The category->subpath map is JUDGMENT (which substrate surfaces matter); the
//       symbol list under each subpath is GENERATED.
//
// Extraction is via the TypeScript compiler API (the same compiler TypeDoc uses), not by
// hand-parsing .d.ts text: a virtual re-export entry is resolved through real Node module
// resolution, every public export is enumerated, aliases are followed to the underlying
// declaration, and the first line of its TSDoc is read. This is immune to content-hashed
// bundle filenames (`statistics-xP-cWc5k.d.ts`) and aliased re-exports (`S as wilson`),
// which is exactly why a hand-written list rots and this does not.
//
// Wired into `pnpm run docs:api` (runs after TypeDoc) and gated by
// scripts/check-docs-freshness.mjs (regenerates + diffs — a new live export absent from
// the committed catalog is a RED BUILD). Never hand-edit docs/api/primitive-catalog.md.
//
// Row policy — every VISIBLE table row must be informative:
//   - Documented entries (any kind) get a table row.
//   - Undocumented interface/type entries collapse into one per-section
//     "Undocumented supporting types" paragraph (names stay backticked, so they remain
//     greppable and the freshness gate still proves their existence).
//   - Undocumented function/class/const entries keep a visible blank row AND are counted
//     against `maxUndocumentedCallables` below — a RATCHET: the ceiling is the current
//     count, so new callables must ship with a TSDoc summary and the number only falls.
//     After backfilling summaries, lower the constant to the new count.
//
// TSDoc position rule the extractor imposes: the summary line goes BEFORE any block tag.
// A doc block whose first content line is `@experimental`/`@stable` reads as ALL tag
// content to the TS compiler — getDocumentationComment returns empty and the catalog row
// renders blank. Tags go at the END of the block.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(repoRoot, 'package.json'))
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

// ─────────────────────────────────────────────────────────────────────────────
// What to catalog.
//
// OWN surface: every public subpath in this package's `exports`, mapped to a readable
// group label. The list of subpaths is DERIVED from package.json (so a new subpath shows
// up automatically); only the label is curated.
const ownSurfaceLabels = {
  '.': 'Root — task lifecycle, conversation, RSI verbs, observability',
  './agent': 'Vertical agent — manifest + improvement adapter',
  './intelligence': 'Intelligence SDK — Observe + provable-OFF billing',
  './loops': 'Recursive atom + loop kernel (alias of ./runtime)',
  './environment-provider': 'Environment provider adapters — generic sandbox/compute bridge',
  './analyst-loop': 'Analyst loop — trace findings on a running loop',
  './lifecycle': 'Artifact lifecycle — generate → measure → promote → compose',
  './profiles': 'Built-in agent profiles',
  './platform': 'Platform glue',
  './mcp': 'MCP servers — delegate / coordination / detached-session',
}
// ./loops is an intentional alias of ./runtime (same source) — list it once as ./loops,
// since that is the public name the canonical doc and the codebase use.
const ownSubpathAliases = new Set(['./runtime'])

// SUBSTRATE surface (agent-eval): the curated category -> exports-map subpath map. These
// are the reuse surfaces the canonical doc points agents at; the SYMBOLS under each are
// generated, the category↔subpath mapping is the judgment.
const substratePackage = '@tangle-network/agent-eval'

// The substrate `.` barrel is broad; these filters scope each `.`-sourced category to its
// real members. They are name-pattern allow-lists derived from the surface's known
// prefixes — a new symbol matching the pattern is picked up automatically; one that
// doesn't is out of this category's scope.
function judgeFilter(name) {
  return /Judge$|^judge[A-Z]|^ensembleJudge$|^llmJudge$|^buildJudge|JudgePanel|JudgeConfig|Calibration/.test(name)
}
function verifierFilter(name) {
  return /Verifier$|^gradeSemanticStatus$|^verify[A-Z]|VerificationReport|^LayerStatus$|^VerifyOptions$|^Finding$/.test(
    name,
  )
}
function statsFilter(name) {
  return (
    /^(wilson|paired|bonferroni|benjaminiHochberg|cliffs|cohens|confidenceInterval|mannWhitney|mcnemar|interpretCliffs|interRater|corpusInterRater|eProcess|mulberry32|normalizeScores|pearsonR|spearmanR|ranks|requiredSampleSize|passAtK|partialCredit|weightedComposite|weightedMean|wilcoxon)/.test(
      name,
    ) ||
    /Bootstrap|ConfidenceInterval|EProcess|CliffsMagnitude|McNemar|RiskDifference|ProportionInterval|WeightedComposite|CorpusAgreement|CorpusScore/.test(
      name,
    )
  )
}
function usageFilter(name) {
  return /^extractUsage|^tokenUsageField$|^RunTokenUsage$|^LlmUsage$|UsageEvent/.test(name)
}

const substrateSurfaces = [
  { label: 'JUDGE — LLM-as-judge, panels, calibration', subpath: '.', filter: judgeFilter },
  { label: 'AUTHENTICITY — is-this-real / anti-Goodhart gate', subpath: './authenticity' },
  { label: 'VERIFICATION — multi-layer verifier + semantic grading', subpath: '.', filter: verifierFilter },
  { label: 'STATISTICS — significance, intervals, effect size', subpath: '.', filter: statsFilter },
  { label: 'CAMPAIGN — profile matrix, gates, improvement loop', subpath: './campaign' },
  { label: 'TOKEN / USAGE — usage extraction + run-record usage types', subpath: '.', filter: usageFilter },
]

// ─────────────────────────────────────────────────────────────────────────────
// TS-compiler extraction.

// Build one TS program over a virtual entry that re-exports every requested module as a
// namespace, then enumerate -> resolve aliases -> read JSDoc. Resolution runs through the
// real installed packages, so this tracks the exact versions this repo has on disk.
function extractModules(specifiers) {
  // The virtual entry MUST live inside repoRoot: Node module resolution walks up from the
  // entry file's directory, so a /tmp entry never sees this repo's node_modules (and a
  // self-reference to this package fails). A dotfile in repoRoot, cleaned up in finally.
  const ns = (i) => `m${i}`
  const entry = join(repoRoot, `.primcat-entry-${process.pid}.mts`)
  writeFileSync(entry, `${specifiers.map((s, i) => `export * as ${ns(i)} from '${s}'`).join('\n')}\n`)
  try {
    const program = ts.createProgram([entry], {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
      noEmit: true,
    })
    const checker = program.getTypeChecker()
    const entryMod = checker.getSymbolAtLocation(program.getSourceFile(entry))
    if (!entryMod) {
      throw new Error('primitive-catalog: could not resolve the virtual entry module — is the package built/installed?')
    }
    const nsSymbols = checker.getExportsOfModule(entryMod)
    const result = []
    for (let i = 0; i < specifiers.length; i++) {
      const nsSym = nsSymbols.find((s) => s.getName() === ns(i))
      if (!nsSym) throw new Error(`primitive-catalog: failed to resolve module "${specifiers[i]}"`)
      const members = checker.getExportsOfModule(resolveAlias(checker, nsSym))
      if (members.length === 0) {
        throw new Error(
          `primitive-catalog: module "${specifiers[i]}" resolved to 0 exports — run \`pnpm run build\` (the own surface reads dist) and \`pnpm install\` (the substrate).`,
        )
      }
      const entries = []
      for (const member of members) {
        const decl = resolveAlias(checker, member)
        entries.push({ name: member.getName(), kind: declKind(decl), summary: firstDocLine(checker, decl) })
      }
      result.push(entries)
    }
    return result
  } finally {
    rmSync(entry, { force: true })
  }
}

function resolveAlias(checker, sym) {
  let s = sym
  while (s && s.flags & ts.SymbolFlags.Alias) {
    let next
    try {
      next = checker.getAliasedSymbol(s)
    } catch {
      break
    }
    if (!next || next === s) break
    s = next
  }
  return s
}

function declKind(sym) {
  const d = sym?.getDeclarations?.()?.[0]
  if (!d) return 'value'
  if (ts.isFunctionDeclaration(d) || ts.isMethodSignature(d)) return 'function'
  if (ts.isClassDeclaration(d)) return 'class'
  if (ts.isInterfaceDeclaration(d)) return 'interface'
  if (ts.isTypeAliasDeclaration(d)) return 'type'
  if (ts.isEnumDeclaration(d)) return 'enum'
  if (ts.isVariableDeclaration(d)) return 'const'
  return 'value'
}

function firstDocLine(checker, sym) {
  if (!sym?.getDocumentationComment) return ''
  const text = ts.displayPartsToString(sym.getDocumentationComment(checker))
  if (!text) return ''
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return ''
  return line.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 200)
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve which modules to load.

const ownModules = []
for (const subpath of Object.keys(pkg.exports || {})) {
  if (ownSubpathAliases.has(subpath)) continue
  const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`
  ownModules.push({ specifier, label: ownSurfaceLabels[subpath], subpath })
}
// A new exports subpath with no label is a hard error: the maintainer must give it a group
// label (judgment), proving the catalog never silently grows an unlabeled section.
const unlabeled = ownModules.filter((m) => !m.label)
if (unlabeled.length) {
  console.error(
    `primitive-catalog: package.json exports has subpath(s) with no group label: ${unlabeled
      .map((m) => m.subpath)
      .join(', ')}. Add a label to ownSurfaceLabels in scripts/gen-primitive-catalog.mjs.`,
  )
  process.exit(1)
}

const substrateModules = substrateSurfaces.map((s) => ({
  specifier: s.subpath === '.' ? substratePackage : `${substratePackage}/${s.subpath.replace(/^\.\//, '')}`,
  label: s.label,
  subpath: s.subpath,
  filter: s.filter,
}))

// `./package.json` is not in the substrate's `exports`, so resolve its entry and walk up
// to the nearest package.json (whose `name` confirms it's the substrate, not a hoisted dep).
function resolveInstalledVersion(packageName) {
  let dir
  try {
    dir = dirname(require.resolve(packageName))
  } catch {
    return 'unknown'
  }
  for (;;) {
    const pj = join(dir, 'package.json')
    if (existsSync(pj)) {
      const parsed = JSON.parse(readFileSync(pj, 'utf8'))
      if (parsed.name === packageName) return parsed.version
    }
    const parent = dirname(dir)
    if (parent === dir || dir.endsWith(`${sep}node_modules`)) break
    dir = parent
  }
  return 'unknown'
}
const substrateVersion = resolveInstalledVersion(substratePackage)

// ─────────────────────────────────────────────────────────────────────────────
// Extract everything in ONE program (single resolution context).

const allModules = [...ownModules, ...substrateModules]
const extracted = extractModules(allModules.map((m) => m.specifier))
const bySpecifier = new Map()
for (let i = 0; i < allModules.length; i++) bySpecifier.set(allModules[i].specifier, extracted[i])

// ─────────────────────────────────────────────────────────────────────────────
// Ratchet: undocumented callables may only DECREASE. Undocumented interface/type
// entries collapse out of the table (see renderSection), but a blank function/class/
// const row is a reach-for primitive with no summary — visible shame, capped here.
// The ceiling is the exact current count; when a backfill lowers the real number,
// lower the constant to match. Exceeding it (a new undocumented callable) exits 1.

const maxUndocumentedCallables = 0
const ratchetKinds = new Set(['function', 'class', 'const'])

// ─────────────────────────────────────────────────────────────────────────────
// Render.

const kindRank = { function: 0, const: 1, class: 2, interface: 3, type: 4, enum: 5, value: 6 }

function entriesFor(mod) {
  let entries = bySpecifier.get(mod.specifier) || []
  if (mod.filter) entries = entries.filter((e) => mod.filter(e.name))
  return [...entries].sort(
    (a, b) => (kindRank[a.kind] ?? 9) - (kindRank[b.kind] ?? 9) || a.name.localeCompare(b.name),
  )
}

function renderSection(mod, importLabel) {
  const entries = entriesFor(mod)
  if (!entries.length) return ''
  // Undocumented interface/type entries collapse into a compact paragraph below the
  // table; everything else (documented entries + undocumented callables) stays a row.
  const collapsed = entries.filter((e) => !e.summary && (e.kind === 'interface' || e.kind === 'type'))
  const rows = entries.filter((e) => !collapsed.includes(e))
  const lines = [
    `### ${mod.label}`,
    '',
    `Import from \`${importLabel}\` — ${entries.length} export${entries.length === 1 ? '' : 's'}.`,
    '',
    '| Symbol | Kind | Summary |',
    '|---|---|---|',
  ]
  for (const e of rows) {
    lines.push(
      `| \`${e.name}\` | ${e.kind} | ${e.summary || '_(no summary — add a TSDoc line at the declaration)_'} |`,
    )
  }
  if (collapsed.length) {
    lines.push('')
    lines.push(
      `**Undocumented supporting types** (add a TSDoc line at the declaration to earn a table row): ${collapsed
        .map((e) => `\`${e.name}\``)
        .join(', ')}.`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

const importLabelOf = (basePackage, subpath) =>
  subpath === '.' ? basePackage : `${basePackage}/${subpath.replace(/^\.\//, '')}`

const undocumentedCallables = []
for (const mod of allModules) {
  for (const e of entriesFor(mod)) {
    if (!e.summary && ratchetKinds.has(e.kind)) undocumentedCallables.push(`${e.name} (${e.kind}, ${mod.specifier})`)
  }
}
if (undocumentedCallables.length > maxUndocumentedCallables) {
  console.error(
    `primitive-catalog: ${undocumentedCallables.length} undocumented function/class/const exports exceed the ` +
      `ratchet ceiling of ${maxUndocumentedCallables}. Add a TSDoc summary line at each new declaration ` +
      '(summary BEFORE any @tag — a tag-first block reads as blank). Undocumented callables:\n  ' +
      undocumentedCallables.join('\n  '),
  )
  process.exit(1)
}

const out = []
out.push('<!--')
out.push('  GENERATED — do not edit. Run `pnpm run docs:api` to regenerate.')
out.push('  Source: scripts/gen-primitive-catalog.mjs reads the LIVE exports of this')
out.push('  package + the @tangle-network/agent-eval substrate via the TypeScript compiler.')
out.push('  A live export missing here = a RED BUILD (scripts/check-docs-freshness.mjs).')
out.push('-->')
out.push('')
out.push('# Primitive catalog — the never-stale anti-reinvention inventory')
out.push('')
out.push(
  `> **GENERATED** from \`@tangle-network/agent-runtime@${pkg.version}\` and ` +
    `\`@tangle-network/agent-eval@${substrateVersion}\` by \`scripts/gen-primitive-catalog.mjs\`. ` +
    'Do NOT hand-edit — run `pnpm run docs:api`. ' +
    'This is the mechanical companion to the JUDGMENT in `canonical-api.md` (§2 decision table + §1.5 AgentProfile law): ' +
    'that doc says WHICH primitive to reach for and what NOT to build; this catalog proves WHAT exists. ' +
    'Per-symbol signatures + `file:line` live in the per-module pages under `docs/api/`.',
)
out.push('')
out.push('## 1. agent-runtime — own public surface')
out.push('')
out.push(
  'Every subpath this package declares in `package.json` `exports`. Reach for these before ' +
    'hand-rolling a loop, driver, conversation runner, optimizer wrapper, or observability shim.',
)
out.push('')
for (const mod of ownModules) out.push(renderSection(mod, importLabelOf(pkg.name, mod.subpath)))
out.push('## 2. agent-eval — substrate primitives to REUSE')
out.push('')
out.push(
  'The scoring/measurement/judge substrate. **Do NOT re-implement a judge, an authenticity ' +
    'check, a verifier, a statistics routine, a profile-matrix runner, or usage extraction** — ' +
    'import them from here. The category→subpath mapping is curated; the symbols are generated.',
)
out.push('')
for (const mod of substrateModules) out.push(renderSection(mod, importLabelOf(substratePackage, mod.subpath)))

const rendered = `${out
  .filter((s) => s !== undefined)
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trimEnd()}\n`

// Default target is the committed catalog; the freshness gate overrides it to a temp path
// (PRIMITIVE_CATALOG_OUT) so it can render + diff WITHOUT mutating a tracked file.
const outPath = process.env.PRIMITIVE_CATALOG_OUT
  ? resolve(process.env.PRIMITIVE_CATALOG_OUT)
  : join(repoRoot, 'docs', 'api', 'primitive-catalog.md')
if (!process.env.PRIMITIVE_CATALOG_OUT && !existsSync(join(repoRoot, 'docs', 'api'))) {
  console.error('primitive-catalog: docs/api/ does not exist — run TypeDoc (`pnpm run docs:api`) first.')
  process.exit(1)
}
writeFileSync(outPath, rendered)

const total =
  ownModules.reduce((n, m) => n + entriesFor(m).length, 0) +
  substrateModules.reduce((n, m) => n + entriesFor(m).length, 0)
console.error(
  `primitive-catalog: wrote docs/api/primitive-catalog.md — ${ownModules.length} own subpaths + ` +
    `${substrateModules.length} substrate surfaces, ${total} catalogued symbols ` +
    `(agent-runtime@${pkg.version}, agent-eval@${substrateVersion}); ` +
    `${undocumentedCallables.length}/${maxUndocumentedCallables} undocumented callables (ratchet).`,
)
