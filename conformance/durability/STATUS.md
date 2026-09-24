# Durability conformance STATUS

Question: **is agent-runtime durable?** — kill-and-resume conformance for `runGraph` and the
shipped journal backends, measured 2026-09-24 on `fix/interrupted-keyed-spawns`
(origin/main `12ffa98e`, agent-runtime 0.267.0 + the fixes in this PR).

Regenerate the evidence: `pnpm run conformance:durability`
(latest machine-readable results: [`results.json`](./results.json)).

## Verdict

| Surface | Backend | Cases | Result |
| --- | --- | --- | --- |
| `runGraph` (driver + 3 delegate steps, keyed side-effect tool) | file run context (`FileSpawnJournal` + `FileResultBlobStore` + `FileCoordinationLog` via `runDir`) | 23 kill points (every driver-turn boundary, each worker's before/mid/after, the tool's before/after-effect) + reference | **PASS** — after the fix below; every case resumed to the same winner, no step lost, no committed step repeated, side effect exactly once, journal resume-contract clean |
| `runGraph` with session-backed workers (re-attach arm, `recoverExecutor`) | file run context | 23 kill points (mid-session steps + driver boundaries + tool) + reference | **PASS** — interrupted sessions are RECOVERED and re-attached: every session step runs exactly once across processes, interrupted keys are never reminted, side effect exactly once |
| `runConversation` (6 turns, 2 participants, keyed per-turn effect) | `FileConversationJournal` | 18 kill points (turn start / backend-done-before-commit / turn-committed) + reference + halt-replay | **PASS** |
| `runConversation` | `SqlConversationJournal` over real sqlite (`node:sqlite`) | same 18 + reference | **PASS** |
| `runGraph` | `FileConversationJournal` / `SqlConversationJournal` | — | **N/A — capability gap**: `runGraph`'s durable layer is the `SpawnJournal` family; `ConversationJournal` is a different interface on a different subsystem. A graph run cannot take these backends. |
| `runGraph` | any SQL store | — | **N/A — capability gap**: no `SqlSpawnJournal` exists; orchestration durability is file-only. |

Totals from the run: **94/94 green** — the inline matrix (24), the session re-attach matrix (24),
the conversation matrices (39), the runDir regression locks (2), the known-defect cases (5). The
inline matrix was also verified green against 0.255.0-era main before the 0.262–0.265 series
landed; the only matrix-visible effect of that series here is the new `open-work` submission gate,
which the suite's driver now drains correctly.

## Defect found and fixed by this suite

**`runGraph({ runDir })` was not durable at all.** The graph unconditionally defaulted its
`journal`/`blobs` to in-memory stores and passed them into `supervise()`, whose own resolution
(`options.journal ?? createFileRunContext(runDir).journal`) then never built the file stores:
`runDir/spawn-journal.jsonl` was never written, `resume: true` loaded an empty in-memory tree, and
a second process silently restarted the run from scratch — while the run reported success. Found
by the suite's reference run (journal absent after a winning run); fixed by defaulting the graph's
stores to the `runDir` file context layout (`src/runtime/supervise/graph.ts`, layout owner
`createFileRunContext`). Regression lock: `tests/durability/graph-rundir-journal.test.ts`. Before
the fix the entire kill matrix fails as "restarted from scratch"; after it, 23/23 pass.

## Known defects, re-checked

- **2026-08-11 — resume appended the root record twice** (discovery-lab
  `2026-08-11-runtime-glm-recursion-smoke-11b.md`; fixed in 0.132.7/#796). **Guarded, PASS.**
  Every matrix case plus a dedicated finalization-window set
  (`tests/durability/known-defects.test.ts`) asserts the signature's absence after a real
  kill+resume: exactly one root `spawned`, at most one root `materialized`, root
  `execution-bound` receipts under distinct attempt ids, unique cursor seqs, and the resumed run
  still wins.
- **2026-09-16 — continuation lost the director state; re-entry on the non-retained path asks the
  provider for a new environment and hands it only the unmet-items fragment** (discovery-lab
  `2026-09-16-meta-harness-continuation.md`; agent-runtime#1225). **FIXED — verified PASS.** The
  fix series (#1356, `composeReentryTask`) landed on main between this suite's first measurement
  and its re-run: the unmet-contract re-entry into a fresh environment now carries the original
  task ("This is the original task of the run, unchanged"), the completion contract, the journal
  position, and the live/settled worker roster. The conformance case pins that contract on the
  real re-entry path (`tests/durability/known-defects.test.ts`); on the pre-fix base it failed
  against exactly the autopsy's fragment, so a regression to that shape turns red immediately.

## Interrupted keyed spawns — both arms proven (was the sharp edge)

A keyed spawn whose worker dies in flight (spawned journaled, never settled) used to resume
`error: "in-doubt"` for EVERY executor class, wedging the run-once key for executors that cannot
re-attach. Both arms of the correct behavior are now implemented and pinned by the suite:

- **Executors that die with the process (`inline`)**: the resume itself proves the attempt dead
  (the same predicate the budget layer already used to charge no uncertain reservation), so the
  key resolves `down` and a re-spawn under the SAME key returns `resumed: "retried"` with the
  interruption named as the reason — the runtime's automatic escalation, no driver workaround,
  no reminted key, the side-effect site sees one key (`keyedAssignments`).
- **Executors whose session outlives the process (sandbox / CLI bridge class)**: the in-doubt
  refusal stays (the remote execution may still be running — refusing replacement is correct),
  and a run that owns its worker seam can now supply `runGraph({ recoverExecutor })` /
  `supervise({ recoverExecutor })`: the resumed process reconstructs the interrupted child's
  executor from the journal, the scope adopts it before the driver drives, and the executor
  re-attaches its session and CONTINUES. The session matrix proves every step ran exactly once
  across the kill. Previously this channel existed only for backend-derived recursive managers; a
  caller-owned `makeLeafAgent`/`makeWorkerAgent` had no way to recover anything.

## Decision read-out (harden vs. adopt Temporal/Restate/Cloudflare Workflows)

What the runtime has today, and what this suite proves: **single-process-kill durability with
exactly-once keyed effects and a clean resume contract works on the shipped backends** — for the
conversation layer on file and sqlite, and for graph/supervise runs on the file store — including
kills at every step boundary and mid-step, with at-least-once tool invocation made exactly-once by
stable idempotency keys (the product's own `turnId` / `SpawnOpts.key` seams).

What it does not have, and what an external durable-execution engine would buy:

1. **No SQL/distributed orchestration journal** — graph runs are single-host, file-only. No
   multi-coordinator story, no cross-process coordination-message durability (the repo's own
   `docs/agent-managed-compute/README.md` "Not implemented" table says the same).
2. **Driver state is re-derived, not resumed** — after a kill the driver re-plans from the resume
   brief; correctness holds (proved), and the 2026-09-16 re-entry composition defect is now fixed
   and pinned by this suite — but the driver's own conversation/working set never survives the
   process, so a resumed run always re-pays re-planning and re-reading.
3. **Retention/backup/observability of the journal** is whatever the caller does with a directory.

So: if the product's durability requirement stays "survive process/host loss of a single
coordinator with an operator or wrapper restarting it", the shipped journals — with this suite as
the gate — are sufficient and the right-weight choice. If the requirement grows to multi-writer
coordination, HA failover without operator restart, or durable timers/workflows across services,
that is durable-execution-engine territory and should be adopted rather than re-built on the
spawn journal.

## The suites

| File | What it proves |
| --- | --- |
| `tests/durability/graph-rundir-journal.test.ts` | `runDir` actually journals to the file stores; no `runDir` writes nothing |
| `tests/durability/graph-kill-resume.test.ts` | the 23-point SIGKILL matrix over `runGraph` (driver turns, worker before/mid/after, tool before/after-effect), including the interrupted-inline-key auto-retry assertions |
| `tests/durability/session-reattach.test.ts` | the 23-point matrix over session-backed workers: mid-session kills recover, re-attach, and continue — every session step exactly once |
| `tests/durability/conversation-kill-resume.test.ts` | the 18-point matrix × both conversation backends + halted-run replay |
| `tests/durability/known-defects.test.ts` | the two autopsy signatures: both now guarded and green (08-11 journal cleanliness; 09-16 re-entry contract) |

## Operational note (shared hosts)

Each durable run opens one inotify watch (cancellation controls); a full test-suite run on a
shared machine can sit near the kernel's `fs.inotify.max_user_instances` default (128) when many
agent sessions, browsers, and watchers already hold instances — transient EMFILE failures in
whichever child is unlucky are host contention, not durability defects. `npx vitest run
--maxWorkers=4` reproduces logic deterministically on such hosts; idle CI runners are unaffected.
