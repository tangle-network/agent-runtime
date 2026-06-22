/**
 * `ArtifactRegistry` — a typed catalog of profile artifacts with stable ids.
 *
 * The registry is the lifecycle's source of truth for "what pieces could go into
 * this agent's profile". It holds `register` / `list` / `get` / `promote`, assigns
 * stable ids, and can `compose` a subset of artifacts onto a baseline profile via
 * the single `applyArtifact` bridge. It owns NO measurement, NO gate, NO LLM — it
 * is a pure in-memory store so callers can persist/snapshot it however they like.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import { applyArtifacts } from './apply'
import type { ArtifactInput, ArtifactKind, ArtifactStatus, ProfileArtifact } from './types'

/** Filter for `list`. Omit a field to leave that dimension unconstrained. */
export interface ArtifactQuery {
  kind?: ArtifactKind
  status?: ArtifactStatus
}

/**
 * The metadata key under which the registry stores an artifact's measured held-
 * back lift. This is the registry INVARIANT's anchor: an artifact is `active`
 * IFF this key holds a finite number — see `promoteWithLift` and `liftOf`. The
 * lifecycle never promotes by status flag alone; the lift score is the receipt.
 * `driftWatch` overwrites it with the latest re-measure so `liftOf` always
 * reflects the most recent evidence.
 */
export const liftMetadataKey = 'measuredLift'

/**
 * The metadata key under which the registry records WHY an artifact left the
 * active set — the human-readable reason a `demote` (→ decayed) or `retire`
 * (→ retired) carried. Kept so a demotion/retirement is auditable, not silent.
 */
export const lifecycleReasonKey = 'lifecycleReason'

/**
 * A typed, in-memory registry of `ProfileArtifact`s with stable ids.
 *
 * Ids are stable for the life of the registry: `register` assigns one (or honors
 * a caller-supplied id idempotently), and no later operation reassigns it.
 * Re-registering the same id REPLACES the artifact's mutable fields but preserves
 * the id, so a re-proposed candidate keeps its identity across generations.
 */
export class ArtifactRegistry {
  private readonly artifacts = new Map<string, ProfileArtifact>()
  private counter = 0

  /**
   * Register an artifact, returning the stored record (with its assigned id).
   * When `input.id` is set it is honored (idempotent re-registration replaces
   * the record under the same id); otherwise a stable id is minted as
   * `<kind>-<n>`. `status` defaults to `'candidate'`.
   */
  register<K extends ArtifactKind>(input: ArtifactInput<K>): ProfileArtifact<K> {
    const id = input.id ?? this.mintId(input.kind)
    if (input.id !== undefined && (input.id.length === 0 || input.id.trim() !== input.id)) {
      throw new ValidationError(
        `ArtifactRegistry.register: explicit id must be a non-empty, untrimmed-free string (got ${JSON.stringify(input.id)})`,
      )
    }
    const record: ProfileArtifact<K> = {
      id,
      kind: input.kind,
      key: input.key,
      name: input.name,
      description: input.description,
      payload: input.payload,
      status: input.status ?? 'candidate',
      metadata: input.metadata,
    }
    this.artifacts.set(id, record as ProfileArtifact)
    return record
  }

  /** Get an artifact by id, or `undefined` if it was never registered. */
  get(id: string): ProfileArtifact | undefined {
    return this.artifacts.get(id)
  }

  /**
   * List artifacts, optionally filtered by `kind` and/or `status`. Returns a new
   * array in registration order; callers may safely sort/mutate the result.
   */
  list(query: ArtifactQuery = {}): ProfileArtifact[] {
    const out: ProfileArtifact[] = []
    for (const artifact of this.artifacts.values()) {
      if (query.kind !== undefined && artifact.kind !== query.kind) continue
      if (query.status !== undefined && artifact.status !== query.status) continue
      out.push(artifact)
    }
    return out
  }

  /**
   * Mark an artifact `active`. Fails loud on an unknown id — promoting a
   * non-existent artifact is a caller bug, not a no-op. Returns the updated
   * record. Idempotent: promoting an already-active artifact is a no-op return.
   *
   * NOTE: the artifact-lifecycle INVARIANT (no measured lift ⇒ not active) is
   * enforced by `promoteWithLift`, the path the closed loop uses. This bare
   * `promote` exists for callers that gate elsewhere and just flip the flag; it
   * does NOT record a lift score, so `liftOf` returns `undefined` and a
   * lift-ranked `composeProfile` will skip it. Prefer `promoteWithLift`.
   */
  promote(id: string): ProfileArtifact {
    const artifact = this.artifacts.get(id)
    if (!artifact) {
      throw new ValidationError(
        `ArtifactRegistry.promote: no artifact with id ${JSON.stringify(id)} is registered`,
      )
    }
    if (artifact.status === 'active') return artifact
    const promoted: ProfileArtifact = { ...artifact, status: 'active' }
    this.artifacts.set(id, promoted)
    return promoted
  }

  /**
   * Promote an artifact AND record the measured held-back lift that earned it.
   * This is the closed loop's promotion path and the enforcement point of the
   * lifecycle invariant: an artifact becomes `active` only WITH a finite lift
   * number stamped under `liftMetadataKey`. A non-finite `lift` (NaN/Infinity)
   * fails loud — promoting on a broken measurement is exactly the silent-zero the
   * doctrine forbids. Re-promotes a `decayed` artifact whose lift recovered.
   * Returns the updated record.
   */
  promoteWithLift(id: string, lift: number): ProfileArtifact {
    if (!Number.isFinite(lift)) {
      throw new ValidationError(
        `ArtifactRegistry.promoteWithLift: lift for ${JSON.stringify(id)} must be a finite number (got ${lift})`,
      )
    }
    const artifact = this.artifacts.get(id)
    if (!artifact) {
      throw new ValidationError(
        `ArtifactRegistry.promoteWithLift: no artifact with id ${JSON.stringify(id)} is registered`,
      )
    }
    const promoted: ProfileArtifact = {
      ...artifact,
      status: 'active',
      metadata: { ...artifact.metadata, [liftMetadataKey]: lift },
    }
    this.artifacts.set(id, promoted)
    return promoted
  }

  /**
   * Demote an `active` artifact to `decayed`: it was promoted, but a later
   * re-measure (`driftWatch`) found its held-back lift fell below the keep-bar.
   * Records the latest re-measured `lift` (so `liftOf` reflects current evidence)
   * and the `reason` (so the demotion is auditable). The artifact stays in the
   * registry — `decayed`, not deleted — so it can be re-promoted if a future
   * re-measure recovers the lift. Fails loud on an unknown id. Demoting a
   * non-`active` artifact fails loud too: only the active set decays.
   */
  demote(id: string, reason: string, lift?: number): ProfileArtifact {
    const artifact = this.artifacts.get(id)
    if (!artifact) {
      throw new ValidationError(
        `ArtifactRegistry.demote: no artifact with id ${JSON.stringify(id)} is registered`,
      )
    }
    if (artifact.status !== 'active') {
      throw new ValidationError(
        `ArtifactRegistry.demote: artifact ${JSON.stringify(id)} is '${artifact.status}', not 'active' — only an active artifact can decay`,
      )
    }
    if (lift !== undefined && !Number.isFinite(lift)) {
      throw new ValidationError(
        `ArtifactRegistry.demote: re-measured lift for ${JSON.stringify(id)} must be a finite number (got ${lift})`,
      )
    }
    const demoted: ProfileArtifact = {
      ...artifact,
      status: 'decayed',
      metadata: {
        ...artifact.metadata,
        [lifecycleReasonKey]: reason,
        ...(lift !== undefined ? { [liftMetadataKey]: lift } : {}),
      },
    }
    this.artifacts.set(id, demoted)
    return demoted
  }

  /**
   * Retire an artifact to the terminal `retired` state: it is permanently out of
   * the active set (`dedupeArtifacts` retires the weaker half of a non-stacking
   * pair). Records the `reason` for the audit trail. Unlike `demote`, this is
   * terminal — a retired artifact is never re-promoted by the loop. Idempotent on
   * an already-retired artifact; fails loud on an unknown id.
   */
  retire(id: string, reason: string): ProfileArtifact {
    const artifact = this.artifacts.get(id)
    if (!artifact) {
      throw new ValidationError(
        `ArtifactRegistry.retire: no artifact with id ${JSON.stringify(id)} is registered`,
      )
    }
    if (artifact.status === 'retired') return artifact
    const retired: ProfileArtifact = {
      ...artifact,
      status: 'retired',
      metadata: { ...artifact.metadata, [lifecycleReasonKey]: reason },
    }
    this.artifacts.set(id, retired)
    return retired
  }

  /**
   * The measured held-back lift recorded at promotion time (and overwritten by
   * the latest `driftWatch` re-measure), or `undefined` when the artifact was
   * never promoted WITH a lift (a fresh candidate, or one promoted via the bare
   * `promote`). The lifecycle invariant in one accessor: `liftOf(id) ===
   * undefined` ⇒ the artifact has no measured lift ⇒ it is not eligible for a
   * lift-ranked compose. Note this returns the recorded lift regardless of status
   * — `composeProfile` separately filters to `active`, so a `decayed` artifact's
   * stale lift is visible for audit but never folded into a profile.
   */
  liftOf(id: string): number | undefined {
    const value = this.artifacts.get(id)?.metadata?.[liftMetadataKey]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }

  /**
   * Compose a set of registered artifacts onto a baseline profile. With no ids
   * given, composes every `active` artifact (the "ship the passing set"
   * default). With explicit ids, composes exactly those (in id order given),
   * failing loud on any unknown id. The applied order is the order passed (or
   * registration order for the active-default), and later artifacts win on key
   * conflicts — same semantics as `applyArtifacts`.
   */
  compose(base: AgentProfile, ids?: readonly string[]): AgentProfile {
    const selected =
      ids === undefined
        ? this.list({ status: 'active' })
        : ids.map((id) => {
            const artifact = this.artifacts.get(id)
            if (!artifact) {
              throw new ValidationError(
                `ArtifactRegistry.compose: no artifact with id ${JSON.stringify(id)} is registered`,
              )
            }
            return artifact
          })
    return applyArtifacts(base, selected)
  }

  /** Number of registered artifacts (any status). */
  get size(): number {
    return this.artifacts.size
  }

  private mintId(kind: ArtifactKind): string {
    let id: string
    do {
      this.counter += 1
      id = `${kind}-${this.counter}`
    } while (this.artifacts.has(id))
    return id
  }
}

/** Construct an empty `ArtifactRegistry`. */
export function createArtifactRegistry(): ArtifactRegistry {
  return new ArtifactRegistry()
}
