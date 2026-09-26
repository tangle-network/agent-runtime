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
