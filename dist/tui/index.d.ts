import { Ct as ProvisionSupervisorConnection, Dt as provisionSupervisor, Et as SupervisorCleanupReceipt, Tt as ProvisionedSupervisor, wt as ProvisionSupervisorRequest } from "../index-Dm8SHDGW.js";
//#region src/tui/top-app.d.ts
/**
 * The interactive side of the supervisor-run TUI: a keypress/mouse loop over the frames
 * `./top-model` renders, plus the operator controls that write back to the run — steer a live
 * worker, cancel one worker, and request cancellation of a whole run.
 *
 * The controls go through the owned run layout: steers via `writeWorkerSteer` (the durable inbox
 * append) and worker cancellation via `cancelWorker` (the acknowledged operation the runtime's
 * turn loop applies). Run-level cancellation targets the ROOT, which has no acknowledged runtime
 * path yet for a non-retained tree — it stays a `cancel.request.json` write inside the run
 * directory for a host process to honor. Nothing here joins a path from the workspace root.
 *
 * Extracted from the `loops` repo (`src/top.ts`). The module-level singletons are the origin's
 * shape and are kept: this drives one terminal, and `runTopApp` is its one entry point.
 *
 * @experimental
 */
/** @experimental How the app was invoked. Defaults read `process.argv` / `process.cwd()`. */
interface TopAppOptions {
  readonly argv?: readonly string[];
  readonly cwd?: string;
}
/**
 * Render exactly one frame and return it. This is the non-interactive path — `--once`, a pipe, a
 * test — so it never touches raw mode, the alternate screen, or `process.exit`.
 */
declare function renderTopOnce(options?: TopAppOptions): string;
/**
 * Run the TUI. With a TTY on both ends and no `--once` this takes over the terminal until `q`;
 * otherwise it writes a single frame to stdout and returns.
 */
declare function runTopApp(options?: TopAppOptions): void;
//#endregion
//#region src/tui/top-model.d.ts
/**
 * The read side of the supervisor-run TUI: turn the on-disk run layout into one `TopSnapshot`, and
 * render that snapshot to an ANSI frame.
 *
 * This module never derives a run path itself. Every directory and per-worker file it reads comes
 * from `../runtime/supervise/run-layout` — the same module the writers use — so the reader cannot
 * drift from the layout the way an independently-versioned copy of the contract would.
 *
 * Extracted from the `loops` repo (`src/top-model.ts`), which held a hand-joined copy of the
 * layout. Rendering is deliberately unchanged: raw ANSI, zero dependencies.
 *
 * This is the OPERATOR view: what is on disk right now, for a human watching a workspace. It
 * carries no model-call identity, so its per-supervisor totals cannot be joined with root stream
 * events without double counting. A client that needs one execution's totals reads
 * `projectPursuit` from `../durable` instead.
 *
 * @experimental
 */
interface TopSnapshot {
  readonly root: string;
  readonly generatedAt: number;
  readonly supervisors: SupervisorView[];
  /** `partial` when at least one discovered source could not be read completely. */
  readonly completeness: TopSnapshotCompleteness;
  /** One bounded entry per skipped or partially read source; empty when complete. */
  readonly diagnostics: ReadonlyArray<TopSnapshotDiagnostic>;
  /** Run directories found under the runs roots, readable or not. */
  readonly discovered: number;
  /** Run directories whose state.json parsed into a valid supervisor view. */
  readonly loaded: number;
}
type TopSnapshotCompleteness = 'complete' | 'partial';
type TopSnapshotDiagnosticSource = 'supervisor-state' | 'journal' | 'progress' | 'worker-tail';
type TopSnapshotDiagnosticReason = 'unreadable' | 'partial-json' | 'invalid-state' | 'missing';
/**
 * One skipped or partially read snapshot source. `path` is relative to the run directory and
 * never carries file contents, so a diagnostic is safe to show or log without leaking run data.
 */
interface TopSnapshotDiagnostic {
  readonly source: TopSnapshotDiagnosticSource;
  readonly runId?: string;
  readonly path: string;
  readonly reason: TopSnapshotDiagnosticReason;
}
interface SupervisorBase {
  readonly id: string;
  readonly status: string;
  readonly task: string;
  readonly workspaceDir: string;
  readonly budget: number;
  readonly verifyCmd?: string;
  readonly workerModel?: string;
  readonly driverModel?: string;
  readonly verdict?: string;
  readonly progress?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly maxSandboxes?: number;
  readonly maxLifetimeSeconds?: number;
  readonly idleTimeoutSeconds?: number;
  readonly maxUsd?: number;
  readonly maxDepth?: number;
}
interface SupervisorView extends SupervisorBase {
  readonly stateDir: string;
  readonly resultSpentUsd?: number;
  readonly resultSpentTokens?: number;
  readonly workers: WorkerView[];
  readonly progressTail: string[];
  readonly journalTail: TopJournalEvent[];
  readonly driverSpend: SpendStats;
  readonly totals: SupervisorTotals;
}
interface WorkerView {
  readonly id: string;
  readonly label: string;
  readonly eventFile?: string;
  readonly parent?: string;
  readonly runtime?: string;
  readonly status: 'running' | 'done' | 'down' | 'cancelled';
  readonly verdict?: string;
  readonly infra?: boolean;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly latencyMs: number;
  readonly budget?: BudgetStats;
  readonly spend: SpendStats;
  readonly metered: SpendStats;
  readonly liveTail: string[];
  readonly outRef?: string;
  readonly reason?: string;
}
interface SupervisorTotals {
  readonly workers: number;
  readonly running: number;
  readonly done: number;
  readonly down: number;
  readonly cancelled: number;
  readonly inFlight: number;
  readonly settled: number;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly tokensTotal: number;
  readonly usd: number;
  readonly latencyMs: number;
  readonly workerLatency: Distribution;
}
interface Distribution {
  readonly n: number;
  readonly min: number;
  readonly median: number;
  readonly p90: number;
  readonly max: number;
}
interface BudgetStats {
  readonly maxIterations?: number;
  readonly maxTokens?: number;
  readonly maxUsd?: number;
}
interface SpendStats {
  readonly iterations: number;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly usd: number;
  readonly ms: number;
}
type TopJournalEvent = {
  readonly kind: 'spawned';
  readonly id: string;
  readonly parent?: string;
  readonly label?: string;
  readonly budget?: unknown;
  readonly runtime?: string;
  readonly seq?: number;
  readonly at?: string;
} | {
  readonly kind: 'settled';
  readonly id: string;
  readonly status?: string;
  readonly outRef?: string;
  readonly verdict?: unknown;
  readonly spent?: unknown;
  readonly infra?: boolean;
  readonly seq?: number;
  readonly at?: string;
} | {
  readonly kind: 'cancelled';
  readonly spent?: unknown;
  readonly id: string;
  readonly reason?: string;
  readonly seq?: number;
  readonly at?: string;
} | {
  readonly kind: 'metered';
  readonly id: string;
  readonly spend?: unknown;
  readonly accountingOnly?: boolean;
  readonly seq?: number;
  readonly at?: string;
} | {
  readonly kind: 'progress';
  readonly id: string;
  readonly spend?: unknown;
  readonly seq?: number;
  readonly at?: string;
};
interface RenderOptions {
  readonly width?: number;
  readonly height?: number;
  readonly color?: boolean;
  readonly selectedSupervisorId?: string;
  readonly selectedWorkerId?: string;
  readonly focus?: 'supervisors' | 'workers';
  readonly mode?: 'overview' | 'detail' | 'log';
  readonly notice?: string;
  readonly steerInput?: {
    readonly active: boolean;
    readonly value: string;
    readonly workerLabel?: string;
  };
}
interface RenderTarget {
  readonly row: number;
  readonly kind: 'supervisor' | 'worker';
  readonly id: string;
  readonly supervisorId?: string;
}
interface RenderedTopFrame {
  readonly frame: string;
  readonly targets: RenderTarget[];
}
/**
 * Read every supervisor run under one workspace into a single point-in-time snapshot.
 *
 * Pure with respect to the process: it only reads, and it never throws for a writer mid-append.
 * An unreadable or half-written source is still skipped — an operator view must survive a live
 * writer — but every skip is reported as one bounded `TopSnapshotDiagnostic`, so a client can
 * tell a removed run from a partial read. `now` is injectable so elapsed time is deterministic
 * under test.
 */
declare function loadTopSnapshot(rootDir: string, now?: number): TopSnapshot;
/** Render one snapshot to an ANSI frame. Use this when nothing needs to be clickable. */
declare function renderTopFrame(snapshot: TopSnapshot, options?: RenderOptions): string;
/**
 * Render one snapshot, returning the frame together with the row→entity map a mouse click resolves
 * against. The layout is the only thing that knows which row is which run or worker, so emitting it
 * alongside the text is what keeps click handling out of the renderer.
 */
declare function renderTopFrameWithLayout(snapshot: TopSnapshot, options?: RenderOptions): RenderedTopFrame;
//#endregion
export { type BudgetStats, type Distribution, type ProvisionSupervisorConnection, type ProvisionSupervisorRequest, type ProvisionedSupervisor, type RenderOptions, type RenderTarget, type RenderedTopFrame, type SpendStats, type SupervisorBase, type SupervisorCleanupReceipt, type SupervisorTotals, type SupervisorView, type TopAppOptions, type TopJournalEvent, type TopSnapshot, type TopSnapshotCompleteness, type TopSnapshotDiagnostic, type TopSnapshotDiagnosticReason, type TopSnapshotDiagnosticSource, type WorkerView, loadTopSnapshot, provisionSupervisor, renderTopFrame, renderTopFrameWithLayout, renderTopOnce, runTopApp };
//# sourceMappingURL=index.d.ts.map