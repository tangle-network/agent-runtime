import type { BudgetViolation, SpawnRejection } from '../../runtime'
import type { ReservationShortfall } from '../../runtime/supervise/budget'
import type { SpawnRefusalCause } from './coordination-contracts'

/** Each channel spent beyond its budget, as spent of budget: `tokens 235,857 of 42,000` or
 *  `deadline 3,857 s of 2,400 s`. */
export function budgetOverspendText(violation: BudgetViolation): string {
  const count = (value: number) => value.toLocaleString('en-US')
  return violation.overspent
    .map((entry) =>
      entry.channel === 'deadline'
        ? `deadline ${count(Math.round(entry.spent / 1000))} s of ${count(Math.round(entry.reserved / 1000))} s`
        : `${entry.channel} ${count(entry.spent)} of ${count(entry.reserved)}`,
    )
    .join('; ')
}

/** What a manager can do with a keyed worker its budget stopped. */
export const BUDGET_STOP_NEXT =
  'spawn_worker with the same key and a larger budget continues this session where it stopped; ' +
  'cancel_worker releases it'

/** Every cause at zero — a pre-flight publishes its whole ledger from the first read. */
export function emptyPreflightCounts(): Record<SpawnRefusalCause, number> {
  return { 'model-route': 0, 'bridge-full': 0, 'unmountable-tool': 0, 'unprovisionable-profile': 0 }
}

/** The optional per-spawn budget `spawn_worker` and `run_graph` take. */
export const spawnBudgetArg = {
  type: 'object',
  description:
    'Optional per-spawn budget that merges over the per-worker default (per field). ' +
    'Only set the ceilings this sub-task needs raised; the conserved pool still fences.',
  properties: {
    maxIterations: { type: 'number', minimum: 0 },
    maxTokens: { type: 'number', minimum: 0 },
    maxUsd: { type: 'number', minimum: 0 },
    deadlineMs: { type: 'number', minimum: 0 },
    resources: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          unit: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        },
        required: ['unit', 'limit'],
      },
    },
  },
}

export function budgetField(channel: ReservationShortfall['channel']): string {
  return channel.startsWith('resource:')
    ? `resources.${channel.slice('resource:'.length)}.limit`
    : BUDGET_FIELD[channel as 'tokens' | 'iterations' | 'usd']
}

/** One clause per short channel. Iterations can be requested at exactly `free`: a driver's own
 *  turns charge none. Tokens and dollars cannot: the driver's next turn is metered from the same
 *  pool before its retry reaches admission, so the clause says to leave room. */
export function shortfallClause(shortfall: ReservationShortfall): string {
  const { channel, requested, free } = shortfall
  const field = budgetField(channel)
  if (shortfall.closedByUnknownSpend === true) {
    return `${channel} is closed: work with unmeasured ${channel} usage ran under the run's enforced limit, so this run admits no further spawn at any budget`
  }
  const asked = `this spawn asked for budget.${field} ${requested}`
  const held = shortfall.held ?? 0
  const most = free + held
  if (most === 0) {
    return `${channel} has nothing free and none held by your running workers (${asked})`
  }
  // A spawn of at most free + held is admitted and waits for the running workers to return it.
  const room =
    held > 0
      ? `${free} free now and ${held} held by your running workers, which a spawn waits for`
      : `${free} free${channel === 'iterations' || channel.startsWith('resource:') ? '' : ' right now'}`
  if (channel === 'iterations' || channel.startsWith('resource:')) {
    return `${channel} has ${room} (${asked}); budget.${field} at most ${most} fits`
  }
  return `${channel} has ${room} (${asked}); your own turns draw ${channel} from this same pool before a retry is admitted, so ask for well under ${most}`
}

/**
 * The reason text `spawn_worker` returns for a refused spawn. Every rejection kind names its own
 * cause: a live-worker cap, a depth limit, or a key collision is not an empty budget, and telling a
 * driver "no allocation left" for those sends it after the wrong fix. A `budget-exhausted` refusal
 * names every channel that did not fit and the amounts, so the driver can size its next request.
 */
export function spawnRefusalReason(
  reason: SpawnRejection,
  shortfalls: readonly ReservationShortfall[] | undefined,
  pinned: {
    readonly usdUnbudgeted: string
    readonly inDoubt: string
    readonly scopeSettled: string
  },
): string {
  switch (reason) {
    case 'usd-unbudgeted':
      return pinned.usdUnbudgeted
    case 'in-doubt':
      return pinned.inDoubt
    case 'scope-settled':
      return pinned.scopeSettled
    case 'scope-aborted':
      return 'this run stopped admitting work (it was cancelled, passed its deadline, or too many children went down); no further worker can start'
    case 'depth-exceeded':
      return "this spawn would exceed the run's maxDepth; a worker at the deepest level cannot start children of its own"
    case 'duplicate-key':
      return 'a worker under this key is still live; wait for it to settle, or use a different key for different work'
    case 'key-conflict':
      return "this key is already recorded for a different profile or task in this run's journal; use a new key for different work"
    case 'invalid-identity':
      return 'a keyed spawn needs a complete execution identity to journal, and this profile and task did not produce one; spawn again without a key'
    case 'budget-exhausted': {
      if (shortfalls === undefined || shortfalls.length === 0) {
        return "the conserved pool refused this spawn (budget-exhausted): the run's remaining budget cannot cover this worker's budget"
      }
      if (shortfalls.some((shortfall) => shortfall.closedByUnknownSpend === true)) {
        const closed = shortfalls.find((shortfall) => shortfall.closedByUnknownSpend === true)!
        return `the run pool refused this spawn: ${shortfallClause(closed)}; the caller must re-run with a measurable or larger root budget`
      }
      return `the run pool refused this spawn: ${shortfalls.map(shortfallClause).join('; ')}; or ask the caller for a larger root budget`
    }
  }
}

const BUDGET_FIELD: Readonly<Record<'tokens' | 'iterations' | 'usd', string>> = {
  tokens: 'maxTokens',
  iterations: 'maxIterations',
  usd: 'maxUsd',
}
