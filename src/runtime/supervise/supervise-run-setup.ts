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
import { assertValidBudget } from './spend-validation'
import {
  assertPerWorkerAdmittable,
  assertPerWorkerWithinPool,
  defaultPerWorker,
} from './supervise-budget'
import {
  canonicalExecution,
  coordinationEventId,
  freezeDetached,
  rootCoordinationOwner,
  supervisionRunNamespace,
} from './supervise-identity'
import { managerHarnessResolver } from './supervise-manager-harness'
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
import { assertSqlRunOptions } from './supervise-sql-admission'
import { workerTraceUnpropagatedDeclaration } from './supervise-worker-backend'
import {
  assertCoordinationBinding,
  coordinationProfileToolPrefix,
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
  assertSqlRunOptions(options)
  assertValidBudget(options.budget, 'supervise budget')
  // Fail loud before any compute: every configured model must be in `allowedModels` (when set).
  const guidanceComposer = profileGuidanceComposer(options.profileGuidance)
  const { applyTraceTools, composeSpawnProfile } = traceToolPolicy(options, guidanceComposer)
  const peerAuditFor = peerAuditRegistry(options)
  // The recorded root profile fixes the run's identity; a segment only alters what it executes.
  const registeredProfile = applyTraceTools(superviseRootProfile(profile, options.profileGuidance))
  const canonicalProfile = admitRootSegment(registeredProfile, options)
  const canonicalTask = freezeDetached(task)
  assertWorkerSeams(options)
  const authorizeDownFor = downMessageAuthorizer(options)
  const rootExecution = canonicalExecution(
    registeredProfile,
    canonicalTask,
    options.execution,
    'supervise root',
  )
  assertRunModelsAllowed(canonicalProfile, options)
  const { deliverable, finalizer, analysts, profileTable } = resolveRunRegistry(options)
  assertCoordinationBinding(options.coordination)

  // `withDriver: true` is the wiring invariant: a child constructed by `driverChild` must resolve
  // to the nested-scope executor; `runDir` only changes where the journal and blobs live.
  const ctx =
    options.runContext ??
    (options.runDir !== undefined
      ? createFileRunContext(options.runDir, { withDriver: true })
      : createInMemoryRunContext({ withDriver: true }))
  const blobs = options.blobs ?? ctx.blobs
  const { ownerShare, perWorker } = admitPerWorker(options)
  const journal = options.journal ?? ctx.journal
  const runId = options.runId ?? ctx.runId ?? 'supervise'
  const runNamespace = ctx.namespace ?? supervisionRunNamespace(options.runDir, runId)
  const log = ctx.coordinationLog
  const rootOwnerId = rootCoordinationOwner(rootExecution.identity)
  // The root manager's place in the run: its node context, and the base of its harness owner.
  const rootNodeContext = {
    runId,
    runNamespace,
    ownerId: rootOwnerId,
    depth: 0,
    identity: rootExecution.identity,
  }
  const { childQuestionInboxes, askParentManager } = childQuestionRouting()
  const rootProviderModels: Array<string | undefined> = []
  const now = options.now ?? Date.now
  // The root's provider stream is retained only where a run directory can hold it; nested managers
  // share this harness and are left unretained (a per-owner file is a later step).
  const rootStreamSink =
    options.runDir === undefined ? undefined : createRootStreamSink(options.runDir, now)
  const observeNodeEvent = coordinationEventObserver(options)
  const externalRoot = isExternalSupervisor(canonicalProfile)
  const driver = managerDriverPlan(options, canonicalProfile, externalRoot)
  const composeSpawnProfileFor = spawnProfileComposer(
    options,
    driver,
    deliverable !== undefined || options.resolveDeliverable !== undefined,
    composeSpawnProfile,
  )
  const driveHarnessForOwner = managerHarnessResolver({
    options,
    managerBackend: driver.managerBackend,
    automaticDriver: driver.automaticDriver,
    runId,
    runNamespace,
    journal,
    rootStreamSink,
  })
  const rootDriveHarness = externalRoot
    ? driveHarnessForOwner(
        freezeDetached({ ...rootNodeContext, profile: canonicalProfile, task: canonicalTask }),
      )
    : undefined
  const rootOwnerRuntime =
    rootDriveHarness === undefined ? undefined : runtimeOwnedScopeOwnerRuntime(rootDriveHarness)
  assertProfileContract(
    canonicalProfile,
    externalRoot
      ? (driver.driverMaterialization as ProfileMaterializationContract)
      : testBrain
        ? promptControlProfileMaterialization
        : routerSupervisorProfileMaterialization,
    'supervise root',
    true,
  )

  // Classify the worker backend against the propagation census ONCE: a backend with no channel
  // for the trace context makes each traced spawn a severed hop, journaled as `trace-unpropagated`
  // (`worker-trace.ts`). A caller-owned `makeWorkerAgent` is unclassifiable: no claim is journaled.
  const traceUnpropagated = options.backend
    ? workerTraceUnpropagatedDeclaration(options.backend.backend)
    : undefined

  return {
    options,
    canonicalProfile,
    registeredProfile,
    canonicalTask,
    rootExecution,
    externalRoot,
    rootNodeContext,
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
    ...driver,
    composeSpawnProfileFor,
    driveHarnessForOwner,
    rootDriveHarness,
    rootOwnerRuntime,
    now,
    traceUnpropagated,
  }
}

/** The caller's coordination-event observer, keyed by each event's stable id. */
function coordinationEventObserver(options: SuperviseOptions) {
  return options.onCoordinationEvent
    ? async (
        context: SupervisorNodeContext,
        event: CoordinationEvent,
        record: BusRecord<CoordinationEvent>,
      ) => {
        await options.onCoordinationEvent?.(context, coordinationEventId(context, event), record)
      }
    : undefined
}

/** With `traceTools: false`, the trace-reading coordination tools leave every profile. */
function traceToolPolicy(
  options: SuperviseOptions,
  guidanceComposer: ReturnType<typeof profileGuidanceComposer>,
) {
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
  return { applyTraceTools, composeSpawnProfile }
}

/** Sibling audit: a manager's child reads a peer's tools only when both share that parent. */
function peerAuditRegistry(
  options: SuperviseOptions,
): (parent: string) => PeerAuditAccess | undefined {
  const auditPeers = new Map<string, { parent: string; tools: ReadonlyArray<McpToolDescriptor> }>()
  return (parent) =>
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
}

/** The profile this process executes: the registered root, or the segment the options name. */
function admitRootSegment(
  registeredProfile: AgentProfile,
  options: SuperviseOptions,
): AgentProfile {
  if (options.segment !== undefined) admitSegment(options.segment)
  const canonicalProfile =
    options.segment === undefined
      ? registeredProfile
      : withRootSegment(registeredProfile, options.segment)
  assertExecutableAgentProfile(canonicalProfile, 'supervise root')
  if (authoredSeatStages(canonicalProfile) !== undefined && options.selectSeat === undefined) {
    throw new ValidationError('supervise: AgentProfile.seats requires selectSeat before execution')
  }
  return canonicalProfile
}

function assertWorkerSeams(options: SuperviseOptions): void {
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
}

function downMessageAuthorizer(
  options: SuperviseOptions,
): (parent: AgentProfile, depth: number) => AuthorizeDownMessage | undefined {
  return (parent, depth) => {
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
}

function assertRunModelsAllowed(canonicalProfile: AgentProfile, options: SuperviseOptions): void {
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
}

/**
 * Named options become values before anything is built or spent — an unknown name is a
 * configuration fault, and a fault that surfaces after a run started has already cost budget.
 */
function resolveRunRegistry(options: SuperviseOptions) {
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
  return { deliverable, finalizer, analysts, profileTable }
}

function admitPerWorker(options: SuperviseOptions) {
  assertRecursiveReservationPolicy(options.reservationPolicy)
  const ownerShare = options.reservationPolicy?.ownerShare ?? 0
  const perWorker = options.perWorker ?? defaultPerWorker(options.budget, ownerShare)
  assertValidBudget(perWorker, 'supervise perWorker')
  // A per-child ceiling larger than its pool cannot be honored: accepting it silently reads as a
  // budget outcome (children clamped at 700_000 under perWorker.maxTokens = 3_200_000_000 against
  // a 200_000_000 pool) rather than a misconfiguration. Refuse at construction.
  assertPerWorkerWithinPool(perWorker, options.budget)
  // A pool-sized ceiling can still be one no child is admitted under (the owner's kept share
  // leaves less, or nothing for its next turn): five Discovery team runs died that way hours in.
  // Only a caller-named slice is checked; the default is the runtime's own.
  if (options.perWorker !== undefined)
    assertPerWorkerAdmittable(perWorker, options.budget, ownerShare)
  return { ownerShare, perWorker }
}

/** Each manager's intake for questions its child managers raise, by coordination owner id. */
function childQuestionRouting() {
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
  return { childQuestionInboxes, askParentManager }
}

/** How this run drives its managers: which backend, which harness source, and what it carries. */
interface ManagerDriverPlan {
  readonly managerBackend: SuperviseOptions['backend']
  readonly hasCustomDriveHarness: boolean
  /** Whether `managerBackend` can drive a manager without a caller-supplied harness. */
  readonly automaticDriver: boolean
  readonly spawnResourceRoot: ReturnType<typeof rootSpawnResourceRoot> | undefined
  readonly spawnPreflight: ReturnType<typeof composeSpawnPreflights>
  readonly driverMaterialization: ProfileMaterializationContract | undefined
}

function managerDriverPlan(
  options: SuperviseOptions,
  canonicalProfile: AgentProfile,
  externalRoot: boolean,
): ManagerDriverPlan {
  const managerBackend =
    options.driverBackend ?? (options.rootDriverFromBackend === false ? undefined : options.backend)
  if (options.driveHarness && options.resolveDriveHarness) {
    throw new ValidationError('supervise: provide driveHarness or resolveDriveHarness, not both')
  }
  const hasCustomDriveHarness = Boolean(options.driveHarness || options.resolveDriveHarness)
  const automaticDriver =
    managerBackend !== undefined &&
    automaticDriverBackendSupported(managerBackend, options.coordination)
  // The root manager's workspace, when this process can read it: a loopback bridge runs the driver
  // here with `cwd` as workspace, so a spawn by path resolves there. A caller-supplied harness owns
  // its workspace; no root is inferred and a spawn by path is refused with the reason.
  const spawnResourceRoot = hasCustomDriveHarness
    ? undefined
    : rootSpawnResourceRoot(managerBackend)
  // Runtime-managed tool declarations and the coordination channel are checked before reservation
  // or journaling; a bridge adds its route/admission check after. A caller-owned worker port owns
  // its mount and receives the profile unchanged.
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
  // for receipt binding, so an undeclared materialization defaults to the full canonical leaf set
  // (less Runtime-owned coordination declarations); declaring `driveHarnessMaterialization`
  // narrows that and turns dropped axes into pre-spawn faults.
  const driverMaterialization = hasCustomDriveHarness
    ? (options.driveHarnessMaterialization ?? fullProfileMaterialization)
    : managerBackend && automaticDriver
      ? backendProfileMaterialization(managerBackend)
      : undefined
  if (externalRoot && !hasCustomDriveHarness && !automaticDriver) {
    throw new ValidationError(
      `supervise: external supervisor profile.harness=${JSON.stringify(canonicalProfile.harness)} requires a local bridge, a provider with authenticated coordination.publicUrl and runtime MCP attachments, or an explicit driveHarness with reachable coordination transport`,
    )
  }
  return {
    managerBackend,
    hasCustomDriveHarness,
    automaticDriver,
    spawnResourceRoot,
    spawnPreflight,
    driverMaterialization,
  }
}

/**
 * Every child this run can drive as a manager inherits its manager's coordination grants, so depth
 * is the director's choice; explicit profile grants win and a child with no driver for its harness
 * stays a leaf. A manager delivers its own work only through `submit_result`, which exists only
 * under a completion check (`childrenCanSubmit`).
 */
function spawnProfileComposer(
  options: SuperviseOptions,
  driver: ManagerDriverPlan,
  childrenCanSubmit: boolean,
  composeSpawnProfile: ((profile: AgentProfile) => AgentProfile) | undefined,
): (parent: AgentProfile) => ((profile: AgentProfile) => AgentProfile) | undefined {
  const externalManagersAvailable = driver.hasCustomDriveHarness || driver.automaticDriver
  const canLead = (child: AgentProfile): boolean =>
    isExternalSupervisor(child) ? externalManagersAvailable : options.router !== undefined
  return (parent) => {
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
}
