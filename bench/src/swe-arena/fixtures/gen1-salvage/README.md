# gen-1 salvage — first machine-proposed supervisor changes (run crashed pre-verdict)

Provenance: round-4 outer loop (`bench/src/swe-arena/outer-loop.mts`), run `r4-mrnts1n4`, 2026-07-16.
The `improve()` optimizer proposed two candidates from the loops repo base commit `1deb554` (branch `feat/supervisor-evidence-flow`).
The run died at the substrate's finalize-time integrity check on cand-1 — `WorktreeAdapterError: CodeSurface worktree changed after finalization` — before either candidate was ever evaluated.
No verdict exists for either candidate; these diffs are the machine's raw proposals, not promoted changes.

Crash mechanism (confirmed from the error payload, which embeds the changed-path list):
the cand-1 proposer ran a real dependency install inside its CodeSurface worktree (38,323 untracked `node_modules/**` paths, including pnpm's `.modules.yaml`).
`node_modules/` is gitignored, so the outer loop's change-space check (`git status`, honors `.gitignore`) passed — but the substrate's `verifyCodeSurfaceWithGit` rejects ANY extra path, ignored included (`ls-files --others --ignored --exclude-standard`).
cand-0 survived finalize because it changed only prompts/markdown, so its proposer never installed anything.

Recovery: the candidate worktrees and `improve/...` branches were pruned; the commits were recovered from the loops repo's unreachable objects (`git fsck --unreachable`) and pinned as `refs/salvage/r4-gen0-cand0` / `refs/salvage/r4-gen0-cand1` in `/home/drew/code/loops`.

## Candidates

Both diffs are `git diff 1deb554..<candidate>`; both commits are titled `agentic: 7 findings addressed`.

### cand0 — `e6d7361` (`cand0-e6d7361.diff`, prompt-only, 3 files, +84/-2)

- Worker prompt: new rule — user-visible error messages are an exact-match surface; make the SMALLEST edit of the EXISTING message (maintainer tests assert exact wording), assert singular/plural grammar in self-tests.
- Supervisor prompt: the post-delivery reviewer now also checks for invented message phrasing (`REVIEW: rework — ...` verdict) in addition to fix placement.
- Plus the required `.improve/raw-trace-diagnosis.md` evidence file (targets the two astropy failures: invented `missing required column` wording rejected by the official suite).

### cand1 — `76a8590` (`cand1-76a8590.diff`, prompts + code, 5 files, +206/-5)

- `extensions/pi/loops.ts`: soft wall-clock deadline derived from `DRIVER_DEADLINE_MS` minus a margin — aborts the run shortly before the driver's hard kill and settles through the best-effort patch-delivery path, so a run riding the deadline delivers its best persisted candidate patch instead of a 0-byte result (targets django rep-1: killed at 2600s with four non-empty worker patches on disk).
- `src/best-effort.ts`: `recoverJournalSpend()` — sums brain `metered` + worker `settled` spend from `journal.jsonl` when the abandoned run promise makes pool accounting unreachable.
- Same message-drift prompt hardening as cand0 (its own variant: `REVIEW: message-drift` verdict; grep the repo's tests for asserted message fragments before choosing wording).

## Baseline reps (completed before the crash; cached under `hh/r4/improve-run/baseline/`)

Base candidate `1deb554c45`, arm `R4`, 2 reps per instance, official judge:

| instance | rep 0 resolved | rep 1 resolved |
|---|---|---|
| astropy__astropy-13033 | false | false |
| django__django-11532 | true | false |
| matplotlib__matplotlib-20826 | true | true |

(django rep-1: driver deadline kill at 2602s, `verify_pass=false`, 0 patch lines — the exact failure cand1's soft-deadline change targets.)

## Staircase rows

`/home/drew/code/supervisor-lab/.evolve/rounds/` was empty at salvage time — the run crashed before any staircase row was written. Nothing to salvage there.
