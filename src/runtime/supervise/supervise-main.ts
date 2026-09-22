import type { AgentProfile } from '@tangle-network/agent-interface'
import { agentProfileSchema } from '@tangle-network/agent-interface'
import {
  fullProfileMaterialization,
  type ProfileMaterializationContract,
  promptControlProfileMaterialization,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  AuthorizeDownMessage,
  MakeWorkerAgent,
} from '../../mcp/tools/coordination-types'
import { composeRuntimeHooks } from '../../runtime-hooks'
import { assertValidBudget } from './budget'
import { runtimeOwnedScopeOwnerRuntime } from './materialization'
import { assertModelAllowed, assertProfileModelsAllowed } from './model-policy'
import { createSupervisorSpanRecorder, type SupervisorSpanRecorder } from './otel-spans'
import { createFileRunContext, createInMemoryRunContext } from './run-context'
import {
  assertProfileContract,
  automaticDriverBackendSupported,
  backendProfileMaterialization,
  backendProfileOverlays,
  driveHarnessFromBackend,
  externalExecutionId,
  isExternalSupervisor,
  routerSupervisorProfileMaterialization,
  workerTraceUnpropagatedDeclaration,
} from './supervise-backend'
import {
  canonicalExecution,
  canonicalSupervisorProfileInput,
  captureSuperviseOptions,
  coordinationEventId,
  defaultPerWorker,
  freezeDetached,
  freezeDetachedProfile,
  resolveNamed,
  rootCoordinationOwner,
  supervisionRunNamespace,
} from './supervise-options'
import type { SuperviseOptions } from './supervise-options-types'
import { createBackendWorkerFactory } from './supervise-recursive'
import { createSupervisor } from './supervisor'
import type {
  DriveHarness,
  DriveHarnessOwnerContext,
  ObserveSupervisorNodeEvent,
  SupervisorProfile,
} from './supervisor-agent'
import { assertCoordinationBinding, supervisorAgent } from './supervisor-agent'

/** Build and run one supervisor from its profile with durable control options. */
export function supervise(profile: SupervisorProfile, task: unknown, opts: SuperviseOptions) {
  const options = captureSuperviseOptions(opts)
  if (options.controlCapabilityToken !== undefined && options.runDir === undefined) {
    throw new ValidationError('supervise: controlCapabilityToken requires runDir')
  }
  assertValidBudget(options.budget, 'supervise budget')
  const parsedProfile = agentProfileSchema.safeParse(canonicalSupervisorProfileInput(profile))
  if (!parsedProfile.success) {
    throw new ValidationError(`supervise: invalid AgentProfile: ${parsedProfile.error.message}`)
  }
  const canonicalProfile = freezeDetachedProfile(parsedProfile.data)
  const canonicalTask = freezeDetached(task)
  if (options.makeWorkerAgent && options.authorizeSpawn) {
    throw new ValidationError(
      'supervise: authorizeSpawn cannot be combined with caller-owned makeWorkerAgent; wrap and authorize the custom factory explicitly or use backend-derived workers',
    )
  }
  if (options.makeWorkerAgent && options.resolveDeliverable) {
    throw new ValidationError(
      'supervise: resolveDeliverable applies only to backend-derived workers; wrap a caller-owned makeWorkerAgent with its completion checks explicitly',
    )
  }
  const authorizeDownFor = (
    parent: AgentProfile,
    depth: number,
  ): AuthorizeDownMessage | undefined => {
    if (!options.authorizeSpawn && !options.authorizeMessage) return undefined
    return (input) => {
      if (!options.authorizeMessage) {
        throw new ValidationError(
          'supervise: authorizeMessage is required before steer_agent or answer_question when authorizeSpawn is enabled',
        )
      }
      return freezeDetached(options.authorizeMessage(freezeDetached({ ...input, parent, depth })))
    }
  }
  const rootExecution = canonicalExecution(
    canonicalProfile,
    canonicalTask,
    options.execution,
    'supervise root',
  )
  const backendModel = (options.backend as { model?: unknown } | undefined)?.model
  const driverBackendModel = (options.driverBackend as { model?: unknown } | undefined)?.model
  if (
    [...backendProfileOverlays(options.backend), ...backendProfileOverlays(options.driverBackend)]
      .length > 0
  ) {
    throw new ValidationError(
      'supervise: backend agentProfile overlays are not allowed because they run after spawn authorization; merge the overlay into the exact profile before calling supervise',
    )
  }
  assertModelAllowed(options.router?.model, options.allowedModels)
  assertProfileModelsAllowed(canonicalProfile, options.allowedModels)
  assertModelAllowed(
    typeof backendModel === 'string' ? backendModel : undefined,
    options.allowedModels,
  )
  assertModelAllowed(
    typeof driverBackendModel === 'string' ? driverBackendModel : undefined,
    options.allowedModels,
  )
  const deliverable = resolveNamed(
    'deliverable',
    'deliverables',
    options.deliverable,
    options.registry?.deliverables,
  )
  const finalizer = resolveNamed(
    'finalizer',
    'finalizers',
    options.finalizer,
    options.registry?.finalizers,
  )
  const analysts = resolveNamed(
    'analysts',
    'analysts',
    options.analysts,
    options.registry?.analysts,
  )
  const probes = resolveNamed('probes', 'probes', options.probes, options.registry?.probes)
  assertCoordinationBinding(options.coordination)

  const ctx =
    options.runDir !== undefined
      ? createFileRunContext(options.runDir, { withDriver: true })
      : createInMemoryRunContext({ withDriver: true })
  const blobs = options.blobs ?? ctx.blobs
  const perWorker = options.perWorker ?? defaultPerWorker(options.budget)
  assertValidBudget(perWorker, 'supervise perWorker')
  const journal = options.journal ?? ctx.journal
  const runId = options.runId ?? 'supervise'
  const runNamespace = supervisionRunNamespace(options.runDir, runId)
  const log = ctx.coordinationLog
  const rootOwnerId = rootCoordinationOwner(rootExecution.identity)
  const observeNodeEvent: ObserveSupervisorNodeEvent | undefined = options.onCoordinationEvent
    ? async (context, event, record) => {
        await options.onCoordinationEvent?.(context, coordinationEventId(context, event), record)
      }
    : undefined
  const managerBackend = options.driverBackend ?? options.backend
  if (options.driveHarness && options.resolveDriveHarness) {
    throw new ValidationError('supervise: provide driveHarness or resolveDriveHarness, not both')
  }
  const hasCustomDriveHarness = Boolean(options.driveHarness || options.resolveDriveHarness)
  const driverMaterialization = hasCustomDriveHarness
    ? (options.driveHarnessMaterialization ?? fullProfileMaterialization)
    : managerBackend && automaticDriverBackendSupported(managerBackend)
      ? backendProfileMaterialization(managerBackend)
      : undefined
  if (
    isExternalSupervisor(canonicalProfile) &&
    !options.driveHarness &&
    !options.resolveDriveHarness &&
    (!managerBackend || !automaticDriverBackendSupported(managerBackend))
  ) {
    throw new ValidationError(
      `supervise: external supervisor profile.harness=${JSON.stringify(canonicalProfile.harness)} requires a local bridge driverBackend, an explicit driveHarness, or resolveDriveHarness with reachable coordination transport`,
    )
  }
  const harnessClaims = new WeakMap<DriveHarness, { owners: Set<string>; steerable: boolean }>()
  const claimDriveHarness = (rawHarness: unknown, ownerId: string): DriveHarness => {
    if (typeof rawHarness !== 'function') {
      throw new ValidationError(
        'supervise: resolveDriveHarness must return a DriveHarness function',
      )
    }
    const harness = rawHarness as DriveHarness
    if (harness.deliver !== undefined && typeof harness.deliver !== 'function') {
      throw new ValidationError('supervise: driveHarness.deliver must be a function when provided')
    }
    const claim = harnessClaims.get(harness)
    const conflictingOwner = claim
      ? [...claim.owners].find((claimedOwner) => claimedOwner !== ownerId)
      : undefined
    const steerable = typeof harness.deliver === 'function'
    if (conflictingOwner !== undefined && (steerable || claim?.steerable === true)) {
      throw new ValidationError(
        `supervise: steerable driveHarness is already bound to manager owner ${JSON.stringify(conflictingOwner)}; resolveDriveHarness must return a distinct steerable instance for owner ${JSON.stringify(ownerId)}`,
      )
    }
    if (claim) {
      claim.owners.add(ownerId)
      claim.steerable ||= steerable
    } else {
      harnessClaims.set(harness, { owners: new Set([ownerId]), steerable })
    }
    return harness
  }
  const driveHarnessForOwner = (context: DriveHarnessOwnerContext): DriveHarness | undefined => {
    if (options.resolveDriveHarness) {
      return claimDriveHarness(options.resolveDriveHarness(context), context.ownerId)
    }
    if (options.driveHarness) return claimDriveHarness(options.driveHarness, context.ownerId)
    return managerBackend && automaticDriverBackendSupported(managerBackend)
      ? driveHarnessFromBackend(
          managerBackend,
          externalExecutionId('supervised-manager', { runNamespace, ownerId: context.ownerId }),
          options.now ?? Date.now,
        )
      : undefined
  }
  const rootDriveHarness = isExternalSupervisor(canonicalProfile)
    ? driveHarnessForOwner(
        freezeDetached({
          runId,
          runNamespace,
          ownerId: rootOwnerId,
          depth: 0,
          identity: rootExecution.identity,
          profile: canonicalProfile,
          task: canonicalTask,
        }),
      )
    : undefined
  const rootOwnerRuntime =
    !isExternalSupervisor(canonicalProfile) || rootDriveHarness === undefined
      ? undefined
      : runtimeOwnedScopeOwnerRuntime(rootDriveHarness)
  assertProfileContract(
    canonicalProfile,
    isExternalSupervisor(canonicalProfile)
      ? (driverMaterialization as ProfileMaterializationContract)
      : options.brain
        ? promptControlProfileMaterialization
        : routerSupervisorProfileMaterialization,
    'supervise root',
  )

  const now = options.now ?? Date.now
  let spans: SupervisorSpanRecorder | undefined
  const traceUnpropagated = options.backend
    ? workerTraceUnpropagatedDeclaration(options.backend.backend)
    : undefined
  let makeWorkerAgent: MakeWorkerAgent | undefined = options.makeWorkerAgent
  if (!makeWorkerAgent) {
    if (!options.backend) {
      throw new ValidationError(
        'supervise: provide opts.backend (where workers run) or opts.makeWorkerAgent',
      )
    }
    makeWorkerAgent = createBackendWorkerFactory({
      options,
      backend: options.backend,
      canonicalProfile,
      rootIdentity: rootExecution.identity,
      runId,
      runNamespace,
      rootOwnerId,
      deliverable,
      blobs,
      journal,
      ...(finalizer ? { finalizer } : {}),
      ...(analysts ? { analysts: analysts as AnalystRegistry } : {}),
      ...(log ? { log } : {}),
      ...(observeNodeEvent ? { observeNodeEvent } : {}),
      ...(driverMaterialization ? { driverMaterialization } : {}),
      driveHarnessForOwner,
      authorizeDownFor,
    })
  }
  const workerFactory = makeWorkerAgent
  const start = async () => {
    const priorCoordination = log ? await log.load(runId, rootOwnerId) : undefined
    const authorizeRootMessage = authorizeDownFor(canonicalProfile, 1)
    const agent = supervisorAgent(canonicalProfile, {
      blobs,
      makeWorkerAgent: workerFactory,
      ...(authorizeRootMessage ? { authorizeDownMessage: authorizeRootMessage } : {}),
      perWorker,
      ...(log ? { onEvent: (_event, record) => log.append(runId, record, rootOwnerId) } : {}),
      ...(deliverable ? { deliverable } : {}),
      ...(priorCoordination &&
      (priorCoordination.questions.length > 0 ||
        priorCoordination.findings.length > 0 ||
        priorCoordination.continuations.length > 0 ||
        priorCoordination.deliveryEvidence.length > 0)
        ? { priorCoordination }
        : {}),
      ...(finalizer ? { finalizer } : {}),
      ...(options.coordination ? { coordination: options.coordination } : {}),
      ...(options.maxLiveWorkers !== undefined ? { maxLiveWorkers: options.maxLiveWorkers } : {}),
      ...(options.router ? { router: options.router } : {}),
      ...(options.brain ? { brain: options.brain } : {}),
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
      ...(analysts ? { analysts: analysts as AnalystRegistry } : {}),
      ...(options.analyzeOnSettle ? { analyzeOnSettle: options.analyzeOnSettle } : {}),
      ...(options.watchWorkers ? { watchWorkers: options.watchWorkers } : {}),
      ...(options.stallAfterMs !== undefined ? { stallAfterMs: options.stallAfterMs } : {}),
      ...(options.stopRule ? { stopRule: options.stopRule } : {}),
      ...(options.onProgressStop ? { onProgressStop: options.onProgressStop } : {}),
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(options.compaction ? { compaction: options.compaction } : {}),
    })
    spans = options.otel ? createSupervisorSpanRecorder({ runId, ...options.otel, now }) : undefined
    const recorder = spans
    const hooks = recorder ? composeRuntimeHooks(options.hooks, recorder.hooks) : options.hooks
    const supervisor = createSupervisor<unknown, unknown>()
    if (options.rootHandle) supervisor.attach(options.rootHandle)
    const run = supervisor.run(agent, canonicalTask, {
      budget: options.budget,
      runId,
      journal,
      blobs,
      executors: ctx.executors,
      rootIdentity: rootExecution.identity,
      ...(rootOwnerRuntime === undefined
        ? {}
        : {
            rootMaterialization: {
              runtime: rootOwnerRuntime,
              declaration: 'deferred' as const,
              authoredProfile: canonicalProfile,
            },
          }),
      maxDepth: options.maxDepth ?? 8,
      ...(options.maxLiveWorkers !== undefined ? { maxLiveWorkers: options.maxLiveWorkers } : {}),
      ...(probes ? { probes } : {}),
      ...(ctx.resume === true ? { resume: true } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.runDir && options.controlCapabilityToken
        ? { controlDir: options.runDir, controlCapabilityToken: options.controlCapabilityToken }
        : {}),
      ...(hooks ? { hooks } : {}),
      ...(recorder ? { workerTrace: recorder.workerTrace } : {}),
      ...(recorder && traceUnpropagated ? { workerTraceUnpropagated: traceUnpropagated } : {}),
    })
    if (!recorder) return run
    try {
      const result = await run
      await recorder.finish({ result })
      return result
    } catch (error) {
      await recorder.finish({ error })
      throw error
    }
  }
  return start()
}
