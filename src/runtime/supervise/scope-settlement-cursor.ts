import { ValidationError } from '../../errors'
import type { LiveChild, PreSeqSettled, ScopeArgs } from './scope-contract'
import { finalizeSettlement, raceFirstSettled } from './scope-settlement'
import type { NodeId, Settled } from './types'

/** Commit completed children eagerly; deliver their acknowledged results exactly once. */
export class ScopeSettlementCursor<Out> {
  readonly writes = new Set<Promise<Settled<Out>>>()
  private readonly publications = new Map<NodeId, { seq: number; result: Promise<Settled<Out>> }>()
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
    for (;;) {
      const pending = [...this.children.values()].filter((c) => !c.delivered)
      if (pending.length === 0) {
        await Promise.all([...this.writes])
        return null
      }
      const chosen = this.firstPublished(pending)
      if (!chosen) {
        await raceFirstSettled(pending)
        continue
      }
      chosen.delivered = true
      return await this.published(chosen)
    }
  }

  readonly nextResolved = async (): Promise<Settled<Out> | null> => {
    for (;;) {
      const candidates = [...this.children.values()].filter((c) => !c.delivered)
      const pick = this.firstPublished(candidates) ?? candidates.find((c) => c.executorDone)
      if (!pick) {
        await Promise.all([...this.writes])
        return null
      }
      if (!this.publications.has(pick.id)) {
        await pick.settled
        continue
      }
      pick.delivered = true
      return await this.published(pick)
    }
  }

  readonly publish = (child: LiveChild, settlement: PreSeqSettled): Promise<Settled<Out>> => {
    const prior = this.publications.get(child.id)
    if (prior) return prior.result
    const seq = this.cursorSeq++
    const pending = finalizeSettlement<Out>(child, settlement, seq, this.args, this.now).then(
      (delivered) => {
        if (child.key !== undefined) this.recordKeyedSettlement(child.key, delivered)
        return delivered
      },
    )
    this.publications.set(child.id, { seq, result: pending })
    this.writes.add(pending)
    void pending.then(
      () => this.writes.delete(pending),
      () => this.writes.delete(pending),
    )
    return pending
  }

  private firstPublished(children: LiveChild[]): LiveChild | undefined {
    return children
      .filter((child) => this.publications.has(child.id))
      .sort((a, b) => this.publications.get(a.id)!.seq - this.publications.get(b.id)!.seq)[0]
  }

  private published(child: LiveChild): Promise<Settled<Out>> {
    const publication = this.publications.get(child.id)
    if (!publication) throw new ValidationError(`scope: child '${child.id}' has no publication`)
    return publication.result
  }
}
