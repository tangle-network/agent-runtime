# SQL run context

Use the same SQL database, table prefix, run ID, graph and original input on each orchestrator.
No run directory, local journal or copied orchestration files are required:

```ts
import { createSqlRunContext, runGraph } from '@tangle-network/agent-runtime/kernel'

const runContext = await createSqlRunContext(adapter, 'customer-run-123')
const result = await runGraph(graph, {
  runContext,
  backend: { backend: 'provider', provider: retainedProvider },
  router,
})
```

The existing `SqlAdapter` stays unchanged (`exec` and `query`, with `?` parameters). It must
execute each statement as an atomic durable autocommit and read consistently from the writer,
not an asynchronously lagging replica. A PostgreSQL adapter must translate placeholders, as
for the existing SQL conversation journal. No transaction is assumed to span adapter calls.

## Publication and ownership

Two tables contain a per-run head and immutable records. A write first stages a content-addressed
record, then atomically updates the head **on the same row that owns the lease**, conditional on
owner UUID, generation and previous head/revision. That update is the publication boundary.
An orphan stage is unreachable and never replayed. A lost update acknowledgement is reconciled
against its committed head. Replay follows and validates the immutable parent chain.

This rejects the tempting `INSERT … SELECT … WHERE owner = ?` design: a database with snapshot
reads could let that statement use an owner snapshot older than a takeover. A pooled adapter
also cannot promise that separate `BEGIN` and `COMMIT` calls use one connection. Updating the
ownership row itself provides the required serialization without expanding `SqlAdapter`.

A contender observes the owner's generation and progress counter, waits the recorded lease
interval, then attempts a compare-and-set against exactly that observation. Heartbeats and
publications advance the counter. A changing live owner is refused; a stopped owner can be
replaced by only one contender. The stored lease interval prevents a contender shortening it.
No comparison of wall clocks across hosts is required. Defaults are a 30-second lease and a
heartbeat every 10 seconds; tests use 400/60 milliseconds. SQL availability and timely timers
are prerequisites for retaining ownership. Losing ownership aborts the run and fences writes.
Each acquisition returns fresh immutable store capabilities; an old capability cannot write
or release a successor. Ownership spans replay, the entire graph and its final journal flush.

Root spawn/materialization and child spawn/exact-input events publish as atomic groups.
Referenced blobs are committed first. A crash can leave an unused blob, never an event whose
input/output bytes were not durable. Existing file/custom journals use the same ordered calls
through the optional batch fallback; their layout and default selection are unchanged.
Coordination reuses the file log's replay fold, including owner filtering and delivery evidence.

## External effects and supported execution

The SQL path requires backend-derived **retained provider workers**, idempotent turns, replay,
and lookup of retained environments. It refuses custom leaf/worker factories, non-provider
backends, and remote/custom root drivers rather than silently promising recovery they cannot
supply. The coordinator itself is local to the owning process. Resume uses the original task,
profile, provider admission and execution key; a worker interrupted before admission can safely
enter that same protocol because no provider call precedes the committed intent.

SQL does not make an arbitrary unkeyed external call exactly once. Providers must durably honor
Runtime's existing admission/turn idempotency contracts, including after an acknowledgement is
lost. Extra tools must likewise use durable idempotency keys at the effect destination. The
conformance fixture deliberately commits the external keyed effect before killing the caller.
Unknown or corrupt external evidence is refused, not replaced with a fresh worker key.
Already-issued remote calls require the provider's deduplication/fencing; the SQL fence governs
orchestration records, not arbitrary external processes. Do not equate lease expiry with proof
that an old machine can no longer send network traffic.

## Proof and overhead

The tests-first commit is `cc236571f11fd368849ec94177326edec68deb24`. Its GitHub Actions log
records `ERR_MODULE_NOT_FOUND` for the absent implementation. The original temporary shell
pipeline masked that nonzero exit behind `tee`; its green job status was not a passing test.

```sh
pnpm exec vitest run tests/durability/sql-run-context.test.ts \
  tests/durability/sql-run-store.test.ts tests/durability/sql-context-stores.test.ts
pnpm exec vitest run tests/durability/graph-rundir-journal.test.ts \
  tests/durability/graph-kill-resume.test.ts tests/durability/conversation-kill-resume.test.ts \
  tests/durability/known-defects.test.ts
```

The SQL matrix kills actual child processes at 26 boundaries, including SQL commit before its
acknowledgement, provider admission/dispatch and keyed final effects. A two-live-process case
refuses the contender, kills the owner, then lets that **same contender process** take over.
Assertions require the same output, three original workers, no in-doubt workers or replacement
keys, one root/materialization, unique root attempts/cursor positions, three physical provider
creates/dispatches, and one final external effect. Each host has its own empty working directory;
the first host's directory is removed before resume. Shared state is SQL and the independent
retained-provider service fixture, never an orchestration journal on the filesystem.

Storage tests cover orphan stages, lost acknowledgements, an explicit stage/takeover/publication
interleaving, immutable capabilities, shared policy, atomic group rejection, and owner-scoped
coordination. The overhead assertion measures 100 queued publications: 200 SQL writes, zero
history reads on the append path, excluding initialization and periodic heartbeat. Resume reads
and validates history linearly; the active process keeps its projection in memory. No background
compaction, garbage collector, new scheduler or dependency is introduced.

These fixtures use real SQLite and independent processes, not a mock SQL interpreter. They do
not establish network-database latency, PostgreSQL/D1 integration, arbitrary partition behavior,
or execution on two physical machines. Run those deployment-specific checks against the actual
adapter/provider before claiming them.
