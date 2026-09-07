# Simplification map: agent-runtime at 0.196.0

**Verdict: do not rewrite. Cut the surface first, then the duplication, then split the three files that hold most of the churn.**
Twelve subsystem readers covered 292k lines (source, tests, docs, scripts) on main `0fb49ae5` and named 27.4k lines that can go with evidence at each site.
The design that carries the product (conserved budget, reserve-before-construct, join barrier, fail-closed materialization, the usage ledger) is sound and each of its hard parts cites a measured incident; none of it is on the cut list.

## Method and limits

Each reader took one subsystem with the same rubric: responsibilities from code, exported entry points with consumers, duplication, dead exports, coupling, functions over 150 lines, simplifications with a line estimate and risk, and what to keep.
Consumers were found by grep over `bench/`, `examples/`, `tests/`, and every checkout under `~/webb`; a hosted service importing the published package would not appear.
Line estimates are the readers' own and overlap where two readers saw the same duplication.
No deletion has been applied; the audit's rule holds: a mechanism with a decisive test is removed only when the test proves it redundant.

## The public surface is the first cut

The package exports 2,357 symbols over 18 subpaths.
The twelve downstream repositories import at most 5 subpaths each, and 32 distinct symbols in the largest case.

| entry | symbols | external consumers | decision |
| --- | --- | --- | --- |
| `./graph` | 94 (3,562 LOC + tests) | none | delete or record the plan that keeps it; design records #966/#979-#982 are silent since the preset was removed |
| `./primeintellect` | 29 (1,265 LOC) | none | move to `bench/` with the other adapters, or delete |
| `./conversation` | 54 | none on the subpath | keep the module, drop the subpath and the root duplicate |
| `./knowledge` | 24 | none | drop the subpath and the root duplicate |
| `./environment-provider` | 36 | none; all 36 also on `./kernel` | drop |
| root `.` | 458 | 9 repos, mostly `runAgentTask*`, `improve`, loop-runner, errors | trim to what those consumers use; stop `export *` of three subpaths |
| `./kernel` | 920 | braid (30 imports), supervisor-lab, discovery-lab | keep; dedupe coordination types that also live on `./mcp` and root |

Estimated removal: about 11,000 lines, and every later gate (api-surface, docs freshness, version bump) stops taxing internal work that consumers never see.
Open question a hosted deployment could answer: whether anything outside the checked tree imports `./primeintellect`, `./knowledge`, `./conversation`, or `./environment-provider`.

## Dead mechanisms with no consumer

| mechanism | lines | evidence |
| --- | --- | --- |
| capability manifest and resolver spine (`src/intelligence/capability.ts`, `resolver.ts`) | 1,640 | no caller of `composeCertifiedProfile` outside its own tests |
| `provisionSupervisor` facade | 752 | no consumer in the tree; the run layout it wraps is used directly |
| detached `driveTurn` resume path (`src/mcp/detached-turn.ts` and its queue hooks) | 640 | never wired; the delegate path settles synchronously |
| `/agent` manifest surface (`defineAgent`, `createSandboxAct`, `createSurfaceImprovementProposer`) | 1,037 | one scaffold template in agent-builder pinned to 0.191.0 |
| UI-audit profiles and issue writer | 921 | `substrate.ts` is used by mcp; the rest has no caller |
| `iterationsToTraceStore` | 441 | exported, never imported |
| unwired executor selection (`detectExecutor`, `createFleetWorkspaceExecutor`, `createInProcessExecutor`) | 490 | no caller |
| `superviseSurface` and `auditIntent` | 350 | listed in canonical-api.md but no consumer; `superviseSurface` silently drops options |
| `SqlConversationJournal` and `docs/durability-adapters.md` | 217 | no consumer |
| legacy CRIU fork branch in `sandbox-lineage.ts` | ~120 | unreachable on Sandbox ≥ 0.36 unless an older box is still deployed |
| `RootSignal` arms `pause`, `resume`, `ask`; registry entries `inline`, `cli` | small | no producer or factory |

Estimated removal: about 6,500 lines, each behind a grep any reviewer can repeat.

## Duplication with one obvious home

These are copies, not variants; the readers diffed them.

| concern | copies | home |
| --- | --- | --- |
| child-process spawn, capture, and process-group kill | 5, with diverging kill semantics | `worktree-harness.ts` `runSettledCommand` |
| abortable sleep with cleanup | 6 | `util.ts` `sleep(ms, signal)` |
| `isAsyncIterable` | 8 | `util.ts` |
| FNV-1a content hash | 6 | `durable/content-address` |
| `errorMessage(unknown)` | 9 | `util.ts` |
| JSONL append with fsync, read-or-undefined on ENOENT, ENOENT predicate | 5, 6, 7 | `durable/jsonl-file.ts` |
| sha256 and git object-id regexes | 7 and 4 | `agent-interface` `sha256DigestSchema`, one local constant |
| `officialGepa` and `officialSkillOpt` bodies | identical after rename | one private factory |
| profile-experiment sealing and paired measurement | 2 | one `measureProfileCandidate` |
| trajectory-to-text compaction for analysts | 3 | `observe.ts` |
| retained-run intent, digest, capability, cleanup helpers | 2 | `retained-run-binding.ts` |
| `CoordinationToolsOptions` re-declared and hand-forwarded | 2 and 2 | one `Pick` base type and one forwarder |
| test helpers: scripted leaf, deferred, temp dirs, git init, offline profiles | 7, 35, 71, many, 37 | `tests/kernel/scripted-leaf.ts`, `tests/helpers/*` |

Estimated removal: about 3,000 lines in source and 1,300 in tests, with the larger payoff that a retry or kill-semantics fix lands once.

## Where the churn is

Three files hold most of the last 60 days of commits and most of the functions over 150 lines.

| file | lines | commits in 60 days | largest bodies |
| --- | --- | --- | --- |
| `src/runtime/supervise/runtime.ts` | 5,763 | 76 | bridge executor 1925-4735 (session loop, SSE parser, replay, receipts), `readBridgeRunState` 678 lines |
| `src/runtime/supervise/supervise.ts` | 2,879 | 59 | `superviseInternal` 690 lines with two nested closures, `driveHarnessFromBackend` 420 lines |
| `src/runtime/supervise/scope.ts` | 2,740 | 39 | `createScope` 1,112 lines, `spawn` 560 lines, `runChild` with 15 positional parameters |

The split that follows the code's own seams: bridge transport (SSE, replay, receipts) out of `runtime.ts` into its own module; the nested-driver worker factory out of `superviseInternal`; `runChild` onto an options object with one accounting path for success and failure.
Keep as is, with their measured reasons: reserve-before-construct with refund-on-throw, the join barrier's act-error precedence, the four-state materialization commit, the option-intake key lists, and the bridge replay identity checks.

## Coupling

`runtime` imports `mcp` and `mcp` imports `runtime`; `runtime` and `durable` import each other; `runtime` and `improvement` import each other.
Entry files reach into sibling internals (`conversation/index.ts` re-exports a runtime file; `tui/index.ts` re-exports a supervise file).
None of this blocks the cuts above, and the cuts reduce it: dropping the duplicate coordination-type exports removes the largest `mcp` → `runtime` edge.

## Docs and scripts

About 3,600 lines of documents are superseded by their own banners or cite moved code; the reader lists them for `docs/archive/`.
`docs/execution-model.md` folds into architecture §13, and `docs/glossary.md` tables into canonical-api §1.
Two scripts and one pre-commit hook have no caller.
`skills/agent-graphs/cases` and `generations` ship 1,399 lines of fixture JSON inside the skills directory.
`.evolve/` is still named as the live ledger by four documents while holding one entry from 2026-05-22; either the learning experiments write to it or the documents stop pointing at it.

## Order of work

1. Surface: drop the five consumer-less subpaths and the root duplicates; regenerate `api-surface.json`; one minor release.
2. Dead mechanisms: the table above, one PR per row, each with the grep in its body.
3. Duplication: `util.ts`, `jsonl-file.ts`, `runSettledCommand`, the test helpers.
4. Splits: `runtime.ts` bridge transport, `superviseInternal`, `runChild`.
5. Docs: archive, fold, and repoint `.evolve/`.

Each step is independently shippable and reversible, and none changes agent-visible behavior.
The readers' full findings, with file and line for every row, are retained in the session record referenced by the commit that adds this document.
