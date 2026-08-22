/**
 * `supervise` — the one-call "just invoke the supervisor". Builds + runs a supervisor from its
 * profile with sensible defaults, so the common case is `supervise(profile, task, { backend, budget })`
 * instead of hand-wiring `blobs` / `perWorker` / `journal` / `executors` / `maxDepth`. The raw seams
 * (`supervisorAgent` + `createSupervisor().run`) stay available for power use.
 *
 * `workerFromBackend` derives the worker seam (`makeWorkerAgent`) from a backend config + an optional
 * completion oracle — so "where the workers run" is one data choice, not a hand-rolled factory.
 *
 * @stable
 */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import {
  type AgentProfile,
  type AgentProfileSecurityPolicy,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  type Sha256Digest,
  validateAgentProfileSecurity,
} from '@tangle-network/agent-interface'
import {
  type HarnessId,
  isMaterializerHarness,
  type SkippableDimension,
} from '@tangle-network/agent-profile-materialize'
import type { BackendType } from '@tangle-network/sandbox'
import {
  assertProfileMaterialization,
  controlProfileMaterialization,
  defineProfileMaterializationContract,
  fullProfileMaterialization,
  type ProfileMaterializationContract,
  profileMaterializationAxes,
  promptControlProfileMaterialization,
  promptModelProfileMaterialization,
  renderUnsupported,
  unsupportedProfileDimensions,
  worktreeCliProfileMaterialization,
} from '../../agent/profile-materialization'
import { ConfigError, ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  AnalyzeOnSettleRoute,
  AuthorizeDownMessage,
  AuthorizedDownMessage,
  ContinuityMode,
  CoordinationEvent,
  DownMessageAuthorizationInput,
  MakeWorkerAgent,
  SpawnPreflight,
  WorkerSpawnContext,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import { coordinationVerbNames } from '../../mcp/tools/coordination'
import { composeRuntimeHooks, type RuntimeHooks } from '../../runtime-hooks'
import { agentHarness, harnessRunsAgent } from '../harness-role'
import type { RouterTransportConfig } from '../router-client'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import { unmeteredSpend } from '../util'
import { assertValidBudget, spendFromUsageEvents } from './budget'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import { DEFAULT_SUCCESSFUL_SHUTDOWN_MS, teardownExecutor } from './deadline'
import { driverChild } from './driver-executor'
import type { DriverAttemptRecord, DriverRetryPolicy } from './driver-retry'
import type { BusRecord } from './event-bus'
import type { SupervisorFinalizer } from './finalizer'
import {
  attestRuntimeOwnedScopeOwner,
  providerAttemptEvidence,
  recordRuntimeOwnedDriveHarnessProviderEvidence,
  runtimeOwnedDriveHarnessProviderEvidence,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedExecutorProviderEvidence,
  runtimeOwnedPendingExecutorMaterialization,
  runtimeOwnedScopeOwnerRuntime,
} from './materialization'
import {
  assertExecutableAgentProfile,
  assertModelAllowed,
  assertProfileModelsAllowed,
  profileBridgeWireModel,
} from './model-policy'
import {
  createSupervisorSpanRecorder,
  type SupervisorSpanOptions,
  type SupervisorSpanRecorder,
} from './otel-spans'
import type { PeerMailLimits } from './peer-mail'
import { createFileRunContext, createInMemoryRunContext } from './run-context'
import { readRunCancellation, readRunCancelRequest, writeRunCancellation } from './run-layout'
import {
  type BridgeSeam,
  bindReusableExecutorExecutionId,
  bridgeAdmissionRead,
  bridgeModelRouteRefusal,
  bridgeRuntimeAttachmentsKey,
  bridgeStopSignalKey,
  captureReusableExecutorConfig,
  createExecutor,
  type ExecutorConfig,
  snapshotExecutorConfig,
} from './runtime'
import {
  deriveNodeExecutionIdentity,
  meterRuntimeOwnedAccounting,
  meterRuntimeOwnedProviderAttempt,
  recordScopeOwnerMaterialization,
  scopeOwnerExecutorNodeContext,
} from './scope'
import { detachedSnapshot } from './snapshot'
import type { StopRule } from './stop-rules'
import { createRootHandle, createSupervisor } from './supervisor'
import {
  assertCoordinationBinding,
  type CoordinationBinding,
  type DriveHarness,
  type DriveHarnessOwnerContext,
  type ResolveDriveHarness,
  type ResolveSupervisorTools,
  type SupervisorAgentDeps,
  type SupervisorNodeContext,
  type SupervisorProfile,
  supervisorAgent,
  supervisorAgentWithTestBrain,
} from './supervisor-agent'
import type {
  Agent,
  AgentExecutionRef,
  AgentSpec,
  Budget,
  Executor,
  ExecutorContext,
  ExecutorExecutionBinding,
  ExecutorMaterialization,
  NodeExecutionIdentity,
  ProviderModelAttemptEvidence,
  ProviderModelExecutionEvidence,
  ResultBlobStore,
  RootHandle,
  RootProviderModelEvidence,
  SpawnJournal,
  SupervisedResult,
  UsageEvent,
} from './types'
import type { WaitProbeRegistry } from './wait'
import { WORKER_TRACE_PROPAGATION } from './worker-trace'

/**
 * Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the
 * deliverable check that makes "settled ⟺ delivered" true — the guard against "ran but didn't
 * deliver"). The ONE place a backend becomes a spawnable worker.
 *
 * `seams` exists because this path builds the leaf executor EAGERLY and hands it back as a BYO
 * `executorSpec.executor`. The registry resolves a BYO executor without ever consulting the
 * per-child `ExecutorContext` the `Scope` seeds, so anything the scope would have supplied is
 * invisible here and has to be passed in. It is a FUNCTION because it is resolved once per worker
 * construction, so a caller may hand back something the run only learns later — which is exactly how
 * `supervise()` gives a traced run's workers their trace context without ordering the span recorder
 * ahead of the worker seam.
 *
 * Continuity: the `bridge` backend honors `continuity: 'resume'` by session re-attachment. A
 * bridge session id IS the harness conversation key (cli-bridge maps it to the CLI's own resume —
 * opencode `-s <id>`, claude `--resume`), so this seam records the session id each supervised
 * spawn was bound to, keyed by the worker id the Scope assigned, and a resume spawn binds the
 * prior worker's recorded session id instead of deriving a fresh one. The record is process-local
 * by construction, which matches the kernel's resume boundary (a prior process's workers are not
 * resume targets). Every other backend keeps failing loud: their executors have no re-attachable
 * session, and accepting the spawn would ledger `continuity: 'resume'` over a brand-new session —
 * a stamp asserting something that never happened.
 */
export function workerFromBackend(
  backend: ExecutorConfig,
  deliverable?: DeliverableSpec<unknown>,
  seams?: () => Readonly<Record<string, unknown>>,
): MakeWorkerAgent {
  const capturedBackend = captureReusableExecutorConfig(backend, 'workerFromBackend')
  const unscopedNamespace = randomUUID()
  let unscopedOrdinal = 0
  const bridgeSessionByWorker = new Map<string, string>()
  return (rawProfile, spawnContext) => {
    const parsed = agentProfileSchema.safeParse(rawProfile)
    if (!parsed.success) {
      throw new ValidationError(`workerFromBackend: invalid AgentProfile: ${parsed.error.message}`)
    }
    const profile = parsed.data
    assertBackendProfileMaterialization(profile, capturedBackend, 'workerFromBackend')
    assertBridgeProfileMaterializes(profile, capturedBackend, 'workerFromBackend')
    // Resolved BEFORE any worker exists, so a resume this seam cannot honor fails the spawn
    // itself and the kernel never ledgers a `continuity: 'resume'` stamp for it.
    const resumeSessionId = bridgeResumeSessionId(
      capturedBackend,
      spawnContext,
      bridgeSessionByWorker,
    )
    const name = profile.name ?? 'worker'
    // A Scope assignment is stable across reconstruction. Direct callers that omit that context
    // still get isolation, but only Scope-backed calls claim durable external-session recovery.
    const assignmentId =
      spawnContext?.assignmentId ?? `unscoped:${unscopedNamespace}:${unscopedOrdinal++}`
    // The derived execution id scopes by the spawning manager: assignment ordinals restart at
    // `ordinal:0` under every manager, so an unscoped digest maps worker 1 of EVERY run (and of
    // every sibling manager) to one external session — on a bridge with a persistent session
    // store, a 'fresh' spawn then silently continues a foreign run's harness conversation.
    // Durable recovery is preserved: a replay of the same run re-issues the same manager node id
    // and the same assignments, so it derives the same session ids.
    const executionScope = spawnContext?.parentNodeId
    const boundBackend = bindReusableExecutorExecutionId(
      capturedBackend,
      resumeSessionId ??
        externalExecutionId('supervised-worker', {
          assignmentId,
          ...(executionScope === undefined ? {} : { scope: executionScope }),
        }),
    )
    const boundSessionId = boundBackend.backend === 'bridge' ? boundBackend.sessionId : undefined
    const baseFactory = createExecutor(boundBackend)
    // Carry the configured factory into Scope. It is built only AFTER reservation with the real
    // child signal/context, so a rejected or already-completed keyed spawn creates no executor.
    const executorFactory = (spec: AgentSpec, ctx: ExecutorContext) => {
      // Record the bridge session this worker is bound to under its Scope-assigned worker id,
      // so a later resume of the node can re-attach it. A resumed worker records the SAME
      // session under its own id, which is what keeps a fresh → resume → resume chain on one
      // harness conversation.
      if (boundSessionId !== undefined && ctx.node?.nodeId !== undefined) {
        bridgeSessionByWorker.set(ctx.node.nodeId, boundSessionId)
      }
      // Caller-supplied seams sit UNDER the per-child seams the Scope seeds, so the scope's
      // recursion and trace context always win on a key collision.
      const extraSeams = seams?.()
      const built = baseFactory(
        spec,
        extraSeams === undefined ? ctx : { ...ctx, seams: { ...extraSeams, ...ctx.seams } },
      )
      return deliverable ? gateOnDeliverable(built, deliverable) : built
    }
    const spec: AgentSpec = {
      profile,
      harness: null,
      executorFactory,
      ...(spawnContext?.execution ? { execution: spawnContext.execution } : {}),
    }
    return { name, act: async () => '', executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
}

function externalExecutionId(kind: string, identity: unknown): string {
  const digest = canonicalCandidateDigest({ kind, identity })
  return `${kind}-${digest.slice('sha256:'.length)}`
}

/**
 * The bridge session id a `'resume'` spawn re-attaches, or `undefined` for a fresh spawn.
 * Every refusal throws BEFORE a worker exists, which is what keeps the kernel's continuity
 * ledger true: a `'resume'` stamp can only appear over a session that was actually re-attached.
 */
function bridgeResumeSessionId(
  backend: ExecutorConfig,
  spawnContext: WorkerSpawnContext | undefined,
  sessions: ReadonlyMap<string, string>,
): string | undefined {
  if (spawnContext?.continuity !== 'resume') return undefined
  if (backend.backend !== 'bridge') {
    throw new ValidationError(
      `workerFromBackend: the '${backend.backend}' backend seam does not re-attach sessions and ` +
        "cannot honor continuity: 'resume' — only the 'bridge' backend resumes here (cli-bridge " +
        'keys the harness conversation by session id). Provide a makeWorkerAgent that resumes ' +
        "(it receives spawnContext.resume.ofWorker), or use continuity: 'fresh'",
    )
  }
  const ofWorker = spawnContext.resume?.ofWorker
  if (ofWorker === undefined) {
    throw new ValidationError(
      "workerFromBackend: a 'resume' spawn carries no resume lineage — the kernel stamps " +
        'spawnContext.resume for ledgered spawns; a direct caller must pass { ofWorker, sequence }',
    )
  }
  const prior = sessions.get(ofWorker)
  if (prior === undefined) {
    throw new ValidationError(
      `workerFromBackend: no recorded bridge session for worker '${ofWorker}' — this seam ` +
        're-attaches only sessions it bound in this process (the kernel resume boundary). ' +
        "Spawn the node fresh first, or use continuity: 'fresh'",
    )
  }
  return prior
}

/**
 * The `trace-unpropagated` declaration for a worker backend, or `undefined` when the backend HAS a
 * propagation channel. The census (`WORKER_TRACE_PROPAGATION`) says WHETHER a backend propagates;
 * this maps the non-propagating arms to WHY: `router`/`router-tools`/`provider` have no worker
 * process to inherit an environment, `cli-worktree` has a worker but no environment channel
 * through its transport.
 */
function workerTraceUnpropagatedDeclaration(
  backend: ExecutorConfig['backend'],
): { backend: string; reason: 'no-env-channel' | 'no-worker-process' } | undefined {
  if (WORKER_TRACE_PROPAGATION[backend]) return undefined
  const reason =
    backend === 'router' || backend === 'router-tools' || backend === 'provider'
      ? ('no-worker-process' as const)
      : ('no-env-channel' as const)
  return { backend, reason }
}

/**
 * NOT a harness-name test — `ExecutorConfig.backend` is a discriminated-union TAG naming HOW a
 * profile is materialized (bridge / sandbox / cli-worktree / router / cli / provider), which is a
 * different axis from WHICH CLI runs. An exhaustive switch on a closed union tag is the correct
 * shape and must stay: it is what makes a new executor kind a compile error here rather than a
 * silently weaker materialization contract. Every other `backend.backend === …` in this file and
 * in `runtime.ts` is the same tag; none of them are harness names.
 */
function backendProfileMaterialization(backend: ExecutorConfig): ProfileMaterializationContract {
  switch (backend.backend) {
    case 'bridge':
    case 'sandbox':
    case 'provider':
      return fullProfileMaterialization
    case 'cli-worktree':
      return backend.bridge ? fullProfileMaterialization : worktreeCliProfileMaterialization
    case 'router':
    case 'router-tools':
      return promptModelProfileMaterialization
    case 'cli':
      return controlProfileMaterialization
  }
}

function assertProfileContract(
  profile: AgentProfile,
  contract: ProfileMaterializationContract,
  context: string,
): void {
  assertProfileMaterialization({
    contract,
    changedAxes: profileMaterializationAxes(profile),
    context,
  })
}

function assertBackendProfileMaterialization(
  profile: AgentProfile,
  backend: ExecutorConfig,
  context: string,
): void {
  assertProfileContract(profile, backendProfileMaterialization(backend), context)
}

/**
 * The dimensions cli-bridge lowers through its OWN native controls rather than the workspace plan,
 * per harness. The pre-spawn check must skip exactly these, or it refuses a profile the bridge
 * would have executed. Mirrors `provisionProfileWorkspace` / `provisionPiProfile` in cli-bridge
 * `src/backends/profile-support.ts`.
 */
function bridgeMaterializationSkip(harness: HarnessId): readonly SkippableDimension[] {
  return harness === 'pi' ? ['mcp', 'extensions'] : ['mcp']
}

/**
 * The two prompt intents, gated here because they are the ONLY profile dimensions cli-bridge
 * refuses independently of whether a harness materializes a workspace at all
 * (`assertProfilePromptIntentsSupported`, cli-bridge `src/backends/profile-support.ts`): a
 * backend either owns a control that reaches the harness's system-prompt position or it does not.
 * Every other dimension's verdict belongs to the workspace plan the executing backend builds, and
 * the run's own materialization receipt already refuses those after the fact.
 */
const gatedPromptDimensions = ['systemPrompt', 'appendSystemPrompt'] as const

/**
 * Refuse a bridge-bound profile whose prompt intent the harness cannot execute, at the SYNCHRONOUS
 * spawn seam — before the reservation commits, the `spawned` event is journaled, or a token is
 * metered. The verdict is a pure function of the profile and the harness, but the bridge only
 * reaches it while assembling the prompt, by which point the child is spawned, metered, and
 * settled `down` to deliver an answer that was available before it started.
 *
 * Applies to the profiles the runtime SPAWNS — a worker and a nested driver child. A root manager
 * profile is the caller's own input and is not a spawn: the bridge answers it on the manager's
 * first turn without a child ever existing.
 *
 * Silent for every other backend: `cli-worktree` runs the full plan check on its own local plan
 * (`runWorktreeHarness`), and no other backend hands the profile to a harness materializer.
 */
function assertBridgeProfileMaterializes(
  profile: AgentProfile,
  backend: ExecutorConfig,
  context: string,
): void {
  if (backend.backend !== 'bridge') return
  const harness = agentHarness(profile.harness)
  if (harness === undefined || !isMaterializerHarness(harness)) return
  const unsupported = unsupportedProfileDimensions(
    profile,
    harness,
    gatedPromptDimensions,
    bridgeMaterializationSkip(harness),
  )
  if (unsupported.length === 0) return
  throw new ValidationError(
    `${context}: ${harness} cannot materialize the profile: ${renderUnsupported(unsupported)}`,
  )
}

/**
 * The ROOT router-brained supervisor's materialization claim. The router arm consumes the
 * identity fields, the resolved system prompt (`prompt.systemPrompt` + `prompt.instructions` +
 * `resources.instructions`), and the resolved model id (`model.default`); the remaining model
 * fields are either applied by the profile-bound Router adapter or refused. Every behavioral axis
 * the Router brain cannot materialize fails before compute.
 *
 * `resourceFailOnError` is carried by the router arm itself. A strict root fails closed on an
 * instruction resource the arm cannot fetch, which is the policy the profile declares. A
 * best-effort root is refused, because the arm reports no skipped resource. Dropping the field
 * would instead force an edit to a champion profile before it can be re-seated as a supervisor
 * root, and that edit changes the profile's canonical identity.
 */
const routerSupervisorProfileMaterialization = defineProfileMaterializationContract({
  name: 'router-supervisor-execution',
  axes: [
    'name',
    'description',
    'version',
    'tags',
    'systemPrompt',
    'instructions',
    'resourceInstructions',
    'resourceFailOnError',
    'modelDefault',
    'modelProvider',
    'modelReasoningEffort',
    'modelMetadata',
    'harness',
    'metadata',
  ],
})

const coordinationMcpAlias = 'agent-runtime-coordination'

/** How a harness sees a coordination verb once the MCP is mounted under its reserved alias. */
const coordinationToolPrefix = `${coordinationMcpAlias.replaceAll('-', '_')}_`

/**
 * Tools a child REQUIRES that name the coordination MCP but no coordination verb.
 *
 * A profile can only receive a coordination tool this run actually serves, and the served set is
 * closed (`coordinationVerbNames`). A required name inside the reserved namespace that is not one
 * of them can never mount on any harness, for any backend, at any depth — the harness discovers it
 * only when it starts and exits (`pi exit 78: requested tool "…" is unavailable`), after the child
 * is spawned, journaled and metered.
 */
function unmountedCoordinationTools(profile: AgentProfile): readonly string[] {
  const served = new Set(coordinationVerbNames.map((verb) => `${coordinationToolPrefix}${verb}`))
  return Object.entries(profile.tools ?? {})
    .filter(([name, required]) => required === true && name.startsWith(coordinationToolPrefix))
    .map(([name]) => name)
    .filter((name) => !served.has(name))
}

/**
 * The pre-flight `supervise` installs for a bridge backend. No new knob: the backend already says
 * where the bridge is, and these are the questions only the bridge can answer.
 *
 * Three causes, in cost order — the pure one first, so a deterministic refusal never pays for a
 * round trip:
 *
 * - `unmountable-tool` — pure; see {@link unmountedCoordinationTools}.
 * - `model-route` — `GET /v1/capabilities?model=<wire id>`. The bridge answers exactly this
 *   question and 404s `no backend matches model "…"`. FAIL CLOSED: any answer that is not a route
 *   refuses, including a transport error or an unexpected status, because a pre-flight that skips
 *   itself on an error is the silent admission it exists to remove.
 * - `bridge-full` — `GET /health` → `admission.active >= admission.maxActive`. ADVISORY by
 *   nature (admission can fill or drain a moment later), so only a POSITIVE reading of fullness
 *   refuses: a `/health` that does not answer, or answers without an admission snapshot, is not
 *   evidence that the bridge is full and admits the spawn.
 */
function bridgeSpawnPreflight(seam: BridgeSeam): SpawnPreflight {
  return async (profile) => {
    const unmounted = unmountedCoordinationTools(profile)
    if (unmounted.length > 0) {
      return {
        cause: 'unmountable-tool',
        detail: `no coordination verb is named by ${unmounted.map((name) => JSON.stringify(name)).join(', ')}; this run serves ${coordinationVerbNames.join(', ')}`,
      }
    }
    const wireModel = profileBridgeWireModel(profile)
    if (wireModel === undefined) {
      return {
        cause: 'model-route',
        detail: 'the child AgentProfile resolves no bridge wire model (harness + provider + model)',
      }
    }
    const routeRefusal = await bridgeModelRouteRefusal(seam, wireModel)
    if (routeRefusal !== undefined) return { cause: 'model-route', detail: routeRefusal }
    const admission = await bridgeAdmissionRead(seam)
    if (admission && admission.active >= admission.maxActive) {
      return {
        cause: 'bridge-full',
        detail: `bridge ${seam.bridgeUrl.replace(/\/$/, '')} admission is full: active ${admission.active} of maxActive ${admission.maxActive}`,
      }
    }
    return undefined
  }
}

const defaultAllowedMcpHosts: string[] = []
Object.freeze(defaultAllowedMcpHosts)

/** Manager-authored profiles are untrusted until product policy says otherwise. Remote MCP and
 * ambient connection grants therefore fail closed by default, in addition to local MCP and hooks. */
export const DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY: AgentProfileSecurityPolicy = Object.freeze({
  allowLocalMcp: false,
  allowHooks: false,
  allowedMcpHosts: defaultAllowedMcpHosts,
  allowConnections: false,
})

function isExternalSupervisor(profile: AgentProfile): boolean {
  return harnessRunsAgent(profile.harness)
}

function automaticDriverBackendSupported(backend: ExecutorConfig): boolean {
  // The built-in coordination server binds host loopback. A local bridge can reach it; a remote
  // sandbox cannot until the caller supplies an explicit relay/tunnel through `driveHarness`.
  return backend.backend === 'bridge'
}

/** Run a harness-brained manager through the same executor factory as its children. The manager's
 * full profile is preserved, the live coordination server is added under one reserved alias, and
 * every streamed turn is charged to the manager's scope before it may continue. */
function driveHarnessFromBackend(
  backend: ExecutorConfig,
  executionId: string,
  now: () => number = Date.now,
  maxTurns?: number,
): DriveHarness {
  // Same refusal the router arm makes in `driverAgent`: a negative cap would silently run zero
  // turns and finalize an empty no-winner.
  if (maxTurns !== undefined && maxTurns < 0) {
    throw new ValidationError(
      'driveHarnessFromBackend: maxTurns must be >= 0 (0 lifts the turn cap; bounds become the conserved pool + deadline + abort)',
    )
  }
  const turnCap = maxTurns ?? 0
  const capturedBackend = captureReusableExecutorConfig(backend, 'driveHarnessFromBackend')
  const boundBackend = bindReusableExecutorExecutionId(capturedBackend, executionId)
  const baseFactory = createExecutor(boundBackend)
  let activeExecutor: Executor<unknown> | undefined
  const drive: DriveHarness = async ({
    profile,
    task,
    scope,
    coordinationMcpUrl,
    stopSignal,
    coordinationTools,
  }) => {
    const initialBudget = scope.budget
    const hasLiveCoordination = scope.view.inFlight > 0 || scope.view.waiting > 0
    if (
      !hasLiveCoordination &&
      (initialBudget.tokensLeft <= 0 ||
        initialBudget.iterationsLeft <= 0 ||
        (initialBudget.usdCapped && initialBudget.usdLeft <= 0) ||
        (initialBudget.deadlineMs > 0 && now() >= initialBudget.deadlineMs))
    ) {
      throw new ValidationError('driveHarnessFromBackend: supervisor budget exhausted')
    }
    // `supervise` only builds this drive path for canonical, schema-parsed AgentProfiles; parsing
    // again here keeps that invariant local and gives the compound `mcp` field a real type.
    const canonicalDriverProfile = agentProfileSchema.parse(profile)
    if (canonicalDriverProfile.mcp?.[coordinationMcpAlias] !== undefined) {
      throw new ValidationError(
        `driveHarnessFromBackend: profile MCP alias ${JSON.stringify(coordinationMcpAlias)} is reserved`,
      )
    }
    const stableCoordinationTools = detachedSnapshot(
      coordinationTools,
      'driveHarnessFromBackend coordination tools',
    )
    // The authored profile travels unchanged. The coordination server is a Runtime-owned
    // attachment: it rides the executor's attachment seam, so a resumed run that rebinds the
    // port keeps the profile digest a durable bridge session is bound to.
    const spec: AgentSpec = {
      profile: canonicalDriverProfile,
      harness:
        boundBackend.backend === 'sandbox' ? (canonicalDriverProfile.harness as BackendType) : null,
    }
    // The turn cap rides the SAME stop lever the coordination stop uses: the harness runs its own
    // loop, so the only honest bound is "stop at the next turn boundary". Composing the two
    // signals keeps one lever rather than a second stop path.
    const turnStop = turnCap > 0 ? new AbortController() : undefined
    const effectiveStopSignal =
      turnStop === undefined
        ? stopSignal
        : stopSignal === undefined
          ? turnStop.signal
          : AbortSignal.any([stopSignal, turnStop.signal])
    const executor = baseFactory(spec, {
      signal: scope.signal,
      node: scopeOwnerExecutorNodeContext(scope),
      seams: {
        ...(effectiveStopSignal === undefined
          ? {}
          : { [bridgeStopSignalKey]: effectiveStopSignal }),
        [bridgeRuntimeAttachmentsKey]: {
          [coordinationMcpAlias]: { transport: 'http', url: coordinationMcpUrl },
        },
      },
    })
    activeExecutor = executor
    let completed = false
    let started = false
    let terminalAccountingCaptured = false
    let pendingUsage: UsageEvent[] = []
    let meteredProviderAttempts = 0
    const providerEvidenceForNextMeter = (): ProviderModelExecutionEvidence => {
      const evidence = runtimeOwnedExecutorProviderEvidence(executor)
      const attempt: ProviderModelAttemptEvidence | undefined =
        evidence?.attempts[meteredProviderAttempts++]
      if (attempt === undefined) {
        return providerAttemptEvidence(undefined)
      }
      const observations = Object.freeze([...attempt.observations])
      const models = Object.freeze([...new Set(observations)])
      const providerDispatch = attempt.providerDispatch
      return Object.freeze(
        attempt.identityConflict === true ||
          providerDispatch === 'not_started' ||
          (providerDispatch !== 'not_started' && observations.length === 0)
          ? {
              status: 'unknown' as const,
              attempts: Object.freeze([
                Object.freeze({
                  observations,
                  ...(attempt.identityConflict === true ? { identityConflict: true } : {}),
                  ...(providerDispatch === 'not_started' ? { providerDispatch } : {}),
                }),
              ]),
              models,
              reason:
                attempt.identityConflict === true
                  ? ('provider-model-conflict' as const)
                  : ('provider-model-missing' as const),
            }
          : {
              status: 'known' as const,
              attempts: Object.freeze([Object.freeze({ observations })]),
              models,
            },
      )
    }
    let teardownStarted = false
    const deadlineAtMs = scope.budget.deadlineMs || undefined
    const teardownOnce = async (grace: number | 'brutalKill' | 'infinity') => {
      if (teardownStarted) return
      teardownStarted = true
      await teardownExecutor(executor, grace, deadlineAtMs, now)
    }
    const meterPending = async (forceUnknown = false) => {
      if (pendingUsage.length === 0) return
      const batch = pendingUsage
      pendingUsage = []
      const measured = spendFromUsageEvents(batch)
      await meterRuntimeOwnedProviderAttempt(
        scope,
        forceUnknown
          ? {
              ...measured,
              tokensKnown: false,
              usdKnown: false,
            }
          : measured,
        providerEvidenceForNextMeter(),
        {
          role: 'driver',
          runtime: executor.runtime,
        },
      )
      const budget = scope.budget
      if (
        budget.tokensLeft <= 0 ||
        (budget.usdCapped && budget.usdLeft <= 0) ||
        (budget.deadlineMs > 0 && now() >= budget.deadlineMs)
      ) {
        throw new ValidationError('driveHarnessFromBackend: supervisor budget exhausted')
      }
    }

    const pending = runtimeOwnedPendingExecutorMaterialization(executor)
    let failed = false
    let failure: unknown
    let ownerMaterializationPublished = false
    const ownerDeclaration = (
      exactDeclaration: ExecutorMaterialization,
    ): ExecutorMaterialization => ({
      ...exactDeclaration,
      // The coordination MCP is a Runtime-owned platform attachment, not authored behavior.
      effectiveProfile: canonicalDriverProfile,
      platformAttachments: {
        [coordinationMcpAlias]: {
          kind: 'coordination-mcp',
          transport: 'http',
          tools: stableCoordinationTools,
        },
      },
    })
    const publishMaterialization = async (
      exactDeclaration: ExecutorMaterialization,
      exactBinding: ExecutorExecutionBinding,
    ): Promise<void> => {
      await recordScopeOwnerMaterialization(
        scope,
        executor.runtime,
        ownerDeclaration(exactDeclaration),
        {
          ...exactBinding,
          binding: {
            stableBinding: exactBinding.binding,
            platformAttachments: {
              [coordinationMcpAlias]: {
                transport: 'http',
                url: coordinationMcpUrl,
              },
            },
          },
          descriptor: {
            ...exactBinding.descriptor,
            coordination: true,
          },
        },
      )
    }
    try {
      // Construction transfers cleanup ownership immediately. Even a rejected receipt or an
      // unmetered runtime reaches the single bounded teardown path below.
      const declaration = runtimeOwnedExecutorMaterialization(executor)
      const executionBinding = runtimeOwnedExecutorExecutionBinding(executor)
      if (pending === undefined && (declaration === undefined || executionBinding === undefined)) {
        throw new ValidationError(
          `driveHarnessFromBackend: built-in runtime ${JSON.stringify(executor.runtime)} has no trusted materialization declaration or execution binding`,
        )
      }
      if (pending !== undefined) {
        if (
          pending.runtime !== executor.runtime ||
          pending.binding.attemptId !== scopeOwnerExecutorNodeContext(scope).attemptId
        ) {
          throw new ValidationError(
            'driveHarnessFromBackend: pending executor did not bind the kernel-minted attempt',
          )
        }
        if (
          canonicalAgentProfileDigest(pending.declaration.effectiveProfile) !==
          canonicalAgentProfileDigest(canonicalDriverProfile)
        ) {
          throw new ValidationError(
            'driveHarnessFromBackend: pending executor changed the authored AgentProfile before execution',
          )
        }
      } else {
        await publishMaterialization(declaration!, executionBinding!)
      }
      if (executor.budgetExempt) {
        throw new ValidationError(
          `driveHarnessFromBackend: runtime ${JSON.stringify(executor.runtime)} does not report usage and cannot drive a budgeted supervisor`,
        )
      }

      started = true
      // A coordination completion stops the NEXT external turn. The active bridge request must
      // drain so its served model and terminal materialization remain valid evidence.
      const run = executor.execute(task, scope.signal)
      if (isAsyncIterable<UsageEvent>(run)) {
        let turns = 0
        for await (const event of run) {
          if (event.kind === 'iteration') {
            await meterPending()
            turns += 1
            if (turnStop !== undefined && turns >= turnCap && !turnStop.signal.aborted) {
              turnStop.abort(`supervise: maxTurns ${turnCap} reached`)
            }
          } else if (event.kind !== 'progress') {
            // A progress event carries the driver's observed output, never accounting.
            pendingUsage.push(event)
          }
        }
        await meterPending()
        const artifact = executor.resultArtifact()
        terminalAccountingCaptured = true
        // A stream carries increments, while its terminal artifact says whether either accounting
        // channel was omitted. Preserve unknowns in the shared pool instead of treating them as 0.
        if (artifact.spent.tokensKnown === false || artifact.spent.usdKnown === false) {
          await meterRuntimeOwnedAccounting(
            scope,
            {
              iterations: 0,
              tokens: { input: 0, output: 0 },
              ...(artifact.spent.tokensKnown === false ? { tokensKnown: false } : {}),
              usd: 0,
              ...(artifact.spent.usdKnown === false ? { usdKnown: false } : {}),
              ms: 0,
            },
            { role: 'driver', runtime: executor.runtime, telemetry: 'unknown' },
          )
        }
      } else {
        const artifact = await run
        terminalAccountingCaptured = true
        await meterRuntimeOwnedProviderAttempt(
          scope,
          { ...artifact.spent, iterations: 0 },
          providerEvidenceForNextMeter(),
          { role: 'driver', runtime: executor.runtime },
        )
      }
      if (pending !== undefined) {
        const acknowledged = runtimeOwnedExecutorMaterialization(executor)
        const acknowledgedBinding = runtimeOwnedExecutorExecutionBinding(executor)
        if (acknowledged === undefined || acknowledgedBinding === undefined) {
          throw new ValidationError(
            'driveHarnessFromBackend: external executor completed without a terminal materialization acknowledgement',
          )
        }
        await publishMaterialization(acknowledged, acknowledgedBinding)
        ownerMaterializationPublished = true
      }
      completed = true
    } catch (error) {
      failed = true
      failure = error
    } finally {
      // The bridge can return its terminal receipt, then Runtime metering can fail before normal
      // publication (for example, after an accepted submit_result exceeds the token budget).
      // The executor attestation is the trusted receipt; publish it before teardown destroys the
      // bridge-owned state. If no receipt exists, leave the owner unknown and preserve the
      // original failure instead of inventing evidence or replacing its diagnostic.
      if (pending !== undefined && !ownerMaterializationPublished) {
        const acknowledged = runtimeOwnedExecutorMaterialization(executor)
        const acknowledgedBinding = runtimeOwnedExecutorExecutionBinding(executor)
        if (acknowledged !== undefined && acknowledgedBinding !== undefined) {
          try {
            await publishMaterialization(acknowledged, acknowledgedBinding)
            ownerMaterializationPublished = true
          } catch (error) {
            if (!failed) {
              failed = true
              failure = error
            }
          }
        }
      }
      // Capture provider evidence before teardown destroys the executor-owned observation state.
      // This is independent from terminal materialization: an aborted paid turn still needs its
      // served identity, while a plan-only receipt must never be used as a substitute.
      recordRuntimeOwnedDriveHarnessProviderEvidence(
        drive,
        runtimeOwnedExecutorProviderEvidence(executor),
      )
      try {
        await meterPending(failed && started && !terminalAccountingCaptured)
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
      if (failed && started && !terminalAccountingCaptured) {
        try {
          // A reconnect may have started several provider attempts before the bridge failed.
          // Persist one unknown-cost marker for every unmetered attempt; dropping a later model
          // observation would let an earlier model appear homogeneous by accident.
          for (;;) {
            const attempts = runtimeOwnedExecutorProviderEvidence(executor)?.attempts.length ?? 0
            if (attempts <= meteredProviderAttempts) break
            await meterRuntimeOwnedProviderAttempt(
              scope,
              unmeteredSpend(0),
              providerEvidenceForNextMeter(),
              { role: 'driver', runtime: executor.runtime, telemetry: 'unknown-after-failure' },
            )
          }
          if (meteredProviderAttempts === 0) {
            await meterRuntimeOwnedProviderAttempt(
              scope,
              unmeteredSpend(0),
              providerEvidenceForNextMeter(),
              { role: 'driver', runtime: executor.runtime, telemetry: 'unknown-after-failure' },
            )
          }
        } catch (error) {
          // The budget pool intentionally throws after durably recording unknown capped usage and
          // closing that capacity. Only replace the original failure if the marker did not land.
          const budget = scope.budget
          if (budget.tokensKnown !== false || (budget.usdCapped && budget.usdKnown !== false)) {
            failure = error
          }
        }
      }
      try {
        await teardownOnce(completed ? DEFAULT_SUCCESSFUL_SHUTDOWN_MS : 'brutalKill')
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
      if (activeExecutor === executor) activeExecutor = undefined
    }
    if (failed) throw failure
  }
  drive.deliver = (message): boolean => {
    const deliver = activeExecutor?.deliver
    if (!deliver) return false
    return deliver.call(activeExecutor, message) !== false
  }
  return attestRuntimeOwnedScopeOwner(drive, 'cli')
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function'
  )
}

/** A name→value table, in this package's resolver-port shape (the same one `WaitProbeRegistry`
 *  uses): construction stays the caller's, lookup stays lazy, and a table backed by a file, a
 *  plugin loader, or a plain object all satisfy one interface. */
export interface SuperviseRegistryTable<T> {
  resolve(name: string): T | undefined
}

/**
 * The name→value tables that make the four CODE-valued options expressible as run DATA.
 *
 * `deliverable` / `finalizer` / `analysts` / `probes` are functions and registries, so a recorded
 * run configuration (a JSON row, a campaign spec, a resumed run's options) cannot carry them — and
 * a run with no `deliverable` cannot return a `winner` at all outside the sandbox backend, because
 * the finalizer keeps only children whose oracle passed and nothing else writes that verdict. A
 * caller that owns the code registers it here once and names it from data thereafter.
 */
export interface SuperviseRegistry {
  readonly deliverables?: SuperviseRegistryTable<DeliverableSpec<unknown>>
  readonly finalizers?: SuperviseRegistryTable<SupervisorFinalizer>
  readonly analysts?: SuperviseRegistryTable<AnalystRegistry>
  readonly probes?: SuperviseRegistryTable<WaitProbeRegistry>
}

/** Which registry table each nameable option resolves against. Indexing this map inside
 *  {@link resolveNamed} makes the pairing a type error to get wrong: `resolveNamed('probes',
 *  'deliverables', …)` does not compile. */
interface SuperviseRegistryTableFor {
  readonly deliverable: 'deliverables'
  readonly finalizer: 'finalizers'
  readonly analysts: 'analysts'
  readonly probes: 'probes'
}

/** Resolve one option that may be given as a value OR as a name into `opts.registry`. Both failure
 *  modes name the option, the requested name, and the table it was looked up in — a typo must not
 *  degrade into a silently unconfigured run (which for `deliverable` means "no run can ever
 *  deliver"). A resolver port cannot enumerate its names, so the message names the table instead of
 *  listing what was in it. */
function resolveNamed<K extends keyof SuperviseRegistryTableFor, T extends object>(
  option: K,
  table: SuperviseRegistryTableFor[K],
  value: T | string | undefined,
  registry: SuperviseRegistryTable<T> | undefined,
): T | undefined {
  if (typeof value !== 'string') return value
  if (!registry) {
    throw new ConfigError(
      `supervise: opts.${option} = ${JSON.stringify(value)} names a registry entry, but no ` +
        `opts.registry.${table} was provided to resolve it against`,
    )
  }
  const entry = registry.resolve(value)
  if (entry === undefined) {
    throw new ConfigError(
      `supervise: opts.${option} = ${JSON.stringify(value)} is not in opts.registry.${table} — ` +
        'the table resolved no entry under that name',
    )
  }
  return entry
}

export interface SuperviseOptions {
  /** The conserved compute pool for the whole run. */
  readonly budget: Budget
  /** Caller-created live handle for observing, steering, or cancelling this root manager. Runtime
   * attaches it before execution and detaches it after the join barrier. */
  readonly rootHandle?: RootHandle<unknown>
  /** Caller-owned cancellation for the complete recursive run. Aborting it cascades through the
   * root scope and every live child, including acquisition and backend execution. */
  readonly signal?: AbortSignal
  /** Trusted candidate and pursuit attribution for the root. The runtime derives profile/task
   * digests itself from the exact detached values it executes. */
  readonly execution?: AgentExecutionRef
  /** WHERE workers run — derives the worker seam. Provide this OR an explicit `makeWorkerAgent`. */
  readonly backend?: ExecutorConfig
  /** The independent completion check for backend-derived workers and direct supervisor
   *  submissions. Strongly recommended: without it the supervisor cannot submit its own work and
   *  backend-derived workers fall back to their own validity signal. A `string` names an entry in
   *  `registry.deliverables`. */
  readonly deliverable?: DeliverableSpec<unknown> | string
  /** Resolve the completion check for one exact authorized backend-derived leaf. The callback runs
   * after spawn authorization and driver classification, receives a detached immutable context,
   * and may return `undefined` to use the run-wide `deliverable`. Driver profiles never call it. */
  readonly resolveDeliverable?: (
    input: DeliverableResolutionInput,
  ) => DeliverableSpec<unknown> | undefined
  /** Name→value tables for the four code-valued options, so a recorded run configuration can name
   *  them instead of carrying closures. See {@link SuperviseRegistry}. */
  readonly registry?: SuperviseRegistry
  /** Where the coordination MCP binds when the supervisor is harness-driven. Omit = an ephemeral
   *  port on `127.0.0.1`, which an off-host root cannot reach. A non-loopback host is refused
   *  unless `allowUnauthenticatedRemote` acknowledges that the verbs are unauthenticated. */
  readonly coordination?: CoordinationBinding
  /** OPT-IN peer mail for the run's workers: sibling-to-sibling `send_mail` / `read_mail`, bounded
   *  and audited (`CoordinationToolsOptions.peerMail`). The runtime mints one capability URL per
   *  spawn, serves the mail listener beside the coordination MCP, and hands each worker its
   *  endpoint on {@link WorkerSpawnContext.peerMailUrl}. Mounting that URL into the worker is the
   *  `makeWorkerAgent` owner's job today: the runtime never writes it into a worker profile, since
   *  the fresh random URL would move the canonical profile digest, and bridge workers cannot mount
   *  it out of band until the bridge carries runtime attachments (#774). Requires a harness-brained
   *  supervisor; a router-brained supervisor is refused rather than silently unmailed. */
  readonly peerMail?: boolean | { limits?: Partial<PeerMailLimits> }
  /** Override the worker seam directly (tests / advanced) instead of deriving it from `backend`.
   *  This is caller-owned execution: profile security, spawn authorization, and recursive-driver
   *  selection below apply only to the backend-derived worker path. `authorizeMessage` still
   *  governs continuations sent through Runtime's coordination tools. */
  readonly makeWorkerAgent?: MakeWorkerAgent
  /** Override ONLY how an authorized LEAF executes, keeping the whole backend-derived path —
   *  profile security, spawn authorization, recursive-driver selection, nested supervisors — in
   *  force. Unlike `makeWorkerAgent`, which replaces that path, this slots inside it: the kernel
   *  authorizes and classifies every spawn, and a child that is NOT a driver runs through this
   *  factory instead of `backend`. A child that IS a driver still becomes a nested supervisor, whose
   *  own leaves use this same factory. Composes with `authorizeSpawn`; `backend` is then optional.
   *  This is the seam an offline test or a pinning layer (an agent graph) should use. */
  readonly makeLeafAgent?: MakeWorkerAgent
  /** Run harness-brained supervisors here. Automatic execution supports a local `bridge`; a remote
   *  sandbox requires an explicit `driveHarness` with a reachable coordination relay or tunnel.
   *  Defaults to `backend`; separate it when managers and workers use different services. */
  readonly driverBackend?: ExecutorConfig
  /** Security policy applied to every manager-authored child profile before budget reservation.
   *  The default blocks local and remote MCP, hooks, and connection grants. Pass an explicit
   *  allowlist to grant remote MCP hosts or other author-controlled capabilities. */
  readonly profileSecurity?: AgentProfileSecurityPolicy
  /** Product authority over one complete manager-authored spawn. The callback sees the detached,
   *  immutable profile, task, budget, label, and key together, so approving a profile cannot
   *  authorize a different task. Return the exact allowed profile (which may be narrowed) plus
   *  trusted candidate/pursuit attribution, or throw to refuse the whole spawn before reservation. */
  readonly authorizeSpawn?: (input: {
    readonly profile: AgentProfile
    readonly parent: AgentProfile
    /** Trusted identity of the manager authorizing this exact child. */
    readonly parentIdentity: NodeExecutionIdentity
    /** Concrete manager node; never accepted from model-authored tool arguments. */
    readonly parentNodeId: string
    /** Stable manager-scoped assignment, including deterministic unkeyed siblings. */
    readonly assignmentId: string
    readonly task: unknown
    readonly budget: Budget
    readonly label: string
    readonly key?: string
    readonly depth: number
    /** Present (as the analyst id) only when the runtime's analyst-on-settle hook initiated this
     *  spawn — authored by the runtime, never accepted from a driver's tool arguments. A node-pinning
     *  authority reads it to admit the analyst node it would refuse as a driver-authored spawn. */
    readonly analyst?: string
    /** The EFFECTIVE continuity of this spawn, resolved by the coordination layer. */
    readonly continuity?: ContinuityMode
  }) => AuthorizedSpawn
  /** Product authority over every continuation sent to a live child. When spawn authorization is
   * enabled, omitting this refuses steer/answer instructions instead of silently extending the
   * authorized task. The exact worker identity and detached bytes are recorded before delivery. */
  readonly authorizeMessage?: (
    input: DownMessageAuthorizationInput & {
      readonly parent: AgentProfile
      readonly depth: number
    },
  ) => AuthorizedDownMessage
  /** Decide whether an authorized child becomes another supervisor. By default only
   *  `metadata.role === 'driver'` does. Products receive the same frozen post-authorization
   *  context as `resolveDeliverable`, so trusted execution/assignment authority can override
   *  model-authored metadata without a side channel. */
  readonly isDriverProfile?: (input: AuthorizedSpawnContext) => boolean
  /** The supervisor's router substrate (`profile.harness` omitted or `cli-base`). The profile's
   *  model wins. */
  readonly router?: RouterTransportConfig
  /** When `driverBackend` is absent, whether an external-harness ROOT may default to running on
   *  `backend` (where workers run). `true` (default) keeps the convenience every direct caller has.
   *  A layer that gives `backend` a narrower meaning — `runGraph`, where it places WORKER nodes only
   *  — sets `false`, so an external root without an explicit `driverBackend` is refused before any
   *  compute rather than silently driven from the worker placement. */
  readonly rootDriverFromBackend?: boolean
  /** Run an external-harness supervisor explicitly. Required for a remote sandbox; optional as a
   *  caller-owned override for a local bridge. */
  readonly driveHarness?: DriveHarness
  /**
   * How hard a transiently-failed EXTERNAL driver is re-entered before the run ends
   * `driver-failed`. A harness process SIGKILLed at a bridge timeout, a stream cut mid-turn, or an
   * upstream 5xx used to end a run of arbitrary length while its budget and deadline sat almost
   * untouched (#741). A retry re-enters the driver over the SAME scope, coordination server, and
   * live children; the bridge backend reattaches the harness session by its durable execution id.
   *
   * Runtime's own refusals (a validation guard, an exhausted budget, an abort, a client-side
   * transport status) are never retried — they were decisions. Retries stop at the budget, the
   * deadline, an abort, or a run of attempts that changed nothing at all.
   *
   * Omit = retry under the defaults. `{ enabled: false }` = the historical behavior where the first
   * driver failure ends the run. Applies to the root manager and every recursive manager under it.
   */
  readonly driverRetry?: DriverRetryPolicy
  /** Per-attempt record for every external driver in the tree — what makes "failed after N
   *  attempts, last cause X" visible instead of one backend's last words. */
  readonly onDriverAttempt?: (record: DriverAttemptRecord) => void | Promise<void>
  /**
   * How long live children may keep running after the ROOT DRIVER FAILED, before the join barrier
   * cascades the abort into them. A root that died did not make its children unhealthy: a child
   * mid-unit holds work already paid for, and an immediate cascade discards everything it has not
   * yet written. Bounded by the run's own deadline. Omit/`0` = immediate teardown.
   */
  readonly childSettleGraceMs?: number
  /** Resolve one custom external-harness session per trusted manager identity. Use this instead of
   * `driveHarness` when recursive managers must be independently steerable. */
  readonly resolveDriveHarness?: ResolveDriveHarness
  /** Required with a custom `driveHarness` or `resolveDriveHarness`: declares which complete
   * AgentProfile axes that path really applies. Built-in bridge driving supplies its own
   * full-profile contract. */
  readonly driveHarnessMaterialization?: ProfileMaterializationContract
  /** Resolve product-owned tools from the exact trusted manager context. The same descriptors and
   * handlers are bound to router and external-harness managers; resolution happens once per node.
   * Each handler receives that manager scope's live cancellation signal in its trusted invocation
   * context, including recursive parent and root cascades, plus `context.verbs` — that manager's
   * own coordination verbs, callable in code so a product tool can COMPOSE its children (fan out,
   * chain, join, retry) in one tool call instead of one model turn per verb. Every verb crosses
   * the same authorizeSpawn / security / allowedModels gate, pool reservation, `maxLiveWorkers`
   * cap, journal, and bus the MCP verb crosses, at every depth and on both arms. */
  readonly resolveSupervisorTools?: ResolveSupervisorTools
  /** Awaited product transaction hook for every coordination record. `eventId` is stable across a
   * lost acknowledgement and durable restart; the record is not pull-visible until this commits. */
  readonly onCoordinationEvent?: (
    context: SupervisorNodeContext,
    eventId: Sha256Digest,
    record: BusRecord<CoordinationEvent>,
  ) => void | Promise<void>
  /** WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
   *  itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
   *  `executeExtraTool`. Router arm only (`profile.harness` omitted or `cli-base`). */
  readonly extraTools?: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly parameters: Record<string, unknown>
  }>
  /** Runs an `extraTools` call; null/undefined falls through to the coordination dispatch. */
  readonly executeExtraTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string | null | undefined>
  /** Per-child budget reserved on each spawn. Defaults to a quarter of the pool's tokens. */
  readonly perWorker?: Budget
  /** Hard cap on simultaneously executing spawned workers across the WHOLE recursive tree. The
   *  root is excluded; nested drivers and leaves share one allocation, so recursion cannot multiply
   *  the cap. Omit/`<= 0` = no cap (the conserved pool stays the only bound). */
  readonly maxLiveWorkers?: number
  /** Analyst lenses available to the driver. Required for `analyzeOnSettle`. Unset → status quo
   *  (the driver receives settled worker outputs, no analyst findings). A `string` names an entry in
   *  `registry.analysts`. */
  readonly analysts?: AnalystRegistry | string
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
   *  the driver pulls (`await_event`) and composes its next steer from. The self-improving UP-leg,
   *  threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
   *  Omit/empty = status quo (no analyst feed). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
  /**
   * Watch every worker's LIVE tool trace with the online detector panel and raise a `finding` the
   * moment one loops or error-storms — so the supervisor learns it mid-run (via `await_event`)
   * instead of at settle. Pairs with a steerable worker: the finding is the evidence, `steer_agent`
   * is the correction. Requires a backend whose executor exposes a trace source (the steerable
   * sandbox worker and the pi wrapper do); other runtimes are simply not watched.
   *
   * Omit = off (status quo — no online watching, no extra events).
   */
  readonly watchWorkers?: WorkerWatchOptions
  /** Idle time after which `observe_agent` reports a running worker as `stalled`. A derived read
   *  at observation time — nothing is killed or retried. Omit = the runtime default. */
  readonly stallAfterMs?: number
  /** Default continuity per worker PROFILE NAME: `'resume'` makes each spawn of that name after
   *  the first re-attach to the node's most recent SETTLED worker — a NEW live worker whose spawn
   *  context carries the prior worker's identity (`WorkerSpawnContext.resume`), which the executor
   *  seam re-attaches with. `spawn_agent`'s per-call `continuity` argument overrides in either
   *  direction; `runGraph` derives this from delegates-edge `continuity`. Omit = every spawn is
   *  `'fresh'` (status quo). See `CoordinationToolsOptions.continuityByProfile` for the
   *  refusal semantics (no-prior / while-live / with-key) and the process-local resume boundary. */
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>
  /** Worker output store. Defaults to in-memory. */
  readonly blobs?: ResultBlobStore
  /**
   * Make the run DURABLE: journal + result blobs + the coordination side-log are file-backed under
   * this directory (`createFileRunContext`), fsynced per write, and the supervisor reads the prior
   * tree first. Re-running with the same `runDir` AND the same `runId` resumes only when the exact
   * root profile/task identity and declared budget match. The original absolute deadline and prior
   * measured spend are restored before new admission. The built-in driver is resume-aware: children
   * that already settled, including their exact execution identities, are replayed onto
   * `Scope.resume` (and into the driver's settled ledger + its first context), keyed assignments
   * (`spawn_agent`'s `key`) resolve to their committed results instead of re-running, pending
   * waits re-arm on their original deadlines, and the coordination log loads prior questions,
   * findings, and instruction receipts. The router arm receives all three in its resume brief; the
   * external arm seeds prior questions while findings and receipts remain in the durable log.
   * Instruction receipts are evidence and are never delivered automatically to a replacement
   * worker. The final result spans both processes' work. Unset = in-memory, fresh every call.
   *
   * The boundary that remains: work that was IN FLIGHT when the process died is not recovered —
   * the built-in executors cannot re-attach to a dead process's executions. Each such assignment
   * resumes as explicitly lost/in-doubt, its full declared reservation is charged conservatively,
   * and its token/dollar telemetry remains unknown. A retry is admitted only from safely remaining
   * capacity, so restart cannot mint a fresh budget or slide the original absolute deadline.
   *
   * `runId` matters here: it defaults to the constant `'supervise'`, which is fine for a single
   * resumable run per directory but collides across concurrent runs sharing one `runDir`.
   */
  readonly runDir?: string
  /** Override the spawn journal directly (advanced; `runDir` is the ordinary durable path). Pair
   *  with `blobs` — a journal whose result payloads live in a different store cannot replay. */
  readonly journal?: SpawnJournal
  /** Predicate registry for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so the
   *  wait survives a restart; this is what the name resolves against. Unset ⇒ `poll` waits are
   *  refused `unknown-probe` and `timer` waits still work. A `string` names an entry in
   *  `registry.probes`. */
  readonly probes?: WaitProbeRegistry | string
  /**
   * PROGRESS-derived stop rule (BOTH arms). Ends a run that has stopped LEARNING before it
   * exhausts a ceiling — the answer to "a run should end because it is done or stuck, not because
   * it ran out". It composes with the budget guards and can never override one.
   *
   * The evaluation boundary differs by arm because the loop does: a router-brained supervisor is
   * evaluated before each of its own inference turns; a harness-brained supervisor is evaluated on
   * each worker settle, and a stop aborts its stop signal so the harness ends at its next turn
   * boundary. Both arms fold the same settled ledger through the same evaluator.
   *
   * Build it from `supervise/stop-rules`: `plateau({window, minDelta})`,
   * `noProgressFor({ms, settles})`, `allWorkersStalled({...})`, combined with `anyOf`/`allOf`. The
   * thresholds are policy and stay with you; the enforcement lives in the runtime. Omit = ceilings
   * only (unchanged behavior).
   */
  readonly stopRule?: StopRule
  /** One-shot notification of WHY a `stopRule` ended the run (BOTH arms) — so a caller records the
   *  reason instead of inferring an early stop from an unexhausted budget. */
  readonly onProgressStop?: (reason: string) => void
  readonly maxDepth?: number
  /** Turn cap for the supervisor's OWN loop (BOTH arms). Router arm: inference turns of the
   *  driver's tool loop. Harness arm: turns the harness reports, counted off its `iteration`
   *  stream — reaching the cap aborts the stop signal, so the harness ends at its next turn
   *  boundary rather than mid-request. `0` lifts the cap on both arms and leaves the conserved
   *  pool, the deadline, and abort as the bounds; a negative value is refused. Omit = the router
   *  arm's default cap, and no turn cap on the harness arm. */
  readonly maxTurns?: number
  /** Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY —
   *  a harness owns its own context window and its own compaction, so this is refused for a
   *  harness-brained supervisor rather than silently ignored): once its coordination transcript
   *  exceeds `thresholdTokens` it distills to a compact progress note and continues, instead of
   *  re-billing the whole transcript every turn (the cost that makes the LLM-brain front door lose
   *  to a dumb-Ralph respawn). The live `Scope` roster is the durable state across chapters.
   *  Default off. `distill` defaults to a brain self-summary + the settled-worker roster. */
  readonly compaction?: ToolLoopCompactionOptions
  readonly runId?: string
  readonly now?: () => number
  /** Restrict the run to this subset of models. When set, every configured model — the
   *  supervisor router model, the profile's model, and the backend's model — must be a member,
   *  or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted.
   *
   *  This is a MODEL-ID filter, not a route filter. The compared values are the bare ids a profile
   *  declares — `model.default`, `model.small`, `subagents[].model`, `modes[].model`. The composed
   *  wire id (`harness/provider/model`) is never built here and never compared, so an entry written
   *  in qualified form matches nothing, and a child that names an allowed id is admitted whatever
   *  harness and provider its own profile declares. Pin the route with `authorizeSpawn`: it reads
   *  the authored child profile and may refuse the spawn before any reservation. */
  readonly allowedModels?: readonly string[]
  /** How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
   *  highest-scoring DELIVERED child (the exact behavior every existing caller had). Alternatives:
   *  `collectDelivered` (every verified distinct output with provenance — a Pareto set / recorded
   *  disagreement) or a custom `SupervisorFinalizer`. Whatever the finalizer, it operates on
   *  structurally DELIVERED outputs only — an undelivered or invalid child stays ineligible. A
   *  `string` names an entry in `registry.finalizers`. */
  readonly finalizer?: SupervisorFinalizer | string
  /** Lifecycle observers for the whole recursive tree (`Scope` re-seeds them into every nested
   *  scope). Composed with the `otel` recorder below when both are set. Omit = no observers, which
   *  is the behavior every existing caller has. */
  readonly hooks?: RuntimeHooks
  /**
   * OPT-IN OTLP tracing: emit one span per supervised node (opened at spawn, closed at settle,
   * parented to its parent node's span) plus an `LLM` child span per metered driver turn, so the
   * tree is readable by any trace viewer instead of only by a journal parser. See `otel-spans.ts`.
   *
   * Omit and the run emits nothing, allocates no recorder, and installs no hook — telemetry is
   * never a default. Present with no reachable endpoint (no `exportConfig.endpoint` and no
   * `OTEL_EXPORTER_OTLP_ENDPOINT`) is also a no-op. The spawn journal is untouched either way:
   * spans are telemetry, never the replay/resume record.
   */
  readonly otel?: Omit<SupervisorSpanOptions, 'runId' | 'now'>
}

/** The product-authorized result for one complete spawn request. Attribution is never accepted
 * from the manager itself; it enters only through this trusted callback. */
export interface AuthorizedSpawn {
  readonly profile: AgentProfile
  readonly execution?: AgentExecutionRef
}

/** Exact trusted context after a manager-authored spawn has passed product authorization. */
export interface AuthorizedSpawnContext {
  readonly profile: AgentProfile
  readonly parent: AgentProfile
  readonly parentIdentity: NodeExecutionIdentity
  readonly execution: NodeExecutionIdentity
  readonly parentNodeId: string
  readonly assignmentId: string
  readonly task: unknown
  readonly budget: Budget
  readonly label: string
  readonly key?: string
  readonly depth: number
}

/** Exact trusted context for selecting one backend-derived leaf's completion check. */
export type DeliverableResolutionInput = AuthorizedSpawnContext

function captureDeliverable(
  deliverable: DeliverableSpec<unknown>,
  context: string,
): DeliverableSpec<unknown> {
  if (typeof deliverable !== 'object' || deliverable === null || Array.isArray(deliverable)) {
    throw new ValidationError(`${context}: deliverable must be an object`)
  }
  if (typeof deliverable.check !== 'function') {
    throw new ValidationError(`${context}: deliverable.check must be a function`)
  }
  return Object.freeze({
    ...detachedSnapshot({ describe: deliverable.describe }, `${context} configuration`),
    check: deliverable.check,
  })
}

/** Capture the public one-call configuration before any asynchronous work starts. Decision data is
 * detached and frozen; executable ports are copied as the exact references selected at intake.
 * Service internals intentionally remain live, while replacing a callback/service on the caller's
 * mutable options object can no longer change an in-flight run. */
function captureSuperviseOptions(opts: SuperviseOptions): SuperviseOptions {
  const {
    backend,
    driverBackend,
    deliverable,
    resolveDeliverable,
    router,
    compaction,
    watchWorkers,
    analysts,
    makeWorkerAgent,
    makeLeafAgent,
    blobs,
    journal,
    probes,
    registry,
    hooks,
    otel,
    authorizeSpawn,
    authorizeMessage,
    isDriverProfile,
    driveHarness,
    resolveDriveHarness,
    resolveSupervisorTools,
    onCoordinationEvent,
    executeExtraTool,
    stopRule,
    onProgressStop,
    onDriverAttempt,
    finalizer,
    now,
    signal,
    rootHandle,
    ...decisionData
  } = opts
  const capturedData = detachedSnapshot(decisionData, 'supervise options')
  const capturedBackend = backend === undefined ? undefined : snapshotExecutorConfig(backend)
  const capturedDriverBackend =
    driverBackend === undefined ? undefined : snapshotExecutorConfig(driverBackend)
  // A string names a registry entry; it is resolved (and the resolved spec validated) by
  // `resolveNamed` before anything is built or spent.
  const capturedDeliverable =
    deliverable === undefined || typeof deliverable === 'string'
      ? deliverable
      : captureDeliverable(deliverable, 'supervise deliverable')
  const capturedRouter =
    router === undefined
      ? undefined
      : (() => {
          const { complete, ...routerData } = router
          return Object.freeze({
            ...detachedSnapshot(routerData, 'supervise router configuration'),
            ...(complete === undefined ? {} : { complete }),
          })
        })()
  const capturedCompaction =
    compaction === undefined
      ? undefined
      : (() => {
          const { distill, estimateTokens, onCompact, ...compactionData } = compaction
          return Object.freeze({
            ...detachedSnapshot(compactionData, 'supervise compaction configuration'),
            ...(distill === undefined ? {} : { distill }),
            ...(estimateTokens === undefined ? {} : { estimateTokens }),
            ...(onCompact === undefined ? {} : { onCompact }),
          })
        })()
  const capturedWatchWorkers =
    watchWorkers === undefined
      ? undefined
      : Object.freeze({
          ...detachedSnapshot(
            { maxFindingsPerWorker: watchWorkers.maxFindingsPerWorker },
            'supervise worker-watch configuration',
          ),
          ...(watchWorkers.detectors === undefined
            ? {}
            : { detectors: Object.freeze([...watchWorkers.detectors]) }),
        })
  const capturedAnalysts =
    analysts === undefined || typeof analysts === 'string'
      ? analysts
      : Object.freeze({
          kinds: detachedSnapshot(analysts.kinds, 'supervise analyst kinds'),
          run: analysts.run,
        })

  return Object.freeze({
    ...capturedData,
    ...(capturedBackend === undefined ? {} : { backend: capturedBackend }),
    ...(capturedDriverBackend === undefined ? {} : { driverBackend: capturedDriverBackend }),
    ...(capturedDeliverable === undefined ? {} : { deliverable: capturedDeliverable }),
    ...(resolveDeliverable === undefined ? {} : { resolveDeliverable }),
    ...(capturedRouter === undefined ? {} : { router: capturedRouter }),
    ...(capturedCompaction === undefined ? {} : { compaction: capturedCompaction }),
    ...(capturedWatchWorkers === undefined ? {} : { watchWorkers: capturedWatchWorkers }),
    ...(capturedAnalysts === undefined ? {} : { analysts: capturedAnalysts }),
    ...(makeWorkerAgent === undefined ? {} : { makeWorkerAgent }),
    ...(makeLeafAgent === undefined ? {} : { makeLeafAgent }),
    ...(blobs === undefined ? {} : { blobs }),
    ...(journal === undefined ? {} : { journal }),
    ...(probes === undefined ? {} : { probes }),
    ...(authorizeSpawn === undefined ? {} : { authorizeSpawn }),
    ...(authorizeMessage === undefined ? {} : { authorizeMessage }),
    ...(isDriverProfile === undefined ? {} : { isDriverProfile }),
    ...(driveHarness === undefined ? {} : { driveHarness }),
    ...(resolveDriveHarness === undefined ? {} : { resolveDriveHarness }),
    ...(resolveSupervisorTools === undefined ? {} : { resolveSupervisorTools }),
    ...(onCoordinationEvent === undefined ? {} : { onCoordinationEvent }),
    ...(executeExtraTool === undefined ? {} : { executeExtraTool }),
    ...(stopRule === undefined ? {} : { stopRule }),
    ...(onProgressStop === undefined ? {} : { onProgressStop }),
    ...(onDriverAttempt === undefined ? {} : { onDriverAttempt }),
    ...(finalizer === undefined ? {} : { finalizer }),
    ...(now === undefined ? {} : { now }),
    ...(signal === undefined ? {} : { signal }),
    ...(rootHandle === undefined ? {} : { rootHandle }),
    // Live collaborators: registries resolve lazily, hooks and otel exporters are process objects.
    // They are captured as the exact references selected at intake, never deep-snapshot.
    ...(registry === undefined ? {} : { registry }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(otel === undefined ? {} : { otel }),
  })
}

/**
 * Record what a run-scoped cancel actually did, at the ONE place that observes the run's terminal
 * state: the `supervise()` settle path.
 *
 * The root manager writes `cancel_requested` when it issues the abort; only here is the run's own
 * outcome known. A run that ends `aborted` after that request reads `cancelled`; a run that
 * reached any other terminal state despite the request terminated nothing and reads `not_live`,
 * never a success. A request the run ended before applying is expired here too, so a reader can
 * tell run-over from in-progress and a stale request cannot outlive its run.
 */
function recordRunCancellationOutcome(
  runDir: string | undefined,
  result: SupervisedResult<unknown>,
  now: () => number,
): void {
  if (runDir === undefined) return
  const dir = resolve(runDir)
  const request = readRunCancelRequest(dir)
  if (request === undefined) return
  const record = readRunCancellation(dir, request.operationId)
  if (record !== undefined && record.effect !== 'cancel_requested') return
  const aborted = result.kind === 'no-winner' && result.reason === 'aborted'
  const observedAt = new Date(now()).toISOString()
  const base = {
    operationId: request.operationId,
    requestedAt: request.at,
    observedAt,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
  }
  if (record === undefined) {
    writeRunCancellation(dir, {
      ...base,
      effect: 'not_live',
      detail: 'run ended before the request was applied',
    })
    return
  }
  writeRunCancellation(
    dir,
    aborted
      ? { ...base, effect: 'cancelled', detail: 'the run reached its terminal aborted state' }
      : {
          ...base,
          effect: 'not_live',
          detail: `run settled ${result.kind === 'winner' ? 'winner' : result.reason} despite the abort request; nothing was terminated`,
        },
  )
}

/** A quarter of token and optional dollar capacity per worker; nested managers partition again. */
/** A per-child budget may not exceed the conserved pool it is reserved from. */
function assertPerWorkerWithinPool(perWorker: Budget, pool: Budget): void {
  const over = (child: number, total: number, field: string): string | null =>
    child > total
      ? `supervise perWorker.${field} (${child}) exceeds budget.${field} (${total})`
      : null
  const problems = [
    over(perWorker.maxTokens, pool.maxTokens, 'maxTokens'),
    over(perWorker.maxIterations, pool.maxIterations, 'maxIterations'),
    perWorker.maxUsd !== undefined && pool.maxUsd !== undefined
      ? over(perWorker.maxUsd, pool.maxUsd, 'maxUsd')
      : null,
  ].filter((x): x is string => x !== null)
  if (problems.length > 0) {
    throw new ValidationError(
      `${problems.join('; ')} — a per-child ceiling cannot exceed the pool it draws from, and ` +
        'accepting it silently leaves the caller believing a knob is in effect when the ' +
        'reservation still clamps the child.',
    )
  }
}

function defaultPerWorker(budget: Budget): Budget {
  return {
    maxIterations: Math.max(1, Math.floor(budget.maxIterations / 4)),
    maxTokens: Math.max(1, Math.floor(budget.maxTokens / 4)),
    ...(budget.maxUsd !== undefined ? { maxUsd: budget.maxUsd / 4 } : {}),
  }
}

function freezeDetached<T>(value: T): T {
  return detachedSnapshot(value, 'supervise')
}

function freezeDetachedProfile(value: unknown): AgentProfile {
  return freezeDetached(agentProfileSchema.parse(value))
}

function canonicalExecution(
  profile: AgentProfile,
  task: unknown,
  rawExecution: AgentExecutionRef | undefined,
  context: string,
): { readonly identity: NodeExecutionIdentity; readonly ref?: AgentExecutionRef } {
  const execution = rawExecution === undefined ? undefined : freezeDetached(rawExecution)
  if (execution !== undefined) {
    if (typeof execution !== 'object' || execution === null || Array.isArray(execution)) {
      throw new ValidationError(`${context}: execution must be an object`)
    }
    const unknown = Object.keys(execution).filter(
      (key) => key !== 'candidateDigest' && key !== 'correlation',
    )
    if (unknown.length > 0) {
      throw new ValidationError(`${context}: unknown execution fields: ${unknown.join(', ')}`)
    }
  }
  const identity = deriveNodeExecutionIdentity({ profile, execution }, task)
  if (!identity?.profileDigest || !identity.taskDigest) {
    throw new ValidationError(
      `${context}: profile and task must be finite, acyclic canonical JSON for durable identity`,
    )
  }
  const ref: AgentExecutionRef | undefined =
    identity.candidateDigest || identity.correlation
      ? Object.freeze({
          ...(identity.candidateDigest ? { candidateDigest: identity.candidateDigest } : {}),
          ...(identity.correlation ? { correlation: identity.correlation } : {}),
        })
      : undefined
  return { identity, ...(ref ? { ref } : {}) }
}

function rootCoordinationOwner(identity: NodeExecutionIdentity): string {
  return canonicalCandidateDigest({ kind: 'supervisor-root', identity })
}

function childCoordinationOwner(
  parentOwnerId: string,
  identity: NodeExecutionIdentity,
  context: WorkerSpawnContext,
  depth: number,
): string {
  return canonicalCandidateDigest({
    kind: 'supervisor-child',
    parentOwnerId,
    identity,
    assignment: {
      id: context.assignmentId,
      label: context.label,
      key: context.key ?? null,
      depth,
    },
  })
}

function supervisionRunNamespace(runDir: string | undefined, runId: string): string {
  return canonicalCandidateDigest(
    runDir === undefined
      ? { kind: 'supervise-ephemeral-run', runId, nonce: randomUUID() }
      : { kind: 'supervise-durable-run', runId, runDir: resolve(runDir) },
  )
}

function workerAssignmentNamespace(
  runNamespace: string,
  parentOwnerId: string,
  assignmentId: string,
): string {
  return canonicalCandidateDigest({
    kind: 'supervise-worker-assignment',
    runNamespace,
    parentOwnerId,
    assignmentId,
  })
}

/** Hash only durable coordination meaning. Bus sequence/timestamp are delivery metadata and a
 * resumed projection's marker describes the reader, not the original settlement. */
function coordinationEventId(
  context: SupervisorNodeContext,
  event: CoordinationEvent,
): Sha256Digest {
  const durableEvent =
    event.type === 'settled' && event.worker.resumed === true
      ? (() => {
          const { resumed: _resumed, ...worker } = event.worker
          return { type: 'settled' as const, worker }
        })()
      : event
  return canonicalCandidateDigest({
    kind: 'supervise-coordination-event',
    runNamespace: context.runNamespace,
    ownerId: context.ownerId,
    event: detachedSnapshot(durableEvent, 'supervise coordination event identity'),
  })
}

/** Test-only one-call shape, exported only through the package's explicit `/testing` entry. */
export interface SuperviseTestOptions extends SuperviseOptions {
  readonly brain: ToolLoopChat
}

/** One-call supervisor: build + run a supervisor from its exact profile. @stable */
export function supervise(profile: SupervisorProfile, task: unknown, opts: SuperviseOptions) {
  if ('brain' in opts) {
    throw new ValidationError(
      'supervise: direct brain injection is test-only; production execution derives the model call from AgentProfile',
    )
  }
  return superviseInternal(profile, task, opts)
}

/** Deterministic scripted-brain path for tests. Not exported from Runtime's main entry. */
export function superviseWithTestBrain(
  profile: SupervisorProfile,
  task: unknown,
  opts: SuperviseTestOptions,
) {
  const { brain, ...runtimeOptions } = opts
  return superviseInternal(profile, task, runtimeOptions, brain)
}

function superviseInternal(
  profile: SupervisorProfile,
  task: unknown,
  opts: SuperviseOptions,
  testBrain?: ToolLoopChat,
) {
  const options = captureSuperviseOptions(opts)
  assertValidBudget(options.budget, 'supervise budget')
  // Fail loud before any compute: every configured model must be in the allowed subset (no-op
  // when allowedModels is unset). The backend seam carries its own model on most backends.
  const parsedProfile = agentProfileSchema.safeParse(profile)
  if (!parsedProfile.success) {
    throw new ValidationError(`supervise: invalid AgentProfile: ${parsedProfile.error.message}`)
  }
  const canonicalProfile = freezeDetachedProfile(parsedProfile.data)
  assertExecutableAgentProfile(canonicalProfile, 'supervise root')
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
    canonicalProfile,
    canonicalTask,
    options.execution,
    'supervise root',
  )
  const backendModel = (options.backend as { model?: unknown } | undefined)?.model
  const driverBackendModel = (options.driverBackend as { model?: unknown } | undefined)?.model
  assertProfileModelsAllowed(canonicalProfile, options.allowedModels)
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
  const probes = resolveNamed('probes', 'probes', options.probes, options.registry?.probes)
  assertCoordinationBinding(options.coordination)

  // `withDriver: true` is the wiring invariant either way (a `role: 'driver'` child must resolve
  // to the nested-scope executor); `runDir` only changes WHERE the journal and blobs live.
  const ctx =
    options.runDir !== undefined
      ? createFileRunContext(options.runDir, { withDriver: true })
      : createInMemoryRunContext({ withDriver: true })
  const blobs = options.blobs ?? ctx.blobs
  const perWorker = options.perWorker ?? defaultPerWorker(options.budget)
  assertValidBudget(perWorker, 'supervise perWorker')
  // A per-child ceiling larger than the pool it draws from cannot be honored, so accepting it
  // silently misleads the caller: the child is capped by the reservation instead and dies with
  // "ticket N spent X tokens > reserved Y", which reads as a budget outcome rather than a
  // misconfiguration. Observed in the field with perWorker.maxTokens = 3_200_000_000 against a
  // 200_000_000 pool, where children were still clamped at 700_000 and the caller had no way to
  // tell the knob was inert. Refuse at construction, where the caller can still fix it.
  assertPerWorkerWithinPool(perWorker, options.budget)
  const journal = options.journal ?? ctx.journal
  const runId = options.runId ?? 'supervise'
  const runNamespace = supervisionRunNamespace(options.runDir, runId)
  const log = ctx.coordinationLog
  const rootOwnerId = rootCoordinationOwner(rootExecution.identity)
  const rootProviderModels: Array<string | undefined> = []
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
  // Derived from the backend the run already declares — no new knob. Only a bridge can answer the
  // route and admission questions, so only a bridge backend installs one.
  const spawnPreflight: SpawnPreflight | undefined =
    options.backend?.backend === 'bridge' ? bridgeSpawnPreflight(options.backend) : undefined
  if (options.driveHarness && options.resolveDriveHarness) {
    throw new ValidationError('supervise: provide driveHarness or resolveDriveHarness, not both')
  }
  const hasCustomDriveHarness = Boolean(options.driveHarness || options.resolveDriveHarness)
  // A custom harness receives the WHOLE profile by contract (`DriveHarness.profile` is the
  // caller's object, never rewritten), so an undeclared materialization defaults to the full
  // canonical leaf set — responsibility for every axis transfers to the harness the caller owns.
  // Declaring `driveHarnessMaterialization` narrows that claim and turns dropped axes into
  // pre-spawn faults.
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
    return managerBackend && automaticDriverBackendSupported(managerBackend)
      ? driveHarnessFromBackend(
          managerBackend,
          externalExecutionId('supervised-manager', {
            runNamespace,
            ownerId: context.ownerId,
          }),
          options.now ?? Date.now,
          options.maxTurns,
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
  )

  const now = options.now ?? Date.now

  // The span recorder for this run, built inside `start()` so a configuration fault below still
  // throws without leaving an exporter's flush timer behind. The worker seam reads it LAZILY (it is
  // resolved once per spawned worker, long after `start()` assigned this), which is what lets the
  // seam be built here while the recorder is built there.
  let spans: SupervisorSpanRecorder | undefined

  // Classify the worker backend against the propagation census ONCE: a backend with no channel to
  // carry the trace context makes every traced spawn a severed hop, journaled per spawn as
  // `trace-unpropagated` (see `worker-trace.ts` for the census). A caller-owned `makeWorkerAgent`
  // is unclassifiable — no claim is journaled rather than a guessed one.
  const traceUnpropagated = options.backend
    ? workerTraceUnpropagatedDeclaration(options.backend.backend)
    : undefined

  let makeWorkerAgent = options.makeWorkerAgent
  if (!makeWorkerAgent) {
    if (!options.backend && !options.makeLeafAgent) {
      throw new ValidationError(
        'supervise: provide opts.backend (where workers run), opts.makeLeafAgent, or opts.makeWorkerAgent',
      )
    }
    // A caller-owned leaf factory slots in here, under the same authorization and classification
    // every backend-derived leaf gets; `backend` is then only needed for a per-spawn deliverable.
    const makeLeaf =
      options.makeLeafAgent ?? workerFromBackend(options.backend as ExecutorConfig, deliverable)
    const securityPolicy = options.profileSecurity ?? DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY

    const makeRecursiveWorkerFor = (
      parent: AgentProfile,
      parentIdentity: NodeExecutionIdentity,
      depth: number,
      parentOwnerId: string,
    ): MakeWorkerAgent => {
      const makeRecursiveWorker: MakeWorkerAgent = (authoredProfile, spawnContext) => {
        if (!spawnContext) {
          throw new ValidationError('supervise: backend-derived workers require spawn context')
        }
        const input = freezeDetachedProfile(authoredProfile)
        const authorizationInput = Object.freeze({
          profile: input,
          parent,
          parentIdentity,
          parentNodeId: spawnContext.parentNodeId,
          assignmentId: spawnContext.assignmentId,
          task: spawnContext.task,
          budget: spawnContext.budget,
          label: spawnContext.label,
          ...(spawnContext.key !== undefined ? { key: spawnContext.key } : {}),
          depth,
          ...(spawnContext.analyst !== undefined ? { analyst: spawnContext.analyst } : {}),
          ...(spawnContext.continuity !== undefined ? { continuity: spawnContext.continuity } : {}),
        })
        const decision = options.authorizeSpawn
          ? freezeDetached(options.authorizeSpawn(authorizationInput))
          : Object.freeze({
              profile: input,
              ...(spawnContext.execution ? { execution: spawnContext.execution } : {}),
            })
        if (typeof decision !== 'object' || decision === null || Array.isArray(decision)) {
          throw new ValidationError('supervise: authorizeSpawn must return an AuthorizedSpawn')
        }
        const authorized = freezeDetachedProfile(decision.profile)
        const childExecution = canonicalExecution(
          authorized,
          spawnContext.task,
          decision.execution,
          `supervise spawn ${JSON.stringify(spawnContext.label)}`,
        )
        const authorizedContext = Object.freeze({
          ...spawnContext,
          ...(childExecution.ref ? { execution: childExecution.ref } : {}),
        })
        const postAuthorizationContext: AuthorizedSpawnContext = freezeDetached({
          profile: authorized,
          parent,
          parentIdentity,
          execution: childExecution.identity,
          parentNodeId: spawnContext.parentNodeId,
          assignmentId: spawnContext.assignmentId,
          task: spawnContext.task,
          budget: spawnContext.budget,
          label: spawnContext.label,
          ...(spawnContext.key !== undefined ? { key: spawnContext.key } : {}),
          depth,
        })
        const security = validateAgentProfileSecurity(authorized, securityPolicy)
        if (!security.ok) {
          const details = security.issues
            .filter((issue) => issue.level === 'error')
            .map((issue) => `${issue.code}${issue.path ? ` at ${issue.path}` : ''}`)
            .join(', ')
          throw new ValidationError(`supervise: spawned AgentProfile refused: ${details}`)
        }
        assertProfileModelsAllowed(authorized, options.allowedModels)
        let isDriver: boolean
        if (options.isDriverProfile) {
          const driverDecision: unknown = options.isDriverProfile(postAuthorizationContext)
          if (typeof driverDecision !== 'boolean') {
            throw new ValidationError('supervise: isDriverProfile must return a boolean')
          }
          isDriver = driverDecision
        } else {
          isDriver = authorized.metadata?.role === 'driver'
        }
        if (!isDriver) {
          const selectedDeliverable = options.resolveDeliverable?.(postAuthorizationContext)
          const leafDeliverable =
            selectedDeliverable === undefined
              ? deliverable
              : captureDeliverable(
                  selectedDeliverable,
                  `supervise deliverable for ${JSON.stringify(spawnContext.label)}`,
                )
          if (leafDeliverable !== deliverable && !options.backend) {
            throw new ValidationError(
              'supervise: resolveDeliverable selected a per-spawn deliverable but there is no backend to derive that leaf from; makeLeafAgent owns its own completion check',
            )
          }
          const makeSelectedLeaf =
            leafDeliverable === deliverable
              ? makeLeaf
              : workerFromBackend(options.backend as ExecutorConfig, leafDeliverable)
          return makeSelectedLeaf(
            authorized,
            Object.freeze({
              ...authorizedContext,
              assignmentId: workerAssignmentNamespace(
                runNamespace,
                parentOwnerId,
                spawnContext.assignmentId,
              ),
            }),
          )
        }
        const ownerId = childCoordinationOwner(
          parentOwnerId,
          childExecution.identity,
          spawnContext,
          depth,
        )
        const nestedDriveHarness = isExternalSupervisor(authorized)
          ? driveHarnessForOwner(
              freezeDetached({
                runId,
                runNamespace,
                ownerId,
                depth,
                identity: childExecution.identity,
                assignmentId: spawnContext.assignmentId,
                profile: authorized,
                task: spawnContext.task,
              }),
            )
          : undefined
        if (isExternalSupervisor(authorized) && !nestedDriveHarness) {
          throw new ValidationError(
            `supervise: authored external supervisor profile.harness=${JSON.stringify(authorized.harness)} requires a local bridge driverBackend, an explicit driveHarness, or resolveDriveHarness with reachable coordination transport`,
          )
        }
        assertProfileContract(
          authorized,
          isExternalSupervisor(authorized)
            ? (driverMaterialization as ProfileMaterializationContract)
            : promptModelProfileMaterialization,
          `supervise driver ${JSON.stringify(spawnContext.label)}`,
        )
        if (managerBackend) {
          assertBridgeProfileMaterializes(
            authorized,
            managerBackend,
            `supervise driver ${JSON.stringify(spawnContext.label)}`,
          )
        }

        const childFactory = makeRecursiveWorkerFor(
          authorized,
          childExecution.identity,
          depth + 1,
          ownerId,
        )
        const nestedPerWorker = defaultPerWorker(spawnContext.budget)
        const authorizeNestedMessage = authorizeDownFor(authorized, depth + 1)
        const nested = supervisorAgent(authorized, {
          blobs,
          makeWorkerAgent: childFactory,
          ...(authorizeNestedMessage ? { authorizeDownMessage: authorizeNestedMessage } : {}),
          perWorker: nestedPerWorker,
          ...(options.router ? { router: options.router } : {}),
          ...(nestedDriveHarness ? { driveHarness: nestedDriveHarness } : {}),
          nodeContext: {
            runId,
            runNamespace,
            ownerId,
            depth,
            identity: childExecution.identity,
            assignmentId: spawnContext.assignmentId,
          },
          ...(options.resolveSupervisorTools
            ? { resolveSupervisorTools: options.resolveSupervisorTools }
            : {}),
          ...(observeNodeEvent ? { observeNodeEvent, replaySettlements: true } : {}),
          ...(analysts ? { analysts } : {}),
          ...(options.analyzeOnSettle ? { analyzeOnSettle: options.analyzeOnSettle } : {}),
          ...(options.watchWorkers ? { watchWorkers: options.watchWorkers } : {}),
          ...(options.stallAfterMs !== undefined ? { stallAfterMs: options.stallAfterMs } : {}),
          ...(options.continuityByProfile
            ? { continuityByProfile: options.continuityByProfile }
            : {}),
          ...(spawnPreflight ? { preflightSpawn: spawnPreflight } : {}),
          ...(options.peerMail ? { peerMail: options.peerMail } : {}),
          ...(options.stopRule ? { stopRule: options.stopRule } : {}),
          ...(options.onProgressStop ? { onProgressStop: options.onProgressStop } : {}),
          ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
          ...(options.compaction ? { compaction: options.compaction } : {}),
          ...(options.driverRetry ? { driverRetry: options.driverRetry } : {}),
          ...(options.onDriverAttempt ? { onDriverAttempt: options.onDriverAttempt } : {}),
          ...(log
            ? {
                onEvent: (_event, record) => log.append(runId, record, ownerId),
                loadPriorCoordination: () => log.load(runId, ownerId),
              }
            : {}),
          ...(finalizer ? { finalizer } : {}),
          // A nested manager acknowledges cancels for ITS direct children from the same layout
          // dir as the root — subtree-scoped, so exact node ids route to the one manager that
          // parents them and label references stay the root's alone.
          ...(options.runDir === undefined
            ? {}
            : { controlDir: resolve(options.runDir), controlScope: 'subtree' as const }),
        })
        return driverChild(authorized, nested, journal, childExecution.ref)
      }
      return makeRecursiveWorker
    }

    makeWorkerAgent = makeRecursiveWorkerFor(
      canonicalProfile,
      rootExecution.identity,
      1,
      rootOwnerId,
    )
  }
  const workerFactory = makeWorkerAgent

  // Every configuration fault above throws SYNCHRONOUSLY — a caller that guards with
  // `expect(() => supervise(...)).toThrow` still sees the throw, and no compute starts. Only the
  // durable coordination replay needs to await, so the run begins inside this closure.
  const start = async () => {
    // The durable coordination side-log (file contexts only) loads prior questions, findings, and
    // authorized instruction receipts, then appends this process's evidence as it publishes. The
    // router arm receives all three in its resume brief; the external arm seeds prior questions and
    // leaves the other evidence in the log. No prior instruction is auto-delivered.
    const priorCoordination = log ? await log.load(runId, rootOwnerId) : undefined

    const authorizeRootMessage = authorizeDownFor(canonicalProfile, 1)
    // The ONE root control this run is aborted through: the caller's handle when it supplied one,
    // otherwise a Runtime-minted handle for the durable run-cancel path. A run with neither a
    // caller handle nor a `runDir` has no external abort party and mints nothing.
    const runControl =
      options.rootHandle ?? (options.runDir === undefined ? undefined : createRootHandle<unknown>())
    const agentDeps = {
      blobs,
      makeWorkerAgent: workerFactory,
      ...(authorizeRootMessage ? { authorizeDownMessage: authorizeRootMessage } : {}),
      perWorker,
      ...(log
        ? {
            onEvent: (_event, record) => log.append(runId, record, rootOwnerId),
          }
        : {}),
      ...(deliverable ? { deliverable } : {}),
      onProviderModel(model: string | undefined) {
        rootProviderModels.push(model)
      },
      ...(priorCoordination &&
      (priorCoordination.questions.length > 0 ||
        priorCoordination.findings.length > 0 ||
        priorCoordination.continuations.length > 0 ||
        priorCoordination.deliveryEvidence.length > 0)
        ? { priorCoordination }
        : {}),
      ...(finalizer ? { finalizer } : {}),
      ...(options.coordination ? { coordination: options.coordination } : {}),
      ...(spawnPreflight ? { preflightSpawn: spawnPreflight } : {}),
      ...(options.peerMail ? { peerMail: options.peerMail } : {}),
      ...(options.maxLiveWorkers !== undefined ? { maxLiveWorkers: options.maxLiveWorkers } : {}),
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
      ...(options.analyzeOnSettle ? { analyzeOnSettle: options.analyzeOnSettle } : {}),
      ...(options.watchWorkers ? { watchWorkers: options.watchWorkers } : {}),
      ...(options.stallAfterMs !== undefined ? { stallAfterMs: options.stallAfterMs } : {}),
      ...(options.continuityByProfile ? { continuityByProfile: options.continuityByProfile } : {}),
      ...(options.stopRule ? { stopRule: options.stopRule } : {}),
      ...(options.onProgressStop ? { onProgressStop: options.onProgressStop } : {}),
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(options.compaction ? { compaction: options.compaction } : {}),
      ...(options.driverRetry ? { driverRetry: options.driverRetry } : {}),
      ...(options.onDriverAttempt ? { onDriverAttempt: options.onDriverAttempt } : {}),
      // A durable run's layout dir doubles as the worker-cancel control surface: every
      // router-arm manager's turn loop acknowledges the `cancelWorker` requests it OWNS — the
      // root (default 'run' scope) resolves its direct children plus label/profile references,
      // each nested manager (above) its own direct-child node ids only. The root ALSO applies the
      // run-scoped request (`cancelRun`) through the run's one cascade controller.
      ...(options.runDir === undefined || runControl === undefined
        ? {}
        : {
            controlDir: resolve(options.runDir),
            abortRun: (reason: string) => runControl.abort(reason),
          }),
    } satisfies SupervisorAgentDeps
    const agent =
      testBrain === undefined
        ? supervisorAgent(canonicalProfile, agentDeps)
        : supervisorAgentWithTestBrain(canonicalProfile, { ...agentDeps, brain: testBrain })

    // Built ONLY when `otel` is configured AND an exporter resolves, so the default path allocates
    // nothing and passes no `hooks` at all — byte-for-byte the wiring every existing caller gets.
    spans = options.otel ? createSupervisorSpanRecorder({ runId, ...options.otel, now }) : undefined
    const recorder = spans
    const hooks = recorder ? composeRuntimeHooks(options.hooks, recorder.hooks) : options.hooks

    const supervisor = createSupervisor<unknown, unknown>()
    if (runControl !== undefined) supervisor.attach(runControl)
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
      ...(options.childSettleGraceMs !== undefined
        ? { childSettleGraceMs: options.childSettleGraceMs }
        : {}),
      ...(options.maxLiveWorkers !== undefined ? { maxLiveWorkers: options.maxLiveWorkers } : {}),
      ...(probes ? { probes } : {}),
      ...(ctx.resume === true ? { resume: true } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(hooks ? { hooks } : {}),
      // Only a run that actually records spans hands trace context down to its workers; with no
      // recorder this key is absent and no spawned worker's environment is touched.
      ...(recorder ? { workerTrace: recorder.workerTrace } : {}),
      // A traced run on a backend with NO propagation channel journals each severed hop
      // (`trace-unpropagated`) instead of silently producing disconnected child traces.
      ...(recorder && traceUnpropagated ? { workerTraceUnpropagated: traceUnpropagated } : {}),
    })
    const settle = async () => {
      const result = await run
      recordRunCancellationOutcome(options.runDir, result, now)
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

function rootProviderModelEvidence(
  observations: ReadonlyArray<string | undefined>,
): RootProviderModelEvidence {
  const attempts = Object.freeze(
    observations.map((model) =>
      Object.freeze({ observations: Object.freeze(model === undefined ? [] : [model]) }),
    ),
  )
  const models = [...new Set(observations.filter((model): model is string => model !== undefined))]
  if (observations.length === 0 || observations.some((model) => model === undefined)) {
    return Object.freeze({
      status: 'unknown' as const,
      attempts,
      models: Object.freeze(models),
      reason: 'provider-model-missing' as const,
    })
  }
  return Object.freeze({ status: 'known' as const, attempts, models: Object.freeze(models) })
}

function rootProviderModelEvidenceFromExecution(
  evidence: RootProviderModelEvidence | undefined,
): RootProviderModelEvidence {
  return evidence ?? rootProviderModelEvidence([])
}
