import { agentProfileSchema, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import { RuntimeRunStateError, ValidationError } from '../../errors'
import { COORDINATION_CLIENT_TOOL_TIMEOUT_MS } from '../../mcp/tools/coordination-request-context'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import { addSpend as addRetainedSpend, unmeteredSpend, zeroSpend } from '../util'
import { meterUsageEvent, newUsageTotals, spendFromUsageTotals } from './budget'
import { DEFAULT_SUCCESSFUL_SHUTDOWN_MS, teardownExecutor } from './deadline'
import { HarnessTurnFailedError } from './driver-retry'
import { errMessage } from './error-message'
import { executorFailure } from './executor-outcome'
import {
  providerAttemptEvidence,
  recordRuntimeOwnedDriveHarnessProviderEvidence,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedExecutorProviderEvidence,
  runtimeOwnedPendingExecutorMaterialization,
} from './materialization'
import { assertExecutableAgentProfile } from './model-policy'
import { addResourceSpend, resourceTelemetry, withBudgetResources } from './resources'
import { retainedExecutorSeamKey } from './retained-executor'
import {
  beginScopeRetainedOwnerDrive,
  type scopeRetainedOwnerContext,
  scopeRetainedOwnerPriorSpend,
} from './retained-scope-owner'
import type { RootStreamSink } from './root-stream'
import {
  bindReusableExecutorExecutionId,
  bridgeRuntimeAttachmentsKey,
  bridgeStopSignalKey,
  createExecutor,
} from './runtime'
import {
  meterRuntimeOwnedAccounting,
  meterRuntimeOwnedProviderAttempt,
  noteScopeOwnerPlannedExecution,
  recordScopeOwnerMaterialization,
  scopeOwnerExecutorNodeContext,
} from './scope'
import { type ActiveSeat, seatExecutionProfile } from './seat-chain'
import { detachedSnapshot } from './snapshot'
import { exhaustedBudgetChannels, unmeteredOwnerCache } from './supervise-budget'
import type { DriverSessionState } from './supervise-driver-session'
import { externalExecutionId } from './supervise-identity'
import {
  assertBackendProfileMaterialization,
  assertBridgeProfileMaterializes,
} from './supervise-profile-admission'
import {
  CLAUDE_CODE_ONE_HOUR_CACHE,
  peerMailMcpAlias,
  peerMailRuntimeAttachment,
  providerAcceptsCoordinationAttachments,
} from './supervise-runtime-attachments'
import {
  assertNoReservedCoordinationMcpAlias,
  coordinationMcpAlias,
  type DriveHarness,
  providerVisibleProfile,
} from './supervisor-agent'
import type {
  AgentSpec,
  ExecutorExecutionBinding,
  ExecutorFactory,
  ExecutorMaterialization,
  ExecutorProgressEvent,
  ExecutorResult,
  ProviderModelAttemptEvidence,
  ProviderModelExecutionEvidence,
  Spend,
  UsageEvent,
} from './types'

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function'
  )
}

interface DriverAttemptInput
  extends Pick<
    Parameters<DriveHarness>[0],
    | 'profile'
    | 'authoredProfile'
    | 'registeredProfile'
    | 'scope'
    | 'coordinationMcpUrl'
    | 'coordinationMcpHeaders'
    | 'peerMailUrl'
    | 'stopSignal'
    | 'coordinationTools'
    | 'session'
    | 'reentry'
    | 'onModelEvent'
  > {
  readonly state: DriverSessionState
  readonly retainedOwner: ReturnType<typeof scopeRetainedOwnerContext>
  readonly originalTask: unknown
  readonly activeSeat: ActiveSeat | undefined
  readonly baseFactory: ExecutorFactory<unknown>
  readonly executionId: string
  readonly now: () => number
  readonly turnCap: number
  readonly rootStream: RootStreamSink | undefined
  readonly keepTranscript: (capture: HarnessTranscriptCapture | undefined) => void
  readonly noteDriveProgress: (event: ExecutorProgressEvent) => void
  readonly drive: DriveHarness
}

export async function executeDriverAttempt({
  state,
  profile,
  authoredProfile,
  registeredProfile,
  scope,
  coordinationMcpUrl,
  coordinationMcpHeaders,
  peerMailUrl,
  stopSignal,
  coordinationTools,
  session,
  reentry,
  onModelEvent,
  retainedOwner,
  originalTask,
  activeSeat,
  baseFactory,
  executionId,
  now,
  turnCap,
  rootStream,
  keepTranscript,
  noteDriveProgress,
  drive,
}: DriverAttemptInput): Promise<void> {
  const initialBudget = scope.budget
  const hasLiveCoordination = scope.view.inFlight > 0
  if (!hasLiveCoordination) {
    const spent = [
      exhaustedBudgetChannels(initialBudget, now()),
      initialBudget.iterationsLeft <= 0 ? 'iterations: none left' : undefined,
    ]
      .filter((channel) => channel !== undefined)
      .join('; ')
    if (spent !== '')
      throw new ValidationError(`driveHarnessFromBackend: supervisor budget exhausted (${spent})`)
  }
  // `supervise` passes a canonical profile plus its provider projection. Parse both at this
  // boundary and prove the projection still matches the exact descriptors mounted for this turn.
  const canonicalDriverProfile = agentProfileSchema.parse(authoredProfile)
  assertNoReservedCoordinationMcpAlias(canonicalDriverProfile, 'driveHarnessFromBackend')
  const stableCoordinationTools = detachedSnapshot(
    coordinationTools,
    'driveHarnessFromBackend coordination tools',
  )
  const expectedProviderProfile = providerVisibleProfile(
    activeSeat
      ? seatExecutionProfile(canonicalDriverProfile, activeSeat.stage)
      : canonicalDriverProfile,
  )
  if (activeSeat) {
    assertExecutableAgentProfile(expectedProviderProfile, 'selected seat')
    assertBackendProfileMaterialization(
      expectedProviderProfile,
      state.boundBackend,
      'selected seat',
    )
    assertBridgeProfileMaterializes(expectedProviderProfile, state.boundBackend, 'selected seat')
  }
  const providerDriverProfile = activeSeat
    ? expectedProviderProfile
    : agentProfileSchema.parse(profile)
  if (
    canonicalAgentProfileDigest(providerDriverProfile) !==
    canonicalAgentProfileDigest(expectedProviderProfile)
  ) {
    throw new ValidationError(
      'driveHarnessFromBackend: supervisor passed a provider profile that does not match its canonical profile and mounted coordination tools',
    )
  }
  // The authored profile travels unchanged. The coordination server is a Runtime-owned
  // attachment: it rides the executor's attachment seam, so a resumed run that rebinds the
  // port keeps the profile digest a durable bridge session is bound to.
  const spec: AgentSpec = {
    profile: providerDriverProfile,
    harness:
      state.boundBackend.backend === 'sandbox'
        ? (providerDriverProfile.harness as BackendType)
        : null,
  }
  // The turn cap rides the SAME stop lever the coordination stop uses: the harness runs its own
  // loop, so the only honest bound is "stop at the next turn boundary". Composing the two
  // signals keeps one lever rather than a second stop path.
  const turnStop = turnCap > 0 ? new AbortController() : undefined
  // A metered turn found past its budget ends the drive at the turn boundary, on the same lever,
  // and the turn's committed result stands.
  const budgetStop = new AbortController()
  const effectiveStopSignal = AbortSignal.any(
    [stopSignal, turnStop?.signal, budgetStop.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    ),
  )
  // The harness is asked for a 300 s tool-call timeout so a fenced tool can hold its response
  // longer than the 60 s harness default; a sidecar that applies it says so on each request.
  const peerMailAttachment = peerMailRuntimeAttachment(authoredProfile, state.boundBackend, {
    peerMailUrl,
  })
  const attachment = {
    transport: 'http' as const,
    url: coordinationMcpUrl,
    ...(coordinationMcpHeaders ? { headers: coordinationMcpHeaders } : {}),
    metadata: { toolTimeoutMs: COORDINATION_CLIENT_TOOL_TIMEOUT_MS },
  }
  // A bridge keys the harness conversation by session id. A fresh re-entry binds a new one,
  // derived from the owner's attempt id, which is new for every re-entry and every process.
  let factory =
    session === 'fresh' && reentry !== undefined && state.boundBackend.backend === 'bridge'
      ? createExecutor(
          bindReusableExecutorExecutionId(
            state.boundBackend,
            externalExecutionId('supervised-manager-session', {
              sessionId: state.boundBackend.sessionId ?? executionId,
              attemptId: scopeOwnerExecutorNodeContext(scope).attemptId,
            }),
          ),
        )
      : baseFactory
  if (state.boundBackend.backend === 'provider') {
    const credentialName = 'AGENT_RUNTIME_COORDINATION_TOKEN'
    const authorization = coordinationMcpHeaders?.Authorization
    if (!authorization?.startsWith('Bearer ')) {
      throw new ValidationError(
        'driveHarnessFromBackend: provider coordination requires a bearer credential',
      )
    }
    if (Object.hasOwn(state.boundBackend.defaults?.env ?? {}, credentialName)) {
      throw new ValidationError(
        'driveHarnessFromBackend: provider defaults contain the reserved coordination credential name',
      )
    }
    if (
      Object.hasOwn(
        state.boundBackend.defaults?.runtimeAttachments?.mcp ?? {},
        coordinationMcpAlias,
      )
    ) {
      throw new ValidationError(
        'driveHarnessFromBackend: provider defaults contain the reserved coordination attachment alias',
      )
    }
    if (
      peerMailUrl &&
      Object.hasOwn(state.boundBackend.defaults?.runtimeAttachments?.mcp ?? {}, peerMailMcpAlias)
    ) {
      throw new ValidationError(
        'driveHarnessFromBackend: provider defaults contain the reserved peer-mail attachment alias',
      )
    }
    if (!(await providerAcceptsCoordinationAttachments(state.boundBackend))) {
      throw new ValidationError(
        'driveHarnessFromBackend: provider does not advertise create.runtimeAttachments.mcp; no environment was created',
      )
    }
    factory = createExecutor({
      ...state.boundBackend,
      defaults: {
        ...(state.boundBackend.defaults ?? {}),
        env: {
          ...(providerDriverProfile.harness === 'claude-code'
            ? { [CLAUDE_CODE_ONE_HOUR_CACHE]: '1' }
            : {}),
          ...(state.boundBackend.defaults?.env ?? {}),
          [credentialName]: authorization.slice(7),
        },
        runtimeAttachments: {
          mcp: {
            ...(state.boundBackend.defaults?.runtimeAttachments?.mcp ?? {}),
            ...(peerMailUrl
              ? { [peerMailMcpAlias]: { transport: 'http' as const, url: peerMailUrl } }
              : {}),
            [coordinationMcpAlias]: {
              transport: 'http',
              url: coordinationMcpUrl,
              headers: {
                Authorization: { kind: 'secret-ref', key: credentialName, format: 'bearer' },
              },
              metadata: { toolTimeoutMs: COORDINATION_CLIENT_TOOL_TIMEOUT_MS },
            },
          },
        },
      },
    })
  }
  const executor = factory(spec, {
    signal: scope.signal,
    node: scopeOwnerExecutorNodeContext(scope),
    seams: {
      ...(retainedOwner
        ? {
            [retainedExecutorSeamKey]: {
              ...retainedOwner,
              onResult: async (result: ExecutorResult<unknown>) => commitOwnerResult(result),
            },
          }
        : {}),
      ...(effectiveStopSignal === undefined ? {} : { [bridgeStopSignalKey]: effectiveStopSignal }),
      [bridgeRuntimeAttachmentsKey]: {
        ...(peerMailAttachment ?? {}),
        [coordinationMcpAlias]: attachment,
      },
    },
  })
  // The attempt this one replaces may have captured since it returned.
  keepTranscript(state.lastExecutor?.harnessTranscript?.())
  state.activeExecutor = executor
  state.lastExecutor = executor
  let completed = false
  let started = false
  let terminalAccountingCaptured = false
  let pendingUsage: UsageEvent[] = []
  const ownerUsage = newUsageTotals()
  let observedOwnerSpend = zeroSpend()
  let committedOwnerSpend = retainedOwner ? await scopeRetainedOwnerPriorSpend(scope) : zeroSpend()
  const ownerDelta = (total: Spend, committed = committedOwnerSpend): Spend => ({
    ...addResourceSpend(
      total.resources === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(total.resources).map(([name, value]) => {
              const prior = committed.resources?.[name]
              if (prior && prior.unit !== value.unit)
                throw new ValidationError(`resource ${name}: unit mismatch`)
              return [
                name,
                {
                  ...value,
                  amount: Math.max(0, value.amount - (prior?.amount ?? 0)),
                  known: value.known && (prior?.known ?? true),
                },
              ]
            }),
          ),
    ),
    iterations: Math.max(0, total.iterations - committed.iterations),
    tokens: {
      input: Math.max(0, total.tokens.input - committed.tokens.input),
      output: Math.max(0, total.tokens.output - committed.tokens.output),
      ...unmeteredOwnerCache(total.tokens, committed.tokens),
    },
    usd: Math.max(0, total.usd - committed.usd),
    ...(total.usdEstimated === undefined
      ? {}
      : {
          usdEstimated: Math.min(
            Math.max(0, total.usd - committed.usd),
            Math.max(0, total.usdEstimated - (committed.usdEstimated ?? 0)),
          ),
        }),
    ...(total.tokensProvenance === undefined ? {} : { tokensProvenance: total.tokensProvenance }),
    ms: Math.max(0, total.ms - committed.ms),
    ...(total.tokensKnown === false ? { tokensKnown: false } : {}),
    ...(total.usdKnown === false ? { usdKnown: false } : {}),
  })
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
  // A turn that completed and is found past its budget ends the drive at the turn boundary
  // (`budgetStop`); its committed result stands, and the scope records the overspend on the
  // node, which the manager's wake names. Throwing here discarded a turn that had already run and
  // been paid for: the Lab's limits audit counted 28 worker turns (26.77 turn-hours) metered,
  // found over their cap or deadline, and thrown away, e.g. on queens21-h22-capture-root-2-20261019c.
  const meterPending = async (forceUnknown = false) => {
    if (pendingUsage.length === 0) return
    // A forceful steer can finish one preflight attempt before the resumed turn produces usage.
    // Consume those explicit no-dispatch attempts first, so the paid batch keeps its own served
    // identity instead of inheriting the oldest positional evidence.
    for (;;) {
      const evidence = runtimeOwnedExecutorProviderEvidence(executor)
      const next = evidence?.attempts[meteredProviderAttempts]
      if (next?.providerDispatch !== 'not_started') break
      await meterRuntimeOwnedProviderAttempt(scope, zeroSpend(), providerEvidenceForNextMeter(), {
        role: 'driver',
        runtime: executor.runtime,
        telemetry: 'known-zero-before-dispatch',
      })
    }
    const batch = pendingUsage
    pendingUsage = []
    for (const event of batch) meterUsageEvent(ownerUsage, event)
    const measured = spendFromUsageTotals(ownerUsage)
    const charge = ownerDelta(measured, retainedOwner ? committedOwnerSpend : observedOwnerSpend)
    // The next additive receipt mutates ownerUsage.tokens, not this already-metered baseline.
    observedOwnerSpend = detachedSnapshot(measured, 'metered owner spend')
    await meterRuntimeOwnedProviderAttempt(
      scope,
      forceUnknown
        ? {
            ...charge,
            tokensKnown: false,
            usdKnown: false,
          }
        : charge,
      providerEvidenceForNextMeter(),
      {
        role: 'driver',
        runtime: executor.runtime,
      },
    )
    if (retainedOwner) committedOwnerSpend = addRetainedSpend(committedOwnerSpend, charge)
    // The check stops a driver that would run on past its budget or deadline. A stopped manager
    // is already ending this turn, and throwing here would discard the result it committed.
    if (effectiveStopSignal?.aborted === true) return
    const spent = exhaustedBudgetChannels(scope.budget, now())
    if (spent === undefined) return
    budgetStop.abort(`supervise: budget exhausted (${spent})`)
  }

  const pending = runtimeOwnedPendingExecutorMaterialization(executor)
  let failed = false
  let failure: unknown
  // Set when the turn reached its terminal result and that result reported failure. The turn
  // still COMPLETED: its accounting and materialization are captured and its environment is
  // released exactly as a successful turn's is. Only after that does it become a driver failure.
  let turnFailure: HarnessTurnFailedError | undefined
  let terminalArtifact: ExecutorResult<unknown> | undefined
  let ownerMaterializationPublished = false
  const ownerDeclaration = (
    exactDeclaration: ExecutorMaterialization,
  ): ExecutorMaterialization => ({
    ...exactDeclaration,
    // The provider sees the projected profile while the receipt remains bound to the canonical
    // profile that authorized Runtime coordination: the registered one, across every segment of the run.
    authoredProfile:
      registeredProfile === undefined
        ? canonicalDriverProfile
        : agentProfileSchema.parse(registeredProfile),
    effectiveProfile: providerDriverProfile,
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
  const commitOwnerResult = async (result: ExecutorResult<unknown>) => {
    const declaration = runtimeOwnedExecutorMaterialization(executor)
    const binding = runtimeOwnedExecutorExecutionBinding(executor)
    if (!declaration || !binding) {
      throw new ValidationError(
        'retained owner result requires terminal materialization before release',
      )
    }
    if (!ownerMaterializationPublished) {
      await publishMaterialization(declaration, binding)
      ownerMaterializationPublished = true
    }
    await meterPending()
    const total = withBudgetResources(
      { ...result.spent, ...resourceTelemetry(observedOwnerSpend, result.spent), iterations: 0 },
      scope.budget,
    )
    const delta = ownerDelta(total)
    await meterRuntimeOwnedAccounting(scope, delta, { role: 'driver', runtime: executor.runtime })
    committedOwnerSpend = addRetainedSpend(committedOwnerSpend, delta)
    await retainedOwner!.onResult(result)
    terminalAccountingCaptured = true
  }
  // The owner's release waits for this drive to end its turn, so it reads the turn's receipt.
  const endDrive = retainedOwner ? beginScopeRetainedOwnerDrive(scope) : () => {}
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
        canonicalAgentProfileDigest(providerDriverProfile)
      ) {
        throw new ValidationError(
          'driveHarnessFromBackend: pending executor changed the provider-visible AgentProfile before execution',
        )
      }
      noteScopeOwnerPlannedExecution(scope, pending.declaration.execution)
    } else {
      await publishMaterialization(declaration!, executionBinding!)
      ownerMaterializationPublished = true
    }
    if (executor.budgetExempt) {
      throw new ValidationError(
        `driveHarnessFromBackend: runtime ${JSON.stringify(executor.runtime)} does not report usage and cannot drive a budgeted supervisor`,
      )
    }

    started = true
    // A coordination completion stops the NEXT external turn. The active bridge request must
    // drain so its served model and terminal materialization remain valid evidence.
    if (retainedOwner?.admissions.length && !executor.recover) {
      throw new ValidationError('retained owner executor does not support recovery')
    }
    // The stream file opens at the first attempt that actually runs an executor, so a resumed
    // owner whose accepted result was restored above leaves it untouched.
    await rootStream?.beginAttempt()
    const run = retainedOwner?.admissions.length
      ? executor.recover!(originalTask, scope.signal)
      : executor.execute(originalTask, scope.signal)
    if (isAsyncIterable<UsageEvent>(run)) {
      let turns = 0
      for await (const event of run) {
        if (event.kind === 'iteration') {
          await meterPending()
          turns += 1
          state.driveTurns += 1
          if (turnStop !== undefined && turns >= turnCap && !turnStop.signal.aborted) {
            turnStop.abort(`supervise: maxTurns ${turnCap} reached`)
          }
        } else if (event.kind === 'progress') {
          // A progress event carries the driver's observed output, never accounting: it is
          // retained in the run directory as it arrives and never reaches a meter.
          rootStream?.append(event.progress)
          noteDriveProgress(event.progress)
          onModelEvent?.()
        } else {
          pendingUsage.push(event)
        }
      }
      await meterPending()
      // `resultArtifact()` is typed without the envelope outcome; scope's child settlement reads
      // the same artifact through the same widening.
      const artifact = executor.resultArtifact() as ExecutorResult<unknown>
      terminalArtifact = artifact
      const terminalResources = withBudgetResources(
        { ...artifact.spent, ...resourceTelemetry(observedOwnerSpend, artifact.spent) },
        scope.budget,
      ).resources
      const resourceCorrection = addResourceSpend(
        terminalResources === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(terminalResources).map(([name, value]) => [
                name,
                {
                  ...value,
                  amount: Math.max(
                    0,
                    value.amount - (observedOwnerSpend.resources?.[name]?.amount ?? 0),
                  ),
                },
              ]),
            ),
      )
      // A stream carries increments, while its terminal artifact says whether either accounting
      // channel was omitted. Preserve unknowns in the shared pool instead of treating them as 0.
      if (
        !retainedOwner &&
        (artifact.spent.tokensKnown === false ||
          artifact.spent.usdKnown === false ||
          resourceCorrection.resources !== undefined)
      ) {
        await meterRuntimeOwnedAccounting(
          scope,
          {
            ...resourceCorrection,
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
      terminalAccountingCaptured = true
      const reported = executorFailure(artifact)
      if (reported !== undefined)
        turnFailure = new HarnessTurnFailedError(executor.runtime, reported)
    } else {
      const artifact = await run
      terminalArtifact = artifact
      await meterRuntimeOwnedProviderAttempt(
        scope,
        withBudgetResources({ ...artifact.spent, iterations: 0 }, scope.budget),
        providerEvidenceForNextMeter(),
        { role: 'driver', runtime: executor.runtime },
      )
      terminalAccountingCaptured = true
      const reported = executorFailure(artifact)
      if (reported !== undefined)
        turnFailure = new HarnessTurnFailedError(executor.runtime, reported)
    }
    if (pending !== undefined && !ownerMaterializationPublished) {
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
          const evidence = runtimeOwnedExecutorProviderEvidence(executor)
          const attempts = evidence?.attempts.length ?? 0
          if (attempts <= meteredProviderAttempts) break
          const providerDispatchDidNotStart =
            evidence?.attempts[meteredProviderAttempts]?.providerDispatch === 'not_started'
          await meterRuntimeOwnedProviderAttempt(
            scope,
            withBudgetResources(
              providerDispatchDidNotStart ? zeroSpend() : unmeteredSpend(0),
              scope.budget,
              providerDispatchDidNotStart,
            ),
            providerEvidenceForNextMeter(),
            {
              role: 'driver',
              runtime: executor.runtime,
              telemetry: providerDispatchDidNotStart
                ? 'known-zero-before-dispatch'
                : 'unknown-after-failure',
            },
          )
        }
        if (meteredProviderAttempts === 0) {
          await meterRuntimeOwnedProviderAttempt(
            scope,
            withBudgetResources(unmeteredSpend(0), scope.budget),
            providerEvidenceForNextMeter(),
            { role: 'driver', runtime: executor.runtime, telemetry: 'unknown-after-failure' },
          )
        }
        // Increments cannot prove the final resource total after an interrupted invocation.
        const attempts = runtimeOwnedExecutorProviderEvidence(executor)?.attempts
        const provenNotStarted =
          attempts !== undefined &&
          attempts.length > 0 &&
          attempts.every((attempt) => attempt.providerDispatch === 'not_started')
        if (scope.budget.resources !== undefined && !provenNotStarted) {
          await meterRuntimeOwnedAccounting(scope, withBudgetResources(zeroSpend(), scope.budget), {
            role: 'driver',
            runtime: executor.runtime,
            telemetry: 'unknown-after-failure',
          })
        }
      } catch (error) {
        // The pool can reject before updating its readout. Preserve the provider diagnosis,
        // but keep failed accounting terminal even when the original failure was transient.
        failure = new RuntimeRunStateError(
          `${errMessage(failure)}; accounting failed: ${errMessage(error)}`,
          { cause: failure },
        )
      }
    }
    try {
      if (!retainedOwner?.preserveEnvironment || retainedOwner.admissions.length === 0) {
        await teardownOnce(completed ? DEFAULT_SUCCESSFUL_SHUTDOWN_MS : 'brutalKill')
      }
    } catch (error) {
      if (!failed) {
        failed = true
        failure = error
      }
    }
    // The provider executor reads the session store at the end of its stream, before any
    // teardown. A later attempt in the same environment reads that store again, longer.
    keepTranscript(executor.harnessTranscript?.())
    if (state.activeExecutor === executor) state.activeExecutor = undefined
    endDrive()
  }
  if (failed) throw failure
  if (turnFailure !== undefined) {
    state.managerArtifact = terminalArtifact
    throw turnFailure
  }
  state.managerArtifact = terminalArtifact
}
