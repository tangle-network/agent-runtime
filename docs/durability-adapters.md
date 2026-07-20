# Durability Adapters — SQL-Backed Conversation Journal

Long-horizon multi-agent conversations cannot afford to lose acknowledged work because the driver process restarted. agent-runtime's `ConversationJournal` interface lets you persist every committed turn before the runner yields `turn_end`, so a resumed run replays the same `runId` against the same journal and continues from the first un-recorded turn — zero acknowledged turns lost.

The SDK ships three implementations:

| Implementation | Persistence | When to use |
|---|---|---|
| `InMemoryConversationJournal` | Process memory only | Tests, scratch work, anything ephemeral |
| `FileConversationJournal` | JSONL on disk | Single-machine durability; CLI tools, local agents |
| `SqlConversationJournal` | Any SQL store, via `SqlAdapter` | Production: D1, postgres, sqlite, libSQL, Turso |

This doc covers the third — the production path.

## The two-piece design

`SqlConversationJournal` does not bind to a specific database driver. Instead, it talks to a `SqlAdapter` — a 2-method shim (`exec`, `query`) you implement against whichever client your fleet already uses.

```
       ┌─────────────────────────────┐
       │ SqlConversationJournal      │  ← issues schema-prefixed parameterised
       │   - migrate()               │     SQL with ? placeholders
       │   - beginRun()              │
       │   - appendTurn()            │
       │   - recordHalt()            │
       │   - loadRun()               │
       └──────────────┬──────────────┘
                      │
                      ▼
       ┌─────────────────────────────┐
       │ SqlAdapter (your shim)      │
       │   - exec(sql, params)       │  ← you write this — ~5 lines per driver
       │   - query(sql, params)      │
       └──────────────┬──────────────┘
                      │
                      ▼
              D1 / postgres / sqlite / libSQL / Turso
```

Why this shape? agent-runtime ships against Cloudflare Workers, Node, Bun and Deno. Different consumers have already standardized on different drivers. Burning a hard dependency on `pg` or `better-sqlite3` makes the SDK painful to use everywhere except the one stack that was chosen. The adapter indirection costs five lines in the consumer's code and keeps the SDK free of native deps.

## Schema

`migrate()` creates two tables with a configurable prefix (default `agent_runtime_journal`):

```sql
CREATE TABLE IF NOT EXISTS <prefix>_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  halted_kind TEXT,
  halted_payload TEXT,          -- JSON HaltReason
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS <prefix>_turns (
  run_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  payload TEXT NOT NULL,        -- JSON ConversationTurn
  PRIMARY KEY (run_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_<prefix>_turns_run
  ON <prefix>_turns (run_id, turn_index);
```

Notes:

- All timestamps are ISO-8601 strings, matching the rest of the SDK.
- `halted_payload` carries the full `HaltReason` discriminated union as JSON.
- `turn_index` is the runner's monotonic counter, not a synthetic id — replay order is `ORDER BY turn_index ASC`.
- The PK `(run_id, turn_index)` makes a duplicate `appendTurn` for the same logical turn fail loudly. This is by design: the runner's turn ids are deterministic, so a re-append is always a bug, not a retry.

## Cloudflare D1

D1 consumers get a one-line wrapper:

```ts
import {
  d1ToSqlAdapter,
  defineConversation,
  runConversation,
  SqlConversationJournal,
} from '@tangle-network/agent-runtime'

export default {
  async fetch(req: Request, env: { DB: D1Database }) {
    const journal = new SqlConversationJournal(d1ToSqlAdapter(env.DB))
    await journal.migrate()                      // idempotent; safe to call per request, fastest once at deploy

    const conv = defineConversation({ /* participants, policy */ })
    const result = await runConversation(conv, {
      runId: 'conv_abc',                         // re-using runId + journal = resume
      seed: 'hello',
      journal,
    })

    return Response.json(result)
  },
}
```

`d1ToSqlAdapter` accepts a structural type (`D1DatabaseLike`); the SDK never imports `@cloudflare/workers-types`, so the wrapper lines up via TypeScript structural compatibility.

## node-postgres (`pg`)

```ts
import { Pool } from 'pg'
import { SqlConversationJournal, type SqlAdapter } from '@tangle-network/agent-runtime'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// node-postgres uses $1, $2, … placeholders; the journal emits ?. Rewrite.
function rewritePlaceholders(sql: string): string {
  let n = 0
  return sql.replace(/\?/g, () => `$${++n}`)
}

const pg: SqlAdapter = {
  async exec(sql, params = []) {
    const r = await pool.query(rewritePlaceholders(sql), params as never[])
    return { rowsAffected: r.rowCount ?? 0 }
  },
  async query(sql, params = []) {
    const r = await pool.query(rewritePlaceholders(sql), params as never[])
    return r.rows
  },
}

const journal = new SqlConversationJournal(pg)
await journal.migrate()
```

If you'd rather not rewrite placeholders at every call, run the migrations once with a hand-translated DDL and skip `journal.migrate()`. The journal's runtime queries use `?` only for parameters, never for identifiers, so the rewrite above is correct for every statement the journal issues.

## better-sqlite3 (single-process node)

```ts
import Database from 'better-sqlite3'
import { SqlConversationJournal, type SqlAdapter } from '@tangle-network/agent-runtime'

const db = new Database('agent.db')

const sqlite: SqlAdapter = {
  async exec(sql, params = []) {
    const info = db.prepare(sql).run(...(params as unknown[]))
    return { rowsAffected: info.changes }
  },
  async query(sql, params = []) {
    return db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[]
  },
}

const journal = new SqlConversationJournal(sqlite)
await journal.migrate()
```

## libSQL / Turso

```ts
import { createClient } from '@libsql/client'
import { SqlConversationJournal, type SqlAdapter } from '@tangle-network/agent-runtime'

const client = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_TOKEN!,
})

const libsql: SqlAdapter = {
  async exec(sql, params = []) {
    const r = await client.execute({ sql, args: params as never[] })
    return { rowsAffected: Number(r.rowsAffected ?? 0) }
  },
  async query(sql, params = []) {
    const r = await client.execute({ sql, args: params as never[] })
    return r.rows as unknown as Record<string, unknown>[]
  },
}

const journal = new SqlConversationJournal(libsql)
await journal.migrate()
```

## Resuming a run

The runner replays the journal automatically.
Three values control what resumes:

1. Pass the same `runId` to `runConversation` (or `runConversationStream`).
2. Pass the same `journal` instance, or a fresh instance pointed at the same backing store.
3. Pass the same durable `RuntimeSessionStore` to continue each participant's provider session.

The package includes `InMemoryRuntimeSessionStore` for one process.
For process restarts, implement the two required `RuntimeSessionStore` methods, `get` and `put`, against the same database as your application.
The example below assumes that implementation is named `sessionStore`.

```ts
// Process A records turns 0 through 2, then exits before turn 3 starts.
await runConversation(conv, { runId: 'conv_abc', seed: 'hello', journal, sessionStore })

// Process B opens the same transcript and participant sessions.
const resumed = await runConversation(conv, {
  runId: 'conv_abc',
  seed: 'hello',
  journal,
  sessionStore,
})
```

Each committed turn records the provider session used by its speaker.
When the session exists in `sessionStore` and its backend implements `resume`, the next turn continues that provider session with only the unseen conversation turns.
Without a shared session store, the transcript still resumes, but the actor starts a new provider session with the full transcript as context.

`onEvent` receives a `conversation_resumed` event when the runner finds a non-empty journal entry, so any UI or SSE subscriber can rehydrate the existing transcript before live deltas resume.

## Operational notes

- **Run `migrate()` once at deploy.** Idempotent, but the round-trips add latency if you do it per request. The two-table schema is stable; if it changes, the SDK bumps a major.
- **Index by `run_id`** if you query the tables out-of-band (admin tooling, debugging). The migration already creates `idx_<prefix>_turns_run`.
- **Don't share a journal across multiple drivers writing the same `runId`.** The journal assumes a single writer per run. If you need multi-writer (e.g. blue/green driver swap), gate at the application layer.
- **PII in the journal.** Turn payloads contain whatever the participants said; that's user-generated content. Apply the same retention + encryption controls you apply to chat logs elsewhere in your stack.
- **Use `table` prefixes** to share a single database across multiple agent products: `new SqlConversationJournal(db, 'gtm_agent')` vs `new SqlConversationJournal(db, 'support_agent')` keeps the rows isolated without separate databases.

## Why not use a hosted store directly?

The journal could be a thin wrapper around a hosted KV (Workers KV, R2 object writes, Turso embedded replicas). Two reasons it's not:

1. **Strong reads matter.** Resume correctness depends on reading turns in committed order; eventually-consistent stores get this wrong on a hot crash-restart.
2. **The schema is small enough to model directly.** Two tables, six statements, zero ORM. Anything richer (analytics, queries across runs) is the consumer's job and lives in their own tables alongside.

If you want the simplest possible deployment, use Turso — Tangle's default — with the libSQL adapter above. Free tier covers this footprint indefinitely.

## Reference

- `src/conversation/journal-sql.ts` — `SqlAdapter`, `SqlConversationJournal`, `d1ToSqlAdapter`.
- `src/conversation/journal.ts` — `ConversationJournal` interface + `InMemoryConversationJournal` + `FileConversationJournal`.
- `src/conversation/run-conversation.ts` — how the runner uses the journal (`beginRun` → per-turn `appendTurn` → `recordHalt`).
