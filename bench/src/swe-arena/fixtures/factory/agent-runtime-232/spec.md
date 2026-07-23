# Durable delegation queue — persistence port, file store, restart-honest rehydration, resume seam

## Background

The MCP delegation server keeps its task registry (`DelegationTaskQueue` in `src/mcp/task-queue.ts`, records typed as `DelegationRecord`) purely in memory: when the MCP process restarts, delegation status/history vanish and an idempotently re-submitted task re-runs. `task-queue.ts` already names a Phase-2 follow-up: make the registry survive the process. Sandbox filesystems are snapshot-persisted by products, so a file-backed store makes delegation state genuinely span conversations.

Build that follow-up. Additive only: zero behavior change for existing consumers who configure nothing; existing tests must stay untouched and green.

## Deliverable 1 — persistence port + stores (new module `src/mcp/delegation-store.ts`)

Public surface (also re-exported from `src/mcp/index.ts`):

- `DelegationStore` — async port with the operations the queue needs: load all persisted records, upsert one record, remove one record, and resolve/persist idempotency-key → taskId mappings.
- `InMemoryDelegationStore` — the default; semantics identical to today. Round-trips records, isolates stored state from caller mutation (no shared references), supports removal and idempotency resolution.
- `FileDelegationStore` — single-file JSON snapshot store:
  - A missing file is an empty store, not an error.
  - Writes are atomic (write tmp file, then rename); concurrent upserts serialize into one parseable snapshot; no tmp litter left behind.
  - Writing before an initial load is a programming error → typed `DelegationPersistenceError`.
  - Upserts and removals persist across store instances (new instance over the same path sees them).
  - Corrupt state (unparseable JSON, or valid JSON with the wrong shape) **refuses to load** with a typed `DelegationStateCorruptError` — never silently starts fresh.
  - Explicit opt-in recovery (`recoverCorrupt` behavior, wired to env `AGENT_RUNTIME_DELEGATION_STATE_RECOVER=1` in the bin): archives the corrupt file (kept on disk under a recognizable archived name) and starts empty.
- Typed errors `DelegationPersistenceError` and `DelegationStateCorruptError` exported from the same module.

## Deliverable 2 — durable mode in `DelegationTaskQueue` (`src/mcp/task-queue.ts`)

Queue options grow a `store?: DelegationStore` (default in-memory, unchanged behavior) plus:

- **Restore/rehydration** (a `restore()` step a fresh queue instance runs over the store):
  - Terminal records (completed/failed/cancelled) become queryable again: status and history visible to the fresh instance.
  - The idempotency index rebuilds: re-submitting a previously-seen idempotency key returns the prior taskId and terminal state **without re-running** the delegate (`hashIdempotencyInput` unchanged).
  - Records that were in-flight when the previous driver died must not pretend to be running: settle them as failed with a truthful error whose `error.kind` is `'DriverRestartError'` — **unless** the record carries a `detachedSessionRef` (see resume seam).
  - `restore()` rejects with `DelegationStateCorruptError` over a corrupt state file.
- **Resume seam**: a `DelegationResumeDriver` interface (a `tick`-style driver the queue polls to re-drive a detached session to completion, designed to map 1:1 onto the sandbox SDK's turn-drive result). Behavior:
  - A restored in-flight record with a `detachedSessionRef` and a configured resume delegate is resumed through the driver (the driver sees the ref) and settles with the driver's outcome.
  - With a `detachedSessionRef` but **no** resume delegate configured, the record settles failed truthfully (no resurrection).
  - A driver tick that throws settles the record as failed.
  - `cancel()` aborts an in-progress resume loop.
- **Retention**: a `maxTerminalRecords` cap evicts the oldest terminal records beyond the cap, both in memory and in the persisted file. A non-positive cap is rejected loudly at construction.
- **Fail loud on persistence loss**: after a store write failure the queue refuses further submissions (surfacing `DelegationPersistenceError`) rather than degrading to memory-only.

## Deliverable 3 — wiring (`src/mcp/bin.ts`)

- Opt-in via env `AGENT_RUNTIME_DELEGATION_STATE_FILE=<path>` → the bin constructs the queue over a `FileDelegationStore` at that path; `AGENT_RUNTIME_DELEGATION_STATE_RECOVER=1` enables corrupt-state recovery. Nothing set → in-memory, exactly today's behavior.

## Acceptance

- `pnpm typecheck`, lint, and the full existing test suite stay green.
- Hidden acceptance tests import `{ DelegationPersistenceError, DelegationStateCorruptError, FileDelegationStore, InMemoryDelegationStore, type DelegationStore }` from `src/mcp/delegation-store` and `{ DelegationTaskQueue, hashIdempotencyInput, type DelegationResumeDriver }` plus `type DelegationRecord` from `src/mcp/task-queue`, and exercise every behavior above with real tmpdir files (atomicity, cross-instance persistence, corrupt-state refusal and recovery, restart-honest settlement, detached resume, dedupe-across-restart, eviction, write-failure lockout).
