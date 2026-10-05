import { randomUUID } from 'node:crypto'
import {
  captureHarnessTranscript,
  type HarnessTranscriptCapture,
  harnessTranscriptUnavailable,
  retainHarnessTranscript,
} from './harness-transcript'
import { type ProviderPlacement, selectProviderPlacement } from './provider-placement'
import { promptOptionsFromAgentTurnInput } from './turn-input'

export type { ProviderPlacement } from './provider-placement'

import {
  type AgentCandidateWorkspaceSnapshotEvidence,
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
  type AgentProfile,
  type AgentRunCancellationAcknowledgement,
  type AgentRunCancellationRequest,
  AgentRunCancellationRequestSchema,
  type AgentRunControlRef,
  AgentTurnInputSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  canonicalWorkspaceCwd,
  type InteractionAcknowledgement,
  type InteractionResponseCommand,
  type TokenUsage,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentEnvironmentStatus,
  AgentSession,
  AgentSessionRef,
  AgentSessionStatus,
  AgentTurnInput,
  AgentTurnResult,
  CheckpointRequest,
  CreateAgentEnvironmentInput,
  ForkRequest,
  ResourceRequest,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  CreateSandboxOptions,
  PromptInputPart,
  PromptOptions,
  PromptResult,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { type AgentRunOutcome, createAgentRunOutcomeTracker } from '@tangle-network/sandbox/runtime'
import { defaultRedactor } from '../redact'
import {
  assertProviderWorkspaceRetentionPort,
  captureProviderWorkspaceSnapshot,
  DEFAULT_NATIVE_CAPTURE_INTERVAL_MS,
  type ProviderNativeCapturePhase,
  type ProviderWorkspaceCaptureProvenance,
  type ProviderWorkspaceCaptureReceipt,
  type ProviderWorkspaceCaptureTiming,
  type ProviderWorkspaceRetentionPort,
} from './provider-workspace-retention'
import { environmentGone } from './retained-interactive-lifecycle'
import {
  describeRetainedNativeStops,
  type RetainedNativeStop,
  stopRetainedNativeExecution,
} from './retained-native-stop'
import {
  assertEventBinding,
  awaitAbortable,
  exactSession,
  freezeControlRef,
  RetainedRunProviderContractError,
  sameControlCoordinates,
} from './retained-run-binding'
import {
  assertRetainedRunReplayMaterial,
  mintRetainedIdentity,
  reconnectRetainedRun,
  recoverRetainedRun,
  startRetainedRun,
} from './retained-run-start'
import type { RetainedRunHandle } from './retained-run-types'
import {
  canonicalSandboxUsageMode,
  createSandboxToolPartState,
  createSandboxUsageLedger,
  isSandboxTerminalEvent,
  sandboxProgressEvents,
  sandboxTerminalUsageField,
} from './sandbox-events'
import type { SandboxOutcomeCarrier } from './sandbox-outcome'
import { linkAbort, RunCancellationReason } from './supervise/abortable'
import { bridgeStopSignalKey } from './supervise/bridge-config'
import { priceUnreceiptedWork } from './supervise/cost-estimate'
import { isDeadlineAbortReason } from './supervise/deadline'
import { errorText } from './supervise/error-message'
import { readOptionalAbortSignal } from './supervise/executor-seams'
import {
  attestRuntimeOwnedPendingExecutor,
  finalizeRuntimeOwnedPendingExecutor,
  newExecutionAttemptId,
  runtimeOwnedExecutorMaterialization,
} from './supervise/materialization'
import {
  concreteProfileModel,
  enforceTokenLimits,
  profileModelExecutionSettings,
} from './supervise/model-policy'
import {
  RetainedExecutionPendingError,
  type RetainedExecutorContext,
  retainedExecutorContext,
} from './supervise/retained-executor'
import { detachedSnapshot } from './supervise/snapshot'
import { createPushTraceSource, decodeBoxPart, type TraceSource } from './supervise/trace-source'
import type {
  EnvironmentTeardownReceipt,
  Executor,
  ExecutorCancellation,
  ExecutorContext,
  ExecutorExecutionBinding,
  ExecutorFactory,
  ExecutorMaterialization,
  ExecutorNodeContext,
  ExecutorResult,
  HeldEnvironment,
  Runtime,
  Spend,
  UsageEvent,
} from './supervise/types'
import {
  type UnavailablePausePolicy,
  unavailablePauseMs,
  unavailableSignalOfFailure,
} from './supervise/upstream-unavailable'
import { verifyWorkspaceMarker } from './supervise/workspace-checkpoint'
import type { SandboxClient, Validator } from './types'
import { addSpend, addTokenUsage, cloneTokenUsage, sleep, zeroTokenUsage } from './util'

// Keep this file loadable from the lean `./environment-provider` export without agent-eval installed.
class ValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ValidationError'
  }
}

export type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentEnvironmentQuery,
  AgentEnvironmentStatus,
  AgentEnvironmentSummary,
  AgentProfileRef,
  AgentSession,
  AgentSessionRef,
  AgentSessionStatus,
  AgentTurnInput,
  AgentTurnResult,
  CheckpointRef,
  CheckpointRequest,
  CreateAgentEnvironmentInput,
  ExecRequest,
  ExecResult,
  ForkRequest,
  PlacementInfo,
  ResourceRequest,
  WorkspaceRequest,
} from '@tangle-network/agent-interface/environment-provider'

export type {
  ProviderNativeCapturePhase,
  ProviderWorkspaceAttemptProvenance,
  ProviderWorkspaceCaptureProvenance,
  ProviderWorkspaceCaptureReceipt,
  ProviderWorkspaceCaptureResult,
  ProviderWorkspaceEntryMetadata,
  ProviderWorkspaceRetentionContext,
  ProviderWorkspaceRetentionPort,
} from './provider-workspace-retention'

export {
  type CreateTangleSandboxExactProcessProviderOptions,
  createTangleSandboxExactProcessProvider,
} from './tangle-sandbox-exact-process-provider'

/** Provider object or registry name accepted by runtime provider adapters.
 * @experimental */
export type AgentEnvironmentProviderRef = AgentEnvironmentProvider | string

/** In-memory registry for named `AgentEnvironmentProvider` instances.
 * @experimental */
export interface AgentEnvironmentProviderRegistry {
  register(provider: AgentEnvironmentProvider, options?: { replace?: boolean }): void
  has(name: string): boolean
  get(name: string): AgentEnvironmentProvider | undefined
  require(name: string): AgentEnvironmentProvider
  names(): string[]
  providers(): AgentEnvironmentProvider[]
  capabilities(name: string): Promise<AgentEnvironmentCapabilities>
}

/** Create a registry that resolves provider names to concrete provider instances.
 * @experimental */
export function createAgentEnvironmentProviderRegistry(
  providers: Iterable<AgentEnvironmentProvider> = [],
): AgentEnvironmentProviderRegistry {
  const entries = new Map<string, AgentEnvironmentProvider>()

  const registry: AgentEnvironmentProviderRegistry = {
    register(provider, options = {}): void {
      if (!provider.name) {
        throw new ValidationError('agent environment provider registry: provider.name required')
      }
      if (!options.replace && entries.has(provider.name)) {
        throw new ValidationError(
          `agent environment provider registry: provider "${provider.name}" already registered`,
        )
      }
      entries.set(provider.name, provider)
    },
    has(name): boolean {
      return entries.has(name)
    },
    get(name): AgentEnvironmentProvider | undefined {
      return entries.get(name)
    },
    require(name): AgentEnvironmentProvider {
      const provider = entries.get(name)
      if (!provider) {
        const available = Array.from(entries.keys()).sort()
        const suffix = available.length > 0 ? `; available: ${available.join(', ')}` : ''
        throw new ValidationError(
          `agent environment provider registry: provider "${name}" is not registered${suffix}`,
        )
      }
      return provider
    },
    names(): string[] {
      return Array.from(entries.keys()).sort()
    },
    providers(): AgentEnvironmentProvider[] {
      return registry.names().map((name) => registry.require(name))
    },
    async capabilities(name): Promise<AgentEnvironmentCapabilities> {
      return registry.require(name).capabilities()
    },
  }

  for (const provider of providers) registry.register(provider)
  return registry
}

/** Resolve a provider instance or registry name, failing loudly when a name is unknown.
 * @experimental */
export function resolveAgentEnvironmentProvider(
  provider: AgentEnvironmentProviderRef,
  registry?: AgentEnvironmentProviderRegistry,
): AgentEnvironmentProvider {
  if (typeof provider !== 'string') return provider
  if (!registry) {
    throw new ValidationError(
      `agent environment provider "${provider}" requires an AgentEnvironmentProviderRegistry`,
    )
  }
  return registry.require(provider)
}

/** Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port.
 * @experimental */
export interface ProviderAsSandboxClientOptions {
  defaults?: Partial<CreateAgentEnvironmentInput>
  requireTerminalEvent?: boolean
  /** Require declared live continuation plus concrete session controls. */
  requireSession?: boolean
  /** Verified workspace capture before every environment delete, including steerable sessions. */
  workspaceRetention?: ProviderWorkspaceRetentionPort
  /** Supervised identity assigned before the environment is created. */
  retentionIdentity?: { executionId: string; profile: AgentProfile; node?: ExecutorNodeContext }
  /** Called after verification and before deletion so the run result can retain the exact join. */
  onWorkspaceCaptured?: (receipt: ProviderWorkspaceCaptureReceipt) => void | Promise<void>
  mapCreateOptions?: (
    options: CreateSandboxOptions | undefined,
  ) => Partial<CreateAgentEnvironmentInput>
}

/** Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths.
 * @experimental */
export function providerAsSandboxClient(
  provider: AgentEnvironmentProvider,
  options: ProviderAsSandboxClientOptions = {},
): SandboxClient {
  if (options.workspaceRetention !== undefined) {
    assertProviderWorkspaceRetentionPort(
      options.workspaceRetention,
      `providerAsSandboxClient(${provider.name})`,
    )
    if (options.retentionIdentity === undefined) {
      throw new ValidationError(
        'providerAsSandboxClient: retentionIdentity is required with workspaceRetention',
      )
    }
  }
  return {
    async create(createOptions?: CreateSandboxOptions): Promise<SandboxInstance> {
      const defaults = options.defaults ?? {}
      const sandboxInput = createInputFromSandboxOptions(createOptions)
      const customInput = options.mapCreateOptions?.(createOptions) ?? {}
      const mapped = {
        ...defaults,
        ...sandboxInput,
        ...customInput,
        ...(defaults.env === undefined &&
        sandboxInput.env === undefined &&
        customInput.env === undefined
          ? {}
          : {
              env: { ...defaults.env, ...sandboxInput.env, ...customInput.env },
            }),
        providerOptions: {
          ...(defaults.providerOptions ?? {}),
          ...(sandboxInput.providerOptions ?? {}),
          ...(customInput.providerOptions ?? {}),
        },
      }
      if (mapped.backend === undefined) delete mapped.backend
      if (mapped.profile === undefined) {
        throw new ValidationError(
          `providerAsSandboxClient(${provider.name}): profile required in defaults or CreateSandboxOptions.backend.profile`,
        )
      }
      if (options.requireSession) {
        const capabilities = await provider.capabilities()
        if (!capabilities.streaming.live || !capabilities.sessions.continue) {
          throw new ValidationError(
            `providerAsSandboxClient(${provider.name}): live session continuation is required`,
          )
        }
      }
      const environment = await provider.create(mapped as CreateAgentEnvironmentInput)
      if (options.requireSession && !environment.session) {
        if (options.workspaceRetention === undefined) await environment.destroy?.()
        throw new ValidationError(
          `providerAsSandboxClient(${provider.name}): session() is required`,
        )
      }
      return environmentAsSandboxInstance(environment, {
        requireTerminalEvent: options.requireTerminalEvent ?? true,
        ...(options.workspaceRetention === undefined
          ? {}
          : { workspaceRetention: options.workspaceRetention }),
        ...(options.retentionIdentity === undefined
          ? {}
          : { retentionIdentity: options.retentionIdentity }),
        ...(options.onWorkspaceCaptured === undefined
          ? {}
          : { onWorkspaceCaptured: options.onWorkspaceCaptured }),
      })
    },
  }
}

/**
 * What one provider-executed turn settles on: the visible answer plus the event archive the
 * environment streamed. It is the value a `ProviderExecutorOptions.validator` scores.
 *
 * The archive is the streamed sequence, in order, without superseded part updates. A harness
 * streams a text or reasoning part cumulatively: every `message.part.updated` frame restates the
 * part's whole text so far. When a later frame of the same part extends a frame's text, the
 * earlier frame is left out, so each such part is archived once, at its latest frame. Keeping
 * every frame retains frames times text length, and the settled archive is hashed and stored.
 * A frame that does not extend the part's text is kept, and every other event is kept verbatim.
 * Read a part's text from `part.text`; a retained frame's `delta` is only that frame's increment.
 *
 * @experimental
 */
export interface ProviderLeafOut {
  content: string
  events: AgentEnvironmentEvent[]
  /** Portable executable workspace evidence accepted before the source environment was deleted. */
  workspaceSnapshot?: AgentCandidateWorkspaceSnapshotEvidence
  /** Exact provider and supervisor identities bound to the retained bytes. */
  workspaceCapture?: ProviderWorkspaceCaptureReceipt
  /**
   * Why workspace retention produced no receipt for this settled turn. The source environment is
   * preserved as evidence and the turn's result stands.
   */
  workspaceCaptureFailure?: string
  /** How many streamed part updates the archive left out because a later frame superseded them. */
  supersededPartUpdates?: number
}

/** Only a verified, single-session capture may supply a scalar session identity. */
function capturedSessionIdentity(
  provenance: ProviderWorkspaceCaptureProvenance | undefined,
  coverageComplete: boolean,
  executionId: string,
  providerSessionId: string | null,
): { providerSessionId: string | null; nativeSessionId: string | null } {
  const unknown = { providerSessionId, nativeSessionId: null }
  if (
    !coverageComplete ||
    provenance?.status !== 'reported' ||
    provenance.executionId !== executionId ||
    provenance.sessions?.length !== 1
  )
    return unknown
  const session = provenance.sessions[0]!
  if (
    session.executionId !== executionId ||
    (providerSessionId !== null && session.id !== providerSessionId)
  )
    return unknown
  const ids = new Set(
    (provenance.attempts ?? [])
      .filter((attempt) => session.executionIds?.includes(attempt.executionId))
      .flatMap((attempt) => attempt.nativeSessionIds),
  )
  const nativeSessionId = ids.size === 1 ? [...ids][0]! : null
  if (session.nativeSessionId != null && nativeSessionId !== session.nativeSessionId)
    return { providerSessionId, nativeSessionId: null }
  return { providerSessionId, nativeSessionId }
}

/**
 * Per-run Sandbox prompt options for the provider path — the same field, the same name, and the
 * same kernel-owned exclusions as `ExecCtx.promptOptions` on the sandbox path.
 *
 * The kernel owns `sessionId` and `signal`, so neither is declarable: a caller-chosen session id
 * would make every worker share one server session, and the abort channel belongs to the run.
 * `model` is excluded too, and for a different reason: this executor's materialization record
 * names the model from `AgentProfile`, so a turn-level override would make the record state a
 * model the provider did not run. Declare the instrument on `AgentProfile.model`.
 *
 * Everything else is the per-call configuration a portable profile cannot carry. `backend` is the
 * load-bearing one: `backend.model.authMode` plus `authFiles` is how a caller-owned subscription
 * seat reaches the harness inside the environment. Runtime lowers these onto the turn with the one
 * mapper it already uses in the other direction, so a sandbox-shaped provider reads them from
 * `AgentTurnInput.providerOptions.backend` exactly as it reads a sandbox box's prompt options.
 *
 * @experimental
 */
export type ProviderPromptOptions = Omit<PromptOptions, 'model' | 'sessionId' | 'signal'>

/** Turn fields the seam's prompt options configure. The kernel owns every other coordinate. */
type ProviderTurnDefaults = Omit<
  AgentTurnInput,
  'model' | 'parts' | 'prompt' | 'sessionId' | 'signal'
>

/**
 * Lower the seam's prompt options onto turn fields, through the one mapper this module already
 * uses to raise a sandbox prompt into a provider turn. Reusing it is what keeps the two directions
 * from drifting: whatever `turnInputFromPrompt` decides a prompt option configures, the seam
 * declares the same way.
 */
function providerTurnDefaults(
  options: ProviderPromptOptions | undefined,
  context: string,
): ProviderTurnDefaults | undefined {
  if (options === undefined) return undefined
  if ((options as { model?: unknown }).model !== undefined) {
    throw new ValidationError(
      `${context}: promptOptions.model is refused — this executor's materialization names AgentProfile's model, so a turn-level override would record a model the provider did not run`,
    )
  }
  const {
    prompt: _prompt,
    parts: _parts,
    model: _model,
    sessionId: _sessionId,
    signal: _signal,
    ...turn
  } = turnInputFromPrompt('', options)
  return turn
}

/** Options for running a provider as a supervise-mode executor.
 * @experimental */
export interface ProviderExecutorOptions {
  /** Select exactly one caller-declared placement from each child's unchanged profile. */
  placements?: readonly ProviderPlacement[]
  defaults?: Partial<CreateAgentEnvironmentInput>
  runtime?: Runtime
  destroyOnSettle?: boolean
  requireTerminalEvent?: boolean
  /**
   * Per-run prompt options merged UNDER every streamed turn: a mapped turn's own field wins, and
   * the runtime's abort signal is applied last. `providerOptions` merges one level, so a
   * `taskToTurn` that sets its own provider option cannot silently drop the session credential
   * declared here.
   */
  promptOptions?: ProviderPromptOptions
  /**
   * OPT-IN executable score for this worker, with the SAME contract the sandbox seam's validator
   * has: `validate` runs while the environment is still alive, so `ValidationCtx.box` can read
   * files and run commands in the environment it is scoring. Every other supervised hook fires
   * after teardown and can only read the artifact.
   * `ValidationCtx.node` identifies the supervised node, including its recursion depth, so a
   * shared validator can apply a root-only contract without applying it to nested managers.
   *
   * The verdict becomes the settled artifact's verdict. Absent, nothing changes and the leaf falls
   * back to its own settle verdict.
   */
  validator?: Validator<ProviderLeafOut>
  /** Capture and verify a portable executable workspace before Runtime destroys the environment. */
  workspaceRetention?: ProviderWorkspaceRetentionPort
  /** Transform only the profile sent to `provider.create`. The original profile
   * remains the input to `taskToTurn`, so execution-only normalization cannot
   * rewrite the caller's task mapping. */
  profileForCreate?: (profile: AgentProfile) => AgentProfile
  /** Map the task while retaining the kernel's canonical prompt mapping by default. */
  taskToTurn?: (
    task: unknown,
    specProfile: AgentProfile,
    defaultTurn: AgentTurnInput,
  ) => AgentTurnInput
  /**
   * How a supervised leaf waits out an upstream that cannot serve now.
   *
   * When the model provider refuses a leaf's turn for capacity (a quota, a rate limit, an
   * overload, or the router's own refused credential; see `upstreamUnavailableSignal`), the leaf
   * keeps its environment, pauses, and continues in the same environment and session with a
   * short instruction to pick up where it stopped. The pause starts at `unavailablePauseMs`
   * (15 s) and doubles to `maxUnavailablePauseMs` (5 min), the same rule a driver follows. Only
   * the leaf's deadline, cancellation and budget end it. Each pause is journaled as a `paused`
   * spawn event, and each continuation as the node's next `execution-input`.
   *
   * Applies to a retained execution under a Scope, the path a supervised leaf takes on a provider
   * that declares `retainedControl`. Workspace retention verifies each invocation separately;
   * failed capture or required incomplete coverage preserves the source and stops continuation.
   * `false` ends the execution on the refused turn.
   */
  unavailablePause?: UnavailablePausePolicy | false
}

/** What a leaf is told when it continues after a refused turn. The session carries its
 *  conversation and the environment its files, so the instruction names neither the provider nor
 *  the refusal: a director told the details of a provider failure spent its children probing the
 *  infrastructure (discovery-lab AGENTS.md, measured 2026-09-11). */
export const LEAF_CONTINUATION_TASK =
  'Your previous turn was interrupted before it finished. This is the same task in the same ' +
  'session: your conversation so far and the files in your workspace are where you left them. ' +
  'Continue from where you stopped. Do not start over.'

/**
 * Merge the declared turn defaults under one mapped turn.
 *
 * `providerOptions` is merged one level rather than replaced: the defaults carry the caller's
 * session credential and a `taskToTurn` that sets an unrelated provider option would otherwise
 * remove it, and a run that silently loses its credential fails inside the environment as an
 * authorization error that names nothing.
 */
function providerTurnWithDefaults(
  defaults: ProviderTurnDefaults | undefined,
  turn: AgentTurnInput,
  signal: AbortSignal,
): AgentTurnInput {
  if (defaults === undefined) return { ...turn, signal }
  const providerOptions =
    defaults.providerOptions === undefined && turn.providerOptions === undefined
      ? undefined
      : { ...(defaults.providerOptions ?? {}), ...(turn.providerOptions ?? {}) }
  return {
    ...defaults,
    ...turn,
    ...(providerOptions === undefined ? {} : { providerOptions }),
    signal,
  }
}

/** Adapt an environment provider into an `ExecutorFactory` for `createExecutor`.
 *
 * `createExecutor({ backend: 'provider', provider })` is the composition most callers want; it
 * builds this factory and injects the seam. See `examples/provider-executor/`.
 *
 * Still `@experimental`: the entry point that consumes it, `createExecutor`, carries no stability
 * tag and is therefore experimental by default, so a stable promise here would be reachable only
 * through an experimental symbol.
 *
 * @experimental */
export function providerAsExecutor(
  provider: AgentEnvironmentProvider,
  options: ProviderExecutorOptions = {},
): ExecutorFactory<unknown> {
  const captured =
    options.placements === undefined
      ? options
      : {
          ...options,
          placements: detachedSnapshot(options.placements, 'provider placements'),
          defaults: detachedSnapshot(options.defaults, 'provider placement defaults'),
        }
  return (spec, ctx) => {
    const profile =
      captured.placements === undefined
        ? spec.profile
        : detachedSnapshot(spec.profile, 'provider placement profile')
    const selected = selectProviderPlacement(profile, captured)
    return createProviderExecutor(provider, profile, ctx, selected.options, selected.identity)
  }
}

/**
 * Run a provider under a placement Runtime chose for the whole execution, such as a shared box.
 * The identity lands in the execution's materialization plan and binding, exactly where a
 * declared {@link ProviderPlacement} lands, so a record says which placement served it.
 * @internal
 */
export function placedProviderExecutor(
  provider: AgentEnvironmentProvider,
  options: ProviderExecutorOptions,
  identity: { id: string; digest: string },
): ExecutorFactory<unknown> {
  if (options.placements !== undefined) {
    throw new ValidationError('placedProviderExecutor: placements select within one provider')
  }
  return (spec, ctx) => createProviderExecutor(provider, spec.profile, ctx, options, identity)
}

function createProviderExecutor(
  provider: AgentEnvironmentProvider,
  profile: AgentProfile,
  ctx: ExecutorContext,
  options: ProviderExecutorOptions,
  placement?: { id: string; digest: string },
): Executor<unknown> {
  if (options.workspaceRetention !== undefined) {
    assertProviderWorkspaceRetentionPort(
      options.workspaceRetention,
      `providerAsExecutor(${provider.name})`,
    )
  }
  const controller = new AbortController()
  const node =
    ctx.node === undefined ? undefined : detachedSnapshot(ctx.node, 'provider executor node')

  let environment: AgentEnvironment | undefined
  let artifact: ExecutorResult<unknown> | undefined
  let retained: RetainedRunHandle | undefined
  let pending = false
  // The child's own harness transcript, read out of the environment while it was still live.
  //
  // It is held HERE, on the executor, rather than only inside the settled result, because the
  // children whose reasoning an operator most wants are the ones that never produce a result:
  // a stream that throws lands in the `catch` below with no artifact to ride in (#1244). The
  // scope pulls this after `execute` resolves OR throws, exactly as it pulls `metered()`.
  //
  // Seeded, never left undefined, so the two absences stay apart: a child killed at admission
  // never had a box and keeps this seed, while a child whose box was created and then dropped
  // reports `capture-did-not-run`. Reporting the second as the first would file a child that
  // reasoned for twenty seconds as one that never ran — which is the #1240 population exactly.
  let harnessTranscript: HarnessTranscriptCapture =
    harnessTranscriptUnavailable('execution-never-started')
  const retention = retainedExecutorContext(ctx)
  // A manager's stop (an accepted `submit_result`, `stop`, a stop rule) ends its turn. The bridge
  // executor reads this seam at its turn boundary; a retained run asks its backend to cancel the
  // turn, so the stream ends and the harness session and the turn's usage are still read. Before,
  // a provider-placed director ran its harness on after acceptance: measured 2026-10-05, accepted
  // directors settled 13 to 29 minutes after their submissions. A run with no retained control
  // could only abort locally, which skips those reads, so it keeps running to the end of its turn.
  const managerStop = readOptionalAbortSignal(ctx, bridgeStopSignalKey, 'provider')
  const cancelRetainedOnManagerStop = (handle: RetainedRunHandle): void => {
    if (managerStop === undefined) return
    const cancel = (): void => {
      void handle
        .cancel({
          operationId: `manager-stop:${randomUUID()}`,
          reason: String(managerStop.reason ?? 'the manager stopped'),
        })
        .catch(() => undefined)
    }
    if (managerStop.aborted) cancel()
    else managerStop.addEventListener('abort', cancel, { once: true })
  }
  // The stream destroys the environment on settle by default, so a later `teardown` would issue a
  // SECOND delete against a resource that is already gone. That second call is what the provider
  // answered 409 to.
  let destroyed = false
  let workspaceEnvironmentId: string | undefined
  let workspaceSnapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined
  let workspaceProvenance: ProviderWorkspaceCaptureProvenance | undefined
  let workspaceCoverageComplete = false
  let workspaceIncompleteReason: string | undefined
  let workspacePublishedSnapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined
  let workspaceCaptureFailure: unknown
  let workspaceCapturePromise: Promise<AgentCandidateWorkspaceSnapshotEvidence> | undefined
  let workspaceCleanupPromise: Promise<TeardownAnswer> | undefined
  let retainedReleasePromise: Promise<ReadonlyArray<EnvironmentTeardownReceipt>> | undefined
  let releaseReadTried = false
  let releaseNativeTried = false
  let workspaceOutcome: AgentRunOutcome | undefined
  let workspacePreservationRequired = false
  let workspaceRunActive = false
  let providerSessionId: string | null = null
  let workspaceControlRef: AgentExactRunControlRef | undefined
  // A cancellation teardown and the release share one stop; only an unconfirmed answer is retried.
  let nativeStop: Promise<RetainedNativeStop | undefined> | undefined
  // Whether the provider confirmed this execution's harness stopped.
  let harnessStopped = false
  // Settles when `harnessTranscript` is final for the running invocation
  // (`Executor.harnessTranscriptSettled`); settled between invocations.
  let transcriptSettled: Promise<void> = Promise.resolve()
  let settleTranscript: () => void = () => {}
  // The latest invocation's combined abort signal, which keeps the reason it was aborted with.
  let runSignal: AbortSignal | undefined
  const cancelledExplicitly = (): boolean =>
    ctx.signal?.reason instanceof RunCancellationReason ||
    runSignal?.reason instanceof RunCancellationReason

  const runtime = options.runtime ?? (provider.name as Runtime)
  // The exact bytes this executor hands to `provider.create`. A `profileForCreate` overlay changes
  // them, so the declaration carries the overlaid profile and exact turn execution refuses the run
  // rather than presenting the authored profile as what the provider received.
  const createProfile = options.profileForCreate?.(profile) ?? profile
  if (
    placement &&
    canonicalAgentProfileDigest(createProfile) !== canonicalAgentProfileDigest(profile)
  ) {
    throw new ValidationError(
      'provider placement: profileForCreate cannot change the selected profile',
    )
  }
  const executionId = retention?.executionId ?? node?.nodeId ?? `provider-run-${randomUUID()}`

  let workspaceExecutionId = executionId
  const resetWorkspaceState = (
    next: AgentEnvironment,
    invocationId = workspaceExecutionId,
  ): void => {
    if (workspaceEnvironmentId === next.id && workspaceExecutionId === invocationId) return
    workspaceEnvironmentId = next.id
    workspaceExecutionId = invocationId
    workspaceSnapshot = undefined
    workspaceProvenance = undefined
    workspaceCoverageComplete = false
    workspaceIncompleteReason = undefined
    workspacePublishedSnapshot = undefined
    workspaceCaptureFailure = undefined
    workspaceCapturePromise = undefined
    workspaceCleanupPromise = undefined
    retainedReleasePromise = undefined
    workspaceOutcome = undefined
    workspacePreservationRequired = false
    destroyed = false
  }

  // One executor may be retried. A retry is a new capture generation even when a provider
  // reuses its environment id; otherwise the prior turn's archive could authorize deleting a
  // workspace whose files changed during the retry. A failed generation stays fail-closed until
  // the caller constructs a fresh executor after resolving its unreceipted source.
  const beginWorkspaceExecution = (): void => {
    if (workspaceRunActive) {
      throw new ValidationError(`providerAsExecutor(${provider.name}): executor is already running`)
    }
    if (options.workspaceRetention !== undefined) {
      if (workspacePreservationRequired) {
        throw new ValidationError(
          `providerAsExecutor(${provider.name}): a prior failed execution has no retrievable workspace receipt; source remains preserved and this executor cannot be reused`,
        )
      }
      if (environment !== undefined && !destroyed) {
        throw new ValidationError(
          `providerAsExecutor(${provider.name}): the prior workspace environment is still live; teardown must release it before this executor can be reused`,
        )
      }
    }
    if (runtimeOwnedExecutorMaterialization(executor) !== undefined) {
      throw new ValidationError(
        `providerAsExecutor(${provider.name}): this executor has already materialized; create a new executor for another run`,
      )
    }
    if (environment !== undefined && destroyed) {
      // Do not leave a confirmed-destroyed handle in the next generation. If the new create fails
      // before onEnvironment runs, a later teardown must not retry deletion of the old source.
      environment = undefined
      workspaceEnvironmentId = undefined
    }
    workspaceRunActive = true
    workspaceControlRef = undefined
    providerSessionId = null
    workspaceSnapshot = undefined
    workspaceProvenance = undefined
    workspaceCoverageComplete = false
    workspaceIncompleteReason = undefined
    workspacePublishedSnapshot = undefined
    workspaceCaptureFailure = undefined
    workspaceCapturePromise = undefined
    workspaceCleanupPromise = undefined
    retainedReleasePromise = undefined
    workspaceOutcome = undefined
    workspacePreservationRequired = false
    destroyed = false
  }

  const captureWorkspace = async (
    next: AgentEnvironment,
    outcome: AgentRunOutcome | undefined,
  ): Promise<AgentCandidateWorkspaceSnapshotEvidence | undefined> => {
    const workspaceRetention = options.workspaceRetention
    if (workspaceRetention === undefined) return undefined
    resetWorkspaceState(next)
    if (workspaceSnapshot !== undefined) return workspaceSnapshot
    if (workspaceCapturePromise === undefined) {
      workspaceOutcome = outcome
      // The workspace capture reads the session too; an interval copy must not race it.
      if (nativeTimer !== undefined) clearTimeout(nativeTimer)
      nativeTimer = undefined
      const captureContext = {
        environment: next,
        executionId: workspaceExecutionId,
        ...(workspaceControlRef === undefined ? {} : { controlRef: workspaceControlRef }),
        ...(node === undefined ? {} : { node }),
        providerSessionId,
        nativeSessionId: null,
        profile: createProfile,
        ...(outcome === undefined ? {} : { outcome }),
      }
      // Where the capture's time went, journaled on the node before its outcome is used.
      const reportTiming = retention?.onWorkspaceCapture
      let timing: ProviderWorkspaceCaptureTiming | undefined
      const capturedExecutionId = workspaceExecutionId
      workspaceCapturePromise = (nativeInFlight ?? Promise.resolve())
        .then(() =>
          captureProviderWorkspaceSnapshot(
            workspaceRetention,
            captureContext,
            'environment',
            reportTiming === undefined
              ? undefined
              : (measured) => {
                  timing = measured
                },
          ),
        )
        .finally(async () => {
          if (timing === undefined || reportTiming === undefined) return
          await reportTiming({
            executionId: capturedExecutionId,
            environmentId: next.id,
            ...timing,
          }).catch(() => undefined)
        })
        .then(({ snapshot, provenance, coverageComplete, incompleteReason }) => {
          workspaceSnapshot = snapshot
          workspaceProvenance = provenance
          workspaceCoverageComplete = coverageComplete ?? false
          workspaceIncompleteReason = incompleteReason
          try {
            harnessTranscript =
              createProfile.harness === undefined
                ? harnessTranscriptUnavailable('unknown-harness')
                : retainHarnessTranscript(
                    providerWorkspaceCaptureReceipt(
                      {
                        executionId: workspaceExecutionId,
                        profile: createProfile,
                        ...(node === undefined ? {} : { node }),
                        workspaceControlRef: () => workspaceControlRef,
                        workspaceProvenance: () => provenance,
                        workspaceCoverage: () => ({
                          complete: coverageComplete ?? false,
                          incompleteReason,
                        }),
                      },
                      next,
                      snapshot,
                      providerSessionId,
                    ),
                    createProfile.harness,
                  )
            nativeHoldsTranscript = false
          } catch (error) {
            // A native copy already stored stays the transcript; only its absence is reported.
            if (!nativeHoldsTranscript) {
              harnessTranscript = {
                status: 'unavailable',
                reason: 'retained-projection-failed',
                skipped: [
                  {
                    path: workspaceExecutionId,
                    reason: error instanceof Error ? error.message : String(error),
                  },
                ],
              }
            }
          }
          if (workspaceRetention.requireCompleteProvenance && !coverageComplete) {
            workspacePreservationRequired = true
          }
          return snapshot
        })
        .catch((error: unknown) => {
          workspaceCaptureFailure = error
          throw error
        })
    }
    return await workspaceCapturePromise
  }

  const workspaceFailureDetail = (): string => {
    const reason =
      workspaceCaptureFailure instanceof Error
        ? workspaceCaptureFailure.message
        : String(workspaceCaptureFailure ?? 'capture was not accepted')
    return `providerAsExecutor(${provider.name}): workspace retention failed — ${reason}; source environment preserved`
  }

  // THE NATIVE SESSION, DURABLE AS IT HAPPENS. A turn's workspace capture runs once, when the
  // turn settles or fails; a deadline, cancel or cascade closes the stream with `return()`,
  // which reaches neither, and a workspace over its byte bound fails the whole capture. On
  // Runtime 0.297.x that left 85 of 116 Discovery nodes that ran with no session at all. With a
  // port that offers `captureNative`, the harness's own session is copied to durable artifacts on
  // an interval while the turn runs and once more however the turn ends, so its transcript is
  // the latest stored copy rather than whatever the end of the turn managed to read.
  const nativePort =
    options.workspaceRetention?.captureNative === undefined ? undefined : options.workspaceRetention
  let nativeInFlight: Promise<void> | undefined
  let nativeTimer: ReturnType<typeof setTimeout> | undefined
  // Whether `harnessTranscript` currently holds a native copy. A settled workspace capture is the
  // fuller record and replaces it; a native copy never replaces a settled workspace capture.
  let nativeHoldsTranscript = false
  const stopNativeMirror = async (): Promise<void> => {
    if (nativeTimer !== undefined) clearTimeout(nativeTimer)
    nativeTimer = undefined
    await nativeInFlight
  }
  const captureNative = (
    next: AgentEnvironment,
    phase: ProviderNativeCapturePhase,
    admitted?: AgentExactRunControlRef,
    /** The harness was stopped: copy again, briefly, until the provider records how it ended. */
    afterStop = false,
  ): Promise<void> => {
    if (nativePort === undefined || createProfile.harness === undefined) return Promise.resolve()
    const harness = createProfile.harness
    const run = (nativeInFlight ?? Promise.resolve()).then(async () => {
      // Without an admitted reference or a session id the provider attributes the copy by this
      // execution's id, which it records as the stream starts; a one-shot turn has neither.
      const controlRef = workspaceControlRef ?? admitted
      const sessionId = providerSessionId ?? admitted?.sessionId ?? null
      // A settled workspace capture of this execution already holds the session.
      if (workspaceSnapshot !== undefined && !nativeHoldsTranscript) return
      const invocationId = workspaceExecutionId
      try {
        const takeCopy = () =>
          captureProviderWorkspaceSnapshot(
            nativePort,
            {
              environment: next,
              executionId: invocationId,
              ...(controlRef === undefined ? {} : { controlRef }),
              ...(node === undefined ? {} : { node }),
              providerSessionId: sessionId,
              nativeSessionId: null,
              profile: createProfile,
              phase,
            },
            'native',
          )
        let captured = await takeCopy()
        // A provider confirms a stop as soon as the process is gone and records how the execution
        // ended a moment later; until then its copy reports the session live. On the 2026-10-04
        // trace re-proof the copy 0.3 s after a deadline stop was `native_snapshot_live` with the
        // attempt outcome `unknown`, and a capture 1 s later was complete.
        const settleBy = Date.now() + NATIVE_SETTLE_WINDOW_MS
        while (
          afterStop &&
          captured.coverageComplete !== true &&
          (captured.provenance.attempts ?? []).some((attempt) => attempt.outcome === 'unknown') &&
          Date.now() < settleBy
        ) {
          await sleep(NATIVE_SETTLE_POLL_MS)
          captured = await takeCopy()
        }
        if (workspaceSnapshot !== undefined && !nativeHoldsTranscript) return
        const copy = retainHarnessTranscript(
          providerWorkspaceCaptureReceipt(
            {
              executionId: invocationId,
              profile: createProfile,
              ...(node === undefined ? {} : { node }),
              workspaceControlRef: () => controlRef,
              workspaceProvenance: () => captured.provenance,
              workspaceCoverage: () => ({
                complete: captured.coverageComplete ?? false,
                incompleteReason: captured.incompleteReason,
              }),
            },
            next,
            captured.snapshot,
            sessionId,
          ),
          harness,
        )
        // A copy that found no session file, taken before the provider attributed the session or
        // after the box stopped answering, never replaces one that holds the session.
        if (nativeHoldsTranscript && !(copy.status === 'retained' && copy.fileCount > 0)) return
        harnessTranscript = copy
        nativeHoldsTranscript = true
      } catch {
        // A failed copy keeps the previous one. The final copy at the end of the turn, or the
        // settled workspace capture, is the next chance; the transcript names what was kept.
      }
    })
    const tracked = run.finally(() => {
      if (nativeInFlight === tracked) nativeInFlight = undefined
    })
    nativeInFlight = tracked
    return tracked
  }
  const startNativeMirror = (next: AgentEnvironment): void => {
    if (nativePort === undefined) return
    if (nativeTimer !== undefined) clearTimeout(nativeTimer)
    const interval = nativePort.nativeIntervalMs ?? DEFAULT_NATIVE_CAPTURE_INTERVAL_MS
    const schedule = (): void => {
      nativeTimer = setTimeout(() => {
        // A copy still running when the next falls due is not doubled; the schedule continues.
        if (nativeInFlight === undefined) void captureNative(next, 'running')
        schedule()
      }, interval)
      nativeTimer.unref?.()
    }
    schedule()
  }
  // Every way a turn ends: stop the interval, then copy once more unless a settled workspace
  // capture of this execution already holds the session.
  const finishNativeMirror = async (
    next: AgentEnvironment,
    phase: ProviderNativeCapturePhase,
  ): Promise<void> => {
    await stopNativeMirror()
    if (workspaceSnapshot !== undefined && !nativeHoldsTranscript) return
    await captureNative(next, phase, undefined, harnessStopped)
  }

  const destroyEnvironment = async (cleanupSignal?: AbortSignal): Promise<TeardownAnswer> => {
    if (workspaceCleanupPromise !== undefined) return await workspaceCleanupPromise
    const cleanupPromise = (async () => {
      const target = environment
      if (target === undefined) return { destroyed: true }
      if (workspacePreservationRequired) {
        return {
          destroyed: false,
          detail:
            workspaceIncompleteReason ??
            'provider workspace retention: source preserved because execution failed before a retrievable settled workspace receipt existed',
          permanent: true,
        }
      }
      if (options.workspaceRetention !== undefined) {
        try {
          const currentSnapshot = await captureWorkspace(target, workspaceOutcome)
          if (
            workspacePublishedSnapshot !== undefined &&
            currentSnapshot !== undefined &&
            currentSnapshot.digest !== workspacePublishedSnapshot.digest
          ) {
            workspacePreservationRequired = true
            return {
              destroyed: false,
              detail:
                'provider workspace retention: live workspace changed after the published receipt; source preserved',
              permanent: true,
            }
          }
        } catch {
          return { destroyed: false, detail: workspaceFailureDetail(), permanent: true }
        }
      }
      if (destroyed) return { destroyed: true }
      try {
        await awaitAbortable(Promise.resolve(target.destroy?.()), cleanupSignal)
        destroyed = true
        return { destroyed: true }
      } catch (error) {
        // An earlier delete may have run on the server with its answer lost; every later delete
        // then fails not-found, so the provider's own lookup is what confirms the environment gone.
        if (await environmentGone(provider, target.id, cleanupSignal)) {
          destroyed = true
          return { destroyed: true }
        }
        return {
          destroyed: false,
          detail: `providerAsExecutor(${provider.name}): environment.destroy() failed — ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    })()
    let cleanupReference!: Promise<TeardownAnswer>
    cleanupReference = cleanupPromise.then((result) => {
      // A provider destroy can fail transiently after a verified capture. Keep the snapshot
      // single-flight, but allow a later caller to retry the release. Capture failures and
      // unsettled execution failures stay cached so retries cannot bypass preservation.
      if (
        !result.destroyed &&
        workspaceCleanupPromise === cleanupReference &&
        !workspacePreservationRequired &&
        workspaceCaptureFailure === undefined
      ) {
        // The live workspace may have changed while the provider rejected the delete. A retry
        // must capture the current bytes instead of reusing the prior receipt as authority.
        if (options.workspaceRetention !== undefined) {
          workspaceSnapshot = undefined
          workspaceCapturePromise = undefined
        }
        workspaceCleanupPromise = undefined
      }
      return result
    })
    workspaceCleanupPromise = cleanupReference
    return await cleanupReference
  }
  /**
   * Stop the native harness of this executor's retained execution. Local observation ending does
   * not stop a retained execution, so an environment kept after it keeps its harness spending
   * unless the provider is asked to stop it. Undefined when nothing was dispatched.
   */
  const stopNativeExecution = (): Promise<RetainedNativeStop | undefined> => {
    if (nativeStop !== undefined) return nativeStop
    const controlRef = retained?.controlRef ?? admittedControlRef(retention)
    if (controlRef === undefined) return Promise.resolve(undefined)
    const stopping = stopRetainedNativeExecution({
      provider,
      controlRef,
      ...(retained === undefined ? {} : { handle: retained }),
      signal: AbortSignal.timeout(NATIVE_STOP_TIMEOUT_MS),
    }).then((stop) => {
      if (stop.effect === 'cancelled' || stop.effect === 'not_live') harnessStopped = true
      else if (nativeStop === stopping) nativeStop = undefined
      return stop
    })
    nativeStop = stopping
    return stopping
  }
  /**
   * A turn that its deadline or an explicit cancellation ended stops its harness, and waits within
   * the stop's bound for the provider to report it stopped, before the turn's final native copy.
   * Nothing else stops a retained execution before teardown, so that copy read a session the
   * harness was still writing and was stored partial (2026-10-04 trace proof:
   * `native_snapshot_live`, `events_not_settled`), and the harness spent past its deadline.
   */
  const stopEndedHarness = async (signal: AbortSignal): Promise<void> => {
    if (!isDeadlineAbortReason(signal.reason) && !cancelledExplicitly()) return
    await stopNativeExecution()
  }
  /**
   * A release that keeps an environment keeps its files, never its running harness. The root has
   * settled and no process will reconcile this execution, so its native process stops before the
   * release records what it kept.
   */
  const withoutRunningHarness =
    (release: (signal: AbortSignal) => Promise<ReadonlyArray<EnvironmentTeardownReceipt>>) =>
    async (signal: AbortSignal): Promise<ReadonlyArray<EnvironmentTeardownReceipt>> => {
      const receipts = await release(signal)
      if (receipts.every((receipt) => receipt.destroyed)) return receipts
      const stop = await awaitAbortable(stopNativeExecution(), signal).catch(
        (error: unknown): RetainedNativeStop | undefined => {
          const controlRef = retained?.controlRef ?? admittedControlRef(retention)
          return controlRef === undefined
            ? undefined
            : {
                executionId: controlRef.executionId,
                effect: 'unknown',
                at: new Date().toISOString(),
                error: errorText(error instanceof Error ? error.message : error),
              }
        },
      )
      if (stop === undefined) return receipts
      const stopped = describeRetainedNativeStops([stop])
      return receipts.map((receipt) =>
        receipt.destroyed
          ? receipt
          : { ...receipt, detail: receipt.detail ? `${receipt.detail}; ${stopped}` : stopped },
      )
    }
  const attemptId = node?.attemptId ?? newExecutionAttemptId(executionId)
  const trace = createPushTraceSource({ runId: executionId })
  const providerModel = concreteProfileModel(createProfile)
  // The provider owns the model call inside its environment and the create input carries no
  // completion cap, so a requested ceiling is refused before the environment is paid for.
  const tokenLimits = enforceTokenLimits(
    profileModelExecutionSettings(createProfile, `providerAsExecutor(${provider.name})`, 'provider')
      .tokenLimits,
    'provider',
    `providerAsExecutor(${provider.name})`,
  )
  // The environment identity is server-issued, so before `create` resolves this declaration is a
  // planned authority check, never a receipt.
  const plannedDeclaration: ExecutorMaterialization = {
    effectiveProfile: createProfile,
    backend: provider.name,
    model: providerModel
      ? { status: 'known', id: providerModel }
      : { status: 'unknown', reason: 'provider environment selected its default model' },
    execution: { kind: 'environment', id: executionId },
    materializer: 'environment-provider-create',
    plan: {
      kind: 'agent-environment',
      provider: provider.name,
      destroyOnSettle: retention?.preserveEnvironment ? false : (options.destroyOnSettle ?? true),
      requireTerminalEvent: options.requireTerminalEvent ?? true,
      tokenLimits,
      ...(placement ? { placement } : {}),
    },
  }
  const plannedBinding: ExecutorExecutionBinding = {
    attemptId,
    binding: {
      provider: provider.name,
      executionId,
      model: providerModel ?? null,
      ...(placement ? { placement } : {}),
    },
    descriptor: {
      kind: 'agent-environment',
      transport: 'provider',
      backend: provider.name,
      ...(placement ? { placementId: placement.id, placementDigest: placement.digest } : {}),
    },
  }

  let executor!: Executor<unknown>
  const run = async function* (
    task: unknown,
    signal: AbortSignal,
    recovering = false,
  ): AsyncIterable<UsageEvent> {
    beginWorkspaceExecution()
    const linked = linkAbort(ctx.signal, signal, controller.signal)
    runSignal = linked.signal
    harnessStopped = false
    transcriptSettled = new Promise<void>((resolve) => {
      settleTranscript = resolve
    })
    try {
      // One execution is one or more invocations: the first runs `task`; a later one continues it
      // in the same environment after the upstream refused a turn for capacity.
      const executionStartedAt = Date.now() - (retention?.priorSpent?.ms ?? 0)
      let invocation: {
        task: unknown
        retention: RetainedExecutorContext | undefined
        executionId: string
        recovering: boolean
      } = { task, retention, executionId, recovering }
      let carried: Spend | undefined = retention?.priorSpent
      let refusalsInARow = 0
      for (let attempt = 1; ; attempt += 1) {
        const continued = attempt > 1
        if (continued && environment !== undefined) {
          // A resumed turn can change this same workspace. Its predecessor's receipt cannot
          // authorize cleanup, including when dispatch fails before returning a new handle.
          resetWorkspaceState(environment, invocation.executionId)
          workspaceControlRef = undefined
          providerSessionId = null
          workspacePreservationRequired = options.workspaceRetention !== undefined
        }
        const ended = yield* streamProviderExecutor({
          provider,
          profile,
          createProfile,
          task: invocation.task,
          signal: linked.signal,
          ...(node === undefined ? {} : { node }),
          options,
          retention: invocation.retention,
          executionId: invocation.executionId,
          trace,
          recovering: invocation.recovering,
          ...(carried === undefined ? {} : { carried }),
          executionStartedAt,
          mayContinue:
            options.unavailablePause !== false &&
            invocation.retention?.continueInvocation !== undefined,
          managerStopped: () => managerStop?.aborted === true,
          onRetained: (handle) => {
            retained = handle
            workspaceControlRef = freezeControlRef(handle.controlRef)
            providerSessionId = workspaceControlRef.sessionId
            cancelRetainedOnManagerStop(handle)
          },
          onPending: (value) => {
            pending = value
          },
          onEnvironment: (env) => {
            if (continued) {
              // A continuation runs in the environment the execution already materialized in; a
              // different one would be a different execution, which the receipt cannot name.
              if (env.id !== environment?.id) {
                throw new ValidationError(
                  `providerAsExecutor(${provider.name}): a continuation ran in environment ${env.id}, not ${environment?.id ?? '<none>'}`,
                )
              }
              environment = env
              return
            }
            environment = env
            resetWorkspaceState(env)
            // A box now exists, so `execution-never-started` has stopped being true. Until the
            // capture reports, the honest answer is that nobody read it.
            if (
              harnessTranscript.status === 'unavailable' &&
              harnessTranscript.reason === 'execution-never-started'
            ) {
              harnessTranscript = harnessTranscriptUnavailable('capture-did-not-run')
            }
            // `create` resolved, so the environment identity the provider issued is now evidence. It
            // goes in `execution`, which the mid-run guard treats as per-attempt routing, and NOT in
            // `plan`, which the guard holds fixed across attempts. It used to be written to both, so a
            // re-prompted attempt in a new environment changed `materializationPlanDigest` and was
            // refused as a changed materialization even after #1230 excused `execution.id`. Measured
            // on mech-interp-foundations-pi-20260915i under 0.225.5, which was the first guard able to
            // name the field. The admission events already record which environment served each
            // attempt; nothing reads the id from the plan.
            finalizeRuntimeOwnedPendingExecutor(
              executor,
              {
                ...plannedDeclaration,
                execution: { kind: 'environment', id: env.id },
              },
              plannedBinding,
            )
          },
          onArtifact: (next) => {
            artifact = next
          },
          onProviderSessionId: (id) => {
            providerSessionId = id
          },
          onHarnessTranscript: (next) => {
            harnessTranscript = next
          },
          onTranscriptSettled: () => settleTranscript(),
          onUnsettledFailure: () => {
            workspacePreservationRequired = true
          },
          onPublishedSnapshot: (snapshot) => {
            workspacePublishedSnapshot = snapshot
            if (
              continued &&
              snapshot !== undefined &&
              (!options.workspaceRetention?.requireCompleteProvenance || workspaceCoverageComplete)
            ) {
              workspacePreservationRequired = false
            }
          },
          captureWorkspace,
          startNativeMirror,
          stopEndedHarness,
          finishNativeMirror,
          workspaceControlRef: () => workspaceControlRef,
          workspaceProvenance: () => workspaceProvenance,
          workspaceCoverage: () => ({
            complete: workspaceCoverageComplete,
            incompleteReason: workspaceIncompleteReason,
          }),
          destroyEnvironment,
        })
        const refusal = ended.unavailable
        const continueInvocation = invocation.retention?.continueInvocation
        if (
          refusal === undefined ||
          continueInvocation === undefined ||
          workspacePreservationRequired ||
          workspaceCaptureFailure !== undefined
        )
          return
        // The same pause rule a driver follows: doubling per refusal in a row, restarting after a
        // refused turn that still did work. Only the deadline, cancellation and budget end it.
        refusalsInARow = ended.madeProgress ? 1 : refusalsInARow + 1
        const pauseMs = unavailablePauseMs(refusalsInARow, options.unavailablePause || {})
        await invocation.retention?.onPause?.({
          attempt,
          signal: refusal.signal,
          cause: refusal.cause,
          attemptMs: ended.durationMs,
          pauseMs,
          madeProgress: ended.madeProgress,
        })
        await sleep(pauseMs, linked.signal)
        // Cancelled or past its deadline during the pause: the refused turn's committed result is
        // the execution's outcome, and the kept environment is released by teardown.
        linked.signal.throwIfAborted()
        const next = await continueInvocation(LEAF_CONTINUATION_TASK)
        if (next.executionId === undefined) {
          throw new ValidationError(
            `providerAsExecutor(${provider.name}): a continuation has no execution id of its own`,
          )
        }
        carried = ended.spent
        invocation = {
          task: LEAF_CONTINUATION_TASK,
          retention: next,
          executionId: next.executionId,
          recovering: false,
        }
      }
    } finally {
      linked.release()
      workspaceRunActive = false
      settleTranscript()
    }
  }
  executor = {
    runtime,
    execute: run,
    recover: (task, signal) => run(task, signal, true),
    async cancel(request): Promise<ExecutorCancellation> {
      if (retained) {
        const acknowledgement = await retained.cancel(request)
        return {
          status:
            acknowledgement.status === 'conflict'
              ? 'rejected'
              : acknowledgement.status === 'replayed'
                ? 'accepted'
                : acknowledgement.status,
          effect: acknowledgement.effect,
          observedAt: acknowledgement.snapshot.observedAt,
          evidence: { operationId: request.operationId, controlRef: retained.controlRef },
          ...(acknowledgement.reason ? { detail: acknowledgement.reason } : {}),
        }
      }
      // The provider streams a turn rather than dispatching a durable run, so this executor holds
      // no exact control reference the provider could cancel against. Aborting the local stream is
      // all Runtime can prove; the environment stays alive for `teardown` to release.
      controller.abort()
      return {
        status: 'unknown',
        effect: 'cancel_requested',
        observedAt: new Date().toISOString(),
        detail: `providerAsExecutor(${provider.name}): the streamed turn carries no durable run reference, so the provider acknowledged nothing`,
        evidence: {
          operationId: request.operationId,
          ...(environment ? { environmentId: environment.id } : {}),
        },
      }
    },
    async teardown(_grace): Promise<TeardownAnswer> {
      controller.abort()
      // A cancelled execution is not kept for a resume to reconcile, so its harness stops now
      // rather than at root release. Not awaited: teardown acknowledges within a short window,
      // and the release awaits this same stop before it records what it kept.
      if (pending && cancelledExplicitly()) void stopNativeExecution()
      if (options.workspaceRetention !== undefined && workspaceRunActive) {
        return {
          destroyed: false,
          detail: harnessStopped
            ? 'provider workspace retention: source preserved while the stopped execution writes its failure capture'
            : 'provider workspace retention: source preserved while the execution is still active',
        }
      }
      if (pending) {
        return {
          destroyed: false,
          detail: 'retained execution requires reconciliation',
          permanent: true,
        }
      }
      // A failed or timed-out capture keeps the source alive. The shared cleanup promise also
      // means a stream-finally teardown and a caller teardown cannot race two provider deletes.
      return await destroyEnvironment()
    },
    heldEnvironments(): ReadonlyArray<HeldEnvironment> {
      if (destroyed) return []
      // The live handle first; a retained execution whose handle this process never received is
      // still named by its durable admission, which is the id a sweeper deletes.
      const environmentId =
        environment?.id ?? retained?.controlRef.environmentId ?? admittedEnvironmentId(retention)
      if (environmentId === undefined) return []
      // A source that workspace retention preserved is evidence, kept on purpose.
      const preserved = workspacePreservationRequired || workspaceCaptureFailure !== undefined
      return [
        {
          provider: provider.name,
          environmentId,
          ...(preserved ? { keptFor: 'evidence' as const } : {}),
        },
      ]
    },
    releaseRetained: withoutRunningHarness(async (signal) => {
      controller.abort()
      // `teardown` keeps a pending retained execution alive so a resumed process can reconcile the
      // paid work inside it. The supervisor calls this once no process will: the root has settled.
      if (!pending) return []
      const environmentId =
        retained?.controlRef.environmentId ?? environment?.id ?? admittedEnvironmentId(retention)
      // An intent-phase admission names no environment yet; if `create` never returned there is
      // nothing this process can name, and the node stays unconfirmed rather than receipted.
      if (environmentId === undefined) return []
      const receipt = (
        destroyed: boolean,
        detail?: string,
        permanent?: boolean,
      ): EnvironmentTeardownReceipt => ({
        provider: provider.name,
        environmentId,
        destroyed,
        ...(detail === undefined ? {} : { detail }),
        ...(permanent === true ? { permanent } : {}),
      })
      if (options.workspaceRetention !== undefined && workspaceRunActive) {
        return [
          receipt(
            false,
            'provider workspace retention: source preserved while execution is still active',
          ),
        ]
      }
      if (retainedReleasePromise !== undefined) return await retainedReleasePromise
      const releasePromise = (async () => {
        try {
          const target =
            environment ??
            (provider.get === undefined
              ? undefined
              : await awaitAbortable(provider.get(environmentId), signal))
          if (target === undefined) {
            return [
              receipt(
                false,
                `providerAsExecutor(${provider.name}): no environment handle and the provider exposes no get()`,
                true,
              ),
            ]
          }
          // `null` is the provider saying it no longer holds the environment: nothing remains to
          // destroy, which is the same answer `recoverRetainedRun` reads as `not_found`.
          if (target === null) {
            pending = false
            destroyed = true
            return [receipt(true)]
          }
          if (target.destroy === undefined) {
            return [
              receipt(
                false,
                `providerAsExecutor(${provider.name}): environment exposes no destroy()`,
                true,
              ),
            ]
          }
          if (environment === undefined) {
            environment = target
            resetWorkspaceState(target)
          }
          // The failure path read this child's session while its box was out of reach: of the 150
          // dispatched children whose slot never closed on the Discovery fleet of 2026-09-23/24,
          // 105 carry `enumeration-failed`. The release is the last moment the box exists, so a
          // box it can reach is read once more before it is destroyed. Only a capture replaces
          // the earlier receipt; a second failure keeps the reason the first one named. One try
          // per executor: the read shares the release's bound, and a retry of a refused destroy
          // must not wait on a box that already failed to answer.
          if (
            options.workspaceRetention === undefined &&
            harnessTranscript.status !== 'captured' &&
            !releaseReadTried
          ) {
            releaseReadTried = true
            const capture = await captureHarnessTranscript(
              target as Parameters<typeof captureHarnessTranscript>[0],
              profile.harness,
              signal,
            )
            if (capture.status === 'captured') harnessTranscript = capture
          }
          // A retained execution this process never streamed, such as one a resumed coordinator
          // reconciles, has no stored copy of its session; its workspace capture below can still
          // fail on size. Copy the session first, attributed by its durable admission.
          if (
            nativePort !== undefined &&
            harnessTranscript.status !== 'retained' &&
            !releaseNativeTried
          ) {
            releaseNativeTried = true
            const admitted = retained?.controlRef ?? admittedControlRef(retention)
            await awaitAbortable(
              captureNative(
                target,
                'interrupted',
                admitted === undefined ? undefined : freezeControlRef(admitted),
              ),
              signal,
            ).catch(() => undefined)
          }
          const result = await destroyEnvironment(signal)
          if (!result.destroyed) return [receipt(false, result.detail, result.permanent)]
          pending = false
          return [receipt(true)]
        } catch (error) {
          return [
            receipt(
              false,
              `providerAsExecutor(${provider.name}): environment.destroy() failed — ${error instanceof Error ? error.message : String(error)}`,
            ),
          ]
        }
      })()
      let releaseReference!: Promise<ReadonlyArray<EnvironmentTeardownReceipt>>
      releaseReference = releasePromise.then((receipts) => {
        if (
          retainedReleasePromise === releaseReference &&
          !receipts.every((receipt) => receipt.destroyed) &&
          !workspacePreservationRequired &&
          workspaceCaptureFailure === undefined
        ) {
          retainedReleasePromise = undefined
        }
        return receipts
      })
      retainedReleasePromise = releaseReference
      return await releaseReference
    }),
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) {
        throw new ValidationError(
          `providerAsExecutor(${provider.name}): resultArtifact() read before stream drained`,
        )
      }
      return artifact
    },
    traceSource: (): TraceSource => trace.source,
    harnessTranscript: (): HarnessTranscriptCapture | undefined => harnessTranscript,
    harnessTranscriptSettled: (): Promise<void> => transcriptSettled,
  }
  return attestRuntimeOwnedPendingExecutor(executor, runtime, plannedDeclaration, plannedBinding)
}

/** One teardown answer; `permanent` marks one that asking again cannot change (see
 *  `Executor.teardown`). */
type TeardownAnswer = { destroyed: boolean; detail?: string; permanent?: boolean }

/** The exact run the latest durable dispatch names, when dispatch got that far. */
function admittedControlRef(
  retention: RetainedExecutorContext | undefined,
): AgentExactRunControlRef | undefined {
  for (const admission of [...(retention?.admissions ?? [])].reverse()) {
    if (admission.phase === 'dispatched') return admission.controlRef
  }
  return undefined
}

/** Bounds one provider stop: a reconnect, the exact cancellation and its status read. */
const NATIVE_STOP_TIMEOUT_MS = 30_000
/** How long the final copy of a stopped harness waits for the provider to record how it ended. */
const NATIVE_SETTLE_WINDOW_MS = 15_000
const NATIVE_SETTLE_POLL_MS = 1_000

/** The environment id the latest durable admission names, when creation got that far. */
function admittedEnvironmentId(retention: RetainedExecutorContext | undefined): string | undefined {
  for (const admission of [...(retention?.admissions ?? [])].reverse()) {
    if (admission.phase === 'dispatched') return admission.controlRef.environmentId
    if (admission.phase === 'environment') return admission.environmentId
  }
  return undefined
}

interface StreamProviderExecutorArgs {
  provider: AgentEnvironmentProvider
  profile: AgentProfile
  /** The exact profile handed to `provider.create` — the authored profile unless the caller
   *  installed a `profileForCreate` overlay. */
  createProfile: AgentProfile
  task: unknown
  signal: AbortSignal
  node?: ExecutorNodeContext
  options: ProviderExecutorOptions
  retention?: RetainedExecutorContext
  executionId: string
  trace: ReturnType<typeof createPushTraceSource>
  recovering: boolean
  /** The spend of this execution's earlier invocations. This invocation's cumulative token
   *  events and its settled spend continue from it, because the conserved pool reads one
   *  execution's totals and refuses a cumulative total that decreases. Absent for a first
   *  invocation. */
  carried?: Spend
  /** When the execution's first invocation started: a continued execution settles its whole
   *  duration, pauses included. */
  executionStartedAt: number
  /** Whether a refusal for capacity may end this invocation with its environment kept, for the
   *  caller to continue (`ProviderExecutorOptions.unavailablePause`). Only a retained source
   *  continues, because only it journals each invocation. */
  mayContinue: boolean
  /** Whether the manager this turn serves has stopped: an accepted result, `stop`, a stop rule. */
  managerStopped: () => boolean
  onRetained: (handle: RetainedRunHandle) => void
  onPending: (pending: boolean) => void
  onEnvironment: (environment: AgentEnvironment) => void
  onArtifact: (artifact: ExecutorResult<unknown>) => void
  onProviderSessionId: (id: string | null) => void
  onUnsettledFailure: () => void
  onPublishedSnapshot: (snapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined) => void
  captureWorkspace: (
    environment: AgentEnvironment,
    outcome: AgentRunOutcome | undefined,
  ) => Promise<AgentCandidateWorkspaceSnapshotEvidence | undefined>
  /** Start copying the harness session to durable artifacts on an interval. */
  startNativeMirror: (environment: AgentEnvironment) => void
  /** Stop the harness of a turn its deadline or a cancellation ended, before its final copy.
   *  Bounded; never throws. */
  stopEndedHarness: (signal: AbortSignal) => Promise<void>
  /** Stop the interval and copy once more, on every way the turn ends. Never throws. */
  finishNativeMirror: (
    environment: AgentEnvironment,
    phase: ProviderNativeCapturePhase,
  ) => Promise<void>
  workspaceControlRef: () => AgentExactRunControlRef | undefined
  workspaceProvenance: () => ProviderWorkspaceCaptureProvenance | undefined
  workspaceCoverage: () => { complete: boolean; incompleteReason?: string }
  destroyEnvironment: (signal?: AbortSignal) => Promise<TeardownAnswer>
  /** The harness transcript read out of the live environment, reported on the settled path AND
   *  on the drop path. One channel for both, so a reader never has to know which path ran. */
  onHarnessTranscript: (capture: HarnessTranscriptCapture) => void
  /** The transcript is final for this turn: an aborted turn's harness stopped and its session's
   *  final copy is taken. */
  onTranscriptSettled: () => void
}

function providerWorkspaceCaptureReceipt(
  args: Pick<
    StreamProviderExecutorArgs,
    | 'executionId'
    | 'profile'
    | 'node'
    | 'workspaceProvenance'
    | 'workspaceCoverage'
    | 'workspaceControlRef'
  >,
  environment: AgentEnvironment,
  snapshot: AgentCandidateWorkspaceSnapshotEvidence,
  fallbackSessionId: string | null,
): ProviderWorkspaceCaptureReceipt {
  const provenance = args.workspaceProvenance()
  const coverage = args.workspaceCoverage()
  const controlRef = args.workspaceControlRef()
  return {
    executionId: args.executionId,
    ...(controlRef === undefined ? {} : { controlRef }),
    ...(args.node === undefined ? {} : { node: args.node }),
    environmentId: environment.id,
    profileDigest: canonicalAgentProfileDigest(args.profile),
    ...capturedSessionIdentity(
      provenance,
      coverage.complete,
      args.executionId,
      controlRef?.sessionId ?? fallbackSessionId,
    ),
    snapshot,
    provenance: provenance ?? {
      status: 'unavailable',
      missing: ['Capture coverage metadata was not retained'],
    },
    coverageComplete: coverage.complete,
    ...(coverage.incompleteReason === undefined
      ? {}
      : { incompleteReason: coverage.incompleteReason }),
  }
}

/** How one invocation ended, for the executor that may continue it. */
interface ProviderInvocationEnd {
  /** The upstream refused the turn for capacity, and the environment was kept to continue in. */
  readonly unavailable?: { readonly signal: string; readonly cause: string }
  /** The execution's spend so far, this invocation included. */
  readonly spent?: Spend
  /** Whether this invocation itself spent anything before it ended. */
  readonly madeProgress: boolean
  readonly durationMs: number
}

async function* streamProviderExecutor(
  args: StreamProviderExecutorArgs,
): AsyncGenerator<UsageEvent, ProviderInvocationEnd, undefined> {
  const started = Date.now()
  const linked = args.signal
  // READINESS IS THE PROVIDER'S CONTRACT. `create` resolves with an environment that can take a
  // turn, so this streams straight into it and adds no wait of its own. The sandbox seam's
  // `acquireSandbox` exists because a raw `SandboxClient.create` returns before the box is ready;
  // wrapping a second readiness poll around a provider that already honors the contract would hide
  // a provider that does not, and a provider that does not is an upstream defect to report.
  const defaultTurn = taskToTurnInput(args.task, linked)
  let turn = providerTurnWithDefaults(
    providerTurnDefaults(args.options.promptOptions, `providerAsExecutor(${args.provider.name})`),
    args.options.taskToTurn?.(args.task, args.profile, defaultTurn) ?? defaultTurn,
    linked,
  )
  if (args.options.defaults?.metadata?.runtimeProviderPlacement !== undefined) {
    if (turn.model !== undefined && turn.model !== concreteProfileModel(args.profile)) {
      throw new ValidationError('provider placement: taskToTurn cannot replace the profile model')
    }
    const declared = providerTurnDefaults(args.options.promptOptions, 'provider placement')
    if (
      canonicalCandidateDigest(turn.providerOptions ?? {}) !==
      canonicalCandidateDigest(declared?.providerOptions ?? {})
    ) {
      throw new ValidationError(
        'provider placement: taskToTurn cannot replace declared provider options',
      )
    }
    const { signal: _signal, ...material } = turn
    turn = { ...detachedSnapshot(material, 'provider placement turn'), signal: linked }
  }
  args.onProviderSessionId(turn.sessionId ?? null)
  const source = await providerExecutionSource(args, turn, linked)
  const environment = source.environment
  args.onEnvironment(environment)
  args.startNativeMirror(environment)
  const archive = createTurnEventArchive()
  const seenTraceCalls = new Set<string>()
  let tokens = zeroTokenUsage()
  const usageLedger = createSandboxUsageLedger(args.profile.harness)
  let sawCompleteTokenReceipt = false
  let sawIncompleteTokenReceipt = false
  let sawCostReceipt = false
  let sawUnknownCostReceipt = false
  let sawCostEstimate = false
  let pendingUnpricedWork = false
  let pendingEstimate: number | undefined
  /** The model id a usage receipt reported, when it reported one. Only a catalog can price a run
   *  the provider never billed, and only a model id can address a catalog. */
  let observedModel: string | undefined
  let usdEstimated = 0
  let usd = 0
  let text = ''
  let terminal = false
  const failures = createProviderFailureLedger()
  // The artifact this turn settled with, once it exists. Its presence is what separates "the work
  // finished and the resource would not release" from "the work never finished".
  let settled: ExecutorResult<unknown> | undefined
  // The body's own failure, held so the `finally` cannot REPLACE it. A `finally` that throws
  // discards the in-flight exception, so a teardown error would otherwise mask the real cause of a
  // turn that failed for its own reasons.
  let failure: unknown
  let failed = false
  // Set when the turn was refused for capacity and the caller will continue in this environment.
  let unavailable: ProviderInvocationEnd['unavailable']
  // Whether the turn's final session copy was already taken: a turn whose workspace capture the
  // owner took over copies its session before it hands the capture over.
  let finalCopyTaken = false
  // Whether this turn's owner takes its workspace capture over, so the turn ends without waiting
  // for it. The owner's environment outlives its turns; the owner awaits the capture before the
  // environment's next turn and before it destroys the environment, and the capture's receipt is
  // journaled as evidence of this invocation. Only a port that copies the session on its own
  // queue hands the capture over: without one, the workspace capture is the only record of the
  // session the node settles with.
  const ownerTakesCapture = (): boolean =>
    args.options.workspaceRetention?.captureNative !== undefined &&
    args.createProfile.harness !== undefined &&
    source.retained &&
    args.retention?.preserveEnvironment === true &&
    args.retention.onEndOfTurnWork !== undefined
  // Hand the workspace capture to the owner. Its receipt reaches the journal as evidence of this
  // invocation; a capture that fails leaves none, and the owner's release then keeps the source.
  const handCaptureToOwner = (
    reported: object,
    captureOutcome: AgentRunOutcome | undefined,
    publish: boolean,
  ): void => {
    args.retention?.onEndOfTurnWork?.(
      args.captureWorkspace(environment, captureOutcome).then(
        async (snapshot) => {
          if (publish) args.onPublishedSnapshot(snapshot)
          if (snapshot === undefined) return
          await args.retention?.onEvidence?.({
            ...reported,
            workspaceSnapshot: snapshot,
            workspaceCapture: providerWorkspaceCaptureReceipt(
              args,
              environment,
              snapshot,
              turn.sessionId ?? null,
            ),
          })
        },
        () => undefined,
      ),
    )
  }
  // A deadline or a cancellation stops the harness once, before any capture of its session, so
  // the failure capture and the final copy read a session that has stopped changing.
  let harnessStop: Promise<void> | undefined
  const stopEndedHarness = (): Promise<void> => {
    if (settled !== undefined || !linked.aborted) return Promise.resolve()
    harnessStop ??= args.stopEndedHarness(linked)
    return harnessStop
  }
  try {
    const toolParts = createSandboxToolPartState()
    for await (const event of source.events) {
      archive.append(event)
      text += textFromEnvironmentEvent(event)
      const sandboxEvent = sandboxEventFromEnvironmentEvent(event)
      const eventData = sandboxEvent.data
      const part =
        eventData !== null && typeof eventData === 'object'
          ? (eventData as { readonly part?: unknown }).part
          : undefined
      if (part !== undefined) {
        const step = decodeBoxPart(part, args.profile.harness)
        if (step !== undefined && (step.callId === undefined || !seenTraceCalls.has(step.callId))) {
          if (step.callId !== undefined) seenTraceCalls.add(step.callId)
          args.trace.record(step)
        }
      }
      failures.observe(event, sandboxEvent)
      // One projection for every sandbox-shaped stream: the provider event is adapted to the
      // sandbox wire the mappers already read, so live output needs no provider-specific parser.
      for (const progress of sandboxProgressEvents(sandboxEvent, toolParts)) {
        yield { kind: 'progress', progress }
      }
      const usageEvent = usageSandboxEvent(event)
      if (usageEvent)
        yield* creditUsage(
          usageLedger.observe(usageEvent, args.profile.name ?? 'agent'),
          usageEvent,
        )
      yield* creditUsage(
        usageLedger.observe(sandboxEvent, args.profile.name ?? 'agent'),
        sandboxEvent,
      )
      if (isTerminalEnvironmentEvent(event)) terminal = true
    }
    yield* creditUsage(usageLedger.settleTurn(args.profile.name ?? 'agent'))
    // Interim missing prices and catalog estimates may be covered by a later cumulative bill.
    // Only unresolved work becomes unknown at settlement; do not add a quote to that bill.
    if (pendingUnpricedWork) {
      // A provider that reports tokens and no dollars used to settle a bare `$0`, so a sandbox-
      // rooted run that certainly spent money reported a dollar total of zero with no estimate at
      // all. The catalog answers what the provider WOULD bill, so the amount rides `usdEstimated`
      // and `usdKnown` stays false below: a price is not a receipt and must never become one.
      //
      // Priced only when NO dollars reached the channel for this execution. `tokens` is the
      // execution's cumulative total, not the unresolved remainder, so pricing it alongside any
      // receipt — billed or already marked unknown — would charge the same tokens twice. A
      // partially billed execution therefore keeps its unresolved part unknown, which is true.
      const estimated = pendingEstimate ?? (usd === 0 ? catalogPrice() : undefined)
      const estimate = estimated ?? 0
      sawUnknownCostReceipt = true
      usd += estimate
      if (estimated !== undefined) {
        sawCostEstimate = true
        usdEstimated += estimate
      }
      yield {
        kind: 'cost',
        usd: estimate,
        usdKnown: false,
        ...(estimated === undefined ? {} : { usdEstimated: estimate }),
        provenance: estimated === undefined ? 'uncaptured' : 'catalog-estimate',
      }
    }
    if ((args.options.requireTerminalEvent ?? true) && !terminal) {
      throw new ValidationError(
        `providerAsExecutor(${args.provider.name}): stream ended without a terminal result/done/status event`,
      )
    }
    // Continuations share one iteration; recovery restores it from the prior committed spend.
    if (args.carried === undefined) yield { kind: 'iteration' }
    // Retention captures once below and exposes that verified archive through the transcript port.
    // Environments without retention keep the existing bounded live-read path.
    if (args.options.workspaceRetention === undefined) {
      args.onHarnessTranscript(
        await captureHarnessTranscript(
          environment as Parameters<typeof captureHarnessTranscript>[0],
          args.profile.harness,
          linked,
        ),
      )
    }
    const outcome = failures.finish()
    const result: ProviderLeafOut & SandboxOutcomeCarrier = {
      ...resultFromEvents(archive.events(), text),
      ...(archive.superseded > 0 ? { supersededPartUpdates: archive.superseded } : {}),
      ...(outcome ? { outcome } : {}),
    }
    const spent: Spend = {
      iterations: 1,
      tokens,
      // Distinct partial receipts cannot prove each other's missing counters.
      ...(sawCompleteTokenReceipt && !sawIncompleteTokenReceipt ? {} : { tokensKnown: false }),
      usd,
      // A dollar total is known only when a canonical receipt arrived and none was marked
      // unknown. Bare provider numbers remain untrusted; Router billing receipts survive.
      usdKnown: sawCostReceipt && !sawUnknownCostReceipt,
      // Only unverified amounts are estimates; a mixed run must retain its billed subtotal.
      ...(sawCostEstimate ? { usdEstimated } : {}),
      ms: Date.now() - started,
    }
    const executionSpent: Spend =
      args.carried === undefined
        ? spent
        : {
            ...addSpend(args.carried, { ...spent, iterations: 0 }),
            ms: Date.now() - args.executionStartedAt,
          }
    // Scored HERE, before the `finally` destroys the environment: a validator that reads a file or
    // runs a command needs the environment it is scoring to still exist. Every other supervised
    // hook fires after teardown and can only read the artifact.
    const verdict = await args.options.validator?.validate(result, {
      iteration: 0,
      ...(args.node === undefined ? {} : { node: args.node }),
      box: environmentAsSandboxInstance(environment, {
        requireTerminalEvent: args.options.requireTerminalEvent ?? true,
      }),
      signal: linked,
    })
    // A turn its manager stopped is that manager's last turn of this drive, and the node's output
    // is the submission the manager's check accepted, not this turn's workspace. The workspace
    // capture waits on a queue every recursive environment shares: measured on Discovery Lab run
    // terraform-economics-20261005f, turns returned 4 to 28 minutes after their streams ended, and
    // five nodes with accepted results were settled `down` by deadlines inside that wait. The
    // owner therefore takes the capture over: the result is committed now, with the turn's usage,
    // and the capture runs afterwards.
    const deferCapture = ownerTakesCapture() && args.managerStopped()
    // The turn has settled, so a capture that fails or exceeds its deadline is a fact about the
    // evidence, never the turn's outcome. Measured 2026-10-03 on Runtime 0.295.4: one capture that
    // waited past its 1,200,000 ms deadline behind a two-slot queue shared by 34 workers threw an
    // AbortError, the driver classified it terminal, and two research roots ended with 13 and 0 of
    // their children settled. The source stays preserved because no receipt exists, the retained
    // owner reads the receipt-less result as a retention failure, and the turn is not re-run.
    let retainedWorkspace: AgentCandidateWorkspaceSnapshotEvidence | undefined
    let workspaceCaptureFailure: string | undefined
    if (!deferCapture) {
      try {
        retainedWorkspace = await args.captureWorkspace(environment, outcome)
      } catch (error) {
        workspaceCaptureFailure = `${errorText(error instanceof Error ? error.message : error)}; source environment preserved`
      }
      args.onPublishedSnapshot(retainedWorkspace)
    }
    const settledResult: ProviderLeafOut & SandboxOutcomeCarrier = {
      ...result,
      ...(workspaceCaptureFailure === undefined ? {} : { workspaceCaptureFailure }),
      ...(retainedWorkspace === undefined
        ? {}
        : {
            workspaceSnapshot: retainedWorkspace,
            workspaceCapture: providerWorkspaceCaptureReceipt(
              args,
              environment,
              retainedWorkspace,
              turn.sessionId ?? null,
            ),
          }),
    }
    settled = {
      ...(result.outcome?.status === 'failed'
        ? {
            outcome: {
              success: false,
              ...(result.outcome.error ? { error: result.outcome.error } : {}),
              // The code, not the text, is what a retry policy may branch on.
              ...(result.outcome.errorCode ? { errorCode: result.outcome.errorCode } : {}),
              ...(failureStatusCode(result.outcome) === undefined
                ? {}
                : { statusCode: failureStatusCode(result.outcome) }),
            },
          }
        : {}),
      outRef: contentRef(`provider:${args.provider.name}`, settledResult),
      out: settledResult,
      ...(verdict ? { verdict } : {}),
      spent: executionSpent,
    }
    const refusal =
      args.mayContinue && source.retained && result.outcome?.status === 'failed'
        ? unavailableSignalOfFailure({
            error: result.outcome.error ?? '',
            ...(result.outcome.errorCode ? { errorCode: result.outcome.errorCode } : {}),
            ...(failureStatusCode(result.outcome) === undefined
              ? {}
              : { statusCode: failureStatusCode(result.outcome) }),
          })
        : undefined
    if (refusal !== undefined) {
      unavailable = { signal: refusal, cause: errorText(result.outcome?.error ?? '') }
    }
    if (source.retained) await args.retention?.onResult(settled)
    else if (retainedWorkspace !== undefined) await args.retention?.onEvidence?.(settledResult)
    args.onPending(false)
    args.onArtifact(settled)
    if (deferCapture) {
      // The session copy this turn settles with is taken first, on the native queue, which never
      // waits behind workspace captures; the workspace capture then reads a session that ended.
      await args.finishNativeMirror(environment, 'settled')
      finalCopyTaken = true
      handCaptureToOwner(settledResult, outcome, true)
    }
  } catch (error) {
    failure = source.retained ? new RetainedExecutionPendingError(error) : error
    failed = true
    // A failed or cancelled stream has no ProviderLeafOut for the caller to retrieve. Keep the
    // live source even when capture succeeds, so its executable state remains the receipt boundary.
    if (args.options.workspaceRetention !== undefined) args.onUnsettledFailure()
    const failureOutcome =
      failures.finish() ??
      ({
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        ...(linked.aborted ? { errorCode: 'cancelled' } : {}),
      } satisfies AgentRunOutcome)
    await stopEndedHarness()
    // The scope settles an aborted node as soon as the abort reaches it and reads the transcript
    // this executor holds then. The stopped harness's final session copy is taken here, before the
    // capture of the whole workspace, which can run for minutes; the 2026-10-04 trace proof
    // settled a deadline node with its last running copy, `native_snapshot_live`.
    if (linked.aborted) await args.finishNativeMirror(environment, 'failed')
    args.onTranscriptSettled()
    if (ownerTakesCapture()) {
      // The owner takes this failed turn's capture over too, so the drive ends now and the
      // owner's release reads the capture's receipt before it decides what to destroy.
      if (!linked.aborted) await args.finishNativeMirror(environment, 'failed')
      finalCopyTaken = true
      handCaptureToOwner(
        { ...resultFromEvents(archive.events(), text), outcome: failureOutcome },
        failureOutcome,
        false,
      )
    } else {
      try {
        const retainedWorkspace = await args.captureWorkspace(environment, failureOutcome)
        if (retainedWorkspace !== undefined && args.retention?.onEvidence !== undefined) {
          await args.retention.onEvidence({
            ...resultFromEvents(archive.events(), text),
            outcome: failureOutcome,
            workspaceSnapshot: retainedWorkspace,
            workspaceCapture: providerWorkspaceCaptureReceipt(
              args,
              environment,
              retainedWorkspace,
              turn.sessionId ?? null,
            ),
          })
        }
      } catch (captureError) {
        // Preserve the stream failure alongside capture's own cause. A persistence error can
        // be shared with the supervisor, so never replace its cause or make it refer to itself
        // when capture was also the original failure.
        if (captureError instanceof Error && captureError !== error) {
          failure =
            captureError.cause === undefined
              ? Object.assign(captureError, { cause: failure })
              : new AggregateError([captureError, failure], captureError.message, {
                  cause: captureError,
                })
        } else {
          failure = captureError
        }
      }
    }
    if (args.options.workspaceRetention === undefined) {
      args.onHarnessTranscript(
        await captureHarnessTranscript(
          environment as Parameters<typeof captureHarnessTranscript>[0],
          args.profile.harness,
          linked,
        ),
      )
    }
  } finally {
    await stopEndedHarness()
    // Before any teardown: the final copy reads the session from the live environment. This is
    // the only capture that runs when the stream was closed by an abort or a deadline.
    if (!finalCopyTaken) {
      await args.finishNativeMirror(
        environment,
        failed ? 'failed' : settled !== undefined ? 'settled' : 'interrupted',
      )
    }
    if (
      (!source.retained || (settled !== undefined && !failed)) &&
      !(source.retained && args.retention?.preserveEnvironment) &&
      // A refused turn keeps its environment: the executor continues in it.
      !(unavailable !== undefined && !failed) &&
      (args.options.destroyOnSettle ?? true)
    ) {
      const cleanup = await args.destroyEnvironment()
      if (!cleanup.destroyed) {
        const error = new Error(cleanup.detail ?? 'provider environment teardown was not confirmed')
        // ONCE THE TURN HAS SETTLED, TEARDOWN CANNOT CHANGE THE OUTCOME. Measured: a second DELETE
        // answered 409, the rejection escaped this `finally`, and a run whose turn had completed
        // (`spent.iterations: 1`, artifact produced) was reported as a failure. The resource fact is
        // recorded beside the result; the result stands.
        //
        // Before the turn settles there is no outcome to protect, so the failure IS the outcome and
        // is rethrown — a create-then-fail-then-leak path must still fail loudly.
        if (settled !== undefined) {
          args.onArtifact({
            ...settled,
            teardown: {
              failed: true,
              error: error.message,
              at: new Date().toISOString(),
            },
          })
        } else if (!failed) {
          // Nothing settled and the body did not fail on its own: the teardown failure IS the
          // outcome, so a create-then-leak path still fails loudly.
          failure = error
          failed = true
        } else {
          // The body already failed. ITS error is the cause a reader needs; the teardown failure
          // rides along as `cause` rather than displacing it.
          failure =
            failure instanceof Error
              ? Object.assign(failure, { cause: failure.cause ?? error })
              : failure
        }
      }
    }
  }
  if (failed) throw failure
  return {
    ...(unavailable === undefined ? {} : { unavailable }),
    ...(settled === undefined ? {} : { spent: settled.spent }),
    madeProgress: tokens.input > 0 || tokens.output > 0 || usd > 0,
    durationMs: Date.now() - started,
  }

  /**
   * The catalog price of this execution's whole token total, under the first model id the catalog
   * knows. Undefined when none prices, so an unpriced model settles with no estimate at all rather
   * than a zero one — absence says "nothing could be priced", a zero would say "priced at nothing".
   *
   * Candidates run most specific first: the id a usage receipt reported, then the turn's own
   * model, then the profile's. A provider that selected its own default declares no profile model,
   * so a reported id is then the only one a catalog can match.
   */
  function catalogPrice(): number | undefined {
    for (const model of [observedModel, turn.model, concreteProfileModel(args.createProfile)]) {
      if (model === undefined) continue
      const priced = priceUnreceiptedWork({
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        model,
      })
      if (priced.usdKnown === false && priced.usdEstimated !== undefined) return priced.usdEstimated
    }
    return undefined
  }

  /** This invocation's cumulative tokens as the execution's: a continuation adds what its earlier
   *  invocations already reported. */
  function executionTokens(own: ReturnType<typeof usageLedger.tokenUsage>) {
    if (args.carried === undefined) return own
    const total = cloneTokenUsage(args.carried.tokens)
    addTokenUsage(total, own)
    return total
  }

  function* creditUsage(
    receipt: ReturnType<typeof usageLedger.observe>,
    event?: SandboxEvent,
  ): Iterable<UsageEvent> {
    if (receipt === undefined) return
    // A receipt that named no model is stamped with the worker's name, which is not a model id and
    // prices nothing. Only a different value is evidence of what the provider actually served.
    if (receipt.model !== (args.profile.name ?? 'agent')) observedModel = receipt.model
    const hasTokens = receipt.tokensIn !== undefined || receipt.tokensOut !== undefined
    if (
      hasTokens &&
      receipt.tokensIn !== undefined &&
      receipt.tokensOut !== undefined &&
      receipt.tokensKnown !== false
    ) {
      sawCompleteTokenReceipt = true
    } else if (hasTokens || receipt.tokensKnown === false || receipt.tokensUnknownReason) {
      sawIncompleteTokenReceipt = true
    }
    const input = receipt.tokensIn ?? 0
    const output = receipt.tokensOut ?? 0
    if (input || output || receipt.tokensKnown === false || receipt.promptCache !== undefined) {
      tokens = usageLedger.tokenUsage()
      yield {
        kind: 'tokens',
        mode: 'cumulative',
        ...executionTokens(tokens),
        ...(receipt.tokensKnown === false ? { tokensKnown: false } : {}),
      }
    }
    const amount = receipt.costUsd
    if (amount !== undefined) {
      sawCostReceipt = true
      usd += amount
      if (receipt.usdKnown === false) {
        sawUnknownCostReceipt = true
        sawCostEstimate = true
        usdEstimated += amount
        yield {
          kind: 'cost',
          usdKnown: false,
          usd: amount,
          usdEstimated: amount,
          provenance: 'uncaptured',
        }
      } else {
        if (event && canonicalSandboxUsageMode(event) === 'cumulative') {
          // This receipt covers the bound execution's prior work, not just one new call.
          pendingUnpricedWork = false
          pendingEstimate = undefined
        }
        yield { kind: 'cost', usdKnown: true, usd: amount, provenance: 'provider-receipt' }
      }
    } else if (receipt.estimatedCostUsd !== undefined) {
      pendingUnpricedWork = true
      pendingEstimate = (pendingEstimate ?? 0) + receipt.estimatedCostUsd
    } else if (input > 0 || output > 0 || receipt.tokensKnown === false) {
      // A duplicate terminal token total credits zero and cannot invent more unpriced work.
      pendingUnpricedWork = true
    }
  }
}

/** Subscription selection needs the same complete profile on creation and every new turn. */
function subscriptionTurnProfile(turn: AgentTurnInput, profile: AgentProfile): AgentTurnInput {
  if (profile.model?.metadata?.credentialSource !== 'subscription') return turn
  const backend = promptOptionsFromAgentTurnInput(turn).backend ?? {}
  const digest = canonicalAgentProfileDigest(profile)
  if (
    (turn.profile !== undefined && canonicalAgentProfileDigest(turn.profile) !== digest) ||
    (backend.profile !== undefined && canonicalAgentProfileDigest(backend.profile) !== digest)
  ) {
    throw new ValidationError('provider subscription turn cannot replace its exact AgentProfile')
  }
  return { ...turn, profile }
}

/** One retained dispatch owns creation, replay, result identity, and cancellation. */
async function providerExecutionSource(
  args: StreamProviderExecutorArgs,
  turn: AgentTurnInput,
  signal: AbortSignal,
): Promise<{
  environment: AgentEnvironment
  events: AsyncIterable<AgentEnvironmentEvent>
  retained: boolean
}> {
  const selectedTurn = subscriptionTurnProfile(turn, args.profile)
  AgentTurnInputSchema.parse(selectedTurn)
  const capabilities = args.retention ? await args.provider.capabilities() : undefined
  const useRetained = args.retention !== undefined && capabilities?.retainedControl !== undefined
  if (!useRetained) {
    if (args.recovering)
      throw new Error(`provider ${args.provider.name} cannot recover retained executions`)
    const environment = await args.provider.create({
      ...args.options.defaults,
      profile: args.createProfile,
      signal,
    })
    return { environment, events: environment.stream(selectedTurn), retained: false }
  }
  const retention = args.retention!
  let admitted = args.recovering
  let executionAdmitted =
    args.recovering && retention.admissions.some((admission) => admission.phase === 'dispatched')
  const onAdmission = async (admission: Parameters<typeof retention.onAdmission>[0]) => {
    if (admission.phase === 'dispatched') executionAdmitted = true
    await retention.onAdmission(admission)
    admitted = true
    args.onPending(true)
  }
  const priorSession = retention.priorSession
  const environmentKey = priorSession?.idempotencyKey ?? `runtime:${args.executionId}`
  const turnId = `${args.executionId}:turn:0`
  // A new environment that replaces one the provider lost starts from its latest checkpoint, so
  // the re-entered manager keeps its files. An environment that is continued needs none.
  const restore = priorSession === undefined ? retention.restoreWorkspace : undefined
  const material = {
    environment: {
      ...args.options.defaults,
      ...(restore === undefined
        ? {}
        : { workspace: { ...args.options.defaults?.workspace, checkpoint: restore.checkpoint } }),
      profile: args.createProfile,
      idempotencyKey: environmentKey,
      signal,
    },
    turn: { ...selectedTurn, turnId },
    ...(priorSession === undefined
      ? {}
      : {
          existingEnvironmentId: priorSession.environmentId,
          identity: {
            sessionId: priorSession.sessionId,
            executionId: mintRetainedIdentity(environmentKey, turnId).executionId,
          },
        }),
  }
  try {
    const admissions = retention.admissions
    const dispatched = [...admissions]
      .reverse()
      .find((admission) => admission.phase === 'dispatched')
    const intent = admissions.find((admission) => admission.phase === 'intent')
    const environmentAdmission = admissions.find((admission) => admission.phase === 'environment')
    // A journaled execution input can precede the first provider admission. In that case
    // no provider call happened: onAdmission(intent) is awaited before create/dispatch.
    // Start with the original execution keys; once any admission exists, validate its intent.
    if (args.recovering && admissions.length > 0) {
      if (!intent) throw new Error('retained provider execution has no original intent')
      try {
        assertRetainedRunReplayMaterial(args.provider, material, intent)
      } catch (error) {
        if (selectedTurn === turn) throw error
        // An older admission may have relied on the create-time profile. Only
        // its exact original material may replay; a new turn uses the profile.
        const original = { ...material, turn: { ...turn, turnId } }
        assertRetainedRunReplayMaterial(args.provider, original, intent)
        material.turn = original.turn
      }
    }
    let handle: RetainedRunHandle
    if (args.recovering && dispatched?.phase === 'dispatched') {
      const reconnected = await reconnectRetainedRun({
        provider: args.provider,
        controlRef: dispatched.controlRef,
      })
      if (!reconnected) throw new Error('retained provider environment is unavailable')
      handle = reconnected
    } else if (args.recovering && environmentAdmission?.phase === 'environment') {
      // Before a new turn dispatches, a reused session still identifies its previous turn.
      // Replay the committed intent rather than mistaking that prior result for this execution.
      let recovered =
        material.existingEnvironmentId !== undefined && intent?.phase === 'intent'
          ? await recoverRetainedRun({
              provider: args.provider,
              admission: intent,
              replay: material,
              onAdmission,
            })
          : await recoverRetainedRun({
              provider: args.provider,
              environmentId: environmentAdmission.environmentId,
              sessionId: environmentAdmission.sessionId,
              executionId: environmentAdmission.executionId,
            })
      if (recovered.outcome === 'unverifiable' && intent?.phase === 'intent') {
        // The environment admission precedes dispatch. Replay the validated original keys
        // when the provider cannot yet identify a session, including a lost dispatch reply.
        recovered = await recoverRetainedRun({
          provider: args.provider,
          admission: intent,
          replay: material,
          onAdmission,
        })
      }
      if (recovered.outcome !== 'recovered')
        throw new Error(`retained provider execution is ${recovered.outcome}`)
      handle = recovered.handle
      await onAdmission({
        phase: 'dispatched',
        controlRef: handle.controlRef,
        idempotencyKey: environmentAdmission.idempotencyKey,
        turnId: environmentAdmission.turnId,
      })
    } else if (args.recovering && intent?.phase === 'intent') {
      const recovered = await recoverRetainedRun({
        provider: args.provider,
        admission: intent,
        replay: material,
        onAdmission,
      })
      if (recovered.outcome !== 'recovered')
        throw new Error(`retained provider execution is ${recovered.outcome}`)
      handle = recovered.handle
    } else {
      if (args.recovering && admissions.length > 0)
        throw new Error('retained provider execution has no durable admission')
      handle = await startRetainedRun({ provider: args.provider, ...material, onAdmission })
    }
    executionAdmitted = true
    args.onRetained(handle)
    args.onPending(true)
    const environment = await args.provider.get?.(handle.controlRef.environmentId)
    if (!environment) throw new Error('retained provider environment is unavailable')
    if (restore !== undefined && !args.recovering) {
      // The provider restores a checkpoint or fails the create; the marker Runtime wrote before
      // the checkpoint is the evidence it did, journaled before the turn's result is judged.
      const found = await verifyWorkspaceMarker(environment, restore.marker, signal)
      await retention.onWorkspaceRestored?.({
        environmentId: environment.id,
        checkpoint: restore.checkpoint,
        ...found,
      })
    }
    const session = exactSession(environment, handle.controlRef).session
    async function* events(): AsyncIterable<AgentEnvironmentEvent> {
      let observationFailure: { error: unknown } | undefined
      // The last frame that carried a replay position, and whether any frame ended the turn. The
      // SSE contract lets a frame arrive with no position; such a frame does not move the cursor,
      // so this is where a reconnect resumes from.
      let lastReplayPosition: string | undefined
      let sawTerminal = false
      const drain = async function* (
        open: () => AsyncIterable<AgentEnvironmentEvent>,
      ): AsyncGenerator<AgentEnvironmentEvent, boolean> {
        let iterator: AsyncIterator<AgentEnvironmentEvent> | undefined
        let failed = false
        try {
          iterator = open()[Symbol.asyncIterator]()
        } catch (error) {
          if (signal.aborted) throw error
          observationFailure = { error }
          return false
        }
        try {
          while (true) {
            let next: IteratorResult<AgentEnvironmentEvent>
            try {
              next = await awaitAbortable(
                Promise.resolve().then(() => iterator!.next()),
                signal,
              )
            } catch (error) {
              if (signal.aborted) throw error
              observationFailure = { error }
              failed = true
              break
            }
            if (next.done) break
            // A received event for another execution must never be accepted as evidence — and
            // it is the PROVIDER's contract that was broken, so it must classify as such (#1204).
            try {
              assertEventBinding(next.value, handle.controlRef)
            } catch (error) {
              throw new RetainedRunProviderContractError(
                error instanceof Error ? error.message : 'provider event bound to another run',
                { code: 'RETAINED_EVENT_BINDING_INVALID', cause: error },
              )
            }
            if (next.value.id !== undefined) lastReplayPosition = next.value.id
            if (isTerminalEnvironmentEvent(next.value)) sawTerminal = true
            yield next.value
          }
        } finally {
          if (signal.aborted || failed) {
            void Promise.resolve()
              .then(() => iterator?.return?.())
              .catch(() => undefined)
          } else {
            await iterator?.return?.()
          }
        }
        return !failed
      }
      const completed = yield* drain(() =>
        session.events({ executionId: handle.controlRef.executionId, signal }),
      )
      if (!completed && !sawTerminal && lastReplayPosition !== undefined) {
        // The live stream broke before the terminal receipt. That receipt is where a Sandbox
        // execution reports its token usage, and the exact result read below does not carry it,
        // so a break here used to settle a 15-minute turn at 0 tokens with tokensKnown: false,
        // which the conserved pool debits as nothing. Measured on
        // mech-interp-foundations-pi-20260915k turn 1 (926 s, 0/0) and -20260915l turns 2 and 3
        // (1693 s and 846 s, 0/0), each cut by one frame the provider refused mid-stream. The
        // provider replays from a cursor, so resume once from the last replay position. A second
        // failure keeps the first as the recorded cause; it is the one that lost the frames.
        const firstFailure = observationFailure
        observationFailure = undefined
        const resumed = yield* drain(() =>
          session.events({
            executionId: handle.controlRef.executionId,
            since: lastReplayPosition,
            signal,
          }),
        )
        if (!resumed) observationFailure = firstFailure
      }
      // Observation failure does not establish execution failure. Only the exact retained
      // result can settle the invocation; retain incomplete observation beside that result.
      let result: AgentTurnResult
      try {
        result = await awaitAbortable(handle.result(), signal)
      } catch (error) {
        if (observationFailure === undefined || signal.aborted) throw error
        throw new AggregateError(
          [observationFailure.error, error],
          'retained event observation failed and its exact result could not be reconciled',
          { cause: error },
        )
      }
      yield {
        type: 'result',
        data: {
          finalText: result.text,
          success: result.success,
          ...(result.error ? { error: result.error } : {}),
          usageMode: 'cumulative',
          ...(observationFailure === undefined
            ? {}
            : {
                eventStreamComplete: false,
                eventStreamError: String(
                  defaultRedactor(
                    observationFailure.error instanceof Error
                      ? observationFailure.error.message
                      : String(observationFailure.error),
                  ),
                ).slice(0, 2_048),
              }),
        },
        ...(result.usage ? { usage: result.usage } : {}),
      }
    }
    return { environment, events: events(), retained: true }
  } catch (error) {
    // A durable dispatch or exact reattachment proves execution admission before observation starts.
    if (admitted)
      throw new RetainedExecutionPendingError(error, executionAdmitted ? 'execution' : 'admission')
    throw error
  }
}

function createInputFromSandboxOptions(
  options: CreateSandboxOptions | undefined,
): Partial<CreateAgentEnvironmentInput> {
  const profile = options?.backend?.profile
  const backend = options?.backend?.type
  const cwd =
    options?.cwd === undefined
      ? undefined
      : canonicalWorkspaceCwd({ base: 'repository', path: options.cwd })
  const workspace = {
    ...(options?.environment ? { environment: options.environment } : {}),
    ...(options?.git?.url ? { repoUrl: options.git.url } : {}),
    ...(options?.git?.ref ? { gitRef: options.git.ref } : {}),
    ...(cwd === undefined ? {} : { cwd }),
  }
  return {
    ...(profile !== undefined ? { profile } : {}),
    ...(backend ? { backend } : {}),
    ...(Object.keys(workspace).length > 0 ? { workspace } : {}),
    ...(options?.resources ? { resources: options.resources as ResourceRequest } : {}),
    ...(options?.env ? { env: options.env } : {}),
    // Sandbox's "all" selector stays in the transport options; neutral inputs name secrets.
    ...(Array.isArray(options?.secrets) ? { secrets: options.secrets } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {}),
    ...(options?.name ? { name: options.name } : {}),
    ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    providerOptions: { sandboxCreateOptions: options ?? {} },
  }
}

function environmentAsSandboxInstance(
  environment: AgentEnvironment,
  options: {
    requireTerminalEvent: boolean
    workspaceRetention?: ProviderWorkspaceRetentionPort
    retentionIdentity?: { executionId: string; profile: AgentProfile; node?: ExecutorNodeContext }
    onWorkspaceCaptured?: (receipt: ProviderWorkspaceCaptureReceipt) => void | Promise<void>
  },
): SandboxInstance {
  let providerSessionId: string | null = null
  let controlRef: AgentExactRunControlRef | undefined
  const noteControlRef = (candidate: unknown): void => {
    if (options.workspaceRetention === undefined) return
    const parsed = AgentExactRunControlRefSchema.safeParse(candidate)
    if (!parsed.success) return
    if (
      parsed.data.environmentId !== environment.id ||
      parsed.data.provider !== environment.provider
    )
      throw new ValidationError(
        'providerAsSandboxClient: capture control reference names another environment',
      )
    controlRef = freezeControlRef(parsed.data)
    providerSessionId = controlRef.sessionId
  }
  let capture: Promise<ProviderWorkspaceCaptureReceipt> | undefined
  let publication: Promise<void> | undefined
  const box = {
    id: environment.id,
    name: environment.name,
    status: 'running',
    async refresh(): Promise<void> {
      await environment.refresh?.()
    },
    async *streamPrompt(
      message: string | PromptInputPart[],
      promptOptions?: PromptOptions,
    ): AsyncGenerator<SandboxEvent> {
      let terminal = false
      const input = turnInputFromPrompt(message, promptOptions)
      providerSessionId = input.sessionId ?? null
      noteControlRef(input.controlRef)
      let cancellation: Promise<void> | undefined
      let cancellationStarted = false
      let cancellationFailed = false
      let cancellationError: unknown
      const cancel = () => {
        if (cancellationStarted || !input.sessionId || !environment.session) return
        cancellationStarted = true
        try {
          const session = environment.session(input.sessionId, {
            ...(input.controlRef === undefined ? {} : { controlRef: input.controlRef }),
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })
          assertScopedSessionForInput(session, input)
          cancellation = session.cancel().catch((error: unknown) => {
            cancellationFailed = true
            cancellationError = error
          })
        } catch (error) {
          cancellationFailed = true
          cancellationError = error
        }
      }
      input.signal?.addEventListener('abort', cancel, { once: true })
      if (input.signal?.aborted) cancel()
      let streamFailed = false
      let streamError: unknown
      try {
        for await (const event of environment.stream(input)) {
          if (isTerminalEnvironmentEvent(event)) terminal = true
          const usageEvent = usageSandboxEvent(event)
          if (usageEvent) yield usageEvent
          yield sandboxEventFromEnvironmentEvent(event)
        }
      } catch (error) {
        streamFailed = true
        streamError = error
      } finally {
        input.signal?.removeEventListener('abort', cancel)
        if (input.signal?.aborted) {
          cancel()
          await cancellation
        }
      }
      if (input.signal?.aborted) {
        const abortError = new DOMException('Provider session stream aborted', 'AbortError')
        const causes = [
          ...(streamFailed ? [streamError] : []),
          ...(cancellationFailed ? [cancellationError] : []),
        ]
        if (causes.length > 0) {
          Object.defineProperty(abortError, 'cause', {
            value:
              causes.length === 1
                ? causes[0]
                : new AggregateError(causes, 'Provider stream and cancellation failed'),
          })
        }
        throw abortError
      }
      if (streamFailed) throw streamError
      if (cancellationFailed) throw cancellationError
      if (options.requireTerminalEvent && !terminal) {
        throw new ValidationError(
          `providerAsSandboxClient(${environment.provider}): stream ended without a terminal result/done/status event`,
        )
      }
    },
    async prompt(
      message: string | PromptInputPart[],
      promptOptions?: PromptOptions,
    ): Promise<PromptResult> {
      const events: AgentEnvironmentEvent[] = []
      let text = ''
      let usage: TokenUsage | undefined
      let terminal = false
      const failures = createProviderFailureLedger()
      const input = turnInputFromPrompt(message, promptOptions)
      providerSessionId = input.sessionId ?? null
      noteControlRef(input.controlRef)
      for await (const event of environment.stream(input)) {
        events.push(event)
        if (isTerminalEnvironmentEvent(event)) terminal = true
        failures.observe(event, sandboxEventFromEnvironmentEvent(event))
        text += textFromEnvironmentEvent(event)
        usage = mergeTokenUsage(usage, event.usage)
      }
      if (options.requireTerminalEvent && !terminal) {
        throw new ValidationError(
          `providerAsSandboxClient(${environment.provider}): prompt ended without a terminal result/done/status event`,
        )
      }
      const outcome = failures.finish()
      return {
        response: resultFromEvents(events, text).content,
        success: outcome?.success ?? true,
        status: outcome?.status ?? 'success',
        durationMs: 0,
        ...(outcome?.error ? { error: outcome.error } : {}),
        ...(usage ? { usage } : {}),
      }
    },
    ...(environment.dispatch && environment.session
      ? {
          async dispatchPrompt(message: string | PromptInputPart[], promptOptions?: PromptOptions) {
            const session = await environment.dispatch?.(
              turnInputFromPrompt(message, promptOptions),
            )
            if (!session)
              throw new ValidationError('providerAsSandboxClient: dispatch returned no session')
            noteControlRef(session.controlRef)
            return sandboxDispatchResultFromSessionRef(session)
          },
        }
      : {}),
    ...(environment.session
      ? {
          session(id: string, sessionOptions?: { controlRef?: AgentRunControlRef }) {
            noteControlRef(sessionOptions?.controlRef)
            return sandboxSessionFromAgentSession(
              environment.session?.(id, sessionOptions),
              sessionOptions?.controlRef,
            )
          },
        }
      : {}),
    ...(environment.read ? { read: environment.read.bind(environment) } : {}),
    ...(environment.write ? { write: environment.write.bind(environment) } : {}),
    ...(environment.exec
      ? {
          exec: environment.exec.bind(environment),
        }
      : {}),
    ...(environment.checkpoint
      ? {
          async checkpoint(checkpointOptions?: CheckpointRequest) {
            const checkpoint = await environment.checkpoint?.(checkpointOptions)
            return { checkpointId: checkpoint?.id, id: checkpoint?.id }
          },
        }
      : {}),
    ...(environment.fork
      ? {
          async fork(checkpointId: string, forkOptions?: ForkRequest) {
            const forked = await environment.fork?.({ id: checkpointId }, forkOptions)
            if (!forked)
              throw new ValidationError('providerAsSandboxClient: fork returned no environment')
            return environmentAsSandboxInstance(forked, options)
          },
        }
      : {}),
    async delete(): Promise<void> {
      if (options.workspaceRetention !== undefined) {
        const identity = options.retentionIdentity
        if (identity === undefined)
          throw new ValidationError(
            'providerAsSandboxClient: retention identity missing before delete',
          )
        capture ??= captureProviderWorkspaceSnapshot(options.workspaceRetention, {
          environment,
          executionId: identity.executionId,
          ...(controlRef === undefined ? {} : { controlRef }),
          ...(identity.node === undefined ? {} : { node: identity.node }),
          providerSessionId,
          nativeSessionId: null,
          profile: identity.profile,
        }).then(({ snapshot, provenance, coverageComplete, incompleteReason }) => ({
          executionId: identity.executionId,
          ...(controlRef === undefined ? {} : { controlRef }),
          ...(identity.node === undefined ? {} : { node: identity.node }),
          environmentId: environment.id,
          profileDigest: canonicalAgentProfileDigest(identity.profile),
          ...capturedSessionIdentity(
            provenance,
            coverageComplete === true,
            identity.executionId,
            providerSessionId,
          ),
          snapshot,
          provenance,
          coverageComplete: coverageComplete ?? false,
          ...(incompleteReason === undefined ? {} : { incompleteReason }),
        }))
        const receipt = await capture
        publication ??= Promise.resolve().then(async () => {
          await options.onWorkspaceCaptured?.(receipt)
        })
        const publishing = publication
        try {
          await publishing
        } catch (error) {
          if (publication === publishing) publication = undefined
          throw error
        }
        if (options.workspaceRetention.requireCompleteProvenance && !receipt.coverageComplete) {
          throw new Error(
            receipt.incompleteReason ?? 'provider workspace retention coverage incomplete',
          )
        }
      }
      await environment.destroy?.()
    },
  }
  return box as unknown as SandboxInstance
}

function sandboxSessionFromAgentSession(
  session: AgentSession | undefined,
  expectedControlRef?: AgentRunControlRef,
): SandboxSessionLike {
  if (!session) throw new ValidationError('providerAsSandboxClient: session is unavailable')
  const controlRef = resolveSessionControlRef(session.controlRef, expectedControlRef)
  return {
    id: session.id,
    ...(controlRef === undefined ? {} : { controlRef }),
    async status() {
      const status = await session.status()
      if (!status) return null
      return {
        id: session.id,
        status: sandboxSessionStatusFromAgentSessionStatus(status),
      }
    },
    async *events(options?: {
      since?: string
      executionId?: string
      signal?: AbortSignal
    }): AsyncGenerator<SandboxEvent> {
      const executionId = scopedExecutionId(controlRef, options?.executionId)
      for await (const event of session.events({
        ...(options?.since === undefined ? {} : { since: options.since }),
        ...(executionId === undefined ? {} : { executionId }),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      }))
        yield sandboxEventFromEnvironmentEvent(event)
    },
    async result(options?: { executionId?: string }): Promise<PromptResult> {
      scopedExecutionId(controlRef, options?.executionId)
      return promptResultFromAgentTurnResult(await session.result())
    },
    async prompt(
      message: string | PromptInputPart[],
      options?: PromptOptions,
    ): Promise<PromptResult> {
      return promptResultFromAgentTurnResult(
        await session.prompt(turnInputFromPrompt(message, options)),
      )
    },
    ...(session.respondToInteraction
      ? {
          async respondToInteraction(
            command: InteractionResponseCommand,
            options?: { signal?: AbortSignal },
          ) {
            assertInteractionCommandScope(command, controlRef)
            return {
              acknowledgement: await session.respondToInteraction!(command, options),
            }
          },
        }
      : {}),
    ...(session.cancelRun
      ? {
          async cancelRun(
            request: AgentRunCancellationRequest,
            options?: { signal?: AbortSignal },
          ): Promise<AgentRunCancellationAcknowledgement> {
            assertCancellationScope(request, controlRef)
            return session.cancelRun!(request, options)
          },
        }
      : {}),
    async interrupt(options?: { executionId?: string }) {
      scopedExecutionId(controlRef, options?.executionId)
      await session.cancel()
      return { cancelled: true }
    },
  }
}

function sandboxSessionStatusFromAgentSessionStatus(
  status: AgentSessionStatus,
): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' {
  switch (status) {
    case 'pending':
    case 'provisioning':
      return 'queued'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    // Sandbox has no neutral stopped state; do not report completion without success proof.
    case 'stopped':
    case 'failed':
    case 'expired':
    case 'unknown':
      return 'failed'
  }
}

function promptResultFromAgentTurnResult(result: AgentTurnResult): PromptResult {
  return {
    response: result.text,
    success: result.success,
    status: result.success ? 'success' : 'failed',
    durationMs: 0,
    ...(result.error ? { error: result.error } : {}),
    ...(result.usage
      ? {
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          },
          ...(result.usage.cost === undefined ? {} : { costUsd: result.usage.cost }),
        }
      : {}),
  }
}

function sandboxEventFromEnvironmentEvent(event: AgentEnvironmentEvent): SandboxEvent {
  const normalized = event.normalized
  const type = normalized?.type ?? event.type
  const baseData = normalized ? sandboxDataFromNormalizedEvent(event.data, normalized) : event.data
  const usage = event.usage ? tokenUsageData(event.usage) : undefined
  const data = (() => {
    if (!usage) return baseData
    if (isUsageType(type))
      return {
        ...baseData,
        tokensIn: event.usage?.inputTokens,
        tokensOut: event.usage?.outputTokens,
        ...(event.usage?.cost !== undefined ? { costUsd: event.usage.cost } : {}),
        ...usage,
      }
    if (isNestedUsageType(type)) return { ...baseData, usage }
    if (type === 'done') {
      return {
        ...baseData,
        tokenUsage: usage,
        ...(usage.totalCostUsd !== undefined ? { totalCostUsd: usage.totalCostUsd } : {}),
      }
    }
    return baseData
  })()
  // A provider adapter's numeric usage cost is not a billing receipt unless the source marked
  // it as one. Preserve explicit Router/provider provenance and mark bare numbers uncaptured.
  const costProvenance = data.costProvenance ?? data.cost_provenance
  const nestedUsage = data.usage ?? data.tokenUsage
  const nestedCost =
    nestedUsage && typeof nestedUsage === 'object'
      ? ((nestedUsage as Record<string, unknown>).cost ??
        (nestedUsage as Record<string, unknown>).costUsd ??
        (nestedUsage as Record<string, unknown>).totalCostUsd)
      : undefined
  const untrustedProviderCost =
    (event.usage?.cost !== undefined ||
      data.costUsd !== undefined ||
      data.totalCostUsd !== undefined ||
      nestedCost !== undefined) &&
    costProvenance === undefined
  const normalizedData = untrustedProviderCost ? { ...data, costProvenance: 'uncaptured' } : data
  return {
    type,
    data: 'usageMode' in event ? { ...normalizedData, usageMode: event.usageMode } : normalizedData,
    ...(event.id ? { id: event.id } : {}),
  }
}

function providerFailureEvent(
  event: AgentEnvironmentEvent,
  sandboxEvent: SandboxEvent,
): SandboxEvent | undefined {
  if (event.type === 'error') {
    const errorCode = failureCode(sandboxEvent.data)
    return {
      type: 'error',
      data: { ...sandboxEvent.data, ...(errorCode ? { code: errorCode } : {}) },
    }
  }

  const normalized = event.normalized
  const failedStatus =
    (event.type === 'status' && event.data.status === 'failed') ||
    (normalized?.type === 'status' && normalized.status === 'failed')
  const terminalFrame = sandboxEvent.type === 'done' || sandboxEvent.type === 'result'
  const outcome = recordValue(sandboxEvent.data.outcome)
  const result = recordValue(sandboxEvent.data.result)
  const failedTerminal =
    terminalFrame &&
    (sandboxEvent.data.success === false ||
      sandboxEvent.data.status === 'failed' ||
      outcome?.type === 'failed' ||
      outcome?.status === 'failed' ||
      result?.status === 'failed')
  if (!failedStatus && !failedTerminal) return undefined

  const detail =
    failureDetail(sandboxEvent.data) ??
    failureDetail(outcome) ??
    failureDetail(result) ??
    (normalized?.type === 'status' ? normalized.detail : undefined)
  const errorCode = failureCode(sandboxEvent.data) ?? failureCode(outcome) ?? failureCode(result)
  const statusCode =
    failureStatusCode(sandboxEvent.data) ?? failureStatusCode(outcome) ?? failureStatusCode(result)
  return {
    type: 'result',
    data: {
      status: 'failed',
      ...(detail ? { error: detail } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(statusCode === undefined ? {} : { statusCode }),
    },
  }
}

/** The statuses the sandbox outcome tracker itself reads as success, so a frame that would settle
 *  `success: true` there is the same frame that supersedes a transient error here. */
const TERMINAL_SUCCESS_STATUSES = new Set(['completed', 'done', 'ok', 'success'])

/**
 * Whether a frame says, explicitly, that the run succeeded: a raw or normalized
 * `status: completed` (the same form `isTerminalEnvironmentEvent` reads as terminal), or a
 * terminal `done`/`result` with `success: true` or a success status on the frame, its outcome,
 * or its nested result. An empty `done` says nothing and supersedes nothing — the stream that
 * ends `status: failed` then `done: {}` stays failed.
 */
function providerTerminalSuccess(
  event: AgentEnvironmentEvent,
  sandboxEvent: SandboxEvent,
): boolean {
  if (event.type === 'status' && event.data.status === 'completed') return true
  if (event.normalized?.type === 'status' && event.normalized.status === 'completed') return true
  if (sandboxEvent.type !== 'done' && sandboxEvent.type !== 'result') return false
  const data = sandboxEvent.data
  if (data.success === true) return true
  if (data.success === false) return false
  const outcome = recordValue(data.outcome)
  const result = recordValue(data.result)
  return [data.status, outcome?.type, outcome?.status, result?.status].some(
    (status) => typeof status === 'string' && TERMINAL_SUCCESS_STATUSES.has(status),
  )
}

/**
 * Holds a stream's failure frames until it ends, so the terminal frame decides the outcome.
 *
 * The sandbox outcome tracker latches the first `error` frame as the run's error and settles
 * `failed` on it whatever the terminal frame says; and until this ledger existed the runtime
 * only ever showed the tracker its failure frames, so a terminal `success: true` was never in
 * evidence at all. A transport error that the harness recovered from — a stream break the
 * sidecar re-attached, a tool backend that failed once — therefore settled the whole child
 * `down` with the transient error as its reason, and the artifact the child had banked was
 * discarded. On the 2026-09-20 fleet corpus, 25 children that finished their work settled that
 * way.
 *
 * The rule: `error` frames are forgiven when the stream reports success and carries no verdict;
 * a failed status or a failed terminal frame is the provider's own verdict on the run, and once
 * one exists every failure frame is evidence again, in order, so the tracker names the first
 * `error` as it always did. The existing contracts hold unchanged: `status: failed` then
 * `done: {}` is failed, and the retained Claude tail `completed → failed → error → done` is
 * failed with the error frame's message. The forgiven frames stay in the event archive the trace
 * reads; only the outcome stops claiming them.
 */
function createProviderFailureLedger(): {
  observe(event: AgentEnvironmentEvent, sandboxEvent: SandboxEvent): void
  finish(): AgentRunOutcome | undefined
} {
  const failures: SandboxEvent[] = []
  let verdicts = 0
  let succeeded = false
  return {
    observe(event, sandboxEvent) {
      const failureEvent = providerFailureEvent(event, sandboxEvent)
      if (failureEvent) {
        failures.push(failureEvent)
        if (failureEvent.type !== 'error') verdicts += 1
        return
      }
      if (providerTerminalSuccess(event, sandboxEvent)) succeeded = true
    },
    finish() {
      if (failures.length === 0 || (verdicts === 0 && succeeded)) return undefined
      const tracker = createAgentRunOutcomeTracker()
      for (const frame of failures) tracker.observe(frame)
      return tracker.finish()
    },
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function failureDetail(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined
  const error = value.error
  if (typeof error === 'string') return error
  const nestedError = recordValue(error)
  if (typeof nestedError?.message === 'string') return nestedError.message
  if (typeof value.message === 'string') return value.message
  return typeof value.detail === 'string' ? value.detail : undefined
}

/** Preserve the Sandbox outcome's numeric HTTP metadata across the provider adapter. */
function failureStatusCode(value: unknown): number | undefined {
  const statusCode = recordValue(value)?.statusCode
  return typeof statusCode === 'number' &&
    Number.isInteger(statusCode) &&
    statusCode >= 400 &&
    statusCode <= 599
    ? statusCode
    : undefined
}

function failureCode(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined
  const error = recordValue(value.error)
  return (
    stringValue(value.errorCode) ??
    stringValue(value.code) ??
    stringValue(error?.errorCode) ??
    stringValue(error?.code)
  )
}

function usageSandboxEvent(event: AgentEnvironmentEvent): SandboxEvent | undefined {
  const type = event.normalized?.type ?? event.type
  if (!event.usage || isUsageType(type) || isNestedUsageType(type) || type === 'done') {
    return undefined
  }
  const usage = tokenUsageData(event.usage)
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.totalCostUsd === undefined
  ) {
    return undefined
  }
  return {
    type: 'usage',
    data: {
      ...event.data,
      ...usage,
      ...('usageMode' in event
        ? { usageMode: event.usageMode }
        : event.data.usageMode === undefined
          ? {}
          : { usageMode: event.data.usageMode }),
    },
    ...(event.id ? { id: event.id } : {}),
  }
}

function sandboxDataFromNormalizedEvent(
  rawData: Record<string, unknown>,
  normalized: NonNullable<AgentEnvironmentEvent['normalized']>,
): Record<string, unknown> {
  const { type: _type, ...normalizedData } = normalized
  return {
    ...rawData,
    ...normalizedData,
    ...(normalized.type === 'message.part.updated' && normalized.part.type === 'text'
      ? { text: normalized.part.text }
      : {}),
  }
}

function tokenUsageData(usage: TokenUsage): Record<string, number> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage.cacheReadInputTokens !== undefined
      ? { cacheReadInputTokens: usage.cacheReadInputTokens }
      : {}),
    ...(usage.cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
      : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(usage.cost !== undefined ? { totalCostUsd: usage.cost } : {}),
  }
}

function turnInputFromPrompt(
  message: string | PromptInputPart[],
  options?: PromptOptions,
): AgentTurnInput {
  return {
    ...(typeof message === 'string' ? { prompt: message } : { parts: message }),
    ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options?.model ? { model: options.model } : {}),
    ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.executionId ? { executionId: options.executionId } : {}),
    ...(options?.lastEventId ? { lastEventId: options.lastEventId } : {}),
    ...(options?.turnId ? { turnId: options.turnId } : {}),
    ...(options?.detach !== undefined ? { detach: options.detach } : {}),
    ...(options?.context ? { context: options.context } : {}),
    ...(options?.runControlRef ? { controlRef: options.runControlRef } : {}),
    ...(options?.backend?.interactions ? { interactions: options.backend.interactions } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.backend ? { providerOptions: { backend: options.backend } } : {}),
  }
}

function resolveSessionControlRef(
  actual: AgentRunControlRef | undefined,
  expected: AgentRunControlRef | undefined,
  options: { allowExpectedWhenActualAbsent?: boolean } = {},
): AgentExactRunControlRef | undefined {
  if (expected === undefined) {
    if (actual === undefined) return undefined
    return AgentExactRunControlRefSchema.parse(actual)
  }
  const expectedExact = AgentExactRunControlRefSchema.parse(expected)
  if (actual === undefined) {
    if (options.allowExpectedWhenActualAbsent === true) return expectedExact
    throw new ValidationError('provider session omitted the required exact run control reference')
  }
  const actualExact = AgentExactRunControlRefSchema.safeParse(actual)
  if (!actualExact.success) {
    throw new ValidationError('provider session returned an invalid exact run control reference')
  }
  if (!sameControlCoordinates(actualExact.data, expectedExact)) {
    throw new ValidationError('provider session returned a different exact run control reference')
  }
  return actualExact.data
}

function assertInteractionCommandScope(
  command: InteractionResponseCommand,
  controlRef: AgentRunControlRef | undefined,
): void {
  if (controlRef === undefined) return
  // Keep the inner provider unchanged for the deployment's durable binding check.
  if (
    command.binding.runId !== controlRef.runId ||
    command.binding.environmentId !== controlRef.environmentId ||
    command.binding.sessionId !== controlRef.sessionId ||
    command.binding.executionId !== controlRef.executionId
  ) {
    throw new ValidationError('interaction response targeted a different execution')
  }
}

function assertCancellationScope(
  request: AgentRunCancellationRequest,
  controlRef: AgentExactRunControlRef | undefined,
): void {
  if (controlRef === undefined) {
    throw new ValidationError(
      'durable cancellation requires an exact wrapper run control reference',
    )
  }
  const exactRequest = AgentRunCancellationRequestSchema.parse(request)
  if (!sameControlCoordinates(exactRequest.run, controlRef)) {
    throw new ValidationError('cancellation targeted a different execution')
  }
}

function scopedExecutionId(
  controlRef: AgentRunControlRef | undefined,
  requested: string | undefined,
): string | undefined {
  if (
    controlRef?.executionId !== undefined &&
    requested !== undefined &&
    controlRef.executionId !== requested
  ) {
    throw new ValidationError('session operation targeted a different execution')
  }
  return controlRef?.executionId ?? requested
}

function assertScopedSessionForInput(session: AgentSession, input: AgentTurnInput): void {
  if (input.executionId === undefined && input.controlRef === undefined) return
  const sessionControlRef = AgentExactRunControlRefSchema.safeParse(session.controlRef)
  if (!sessionControlRef.success) {
    throw new ValidationError(
      'provider session did not expose an exact run control reference for scoped cancellation',
    )
  }
  const expectedControlRef =
    input.controlRef === undefined
      ? undefined
      : AgentExactRunControlRefSchema.parse(input.controlRef)
  if (
    (input.executionId !== undefined && sessionControlRef.data.executionId !== input.executionId) ||
    (expectedControlRef !== undefined &&
      !sameControlCoordinates(sessionControlRef.data, expectedControlRef))
  ) {
    throw new ValidationError('provider session returned a different exact run control reference')
  }
}

function taskToTurnInput(task: unknown, signal: AbortSignal): AgentTurnInput {
  return { prompt: taskToPrompt(task), signal }
}

function taskToPrompt(task: unknown): string {
  if (typeof task === 'string') return task
  if (task && typeof task === 'object') {
    const record = task as Record<string, unknown>
    for (const key of ['prompt', 'content', 'task', 'message']) {
      if (typeof record[key] === 'string') return record[key]
    }
  }
  return JSON.stringify(task)
}

/**
 * The archive one provider turn settles on, as `ProviderLeafOut` documents it. A superseded slot is
 * cleared when the superseding frame arrives, so a cumulative part holds one copy of its text no
 * matter how many frames restate it, and the kept events stay in streamed order.
 */
function createTurnEventArchive(): {
  append(event: AgentEnvironmentEvent): void
  events(): AgentEnvironmentEvent[]
  readonly superseded: number
} {
  const slots: Array<AgentEnvironmentEvent | undefined> = []
  const latestByPart = new Map<string, { index: number; text: string }>()
  let superseded = 0
  return {
    append(event) {
      const update = cumulativePartUpdate(event)
      if (update !== undefined) {
        const latest = latestByPart.get(update.key)
        if (latest !== undefined && update.text.startsWith(latest.text)) {
          slots[latest.index] = undefined
          superseded += 1
        }
        latestByPart.set(update.key, { index: slots.length, text: update.text })
      }
      slots.push(event)
    },
    events: () => slots.filter((event): event is AgentEnvironmentEvent => event !== undefined),
    get superseded() {
      return superseded
    },
  }
}

/** A text or reasoning part update's identity and whole text, read from the canonical event. */
function cumulativePartUpdate(
  event: AgentEnvironmentEvent,
): { key: string; text: string } | undefined {
  const normalized = event.normalized
  if (normalized?.type !== 'message.part.updated') return undefined
  const part = normalized.part
  if (part.type !== 'text' && part.type !== 'reasoning') return undefined
  if (typeof part.id !== 'string' || part.id.length === 0 || typeof part.text !== 'string') {
    return undefined
  }
  return { key: JSON.stringify([part.type, part.messageID, part.id]), text: part.text }
}

function resultFromEvents(events: AgentEnvironmentEvent[], fallbackText: string): ProviderLeafOut {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    const text = event ? resultTextFromData(event.data) : undefined
    if (text !== undefined) return { content: text, events }
  }
  return { content: fallbackText, events }
}

function textFromEnvironmentEvent(event: AgentEnvironmentEvent): string {
  if (
    typeof event.normalized === 'object' &&
    event.normalized &&
    event.normalized.type === 'message.part.updated'
  ) {
    return typeof event.normalized.delta === 'string' ? event.normalized.delta : ''
  }
  const data = event.data
  for (const key of ['delta', 'chunk', 'content', 'text']) {
    if (typeof data[key] === 'string' && !isTerminalEnvironmentEvent(event)) return data[key]
  }
  return ''
}

function resultTextFromData(data: Record<string, unknown>): string | undefined {
  for (const key of ['finalText', 'text', 'response', 'resultSummary', 'content']) {
    if (typeof data[key] === 'string') return data[key]
  }
  return undefined
}

function isTerminalEnvironmentEvent(event: AgentEnvironmentEvent): boolean {
  if (isTerminalEventShape(event.type, event.data)) return true
  const normalized = event.normalized
  return (
    normalized?.type === 'status' &&
    (normalized.status === 'completed' || normalized.status === 'failed')
  )
}

function isTerminalEventShape(type: string, data: Record<string, unknown>): boolean {
  if (type === 'error' || isSandboxTerminalEvent(type)) return true
  // A namespaced completion this provider transport may emit under any prefix. Broader than the
  // named sandbox list on purpose: an unknown `<x>.completed` still ends the stream.
  if (type.endsWith('.completed') || type.endsWith('.failed')) return true
  if (type !== 'status') return false
  return data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled'
}

function isUsageType(type: string): boolean {
  return type === 'llm_call' || type === 'usage' || type === 'cost.usage'
}

/** A terminal event whose usage rides `data.usage` — the nested shape this transport unwraps. */
function isNestedUsageType(type: string): boolean {
  return isSandboxTerminalEvent(type) && sandboxTerminalUsageField(type) === 'usage'
}

function mergeTokenUsage(
  left: TokenUsage | undefined,
  right: TokenUsage | undefined,
): TokenUsage | undefined {
  if (!left) return right
  if (!right) return left
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    ...(left.totalTokens !== undefined || right.totalTokens !== undefined
      ? { totalTokens: (left.totalTokens ?? 0) + (right.totalTokens ?? 0) }
      : {}),
    ...(left.cacheReadInputTokens !== undefined || right.cacheReadInputTokens !== undefined
      ? {
          cacheReadInputTokens:
            (left.cacheReadInputTokens ?? 0) + (right.cacheReadInputTokens ?? 0),
        }
      : {}),
    ...(left.cacheCreationInputTokens !== undefined || right.cacheCreationInputTokens !== undefined
      ? {
          cacheCreationInputTokens:
            (left.cacheCreationInputTokens ?? 0) + (right.cacheCreationInputTokens ?? 0),
        }
      : {}),
    ...(left.reasoningTokens !== undefined || right.reasoningTokens !== undefined
      ? { reasoningTokens: (left.reasoningTokens ?? 0) + (right.reasoningTokens ?? 0) }
      : {}),
    ...(left.cost !== undefined || right.cost !== undefined
      ? { cost: (left.cost ?? 0) + (right.cost ?? 0) }
      : {}),
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function sandboxDispatchResultFromSessionRef(session: AgentSessionRef): Record<string, unknown> {
  const controlRef =
    session.controlRef === undefined
      ? undefined
      : AgentExactRunControlRefSchema.parse(session.controlRef)
  const metadataExecutionId = optionalDispatchIdentity(session.metadata?.executionId, 'executionId')
  if (controlRef !== undefined) {
    if (controlRef.sessionId !== session.id) {
      throw new ValidationError(
        'provider dispatch returned a control reference for another session',
      )
    }
    if (session.provider !== undefined && controlRef.provider !== session.provider) {
      throw new ValidationError(
        'provider dispatch returned a control reference for another provider',
      )
    }
    if (metadataExecutionId !== undefined && metadataExecutionId !== controlRef.executionId) {
      throw new ValidationError('provider dispatch returned conflicting execution identities')
    }
  }
  const hasStatus = session.metadata && Object.hasOwn(session.metadata, 'status')
  const status = hasStatus ? sessionStatusFromUnknown(session.metadata?.status) : 'running'
  return {
    sessionId: session.id,
    status,
    alreadyExisted: session.metadata?.alreadyExisted === true,
    ...(session.metadata?.dispatched === undefined
      ? {}
      : { dispatched: session.metadata.dispatched === true }),
    ...(controlRef === undefined
      ? metadataExecutionId === undefined
        ? {}
        : { executionId: metadataExecutionId }
      : { executionId: controlRef.executionId, runControlRef: controlRef }),
  }
}

function optionalDispatchIdentity(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`sandbox dispatch returned an invalid ${label}`)
  }
  return value
}

function statusFromUnknown(status: unknown): AgentEnvironmentStatus {
  if (status === 'pending' || status === 'provisioning' || status === 'running') return status
  if (status === 'stopped' || status === 'failed' || status === 'expired') return status
  if (status === 'completed') return 'stopped'
  if (status === 'cancelled') return 'stopped'
  return 'unknown'
}

function sessionStatusFromUnknown(status: unknown): AgentSessionStatus | null {
  if (status === 'completed' || status === 'cancelled') return status
  return statusFromUnknown(status)
}

function contentRef(prefix: string, value: unknown): string {
  let str: string
  try {
    str = JSON.stringify(value) ?? String(value)
  } catch {
    str = String(value)
  }
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

interface SandboxSessionLike {
  readonly id: string
  readonly controlRef?: AgentRunControlRef
  status(): Promise<unknown | null>
  events(options?: {
    since?: string
    executionId?: string
    signal?: AbortSignal
  }): AsyncIterable<SandboxEvent>
  result(options?: { executionId?: string }): Promise<PromptResult>
  prompt(message: string | PromptInputPart[], options?: PromptOptions): Promise<PromptResult>
  respondToInteraction?(
    command: InteractionResponseCommand,
    options?: { signal?: AbortSignal },
  ): Promise<{ acknowledgement: InteractionAcknowledgement }>
  cancelRun?(
    request: AgentRunCancellationRequest,
    options?: { signal?: AbortSignal },
  ): Promise<AgentRunCancellationAcknowledgement>
  interrupt(options?: { executionId?: string }): Promise<unknown>
}
