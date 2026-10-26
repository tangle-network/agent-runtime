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
 *
 * @module
 * @experimental
 */

// Braid imports the TUI entrypoint beside the kernel entrypoint. Re-export the Runtime provisioner
// here so that either public face resolves the same owner and no client invents a second wrapper.
export { provisionSupervisor } from '../runtime/supervise/provision-supervisor'
export {
  type BudgetStats,
  type Distribution,
  loadTopSnapshot,
  type SpendStats,
  type SupervisorTotals,
  type SupervisorView,
  type TopJournalEvent,
  type TopSnapshot,
  type TopSnapshotCompleteness,
  type TopSnapshotDiagnostic,
  type TopSnapshotDiagnosticReason,
  type TopSnapshotDiagnosticSource,
  type WorkerView,
} from './top-snapshot'
