/**
 * `@tangle-network/agent-runtime/tui` — the terminal view over live supervisor runs.
 *
 * Read-only snapshots over Runtime's workspace layout or an explicit durable run directory.
 * Workspace reads remain synchronous; the `runDir` overload asynchronously verifies observer
 * history and attaches its canonical pursuit projection, including unknown accounting.
 *
 * ```ts
 * import { loadTopSnapshot } from '@tangle-network/agent-runtime/tui'
 *
 * const workspace = loadTopSnapshot(process.cwd())
 * const durable = await loadTopSnapshot(process.cwd(), { runDir: './runs/current' })
 * ```
 *
 * The runnable form is the `agent-runtime-top` bin: `agent-runtime-top <root> [--once] [--no-color]`.
 * Its `--web --root <run-dir> --assets <renderer-dist>` mode serves the same facts over HTTP/SSE.
 * Workers and supervisors expose optional epoch `lastActivityAt` and full-stream
 * `medianEventGapMs` from actual recorded events. Metadata, heartbeats and file times do not count.
 *
 * @module
 * @experimental
 */

// Braid imports the TUI entrypoint beside the kernel entrypoint. Re-export the Runtime provisioner
// here so that either public face resolves the same owner and no client invents a second wrapper.
export { provisionSupervisor } from '../runtime/supervise/provision-supervisor'
export {
  type BudgetStats,
  buildSupervisorView as projectTopSupervisor,
  type Distribution,
  isSpawnEvent as isTopJournalEvent,
  loadTopSnapshot,
  type SpendStats,
  type SupervisorState as TopSupervisorState,
  type SupervisorTotals,
  type SupervisorView,
  type TopJournalEvent,
  type TopSnapshot,
  type TopSnapshotCompleteness,
  type TopSnapshotDiagnostic,
  type TopSnapshotDiagnosticReason,
  type TopSnapshotDiagnosticSource,
  topSnapshot as projectTopSnapshot,
  type WorkerView,
} from './top-snapshot'
export {
  type BaselineAuthority,
  createTopAgentStream,
  type FileIdentity,
  type HarnessRowsGap,
  type HarnessRowsSession,
  type HarnessSessionRow,
  harnessSessionRows,
  type RecordedActivity,
  type RecordedEvents,
  readTopAgentHistory,
  readTopAgentInspection,
  type TopAgentMetadata,
  type TopAgentRowsFrame,
  type TopAgentStreamFrame,
  type TopSessionReader,
  type TopTranscriptRow,
  topAgentMetadata,
  topAgentWorker,
} from './top-transcript'
export {
  serveTopWeb,
  TOP_SNAPSHOT_RECONCILE_MS,
  type TopInspection,
  type TopInspectionSource,
  type TopSnapshotFrame,
  type TopWebOptions,
} from './top-web'
