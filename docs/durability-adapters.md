# Interaction Journals

`runInteraction` can resume named actors and completed turns after a process restart.
Persistence is supplied through `InteractionJournal`.

| Implementation | Use |
|---|---|
| `InMemoryInteractionJournal` | Tests and disposable runs |
| `FileInteractionJournal` | One process or machine using an append-only JSONL file |
| `SqlInteractionJournal` | Shared production storage |

## Resume Contract

A durable interaction requires:

- a stable `runId` for the logical run;
- a stable `definitionId` for actor profiles, providers, and policy functions;
- a journal shared by every process that may resume the run.

```ts
const result = await runInteraction({
  runId: 'review-42',
  definitionId: 'sha256:9a3f...',
  journal,
  actors,
  prompt,
  policy: { maxTurns: 8, turnOrder: 'alternate' },
})
```

Runtime persists each actor's provider, environment ID, and session ID.
It persists a turn before emitting `turn_end`.
On restart it reattaches to those environments and continues at the first missing turn.
A changed `definitionId`, conflicting duplicate write, missing environment, malformed row, or non-contiguous turn history fails.

## SQL

`SqlInteractionJournal` uses a small driver-neutral `SqlAdapter`:

```ts
interface SqlAdapter {
  exec(sql: string, params?: readonly unknown[]): Promise<{ rowsAffected: number }>
  query<Row>(sql: string, params?: readonly unknown[]): Promise<Row[]>
}
```

Create the tables once before serving traffic:

```ts
import { SqlInteractionJournal } from '@tangle-network/agent-runtime/interaction'

const journal = new SqlInteractionJournal(databaseAdapter)
await journal.migrate()
```

The optional table prefix accepts only SQL identifier characters.
The default is `agent_runtime_interaction`.
Three tables store runs, actors, and ordered turns.

The journal accepts an exact duplicate write, which makes a retried request safe.
It rejects the same key with different content.
Finishing a run uses a conditional update so two processes cannot publish different stop results.

## Cloudflare D1

```ts
import {
  SqlInteractionJournal,
  d1SqlAdapter,
} from '@tangle-network/agent-runtime/interaction'

const journal = new SqlInteractionJournal(d1SqlAdapter(env.DB))
await journal.migrate()
```

## Other Databases

Wrap the database client's parameterized execute and query methods.
Do not interpolate values into SQL.
The adapter must report affected rows accurately because the journal uses that count to detect write races.

## Scope

An interaction journal stores a fixed set of actors taking turns.
It does not store a dynamic supervisor tree, application messages, user accounts, or provider event streams.
Use the supervisor spawn journal for dynamic worker trees and application storage for product data.
