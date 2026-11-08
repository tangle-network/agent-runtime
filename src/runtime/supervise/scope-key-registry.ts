import { ValidationError } from '../../errors'
import type { LiveChild, ScopeArgs } from './scope-contract'
import type { Handle, NodeExecutionIdentity, NodeId, ResumedKeyState, Settled } from './types'

/** One semantic key's current assignment state. */
export type ScopeKeyState<Out> = {
  readonly id: NodeId
  readonly identity: NodeExecutionIdentity
} & (
  | { readonly state: 'live' | 'in-doubt' }
  | { readonly state: 'done'; readonly settled: Settled<Out> & { kind: 'done' } }
  | { readonly state: 'down'; readonly reason: string }
)

/**
 * The semantic-key registry (`SpawnOpts.key`), seeded from the journal on resume and updated as
 * keyed children spawn and settle: `done` returns the committed result, `live` refuses a duplicate
 * once a resume's recovered child is claimed, `down` retries, `in-doubt` refuses until recovered.
 */
export class ScopeKeyRegistry<Out> {
  private readonly keyed = new Map<string, ScopeKeyState<Out>>()
  private readonly unclaimed = new Map<string, Handle<Out>>()

  constructor(
    resumeFrom: ScopeArgs['resumeFrom'],
    private readonly children: Map<NodeId, LiveChild>,
  ) {
    for (const [key, prior] of resumeFrom?.keys ?? []) {
      // A key the journal never gave an identity is not seeded.
      if (prior.identity !== undefined) this.keyed.set(key, resumedKeyState(prior, prior.identity))
    }
  }

  get(key: string): ScopeKeyState<Out> | undefined {
    return this.keyed.get(key)
  }

  markLive(key: string, id: NodeId, identity: NodeExecutionIdentity, recovered?: Handle<Out>) {
    this.keyed.set(key, { state: 'live', id, identity })
    if (recovered !== undefined) this.unclaimed.set(key, recovered)
  }

  /** The child `id` this scope's resume recovered under `key`, for that key's first spawn only. */
  claimRecovered(key: string, id: NodeId): Handle<Out> | undefined {
    const handle = this.unclaimed.get(key)
    this.unclaimed.delete(key)
    return handle?.id === id ? handle : undefined
  }

  /** Fold a keyed child's terminal settlement back into the registry, so a later spawn with the
   *  same key resolves to it (done → committed result; down → explicit retry). */
  readonly recordSettlement = (key: string, settled: Settled<Out>): void => {
    const identity = settled.handle.identity
    if (identity === undefined) {
      throw new ValidationError(`scope: keyed settlement '${key}' lost its execution identity`)
    }
    if (this.children.get(settled.handle.id)?.recoveryPending) {
      this.keyed.set(key, { state: 'in-doubt', id: settled.handle.id, identity })
    } else if (settled.kind === 'done') {
      this.keyed.set(key, { state: 'done', id: settled.handle.id, identity, settled })
    } else {
      this.keyed.set(key, {
        state: 'down',
        id: settled.handle.id,
        identity,
        reason: settled.reason,
      })
    }
  }
}

/** A journaled key's state on resume. */
function resumedKeyState<Out>(
  prior: ResumedKeyState<unknown>,
  identity: NodeExecutionIdentity,
): ScopeKeyState<Out> {
  if (prior.state === 'completed' && prior.settled?.kind === 'done') {
    return {
      state: 'done',
      id: prior.id,
      identity,
      settled: prior.settled as Settled<Out> & { kind: 'done' },
    }
  }
  if (prior.state === 'down' && (prior.settled?.kind === 'down' || prior.settled === undefined)) {
    // With no settlement the resume derived the `down` (an `inline` runtime cannot outlive its
    // process); a same-key re-spawn reports that reason as `resumed: "retried"`.
    const reason =
      prior.settled?.kind === 'down'
        ? prior.settled.reason
        : (prior.reason ?? 'interrupted: resume proved the prior attempt dead')
    return { state: 'down', id: prior.id, identity, reason }
  }
  return { state: 'in-doubt', id: prior.id, identity }
}
