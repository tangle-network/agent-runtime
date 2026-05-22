/**
 * Production trace sink — the capture primitive every vertical agent's
 * chat handler wires in once.
 *
 * Until this primitive existed, eval runs captured everything and
 * production captured *nothing*. The sink closes that gap: it gives the
 * chat handler a `TraceStore` to write to during the request, then on
 * `endRun` composes a canonical `ProductionRunRecord`, persists it
 * (Drizzle / D1 / Postgres — your DB), and ships the run as OTLP to
 * Langfuse (optional). Errors are logged, never thrown.
 *
 * Run with:
 *   pnpm tsx examples/production-trace-sink/production-trace-sink.ts
 */

import { TraceEmitter } from '@tangle-network/agent-eval'
import {
  createProductionTraceSink,
  type ProductionRunRecord,
  type ProductionRunRecordStore,
} from '@tangle-network/agent-runtime/agent'

// ── 1. Your DB adapter. Real wiring: drizzleRunRecordStore(db) /
//      D1 / Postgres. Here: an in-memory array. ────────────────────────
const persisted: ProductionRunRecord[] = []
const runRecordStore: ProductionRunRecordStore = {
  async append(record) {
    persisted.push(record)
  },
}

// ── 2. The sink. Omit `otlp` to skip Langfuse forwarding; omit
//      `feedbackStore` to skip user-feedback persistence. The sink still
//      composes + persists the RunRecord. ───────────────────────────────
const sink = createProductionTraceSink({ projectId: 'demo-agent', runRecordStore })

// ── 3. One TraceEmitter per chat session — the sink's `onRunComplete`
//      hook fires once at `endRun` time. The sink's TraceStore is shared
//      across emitters so spans from all sessions accumulate in one
//      store for the request lifetime. ───────────────────────────────────
async function runChatSession(sessionId: string, pass: boolean, score: number) {
  const emitter = new TraceEmitter(sink.traceStore, { onRunComplete: [sink.onRunComplete] })
  await emitter.startRun({
    scenarioId: sessionId,
    projectId: 'demo-agent',
    layer: 'app-runtime',
  })

  // …in production the chat handler emits LLM/tool spans here as the
  // turn runs. The sink doesn't care what spans were emitted; it
  // counts them and composes the RunRecord on endRun.

  await emitter.endRun({ pass, score })
  // The sink's onRunComplete just fired — RunRecord is in the store.
}

async function main() {
  await runChatSession('session-a', true, 0.92)
  await runChatSession('session-b', false, 0.41)

  console.log(`persisted ${persisted.length} RunRecord(s):`)
  for (const r of persisted) {
    console.log(
      `  ${r.runId.slice(0, 8)} ${r.scenarioId} pass=${r.pass} score=${r.score} spans=${r.spanCount}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
