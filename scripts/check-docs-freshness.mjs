#!/usr/bin/env node
// Docs freshness gate for the hand-authored judgment docs.
//
// Fails loud (non-zero exit) when a judgment doc drifts from ground truth:
//   CLASS 1  version / substrate-peer pins        != package.json
//   CLASS 2  `path:line` citations                -> cited file does not exist on disk
//   CLASS 3  §2 decision-table "Use ___" code-spans -> symbol is not a real export
//   CLASS 4  §3 signature prose PascalCase Types   -> symbol resolves to no source export
//   CLASS 5  package.json exports subpath          -> has no typedoc entryPoint
//   CLASS 6  any backticked symbol in the CURATED docs (canonical-api / concepts /
//            architecture) -> resolves to no src/substrate export and isn't a whitelisted
//            concept. Closes the gap that let prose symbols (gepaDriver/refineGepa) lie.
//
// Ground-truth sources (no third-party deps; pure node):
//   - package.json (version + peerDependencies)
//   - the generated API index under docs/api/ (every exported symbol -> a <name>.md page)
//   - the agent-eval substrate contract .d.ts (re-exported symbols the doc cites as substrate)
//   - bench/src/*.ts|*.mts (harness-local symbols that are NOT package exports)
//
// Local fix path on failure: read the report, fix the doc line, and for stale generated
// pages run `pnpm run docs:api`. The gate must NEVER be weakened to hide real drift.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docPath = join(repoRoot, 'docs', 'canonical-api.md')
const apiDir = join(repoRoot, 'docs', 'api')

const drift = []
const report = (cls, line, message, file = 'canonical-api.md') => drift.push({ cls, line, message, file })

const doc = readFileSync(docPath, 'utf8')
const docLines = doc.split('\n')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

// --- helpers ---------------------------------------------------------------

// lower bound of a "^x | >=x <y" semver range, e.g. ">=0.93.0 <1.0.0" -> "0.93.0"
function lowerBound(range) {
  if (!range) return undefined
  const m = range.match(/(\d+\.\d+\.\d+)/)
  return m ? m[1] : undefined
}

function lineOf(needle) {
  const i = docLines.findIndex((l) => l.includes(needle))
  return i === -1 ? 0 : i + 1
}

// Parse a built/substrate .d.ts barrel into the set of names it exports.
// Handles `export { a, b as c, type D }`, `export declare const/function/class`,
// and `export type/interface/enum`.
function exportsFromDts(file) {
  const names = new Set()
  if (!existsSync(file)) return names
  const txt = readFileSync(file, 'utf8')
  for (const m of txt.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
    for (let part of m[1].split(',')) {
      part = part.trim()
      if (!part) continue
      const as = part.split(/\s+as\s+/)
      const name = (as[1] || as[0]).trim().replace(/^type\s+/, '')
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  for (const m of txt.matchAll(
    /export\s+declare\s+(?:const|let|var|function|class|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g,
  ))
    names.add(m[1])
  for (const m of txt.matchAll(/export\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g))
    names.add(m[1])
  return names
}

// Parse a source .ts/.mts file's top-level exported names.
function exportsFromSource(file) {
  const names = new Set()
  if (!existsSync(file)) return names
  const txt = readFileSync(file, 'utf8')
  for (const m of txt.matchAll(
    /export\s+(?:async\s+)?(?:const|let|var|function|class|abstract\s+class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  ))
    names.add(m[1])
  for (const m of txt.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (let part of m[1].split(',')) {
      part = part.trim()
      if (!part) continue
      const as = part.split(/\s+as\s+/)
      const name = (as[1] || as[0]).trim().replace(/^type\s+/, '')
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return names
}

// All .ts/.mts/.tsx source files under a tree (skipping node_modules/dist/.d.ts).
function sourceFilesUnder(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) sourceFilesUnder(p, acc)
    else if (/\.(ts|mts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) acc.push(p)
  }
  return acc
}

// Every symbol TypeDoc resolved as a public export, read from the generated API pages.
// Output is one markdown file per MODULE (typedoc.json outputFileStrategy: modules); each
// export/member is a heading (### Name / #### method). Walking headings (not filenames) makes
// this robust to either output strategy (per-module flat files OR per-symbol nested files).
function exportsFromApiIndex(root) {
  const names = new Set()
  if (!existsSync(root)) return names
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
      } else if (e.name.endsWith('.md')) {
        const md = readFileSync(p, 'utf8')
        // h3..h6 headings are symbols/members; h2 are category sections (Functions/Classes/…).
        for (const m of md.matchAll(/^#{3,6}\s+`?([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
      }
    }
  }
  walk(root)
  return names
}

// =========================================================================
// CLASS 1 — version + substrate-peer pins must equal package.json
// =========================================================================

const docVersion = pkg.version
// Header "**Version X.Y.Z.**"
let versionHeaderMatches = 0
for (let i = 0; i < docLines.length; i++) {
  const m = docLines[i].match(/\*\*Version (\d+\.\d+\.\d+)\.?\*\*/)
  if (!m) continue
  versionHeaderMatches++
  if (m[1] !== docVersion) {
    report('VERSION', i + 1, `doc states Version ${m[1]}, package.json is ${docVersion}`)
  }
}
// Presence assertion: a deleted/renamed version header would otherwise look fresh
// forever (match-if-present is silent on absence).
if (versionHeaderMatches === 0) {
  report(
    'VERSION',
    0,
    'no `**Version X.Y.Z**` header found in the doc — the version pin is unguarded; restore it',
  )
}

// Any prose "version X.Y.Z" claim that asserts THIS package's version must match
// package.json. A reference to a DIFFERENT package/tool's version (e.g. "playwright
// version 1.40.0") is legitimate, so skip when the match is immediately preceded by
// a package/tool word — only an unqualified "version X.Y.Z" is read as agent-runtime's.
const knownOtherPkgWords = new Set([
  'playwright',
  'typescript',
  'typedoc',
  'biome',
  'node',
  'vitest',
  'tsdown',
  'esbuild',
  'pnpm',
  ...Object.keys({ ...(pkg.dependencies || {}), ...(pkg.peerDependencies || {}), ...(pkg.devDependencies || {}) }).map(
    (k) => k.split('/').pop(),
  ),
])
for (let i = 0; i < docLines.length; i++) {
  for (const m of docLines[i].matchAll(/(\S+\s+)?version (\d+\.\d+\.\d+)\b/gi)) {
    const ver = m[2]
    const preceding = (m[1] || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    // "agent-eval substrate version" etc. — a qualifier naming another package/tool.
    if (preceding && (knownOtherPkgWords.has(preceding) || preceding.includes('agent-'))) continue
    if (ver !== docVersion) {
      report('VERSION', i + 1, `prose claims version ${ver}, package.json is ${docVersion}`)
    }
  }
}

// Substrate peer pins: agent-eval / agent-interface / sandbox ranges in the header.
const peers = pkg.peerDependencies || {}
const peerChecks = [
  { name: 'agent-eval', range: peers['@tangle-network/agent-eval'] },
  { name: 'agent-interface', range: peers['@tangle-network/agent-interface'] },
  { name: 'sandbox', range: peers['@tangle-network/sandbox'] },
]
for (const { name, range } of peerChecks) {
  const floor = lowerBound(range)
  if (!floor) continue
  // Match the package name and its NEAREST following `>=x.y.z` pin on the same line,
  // tolerant of intervening backticks / `**` / "(peer " markdown. The earlier regex
  // excluded backticks between the name and its pin (`[^\n\`]*`), so a peer whose name
  // is itself backticked (`@tangle-network/agent-interface`) or that has backticked
  // tokens before its floor never matched — its pin was silently never asserted.
  const re = new RegExp(`${name}[^\\n]*?>=(\\d+\\.\\d+\\.\\d+)`, 'g')
  let matched = 0
  for (let i = 0; i < docLines.length; i++) {
    for (const m of docLines[i].matchAll(re)) {
      matched++
      if (m[1] !== floor) {
        report(
          'SUBSTRATE',
          i + 1,
          `doc pins ${name} >=${m[1]}, package.json peerDependencies floor is >=${floor}`,
        )
      }
    }
  }
  // Presence assertion: the banner claims to check all 3 substrate peers. A peer floor
  // declared in package.json but never asserted in the doc is an unguarded pin
  // masquerading as "checked" — fail loud rather than silently verify nothing.
  if (matched === 0) {
    report(
      'SUBSTRATE',
      lineOf('Version'),
      `substrate peer "${name}" has a package.json floor (>=${floor}) but the doc never asserts it — the "${peerChecks.length} substrate peers" claim is unmet; state the pin (e.g. \`>=${floor} <1.0.0\`)`,
    )
  }
}

// =========================================================================
// CLASS 2 — local `path:line` citations must point at a file that exists
// =========================================================================

const seenCitations = new Set()
for (let i = 0; i < docLines.length; i++) {
  for (const m of docLines[i].matchAll(
    /\b((?:src|bench\/src|tests)\/[A-Za-z0-9_./-]+\.(?:ts|mts|tsx))\b/g,
  )) {
    const rel = m[1]
    const key = `${rel}@${i}`
    if (seenCitations.has(key)) continue
    seenCitations.add(key)
    if (!existsSync(join(repoRoot, rel))) {
      report('CITATION', i + 1, `cited source file does not exist: ${rel}`)
    }
  }
}
// node_modules citations into content-hashed bundle files rot on every republish —
// flag them so they are never reintroduced (point at the public type export instead).
for (let i = 0; i < docLines.length; i++) {
  const m = docLines[i].match(/node_modules\/[A-Za-z0-9@._/-]+-[A-Za-z0-9]{6,}\.d\.ts/)
  if (m) {
    report(
      'CITATION',
      i + 1,
      `citation into a content-hashed node_modules bundle (${m[0]}) — these rot on every substrate republish; cite the package's public type name, not its bundled .d.ts`,
    )
  }
}

// =========================================================================
// CLASS 3 — §2 decision-table "Use ___" code-spans resolve to a real export
// =========================================================================

// Build the export universe ONCE: generated API index ∪ substrate contract ∪ bench source.
const universe = new Set()
for (const n of exportsFromApiIndex(apiDir)) universe.add(n)
for (const n of exportsFromDts(
  join(repoRoot, 'node_modules', '@tangle-network', 'agent-eval', 'dist', 'contract', 'index.d.ts'),
))
  universe.add(n)
for (const f of [
  'bench/src/adapters.ts',
  'bench/src/gate.ts',
  'bench/src/stats.mts',
  'bench/src/benchmarks/types.ts',
  'bench/src/index.ts',
]) {
  for (const n of exportsFromSource(join(repoRoot, f))) universe.add(n)
}
// runProfileMatrix / pairedBootstrap / heldoutSignificance live in agent-eval campaign/root;
// runConversation/runPersonaConversation/runPersonaDispatch are root `.` exports (in the api index).
for (const n of exportsFromDts(
  join(repoRoot, 'node_modules', '@tangle-network', 'agent-eval', 'dist', 'campaign', 'index.d.ts'),
))
  universe.add(n)
for (const n of exportsFromDts(
  join(repoRoot, 'node_modules', '@tangle-network', 'agent-eval', 'dist', 'index.d.ts'),
))
  universe.add(n)
// Neutral-contract + substrate types the doc recommends importing directly
// (AgentProfile / defineAgentProfile / AgentProfileMcpServer ... live in agent-interface + sandbox).
for (const n of exportsFromDts(
  join(repoRoot, 'node_modules', '@tangle-network', 'agent-interface', 'dist', 'index.d.ts'),
))
  universe.add(n)
for (const n of exportsFromDts(
  join(repoRoot, 'node_modules', '@tangle-network', 'sandbox', 'dist', 'index.d.ts'),
))
  universe.add(n)

if (universe.size < 50) {
  report(
    'SETUP',
    0,
    `export universe is suspiciously small (${universe.size}) — run \`pnpm run build && pnpm run docs:api\` so docs/api/ exists before the freshness gate`,
  )
}

// Find the §2 table body: header row contains "I want to" + "Do NOT build".
let inTable = false
for (let i = 0; i < docLines.length; i++) {
  const line = docLines[i]
  if (line.includes('| I want to') && line.includes('Do NOT')) {
    inTable = true
    continue
  }
  if (inTable) {
    if (!line.trimStart().startsWith('|')) {
      inTable = false
      continue
    }
    if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) continue // separator row
    // Cells split on unescaped pipes.
    const cells = line
      .split(/(?<!\\)\|/)
      .map((c) => c.trim())
      .filter((c, idx, arr) => idx !== 0 && idx !== arr.length - 1) // drop leading/trailing empties
    if (cells.length < 2) continue
    const useCell = cells[1] // the "Use (import)" column
    for (const span of useCell.matchAll(/`([^`]+)`/g)) {
      const raw = span[1].trim()
      // Skip subpaths / paths / dotted member-access / non-identifier tokens.
      if (/^[./@]/.test(raw)) continue
      if (raw.includes('/')) continue // subpath labels like `agent-eval/contract`
      if (raw.includes('.')) continue // member access: `ctx.shot()`, `ctx.critique()`
      const id = (raw.match(/^([A-Za-z_$][\w$]*)/) || [])[1]
      if (!id) continue
      // snake_case = an MCP tool name (`delegate_code`), never a JS export — skip.
      if (id.includes('_')) continue
      // A bare lowercase word with no call site and no uppercase letter is prose / a
      // backend-or-barrel label (`bench`, `shape`, `sandbox`, `bridge`), not an import.
      // Real recommendations are either a call (`fanout(...)`) or a Type (PascalCase).
      const isCall = raw.includes('(')
      const hasUpper = /[A-Z]/.test(id)
      if (!isCall && !hasUpper) continue
      if (!universe.has(id)) {
        report(
          'EXPORT',
          i + 1,
          `decision-table recommends \`${raw}\` but symbol "${id}" resolves to no known export (api index ∪ substrate contract ∪ bench source)`,
        )
      }
    }
  }
}

// =========================================================================
// CLASS 4 — §3 per-subsystem signature prose: a backticked Type that resolves
// to no known export is a renamed/removed/fabricated symbol. §3 is the bulk of
// the doc (the per-symbol signatures) and was previously unguarded for renames.
// =========================================================================

// §3 may cite ANY exported symbol (including internal-but-exported types like
// `ReproductionCheck`/`StrategyArtifacts` that have no generated api page), so the
// universe here is the WHOLE source surface: every top-level export under src/** and
// bench/src/** ∪ the substrate/contract universe above ∪ JS/TS builtins. The §2 table
// keeps its narrower public-export universe (a §2 recommendation must be a real import).
const sourceUniverse = new Set(universe)
for (const f of [...sourceFilesUnder(join(repoRoot, 'src')), ...sourceFilesUnder(join(repoRoot, 'bench', 'src'))]) {
  for (const n of exportsFromSource(f)) sourceUniverse.add(n)
}
// JS/TS structural types that appear as backticked Types in anti-pattern prose
// (`a parent-id Map you track`) but are global builtins, not package exports.
for (const b of [
  'Map',
  'Set',
  'Promise',
  'Array',
  'Object',
  'Record',
  'Partial',
  'Required',
  'Readonly',
  'ReadonlyArray',
  'Date',
  'RegExp',
  'Error',
  'JSON',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Symbol',
  'WeakMap',
  'WeakSet',
  'Iterator',
  'Iterable',
  'AsyncIterable',
  'Awaited',
  'Pick',
  'Omit',
])
  sourceUniverse.add(b)

// §3 bounds: from the "## 3." header to the next "## 4." header. Scoping to §3 (not
// §5/§6/§7) keeps narrative-prose type-mentions in later sections out of scope.
let s3Start = -1
let s3End = docLines.length
for (let i = 0; i < docLines.length; i++) {
  if (s3Start === -1 && /^## 3\.\s/.test(docLines[i])) s3Start = i
  else if (s3Start !== -1 && /^## 4\.\s/.test(docLines[i])) {
    s3End = i
    break
  }
}
if (s3Start !== -1) {
  let inFence = false
  for (let i = s3Start; i < s3End; i++) {
    const line = docLines[i]
    if (/^\s*```/.test(line)) {
      // Skip fenced code blocks: interface bodies / examples are full of generic
      // params (`TPersona`, `D`) and local field types, not export citations.
      inFence = !inFence
      continue
    }
    if (inFence) continue
    for (const span of line.matchAll(/`([^`]+)`/g)) {
      const raw = span[1].trim()
      if (/^[./@]/.test(raw)) continue
      if (raw.includes('/')) continue // subpath labels
      if (raw.includes('.')) continue // member access: `ctx.shot()`, `result.kind`
      const id = (raw.match(/^([A-Za-z_$][\w$]*)/) || [])[1]
      if (!id) continue
      if (id.includes('_')) continue // snake_case = an MCP tool / config key, not a Type
      // §3 is stricter than §2: only flag PascalCase TYPE names (`^[A-Z][a-z]`). This
      // deliberately skips lowercase method/field/option names (`open`, `maxConcurrency`),
      // ALL-CAPS labels (`BENCH`, `K`), and generic params — those are not exports and
      // would false-positive. A renamed/removed exported Type is the catchable drift.
      if (!/^[A-Z][a-z]/.test(id)) continue
      if (!sourceUniverse.has(id)) {
        report(
          'EXPORT',
          i + 1,
          `§3 signature cites type \`${raw}\` but "${id}" resolves to no known export (src/** ∪ bench/src/** ∪ substrate ∪ builtins) — renamed, removed, or fabricated`,
        )
      }
    }
  }
}

// =========================================================================
// CLASS 5 — every package.json exports subpath must have a TypeDoc entry point,
// else the whole subpath is silently undocumented (no api page, clean git diff,
// and the export universe never learns its symbols).
// =========================================================================

const typedocPath = join(repoRoot, 'typedoc.json')
if (existsSync(typedocPath)) {
  const typedoc = JSON.parse(readFileSync(typedocPath, 'utf8'))
  const entryPoints = new Set(typedoc.entryPoints || [])
  // The ./loops subpath is an intentional alias of ./runtime (same source file) — the
  // doc and MAINTAINING.md both state this — so it correctly has no second entry point.
  const aliasSubpaths = new Set(['./loops'])
  for (const [subpath, target] of Object.entries(pkg.exports || {})) {
    if (subpath === '.' || aliasSubpaths.has(subpath)) continue
    // Resolve the subpath's source root from its dist "import"/"types" target. tsdown
    // flattens a directory barrel (`src/runtime/index.ts`) to a flat bundle
    // (`dist/runtime.js`), so a subpath's source is EITHER `src/<name>.ts` OR
    // `src/<name>/index.ts` — accept whichever the entryPoints declare and that exists.
    const dist = typeof target === 'string' ? target : target.import || target.types
    if (!dist) continue
    const base = dist.replace(/^\.\/dist\//, '').replace(/\.js$|\.d\.ts$/, '')
    const candidates = [
      `src/${base}.ts`,
      `src/${base.replace(/\/index$/, '')}/index.ts`,
      `src/${base}/index.ts`,
      `src/runtime/${base}.ts`,
      `src/runtime/${base.replace(/\/index$/, '')}/index.ts`,
    ]
    const matched = candidates.find((c) => entryPoints.has(c))
    if (!matched) {
      report(
        'SETUP',
        0,
        `package.json exports "${subpath}" has no typedoc.json entryPoint (tried ${candidates.map((c) => `"${c}"`).join(' / ')}) — the subpath generates no api page and its symbols are unguarded; add it to typedoc.json entryPoints`,
      )
    }
  }
}

// =========================================================================
// CLASS 6 — PROSE-SYMBOL: every backticked symbol in the CURATED docs must
// resolve to a real export. CLASS 3/4 only scanned canonical-api's §2/§3, so a
// removed/renamed symbol in general prose (the `gepaDriver`/`refineGepa` class)
// lived unchecked. This scans ALL backticks outside fenced code in the curated
// set; it never inspects prose meaning — pure symbol existence.
// =========================================================================

// Substrate universe: walk EVERY dist/**/*.d.ts of each @tangle-network peer (not just the
// index barrels CLASS 3 reads) so sub-module exports (HarnessType, ReasoningEffort, …) resolve.
function dtsFilesUnder(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) dtsFilesUnder(p, acc)
    else if (e.name.endsWith('.d.ts')) acc.push(p)
  }
  return acc
}
const substrateUniverse = new Set()
for (const peer of Object.keys(pkg.peerDependencies || {})) {
  for (const f of dtsFilesUnder(join(repoRoot, 'node_modules', ...peer.split('/'), 'dist')))
    for (const n of exportsFromDts(f)) substrateUniverse.add(n)
}

// Words a curated doc legitimately backticks that are NOT exports: JS keywords, and a small
// concept whitelist (profile FIELDS / conceptual terms used as code spans, not imports).
const jsReservedWords = new Set([
  'while', 'switch', 'for', 'if', 'else', 'return', 'catch', 'try', 'throw', 'await', 'async',
  'const', 'let', 'var', 'function', 'class', 'new', 'typeof', 'this', 'case', 'default', 'break',
  'continue', 'do', 'in', 'of', 'void', 'yield', 'delete', 'instanceof', 'extends', 'implements',
  'interface', 'type', 'enum', 'export', 'import', 'from', 'as', 'true', 'false', 'null', 'undefined',
])
const conceptWhitelist = new Set([
  'AgentProfile', 'systemPrompt', 'AgentAdapter', 'RuntimeStreamEvent', 'PromptOptions', 'propose', 'OR',
])
const proseResolvable = new Set([...sourceUniverse, ...substrateUniverse, ...conceptWhitelist])

const curatedDocs = ['canonical-api.md', 'concepts.md', 'architecture.md', 'intelligence-sdk.md']
for (const docName of curatedDocs) {
  const p = join(repoRoot, 'docs', docName)
  if (!existsSync(p)) continue
  const lines = readFileSync(p, 'utf8').split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    for (const span of line.matchAll(/`([^`]+)`/g)) {
      const raw = span[1].trim()
      if (/^[./@]/.test(raw)) continue // paths / subpaths
      if (raw.includes('/')) continue // subpath labels
      if (raw.includes('.')) continue // member access: `ctx.shot()`
      // Multi-word backtick spans are prose (`the up-flow`), not a symbol — but a call
      // (`fanout(a, b)`) has spaces only inside its args, so strip the args first.
      if (/\s/.test(raw.replace(/\([^)]*\)/, ''))) continue
      const id = (raw.match(/^([A-Za-z_$][\w$]*)/) || [])[1]
      if (!id) continue
      if (id.includes('_')) continue // snake_case = MCP tool / config key, not a JS export
      if (jsReservedWords.has(id)) continue
      // Only flag a call (`refineGepa()`) or a PascalCase Type (`DriverChat`) — lowercase
      // non-call words are prose/fields/labels, ALL-CAPS are constants, both false-positive.
      const isCall = raw.includes('(')
      const isPascal = /^[A-Z][a-z]/.test(id)
      if (!isCall && !isPascal) continue
      if (!proseResolvable.has(id)) {
        report(
          'PROSE-SYMBOL',
          i + 1,
          `backticked symbol \`${raw}\` ("${id}") resolves to no export (src/** ∪ bench/src/** ∪ substrate ∪ concept-whitelist) — renamed, removed, or fabricated`,
          docName,
        )
      }
    }
  }
}

// =========================================================================
// CLASS 7 — PRIMITIVE-CATALOG: the generated anti-reinvention inventory
// (docs/api/primitive-catalog.md) must be REGENERATABLE-IDENTICAL to the
// committed copy. Re-run the generator to a temp file and byte-compare; any
// difference means a live export was added/removed/renamed (or a TSDoc summary
// changed) without `pnpm run docs:api` — a RED BUILD, same enforcement the
// `git diff --exit-code -- docs/api` step gives the TypeDoc pages. This is what
// makes "a new live export absent from the catalog" impossible to miss.
// =========================================================================

const catalogPath = join(apiDir, 'primitive-catalog.md')
if (!existsSync(catalogPath)) {
  report(
    'CATALOG',
    0,
    'docs/api/primitive-catalog.md is missing — run `pnpm run docs:api` to generate it (scripts/gen-primitive-catalog.mjs)',
    'api/primitive-catalog.md',
  )
} else {
  const genScript = join(repoRoot, 'scripts', 'gen-primitive-catalog.mjs')
  const tmpOut = join(tmpdir(), `primitive-catalog-check-${process.pid}.md`)
  const res = spawnSync(process.execPath, [genScript], {
    cwd: repoRoot,
    env: { ...process.env, PRIMITIVE_CATALOG_OUT: tmpOut },
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    report(
      'CATALOG',
      0,
      `regenerating the primitive catalog failed (exit ${res.status}). The generator needs a build + installed substrate: run \`pnpm run build\` then \`pnpm run docs:api\`. stderr:\n${(res.stderr || '').trim().slice(0, 600)}`,
      'api/primitive-catalog.md',
    )
  } else {
    const committed = readFileSync(catalogPath, 'utf8')
    const fresh = existsSync(tmpOut) ? readFileSync(tmpOut, 'utf8') : ''
    if (existsSync(tmpOut)) rmSync(tmpOut, { force: true })
    if (committed !== fresh) {
      report(
        'CATALOG',
        0,
        'docs/api/primitive-catalog.md is STALE — a live export (or its TSDoc summary) changed but the committed catalog was not regenerated. Run `pnpm run docs:api` and commit docs/api/primitive-catalog.md. A new public export absent here is the exact drift this gate exists to catch.',
        'api/primitive-catalog.md',
      )
    }
  }
}

// =========================================================================
// Report + exit
// =========================================================================

const byClass = {}
for (const d of drift) (byClass[d.cls] ||= []).push(d)

if (drift.length === 0) {
  console.log('docs freshness: OK — no drift detected in the curated docs')
  console.log(`  checked: version pin (present + accurate), ${peerChecks.length} substrate peers (present + accurate),`)
  console.log(
    `  ${seenCitations.size} local citations, §2 table symbols against ${universe.size} public exports,`,
  )
  console.log(
    `  §3 signature types against ${sourceUniverse.size} source exports, exports↔typedoc entryPoint coverage,`,
  )
  console.log(
    `  prose symbols in ${curatedDocs.length} curated docs against ${proseResolvable.size} resolvable (src ∪ substrate ∪ concepts)`,
  )
  process.exit(0)
}

console.error(`docs freshness: DRIFT — ${drift.length} issue(s) in the curated docs\n`)
for (const cls of Object.keys(byClass)) {
  console.error(`[${cls}]`)
  for (const d of byClass[cls]) {
    console.error(`  docs/${d.file}:${d.line}  ${d.message}`)
  }
  console.error('')
}
console.error('Fix the doc lines above. For stale generated pages run `pnpm run docs:api`.')
console.error('Do NOT weaken this gate to hide real drift.')
process.exit(1)
