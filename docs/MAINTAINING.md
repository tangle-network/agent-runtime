> **Track:** Reference | **Role:** docs maintenance contract | **Status:** canonical

# Maintaining the docs

This repo splits its API documentation into two layers with opposite maintenance
rules. Confusing them is how docs rot. Read this before editing anything under
`docs/`.

## The two layers

| Layer | What it holds | Who maintains it | Where |
|---|---|---|---|
| **Generated reference** | Per-symbol signatures, type shapes, source `file:line` links | **TypeDoc** — machine, never by hand | `docs/api/` (per-module pages) |
| **Generated inventory** | The flat, grouped list of every primitive to reuse — name, import path, one-line summary, all read live from source | **`scripts/gen-primitive-catalog.mjs`** — machine, never by hand | `docs/api/primitive-catalog.md` |
| **Judgment** | The §2 anti-reinvention decision table, when-to-use guidance, every entry's "Do NOT", the mental-model and AgentProfile-law prose | **Humans/agents**, hand-curated | `docs/canonical-api.md` (+ `architecture.md`, `concepts.md`, …) |

The insight: **mechanical content that drifts must be generated and gated; judgment
content stays small and hand-written.** A renamed symbol, a moved line, a bumped
peer version are all *mechanical* — they must never be a silent doc lie, so a gate
turns them into a red build. The decision table's "do this, not that" is *judgment*
— no generator can produce it, so a human owns it and the gate never touches it.

## The generated reference: `docs/api/`

- Produced by `pnpm run docs:api` (TypeDoc + `typedoc-plugin-markdown`, config in
  `typedoc.json`). Entry points are the source files behind the public `package.json`
  `exports` subpaths (the `./loops` alias of `./runtime` is intentionally not a second
  entry — same source file).
- It reads **source** (`src/**`), not `dist/`. No build is required first.
- It is **committed** to the repo so it is grep-able and PR-reviewable like the rest
  of `docs/`, and so the freshness gate can diff against it.
- **Never hand-edit a file under `docs/api/`.** Your edit is overwritten on the next
  `docs:api` run and will fail `docs:check` in CI. Change the **TSDoc comment in the
  source** instead, then regenerate.

## The generated inventory: `docs/api/primitive-catalog.md`

- Produced by `scripts/gen-primitive-catalog.mjs`, which `pnpm run docs:api` runs right
  after TypeDoc. It is the never-stale answer to "does a primitive for X already exist?"
  — the mechanical companion to `canonical-api.md`'s judgment table, so the judgment can
  never silently cite a renamed/removed symbol and the inventory can never lag the code.
- It reads the **live exports** of (a) this package's own public subpaths (from
  `package.json` `exports`) and (b) a small curated category→subpath map of the
  `@tangle-network/agent-eval` substrate surfaces agents should reuse (judge, authenticity,
  verification, statistics, campaign, token/usage). The category→subpath map is the only
  hand-curated part; the symbol list under each is generated. Extraction is via the
  **TypeScript compiler API** (the same compiler TypeDoc uses) over a virtual re-export
  entry, so it follows aliased re-exports (`S as wilson`) and content-hashed bundle files
  (`statistics-<hash>.d.ts`) — the exact things that rot a hand-written list.
- The own-surface half resolves types through `dist/`, so **a `pnpm run build` must precede
  it** (CI builds before `docs:check`; locally, `pnpm run docs:api` after a build).
- **Never hand-edit it.** Add a TSDoc summary line at the symbol's declaration in source,
  or add the export, then regenerate. To catalog a new substrate surface, add an entry to
  `substrateSurfaces` in the generator.

## The freshness gate: `scripts/check-docs-freshness.mjs`

Run by `pnpm run docs:freshness`. Pure node, fail-loud (non-zero exit on any drift —
matching the repo's `verify:package` / biome / tsc convention; no soft gates). It checks
the hand-authored judgment docs **and** the generated catalog against ground truth in
seven classes:

1. **Version + substrate pins** — the `**Version X.Y.Z**` header and every prose
   `version X.Y.Z` claim must equal `package.json` `version`; the `agent-eval` /
   `agent-interface` / `sandbox` peer floors must equal the `peerDependencies` floors.
   The check is **present-AND-accurate**, not match-if-present: the version header and
   each of the three substrate-peer floors must *appear at least once* in the doc — a
   deleted header or a dropped pin is drift, not silently "fresh". A prose `version
   X.Y.Z` is read as this package's version only when it is **unqualified**; a mention
   qualified by another package/tool (`playwright version 1.40.0`, `agent-eval …`) is
   left alone, so accurate dependency-version references don't false-alarm.
2. **`path:line` citations** — every `src/…`, `bench/src/…`, `tests/…` `file:line`
   citation must point at a file that exists. Citations into content-hashed
   `node_modules/**-<hash>.d.ts` bundles are banned (they rot on every substrate
   republish — cite the public type name instead).
3. **§2 decision-table symbols** — every code-span in the §2 "Use (import)" column must
   resolve to a real **public** export. The export universe is the union of the generated
   `docs/api/` index, the `agent-eval` contract/campaign/root `.d.ts`, the
   `agent-interface` + `sandbox` public types, and the `bench/src` harness-local
   exports. It deliberately ignores prose words, member access (`ctx.shot()`), MCP
   tool names (`delegate_code`), and the "Do NOT build" column.
4. **§3 signature types** — every backticked **PascalCase Type** in a §3 per-subsystem
   signature must resolve to an export somewhere in `src/**` ∪ `bench/src/**` ∪ the
   substrate ∪ JS builtins (a broader universe than §2, since §3 may cite internal-but-
   exported types like `ReproductionCheck` that have no generated api page). Scoped to
   §3 (not §5–§7 narrative prose), code-fences skipped, and lowercase method/field/option
   names + ALL-CAPS labels + generic params are not flagged — only a renamed, removed, or
   fabricated exported Type. This guards the bulk of the doc, not just the §2 table.
5. **Exports-subpath coverage** — every `package.json` `exports` subpath (except the
   `./loops`→`./runtime` alias) must have a matching `typedoc.json` entryPoint, so a new
   public subpath can't ship undocumented (no api page, clean diff, symbols unguarded).
6. **Prose-symbol resolution** — every backticked symbol in the **curated docs**
   (`canonical-api.md`, `concepts.md`, `architecture.md`), outside fenced code, must resolve
   to an export in `src/**` ∪ `bench/src/**` ∪ any `@tangle-network/*` substrate package
   (every `dist/**/*.d.ts`, not just the index barrels) ∪ a small explicit concept-whitelist
   (profile fields / conceptual terms like `AgentProfile`, `systemPrompt`). Only call-shaped
   (`fanout(...)`) or PascalCase Type spans are flagged; lowercase non-call words, snake_case
   MCP tools, member access, and JS keywords are prose, not symbols. This closes the gap that
   let `gepaDriver`/`refineGepa` live in the docs unchecked — a removed/renamed/fabricated
   symbol anywhere in a curated doc, not just the §2/§3 tables, is now a red build.
7. **Primitive-catalog freshness** — the gate **re-runs the generator** to a temp file and
   byte-compares it to the committed `docs/api/primitive-catalog.md`. Any difference means a
   live export was added/removed/renamed (or a TSDoc summary changed) without regenerating —
   a red build. This is the enforcement that makes "a new public export absent from the
   catalog" impossible to ship: the inventory cannot drift behind the code by hand.

The gate does **not** read line numbers exactly (they drift on every edit) and does
**not** touch the judgment prose. It only catches a renamed/removed/fabricated symbol, a
missing cited file, a banned bundle citation, a stale/absent version, an unasserted peer
pin, or an undocumented exports subpath. Conceptual or design-target terms in a curated doc
must read as prose (lowercase, or named not called) or join the concept-whitelist — never be
backticked as a current callable export they are not.

## `pnpm run docs:check` — the one command CI runs

```
docs:check = docs:api  &&  git diff --exit-code docs/api  &&  docs:freshness
```

It regenerates the reference, fails if the committed `docs/api/` is stale (you forgot
to regenerate after a TSDoc change), then runs the freshness gate. CI runs this as the
last step of the `ci` job (`.github/workflows/ci.yml`); drift is a red build, not a
silent lie.

**The pre-commit hook (`.githooks/pre-commit`) is the gate's self-healing companion.**
When a staged change adds/removes an export under `src/` (or edits the `package.json`
`exports` map), the hook rebuilds and regenerates `docs/api/primitive-catalog.md` and
re-stages it, so the commit already carries a fresh catalog and you don't hit the "forgot
to regenerate" red build. It no-ops on changes that can't affect the catalog, skips in CI
(where `docs:check` runs regardless), and is bypassable with `SKIP_DOCS_REGEN=1`. The gate
catches drift; the hook prevents it.

The `git diff --exit-code -- docs/api` staleness catch relies on the **tracked
per-module README index** (`docs/api/<module>/README.md`): every new export — even one
with no TSDoc — adds a link line to that index, dirtying a tracked file. `git diff`
ignores untracked files (a brand-new symbol's own page is untracked), so the index is
what makes the catch reliable. If you ever see an untracked api page but a clean diff,
that's why CI still goes red.

## When CI's docs step fails — the fix path

- **`git diff` of `docs/api/` is non-empty** → you changed a public symbol or its TSDoc
  and didn't regenerate. Run `pnpm run docs:api` and commit the result.
- **Freshness gate reports `[VERSION]`** → the doc cites an old package/peer version.
  Update the `**Version**` header (and any prose version claim) in
  `docs/canonical-api.md` to match `package.json`.
- **Freshness gate reports `[CITATION]`** → a cited `file:line` points at a file that
  no longer exists (renamed/moved), or someone reintroduced a hashed `node_modules`
  bundle citation. Fix the path, or cite the public type name for substrate types.
- **Freshness gate reports `[EXPORT]`** → a cited symbol was renamed or removed. If the
  message says "decision-table", fix the §2 table row to the new symbol; if it says "§3
  signature cites type", fix the §3 per-subsystem entry to the new Type name.
- **Freshness gate reports `[SETUP]`** → a `package.json` exports subpath has no
  `typedoc.json` entryPoint (see "Adding a new public export subpath" below), or the
  export universe came up empty (you forgot `pnpm run docs:api`).
- **Freshness gate reports `[CATALOG]`** → the committed `docs/api/primitive-catalog.md` is
  stale (a live export or its summary changed) or the generator failed to run. Run
  `pnpm run build` then `pnpm run docs:api` and commit `docs/api/primitive-catalog.md`.

The rule: **the code wins.** When a doc disagrees with source, fix the doc in the same
turn. The gate exists so you find out at build time, not three versions later.

## Adding a new public export subpath

If you add a `package.json` `exports` subpath, add its source `index.ts` to
`typedoc.json` `entryPoints`, give it a group label in `ownSurfaceLabels` in
`scripts/gen-primitive-catalog.mjs` (the generator fails loud if a subpath has no label),
regenerate (`pnpm run docs:api`), and commit the new `docs/api/` page +
`docs/api/primitive-catalog.md`. The freshness gate's export universe and the catalog both
pick it up automatically.
