import {
  aggregateProviderModelEvidence,
  closesCursorSlot,
  loadSpawnForest,
  type SpawnForest,
} from '../../durable/spawn-journal'
import { RuntimeRunStateError } from '../../errors'
import { addSpend } from '../util'
import { sumSpendFromEvents } from './recover-executors'
import { withBudgetResources } from './resources'
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

/**
 * The run's terminal accounting, read off the one journal ledger — the honest per-channel
 * sums (input/output/usd/iterations all preserved), the named usage gaps, and the wall-clock
 * duration stamped onto `spentTotal.ms`. Computed AFTER the join barrier so every child's
 * settlement is recorded. Fails loud if the tree was never journaled (the supervisor always
 * `beginTree`s, so a missing tree is a corrupted journal, not a normal path).
 *
 * `spentTotal.ms` is `elapsedMs`, never the per-event sum: executors under-report their own
 * `ms` (most stamp 0) and parallel children overlap, so the sum cannot state the run's real
 * duration. The breakdown keeps the executor-reported sums.
 *
 * `tokensKnown`/`usdKnown` are stamped explicitly on the terminal total: `true` is a checked
 * claim (every spawn reached a terminal record AND every settled/metered record carried a
 * complete receipt on that channel), never the absence of bad news. The conjunction with the
 * summed flags is deliberately redundant — a future divergence between the sum and the gap
 * scan can only make the claim more conservative, never falsely `true`.
 */
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
  const { childWork, driverInference } = sumSpendFromEvents(events)
  const gaps = spendGapsFromEvents(events)
  const forest = await loadSpawnForest(journal, root)
  const providerModel = aggregateProviderModelEvidence(forest)
  const fleetYield = fleetYieldFromForest(forest)
  const summed = addSpend(childWork, driverInference)
  const spentTotal: Spend = {
    ...summed,
    ms: Math.max(0, elapsedMs),
    tokensKnown:
      summed.tokensKnown !== false && !gaps.some((gap) => gap.channels.includes('tokens')),
    usdKnown: summed.usdKnown !== false && !gaps.some((gap) => gap.channels.includes('usd')),
  }
  return { spentTotal, childWork, driverInference, gaps, providerModel, fleetYield }
}

/** How the run's spawned children ended, by node id across every tree of the forest. Read after
 *  the join barrier and the release sweep, so the terminal records the sweep wrote are in it.
 *  Spawned records without a parent are exempt: the run root, and the re-rooted owner copy a
 *  nested driver writes as its tree's first record (`ownedTreeRootSpawn` strips the parent), so
 *  a manager is counted once, in its parent's tree. Buckets are id sets rather than record counts
 *  because the journal guards seq uniqueness, not one-terminal-per-node, and the invariant
 *  `spawned === done + down + cancelled + neverSettled` must not rest on scope discipline alone;
 *  it is asserted here so a future root-id terminal record cannot silently break the tally. */
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

/** The journaled nodes whose usage accounting is incomplete — one `SpendGap` per node+kind,
 *  channels merged. A spawn with no terminal record (`settled`/`cancelled`/`woken`) is
 *  unaccounted on every channel; a settled or metered record that flags a channel unknown is
 *  a floor on that channel. The root's own spawned event is exempt: its terminal state is the
 *  result this list rides on. */
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
  if (spend.tokensKnown === false) channels.push('tokens')
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
