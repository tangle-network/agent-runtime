import { closesCursorSlot } from '../../durable/spawn-journal/event-index'
import { aggregateProviderModelEvidence } from '../../durable/spawn-journal/provider-model-evidence'
import { loadSpawnForest, type SpawnForest } from '../../durable/spawn-journal/spawn-forest'
import { RuntimeRunStateError } from '../../errors'
import { addSpend } from '../util'
import { sumMeasuredSpendFromEvents } from './recover-executors'
import { withBudgetResources } from './resources'
import { assertValidSpend } from './spend-validation'
import type { SpawnedEvent } from './supervisor-root-contract'
import type {
  FleetYield,
  NodeId,
  SpawnEvent,
  SpawnJournal,
  Spend,
  SpendChannel,
  SpendGap,
} from './types'

/** Terminal usage comes from receipts, never admission's conservative reservation charges.
 * Missing receipts stay named gaps; ms is wall time because parallel executor times overlap. */
export async function terminalAccounting(
  journal: SpawnJournal,
  root: string,
  elapsedMs: number,
): Promise<{
  spentTotal: Spend
  childWork: Spend
  driverInference: Spend
  gaps: SpendGap[]
  providerModel: import('./types').ProviderModelExecutionEvidence
  fleetYield: FleetYield
}> {
  const events = await journal.loadTree(root)
  if (events === undefined) {
    throw new RuntimeRunStateError(
      `supervisor: spawn tree '${root}' is missing from the journal after run (corrupted log)`,
    )
  }
  for (const event of events) {
    const spend =
      event.kind === 'metered'
        ? event.spend
        : event.kind === 'settled' || event.kind === 'cancelled' || event.kind === 'reconciled'
          ? event.spent
          : undefined
    if (spend !== undefined) assertValidSpend(spend, `settlement ${event.id}/${event.kind}`)
  }
  const { childWork, driverInference } = sumMeasuredSpendFromEvents(events)
  const gaps = spendGapsFromEvents(events)
  const forest = await loadSpawnForest(journal, root)
  const providerModel = aggregateProviderModelEvidence(forest)
  const fleetYield = fleetYieldFromForest(forest)
  const summed = addSpend(childWork, driverInference)
  const spentTotal: Spend = {
    ...summed,
    ms: Math.max(0, elapsedMs),
    tokensKnown:
      summed.tokensKnown !== false &&
      summed.tokens.tokensKnown !== false &&
      !gaps.some((gap) => gap.channels.includes('tokens')),
    usdKnown: summed.usdKnown !== false && !gaps.some((gap) => gap.channels.includes('usd')),
  }
  assertValidSpend(spentTotal, 'settlement total')
  return { spentTotal, childWork, driverInference, gaps, providerModel, fleetYield }
}

/** Count each child by its last terminal record across the owned forest; roots are exempt. */
function fleetYieldFromForest(forest: SpawnForest): FleetYield {
  const spawned = new Set<NodeId>()
  // Each id lands in exactly one bucket, by its last terminal record in journal order.
  const terminal = new Map<NodeId, 'done' | 'down' | 'cancelled'>()
  const released = new Set<NodeId>()
  const unconfirmed = new Set<NodeId>()
  for (const { event } of forest.events) {
    if (event.kind === 'spawned') {
      if (event.parent !== undefined) spawned.add(event.id)
    } else if (event.kind === 'settled' || event.kind === 'cancelled') {
      const bucket = event.kind === 'cancelled' ? 'cancelled' : event.status
      terminal.set(event.id, bucket)
      // `released` and `release-unconfirmed` are subsets of down + cancelled BY CONSTRUCTION here,
      // not by trust in the writer: only the release sweep and the final close write the markers
      // and they never write `done`, but a hand-built `done` record carrying one must not count
      // twice.
      released.delete(event.id)
      unconfirmed.delete(event.id)
      if (bucket !== 'done' && event.retainedExecution === 'released') released.add(event.id)
      if (bucket !== 'done' && event.retainedExecution === 'release-unconfirmed') {
        unconfirmed.add(event.id)
      }
    }
  }
  const count = (bucket: 'done' | 'down' | 'cancelled'): number =>
    [...terminal.values()].filter((value) => value === bucket).length
  const fleetYield: FleetYield = {
    spawned: spawned.size,
    done: count('done'),
    down: count('down'),
    cancelled: count('cancelled'),
    neverSettled: forest.inDoubt.length,
    releasedUnrecovered: released.size,
    releaseUnconfirmed: unconfirmed.size,
  }
  const accounted =
    fleetYield.done + fleetYield.down + fleetYield.cancelled + fleetYield.neverSettled
  if (accounted !== fleetYield.spawned) {
    throw new RuntimeRunStateError(
      `supervisor: fleet yield does not partition the spawned children of '${forest.root}' (${JSON.stringify(fleetYield)})`,
    )
  }
  if (
    fleetYield.releasedUnrecovered + fleetYield.releaseUnconfirmed >
    fleetYield.down + fleetYield.cancelled
  ) {
    throw new RuntimeRunStateError(
      `supervisor: released children exceed down + cancelled for '${forest.root}' (${JSON.stringify(fleetYield)})`,
    )
  }
  return fleetYield
}

/** Merge missing-receipt channels by node and cause; the root settles in result.json. */
function spendGapsFromEvents(events: SpawnEvent[]): SpendGap[] {
  const labels = new Map<NodeId, string>()
  const budgets = new Map<NodeId, SpawnedEvent['budget']>()
  const terminal = new Set<NodeId>()
  for (const ev of events) {
    if (ev.kind === 'spawned') {
      labels.set(ev.id, ev.label)
      budgets.set(ev.id, ev.budget)
    } else if (closesCursorSlot(ev)) terminal.add(ev.id)
  }
  const gaps = new Map<
    string,
    { id: NodeId; kind: SpendGap['kind']; channels: Set<SpendChannel> }
  >()
  const record = (
    id: NodeId,
    kind: SpendGap['kind'],
    channels: ReadonlyArray<SpendChannel>,
  ): void => {
    if (channels.length === 0) return
    const key = `${kind}:${id}`
    const existing = gaps.get(key)
    if (existing !== undefined) for (const channel of channels) existing.channels.add(channel)
    else gaps.set(key, { id, kind, channels: new Set(channels) })
  }
  for (const ev of events) {
    if (ev.kind === 'spawned' && ev.parent !== undefined && !terminal.has(ev.id)) {
      record(ev.id, 'never-settled', [
        'tokens',
        'usd',
        ...Object.keys(ev.budget.resources ?? {}).map((name): SpendChannel => `resource:${name}`),
      ])
    } else if (ev.kind === 'cancelled' && ev.spent === undefined) {
      record(ev.id, 'unreported', [
        'tokens',
        'usd',
        ...Object.keys(budgets.get(ev.id)?.resources ?? {}).map(
          (name): SpendChannel => `resource:${name}`,
        ),
      ])
    } else if (ev.kind === 'settled' || (ev.kind === 'cancelled' && ev.spent !== undefined)) {
      record(
        ev.id,
        'unreported',
        unknownChannels(withBudgetResources(ev.spent!, budgets.get(ev.id) ?? {})),
      )
    } else if (ev.kind === 'metered') {
      record(ev.id, 'unreported', unknownChannels(ev.spend))
    }
  }
  return [...gaps.values()].map((gap) => {
    const label = labels.get(gap.id)
    return {
      id: gap.id,
      ...(label !== undefined ? { label } : {}),
      kind: gap.kind,
      channels: [...gap.channels],
    }
  })
}

/** The channels a single spend record explicitly marks incomplete. */
function unknownChannels(spend: Spend): SpendChannel[] {
  const channels: SpendChannel[] = []
  if (spend.tokensKnown === false || spend.tokens.tokensKnown === false) channels.push('tokens')
  if (spend.usdKnown === false) channels.push('usd')
  for (const [name, resource] of Object.entries(spend.resources ?? {})) {
    if (!resource.known) channels.push(`resource:${name}`)
  }
  return channels
}

/** True when any driver metered inference this run (so the winner carries a `spentBreakdown`).
 *  Checks every channel `addSpend` sums — including `ms` — so the gate stays consistent with the
 *  total even though the coordination driver currently stamps `ms: 0`. */
export function isNonEmptySpend(s: Spend): boolean {
  return (
    s.iterations > 0 ||
    s.tokens.input > 0 ||
    s.tokens.output > 0 ||
    s.usd > 0 ||
    s.ms > 0 ||
    s.tokensKnown === false ||
    s.usdKnown === false ||
    Object.values(s.resources ?? {}).some((resource) => resource.amount > 0 || !resource.known)
  )
}
