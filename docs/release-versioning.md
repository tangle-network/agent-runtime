# Release versioning

How every published `@tangle-network/*` library picks its next version, and how apps take it.
agent-runtime owns the rules and the checks that enforce them (`scripts/lib/api-surface.mjs`, `scripts/check-version-bump.mjs`).
Other repositories run those checks from a sparse checkout, so the rules here hold everywhere.

## The rules

1. **A release moves patch.** Fixes, new exports, optional members, wider parameters and dependency moves within a line are all patch releases. Consumers pin with caret ranges, so a patch reaches every one of them.
2. **Major only for a named break.** The break must be a removed, renamed or narrowed export or member, a new required member or peer, or a peer, Node engine or public-type dependency on a later line. Release admission refuses a major that names none.
3. **No minor on 1.x and later.** Admission refuses it and names the patch to publish instead.
4. **Every library is 1.0 or later.** A 0.x library graduates to `1.0.0` at its next release, and admission accepts the graduation. Until then, a break moves the minor and everything else moves the patch.
5. **Libraries depend on each other by caret range.** Never use an exact pin or an override. A peer floor is the first version that has every API the library uses, so raise it in the same change that starts using a newer API.
6. **Apps pin exact versions and adopt once a day.** The daily `adopt-stack` refresh moves the lockfile and runs `pnpm dedupe`, so each first-party package resolves once. Apps carry no `pnpm.overrides` for first-party packages.

## The checks

| Rule | Check | Runs in |
|---|---|---|
| A change pays for itself; a minor or a break-free major is refused | `check-version-bump.mjs` | each library's merge gate |
| Major only with a named break; no minor on 1.x and later | `check-version-bump.mjs --archive <tgz>` | publication, before `npm publish` |
| Installed versions meet every declared peer floor | `agent-app-peer-check` | each app's adopt gate and release preflight |
| One copy of each first-party package in an app | `pnpm dedupe` in `adopt-stack` | the daily refresh |

## Releasing a library

1. Merge the change with a patch bump. `check:version-bump` in the merge gate names the level it needs.
2. Publication admits the packed archive and publishes it to npm.
3. Apps pick it up at the next daily refresh. For a fix that cannot wait a day, open the adoption by hand: `pnpm add --save-exact <pkg>@<version>`, then `pnpm dedupe`, gated with the app's adopt gate from `.github/workflows/adopt-stack.yml`.
4. For a break, publish the major with its named break, then open one adoption PR per consumer the same day. The bot leaves majors for a person.
