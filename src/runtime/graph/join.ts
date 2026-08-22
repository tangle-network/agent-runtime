/**
 * Join evaluation: which gating-edge outcomes release a node. Adopted whole from ADC's workflow
 * graph (agent-runtime#968) and kept PURE — the scheduler decides nothing here, so the rule can be
 * read, tested and reasoned about on its own.
 *
 * An edge settles SATISFIED / DEAD / FAILED per its source's LATEST completion. A release consumes
 * the outcomes that produced it; the caller re-arms them and marks any still-pending edge
 * consumed-once, so an OR-diamond's second completer never double-fires.
 */
import type { CompiledEdge } from './compile'
import type { JoinRule } from './definition'
import type { FoldEdge } from './fold'

export interface GatingEdge {
  readonly edge: CompiledEdge
  readonly folded: FoldEdge | undefined
}

export interface JoinDecision {
  /** Whether the node releases now. */
  readonly release: boolean
  /** The edges whose outcomes produced this release — the ones a traversal cap judges. */
  readonly consuming: ReadonlyArray<GatingEdge>
  /** Whether the node can never release again on this wave (recorded like skipped-by-guard). */
  readonly blocked: boolean
}

const NOTHING: JoinDecision = { release: false, consuming: [], blocked: false }

/** Decide whether a node's gating edges release it, and which of them the release consumes. */
export function decideJoin(rule: JoinRule, gating: ReadonlyArray<GatingEdge>): JoinDecision {
  if (gating.length === 0) return NOTHING
  const settled = gating.filter((entry) => entry.folded && entry.folded.state !== 'pending')
  const satisfied = gating.filter((entry) => entry.folded?.state === 'satisfied')
  const failed = gating.filter((entry) => entry.folded?.state === 'failed')
  const allSettled = settled.length === gating.length
  switch (rule) {
    case 'all': {
      // A dead or failed edge can never satisfy an `all` join on this wave.
      const spoiled = gating.some(
        (entry) => entry.folded?.state === 'dead' || entry.folded?.state === 'failed',
      )
      const release = !spoiled && satisfied.length === gating.length
      return { release, consuming: release ? settled : [], blocked: false }
    }
    case 'any': {
      const first = satisfied[0]
      if (first === undefined) return { release: false, consuming: [], blocked: allSettled }
      return { release: true, consuming: [first], blocked: false }
    }
    case 'any_failed': {
      const first = failed[0]
      if (first === undefined) return { release: false, consuming: [], blocked: allSettled }
      return { release: true, consuming: [first], blocked: false }
    }
    case 'all_done':
      return { release: allSettled, consuming: allSettled ? settled : [], blocked: false }
    default:
      return NOTHING
  }
}
