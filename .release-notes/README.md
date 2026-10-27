# Release notes

Feature pull requests that change Runtime source or its published manifest add one file here.

```md
type: patch
---
One short changelog entry written for Runtime consumers.
```

Use `patch`, `minor`, or `major`. Do not edit `package.json`, `CHANGELOG.md`,
`docs/canonical-api.md`, `api-surface.json`, or versioned fixtures for release prep.

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
