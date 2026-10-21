import { ValidationError } from '../../errors'
import type { LiveChild, PreSeqSettled, ScopeArgs } from './scope-contract'
import { finalizeSettlement, raceFirstSettled } from './scope-settlement'
import type { NodeId, Settled } from './types'

/**
 * The scope's `next()` cursor: delivers each child's settlement exactly once, stamps the cursor
 * `seq`, and tracks the settlement writes still landing so a drain can wait for them.
 */
export class ScopeSettlementCursor<Out> {
  /** Settlement writes in flight; a drain or an empty cursor waits for every one. */
  readonly writes = new Set<Promise<Settled<Out>>>()
  // The order `next()` yields settlements (B2): the `seq` of `settled`/`cancelled` events and of
  // `Settled`. Separate from the spawn ordinal so a `spawned` event never collides with a `settled`
  // one in the per-tree uniqueness guard. A resumed scope continues PAST the recorded maximum.
  private cursorSeq: number

  constructor(
    private readonly args: ScopeArgs,
    private readonly children: Map<NodeId, LiveChild>,
    private readonly now: () => number,
    private readonly recordKeyedSettlement: (key: string, settled: Settled<Out>) => void,
  ) {
    this.cursorSeq = args.resumeFrom ? args.resumeFrom.maxCursorSeq + 1 : 0
  }

  readonly next = async (): Promise<Settled<Out> | null> => {
    const undelivered = () => [...this.children.values()].filter((c) => !c.delivered)

    // ray.wait n=1: await the FIRST not-yet-delivered child to settle. Loop because a
    // concurrent `next()` may take the race winner between the await and the pick.
    for (;;) {
      const pending = undelivered()
      if (pending.length === 0) {
        await Promise.all([...this.writes])
        return null
      }
      // Prefer an already-resolved-but-undelivered child (no await needed).
      const ready = pending.find((c) => c.resolved !== undefined)
      const chosen = ready ?? (await raceFirstSettled(pending))
      if (chosen.delivered) continue
      chosen.delivered = true

      const seq = this.cursorSeq++
      const settlement = chosen.resolved
      if (!settlement) {
        throw new ValidationError(
          `scope.next: child '${chosen.id}' won the settle race without a resolved value`,
        )
      }
      return await this.commit(chosen, settlement, seq)
    }
  }

  readonly nextResolved = async (): Promise<Settled<Out> | null> => {
    // Same exactly-once delivery as `next()`, but never awaits a RUNNING executor. A child
    // whose executor has finished (`executorDone`) may still be mid-persistence — awaiting its
    // `settled` promise there completes in bounded bookkeeping time, never on live work.
    for (;;) {
      const candidates = [...this.children.values()].filter((c) => !c.delivered)
      const pick =
        candidates.find((c) => c.resolved !== undefined) ?? candidates.find((c) => c.executorDone)
      if (!pick) {
        await Promise.all([...this.writes])
        return null
      }
      const settlement = await pick.settled
      if (pick.delivered) continue // lost the race with a concurrent cursor — pick again
      pick.delivered = true
      const seq = this.cursorSeq++
      return await this.commit(pick, settlement, seq)
    }
  }

  private async commit(
    child: LiveChild,
    settlement: PreSeqSettled,
    seq: number,
  ): Promise<Settled<Out>> {
    const pending = finalizeSettlement<Out>(child, settlement, seq, this.args, this.now).then(
      (delivered) => {
        if (child.key !== undefined) this.recordKeyedSettlement(child.key, delivered)
        return delivered
      },
    )
    this.writes.add(pending)
    try {
      return await pending
    } finally {
      this.writes.delete(pending)
    }
  }
}
