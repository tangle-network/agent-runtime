import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import { RuntimeRunStateError, ValidationError } from '../../errors'
import { addSpend as addRetainedSpend, unmeteredSpend, zeroSpend } from '../util'
import { DEFAULT_SUCCESSFUL_SHUTDOWN_MS, teardownExecutor } from './deadline'
import { HarnessTurnFailedError } from './driver-attempt-evidence'
import { errMessage } from './error-message'
import { executorFailure } from './executor-outcome'
import {
  providerAttemptEvidence,
  recordRuntimeOwnedDriveHarnessProviderEvidence,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedExecutorProviderEvidence,
  type runtimeOwnedPendingExecutorMaterialization,
} from './materialization'
import { addResourceSpend, resourceTelemetry, withBudgetResources } from './resources'
import type { scopeRetainedOwnerContext } from './retained-scope-owner'
import type { RootStreamSink } from './root-stream'
import {
  meterRuntimeOwnedAccounting,
  meterRuntimeOwnedProviderAttempt,
  noteScopeOwnerPlannedExecution,
  recordScopeOwnerMaterialization,
  scopeOwnerExecutorNodeContext,
} from './scope'
import { detachedSnapshot } from './snapshot'
import { exhaustedBudgetChannels, unmeteredOwnerCache } from './supervise-budget'
import type { DriverSessionState } from './supervise-driver-session'
import { coordinationMcpAlias, type DriveHarness } from './supervisor-agent'
import type {
  Executor,
  ExecutorExecutionBinding,
  ExecutorMaterialization,
  ExecutorProgressEvent,
  ExecutorResult,
  ProviderModelAttemptEvidence,
  ProviderModelExecutionEvidence,
  Scope,
  Spend,
  UsageEvent,
} from './types'
import { meterUsageEvent, newUsageTotals, spendFromUsageTotals } from './usage-metering'

type DriveHarnessArgs = Parameters<DriveHarness>[0]
type RetainedOwner = NonNullable<ReturnType<typeof scopeRetainedOwnerContext>>
type PendingMaterialization = ReturnType<typeof runtimeOwnedPendingExecutorMaterialization>

/** The canonical identity a driver attempt's materialization receipt is bound to. */
export interface DriverAttemptIdentity {
  readonly registeredProfile: DriveHarnessArgs['registeredProfile']
  readonly canonicalProfile: AgentProfile
  /** The projection the provider sees. */
  readonly providerProfile: AgentProfile
  readonly coordinationTools: DriveHarnessArgs['coordinationTools']
  readonly coordinationMcpUrl: string
}

/** The two levers that end a driver's drive at the next turn boundary. */
interface DriverAttemptStops {
  /** Every stop composed: coordination completion, turn cap, and budget. */
  readonly signal: AbortSignal
  readonly turnStop: AbortController | undefined
  readonly budgetStop: AbortController
}

/** Where a streamed drive reports its turns and observed output. */
interface DriverTurnSink {
  readonly state: DriverSessionState
  readonly turnCap: number
  readonly rootStream: RootStreamSink | undefined
  readonly noteDriveProgress: (event: ExecutorProgressEvent) => void
  readonly onModelEvent?: () => void
}

/** The failure a terminal artifact reports, as the error a failed harness turn raises. */
export function harnessTurnFailure(
  runtime: string,
  artifact: ExecutorResult<unknown>,
): HarnessTurnFailedError | undefined {
  const reported = executorFailure(artifact)
  return reported === undefined ? undefined : new HarnessTurnFailedError(runtime, reported)
}

/** What `total` adds over the spend an owner already committed, channel by channel. */
function ownerSpendDelta(total: Spend, committed: Spend): Spend {
  return {
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
  }
}

/** The served-model evidence one provider attempt proves, frozen for the meter. */
function providerModelEvidence(
  attempt: ProviderModelAttemptEvidence | undefined,
): ProviderModelExecutionEvidence {
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

/**
 * One driver attempt's settle-once state: its metering against the manager's scope, its
 * materialization receipt, and its teardown. Every exit of `executeDriverAttempt` reads and
 * writes this owner, so each piece of evidence is captured once whichever arm ends the attempt.
 */
export class DriverExecutionAttempt {
  /** The executor was invoked. */
  started = false
  /** The executor reached its terminal result and its receipt was published. */
  completed = false
  terminalAccountingCaptured = false
  failed = false
  failure: unknown
  /** Set when the turn reached its terminal result and that result reported failure. The turn
   *  still COMPLETED: its accounting and materialization are captured and its environment is
   *  released exactly as a successful turn's is. Only after that does it become a driver failure. */
  turnFailure: HarnessTurnFailedError | undefined
  terminalArtifact: ExecutorResult<unknown> | undefined
  private materializationPublished = false
  private pendingUsage: UsageEvent[] = []
  private readonly ownerUsage = newUsageTotals()
  private observedOwnerSpend = zeroSpend()
  private meteredProviderAttempts = 0
  private readonly deadlineAtMs: number | undefined

  constructor(
    private readonly scope: Scope<unknown>,
    readonly executor: Executor<unknown>,
    private readonly identity: DriverAttemptIdentity,
    private readonly retainedOwner: RetainedOwner | undefined,
    private committedOwnerSpend: Spend,
    private readonly stops: DriverAttemptStops,
    private readonly now: () => number,
  ) {
    this.deadlineAtMs = scope.budget.deadlineMs || undefined
  }

  /** Keep the first failure; a later one never replaces its diagnostic. */
  noteFailure(error: unknown): void {
    if (!this.failed) {
      this.failed = true
      this.failure = error
    }
  }

  private nextProviderEvidence(): ProviderModelExecutionEvidence {
    const evidence = runtimeOwnedExecutorProviderEvidence(this.executor)
    return providerModelEvidence(evidence?.attempts[this.meteredProviderAttempts++])
  }

  // A turn that completed and is found past its budget ends the drive at the turn boundary
  // (`budgetStop`); its committed result stands, and the scope records the overspend on the
  // node, which the manager's wake names. Throwing here discarded a turn that had already run and
  // been paid for: the Lab's limits audit counted 28 worker turns (26.77 turn-hours) metered,
  // found over their cap or deadline, and thrown away, e.g. on queens21-h22-capture-root-2-20261019c.
  async meterPending(forceUnknown = false): Promise<void> {
    if (this.pendingUsage.length === 0) return
    const { scope, executor } = this
    // A forceful steer can finish one preflight attempt before the resumed turn produces usage.
    // Consume those explicit no-dispatch attempts first, so the paid batch keeps its own served
    // identity instead of inheriting the oldest positional evidence.
    for (;;) {
      const evidence = runtimeOwnedExecutorProviderEvidence(executor)
      const next = evidence?.attempts[this.meteredProviderAttempts]
      if (next?.providerDispatch !== 'not_started') break
      await meterRuntimeOwnedProviderAttempt(scope, zeroSpend(), this.nextProviderEvidence(), {
        role: 'driver',
        runtime: executor.runtime,
        telemetry: 'known-zero-before-dispatch',
      })
    }
    const batch = this.pendingUsage
    this.pendingUsage = []
    for (const event of batch) meterUsageEvent(this.ownerUsage, event)
    const measured = spendFromUsageTotals(this.ownerUsage)
    const charge = ownerSpendDelta(
      measured,
      this.retainedOwner ? this.committedOwnerSpend : this.observedOwnerSpend,
    )
    // The next additive receipt mutates ownerUsage.tokens, not this already-metered baseline.
    this.observedOwnerSpend = detachedSnapshot(measured, 'metered owner spend')
    await meterRuntimeOwnedProviderAttempt(
      scope,
      forceUnknown ? { ...charge, tokensKnown: false, usdKnown: false } : charge,
      this.nextProviderEvidence(),
      { role: 'driver', runtime: executor.runtime },
    )
    if (this.retainedOwner)
      this.committedOwnerSpend = addRetainedSpend(this.committedOwnerSpend, charge)
    // The check stops a driver that would run on past its budget or deadline. A stopped manager
    // is already ending this turn, and throwing here would discard the result it committed.
    if (this.stops.signal.aborted) return
    const spent = exhaustedBudgetChannels(scope.budget, this.now())
    if (spent === undefined) return
    this.stops.budgetStop.abort(`supervise: budget exhausted (${spent})`)
  }

  private async publishMaterialization(
    exactDeclaration: ExecutorMaterialization,
    exactBinding: ExecutorExecutionBinding,
  ): Promise<void> {
    const { identity } = this
    await recordScopeOwnerMaterialization(
      this.scope,
      this.executor.runtime,
      {
        ...exactDeclaration,
        // The provider sees the projected profile while the receipt remains bound to the canonical
        // profile that authorized Runtime coordination: the registered one, across every segment of the run.
        authoredProfile:
          identity.registeredProfile === undefined
            ? identity.canonicalProfile
            : agentProfileSchema.parse(identity.registeredProfile),
        effectiveProfile: identity.providerProfile,
        platformAttachments: {
          [coordinationMcpAlias]: {
            kind: 'coordination-mcp',
            transport: 'http',
            tools: identity.coordinationTools,
          },
        },
      },
      {
        ...exactBinding,
        binding: {
          stableBinding: exactBinding.binding,
          platformAttachments: {
            [coordinationMcpAlias]: { transport: 'http', url: identity.coordinationMcpUrl },
          },
        },
        descriptor: { ...exactBinding.descriptor, coordination: true },
      },
    )
    this.materializationPublished = true
  }

  /** The retained owner's result seam: publish, meter, and hand the result over, in that order. */
  async commitOwnerResult(result: ExecutorResult<unknown>): Promise<void> {
    const { scope, executor } = this
    const declaration = runtimeOwnedExecutorMaterialization(executor)
    const binding = runtimeOwnedExecutorExecutionBinding(executor)
    if (!declaration || !binding) {
      throw new ValidationError(
        'retained owner result requires terminal materialization before release',
      )
    }
    if (!this.materializationPublished) await this.publishMaterialization(declaration, binding)
    await this.meterPending()
    const total = withBudgetResources(
      {
        ...result.spent,
        ...resourceTelemetry(this.observedOwnerSpend, result.spent),
        iterations: 0,
      },
      scope.budget,
    )
    const delta = ownerSpendDelta(total, this.committedOwnerSpend)
    await meterRuntimeOwnedAccounting(scope, delta, { role: 'driver', runtime: executor.runtime })
    this.committedOwnerSpend = addRetainedSpend(this.committedOwnerSpend, delta)
    await this.retainedOwner!.onResult(result)
    this.terminalAccountingCaptured = true
  }

  /**
   * Prove the executor carries a trusted receipt for this exact attempt before it runs. Construction
   * transferred cleanup ownership already, so a refusal here still reaches the bounded teardown.
   */
  async admit(pending: PendingMaterialization): Promise<void> {
    const { scope, executor } = this
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
        canonicalAgentProfileDigest(this.identity.providerProfile)
      ) {
        throw new ValidationError(
          'driveHarnessFromBackend: pending executor changed the provider-visible AgentProfile before execution',
        )
      }
      noteScopeOwnerPlannedExecution(scope, pending.declaration.execution)
    } else {
      await this.publishMaterialization(declaration!, executionBinding!)
    }
    if (executor.budgetExempt) {
      throw new ValidationError(
        `driveHarnessFromBackend: runtime ${JSON.stringify(executor.runtime)} does not report usage and cannot drive a budgeted supervisor`,
      )
    }
  }

  /** Meter a streamed drive turn by turn, then settle what its terminal artifact adds. */
  async drainStream(run: AsyncIterable<UsageEvent>, sink: DriverTurnSink): Promise<void> {
    const { turnStop } = this.stops
    let turns = 0
    for await (const event of run) {
      if (event.kind === 'iteration') {
        await this.meterPending()
        turns += 1
        sink.state.driveTurns += 1
        if (turnStop !== undefined && turns >= sink.turnCap && !turnStop.signal.aborted) {
          turnStop.abort(`supervise: maxTurns ${sink.turnCap} reached`)
        }
      } else if (event.kind === 'progress') {
        // A progress event carries the driver's observed output, never accounting: it is
        // retained in the run directory as it arrives and never reaches a meter.
        sink.rootStream?.append(event.progress)
        sink.noteDriveProgress(event.progress)
        sink.onModelEvent?.()
      } else {
        this.pendingUsage.push(event)
      }
    }
    await this.meterPending()
    // `resultArtifact()` is typed without the envelope outcome; scope's child settlement reads
    // the same artifact through the same widening.
    const artifact = this.executor.resultArtifact() as ExecutorResult<unknown>
    this.terminalArtifact = artifact
    await this.meterStreamCorrection(artifact)
    this.captureTerminal(artifact)
  }

  // A stream carries increments, while its terminal artifact says whether either accounting
  // channel was omitted. Preserve unknowns in the shared pool instead of treating them as 0.
  private async meterStreamCorrection(artifact: ExecutorResult<unknown>): Promise<void> {
    const { scope, observedOwnerSpend } = this
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
    if (
      !this.retainedOwner &&
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
        { role: 'driver', runtime: this.executor.runtime, telemetry: 'unknown' },
      )
    }
  }

  /** Meter a drive that returned its artifact whole. */
  async settleReturned(artifact: ExecutorResult<unknown>): Promise<void> {
    this.terminalArtifact = artifact
    await meterRuntimeOwnedProviderAttempt(
      this.scope,
      withBudgetResources({ ...artifact.spent, iterations: 0 }, this.scope.budget),
      this.nextProviderEvidence(),
      { role: 'driver', runtime: this.executor.runtime },
    )
    this.captureTerminal(artifact)
  }

  private captureTerminal(artifact: ExecutorResult<unknown>): void {
    this.terminalAccountingCaptured = true
    const failure = harnessTurnFailure(this.executor.runtime, artifact)
    if (failure !== undefined) this.turnFailure = failure
  }

  /** A pending executor that completed must have acknowledged its terminal materialization. */
  async publishAcknowledgement(pending: PendingMaterialization): Promise<void> {
    if (pending === undefined || this.materializationPublished) return
    const acknowledged = runtimeOwnedExecutorMaterialization(this.executor)
    const acknowledgedBinding = runtimeOwnedExecutorExecutionBinding(this.executor)
    if (acknowledged === undefined || acknowledgedBinding === undefined) {
      throw new ValidationError(
        'driveHarnessFromBackend: external executor completed without a terminal materialization acknowledgement',
      )
    }
    await this.publishMaterialization(acknowledged, acknowledgedBinding)
  }

  /**
   * Every exit's settlement, in order: the trusted receipt, the provider evidence, the remaining
   * metering, and the bounded teardown. Each step keeps the attempt's first failure.
   */
  async release(pending: PendingMaterialization, drive: DriveHarness): Promise<void> {
    const { executor, retainedOwner } = this
    // The bridge can return its terminal receipt, then Runtime metering can fail before normal
    // publication (for example, after an accepted submit_result exceeds the token budget).
    // The executor attestation is the trusted receipt; publish it before teardown destroys the
    // bridge-owned state. If no receipt exists, leave the owner unknown and preserve the
    // original failure instead of inventing evidence or replacing its diagnostic.
    if (pending !== undefined && !this.materializationPublished) {
      const acknowledged = runtimeOwnedExecutorMaterialization(executor)
      const acknowledgedBinding = runtimeOwnedExecutorExecutionBinding(executor)
      if (acknowledged !== undefined && acknowledgedBinding !== undefined) {
        try {
          await this.publishMaterialization(acknowledged, acknowledgedBinding)
        } catch (error) {
          this.noteFailure(error)
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
    const unmetered = () => this.failed && this.started && !this.terminalAccountingCaptured
    try {
      await this.meterPending(unmetered())
    } catch (error) {
      this.noteFailure(error)
    }
    if (unmetered()) {
      try {
        await this.meterUnmeteredAttempts()
      } catch (error) {
        // The pool can reject before updating its readout. Preserve the provider diagnosis,
        // but keep failed accounting terminal even when the original failure was transient.
        this.failure = new RuntimeRunStateError(
          `${errMessage(this.failure)}; accounting failed: ${errMessage(error)}`,
          { cause: this.failure },
        )
      }
    }
    try {
      if (!retainedOwner?.preserveEnvironment || retainedOwner.admissions.length === 0) {
        await teardownExecutor(
          executor,
          this.completed ? DEFAULT_SUCCESSFUL_SHUTDOWN_MS : 'brutalKill',
          this.deadlineAtMs,
          this.now,
        )
      }
    } catch (error) {
      this.noteFailure(error)
    }
  }

  // A reconnect may have started several provider attempts before the bridge failed.
  // Persist one unknown-cost marker for every unmetered attempt; dropping a later model
  // observation would let an earlier model appear homogeneous by accident.
  private async meterUnmeteredAttempts(): Promise<void> {
    const { scope, executor } = this
    for (;;) {
      const evidence = runtimeOwnedExecutorProviderEvidence(executor)
      const attempts = evidence?.attempts.length ?? 0
      if (attempts <= this.meteredProviderAttempts) break
      const providerDispatchDidNotStart =
        evidence?.attempts[this.meteredProviderAttempts]?.providerDispatch === 'not_started'
      await meterRuntimeOwnedProviderAttempt(
        scope,
        withBudgetResources(
          providerDispatchDidNotStart ? zeroSpend() : unmeteredSpend(0),
          scope.budget,
          providerDispatchDidNotStart,
        ),
        this.nextProviderEvidence(),
        {
          role: 'driver',
          runtime: executor.runtime,
          telemetry: providerDispatchDidNotStart
            ? 'known-zero-before-dispatch'
            : 'unknown-after-failure',
        },
      )
    }
    if (this.meteredProviderAttempts === 0) {
      await meterRuntimeOwnedProviderAttempt(
        scope,
        withBudgetResources(unmeteredSpend(0), scope.budget),
        this.nextProviderEvidence(),
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
  }
}
