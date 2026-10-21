import { resolve } from 'node:path'
import { ValidationError } from '../../errors'
import type { ChildQuestionInbox } from '../../mcp/tools/coordination-questions'
import { composeRuntimeHooks, type RuntimeHooks } from '../../runtime-hooks'
import { resolveAgentEnvironmentProvider } from '../environment-provider'
import { persistHarnessTranscript, readHarnessTranscript } from '../harness-transcript'
import type { ToolLoopChat } from '../tool-loop'
import { RunCancellationReason } from './abortable'
import { CONTINUATIONS_DIR } from './continuation'
import type { DriverContinuationRecord } from './driver-retry'
import { authoredAgentIdentity, runtimeOwnedDriveHarnessProviderEvidence } from './materialization'
import { createSupervisorSpanRecorder, type SupervisorSpanRecorder } from './otel-spans'
import { ROOT_STREAM_FILE } from './root-stream'
import type { RunCancelRequest } from './run-cancellation'
import { watchRunCancellation } from './run-cancellation'
import { supervisorTurnOptions } from './supervise-agent-options'
import type { SuperviseOptions } from './supervise-options'
import { isExternalSupervisor } from './supervise-profile-admission'
import { createSuperviseWorkers } from './supervise-recursive-workers'
import { verifyProfilePromotions } from './supervise-registry'
import {
  recordRunCancellationOutcome,
  rootProviderModelEvidence,
  rootProviderModelEvidenceFromExecution,
} from './supervise-root-evidence'
import { rootSegmentOf } from './supervise-root-profile'
import { prepareSuperviseRun } from './supervise-run-setup'
import { createRootHandle, createSupervisor, DEFAULT_MAX_DEPTH } from './supervisor'
import {
  type SupervisorAgentDeps,
  type SupervisorProfile,
  supervisorAgent,
  supervisorAgentWithTestBrain,
} from './supervisor-agent'
import type { RootStreamReceipt } from './types'

export function superviseInternal(
  profile: SupervisorProfile,
  task: unknown,
  opts: SuperviseOptions,
  testBrain?: ToolLoopChat,
) {
  const setup = prepareSuperviseRun(profile, task, opts, testBrain)
  const {
    options,
    canonicalProfile,
    registeredProfile,
    canonicalTask,
    rootExecution,
    peerAuditFor,
    authorizeDownFor,
    deliverable,
    finalizer,
    analysts,
    profileTable,
    ctx,
    blobs,
    ownerShare,
    perWorker,
    journal,
    runId,
    runNamespace,
    log,
    rootOwnerId,
    childQuestionInboxes,
    rootProviderModels,
    rootStreamSink,
    observeNodeEvent,
    managerBackend,
    spawnResourceRoot,
    spawnPreflight,
    composeSpawnProfileFor,
    rootDriveHarness,
    rootOwnerRuntime,
    now,
    traceUnpropagated,
  } = setup
  let spans: SupervisorSpanRecorder | undefined
  const { workerFactory, recoveryFactories, graphSubtasks, graphOverlays } = createSuperviseWorkers(
    setup,
    (reason, request) => cancelDurableRun(reason, request),
  )
  // Share one root control with every manager's pre-attempt cancellation fence.
  const runControl =
    options.rootHandle ?? (options.runDir === undefined ? undefined : createRootHandle<unknown>())
  const durableCancellation = new AbortController()
  const cancelDurableRun = (reason: string, request?: RunCancelRequest): void => {
    durableCancellation.abort(
      request === undefined
        ? new Error(reason)
        : new RunCancellationReason(request.source, reason, request.operationId),
    )
  }

  // Every configuration fault above throws SYNCHRONOUSLY — a caller that guards with
  // `expect(() => supervise(...)).toThrow` still sees the throw, and no compute starts. Only the
  // durable coordination replay needs to await, so the run begins inside this closure.
  // The root driver loop reports what it did once it ends; the settle record carries it.
  let rootContinuation: DriverContinuationRecord | undefined
  const start = async () => {
    if (ctx.durability === 'sql') {
      if (
        options.backend?.backend !== 'provider' ||
        options.backend.steering ||
        options.driveHarness ||
        options.resolveDriveHarness ||
        options.driverBackend
      ) {
        throw new ValidationError(
          'supervise: SQL runContext requires a local coordinator and non-steering retained provider workers',
        )
      }
      const provider = resolveAgentEnvironmentProvider(
        options.backend.provider,
        options.backend.registry,
      )
      const capabilities = await provider.capabilities()
      if (
        !capabilities.retainedControl ||
        !capabilities.streaming.turnIdempotency ||
        !capabilities.streaming.replay ||
        !provider.get
      ) {
        throw new ValidationError(
          'supervise: SQL runContext requires retainedControl, replay, turn idempotency, and provider.get',
        )
      }
    }
    await verifyProfilePromotions(profileTable)
    // The durable coordination side-log (file contexts only) loads prior questions, findings, and
    // authorized instruction receipts, then appends this process's evidence as it publishes. The
    // router arm receives all three in its resume brief; the external arm seeds prior questions and
    // leaves the other evidence in the log. No prior instruction is auto-delivered.
    const priorCoordination = log ? await log.load(runId, rootOwnerId) : undefined

    const authorizeRootMessage = authorizeDownFor(canonicalProfile, 1)
    const rootPeerAudit = peerAuditFor('')
    const agentDeps = {
      ...(rootPeerAudit ? { peerAudit: rootPeerAudit } : {}),
      blobs,
      makeWorkerAgent: workerFactory,
      ...(graphSubtasks ? { graphs: graphSubtasks } : {}),
      ...(authorizeRootMessage ? { authorizeDownMessage: authorizeRootMessage } : {}),
      perWorker,
      ...(ownerShare > 0 ? { preserveOwnerTurns: true } : {}),
      ...(log
        ? {
            onEvent: (_event, record) => log.append(runId, record, rootOwnerId),
          }
        : {}),
      ...(deliverable ? { deliverable } : {}),
      onProviderModel(model: string | undefined) {
        rootProviderModels.push(model)
      },
      onDriverLoopSettled(record: DriverContinuationRecord) {
        rootContinuation = record
      },
      ...(priorCoordination &&
      (priorCoordination.questions.length > 0 ||
        priorCoordination.findings.length > 0 ||
        priorCoordination.continuations.length > 0 ||
        priorCoordination.deliveryEvidence.length > 0 ||
        priorCoordination.records.length > 0)
        ? { priorCoordination }
        : {}),
      ...(finalizer ? { finalizer } : {}),
      ...(options.coordination && isExternalSupervisor(canonicalProfile)
        ? { coordination: options.coordination }
        : {}),
      ...(spawnPreflight ? { preflightSpawn: spawnPreflight } : {}),
      ...(options.resolveSpawnProfile ? { resolveSpawnProfile: options.resolveSpawnProfile } : {}),
      ...(composeSpawnProfileFor(canonicalProfile)
        ? { composeSpawnProfile: composeSpawnProfileFor(canonicalProfile) }
        : {}),
      ...(profileTable ? { profiles: profileTable } : {}),
      ...(spawnResourceRoot === undefined ? {} : { spawnResourceRoot }),
      ...(options.peerMail ? { peerMail: options.peerMail } : {}),
      ...(options.router ? { router: options.router } : {}),
      ...(rootDriveHarness ? { driveHarness: rootDriveHarness } : {}),
      nodeContext: {
        runId,
        runNamespace,
        ownerId: rootOwnerId,
        depth: 0,
        identity: rootExecution.identity,
      },
      ...(options.resolveSupervisorTools
        ? { resolveSupervisorTools: options.resolveSupervisorTools }
        : {}),
      ...(observeNodeEvent ? { observeNodeEvent, replaySettlements: true } : {}),
      ...(options.extraTools ? { extraTools: options.extraTools } : {}),
      ...(options.executeExtraTool ? { executeExtraTool: options.executeExtraTool } : {}),
      ...(analysts ? { analysts } : {}),
      ...(options.escalateQuestion ? { escalateQuestion: options.escalateQuestion } : {}),
      onChildQuestionInbox: (inbox: ChildQuestionInbox) => {
        childQuestionInboxes.set(rootOwnerId, inbox)
      },
      ...(options.analyzeOnSettle ? { analyzeOnSettle: options.analyzeOnSettle } : {}),
      ...(options.watchWorkers ? { watchWorkers: options.watchWorkers } : {}),
      ...(options.stallAfterMs !== undefined ? { stallAfterMs: options.stallAfterMs } : {}),
      ...(options.wake !== undefined ? { wake: options.wake } : {}),
      ...(options.mapOnSettle ? { mapOnSettle: options.mapOnSettle } : {}),
      ...(options.routeFlow ? { routeFlow: options.routeFlow } : {}),
      ...(options.continuityByProfile ? { continuityByProfile: options.continuityByProfile } : {}),
      ...supervisorTurnOptions(options),
      ...(deliverable && options.continuation && isExternalSupervisor(canonicalProfile)
        ? {
            continuation: options.continuation,
            ...(options.runDir === undefined
              ? {}
              : {
                  continuationDir: resolve(options.runDir, CONTINUATIONS_DIR),
                  rootStreamPath: resolve(options.runDir, ROOT_STREAM_FILE),
                }),
          }
        : {}),
      // A durable run's layout dir doubles as the worker-cancel control surface: every
      // router-arm manager's turn loop acknowledges the `cancelWorker` requests it OWNS — the
      // root (default 'run' scope) resolves its direct children plus label/profile references,
      // each nested manager (above) its own direct-child node ids only. The root ALSO applies the
      // run-scoped request (`cancelRun`) through the run's one cascade controller.
      ...(options.runDir === undefined || runControl === undefined
        ? {}
        : {
            controlDir: resolve(options.runDir),
            abortRun: cancelDurableRun,
          }),
      ...(options.steerDir === undefined ? {} : { steerDir: resolve(options.steerDir) }),
      // A root executing another segment of its registered profile attributes its materialization to the registered one.
      ...(canonicalProfile === registeredProfile ? {} : { registeredProfile }),
    } satisfies SupervisorAgentDeps
    const agent =
      testBrain === undefined
        ? supervisorAgent(canonicalProfile, agentDeps)
        : supervisorAgentWithTestBrain(canonicalProfile, { ...agentDeps, brain: testBrain })

    // Built ONLY when `otel` is configured AND an exporter resolves, so the default path allocates
    // nothing and passes no `hooks` at all — byte-for-byte the wiring every existing caller gets.
    spans = options.otel
      ? createSupervisorSpanRecorder({
          runId,
          namespace: runNamespace,
          ...options.otel,
          // The root span names the profile this segment runs, under the digest the journal
          // recorded for the root. A caller adds what only it knows (a directive variant); the
          // fields the profile decides are not the caller's to restate.
          agentIdentity: {
            ...options.otel.agentIdentity,
            ...authoredAgentIdentity(canonicalProfile, rootExecution.identity.profileDigest),
          },
          now,
        })
      : undefined
    const recorder = spans
    // A `run_graph` subtask's ledger binds each spawn row to the worker the kernel started, on the
    // same `agent.spawn` events `runGraph` binds a root graph's rows on.
    const graphSpawnBinder: RuntimeHooks | undefined = graphSubtasks
      ? {
          onEvent: (event) => {
            if (graphOverlays.size === 0) return
            if (event.target !== 'agent.spawn' || event.phase !== 'after') return
            const payload = event.payload as
              | { childId?: unknown; assignmentId?: unknown }
              | undefined
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
    const hooks =
      recorder || graphSpawnBinder
        ? composeRuntimeHooks(options.hooks, recorder?.hooks, graphSpawnBinder)
        : options.hooks

    const supervisor = createSupervisor<unknown, unknown>()
    if (runControl !== undefined) supervisor.attach(runControl)
    // The run owns cancellation until every descendant has drained, even after its director returns.
    const cancellation =
      options.runDir !== undefined && runControl !== undefined
        ? watchRunCancellation(resolve(options.runDir), cancelDurableRun)
        : undefined
    try {
      cancellation?.check()
    } catch (error) {
      cancellation?.close()
      throw error
    }
    const run = supervisor.run(agent, canonicalTask, {
      budget: options.budget,
      runId,
      journal,
      blobs,
      executors: ctx.executors,
      // A caller-supplied recovery factory wins: it owns the worker seam (makeWorkerAgent /
      // makeLeafAgent), so only it can reconstruct an interrupted child's executor. The derived
      // registration below serves backend-built recursive managers, which no caller can name.
      ...((options.recoverExecutor ?? recoveryFactories.get(workerFactory))
        ? { recoverExecutor: options.recoverExecutor ?? recoveryFactories.get(workerFactory) }
        : {}),
      rootIdentity: rootExecution.identity,
      ...(options.segment === undefined
        ? {}
        : {
            rootSegment: {
              registered: rootSegmentOf(registeredProfile),
              current: {
                ...rootSegmentOf(canonicalProfile),
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
      ...(options.deadlineCheckIn === undefined
        ? {}
        : { deadlineCheckIn: options.deadlineCheckIn }),
      ...(options.budgetStopHoldMs === undefined
        ? {}
        : { budgetStopHoldMs: options.budgetStopHoldMs }),
      ...(ctx.resume === true || (options.runDir === undefined && options.resume === true)
        ? { resume: true }
        : {}),
      ...(options.now ? { now: options.now } : {}),
      signal: options.signal
        ? AbortSignal.any([options.signal, durableCancellation.signal])
        : durableCancellation.signal,
      ...(hooks ? { hooks } : {}),
      // Only a run that actually records spans hands trace context down to its workers; with no
      // recorder this key is absent and no spawned worker's environment is touched.
      ...(recorder ? { workerTrace: recorder.workerTrace } : {}),
      // A traced run on a backend with NO propagation channel journals each severed hop
      // (`trace-unpropagated`) instead of silently producing disconnected child traces.
      ...(recorder && traceUnpropagated ? { workerTraceUnpropagated: traceUnpropagated } : {}),
      ...(options.runDir === undefined ? {} : { interactiveBindingDir: resolve(options.runDir) }),
    })
    const settle = async () => {
      let result: Awaited<typeof run>
      let rootStream: RootStreamReceipt | undefined
      try {
        result = await run
      } finally {
        // Closed on BOTH exits. A run that throws releases the file here, and whoever records
        // the failure recomputes the same receipt from the bytes on disk.
        try {
          rootStream = await rootStreamSink?.close()
        } finally {
          cancellation?.close()
          cancellation?.check()
        }
      }
      recordRunCancellationOutcome(options.runDir, result, now)
      // A nested manager's session rides its settle record (#1359). The root has no settle
      // record, so its session had no receipt anywhere: 312 of 312 Discovery roots of
      // 2026-09-23/24 settled without one, and 27 of the 57 harness subagent calls seen in those
      // runs were the roots' own (#1264). The result carries it, persisted the same way.
      const rootHarnessTranscript =
        rootDriveHarness === undefined
          ? undefined
          : await persistHarnessTranscript(readHarnessTranscript(rootDriveHarness), blobs)
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
        ...(rootContinuation === undefined ? {} : { continuation: rootContinuation }),
        // The settle record names the attribution the root registered under, so a reader of
        // result.json can group or compare runs without the journal.
        ...(rootExecution.ref === undefined ? {} : { execution: rootExecution.ref }),
      }
    }
    if (!recorder) return settle()
    // The recorder closes the root span on BOTH exits and never rethrows, so tracing can neither
    // change the result nor swallow the run's own rejection.
    try {
      const result = await settle()
      await recorder.finish({ result })
      return result
    } catch (error) {
      await recorder.finish({ error })
      throw error
    }
  }

  return start()
}
