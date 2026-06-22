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
 * back lift at promotion time. This is the registry INVARIANT's anchor: an
 * artifact is `promoted` (active) IFF this key holds a finite number — see
 * `promoteWithLift` and `liftOf`. The lifecycle never promotes by status flag
 * alone; the lift score is the receipt.
 */
export const liftMetadataKey = 'measuredLift'

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
   * Mark an artifact `promoted`. Fails loud on an unknown id — promoting a
   * non-existent artifact is a caller bug, not a no-op. Returns the updated
   * record. Idempotent: promoting an already-promoted artifact is a no-op
   * return.
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
    if (artifact.status === 'promoted') return artifact
    const promoted: ProfileArtifact = { ...artifact, status: 'promoted' }
    this.artifacts.set(id, promoted)
    return promoted
  }

  /**
   * Promote an artifact AND record the measured held-back lift that earned it.
   * This is the closed loop's promotion path and the enforcement point of the
   * lifecycle invariant: an artifact becomes active (`promoted`) only WITH a
   * finite lift number stamped under `liftMetadataKey`. A non-finite `lift`
   * (NaN/Infinity) fails loud — promoting on a broken measurement is exactly the
   * silent-zero the doctrine forbids. Returns the updated record.
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
      status: 'promoted',
      metadata: { ...artifact.metadata, [liftMetadataKey]: lift },
    }
    this.artifacts.set(id, promoted)
    return promoted
  }

  /**
   * The measured held-back lift recorded at promotion time, or `undefined` when
   * the artifact was never promoted WITH a lift (a fresh candidate, or one
   * promoted via the bare `promote`). The lifecycle invariant in one accessor:
   * `liftOf(id) === undefined` ⇒ the artifact has no measured lift ⇒ it is not
   * eligible for a lift-ranked compose.
   */
  liftOf(id: string): number | undefined {
    const value = this.artifacts.get(id)?.metadata?.[liftMetadataKey]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }

  /**
   * Compose a set of registered artifacts onto a baseline profile. With no ids
   * given, composes every `promoted` artifact (the "ship the passing set"
   * default). With explicit ids, composes exactly those (in id order given),
   * failing loud on any unknown id. The applied order is the order passed (or
   * registration order for the promoted-default), and later artifacts win on key
   * conflicts — same semantics as `applyArtifacts`.
   */
  compose(base: AgentProfile, ids?: readonly string[]): AgentProfile {
    const selected =
      ids === undefined
        ? this.list({ status: 'promoted' })
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
