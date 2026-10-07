import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { ExecutorConfig } from './runtime'
import type { NodeId, SpawnEvent, SpawnJournal } from './types'

/** A stage is authored in the immutable profile. A selection is a concrete, private placement. */
export interface SeatStage {
  readonly harness: string
  readonly provider: string
  readonly model: string
  readonly selector:
    | { readonly kind: 'all-eligible' }
    | { readonly kind: 'seat'; readonly id: string }
  readonly tools?: AgentProfile['tools']
  readonly permissions?: AgentProfile['permissions']
}

export interface SeatSegment {
  readonly seat: string
  readonly harness: string
  readonly provider: string
  readonly model: string
  readonly startedAt: string
  readonly endedAt?: string
  readonly reason?: 'usage-limit' | 'completed' | 'failed' | 'cancelled' | 'paused'
}

export interface SeatSelectionInput {
  readonly profile: AgentProfile
  readonly nodeId: string
  readonly stage: SeatStage
  readonly stageIndex: number
  readonly segmentIndex: number
  readonly excludedSeatIds: readonly string[]
  readonly previous?: Pick<SeatSegment, 'seat' | 'harness' | 'provider' | 'model'>
  /** Last admitted environment without a confirmed destroy receipt. Check live capability before reuse. */
  readonly retainedEnvironmentId?: string
  /** This selection must grant a different credential on the retained native session. */
  readonly requiresNativeTurnGrant: boolean
  /** Rebind the exact prior seat after coordinator restart, never choose another implicitly. */
  readonly resumeSeatId?: string
}

export type SeatSelection =
  | {
      readonly seat: string
      readonly backend: Extract<ExecutorConfig, { backend: 'provider' }>
      /** Lab verified that this backend can grant the selected seat on an existing native session. */
      readonly nativeTurnGrant?: true
    }
  | { readonly resumeAt: string }

/** The caller owns account eligibility and credential resolution; Runtime owns the chain order. */
export type SelectSeat = (input: SeatSelectionInput) => Promise<SeatSelection>

export class SeatChainExhaustedError extends Error {
  readonly resumeAt: string
  constructor(resumeAt: string) {
    super(`authored subscription seat chain exhausted; resume at ${resumeAt}`)
    this.name = 'SeatChainExhaustedError'
    this.resumeAt = resumeAt
  }
}

export interface ActiveSeat {
  readonly seat: string
  readonly stageIndex: number
  readonly segmentIndex: number
  readonly stage: SeatStage
  readonly backend: Extract<ExecutorConfig, { backend: 'provider' }>
  readonly nativeTurnGrant?: true
  /** The completed predecessor, if this segment changed a seat. */
  readonly previous?: Pick<SeatSegment, 'seat' | 'harness' | 'provider' | 'model'>
}

/** One logical node's durable chain. The spawn journal is the sole transition authority. */
export class SeatChain {
  private observedThrough = -1

  constructor(
    private readonly profile: AgentProfile,
    private readonly nodeId: NodeId,
    private readonly rootId: NodeId,
    private readonly journal: SpawnJournal,
    private readonly select: SelectSeat,
    private readonly now: () => number = Date.now,
    private readonly onSegment?: (
      segment: SeatSegment,
      phase: 'started' | 'ended',
    ) => Promise<void>,
    private readonly beforeStart?: (
      selection: ActiveSeat,
      previous?: Pick<SeatSegment, 'seat' | 'harness' | 'provider' | 'model'>,
    ) => Promise<void>,
  ) {}

  async next(afterUsageLimit = false, afterRecheck = false): Promise<ActiveSeat> {
    const stages = authoredSeatStages(this.profile)
    if (!stages) throw new ValidationError('SeatChain requires authored AgentProfile.seats')
    const allEvents = (await this.journal.loadTree(this.rootId)) ?? []
    const events = allEvents.filter(
      (event): event is Extract<SpawnEvent, { kind: 'seat-segment' }> =>
        event.kind === 'seat-segment' && event.id === this.nodeId,
    )
    const destroyed = new Set(
      allEvents
        .filter(
          (event): event is Extract<SpawnEvent, { kind: 'environment-teardown' }> =>
            event.kind === 'environment-teardown' && event.id === this.nodeId && event.destroyed,
        )
        .map((event) => event.environmentId),
    )
    let admittedEnvironmentId: string | undefined
    for (const event of allEvents) {
      if (
        event.kind === 'execution-admitted' &&
        event.id === this.nodeId &&
        event.admission.phase === 'environment'
      ) {
        admittedEnvironmentId = event.admission.environmentId
      }
    }
    const retainedEnvironmentId =
      admittedEnvironmentId !== undefined && !destroyed.has(admittedEnvironmentId)
        ? admittedEnvironmentId
        : undefined
    await this.reconcile(events)
    const starts = events.filter((event) => event.phase === 'started')
    const last = starts.at(-1)
    const closed =
      last &&
      events.some((event) => event.phase === 'ended' && event.segmentIndex === last.segmentIndex)
    if (last && !closed && afterUsageLimit) await this.end(last, 'usage-limit')
    const resume = last && !closed && !afterUsageLimit
    const segmentIndex = resume ? last.segmentIndex : (last?.segmentIndex ?? -1) + 1
    const firstStageIndex = afterRecheck ? 0 : (last?.stageIndex ?? 0)
    let earliestReset: number | undefined
    for (let stageIndex = firstStageIndex; stageIndex < stages.length; stageIndex += 1) {
      const stage = stages[stageIndex]!
      const excludedSeatIds = (afterRecheck ? [] : starts)
        .filter((event) => event.stageIndex === stageIndex && (!resume || event.seat !== last.seat))
        .map((event) => event.seat)
      const prior =
        last === undefined
          ? undefined
          : {
              seat: last.seat,
              harness: last.harness,
              provider: last.provider,
              model: last.model,
            }
      const preceding = resume ? starts.at(-2) : last
      const requiresNativeTurnGrant = Boolean(
        preceding &&
          preceding.provider === stage.provider &&
          preceding.harness === stage.harness &&
          (!resume || preceding.seat !== last.seat),
      )
      const selection = checkedSeatSelection(
        stage,
        await this.select({
          profile: this.profile,
          nodeId: this.nodeId,
          stage,
          stageIndex,
          segmentIndex,
          excludedSeatIds,
          requiresNativeTurnGrant,
          ...(retainedEnvironmentId === undefined ? {} : { retainedEnvironmentId }),
          ...(prior === undefined ? {} : { previous: prior }),
          ...(resume ? { resumeSeatId: last.seat } : {}),
        }),
      )
      if ('resumeAt' in selection) {
        const reset = Date.parse(selection.resumeAt)
        earliestReset = earliestReset === undefined ? reset : Math.min(earliestReset, reset)
        if (resume) break
        continue
      }
      if (resume && selection.seat !== last.seat) {
        throw new ValidationError('selectSeat: resume changed the committed seat')
      }
      if (excludedSeatIds.includes(selection.seat)) {
        throw new ValidationError('selectSeat: selected an exhausted seat')
      }
      if (
        preceding &&
        preceding.seat !== selection.seat &&
        preceding.provider === stage.provider &&
        preceding.harness === stage.harness &&
        selection.nativeTurnGrant !== true
      ) {
        throw new ValidationError(
          'selectSeat: same-environment seat requires a verified native turn grant',
        )
      }
      const active: ActiveSeat = {
        seat: selection.seat,
        stageIndex,
        segmentIndex,
        stage,
        backend: selection.backend,
        ...(selection.nativeTurnGrant === true ? { nativeTurnGrant: true } : {}),
        ...(preceding === undefined
          ? {}
          : {
              previous: {
                seat: preceding.seat,
                harness: preceding.harness,
                provider: preceding.provider,
                model: preceding.model,
              },
            }),
      }
      if (!resume) {
        await this.beforeStart?.(active, prior)
        const at = new Date(this.now()).toISOString()
        await this.journal.appendEvent(this.rootId, {
          kind: 'seat-segment',
          id: this.nodeId,
          segmentIndex,
          stageIndex,
          phase: 'started',
          seat: selection.seat,
          harness: stage.harness,
          provider: stage.provider,
          model: stage.model,
          seq: segmentIndex,
          at,
        })
        await this.onSegment?.(
          {
            seat: selection.seat,
            harness: stage.harness,
            provider: stage.provider,
            model: stage.model,
            startedAt: at,
          },
          'started',
        )
        this.observedThrough = events.length
        return active
      }
      return active
    }
    // A provider may know that quota is exhausted without publishing its reset. Recheck the
    // authored chain at the account cache's two-minute cadence; this is not a claimed reset time.
    const recheckAt = Math.max(earliestReset ?? 0, this.now() + 120_000)
    throw new SeatChainExhaustedError(new Date(recheckAt).toISOString())
  }

  async close(reason: 'completed' | 'failed' | 'cancelled' | 'paused'): Promise<void> {
    const events = ((await this.journal.loadTree(this.rootId)) ?? []).filter(
      (event): event is Extract<SpawnEvent, { kind: 'seat-segment' }> =>
        event.kind === 'seat-segment' && event.id === this.nodeId,
    )
    await this.reconcile(events)
    const last = events.filter((event) => event.phase === 'started').at(-1)
    if (
      last &&
      !events.some((event) => event.phase === 'ended' && event.segmentIndex === last.segmentIndex)
    ) {
      await this.end(last, reason)
    }
  }

  private async end(
    start: Extract<SpawnEvent, { kind: 'seat-segment' }>,
    reason: 'usage-limit' | 'completed' | 'failed' | 'cancelled' | 'paused',
  ): Promise<void> {
    const at = new Date(this.now()).toISOString()
    await this.journal.appendEvent(this.rootId, { ...start, phase: 'ended', reason, at })
    await this.onSegment?.(
      {
        seat: start.seat,
        harness: start.harness,
        provider: start.provider,
        model: start.model,
        startedAt: start.at,
        endedAt: at,
        reason,
      },
      'ended',
    )
    this.observedThrough += 1
  }

  /** A crash may land between the authoritative journal append and observer delivery. On
   * reconstruction, deliver every unobserved boundary again; the observer projection folds
   * repeated boundaries by seat and start time, so a callback never decides execution identity. */
  private async reconcile(
    events: readonly Extract<SpawnEvent, { kind: 'seat-segment' }>[],
  ): Promise<void> {
    const starts = new Map<number, Extract<SpawnEvent, { kind: 'seat-segment' }>>()
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]!
      if (event.phase === 'started') starts.set(event.segmentIndex, event)
      if (index <= this.observedThrough) continue
      const start = event.phase === 'started' ? event : starts.get(event.segmentIndex)
      if (!start) throw new ValidationError('seat segment ended without a committed start')
      await this.onSegment?.(
        {
          seat: start.seat,
          harness: start.harness,
          provider: start.provider,
          model: start.model,
          startedAt: start.at,
          ...(event.phase === 'ended' ? { endedAt: event.at, reason: event.reason } : {}),
        },
        event.phase,
      )
      this.observedThrough = index
    }
  }
}

/** Preserve the authored profile for identity; only the provider-facing copy changes stages. */
export function seatExecutionProfile(profile: AgentProfile, stage: SeatStage): AgentProfile {
  const { seats: _seats, ...withoutSeats } = profile as AgentProfile & { seats?: unknown }
  return {
    ...withoutSeats,
    harness: stage.harness as AgentProfile['harness'],
    ...(stage.tools === undefined ? {} : { tools: stage.tools }),
    ...(stage.permissions === undefined ? {} : { permissions: stage.permissions }),
    model: {
      ...profile.model,
      default: stage.model,
      provider: stage.provider,
    },
  } as AgentProfile
}

export function authoredSeatStages(profile: AgentProfile): readonly SeatStage[] | undefined {
  const seats = (profile as AgentProfile & { seats?: unknown }).seats
  if (seats === undefined) return undefined
  if (!Array.isArray(seats) || seats.length === 0) {
    throw new ValidationError('AgentProfile.seats must be a nonempty ordered chain')
  }
  return seats as SeatStage[]
}

const USAGE_LIMIT_CODES = new Set([
  'subscription_usage_limit',
  'usage_limit_reached',
  'usage_limit_exceeded',
  'weekly_limit_reached',
  'session_limit_reached',
])

/** Normalize a native harness refusal into a typed limit. A plain HTTP 429 is insufficient. */
export function subscriptionUsageLimitSignal(failure: {
  readonly error: string
  readonly errorCode?: string
}): 'subscription-usage-limit' | undefined {
  if (failure.errorCode && USAGE_LIMIT_CODES.has(failure.errorCode.toLowerCase())) {
    return 'subscription-usage-limit'
  }
  // Native Codex and Claude Code often expose their limit only as an exact CLI stop message.
  if (/\bYou've hit your (?:usage|weekly|session) limit\b/iu.test(failure.error)) {
    return 'subscription-usage-limit'
  }
  return undefined
}

/** An ineligible or misconfigured account must never turn an authored stage into another model. */
export function checkedSeatSelection(stage: SeatStage, selected: SeatSelection): SeatSelection {
  if ('resumeAt' in selected) {
    if (!Number.isFinite(Date.parse(selected.resumeAt))) {
      throw new ValidationError('selectSeat: resumeAt must be an ISO timestamp')
    }
    return selected
  }
  if (!selected.seat.trim()) throw new ValidationError('selectSeat: seat must be nonempty')
  if (stage.selector.kind === 'seat' && stage.selector.id !== selected.seat) {
    throw new ValidationError('selectSeat: selection does not match the authored seat')
  }
  if (selected.backend.backend !== 'provider') {
    throw new ValidationError('selectSeat: selection must use a provider backend')
  }
  return selected
}
