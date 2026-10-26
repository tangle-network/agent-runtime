import { resolve } from 'node:path'
import { runtimeFailureCause } from '../runtime/failure-cause'
import {
  type AgentGraph,
  type GraphResult,
  type RunGraphOptions,
  superviseAgentGraph,
} from '../runtime/supervise/graph'
import { graphExecutionOptions } from '../runtime/supervise/graph-backend'
import { readRootStreamReceipt } from '../runtime/supervise/root-stream'
import { supervisorRunDir } from '../runtime/supervise/run-layout'
import { RunParkedError } from '../runtime/supervise/run-parking'
import { type SuperviseOptions, supervise } from '../runtime/supervise/supervise'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import type { SupervisedResult } from '../runtime/supervise/types'
import { errorMessage } from '../runtime/util'
import {
  composeRuntimeHooks,
  type RuntimeHookEvent,
  type RuntimeHooks,
  withPursuitContext,
} from '../runtime-hooks'
import { createFileObserverHooks, type FileObserverJournal } from './observer-journal'
import { type PursuitProjection, projectPursuit } from './observer-projection'
import {
  type PursuitObserverDeliverer,
  type PursuitObserverDelivery,
  startPursuitObserverDelivery,
} from './pursuit-observer-delivery'
import {
  type PursuitVersionChain,
  type PursuitVersions,
  runPursuitVersions,
} from './pursuit-versions'
import { type PursuitFork, prepareRunFork } from './run-fork'
import { acquireRunDirectoryLock } from './run-lock'
import { assertRunReopen, type RunReopen, reopenSettledRun } from './run-reopen'
import {
  FAILURE_RECORD_FILE,
  readSettleRecord,
  SETTLE_RECORD_FILE,
  SettledRunDirectoryError,
  writeFailureRecord,
  writeSettleRecord,
} from './settle-record'

export interface SupervisePursuitOptions extends SuperviseOptions {
  /** Stable objective identity spanning concrete Runtime runs. */
  readonly pursuitId: string
  /**
   * One concrete Runtime execution owns one durable directory and observer journal.
   * A pursuit spanning several runs reuses `pursuitId` across distinct `runDir`s;
   * Intelligence joins those isolated projections without a shared write head.
   */
  readonly runDir: string
  /**
   * Always `'release'`. A settle record is written once per segment and refuses re-entry, so no
   * later call resumes a settled pursuit unless an explicit `reopen` archives it; nothing else
   * would release the provider environments its retained children hold. `'keep'` is refused
   * rather than ignored.
   */
  readonly retainedAtSettlement?: 'release'
  /**
   * Run this pursuit as a version of a settled run: `profile`, `task` and `budget` must equal the
   * parent's recorded root, and Runtime executes the parent's profile with `fork.change` applied.
   * The root's `execution.correlation` records the parent, its sealed digest, the change and the
   * lineage (`RUN_FORK_CORRELATION_KEYS`). The fork's `runDir` must lie outside the parent's, and
   * the parent's outside it. The parent's directory is never written, and a refused fork, such as
   * one whose parent has an uncertain node, writes nothing.
   */
  readonly fork?: PursuitFork
  /**
   * Continue this pursuit across versions, on Eval's search kernel. The first version runs at
   * `runDir` as usual, or is read back when that directory already settled. After each version
   * settles, `versions.judge` scores it from outside its tree; unless `versions.stop` ends the
   * chain, the next version forks from the version the chain keeps with the change
   * `versions.next` returns, at `<runDir>.v<n>` with run id `<runId>.v<n>`. The search ledger at
   * `<runDir>.search/ledger.jsonl` records every version as a node, every change as an edge, and
   * every run and verdict as a cell; it is the chain's only record and checkpoint. A call on a
   * closed chain reads it back; a call on an open chain continues it without re-running or
   * re-judging a settled version. Aborting `signal` pauses the chain: the call rejects and a later
   * call continues it. The call returns the kept version's result with the chain.
   */
  readonly versions?: PursuitVersions
  /**
   * Deliver this run's observer projection to Intelligence at start, every `intervalMs` while it
   * runs, and at settlement or failure, so the run is findable by its pursuit id from wherever it
   * was started. Optional and fail-open: a delivery that fails is reported once and never changes
   * the run. Each version of a `versions` chain delivers its own run under the same pursuit.
   */
  readonly observerDelivery?: PursuitObserverDelivery
  /**
   * Reopen this settled run under its own run id instead of refusing it (`./run-reopen.ts`).
   * Under the directory lock, `result.json` is archived byte for byte to `settles/<n>.json`, one
   * `reopened` journal row names the operator and reason, the run's settled cancel operation is
   * moved aside, and the run resumes from its journal (`resume: true`): settled children replay by
   * key and spend from before the reopen is debited once. `reopen.budget`, when set, replaces the
   * call's `budget` and is recorded for later resumes. Refused with `fork` or `versions`, and on a
   * directory with no `result.json` ("nothing to reopen; resume it"); a reopen whose budget or
   * reservation policy the recorded run refuses ("resume budget mismatch") writes nothing.
   */
  readonly reopen?: RunReopen
}

export interface SupervisedPursuitResult<Result> {
  readonly result: Result
  readonly pursuit: PursuitProjection
  readonly observerPath: string
  /** `result.json` in the run directory: `result` as canonical JSON, written once at settle. */
  readonly settlePath: string
  /** The version chain, when the call set `versions`. */
  readonly versions?: PursuitVersionChain
}

/** A failed Runtime execution whose complete third-person projection was retained. */
export class SupervisePursuitError extends Error {
  readonly pursuit: PursuitProjection
  readonly observerPath: string
  /** `failure.json` in the run directory: the record of this throw. */
  readonly failurePath: string

  constructor(
    cause: unknown,
    pursuit: PursuitProjection,
    observerPath: string,
    failurePath: string,
  ) {
    super(`supervisePursuit: ${errorMessage(cause)}`, { cause })
    this.name = 'SupervisePursuitError'
    this.pursuit = pursuit
    this.observerPath = observerPath
    this.failurePath = failurePath
  }
}

/**
 * One-call durable pursuit execution over the canonical `supervise()` kernel.
 *
 * This is an adapter, not a second executor: it composes a durable third-person
 * observer into Runtime's existing recursive hook stream and then rebuilds the
 * operator projection after the same `supervise()` call settles. Agents never
 * receive the observer path or projection and their behavior does not depend on it.
 *
 * Every concrete execution writes only inside its own `runDir`. Cross-run pursuit
 * aggregation is therefore lock-free at the observer layer: reuse `pursuitId` across
 * run directories and let Intelligence join the independently verified projections.
 *
 * The directory's terminal state is recorded beside `observer.jsonl`: `result.json` holds the
 * returned result once the run settles and `failure.json` the most recent throw. A directory
 * whose `result.json` exists refuses re-entry before any compute; a failure record alone does
 * not, because a caller can correct its input and drive the same run again. For the life of the
 * call the directory is held by `supervise.lock`, so a second process on the same directory
 * refuses and names the holder instead of sharing one journal.
 * An abandoned `supervise.lock.guard` requires removal after confirming no lock mutation is active.
 */
export async function supervisePursuit(
  profile: SupervisorProfile,
  task: unknown,
  opts: SupervisePursuitOptions,
): Promise<SupervisedPursuitResult<Awaited<ReturnType<typeof supervise>>>> {
  assertPursuitDirectory(opts, 'supervisePursuit')
  if (opts.reopen !== undefined) assertRunReopen(opts.reopen, opts)

  if (opts.versions !== undefined) {
    return runPursuitVersions(
      profile,
      task,
      opts as SupervisePursuitOptions & { readonly versions: PursuitVersions },
      supervisePursuit,
    ) as Promise<SupervisedPursuitResult<Awaited<ReturnType<typeof supervise>>>>
  }

  const {
    pursuitId: _pursuitId,
    hooks: _hooks,
    fork,
    versions: _versions,
    observerDelivery: _observerDelivery,
    reopen,
    ...superviseOptions
  } = opts

  // A fork is verified on every entry, a resume included, so the recorded root identity it
  // derives is the one the Supervisor's resume contract compares against. It reads only the
  // settled parent, and runs before the lock so a refused fork writes nothing, not even runDir.
  const forked =
    fork === undefined ? undefined : await prepareRunFork(profile, task, superviseOptions, fork)

  return runDurablePursuit(
    opts,
    ({ hooks, steerDir }) =>
      supervise(forked?.profile ?? profile, task, {
        ...superviseOptions,
        ...(forked === undefined ? {} : { execution: forked.execution }),
        ...(reopen === undefined
          ? {}
          : { resume: true, ...(reopen.budget === undefined ? {} : { budget: reopen.budget }) }),
        steerDir,
        // The settle record written at settlement makes this settlement final, so the
        // environments a retained child holds are released at the barrier instead of kept for a
        // resume that the record will refuse (18 of a 60-slot fleet held 19
        // to 37 hours).
        retainedAtSettlement: 'release',
        hooks,
      }),
    (result) => result,
    reopen === undefined
      ? undefined
      : (observer) =>
          reopenSettledRun({
            runDir: opts.runDir.trim(),
            runId: opts.runId ?? 'supervise',
            reopen,
            journal: opts.journal,
            limits: {
              budget: opts.budget,
              ...(opts.reservationPolicy === undefined
                ? {}
                : { reservationPolicy: opts.reservationPolicy }),
            },
            observer,
            pursuitId: opts.pursuitId.trim(),
            now: opts.now ?? Date.now,
          }),
  )
}

/** Options for {@link superviseGraphPursuit}: every `runGraph` option, plus the pursuit identity,
 *  the run directory this execution owns, and optional observer delivery. */
export interface SuperviseGraphPursuitOptions extends RunGraphOptions {
  /** Stable objective identity spanning concrete Runtime runs. */
  readonly pursuitId: string
  /** The directory this execution owns: journal, blobs, observer journal, lock and terminal
   *  records. Re-running the same `runDir` and `runId` resumes an unsettled graph; a settled
   *  graph requires an explicit `reopen`. */
  readonly runDir: string
  /** Always `'release'`: a reopened segment reuses its journal, not retired environments. */
  readonly retainedAtSettlement?: 'release'
  /** As for {@link supervisePursuit}. */
  readonly observerDelivery?: PursuitObserverDelivery
  /** Explicitly reopen a settled segment under this graph's existing run id and journal. */
  readonly reopen?: RunReopen
}

/**
 * One-call durable execution of an `AgentGraph`: the graph twin of {@link supervisePursuit}.
 *
 * It owns the run directory exactly as `supervisePursuit` does — `supervise.lock` for the life of
 * the call, `observer.jsonl`, `result.json` once the graph settles, `failure.json` for the most
 * recent throw, and refusal of a settled directory before any compute — and runs the graph through
 * `runGraph`'s own path, so the root node is a `supervise()` root and a restarted process resumes
 * the graph from its spawn journal. `result.json` holds the graph's supervised result, the same
 * record every supervised run leaves; the edge ledger is the journal's `edge` events and the
 * returned `result.ledger`. Version chains and forks are `supervisePursuit` features and are not
 * offered here. An explicit `reopen` uses the same archived-settle and resume contract as
 * `supervisePursuit`; ordinary re-entry of a settled graph stays refused.
 */
export async function superviseGraphPursuit(
  graph: AgentGraph,
  opts: SuperviseGraphPursuitOptions,
): Promise<SupervisedPursuitResult<GraphResult>> {
  assertPursuitDirectory(opts, 'superviseGraphPursuit')
  if (opts.reopen !== undefined) assertRunReopen(opts.reopen, {})
  const {
    pursuitId: _pursuitId,
    hooks: _hooks,
    observerDelivery: _observerDelivery,
    brain,
    reopen,
    ...graphOptions
  } = opts
  return runDurablePursuit(
    opts,
    ({ hooks, steerDir }) =>
      superviseAgentGraph(
        reopen?.budget === undefined ? graph : { ...graph, budget: reopen.budget },
        graphExecutionOptions({
          ...graphOptions,
          // The lock, the settle record and the journal name one run, so the graph takes the
          // directory's run id rather than its own digest-derived default.
          runId: graphOptions.runId ?? 'supervise',
          ...(reopen === undefined ? {} : { resume: true }),
          steerDir,
          retainedAtSettlement: 'release',
          hooks,
        }),
        brain,
      ),
    (result) => result.result,
    reopen === undefined
      ? undefined
      : (observer) =>
          reopenSettledRun({
            runDir: opts.runDir.trim(),
            runId: opts.runId ?? 'supervise',
            reopen,
            journal: opts.journal,
            limits: {
              budget: graph.budget,
              ...(opts.reservationPolicy === undefined
                ? {}
                : { reservationPolicy: opts.reservationPolicy }),
            },
            observer,
            pursuitId: opts.pursuitId.trim(),
            now: opts.now ?? Date.now,
          }),
  )
}

/** The pursuit identity and run directory both durable entries require. */
function assertPursuitDirectory(
  opts: {
    readonly pursuitId: string
    readonly runDir: string
    readonly retainedAtSettlement?: string
  },
  entry: string,
): void {
  for (const field of ['pursuitId', 'runDir'] as const) {
    if (opts[field].trim().length === 0) throw new TypeError(`${entry}: ${field} must be non-empty`)
  }
  if (opts.retainedAtSettlement === 'keep') {
    throw new TypeError(
      `${entry}: retainedAtSettlement 'keep' cannot hold, because a settled pursuit is never re-entered`,
    )
  }
}

/**
 * The run directory's lifecycle around one execution: lock, settled-directory refusal, observer
 * journal, failure record and settle record. `execute` receives the observer-composed hooks and
 * the steer directory the run's control plane uses; `settled` names the value `result.json` holds.
 */
async function runDurablePursuit<Result>(
  opts: Pick<
    SupervisePursuitOptions,
    'pursuitId' | 'runDir' | 'runId' | 'now' | 'hooks' | 'steerDir' | 'observerDelivery'
  >,
  execute: (seams: { readonly hooks: RuntimeHooks; readonly steerDir: string }) => Promise<Result>,
  settled: (result: Result) => SupervisedResult<unknown>,
  reopen?: (observer: FileObserverJournal) => Promise<void>,
): Promise<SupervisedPursuitResult<Result>> {
  const pursuitId = opts.pursuitId.trim()
  const runDir = opts.runDir.trim()
  const observerPath = resolve(runDir, 'observer.jsonl')
  const settlePath = resolve(runDir, SETTLE_RECORD_FILE)
  const failurePath = resolve(runDir, FAILURE_RECORD_FILE)
  const runId = opts.runId ?? 'supervise'
  const now = opts.now ?? Date.now

  // The lock is taken before the settle record is read so a run that settles between the read
  // and the lock cannot be re-entered; both refusals happen before the observer journal is touched.
  const lock = await acquireRunDirectoryLock(runDir, runId, now)
  return lock.run(async () => {
    let delivery: PursuitObserverDeliverer | undefined
    let terminalState: 'done' | 'failed' | 'running' = 'failed'
    try {
      const observer = createFileObserverHooks(observerPath, pursuitId)
      if (reopen !== undefined) await reopen(observer.journal)
      else {
        const prior = await readSettleRecord(runDir)
        if (prior !== undefined) {
          throw new SettledRunDirectoryError(settlePath, prior.tree.root, runId)
        }
      }

      // Root lifecycle is an observer-plane fact, not something the manager has to
      // narrate about itself. This also makes a zero-spawn/single-agent run observable.
      await observer.journal.appendEvent(rootEvent(pursuitId, runId, 'before', now()))
      delivery =
        opts.observerDelivery === undefined
          ? undefined
          : startPursuitObserverDelivery(opts.observerDelivery, async () =>
              projectPursuit(await observer.journal.read()),
            )

      let result: Result
      try {
        result = await execute({
          // The observer runs first so a caller hook that throws cannot prevent the
          // canonical lifecycle fact from entering the durable journal.
          hooks: withPursuitContext(pursuitId, composeRuntimeHooks(observer.hooks, opts.hooks)),
          // `runDir` owns the pursuit journal and terminal records. The public steer writer
          // addresses the canonical per-run event directory beneath that root, so keep its control
          // plane there without moving the durable pursuit records.
          steerDir: opts.steerDir ?? supervisorRunDir(runDir, runId),
        })
      } catch (error) {
        if (error instanceof RunParkedError && error.runId === runId) {
          terminalState = 'running'
          throw error
        }
        let pursuit: PursuitProjection
        try {
          // The journal fact is raw evidence and lands first; the failure record summarizes it.
          await observer.journal.appendEvent(
            rootEvent(pursuitId, runId, 'error', now(), {
              status: 'failed',
              error: errorMessage(error),
              failure: runtimeFailureCause(error),
            }),
          )
          pursuit = projectPursuit(await observer.journal.read())
        } catch (observerError) {
          throw new Error(
            'supervisePursuit: Runtime failed and durable observer completeness could not be proven',
            { cause: new AggregateError([error, observerError]) },
          )
        }
        // A failure record that cannot be written must not hide the journal fact above; it is
        // reported as its own cause beside the run's error.
        try {
          // The root's stream is already on disk whether or not the run settled; the record names
          // it so a root that died mid-turn keeps what it had streamed.
          const rootStream = await readRootStreamReceipt(runDir)
          await writeFailureRecord(runDir, {
            runId,
            pursuitId,
            at: new Date(now()).toISOString(),
            error: { name: errorName(error), message: errorMessage(error) },
            ...(rootStream === undefined ? {} : { rootStream }),
          })
        } catch (recordError) {
          throw new Error(
            `supervisePursuit: Runtime failed and the failure record ${failurePath} could not be written`,
            { cause: new AggregateError([error, recordError]) },
          )
        }
        throw new SupervisePursuitError(error, pursuit, observerPath, failurePath)
      }

      // The settle record is the re-entry guard, so it is durable before the journal says `done`.
      // A record that cannot be written leaves the attempt open in the journal and the run
      // re-enterable, which replays the settled children and settles again.
      const terminal = settled(result)
      try {
        await writeSettleRecord(runDir, terminal)
      } catch (cause) {
        throw new Error(
          `supervisePursuit: Runtime settled but the settle record ${settlePath} could not be written`,
          { cause },
        )
      }
      await observer.journal.appendEvent(
        rootEvent(pursuitId, runId, 'after', now(), {
          status: 'done',
          ...(terminal.kind === 'no-winner' &&
          terminal.reason === 'driver-failed' &&
          terminal.error.failure
            ? { error: terminal.error.message, failure: terminal.error.failure }
            : {}),
        }),
      )
      terminalState = 'done'
      return Object.freeze({
        result,
        pursuit: projectPursuit(await observer.journal.read()),
        observerPath,
        settlePath,
      })
    } finally {
      // The terminal delivery reads the journal after its last fact, and is bounded so an
      // unreachable Intelligence delays the return by at most twice its timeout.
      await delivery?.close(terminalState)
      await lock.release()
    }
  })
}

function rootEvent(
  pursuitId: string,
  runId: string,
  phase: 'before' | 'after' | 'error',
  timestamp: number,
  payload?: Record<string, unknown>,
): RuntimeHookEvent {
  return Object.freeze({
    id: `${runId}:pursuit:${phase}:${timestamp}`,
    pursuitId,
    runId,
    target: 'agent.run',
    phase,
    timestamp,
    ...(payload ? { payload: Object.freeze({ ...payload }) } : {}),
  })
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'NonError'
}
