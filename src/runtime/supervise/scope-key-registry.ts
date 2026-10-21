import { ValidationError } from '../../errors'
import type { LiveChild, ScopeArgs } from './scope-contract'
import type { NodeExecutionIdentity, NodeId, ResumedKeyState, Settled } from './types'

/** One semantic key's current assignment state. */
export type ScopeKeyState<Out> =
  | { readonly state: 'live'; readonly id: NodeId; readonly identity: NodeExecutionIdentity }
  | {
      readonly state: 'done'
      readonly id: NodeId
      readonly identity: NodeExecutionIdentity
      readonly settled: Settled<Out> & { kind: 'done' }
    }
  | {
      readonly state: 'down'
      readonly id: NodeId
      readonly identity: NodeExecutionIdentity
      readonly reason: string
    }
  | { readonly state: 'in-doubt'; readonly id: NodeId; readonly identity: NodeExecutionIdentity }

/**
 * The semantic-key registry (`SpawnOpts.key`): every keyed assignment's current state, seeded
 * from the prior journal on resume and updated live as keyed children spawn and settle. This is
 * what makes a keyed spawn idempotent per key across process lifetimes: `done` returns the
 * committed result, `live` refuses a concurrent duplicate, `down` retries after a terminal
 * receipt, and `in-doubt` refuses until the exact prior execution is recovered.
 */
export class ScopeKeyRegistry<Out> {
  private readonly keyed = new Map<string, ScopeKeyState<Out>>()

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

  markLive(key: string, id: NodeId, identity: NodeExecutionIdentity): void {
    this.keyed.set(key, { state: 'live', id, identity })
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
  if (prior.state === 'down' && prior.settled?.kind === 'down') {
    return { state: 'down', id: prior.id, identity, reason: prior.settled.reason }
  }
  if (prior.state === 'down' && prior.settled === undefined) {
    // A derived `down`: the resume itself proved the attempt dead (an `inline` runtime cannot
    // outlive its process), so there is no settlement to fold — the derived reason is the
    // terminal evidence a same-key re-spawn reports as `resumed: "retried"`.
    return {
      state: 'down',
      id: prior.id,
      identity,
      reason: prior.reason ?? 'interrupted: resume proved the prior attempt dead',
    }
  }
  return { state: 'in-doubt', id: prior.id, identity }
}
