# Release notes

Feature pull requests that change Runtime source or its published manifest add one file here.

```md
type: patch
---
One short changelog entry written for Runtime consumers.
```

Use `patch`, `minor`, or `major`, by what a consumer's code must change. `minor` adds:
an export, an optional member on an exported object type or interface, an optional
parameter or overload, or a wider parameter type. `major` breaks: it removes or renames an
export or member, makes an optional member required, adds a required member to an exported
type (a consumer may build one), narrows a parameter type or a value to a type, or changes a
function's arity or return type incompatibly. `check:version-bump` applies this rule to the
parts recorded in `api-surface.json` and treats a shape change it cannot split (a class, an
enum, an unexported type a member names) as `major`.

Do not edit `package.json`, `CHANGELOG.md`, `docs/canonical-api.md`, `api-surface.json`,
or versioned fixtures for release prep.

At release time, `pnpm run release:prepare` consumes every pending note, chooses the highest
requested semver level, updates the version and changelog once, regenerates derived artifacts,
and deletes the consumed note files.

Run it from a clean source commit. It qualifies that commit's packed cohort before writing
release files; the tagged publisher then qualifies the exact prepared release archives.

The existing stack-adoption workflow runs `scripts/release-notes.mjs --adoption` through
its post-pin step. Runtime first checks that its Eval and Interface development pins match
their cohort entries and sit inside their caret peers, which stay as written because a caret
already admits every later compatible release. A non-caret peer or an inconsistent selection
fails before any note is written. It then writes one valid patch note
for the selected dependency, peer, catalog and override values. Release versions, scripts,
unrelated workspace policy, formatting and key order do not change that fingerprint. Thus re-gating the same selection is idempotent and a later adoption gets its own note even when
an earlier one has not been released. The updater stages that note with the adopted pins.

A release on a superseded line (a major, or a `0.minor` below 1.0, under npm's highest) is refused
at publication unless its note names who needs it on a line of its own, `Needed by: <owner/repo>`.
A major over a 1.x+ release is refused unless `check-version-bump.mjs --archive` finds an
incompatibility in the packed archive against its npm predecessor.
