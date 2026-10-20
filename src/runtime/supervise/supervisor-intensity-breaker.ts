import type { SpawnEvent, SpawnJournal, SupervisorOpts } from './types'

/**
 * Counts `down` settlements inside a sliding window. More than `maxRestarts` of them
 * within `withinMs` trips the supervisor (aborting the cascade) rather than letting a
 * driver re-spawn a doomed child forever. With either bound unset the breaker is inert
 * (it still counts `down`s for `downCount`). The breaker NEVER restarts a child — it is a
 * circuit breaker over the driver's own re-spawn decisions (m3).
 */
export interface IntensityBreaker {
  recordDown(at: number): void
  tripped(): boolean
  downCount(): number
}

export function createIntensityBreaker(opts: SupervisorOpts, trip: () => void): IntensityBreaker {
  const max = opts.maxRestarts
  const within = opts.withinMs
  const armed = max !== undefined && within !== undefined
  const recent: number[] = []
  let total = 0
  let isTripped = false
  return {
    recordDown(at: number): void {
      total += 1
      if (!armed || isTripped) return
      recent.push(at)
      const cutoff = at - within
      while (recent.length > 0 && recent[0]! < cutoff) recent.shift()
      if (recent.length > max) {
        isTripped = true
        trip()
      }
    },
    tripped(): boolean {
      return isTripped
    },
    downCount(): number {
      return total
    },
  }
}

/** Decorate the journal so the breaker observes every `settled`-`down` event the scope
 *  appends, without the supervisor intercepting `scope.next()`. The decorator is
 *  transparent — it forwards every method verbatim and only reads the down events.
 *
 *  A record marked `retainedExecution: 'released'` is skipped: it is the driver's earlier down
 *  re-stated by the release sweep, which runs AFTER the join barrier and before the result is
 *  classified. Counting it would trip an armed breaker on a run that has already settled and turn
 *  a delivered winner into `all-children-down`, and its backdated `at` (the settlement instant)
 *  would sit out of order in the sliding window. A retained child was never counted at its
 *  settlement either (it writes no `settled` record then), so `downCount` stays what it was:
 *  ordinary downs only; `fleetYield.down` is where a retained child is counted. */
export function wrapJournalForBreaker(
  journal: SpawnJournal,
  breaker: IntensityBreaker,
): SpawnJournal {
  const recordDown = (ev: SpawnEvent): void => {
    if (ev.kind === 'settled' && ev.status === 'down' && ev.retainedExecution === undefined) {
      breaker.recordDown(Date.parse(ev.at))
    }
  }
  return {
    loadTree: (root) => journal.loadTree(root),
    beginTree: (root, at) => journal.beginTree(root, at),
    ...(journal.appendEvents === undefined
      ? {}
      : {
          appendEvents: (root: string, events: ReadonlyArray<SpawnEvent>) => {
            for (const event of events) recordDown(event)
            const batch = journal.appendEvents?.(root, events) ?? Promise.resolve()
            return batch
          },
        }),
    appendEvent: (root, ev: SpawnEvent) => {
      recordDown(ev)
      return journal.appendEvent(root, ev)
    },
  }
}
