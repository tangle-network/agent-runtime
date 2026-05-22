/**
 * The durable-runs SQL schema as a string constant. Inlined so consumers
 * (Cloudflare Workers via D1) can apply it without bundling a `.sql` file:
 *
 *   import { DURABLE_SCHEMA_SQL } from '@tangle-network/agent-runtime'
 *   await env.DB.exec(DURABLE_SCHEMA_SQL)
 *
 * The canonical source is `src/durable/schema.sql` — this string MUST stay
 * byte-identical to it. The build does not copy `.sql` files into `dist/`,
 * so the constant is the only path consumers have. A unit test asserts the
 * two stay in sync (`durable-schema.test.ts`).
 *
 * `DURABLE_SCHEMA_VERSION` reflects the latest migration version applied by
 * this string. Bump it on every backwards-incompatible change AND add a new
 * migration entry to durable_schema_info instead of mutating prior rows.
 */

export const DURABLE_SCHEMA_VERSION = 2

export const DURABLE_SCHEMA_SQL = `-- Durable-run substrate — versioned schema for D1 / SQLite.
--
-- Apply once per database. Subsequent migrations append; never rewrite a
-- prior version. See \`durable_schema_info\` for the migration trail.
--
-- Concurrency notes for D1:
--   - SQLite supports UNIQUE constraints for first-emit-wins (\`durable_events\`
--     PK is (run_id, key) — duplicate insert raises, caller treats as "already
--     emitted").
--   - Lease takeover happens via a conditional UPDATE: we only claim the lease
--     if (lease_holder_id IS NULL OR lease_expires_at < :now) — atomic under
--     SQLite's row-level locking.
--   - All timestamps stored as ISO-8601 TEXT for cross-platform consistency.
--   - \`result_json\` / \`error_json\` / \`outcome_json\` / \`payload_json\` are
--     JSON-encoded TEXT; the application enforces canonical-JSON discipline at
--     the boundary so the store stays type-agnostic.

CREATE TABLE IF NOT EXISTS durable_schema_info (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS durable_runs (
  run_id           TEXT    PRIMARY KEY,
  manifest_hash    TEXT    NOT NULL,
  project_id       TEXT    NOT NULL,
  scenario_id      TEXT,
  status           TEXT    NOT NULL CHECK (status IN ('pending','running','completed','failed','suspended')),
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  completed_at     TEXT,
  lease_holder_id  TEXT,
  lease_expires_at TEXT,
  outcome_json     TEXT,
  step_count       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_durable_runs_project_status ON durable_runs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_durable_runs_lease_expires ON durable_runs(lease_expires_at);

CREATE TABLE IF NOT EXISTS durable_steps (
  run_id       TEXT    NOT NULL,
  step_index   INTEGER NOT NULL,
  intent       TEXT    NOT NULL,
  kind         TEXT    NOT NULL,
  input_hash   TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  result_json  TEXT,
  error_json   TEXT,
  started_at   TEXT,
  completed_at TEXT,
  PRIMARY KEY (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_durable_steps_status ON durable_steps(run_id, status);

CREATE TABLE IF NOT EXISTS durable_events (
  run_id     TEXT NOT NULL,
  key        TEXT NOT NULL,
  payload_json TEXT,
  emitted_at TEXT NOT NULL,
  PRIMARY KEY (run_id, key)
);

INSERT OR IGNORE INTO durable_schema_info (version, applied_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ── Migration v2 — durable event-stream log + run handle ───────────────
-- Run once on a database created at v1. \`ALTER TABLE\` is not idempotent; the
-- version trail in \`durable_schema_info\` is how migrations are sequenced —
-- never by blind re-execution of this block.
--
--   - \`durable_stream_events\` is the ordered, replayable per-run event log.
--     \`seq\` is the store-assigned monotonic cursor; the UNIQUE index on
--     (run_id, event_id) makes appends idempotent — a reconnecting adapter
--     that re-yields a boundary event cannot double-log it.
--   - \`durable_runs.handle_json\` is the pointer (sandbox + substrate run id +
--     cursor) a fresh supervisor re-attaches by.

ALTER TABLE durable_runs ADD COLUMN handle_json TEXT;

CREATE TABLE IF NOT EXISTS durable_stream_events (
  run_id       TEXT    NOT NULL,
  seq          INTEGER NOT NULL,
  event_id     TEXT    NOT NULL,
  payload_json TEXT,
  appended_at  TEXT    NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_stream_events_event_id
  ON durable_stream_events(run_id, event_id);

INSERT OR IGNORE INTO durable_schema_info (version, applied_at)
VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`
