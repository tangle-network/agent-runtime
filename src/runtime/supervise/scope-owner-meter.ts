import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { withBudgetResources } from './resources'
import type { ScopeArgs } from './scope-contract'
import { detachedSnapshot } from './snapshot'
import type { ProviderModelExecutionEvidence, Spend } from './types'

/** The scope owner's own inference: debited from the shared pool, journaled, and announced. */
export class ScopeOwnerMeter {
  /** The owner's own turns, so its lead reads a manager that takes turns as active. */
  ownerTurns = 0
  ownerLastTurnAt = 0
  private meterSeq = 0

  constructor(
    private readonly args: ScopeArgs,
    private readonly now: () => number,
  ) {}

  async record(
    spend: Spend,
    detail?: Record<string, unknown>,
    providerModel?: ProviderModelExecutionEvidence,
    accountingOnly = false,
    runtimeOwned = false,
    alreadySpent = false,
  ): Promise<void> {
    const args = this.args
    const now = this.now
    if (args.signal.aborted && !runtimeOwned) {
      throw new ValidationError('scope.meter: cannot record new driver work after scope abort')
    }
    const partial = providerModel !== undefined || accountingOnly
    if (!partial) spend = withBudgetResources(spend, args.pool.readout())
    const seq = this.meterSeq++
    // Debit the driver's own inference against the shared pool (free → committed), so equal-k and
    // `budget.tokensLeft` see it live. An invalid observation (unknown dollars under a ceiling) still
    // describes compute that happened: record it durably before returning the refusal, or the
    // terminal result would report that cost as $0.
    let observeError: unknown
    try {
      args.pool.observe(spend, { partial, ...(alreadySpent ? { alreadySpent } : {}) })
    } catch (error) {
      observeError = error
    }
    this.ownerLastTurnAt = now()
    if (!accountingOnly) this.ownerTurns += 1
    // Journal it as a `metered` event — the durable TWIN of the pool debit (as `settled` is the
    // twin of `reconcile`), so every journal-based cost reader sums driver inference automatically.
    // Awaited like the settled append (cost-critical), so it has landed before the supervisor's
    // join-barrier cost roll-up.
    await args.journal.appendEvent(args.root, {
      kind: 'metered',
      id: args.parentId,
      spend,
      ...(accountingOnly ? { accountingOnly: true as const } : {}),
      ...(providerModel === undefined
        ? {}
        : { providerModel: detachedSnapshot(providerModel, 'runtime provider model evidence') }),
      seq,
      at: new Date(now()).toISOString(),
    })
    // Emit it as an `agent.turn` event so the trace/topology view sees per-turn driver inference
    // (the same stream `spawn`/`next` feed — one observable tree).
    notifyRuntimeHookEvent(
      args.hooks,
      {
        id: `${args.parentId}:meter:${seq}`,
        runId: args.root,
        target: 'agent.turn',
        phase: 'after',
        timestamp: now(),
        parentId: args.parentId,
        payload: { spend, ...(detail ?? {}) },
      },
      { signal: args.signal },
    )
    if (observeError !== undefined) throw observeError
  }
}
