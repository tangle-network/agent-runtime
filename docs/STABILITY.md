# API stability — what `@stable` and `@experimental` mean

Every exported symbol in this package carries a maturity level, declared with the TSDoc modifier tags `@stable` and `@experimental` (`@stable` is defined in [`tsdoc.json`](../tsdoc.json); `@experimental` is a TSDoc built-in).
This doc defines what those tags promise, how a symbol graduates, and how one is demoted or removed.

## What the tags mean for consumers

**`@stable`** — the symbol's shape and documented behavior are a contract.
You can build a product on it.
A breaking change to a stable symbol goes through the demotion/removal process below: it is never silent, never same-release, and always ships with a named migration path in the CHANGELOG.

**`@experimental`** — the symbol may change shape, change behavior, or disappear in any release, with only a CHANGELOG line.
Use it to build, not to depend on: pin an exact version if an experimental symbol is load-bearing for you, and expect to follow the CHANGELOG when you bump.

**Where a tag lives.**
A tag on the symbol itself always wins.
An untagged symbol inherits the module-level tag of the file that declares it.
An untagged symbol in an untagged module is **experimental by default** — stability is opt-in and explicit, never assumed.
A member-level `@experimental` inside a `@stable` interface marks that one member (an extension point) as still movable while the rest of the interface is contractual.

**Where you see it.**
The generated reference ([`docs/api/`](./api/)) renders **`Stable`** / **`Experimental`** badges on tagged symbols, and each subpath page (e.g. [`api/intelligence.md`](./api/intelligence.md)) renders its module-level badge directly under the page title.
Module-level tags on non-entry source files are authoritative for inheritance but only render through the subpath page and per-symbol badges.

## Graduation bar — experimental → stable

A symbol (or a whole subpath) is promoted only when **all** of the following hold:

1. **Substantive test coverage** — tests that exercise the documented behavior, not just imports that compile.
2. **A curated-doc section** — the symbol appears in a hand-maintained doc ([`canonical-api.md`](./canonical-api.md), a dedicated doc such as [`intelligence-sdk.md`](./intelligence-sdk.md), or a subpath guide); a generated `api/` page alone does not count.
3. **At least one real consumer** — `bench/`, `examples/`, or an external package actually calls it on a real path.
4. **No breaking change to its API in the last 30 days** — the shape has stopped moving before the promise is made.
5. **A CHANGELOG graduation entry** — the release notes name every promoted symbol and record the evidence for 1–3.

Promotion is a normal PR: flip the tags (per-symbol and module-level), add the CHANGELOG entry, regenerate `docs/api`.

## Demotion and removal

A `@stable` symbol is demoted back to `@experimental`, or removed, only through a deprecation cycle: the release that announces it adds `@deprecated` (naming the replacement or the reason) while the symbol keeps working, the CHANGELOG entry names the symbol and the migration path, and removal lands no earlier than the next minor release after the announcement.
An `@experimental` symbol needs none of that — it can be reshaped or removed in any release with a CHANGELOG line — which is exactly why the default is experimental and the stable set is enumerated, not implied.

## What this package declares about its first-party dependencies

Every `@tangle-network/*` specifier this package publishes is a **range**, never one exact version.
An exact pin is not a compatibility statement.
It names one version and refuses every other, so a consumer that already holds a later cohort member installs a **second physical copy** of the pinned package.
Two copies of `@tangle-network/agent-interface` in one tree means two class identities and `instanceof` answering false across the seam.

The range shape follows the depended-on package's own versioning, the same rule a peer range follows:

- **From 1.0.0** — a caret, such as `^1.0.0`. A minor is additive there, so one copy holds across later minors.
- **Below 1.0.0** — the narrower window `>=X.Y.Z <X.Y+1.0`. A pre-1.0 minor may remove, so the range stops at the next minor.

The range is stated once, in the `catalog:` block of [`pnpm-workspace.yaml`](../pnpm-workspace.yaml).
A `catalog:` specifier and a `workspace:*` specifier are both replaced by an exact version when the package is packed, so a source manifest can look clean while only the packed manifest carries the defect.
`pnpm run check:published-ranges` therefore packs each publishable workspace package and reads the archive, and fails when a packed first-party specifier names one version instead of a range.
