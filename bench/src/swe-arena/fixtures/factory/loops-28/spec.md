# Supervisor delivery robustness — best-effort patch delivery, artifact-inheriting worker clones, evidence-rich settlement

## Background

The loops supervisor fans a coding task out to workers, each in a fresh `git clone` of the shared workspace, and settles each worker with a verify verdict. A paired SWE-bench round exposed three delivery defects, all reproduced from run artifacts:

1. **All-or-nothing delivery.** A worker whose patch applied but whose verify failed delivered *nothing* — several losses were literal 0-byte deliveries of real work.
2. **`git clone` drops untracked compiled artifacts.** Fresh worker clones were missing untracked/ignored build outputs present in the workspace (the compiled-tree shape), producing wholesale import crashes in workers.
3. **Evidence starvation at settlement.** The supervisor rated workers on a one-line verdict; failed patches, the verify tail, and the worker's own closing note never survived to the brain, so "close — refine it" and "dead end" looked identical.

Build three library modules fixing these, with the event-dir conventions below. (The supervisor loop wiring in `extensions/pi/loops.ts` consumes them — including its existing `gitWorkspace` / `runInWorkspace` seam, whose run result reports the shared-ref commit; the modules themselves are the deliverable.)

Worker event-dir convention used throughout: each worker `<label>` writes its patch to `<eventDir>/workers/<label>.patch` and appends lifecycle events to `<eventDir>/workers/<label>.ndjson` — a `finished` event carries `{ kind: 'finished', passed, testPassed, typecheckPassed, at }` (ISO timestamp).

## Deliverable 1 — best-effort delivery (`src/best-effort.ts`)

- `rankBestEffortCandidates(candidates)` — orders failed-verify candidates `{ label, patch, testPassed, typecheckPassed, finishedAt }` by: verify progression first (typecheck passed beats not), then larger patch, then more recent `finishedAt`, then label. Deterministic: ranking a shuffled copy yields the identical order.
- `deliverBestEffortPatch(eventDir, workspace)` — when no worker passed the gate, scan the event dir for worker patches and deliver the best applicable one into the workspace:
  - Skip blank/whitespace-only patches; if only those exist, deliver nothing and leave the workspace untouched (return `undefined`).
  - Try candidates in ranked order; a patch that does not apply is skipped and the next one is tried.
  - A delivered patch is **applied and committed** in the workspace; the commit subject marks it as a best-effort delivery, names the worker (`best-effort delivery from <label>`), and states that no worker passed the verify gate.
  - Returns `{ worker, patchBytes }` for the delivered candidate.

## Deliverable 2 — artifact-inheriting worker clones (`src/worker-clone.ts`)

- `copyUntrackedIntoClone(sourceWorkspace, cloneDir)` — copies files present in the source workspace but absent from a fresh clone: untracked files AND git-ignored build outputs. Returns stats including `copied` (count). Requirements:
  - Preserve the executable bit; rewrite symlinks whose targets point inside the source workspace to point inside the clone.
  - Skip loop-infrastructure directories and nested git repos.
  - A payload above a sanity bound — a `warnBytes` option, with a `log` sink for the warning — warns but still copies (never silently truncates the workspace).
- `withUntrackedArtifacts(...)` — wraps worker-clone materialization so a worker clone contains both the tracked files and the untracked artifacts, while a valid delivery (worker pushing back to the shared ref) **never commits the copied artifacts** back to the shared repository.

## Deliverable 3 — evidence-rich settlement (`src/worker-evidence.ts`)

Exported bounds (constants, also exported): `EVIDENCE_MAX_CHARS`, `VERIFY_TAIL_CHARS`, `NOTE_MAX_CHARS` (order-of-magnitude guidance: a few thousand / ~1k / a few hundred chars).

- `composeWorkerEvidence(input)` — one bounded evidence block for the brain from `{ passed, testPassed, typecheckPassed, testOutput, typecheckOutput, patch, reviewerNotes }` (the two verify logs are separate inputs; `reviewerNotes` is the worker's own note):
  - Always ≤ `EVIDENCE_MAX_CHARS`, even when every input is oversized.
  - Keeps the **tail** of the verify log (at least the last `VERIFY_TAIL_CHARS` chars) — the failing assertion lives at the END of the log.
  - Labels an empty patch explicitly; surfaces the worker note; a passing verify is reported without inventing a failure section.
- `settledWorkerOut(input: { passed, patch, evidence })` — what settlement hands the brain:
  - Passing worker with real edits → its patch (the deliverable).
  - Failing worker → its evidence block, never the raw patch.
  - Passing NO-EDIT worker (e.g. a post-delivery reviewer) → its evidence, not an empty patch.
  - No evidence at all → fall back to the patch; nothing at all → empty string.
- `closingWorkerNote(stdout, stderr)` — the worker's closing self-report: keep the **tail** of stdout (≤ `NOTE_MAX_CHARS`) so a final verdict line survives; fall back to stderr when stdout is blank; `undefined` when both are.

## Acceptance

- Strict TS, repo lint clean, existing tests untouched and green.
- Hidden acceptance tests import `{ deliverBestEffortPatch, rankBestEffortCandidates }` from `src/best-effort.js`, `{ copyUntrackedIntoClone, withUntrackedArtifacts }` from `src/worker-clone.js`, and `{ closingWorkerNote, composeWorkerEvidence, settledWorkerOut, EVIDENCE_MAX_CHARS, NOTE_MAX_CHARS, VERIFY_TAIL_CHARS }` from `src/worker-evidence.js`, driving real local git repos in tmpdirs through every behavior above.
