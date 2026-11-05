# Release versioning

agent-runtime owns release and adoption rules for published `@tangle-network/*` libraries and their checks (`scripts/lib/api-surface.mjs`, `scripts/check-version-bump.mjs`).

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
| Every archive pays its compatibility bump; a major needs a named break; no minor on 1.x+ | `check-version-bump.mjs --archive <tgz> --consumer <who>` | local release gate and exact archive publication admission |
| Installed versions meet every declared peer floor | `agent-app-peer-check` | each app's adopt gate and release preflight |
| One copy of each first-party package in an app | `pnpm dedupe` in `adopt-stack` | the daily refresh |

## Releasing a library

Prepare release/adoption source in a lifecycle-owned workspace; use `wt-new`/`wt-remove` for worktrees. A producer owns cleanup of a `mktemp` clone and preserves uncommitted or unpublished bytes through custody on failure. Finish when its workspace is retired or its exact custody receipt is recorded; leave no permanent release/adoption clone in `~/scratch`.

1. Merge the change with a patch bump. `check:version-bump` in the merge gate names the level it needs; its historical source records remain conservative, not reconstructed archive baselines.
2. Run `node scripts/check-version-bump.mjs --archive <qualified.tgz> --consumer <who>` before publishing the exact admitted archive. Admission regenerates both actual archive surfaces with the same current OXC emitter and refuses incompatible patch releases. Runtime also requires a nonempty CHANGELOG entry for the archive version in its local release gate. Historical consumers pinned to the retired admission action keep its reviewed implementation at that Git revision.
3. Apps pick it up at the next daily refresh. For a fix that cannot wait a day, open the adoption by hand: `pnpm add --save-exact <pkg>@<version>`, then `pnpm dedupe`, gated with the app's adopt gate from `.github/workflows/adopt-stack.yml`.
4. For a named break, publish the major and open one adoption PR per consumer the same day. The existing required consumer gate decides: verified candidates may merge; a failed gate leaves an owned draft with its failure for a person. Never bypass peer constraints or claim an untested major.
