import { resolve } from 'node:path'
import {
  type AgentProfile,
  agentProfileSchema,
  validateAgentProfileSecurity,
} from '@tangle-network/agent-interface'
import {
  fullProfileMaterialization,
  type ProfileMaterializationContract,
  promptControlProfileMaterialization,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import type { PeerAuditAccess } from '../../mcp/tools/coordination-contracts'
import type { CoordinationEvent } from '../../mcp/tools/coordination-events'
import type { AuthorizeDownMessage } from '../../mcp/tools/coordination-messages'
import type {
  ChildQuestionInbox,
  QuestionEscalationOutcome,
  QuestionRecord,
} from '../../mcp/tools/coordination-questions'
import type { ToolLoopChat } from '../tool-loop'
import { assertValidBudget } from './budget'
import type { BusRecord } from './event-bus'
import { runtimeOwnedScopeOwnerRuntime } from './materialization'
import {
  assertExecutableAgentProfile,
  assertModelAllowed,
  assertProfileModelsAllowed,
} from './model-policy'
import { createRootStreamSink } from './root-stream'
import { createFileRunContext, createInMemoryRunContext } from './run-context'
import { assertRecursiveReservationPolicy } from './scope'
import { authoredSeatStages } from './seat-chain'
import {
  assertPerWorkerAdmittable,
  assertPerWorkerWithinPool,
  defaultPerWorker,
} from './supervise-budget'
import { driveHarnessFromBackend } from './supervise-driver-session'
import {
  canonicalExecution,
  coordinationEventId,
  externalExecutionId,
  freezeDetached,
  rootCoordinationOwner,
  supervisionRunNamespace,
} from './supervise-identity'
import { captureSuperviseOptions } from './supervise-option-capture'
import type { SuperviseOptions } from './supervise-options'
import {
  assertBackendProfileMaterialization,
  assertProfileContract,
  automaticDriverBackendSupported,
  backendProfileMaterialization,
  DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY,
  isExternalSupervisor,
  routerSupervisorProfileMaterialization,
  withInheritedSpawnRights,
} from './supervise-profile-admission'
import { resolveNamed, snapshotProfileTable } from './supervise-registry'
import {
  admitSegment,
  profileGuidanceComposer,
  rootSpawnResourceRoot,
  superviseRootProfile,
  withRootSegment,
} from './supervise-root-profile'
import {
  bridgeSpawnPreflight,
  composeSpawnPreflights,
  coordinationChannelSpawnPreflight,
  profileToolSpawnPreflight,
  providerSpawnPreflight,
} from './supervise-spawn-preflight'
import { workerTraceUnpropagatedDeclaration } from './supervise-worker-backend'
import {
  assertCoordinationBinding,
  coordinationProfileToolPrefix,
  type DriveHarness,
  type DriveHarnessOwnerContext,
  declaredRuntimeToolNames,
  type SupervisorNodeContext,
  type SupervisorProfile,
} from './supervisor-agent'

export function prepareSuperviseRun(
  profile: SupervisorProfile,
  task: unknown,
  opts: SuperviseOptions,
  testBrain?: ToolLoopChat,
) {
  const options = captureSuperviseOptions(opts)
  if (options.runContext?.durability === 'sql') {
    if (
      options.runDir !== undefined ||
      (options.journal !== undefined && options.journal !== options.runContext.journal) ||
      (options.blobs !== undefined && options.blobs !== options.runContext.blobs) ||
      (options.runId !== undefined && options.runId !== options.runContext.runId)
    ) {
      throw new ValidationError(
        'supervise: SQL runContext cannot be mixed with another run identity or persistence path',
      )
    }
    if (
      options.backend?.backend !== 'provider' ||
      options.makeWorkerAgent ||
      options.makeLeafAgent
    ) {
      throw new ValidationError(
        'supervise: SQL runContext requires backend-derived retained provider workers',
      )
    }
  }
  assertValidBudget(options.budget, 'supervise budget')
  // Fail loud before any compute: every configured model must be in the allowed subset (no-op
  // when allowedModels is unset). The backend seam carries its own model on most backends.
  const guidanceComposer = profileGuidanceComposer(options.profileGuidance)
  const applyTraceTools = (profile: AgentProfile): AgentProfile => {
    if (options.traceTools !== false || profile.tools === undefined) return profile
    const tools = Object.fromEntries(
      Object.entries(profile.tools).filter(
        ([name]) =>
          name !== `${coordinationProfileToolPrefix}observe_agent` &&
          name !== `${coordinationProfileToolPrefix}read_journal`,
      ),
    )
    return agentProfileSchema.parse({ ...profile, tools })
  }
  const composeSpawnProfile =
    options.traceTools === false
      ? (profile: AgentProfile) => applyTraceTools(guidanceComposer?.(profile) ?? profile)
      : guidanceComposer
  const auditPeers = new Map<string, { parent: string; tools: ReadonlyArray<McpToolDescriptor> }>()
  const peerAuditFor = (parent: string): PeerAuditAccess | undefined =>
    options.peerAudit
      ? {
          register: (nodeId, tools) => {
            auditPeers.set(nodeId, { parent, tools })
          },
          read: async (peerId, name, args) => {
            const peer = auditPeers.get(peerId)
            if (peer?.parent !== parent) return { error: 'unknown-peer' }
            // A scope records its descendants. Its own root's provider events belong to the parent.
            const rootRead =
              name === 'observe_agent' &&
              args.tree !== true &&
              args.outRef === undefined &&
              (args.workerId === undefined || args.workerId === peerId)
            const tools = rootRead ? auditPeers.get(parent)?.tools : peer.tools
            const tool = tools?.find((tool) => tool.name === name)
            return tool
              ? tool.handler(rootRead ? { ...args, workerId: peerId } : args)
              : { error: 'peer-tool-unavailable' }
          },
        }
      : undefined
  // The recorded root profile fixes the run's identity; a segment only alters what it executes.
  const registeredProfile = applyTraceTools(superviseRootProfile(profile, options.profileGuidance))
  if (options.segment !== undefined) admitSegment(options.segment)
  const canonicalProfile =
    options.segment === undefined
      ? registeredProfile
      : withRootSegment(registeredProfile, options.segment)
  assertExecutableAgentProfile(canonicalProfile, 'supervise root')
  if (authoredSeatStages(canonicalProfile) !== undefined && options.selectSeat === undefined) {
    throw new ValidationError('supervise: AgentProfile.seats requires selectSeat before execution')
  }
  const canonicalTask = freezeDetached(task)
  if (options.makeWorkerAgent && options.authorizeSpawn) {
    throw new ValidationError(
      'supervise: authorizeSpawn cannot be combined with caller-owned makeWorkerAgent; use makeLeafAgent to override leaf execution inside the authorized path, or use backend-derived workers',
    )
  }
  if (options.makeWorkerAgent && options.makeLeafAgent) {
    throw new ValidationError(
      'supervise: makeWorkerAgent replaces the worker path and makeLeafAgent overrides a leaf inside it; pass one',
    )
  }
  if (options.makeWorkerAgent && (options.workerRetry || options.onWorkerRetry)) {
    throw new ValidationError(
      'supervise: workerRetry applies only to backend-derived workers; compose withWorkerSpawnRetry onto a caller-owned makeWorkerAgent explicitly',
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
      return freezeDetached(
        options.authorizeMessage(
          freezeDetached({
            ...input,
            parent,
            depth,
          }),
        ),
      )
    }
  }
  const rootExecution = canonicalExecution(
    registeredProfile,
    canonicalTask,
    options.execution,
    'supervise root',
  )
  const backendModel = (options.backend as { model?: unknown } | undefined)?.model
  const driverBackendModel = (options.driverBackend as { model?: unknown } | undefined)?.model
  assertProfileModelsAllowed(canonicalProfile, options.allowedModels)
  for (const stage of authoredSeatStages(canonicalProfile) ?? []) {
    assertModelAllowed(stage.model, options.allowedModels)
  }
  assertModelAllowed(
    typeof backendModel === 'string' ? backendModel : undefined,
    options.allowedModels,
  )
  assertModelAllowed(
    typeof driverBackendModel === 'string' ? driverBackendModel : undefined,
    options.allowedModels,
  )

  // Named options become values before anything is built or spent — an unknown name is a
  // configuration fault, and a fault that surfaces after a run started has already cost budget.
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
  // The spawn path applies these checks to the profile `authorizeSpawn` returns, so they can run
  // early only when no caller-owned authorization or worker seam sits between the entry and mount.
  const profileTable = snapshotProfileTable(
    options.registry?.profiles,
    options.allowedModels,
    options.makeWorkerAgent === undefined && options.authorizeSpawn === undefined
      ? (entry, context) => {
          const security = validateAgentProfileSecurity(
            entry,
            options.profileSecurity ?? DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY,
          )
          if (!security.ok) {
            const details = security.issues
              .filter((issue) => issue.level === 'error')
              .map((issue) => `${issue.code}${issue.path ? ` at ${issue.path}` : ''}`)
              .join(', ')
            throw new ValidationError(`${context}: ${details}`)
          }
          // A leaf runs on the worker backend, which refuses any profile axis it cannot carry.
          if (
            options.backend !== undefined &&
            options.makeLeafAgent === undefined &&
            declaredRuntimeToolNames(entry).length === 0
          ) {
            assertBackendProfileMaterialization(entry, options.backend, context)
          }
        }
      : undefined,
  )
  assertCoordinationBinding(options.coordination)

  // `withDriver: true` is the wiring invariant: a child constructed by `driverChild` must resolve
  // to the nested-scope executor; `runDir` only changes where the journal and blobs live.
  const ctx =
    options.runContext ??
    (options.runDir !== undefined
      ? createFileRunContext(options.runDir, { withDriver: true })
      : createInMemoryRunContext({ withDriver: true }))
  const blobs = options.blobs ?? ctx.blobs
  assertRecursiveReservationPolicy(options.reservationPolicy)
  const ownerShare = options.reservationPolicy?.ownerShare ?? 0
  const perWorker = options.perWorker ?? defaultPerWorker(options.budget, ownerShare)
  assertValidBudget(perWorker, 'supervise perWorker')
  // A per-child ceiling larger than the pool it draws from cannot be honored, so accepting it
  // silently misleads the caller: the child is capped by the reservation instead and settles with
  // a `budgetViolation` against that smaller reservation, which reads as a budget outcome rather
  // than a misconfiguration. Observed in the field with perWorker.maxTokens = 3_200_000_000 against a
  // 200_000_000 pool, where children were still clamped at 700_000 and the caller had no way to
  // tell the knob was inert. Refuse at construction, where the caller can still fix it.
  assertPerWorkerWithinPool(perWorker, options.budget)
  // A pool-sized ceiling can still be one no child is ever admitted under: the owner's kept share
  // leaves less than it, or nothing remains for the owner's next turn. Five Discovery team runs
  // died that way hours in. Only a caller-named slice is checked; the default is the runtime's own.
  if (options.perWorker !== undefined)
    assertPerWorkerAdmittable(perWorker, options.budget, ownerShare)
  const journal = options.journal ?? ctx.journal
  const runId = options.runId ?? ctx.runId ?? 'supervise'
  const runNamespace = ctx.namespace ?? supervisionRunNamespace(options.runDir, runId)
  const log = ctx.coordinationLog
  const rootOwnerId = rootCoordinationOwner(rootExecution.identity)
  // Each manager's intake for questions its child managers raise, by coordination owner id.
  const childQuestionInboxes = new Map<string, ChildQuestionInbox>()
  const askParentManager = (
    parentOwnerId: string,
    assignmentId: string,
    question: QuestionRecord,
  ): Promise<QuestionEscalationOutcome> | QuestionEscalationOutcome => {
    const inbox = childQuestionInboxes.get(parentOwnerId)
    return inbox === undefined
      ? { delivered: false, reason: 'the parent manager has no question intake in this process' }
      : inbox(assignmentId, question)
  }
  const rootProviderModels: Array<string | undefined> = []
  // The root's own provider stream is retained only where a run directory can hold it. Nested
  // managers share this harness and are left unretained here; a per-owner file is a later step.
  const rootStreamSink =
    options.runDir === undefined
      ? undefined
      : createRootStreamSink(resolve(options.runDir), options.now ?? Date.now)
  const observeNodeEvent = options.onCoordinationEvent
    ? async (
        context: SupervisorNodeContext,
        event: CoordinationEvent,
        record: BusRecord<CoordinationEvent>,
      ) => {
        await options.onCoordinationEvent?.(context, coordinationEventId(context, event), record)
      }
    : undefined
  const managerBackend =
    options.driverBackend ?? (options.rootDriverFromBackend === false ? undefined : options.backend)
  if (options.driveHarness && options.resolveDriveHarness) {
    throw new ValidationError('supervise: provide driveHarness or resolveDriveHarness, not both')
  }
  const hasCustomDriveHarness = Boolean(options.driveHarness || options.resolveDriveHarness)
  // The root manager's workspace, when this process can read it: a loopback bridge runs the
  // driver on this host with `cwd` as its workspace, so a spawn that names an inline resource by
  // path resolves there. A caller-supplied harness is the actual driver and its workspace is its
  // own; the bridge's cwd says nothing about it, so no root is inferred and a spawn by path is
  // refused with the reason rather than read from a directory the driver never saw.
  const spawnResourceRoot = hasCustomDriveHarness
    ? undefined
    : rootSpawnResourceRoot(managerBackend)
  // Runtime-managed tool declarations and the driver's coordination channel are checked before
  // reservation or journaling. A bridge adds its own route/admission check after that purely local
  // validation. A caller-owned worker port owns its own mount and receives the exact profile
  // unchanged.
  const spawnPreflight = composeSpawnPreflights(
    profileToolSpawnPreflight(
      options.makeWorkerAgent === undefined,
      options.resolveSupervisorTools !== undefined,
    ),
    coordinationChannelSpawnPreflight(
      options.makeWorkerAgent === undefined,
      hasCustomDriveHarness,
      managerBackend,
      options.coordination,
    ),
    options.backend?.backend === 'bridge' ? bridgeSpawnPreflight(options.backend) : undefined,
    options.backend?.backend === 'provider' && typeof options.backend.provider === 'object'
      ? providerSpawnPreflight(options.backend.provider)
      : undefined,
  )
  // A custom harness receives the provider-visible profile plus the immutable canonical profile
  // for receipt binding. An undeclared materialization therefore defaults to the full canonical
  // leaf set, apart from Runtime-owned coordination declarations consumed before dispatch.
  // Declaring `driveHarnessMaterialization` narrows that claim and turns dropped axes into
  // pre-spawn faults.
  const driverMaterialization = hasCustomDriveHarness
    ? (options.driveHarnessMaterialization ?? fullProfileMaterialization)
    : managerBackend && automaticDriverBackendSupported(managerBackend, options.coordination)
      ? backendProfileMaterialization(managerBackend)
      : undefined
  if (
    isExternalSupervisor(canonicalProfile) &&
    !options.driveHarness &&
    !options.resolveDriveHarness &&
    (!managerBackend || !automaticDriverBackendSupported(managerBackend, options.coordination))
  ) {
    throw new ValidationError(
      `supervise: external supervisor profile.harness=${JSON.stringify(canonicalProfile.harness)} requires a local bridge, a provider with authenticated coordination.publicUrl and runtime MCP attachments, or an explicit driveHarness with reachable coordination transport`,
    )
  }
  // Every child that this run can drive as a manager inherits its manager's coordination grants,
  // so depth is the director's choice rather than an author's omission. A profile's own explicit
  // grants win; a child with no driver for its harness stays a leaf rather than failing to start.
  const externalManagersAvailable =
    hasCustomDriveHarness ||
    (managerBackend !== undefined &&
      automaticDriverBackendSupported(managerBackend, options.coordination))
  const canLead = (child: AgentProfile): boolean =>
    isExternalSupervisor(child) ? externalManagersAvailable : options.router !== undefined
  // A manager delivers its own work only through `submit_result`, which exists only under a
  // completion check. Without one, a worker turned manager could not finish work it did itself.
  const childrenCanSubmit = deliverable !== undefined || options.resolveDeliverable !== undefined
  const composeSpawnProfileFor = (
    parent: AgentProfile,
  ): ((profile: AgentProfile) => AgentProfile) | undefined => {
    if (
      options.inheritSpawnRights === false ||
      options.makeWorkerAgent !== undefined ||
      !childrenCanSubmit
    ) {
      return composeSpawnProfile
    }
    return (authored) => {
      const composed = composeSpawnProfile ? composeSpawnProfile(authored) : authored
      // A seat chain is an explicit execution policy. Inheriting manager grants would turn a
      // seat-bearing leaf into a manager and change the authored profile before selection.
      return composed.seats || !canLead(composed)
        ? composed
        : withInheritedSpawnRights(parent, composed)
    }
  }
  const harnessClaims = new WeakMap<
    DriveHarness,
    { readonly owners: Set<string>; steerable: boolean }
  >()
  const claimDriveHarness = (rawHarness: unknown, ownerId: string): DriveHarness => {
    if (typeof rawHarness !== 'function') {
      throw new ValidationError(
        'supervise: resolveDriveHarness must return a DriveHarness function',
      )
    }
    const harness = rawHarness as DriveHarness
    const deliver: unknown = harness.deliver
    if (deliver !== undefined && typeof deliver !== 'function') {
      throw new ValidationError('supervise: driveHarness.deliver must be a function when provided')
    }
    const deliverReady: unknown = harness.deliverReady
    if (deliverReady !== undefined && typeof deliverReady !== 'function') {
      throw new ValidationError(
        'supervise: driveHarness.deliverReady must be a function when provided',
      )
    }
    const claim = harnessClaims.get(harness)
    const conflictingOwner = claim
      ? [...claim.owners].find((claimedOwner) => claimedOwner !== ownerId)
      : undefined
    const steerable = typeof deliver === 'function'
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
    if (options.driveHarness) {
      return claimDriveHarness(options.driveHarness, context.ownerId)
    }
    return managerBackend && automaticDriverBackendSupported(managerBackend, options.coordination)
      ? driveHarnessFromBackend(
          managerBackend,
          externalExecutionId('supervised-manager', {
            runNamespace,
            ownerId: context.ownerId,
          }),
          options.now ?? Date.now,
          options.maxTurns,
          context.depth === 0 ? rootStreamSink : undefined,
          options.selectSeat === undefined
            ? undefined
            : {
                select: options.selectSeat,
                journal,
                rootId: runId,
                onSegment: async (nodeId, segment, phase) => {
                  await options.hooks?.onEvent?.(
                    {
                      id: `${nodeId}:seat:${segment.startedAt}:${phase}`,
                      runId,
                      target: 'agent.seat',
                      phase: 'event',
                      timestamp: options.now?.() ?? Date.now(),
                      parentId: nodeId,
                      payload: { nodeId, phase, segment },
                    },
                    {},
                  )
                },
                onPause: async (nodeId, resumeAt, phase) => {
                  await options.hooks?.onEvent?.(
                    {
                      id: `${nodeId}:seat:${phase}:${resumeAt || (options.now?.() ?? Date.now())}`,
                      runId,
                      target: 'agent.seat',
                      phase: 'event',
                      timestamp: options.now?.() ?? Date.now(),
                      parentId: nodeId,
                      payload: { nodeId, phase, ...(resumeAt ? { resumeAt } : {}) },
                    },
                    {},
                  )
                },
              },
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
      : testBrain
        ? promptControlProfileMaterialization
        : routerSupervisorProfileMaterialization,
    'supervise root',
    true,
  )

  const now = options.now ?? Date.now

  // Classify the worker backend against the propagation census ONCE: a backend with no channel to
  // carry the trace context makes every traced spawn a severed hop, journaled per spawn as
  // `trace-unpropagated` (see `worker-trace.ts` for the census). A caller-owned `makeWorkerAgent`
  // is unclassifiable — no claim is journaled rather than a guessed one.
  const traceUnpropagated = options.backend
    ? workerTraceUnpropagatedDeclaration(options.backend.backend)
    : undefined

  return {
    options,
    canonicalProfile,
    registeredProfile,
    canonicalTask,
    rootExecution,
    guidanceComposer,
    composeSpawnProfile,
    applyTraceTools,
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
    askParentManager,
    rootProviderModels,
    rootStreamSink,
    observeNodeEvent,
    managerBackend,
    spawnResourceRoot,
    spawnPreflight,
    driverMaterialization,
    composeSpawnProfileFor,
    driveHarnessForOwner,
    rootDriveHarness,
    rootOwnerRuntime,
    now,
    traceUnpropagated,
  }
}
