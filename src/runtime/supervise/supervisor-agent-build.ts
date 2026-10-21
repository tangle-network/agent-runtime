import { dirname } from 'node:path'
import { agentProfileSchema } from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import type { CoordinationEvent, ManagerWake } from '../../mcp/tools/coordination-events'
import { agentHarness } from '../harness-role'
import type { ToolLoopChat } from '../tool-loop'
import { linkAbort, runAbortable } from './abortable'
import {
  admitContinuationPolicy,
  bestComposite,
  CheckUnavailableError,
  type ContinuationKeeper,
  checkVerdictOf,
  createContinuationKeeper,
} from './continuation'
import type { PriorCoordination } from './coordination-log'
import { serveCoordinationMcpForManager } from './coordination-mcp'
import { driverAgent } from './driver-brain-agent'
import type { RootSteer } from './driver-control-acknowledgers'
import {
  type DriverAttemptRecord,
  type DriverContinuationRecord,
  type DriverProgressMark,
  runDriverWithRetry,
  summarizeDriverAttempts,
} from './driver-retry'
import type { BusRecord } from './event-bus'
import { bestDelivered, runFinalizer, runTree } from './finalizer'
import { createInbox, INBOX_RECEIPT_KEY, type InboxReceipt } from './inbox'
import { attestRuntimeOwnedScopeOwner, runtimeOwnedScopeOwnerRuntime } from './materialization'
import { assertExecutableAgentProfile } from './model-policy'
import { isLiveNodeStatus } from './node-status'
import { isPeerMailEnvelope, PEER_MAIL_WIRE_KEY } from './peer-mail'
import { coordinationProfileToolPrefix, providerVisibleProfile } from './provider-visible-profile'
import { composeReentryTask, type ReentryContinuity, UNPROVEN_CONTINUITY } from './reentry'
import { abandonScopeRetainedOwnerInvocation } from './retained-scope-owner'
import { readRootStream } from './root-stream'
import { createRouterTranscript } from './router-transcript'
import { applyRunCancellation } from './run-cancellation'
import { runTraceAnalysisStore } from './run-traces'
import {
  beginScopeOwnerAttempt,
  recordScopeOwnerDriverAttempt,
  recordScopeOwnerPause,
} from './scope'
import { detachedSnapshot } from './snapshot'
import { createProgressTracker, progressStop, type SettledLedger } from './stop-rules'
import type { CoordinationBinding, SupervisorAgentDeps } from './supervisor-agent-contracts'
import {
  assertNoReservedCoordinationMcpAlias,
  assertRouterArmResourcePolicy,
  declaredRuntimeToolNames,
  ownSubmissionDeliverable,
  resolveSupervisorModelId,
  resolveSupervisorSystemPrompt,
  runtimeToolDeclarationError,
  type SupervisorProfile,
} from './supervisor-agent-profile'
import { supervisorCoordinationObservers } from './supervisor-coordination-observers'
import {
  assertCoordinationBinding,
  routerBrainFromProfile,
  snapshotRouterTransportConfig,
} from './supervisor-router-config'
import {
  bindSupervisorNodeObserver,
  bindSupervisorTools,
  createVerbSlot,
  supervisorNodeContext,
  type VerbSlot,
} from './supervisor-tool-binding'
import type { Agent, Scope } from './types'
import { composeWakeInput, deadlineWarningAt, refreshedWake, resolveWakePolicy } from './wake'
import { observeWorkerControls } from './worker-control-observer'

export function buildSupervisorAgent(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
  testBrain?: ToolLoopChat,
): Agent<unknown, unknown> {
  const exactProfile = agentProfileSchema.parse(profile)
  assertExecutableAgentProfile(exactProfile, 'supervisorAgent')
  const stableProfile = detachedSnapshot(exactProfile, 'supervisorAgent profile')
  const registeredProfile =
    deps.registeredProfile === undefined
      ? stableProfile
      : detachedSnapshot(
          agentProfileSchema.parse(deps.registeredProfile),
          'supervisorAgent registered profile',
        )
  const stableRouter =
    deps.router === undefined ? undefined : snapshotRouterTransportConfig(deps.router)
  const resolveTools = deps.resolveSupervisorTools
  assertNoReservedCoordinationMcpAlias(stableProfile, 'supervisorAgent')
  const harness = agentHarness(stableProfile.harness) ?? null
  // `extraTools` is mounted only by the router tool-loop. An external harness receives product
  // tools only through its coordination MCP, so it must have a node-scoped resolver instead.
  const runtimeToolError = runtimeToolDeclarationError(
    stableProfile,
    resolveTools !== undefined,
    harness === null ? deps.extraTools?.map((tool) => tool.name) : undefined,
  )
  if (runtimeToolError !== undefined) {
    throw new ValidationError(`supervisorAgent: ${runtimeToolError}`)
  }
  const observeNodeEvent = deps.observeNodeEvent
  const nodeContextSeed =
    deps.nodeContext === undefined
      ? undefined
      : detachedSnapshot(deps.nodeContext, 'supervisorAgent node context')
  if ((resolveTools || observeNodeEvent) && !nodeContextSeed) {
    throw new ValidationError(
      'supervisorAgent: nodeContext is required with resolveSupervisorTools or observeNodeEvent',
    )
  }
  const name = stableProfile.name ?? 'supervisor'
  // The prompt is consumed by BOTH arms, so it resolves here; the model id is router-arm-only and
  // resolves inside that arm, so a harness supervisor never touches a field it does not use.
  // No fallback at this site. Both arms receive only the prompt and instruction bytes declared by
  // the profile.
  const profilePrompt = resolveSupervisorSystemPrompt(stableProfile)
  const runtimeToolNames = declaredRuntimeToolNames(stableProfile)

  // Bind safety is a BUILD-time fault, not a run-time one: it must throw before any compute, on the
  // same synchronous path as the other configuration guards. The binding is SNAPSHOT here and the
  // snapshot is both what gets checked and what `act()` binds, so a later mutation of
  // `deps.coordination` cannot slip an unchecked host past the guard.
  const coordination: CoordinationBinding | undefined = deps.coordination
    ? { ...deps.coordination }
    : undefined
  assertCoordinationBinding(coordination)

  if (harness === null && coordination !== undefined) {
    throw new ConfigError(
      'supervisorAgent: coordination binding is only meaningful for a harness-brained supervisor ' +
        '(profile.harness set). A router-brained supervisor calls the coordination verbs in ' +
        'process and serves no MCP, so this binding would be silently ignored.',
    )
  }

  if (harness === null && deps.peerMail) {
    throw new ValidationError(
      'supervisorAgent: peerMail is only served by a harness-brained supervisor ' +
        '(profile.harness set). A router-brained supervisor serves no coordination MCP listener, ' +
        'so there is no peer-mail post office to mint worker capabilities from.',
    )
  }

  if (harness !== null && deps.compaction) {
    throw new ValidationError(
      'supervisorAgent: compaction is only supported for router-brained supervisors (profile.harness omitted or cli-base)',
    )
  }

  if (harness === null && deps.continuation !== undefined) {
    throw new ValidationError(
      'supervisorAgent: continuation applies to an EXTERNAL-harness supervisor only (profile.harness ' +
        'set). A router-brained supervisor runs its own turn loop in process, so the policy would ' +
        'be silently ignored.',
    )
  }
  if (deps.continuation !== undefined && deps.deliverable === undefined) {
    throw new ValidationError(
      'supervisorAgent: continuation needs a `deliverable` completion check — with no check there ' +
        'is no contract that can be unmet',
    )
  }
  if (
    harness !== null &&
    deps.deliverable !== undefined &&
    deps.deliverable !== ownSubmissionDeliverable &&
    deps.continuation === undefined
  ) {
    throw new ValidationError(
      'supervisorAgent: a manager with a completion check needs a continuation policy (deadline, ' +
        'maxBarren, the note profile and switches). Runtime supplies no default: how long to send ' +
        "a director back, and what to tell it, is the record's decision",
    )
  }
  // One way out: a manager with a check ends when the check passes or when a bound ends it.
  // Refused before any compute, on both arms.
  if (deps.deliverable !== undefined && runtimeToolNames.includes('stop')) {
    throw new ValidationError(
      `supervisorAgent: the profile grants ${coordinationProfileToolPrefix}stop to a manager with a ` +
        'completion check. Such a manager ends only through submit_result (the check passes) or a ' +
        'bound (deadline, budget, cancellation, no progress); remove stop from its tools',
    )
  }
  const continuationDeadlineMs =
    deps.continuation === undefined
      ? undefined
      : admitContinuationPolicy(deps.continuation, 'supervisorAgent')

  if (harness === null) {
    // ROUTER arm: the in-process tool-loop. `routerBrain` is an internal detail — a production
    // caller passes a profile, never a hand-built brain. Deterministic source tests use the
    // separately exported `/testing` constructor.
    assertRouterArmResourcePolicy(stableProfile)
    const brain = testBrain ?? routerBrainFromProfile(stableProfile, stableRouter)
    const inbox = createInbox()
    // One conversation per agent, whichever driver `act` builds for an attempt.
    const transcript = createRouterTranscript()
    const build = (
      priorCoordination?: PriorCoordination,
      nodeTools?: ReadonlyArray<McpToolDescriptor>,
      onEvent?: SupervisorAgentDeps['onEvent'],
      slot?: VerbSlot,
    ) =>
      driverAgent({
        name,
        brain,
        transcript,
        ...(testBrain === undefined
          ? { expectedModel: resolveSupervisorModelId(stableProfile) }
          : {}),
        ...(deps.onProviderModel ? { onProviderModel: deps.onProviderModel } : {}),
        blobs: deps.blobs,
        makeWorkerAgent: deps.makeWorkerAgent,
        ...(deps.graphs ? { graphs: deps.graphs } : {}),
        ...(deps.authorizeDownMessage ? { authorizeDownMessage: deps.authorizeDownMessage } : {}),
        perWorker: deps.perWorker,
        ...(deps.preserveOwnerTurns ? { preserveOwnerTurns: true as const } : {}),
        // An omitted prompt means no standing system text. Runtime executes the exact profile and
        // never chooses a research policy for it.
        systemPrompt: resolveSupervisorSystemPrompt(stableProfile) ?? '',
        ...(deps.deliverable ? { deliverable: deps.deliverable } : {}),
        ...(deps.onAcceptedSubmission ? { onAcceptedSubmission: deps.onAcceptedSubmission } : {}),
        toolNames: runtimeToolNames,
        ...(nodeTools?.length ? { nodeTools } : {}),
        ...(deps.extraTools ? { extraTools: deps.extraTools } : {}),
        ...(deps.executeExtraTool ? { executeExtraTool: deps.executeExtraTool } : {}),
        ...supervisorCoordinationObservers(deps),
        ...(deps.routeFlow ? { routeFlow: deps.routeFlow } : {}),
        ...(deps.wake !== undefined ? { wake: deps.wake } : {}),
        ...(deps.continuityByProfile ? { continuityByProfile: deps.continuityByProfile } : {}),
        ...(deps.preflightSpawn ? { preflightSpawn: deps.preflightSpawn } : {}),
        ...(deps.resolveSpawnProfile ? { resolveSpawnProfile: deps.resolveSpawnProfile } : {}),
        ...(deps.composeSpawnProfile ? { composeSpawnProfile: deps.composeSpawnProfile } : {}),
        ...(deps.profiles ? { profiles: deps.profiles } : {}),
        ...(deps.spawnResourceRoot ? { spawnResourceRoot: deps.spawnResourceRoot } : {}),
        ...(deps.spawnResourceReader ? { spawnResourceReader: deps.spawnResourceReader } : {}),
        ...(deps.stopRule ? { stopRule: deps.stopRule } : {}),
        ...(deps.onProgressStop ? { onProgressStop: deps.onProgressStop } : {}),
        ...(deps.maxTurns !== undefined ? { maxTurns: deps.maxTurns } : {}),
        ...(deps.compaction ? { compaction: deps.compaction } : {}),
        ...(onEvent ? { onEvent } : {}),
        ...(deps.replaySettlements ? { replaySettlements: true } : {}),
        ...(priorCoordination ? { priorCoordination } : {}),
        ...(deps.finalizer ? { finalizer: deps.finalizer } : {}),
        ...(slot
          ? { onCoordinationTools: (tools, coordination) => slot.bind(tools, coordination) }
          : {}),
        ...(deps.controlDir === undefined ? {} : { controlDir: deps.controlDir }),
        ...(deps.steerDir === undefined ? {} : { steerDir: deps.steerDir }),
        ...(deps.controlScope === undefined ? {} : { controlScope: deps.controlScope }),
        ...(deps.abortRun ? { abortRun: deps.abortRun } : {}),
        inbox,
      })
    if (!deps.loadPriorCoordination && !resolveTools && !observeNodeEvent) {
      return build(deps.priorCoordination, undefined, deps.onEvent)
    }
    return {
      name,
      deliver(message): boolean {
        return inbox.deliver(message)
      },
      harnessTranscript: () => transcript.capture(),
      async act(task, scope) {
        const context = nodeContextSeed
          ? supervisorNodeContext(nodeContextSeed, stableProfile, task, scope)
          : undefined
        const priorCoordination = await deps.loadPriorCoordination?.()
        // Filled by `driverAgent` the moment it builds this manager's coordination tools, which
        // is after the product tools are bound — hence the slot rather than a value.
        const slot = createVerbSlot()
        const nodeTools =
          resolveTools && context
            ? await bindSupervisorTools(resolveTools, context, scope.signal, slot)
            : undefined
        const onEvent = bindSupervisorNodeObserver(context, observeNodeEvent, deps.onEvent)
        return build(priorCoordination, nodeTools, onEvent, slot).act(task, scope)
      },
    }
  }

  // EXTERNAL arm: a caller-driven harness uses the coordination verbs over the live scope.
  const driveHarness = deps.driveHarness
  if (!driveHarness) {
    throw new ValidationError(
      `supervisorAgent: profile.harness="${harness}" needs deps.driveHarness (how to run the harness with the coordination MCP mounted)`,
    )
  }
  const deliver = driveHarness.deliver?.bind(driveHarness)
  const rawDeliverReady = driveHarness.deliverReady
  if (rawDeliverReady !== undefined && typeof rawDeliverReady !== 'function') {
    throw new ValidationError(
      'supervisorAgent: driveHarness.deliverReady must be a function when provided',
    )
  }
  const deliverReady = rawDeliverReady?.bind(driveHarness)
  const wakePolicy = resolveWakePolicy(deps.wake)
  // Set while `act` runs: where a message from this manager's lead goes. A harness with a live
  // inbox takes it inside the running turn; otherwise it is the input of the manager's next wake.
  // Before, a manager on an executor with no inbox refused every steer as `runtime-has-no-inbox`.
  let managerInbox: ((message: unknown) => boolean) | undefined
  // The workers this manager is waiting on, while it waits between turns.
  let waitingOn: number | undefined
  // The coordinator of the running `act`. Its submission is set only once the accepted result is
  // durable, so it is what `resultAccepted` reads.
  let liveCoordinator: { submittedResult(): unknown } | undefined
  const externalAgent: Agent<unknown, unknown> = {
    name,
    deliver(message: unknown): boolean {
      return managerInbox?.(message) ?? false
    },
    resultAccepted: () => Boolean(liveCoordinator?.submittedResult()),
    traceSource: () => driveHarness.traceSource?.(),
    progress: () => {
      const harnessProgress = driveHarness.progress?.()
      if (waitingOn === undefined) return harnessProgress
      return {
        ...harnessProgress,
        note: `waiting for ${waitingOn} worker${waitingOn === 1 ? '' : 's'}; Runtime wakes it when one reports`,
      }
    },
    // Present only when the harness has a transcript port, so an absent one still settles as
    // `executor-exposes-no-transcript` rather than as a capture that did not run.
    ...(driveHarness.harnessTranscript
      ? { harnessTranscript: () => driveHarness.harnessTranscript?.() }
      : {}),
    ...(driveHarness.harnessTranscriptSettled
      ? {
          harnessTranscriptSettled: () =>
            driveHarness.harnessTranscriptSettled?.() ?? Promise.resolve(),
        }
      : {}),
    async act(task, scope) {
      const context = nodeContextSeed
        ? supervisorNodeContext(nodeContextSeed, stableProfile, task, scope)
        : undefined
      const priorCoordination = deps.loadPriorCoordination
        ? await deps.loadPriorCoordination()
        : deps.priorCoordination
      // Filled by `serveCoordinationMcp` right after it builds this manager's coordination tools
      // and before it listens, so a product tool can compose from its first invocation.
      const slot = createVerbSlot()
      // What the manager's next harness invocation must read: sibling peer mail, and any steer or
      // answer an ended invocation's executor still held. Folded into the next drive's task.
      const nextTurnInbox = createInbox()
      const nodeTools =
        resolveTools && context
          ? await bindSupervisorTools(resolveTools, context, scope.signal, slot)
          : undefined
      const nodeObserver = bindSupervisorNodeObserver(context, observeNodeEvent, deps.onEvent)
      const stopController = new AbortController()
      const coordinationLifetime = linkAbort(scope.signal)
      let harnessInvocationActive = false
      // PROGRESS-derived stop on this arm. The harness owns its own turn loop, so a worker settle
      // is the evaluation boundary the supervisor has — and it is the same ledger + the same
      // `progressStop` evaluator the router arm consults before each of its inference turns.
      // The stop is delivered through the ONE lever this arm already has: `stopController`, which
      // the harness reads as its stop signal and honours at the next turn boundary.
      const tracker = deps.stopRule ? createProgressTracker({ now: Date.now }) : undefined
      let progressStopReason: string | undefined
      let ledger: SettledLedger | undefined
      const rule = deps.stopRule
      const onEvent =
        tracker && rule
          ? async (
              event: CoordinationEvent,
              record: BusRecord<CoordinationEvent>,
            ): Promise<void> => {
              await nodeObserver?.(event, record)
              if (event.type !== 'settled') return
              if (ledger === undefined) {
                throw new ValidationError(
                  'supervisorAgent: a worker settled before the coordination server was bound',
                )
              }
              const decision = progressStop(
                tracker,
                rule,
                ledger,
                scope,
                Date.now,
                deps.stallAfterMs,
              )
              if (!decision.stop || progressStopReason !== undefined) return
              progressStopReason = decision.reason
              deps.onProgressStop?.(decision.reason)
              if (!stopController.signal.aborted) stopController.abort(decision.reason)
            }
          : nodeObserver
      // Built once the coordinator exists, because it reads the check's reads from it.
      let keeper: ContinuationKeeper | undefined
      const { handle: mcp, controls } = await serveCoordinationMcpForManager(
        {
          scope,
          blobs: deps.blobs,
          makeWorkerAgent: deps.makeWorkerAgent,
          ...(deps.graphs ? { graphs: deps.graphs } : {}),
          ...(deps.authorizeDownMessage ? { authorizeDownMessage: deps.authorizeDownMessage } : {}),
          perWorker: deps.perWorker,
          ...(coordination ?? {}),
          ...(context
            ? { identity: { runId: context.runNamespace, actorId: context.ownerId } }
            : {}),
          // Forward the policy so direct server construction and manager preflight enforce the same
          // authentication and request limits.
          ...(deps.deliverable ? { deliverable: deps.deliverable } : {}),
          ...(deps.continuation
            ? {
                readContinuation: (n: number | undefined) =>
                  keeper?.read(n) ?? { found: false, reason: 'no continuation has been sent' },
              }
            : {}),
          onStop: (reason) => {
            if (!stopController.signal.aborted) {
              stopController.abort(reason ?? 'coordination stop')
            }
          },
          ...supervisorCoordinationObservers(deps),
          ...(deps.continuityByProfile ? { continuityByProfile: deps.continuityByProfile } : {}),
          // Fence the awaited event transaction itself. Racing only the control poll would leave
          // its late continuation able to deliver an instruction after the manager stopped.
          onEvent: async (event, record) => {
            await runAbortable(
              async () => {
                await onEvent?.(event, record)
              },
              coordinationLifetime.signal,
              'supervisor coordination stopped',
            )
          },
          ...(deps.replaySettlements ? { replaySettlements: true } : {}),
          ...(deps.preflightSpawn ? { preflightSpawn: deps.preflightSpawn } : {}),
          ...(deps.resolveSpawnProfile ? { resolveSpawnProfile: deps.resolveSpawnProfile } : {}),
          ...(deps.composeSpawnProfile ? { composeSpawnProfile: deps.composeSpawnProfile } : {}),
          ...(deps.profiles ? { profiles: deps.profiles } : {}),
          ...(deps.spawnResourceRoot ? { spawnResourceRoot: deps.spawnResourceRoot } : {}),
          ...(deps.spawnResourceReader ? { spawnResourceReader: deps.spawnResourceReader } : {}),
          ...(deps.peerMail ? { peerMail: deps.peerMail } : {}),
          ...(priorCoordination?.questions.length
            ? { priorQuestions: priorCoordination.questions }
            : {}),
          ...(priorCoordination?.escalations?.length
            ? { priorEscalations: priorCoordination.escalations }
            : {}),
          ...(priorCoordination?.records.length ? { priorJournal: priorCoordination.records } : {}),
          ...(priorCoordination?.analystDefinitions?.length
            ? { priorAnalystDefinitions: priorCoordination.analystDefinitions }
            : {}),
          ...(nodeTools?.length ? { nodeTools } : {}),
          toolNames: runtimeToolNames,
          onCoordinationTools: (tools, coordination) => slot.bind(tools, coordination),
        },
        coordinationLifetime.signal,
      ).catch((error: unknown) => {
        coordinationLifetime.abort(error)
        throw error
      })
      ledger = mcp
      liveCoordinator = mcp
      // A harness invocation's executor ends with its attempt, and its inbox with it. A message
      // that executor still held moves to `nextTurnInbox`, which the next drive's prompt carries
      // whether it is a wake or a failure re-entry, instead of failing with the executor. Run
      // 18b's core-4 lost a director ruling and a failed-check notice this way, and its next two
      // prompts said "Events waiting for you: none".
      const withNextTurnFallback = (message: unknown): unknown => {
        if (message === null || typeof message !== 'object') return message
        const original = (message as Record<string, unknown>)[INBOX_RECEIPT_KEY]
        return {
          ...message,
          [INBOX_RECEIPT_KEY]: (receipt: InboxReceipt) => {
            const queued =
              receipt.status === 'failed' &&
              receipt.cause === 'closed' &&
              nextTurnInbox.deliver(message)
            if (!queued && typeof original === 'function') original(receipt)
          },
        }
      }
      managerInbox = (message) => {
        if (
          deliver !== undefined &&
          harnessInvocationActive &&
          (deliverReady === undefined || deliverReady()) &&
          deliver(withNextTurnFallback(message))
        ) {
          return true
        }
        const envelope =
          message !== null && typeof message === 'object'
            ? (message as Record<string, unknown>)[PEER_MAIL_WIRE_KEY]
            : undefined
        if (deps.peerMailUrl && isPeerMailEnvelope(envelope)) {
          return nextTurnInbox.deliver({ [PEER_MAIL_WIRE_KEY]: envelope })
        }
        return controls.receiveLeadMessage(message)
      }
      const coordinationTools = slot.descriptors()
      const providerProfile = detachedSnapshot(
        providerVisibleProfile(stableProfile),
        'supervisorAgent provider-visible profile',
      )
      let controlObserver: ReturnType<typeof observeWorkerControls> | undefined
      try {
        if (deps.controlDir !== undefined || deps.steerDir !== undefined) {
          controlObserver = observeWorkerControls({
            ...(deps.controlDir === undefined ? {} : { dir: deps.controlDir }),
            ...(deps.steerDir === undefined ? {} : { steerDir: deps.steerDir }),
            coord: controls,
            scope,
            signal: coordinationLifetime.signal,
            controlScope: deps.controlScope ?? 'run',
            ...(deps.controlScope === 'subtree'
              ? {}
              : {
                  deliverRoot: (message: RootSteer) => managerInbox?.(message) ?? false,
                  // Between turns a root steer is the input of the next wake, so it is always
                  // deliverable once the coordinator exists.
                  deliverRootReady: () => true,
                }),
            onError: (error) => {
              coordinationLifetime.abort(error)
              stopController.abort(error)
            },
          })
        }
        // A restored `submission` record proves this manager's completion check already accepted
        // the value. Return it before starting another harness process.
        const recoveredSubmission = mcp.submittedResult()
        if (recoveredSubmission) {
          deps.onAcceptedSubmission?.(recoveredSubmission.result)
          return recoveredSubmission.result
        }
        // The retry's progress mark. `tokensLeft` only falls, so the difference from the first
        // reading is everything this run has spent from the shared pool — the driver's own turns
        // and any child's. Those two channels are the BURN rate, not the goal, so they are reported
        // beside the contract's verdict and the retry policy reads them together: with a declared
        // check unmet, spend and settlements alone do not buy another attempt.
        const baseTokensLeft = scope.budget.tokensLeft
        const contractDeclared = deps.deliverable !== undefined
        const continuation = deps.continuation
        if (continuation !== undefined && deps.deliverable !== undefined) {
          keeper = createContinuationKeeper({
            policy: continuation,
            task,
            ...(deps.deliverable.describe === undefined ? {} : { owed: deps.deliverable.describe }),
            ...(deps.deliverable.feedback === undefined
              ? {}
              : { feedback: deps.deliverable.feedback }),
            ...(deps.deliverable.sealed === true ? { sealed: true } : {}),
            reads: () => controls.checkReads(),
            workers: () => {
              const labels = new Map(
                ((scope as Partial<Scope<unknown>>).view?.nodes ?? []).map((node) => [
                  node.id,
                  node.label,
                ]),
              )
              return mcp
                .settled()
                .map((worker) => ({ id: worker.id, label: labels.get(worker.id) ?? worker.id }))
            },
            ...(deps.continuationDir === undefined ? {} : { dir: deps.continuationDir }),
            traces: () => {
              const rootStreamPath = deps.rootStreamPath
              return runTraceAnalysisStore({
                ...(rootStreamPath === undefined
                  ? {}
                  : {
                      root: {
                        id: scope.view.root,
                        read: () => readRootStream(dirname(rootStreamPath)),
                      },
                    }),
                workers: mcp.settled(),
                blobs: deps.blobs,
              })
            },
            canReadMore: runtimeToolNames.includes('read_continuation'),
            canSubmitResult: runtimeToolNames.includes('submit_result'),
          })
        }
        let candidate: unknown
        // The finalizer's check of the best delivered child is a check read like any other: the
        // continuation note reports what the check said about the candidate the run would return.
        const finalizerDeliverable =
          deps.deliverable === undefined
            ? undefined
            : {
                ...deps.deliverable,
                check: async (out: unknown) => {
                  let verdict: ReturnType<typeof checkVerdictOf>
                  try {
                    verdict = checkVerdictOf(await deps.deliverable?.check(out))
                  } catch (error) {
                    controls.recordCheckRead({
                      source: 'turn-end',
                      unavailable: error instanceof Error ? error.message : String(error),
                    })
                    throw error
                  }
                  controls.recordCheckRead({ source: 'turn-end', verdict })
                  return verdict
                },
              }
        const finalize = () =>
          runFinalizer(deps.finalizer ?? bestDelivered, {
            settled: mcp.settled(),
            blobs: deps.blobs,
            tree: runTree(scope),
            budget: scope.budget,
            ...(finalizerDeliverable ? { deliverable: finalizerDeliverable } : {}),
          })
        const readProgress = (): DriverProgressMark => {
          const settled = mcp.settled()
          // Child delivery is progress, but its check may cover only the child's assignment.
          const deliveredCount = settled.filter(
            (w) => w.status === 'done' && w.valid === true,
          ).length
          const submitted = Boolean(mcp.submittedResult())
          const composite = bestComposite(controls.checkReads())
          return {
            poolTokensSpent: baseTokensLeft - scope.budget.tokensLeft,
            settledCount: settled.length,
            submitted,
            deliveredCount,
            contract: !contractDeclared
              ? 'none'
              : submitted || candidate !== undefined
                ? 'met'
                : 'unmet',
            ...(composite === undefined ? {} : { composite }),
          }
        }
        /**
         * The check runs when a turn ends without an accepted result. A read already taken in this
         * turn stands (the manager just heard it); otherwise a check that judges state reads the
         * run now. A check that could not run is not a verdict: the loop pauses.
         */
        const readCheckAtTurnEnd = async (attempt: number): Promise<void> => {
          const deliverable = deps.deliverable
          if (deliverable === undefined) return
          const thisTurn = controls.checkReads().filter((read) => read.attempt === attempt)
          const last = thisTurn.at(-1)
          if (last === undefined && deliverable.checkState !== undefined) {
            try {
              const verdict = checkVerdictOf(await deliverable.checkState())
              controls.recordCheckRead({ source: 'turn-end', verdict })
              return
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              controls.recordCheckRead({ source: 'turn-end', unavailable: message })
              throw new CheckUnavailableError(`the completion check could not run: ${message}`, {
                cause: error,
              })
            }
          }
          if (last?.unavailable !== undefined) {
            throw new CheckUnavailableError(
              `the completion check could not run: ${last.unavailable}`,
            )
          }
        }
        const loopRecords: DriverAttemptRecord[] = []
        let deadlineWarned = false
        // The wake a re-entered drive was given, kept so `refresh` can bring it up to date.
        let pendingWake:
          | { readonly attempt: number; readonly wake: ManagerWake; readonly at: number }
          | undefined
        const managerStartedAt = Date.now()
        let environmentReplacements = 0
        let workspaceRestores = 0
        const describe = deps.deliverable?.describe
        const session = deps.continuation?.session
        const settleLoop = () => {
          const stopReason = controls.stopReason() ?? progressStopReason
          const closedBy: DriverContinuationRecord['closedBy'] = mcp.submittedResult()
            ? 'result-accepted'
            : mcp.isStopped()
              ? 'stop'
              : progressStopReason !== undefined
                ? 'stop-rule'
                : undefined
          const blocked = controls.blocked()
          deps.onDriverLoopSettled?.({
            ...summarizeDriverAttempts(loopRecords),
            environmentReplacements,
            workspaceRestores,
            ...(closedBy === undefined ? {} : { closedBy }),
            ...(blocked.length === 0 ? {} : { blocked }),
            ...(stopReason === undefined ? {} : { stopReason }),
            continuations: keeper?.entries() ?? [],
          })
        }
        // A run this process took over after the process driving it stopped: its first drive
        // names the workers that were open, and which of them this process re-places.
        let modelEvents = 0
        const reenteredWorkers = scope.resume?.reentered
        const reentered =
          reenteredWorkers === undefined
            ? undefined
            : {
                first: { reason: 'run-reentered' as const, ...reenteredWorkers },
                modelEvents: () => modelEvents,
              }
        let driverFailed = true
        try {
          await runDriverWithRetry({
            ...(reentered === undefined ? {} : { reentered }),
            drive: async (attempt, reentry) => {
              candidate = undefined
              if (deps.controlDir !== undefined && deps.abortRun !== undefined) {
                applyRunCancellation(deps.controlDir, deps.abortRun, () => new Date().toISOString())
              }
              scope.signal.throwIfAborted()
              // Every drive after the first is a new execution attempt of the root.
              beginScopeOwnerAttempt(scope, attempt)
              controls.beginDriverAttempt(attempt)
              // A re-entered drive receives the original objective and the coordinator's run state
              // unless the harness proves the turn continues the same session. The unmet items
              // alone are the whole turn only then: a replacement sandbox knows nothing else.
              let current = reentry
              const held = pendingWake?.attempt === attempt ? pendingWake : undefined
              pendingWake = undefined
              const refresh =
                held === undefined || current?.reason !== 'wake'
                  ? undefined
                  : async () => {
                      const signal = AbortSignal.any([scope.signal, stopController.signal])
                      // No wait: publish what settled since the wake and take it for this turn.
                      const later = await controls.awaitWake({
                        attempt,
                        signal,
                        heartbeatMs: 0,
                        debounceMs: 0,
                      })
                      if (signal.aborted || current?.reason !== 'wake') return
                      current = {
                        ...current,
                        input: composeWakeInput(
                          refreshedWake(held.wake, later, Date.now() - held.at),
                          {
                            tools: runtimeToolNames,
                            deadlineMs: scope.budget.deadlineMs,
                            now: Date.now(),
                          },
                        ),
                      }
                    }
              // A fresh session holds no earlier turn, so whatever a harness claims about the
              // session, the task it composes is the full re-entry task.
              const compose =
                current === undefined
                  ? undefined
                  : (continuity: ReentryContinuity) =>
                      composeReentryTask({
                        originalTask: task,
                        tools: runtimeToolNames,
                        ...(describe === undefined ? {} : { contract: describe }),
                        reentry: current!,
                        continuity:
                          session === 'fresh' ? { ...continuity, session: 'new' } : continuity,
                        state: controls.reentryState(),
                        attempt,
                      })
              const carried = nextTurnInbox.take()
              const carriedText =
                carried.messages.length === 0 ? undefined : nextTurnInbox.fold(carried.messages)
              const withCarried = (input: unknown): string | unknown =>
                carriedText === undefined
                  ? input
                  : `${typeof input === 'string' ? input : (JSON.stringify(input) ?? String(input))}\n\n${carriedText}`
              harnessInvocationActive = true
              let completed = false
              try {
                await driveHarness({
                  profile: providerProfile,
                  authoredProfile: stableProfile,
                  ...(registeredProfile === stableProfile ? {} : { registeredProfile }),
                  ...(profilePrompt !== undefined ? { systemPrompt: profilePrompt } : {}),
                  ...(session === undefined ? {} : { session }),
                  task: withCarried(compose === undefined ? task : compose(UNPROVEN_CONTINUITY)),
                  ...(compose === undefined
                    ? {}
                    : {
                        reentry: {
                          reason: reentry!,
                          compose: (continuity: ReentryContinuity) =>
                            withCarried(compose(continuity)) as string,
                          ...(refresh === undefined ? {} : { refresh }),
                          onContinuity: (continuity: ReentryContinuity) => {
                            if (continuity.environment === 'replaced') environmentReplacements += 1
                            if (continuity.workspace === 'restored') workspaceRestores += 1
                          },
                        },
                      }),
                  scope,
                  coordinationMcpUrl: mcp.url,
                  coordinationMcpHeaders: mcp.headers,
                  ...(deps.peerMailUrl ? { peerMailUrl: deps.peerMailUrl } : {}),
                  stopSignal: stopController.signal,
                  coordinationTools,
                  onModelEvent: () => {
                    modelEvents += 1
                  },
                })
                completed = true
              } catch (error) {
                // Once the injected check has accepted a result, a later backend shutdown/timeout
                // cannot erase that completed work — and there is nothing left to retry FOR. Without
                // an accepted submission the backend error propagates into the retry decision.
                if (!mcp.submittedResult() && !mcp.isStopped()) throw error
                completed = true
              } finally {
                // A completed invocation read what it carried; a failed one hands it to the next.
                if (completed) {
                  for (const message of carried.messages) {
                    carried.commit(`${scope.view.root}#attempt-${attempt}`, message.id)
                  }
                } else carried.release()
                harnessInvocationActive = false
                // A completed turn processed what it received; a failed one leaves it for the next
                // re-entry to name. Recorded before the retry decision reads the run.
                if (completed) await controls.endDriverAttempt('completed')
                else await controls.endDriverAttempt('failed').catch(() => undefined)
              }
              // Decide this parent's completion before the retry loop reads progress. Cache the
              // checked candidate so neither the finalizer nor its oracle runs twice on return.
              // A turn that ended with work open is a wait: the manager decides when it is done.
              if (contractDeclared && !mcp.submittedResult() && !controls.hasOpenWork()) {
                await mcp.drainResolved()
                candidate = await finalize()
                if (candidate === undefined && !mcp.isStopped()) await readCheckAtTurnEnd(attempt)
              }
            },
            progress: readProgress,
            budget: () => scope.budget,
            signal: scope.signal,
            resolvePending: (failure, failures) =>
              abandonScopeRetainedOwnerInvocation(scope, failure, failures),
            wait: {
              open: () =>
                !mcp.submittedResult() &&
                !mcp.isStopped() &&
                progressStopReason === undefined &&
                // A steer an ended invocation never read is open work: one more turn folds it.
                (controls.hasOpenWork() || nextTurnInbox.pendingAuthority() > 0),
              wake: async (nextAttempt) => {
                const deadlineMs = scope.budget.deadlineMs
                const warnAt = deadlineWarningAt(
                  deadlineMs,
                  wakePolicy,
                  deadlineWarned,
                  managerStartedAt,
                )
                waitingOn = scope.view.nodes.filter(
                  (node) => node.id !== scope.view.root && isLiveNodeStatus(node.status),
                ).length
                try {
                  const wake = await controls.awaitWake({
                    attempt: nextAttempt,
                    quietWhileProgressing: true,
                    // A stop (accepted result, stop rule, the manager's own stop) ends the wait too.
                    signal: AbortSignal.any([scope.signal, stopController.signal]),
                    heartbeatMs: wakePolicy.heartbeatMs,
                    alsoWakeOn:
                      nextTurnInbox.pending() > 0
                        ? Promise.resolve()
                        : nextTurnInbox.nextDelivery(),
                    debounceMs: wakePolicy.debounceMs,
                    ...(warnAt === undefined ? {} : { deadlineAt: warnAt }),
                  })
                  if (wake === undefined || stopController.signal.aborted) return undefined
                  if (wake.reason === 'deadline') deadlineWarned = true
                  pendingWake = { attempt: nextAttempt, wake, at: Date.now() }
                  return {
                    input: composeWakeInput(wake, {
                      tools: runtimeToolNames,
                      deadlineMs,
                      now: Date.now(),
                    }),
                    idleMs: wake.idleMs,
                  }
                } finally {
                  waitingOn = undefined
                }
              },
            },
            ...(deps.driverRetry ? { policy: deps.driverRetry } : {}),
            ...(continuation !== undefined && keeper !== undefined && continuationDeadlineMs
              ? {
                  continuation: {
                    maxBarren: continuation.maxBarren,
                    deadlineMs: continuationDeadlineMs,
                    compose: (context) => (keeper as ContinuationKeeper).compose(context),
                    // A run the coordination server closed ended on purpose — the manager's own
                    // `stop` (served only without a check), or a progress stop rule that aborted
                    // the stop signal. A continuation would re-enter a harness told to stop.
                    closed: () => mcp.isStopped() || progressStopReason !== undefined,
                  },
                }
              : {}),
            onAttempt: async (record) => {
              loopRecords.push(record)
              await recordScopeOwnerDriverAttempt(scope, record)
              // A pause on an unavailable upstream is infrastructure time, so the run's own
              // journal records it; the caller's observer still sees every attempt.
              if (record.classification === 'unavailable' && record.retryInMs !== undefined) {
                await recordScopeOwnerPause(scope, {
                  attempt: record.attempt,
                  signal: record.unavailableSignal ?? 'unavailable',
                  cause: record.error ?? '',
                  attemptMs: record.durationMs,
                  pauseMs: record.retryInMs,
                  madeProgress: record.madeProgress,
                })
              }
              await deps.onDriverAttempt?.(record)
            },
          })
          driverFailed = false
        } finally {
          await driveHarness.closeSeatSegment?.(
            scope.signal.aborted ? 'cancelled' : driverFailed ? 'failed' : 'completed',
          )
          settleLoop()
        }
        // Without a parent oracle, preserve the single finalization after the driver finishes.
        if (!contractDeclared) await mcp.drainResolved()
        // Direct work is eligible only through `submit_result`, after the injected independent
        // check passes. Raw harness prose remains ineligible.
        const submitted = mcp.submittedResult()
        if (submitted) {
          deps.onAcceptedSubmission?.(submitted.result)
          await mcp.finishAnalysis({ status: 'done', output: submitted.result })
          return submitted.result
        }
        if (contractDeclared) {
          await mcp.finishAnalysis({ status: 'done', output: candidate })
          return candidate
        }
        const finalized = await finalize()
        if (finalized !== undefined) {
          await mcp.finishAnalysis({ status: 'done', output: finalized })
          return finalized
        }
        // An unchecked child may do direct work. Retain its terminal report through the same
        // settlement and blob reader, without treating native completion as quality acceptance.
        const harnessResult = driveHarness.resultArtifact?.()
        if (
          nodeContextSeed !== undefined &&
          nodeContextSeed.depth > 0 &&
          harnessResult?.out !== undefined &&
          harnessResult.out !== null
        ) {
          deps.onUnassessedOutput?.(harnessResult.out)
          await mcp.finishAnalysis({ status: 'done', output: harnessResult.out })
          return harnessResult.out
        }
        await mcp.finishAnalysis({ status: 'done' })
        return undefined
      } catch (error) {
        await mcp.finishAnalysis({
          status: 'down',
          reason: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        managerInbox = undefined
        nextTurnInbox.failPending('the manager finished before a turn read the message')
        coordinationLifetime.abort(new Error('supervisor manager stopped'))
        try {
          await controlObserver?.close()
        } finally {
          await mcp.close()
        }
      }
    },
  }
  const runtime = runtimeOwnedScopeOwnerRuntime(driveHarness)
  return runtime === undefined
    ? externalAgent
    : attestRuntimeOwnedScopeOwner(externalAgent, runtime)
}
