import { resolve } from 'node:path'
import type { ChildQuestionInbox } from '../../mcp/tools/coordination-questions'
import { composeRuntimeHooks, type RuntimeHooks } from '../../runtime-hooks'
import { persistHarnessTranscript, readHarnessTranscript } from '../harness-transcript'
import type { ToolLoopChat } from '../tool-loop'
import { RunCancellationReason } from './abortable'
import { CONTINUATIONS_DIR } from './continuation'
import type { PriorCoordination } from './coordination-log'
import type { DriverContinuationRecord } from './driver-attempt-evidence'
import { authoredAgentIdentity, runtimeOwnedDriveHarnessProviderEvidence } from './materialization'
import { createSupervisorSpanRecorder, type SupervisorSpanRecorder } from './otel-spans'
import { ROOT_STREAM_FILE } from './root-stream'
import type { RunCancelRequest } from './run-cancellation'
import { watchRunCancellation } from './run-cancellation'
import { withRunParking } from './run-parking'
import { supervisorTurnOptions } from './supervise-agent-options'
import type { SuperviseOptions } from './supervise-options'
import { createSuperviseWorkers } from './supervise-recursive-workers'
import { verifyProfilePromotions } from './supervise-registry'
import {
  recordRunCancellationOutcome,
  rootProviderModelEvidence,
  rootProviderModelEvidenceFromExecution,
} from './supervise-root-evidence'
import { rootSegmentOf } from './supervise-root-profile'
import { prepareSuperviseRun } from './supervise-run-setup'
import { assertSqlRunProvider } from './supervise-sql-admission'
import { createRootHandle, createSupervisor, DEFAULT_MAX_DEPTH } from './supervisor'
import {
  type SupervisorAgentDeps,
  type SupervisorProfile,
  supervisorAgent,
  supervisorAgentWithTestBrain,
} from './supervisor-agent'
import type {
  Agent,
  RootHandle,
  RootStreamReceipt,
  SupervisedResult,
  SupervisorOpts,
} from './types'

/** What one supervised run holds from setup to settlement. */
interface SupervisedRun {
  readonly setup: ReturnType<typeof prepareSuperviseRun>
  readonly workers: ReturnType<typeof createSuperviseWorkers>
  readonly testBrain: ToolLoopChat | undefined
  /** One root control shared with every manager's pre-attempt cancellation fence. */
  readonly runControl: RootHandle<unknown> | undefined
  readonly durableCancellation: AbortController
  readonly cancelDurableRun: (reason: string, request?: RunCancelRequest) => void
  /** The root driver loop reports what it did once it ends; the settle record carries it. */
  rootContinuation: DriverContinuationRecord | undefined
}

export function superviseInternal(
  profile: SupervisorProfile,
  task: unknown,
  opts: SuperviseOptions,
  testBrain?: ToolLoopChat,
) {
  const setup = prepareSuperviseRun(profile, task, opts, testBrain)
  const { options } = setup
  const workers = createSuperviseWorkers(setup, (reason, request) =>
    cancelDurableRun(reason, request),
  )
  const durableCancellation = new AbortController()
  const cancelDurableRun = (reason: string, request?: RunCancelRequest): void => {
    durableCancellation.abort(
      request === undefined
        ? new Error(reason)
        : new RunCancellationReason(request.source, reason, request.operationId, request.operator),
    )
  }
  // Every configuration fault above throws SYNCHRONOUSLY (no compute starts); only the durable
  // coordination replay awaits, so the run begins inside `startSupervisedRun`.
  return startSupervisedRun({
    setup,
    workers,
    testBrain,
    runControl:
      options.rootHandle ??
      (options.runDir === undefined ? undefined : createRootHandle<unknown>()),
    durableCancellation,
    cancelDurableRun,
    rootContinuation: undefined,
  })
}

async function startSupervisedRun(run: SupervisedRun) {
  const { setup, runControl, cancelDurableRun } = run
  const { options, ctx, log, runId, rootOwnerId, canonicalTask } = setup
  if (ctx.durability === 'sql') await assertSqlRunProvider(options)
  await verifyProfilePromotions(setup.profileTable)
  // The durable coordination side-log (file contexts only) loads prior questions, findings and
  // instruction receipts and appends this process's evidence. The router arm gets all three in its
  // resume brief; the external arm seeds prior questions. No prior instruction is auto-delivered.
  const priorCoordination = log ? await log.load(runId, rootOwnerId) : undefined
  const runDir = options.runDir === undefined ? undefined : resolve(options.runDir)
  const agent = rootSupervisorAgent(run, priorCoordination, runDir)
  const recorder = rootSpanRecorder(setup)
  const hooks = runHooks(options, recorder, run.workers)

  const supervisor = createSupervisor<unknown, unknown>()
  if (runControl !== undefined) supervisor.attach(runControl)
  // The run owns cancellation until every descendant has drained, even after its director returns.
  const cancellation =
    runDir !== undefined && runControl !== undefined
      ? watchRunCancellation(runDir, cancelDurableRun)
      : undefined
  try {
    cancellation?.check()
  } catch (error) {
    cancellation?.close()
    throw error
  }
  const result = withRunParking(
    options.parking,
    runDir,
    runId,
    setup.journal,
    setup.now,
    options.signal === undefined
      ? run.durableCancellation.signal
      : AbortSignal.any([options.signal, run.durableCancellation.signal]),
    () => supervisor.run(agent, canonicalTask, rootRunOptions(run, runDir, hooks, recorder)),
  )
  const settle = () => settleSupervisedRun(run, result, cancellation)
  if (!recorder) return settle()
  // The recorder closes the root span on BOTH exits and never rethrows.
  try {
    const settled = await settle()
    await recorder.finish({ result: settled })
    return settled
  } catch (error) {
    await recorder.finish({ error })
    throw error
  }
}

function rootSupervisorAgent(
  run: SupervisedRun,
  priorCoordination: PriorCoordination | undefined,
  runDir: string | undefined,
): Agent<unknown, unknown> {
  const { setup, workers, runControl } = run
  const { options, canonicalProfile, registeredProfile, deliverable, log, runId, rootOwnerId } =
    setup
  const { spawnResourceRoot, observeNodeEvent, spawnPreflight, profileTable, analysts } = setup
  const authorizeRootMessage = setup.authorizeDownFor(canonicalProfile, 1)
  const rootPeerAudit = setup.peerAuditFor('')
  const composeSpawnProfile = setup.composeSpawnProfileFor(canonicalProfile)
  const agentDeps = {
    ...(rootPeerAudit ? { peerAudit: rootPeerAudit } : {}),
    blobs: setup.blobs,
    makeWorkerAgent: workers.workerFactory,
    ...(workers.graphSubtasks ? { graphs: workers.graphSubtasks } : {}),
    ...(authorizeRootMessage ? { authorizeDownMessage: authorizeRootMessage } : {}),
    perWorker: setup.perWorker,
    ...(setup.ownerShare > 0 ? { preserveOwnerTurns: true } : {}),
    ...(log
      ? {
          onEvent: (_event, record) => log.append(runId, record, rootOwnerId),
        }
      : {}),
    ...(deliverable ? { deliverable } : {}),
    onProviderModel(model: string | undefined) {
      setup.rootProviderModels.push(model)
    },
    onDriverLoopSettled(record: DriverContinuationRecord) {
      run.rootContinuation = record
    },
    ...(priorCoordination &&
    (priorCoordination.questions.length > 0 ||
      priorCoordination.findings.length > 0 ||
      priorCoordination.continuations.length > 0 ||
      priorCoordination.deliveryEvidence.length > 0 ||
      priorCoordination.records.length > 0)
      ? { priorCoordination }
      : {}),
    ...(setup.finalizer ? { finalizer: setup.finalizer } : {}),
    ...(options.coordination && setup.externalRoot ? { coordination: options.coordination } : {}),
    ...(spawnPreflight ? { preflightSpawn: spawnPreflight } : {}),
    ...(options.resolveSpawnProfile ? { resolveSpawnProfile: options.resolveSpawnProfile } : {}),
    ...(composeSpawnProfile ? { composeSpawnProfile } : {}),
    ...(profileTable ? { profiles: profileTable } : {}),
    ...(spawnResourceRoot === undefined ? {} : { spawnResourceRoot }),
    ...(options.peerMail ? { peerMail: options.peerMail } : {}),
    ...(options.router ? { router: options.router } : {}),
    ...(setup.rootDriveHarness ? { driveHarness: setup.rootDriveHarness } : {}),
    nodeContext: setup.rootNodeContext,
    ...(options.resolveSupervisorTools
      ? { resolveSupervisorTools: options.resolveSupervisorTools }
      : {}),
    ...(observeNodeEvent ? { observeNodeEvent, replaySettlements: true } : {}),
    ...(options.extraTools ? { extraTools: options.extraTools } : {}),
    ...(options.executeExtraTool ? { executeExtraTool: options.executeExtraTool } : {}),
    ...(analysts ? { analysts } : {}),
    ...(options.escalateQuestion ? { escalateQuestion: options.escalateQuestion } : {}),
    onChildQuestionInbox: (inbox: ChildQuestionInbox) => {
      setup.childQuestionInboxes.set(rootOwnerId, inbox)
    },
    ...(options.analyzeOnSettle ? { analyzeOnSettle: options.analyzeOnSettle } : {}),
    ...(options.watchWorkers ? { watchWorkers: options.watchWorkers } : {}),
    ...(options.stallAfterMs !== undefined ? { stallAfterMs: options.stallAfterMs } : {}),
    ...(options.wake !== undefined ? { wake: options.wake } : {}),
    ...(options.mapOnSettle ? { mapOnSettle: options.mapOnSettle } : {}),
    ...(options.routeFlow ? { routeFlow: options.routeFlow } : {}),
    ...(options.decideGate ? { decideGate: options.decideGate } : {}),
    ...(options.continuityByProfile ? { continuityByProfile: options.continuityByProfile } : {}),
    ...supervisorTurnOptions(options),
    // The root alone pauses where it would stop: `driverRetry` reaches every manager, but nested
    // deps are built without this key.
    ...(options.driverRetry?.pauseRootStops === true ? { pauseRootStops: true } : {}),
    ...(deliverable && options.continuation && setup.externalRoot
      ? {
          continuation: options.continuation,
          ...(runDir === undefined
            ? {}
            : {
                continuationDir: resolve(runDir, CONTINUATIONS_DIR),
                rootStreamPath: resolve(runDir, ROOT_STREAM_FILE),
              }),
        }
      : {}),
    // A durable run's layout dir is the worker-cancel control surface: each router-arm manager's turn
    // loop acknowledges the `cancelWorker` requests it OWNS (the root its direct children plus
    // label/profile references, nested managers their direct-child ids) and the root also applies
    // the run-scoped `cancelRun` through the one cascade controller.
    ...(runDir === undefined || runControl === undefined
      ? {}
      : {
          controlDir: runDir,
          abortRun: run.cancelDurableRun,
        }),
    ...(options.steerDir === undefined ? {} : { steerDir: resolve(options.steerDir) }),
    // A root executing another segment of its registered profile attributes its materialization to the registered one.
    ...(canonicalProfile === registeredProfile ? {} : { registeredProfile }),
  } satisfies SupervisorAgentDeps
  return run.testBrain === undefined
    ? supervisorAgent(canonicalProfile, agentDeps)
    : supervisorAgentWithTestBrain(canonicalProfile, { ...agentDeps, brain: run.testBrain })
}

/** Built ONLY when `otel` is configured AND an exporter resolves; the default path allocates nothing. */
function rootSpanRecorder(setup: SupervisedRun['setup']): SupervisorSpanRecorder | undefined {
  const { options } = setup
  return options.otel
    ? createSupervisorSpanRecorder({
        runId: setup.runId,
        namespace: setup.runNamespace,
        ...options.otel,
        // The root span names the segment's profile under the journal's root digest; a caller adds
        // only what it alone knows (a directive variant).
        agentIdentity: {
          ...options.otel.agentIdentity,
          ...authoredAgentIdentity(
            setup.canonicalProfile,
            setup.rootExecution.identity.profileDigest,
          ),
        },
        now: setup.now,
      })
    : undefined
}

function runHooks(
  options: SuperviseOptions,
  recorder: SupervisorSpanRecorder | undefined,
  workers: SupervisedRun['workers'],
): RuntimeHooks | undefined {
  const { graphSubtasks, graphOverlays } = workers
  // A `run_graph` subtask's ledger binds each spawn row to the worker the kernel started, on the
  // same `agent.spawn` events `runGraph` binds a root graph's rows on.
  const graphSpawnBinder: RuntimeHooks | undefined = graphSubtasks
    ? {
        onEvent: (event) => {
          if (graphOverlays.size === 0) return
          if (event.target !== 'agent.spawn' || event.phase !== 'after') return
          const payload = event.payload as { childId?: unknown; assignmentId?: unknown } | undefined
          if (typeof payload?.childId !== 'string' || typeof payload.assignmentId !== 'string') {
            return
          }
          const writes: Promise<void>[] = []
          for (const overlay of graphOverlays) {
            const write = overlay.bindSpawn(event.parentId, payload.assignmentId, payload.childId)
            if (write !== undefined) writes.push(write)
          }
          return writes.length === 0 ? undefined : Promise.all(writes).then(() => undefined)
        },
      }
    : undefined
  return recorder || graphSpawnBinder
    ? composeRuntimeHooks(options.hooks, recorder?.hooks, graphSpawnBinder)
    : options.hooks
}

function rootRunOptions(
  run: SupervisedRun,
  runDir: string | undefined,
  hooks: RuntimeHooks | undefined,
  recorder: SupervisorSpanRecorder | undefined,
): SupervisorOpts {
  const { setup, workers } = run
  const { options, ctx, registeredProfile, managerBackend, rootOwnerRuntime } = setup
  // A caller-supplied recovery factory wins: it owns the worker seam, so only it can rebuild an
  // interrupted child's executor. The derived registration serves backend-built recursive managers.
  const recoverExecutor =
    options.recoverExecutor ?? workers.recoveryFactories.get(workers.workerFactory)
  return {
    budget: options.budget,
    runId: setup.runId,
    journal: setup.journal,
    blobs: setup.blobs,
    executors: ctx.executors,
    ...(recoverExecutor ? { recoverExecutor } : {}),
    rootIdentity: setup.rootExecution.identity,
    ...(options.segment === undefined
      ? {}
      : {
          rootSegment: {
            registered: rootSegmentOf(registeredProfile),
            current: {
              ...rootSegmentOf(setup.canonicalProfile),
              ...(options.segment.stack === undefined
                ? {}
                : { stack: { ...options.segment.stack } }),
            },
            reason: options.segment.reason,
          },
        }),
    ...(rootOwnerRuntime === undefined
      ? {}
      : {
          rootMaterialization: {
            runtime: rootOwnerRuntime,
            declaration: 'deferred' as const,
            // Every segment's materialization is attributed to the registered root profile.
            authoredProfile: registeredProfile,
          },
        }),
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    ...(options.childSettleGraceMs !== undefined
      ? { childSettleGraceMs: options.childSettleGraceMs }
      : {}),
    ...(options.teardownConfirmMs !== undefined
      ? { teardownConfirmMs: options.teardownConfirmMs }
      : {}),
    ...(options.retainedAtSettlement !== undefined
      ? { retainedAtSettlement: options.retainedAtSettlement }
      : {}),
    ownerWorkspaceRetention:
      managerBackend?.backend === 'provider' && managerBackend.workspaceRetention !== undefined,
    ...(options.workerSlots !== undefined ? { workerSlots: options.workerSlots } : {}),
    ...(options.reservationPolicy ? { reservationPolicy: options.reservationPolicy } : {}),
    ...(options.deadlineCheckIn === undefined ? {} : { deadlineCheckIn: options.deadlineCheckIn }),
    ...(options.budgetStopHoldMs === undefined
      ? {}
      : { budgetStopHoldMs: options.budgetStopHoldMs }),
    ...(ctx.resume === true || (options.runDir === undefined && options.resume === true)
      ? { resume: true }
      : {}),
    ...(options.now ? { now: options.now } : {}),
    signal: options.signal
      ? AbortSignal.any([options.signal, run.durableCancellation.signal])
      : run.durableCancellation.signal,
    ...(hooks ? { hooks } : {}),
    // Only a run that records spans hands trace context to workers; a traced run on a backend with
    // NO propagation channel journals each severed hop (`trace-unpropagated`).
    ...(recorder ? { workerTrace: recorder.workerTrace } : {}),
    ...(recorder && setup.traceUnpropagated
      ? { workerTraceUnpropagated: setup.traceUnpropagated }
      : {}),
    ...(runDir === undefined ? {} : { interactiveBindingDir: runDir }),
  }
}

async function settleSupervisedRun(
  run: SupervisedRun,
  pending: Promise<SupervisedResult<unknown>>,
  cancellation: ReturnType<typeof watchRunCancellation> | undefined,
) {
  const { setup } = run
  const { options, rootDriveHarness, rootProviderModels, ctx, rootExecution } = setup
  let result: Awaited<typeof pending>
  let rootStream: RootStreamReceipt | undefined
  try {
    result = await pending
  } finally {
    // Closed on BOTH exits; whoever records a failure recomputes the same receipt from disk.
    try {
      rootStream = await setup.rootStreamSink?.close()
    } finally {
      cancellation?.close()
      cancellation?.check()
    }
  }
  recordRunCancellationOutcome(options.runDir, result, setup.now)
  // A nested manager's session rides its settle record (#1359); the root has none, so 312 of 312
  // Discovery roots of 2026-09-23/24 settled without a session receipt (#1264). The result carries it.
  const rootHarnessTranscript =
    rootDriveHarness === undefined
      ? undefined
      : await persistHarnessTranscript(readHarnessTranscript(rootDriveHarness), setup.blobs)
  const rootProviderModel =
    ctx.resume === true
      ? rootProviderModelEvidence([])
      : rootProviderModels.length > 0
        ? rootProviderModelEvidence(rootProviderModels)
        : rootDriveHarness === undefined
          ? rootProviderModelEvidence([])
          : rootProviderModelEvidenceFromExecution(
              runtimeOwnedDriveHarnessProviderEvidence(rootDriveHarness),
            )
  return {
    ...result,
    rootProviderModel,
    ...(rootStream === undefined ? {} : { rootStream }),
    ...(rootHarnessTranscript === undefined ? {} : { rootHarnessTranscript }),
    ...(run.rootContinuation === undefined ? {} : { continuation: run.rootContinuation }),
    // The settle record names the root's registered attribution so result.json readers can compare runs.
    ...(rootExecution.ref === undefined ? {} : { execution: rootExecution.ref }),
  }
}
