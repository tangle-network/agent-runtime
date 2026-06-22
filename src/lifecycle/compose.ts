/**
 * `composeProfile` — fold the top-k active artifacts back into a profile.
 *
 * This is the "give it all the passing options at once" step. After the loop has
 * generated, measured, and promoted artifacts, `composeProfile` selects the
 * highest-lift ACTIVE ones (those promoted WITH a measured held-back lift) and
 * applies them onto a baseline profile via the single `applyArtifact` bridge.
 *
 * It differs from the registry's raw `compose` in two ways the lifecycle needs:
 *   1. It ranks by MEASURED LIFT and takes the top `k`, rather than applying
 *      every promoted artifact in registration order. The best pieces go in
 *      first; a `k` budget keeps the composed profile from accreting marginal
 *      wins without bound.
 *   2. It enforces the lifecycle INVARIANT — only artifacts with a finite
 *      `liftOf` are eligible. An artifact flipped to `promoted` without a lift
 *      receipt is invisible here, by construction.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { applyArtifacts } from './apply'
import type { ArtifactRegistry } from './registry'
import type { ArtifactKind, ProfileArtifact } from './types'

export interface ComposeProfileOptions {
  /** Cap on how many artifacts to fold in. Default: all eligible. */
  k?: number
  /** Restrict to one surface (e.g. only fold in skills). Default: all kinds. */
  kind?: ArtifactKind
}

/**
 * Return a new profile with the top-`k` active artifacts (highest measured lift
 * first) applied onto `base`.
 *
 * "Active" = promoted WITH a finite measured lift (`registry.liftOf` returns a
 * number) — the lifecycle invariant. Ties in lift fall back to registration
 * order (stable). With no `k`, every eligible artifact is folded in.
 *
 * @param registry the catalog the loop populated
 * @param base     the baseline profile to fold artifacts onto (the empty profile
 *                 on a cold start)
 * @param opts     `k` (top-k budget) and an optional `kind` filter
 *
 * @example Cold start — fold the single best distilled skill back in:
 *   const composed = composeProfile(registry, emptyProfile, { kind: 'skill', k: 1 })
 */
export function composeProfile(
  registry: ArtifactRegistry,
  base: AgentProfile,
  opts: ComposeProfileOptions = {},
): AgentProfile {
  const eligible: Array<{ artifact: ProfileArtifact; lift: number }> = []
  for (const artifact of registry.list({ status: 'active', kind: opts.kind })) {
    const lift = registry.liftOf(artifact.id)
    // Invariant: no measured lift ⇒ not eligible for a lift-ranked compose.
    if (lift === undefined) continue
    eligible.push({ artifact, lift })
  }

  // Highest lift first; stable on ties (Array.prototype.sort is stable in V8).
  eligible.sort((a, b) => b.lift - a.lift)

  const k = opts.k ?? eligible.length
  const selected = eligible.slice(0, Math.max(0, k)).map((e) => e.artifact)
  return applyArtifacts(base, selected)
}
