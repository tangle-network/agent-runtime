/**
 * `createGraphEngine` — one engine instance: its kind registry (core kinds pre-registered, host
 * kinds added by the caller), its effect table, and nothing global.
 *
 * The scheduler (#980), journal fold (#981) and the `runGraph` preset (#982) attach here; this
 * file is the part that must exist first so a host can register kinds and a compiler can ask
 * "which effects does this graph need" before a token is spent.
 */

import { ValidationError } from '../../errors'
import type { EffectName, NodeKind } from './kind'
import { validateNodeKind } from './kind'
import { createRegistry, type Registry } from './registry'

export interface GraphEngineOptions {
  /** Kinds to register beside the core set. A host adds its own here; nothing is global. */
  readonly kinds?: ReadonlyArray<NodeKind>
  /** The host's effect table, by name. A kind receives only the effects it declared. */
  readonly effects?: Readonly<Record<EffectName, unknown>>
  /** The core set. Injected so a test can substitute, and so the engine never imports a
   *  backend-specific factory at module load. */
  readonly coreKinds: ReadonlyArray<NodeKind>
}

export interface GraphEngine {
  readonly kinds: Registry<NodeKind>
  readonly effects: Readonly<Record<EffectName, unknown>>
  /** Every effect name any registered kind declares — what a host must provide for this engine's
   *  whole kind set to be runnable. Listed, never discovered mid-run. */
  requiredEffects(): string[]
  /** The declared effects no host value covers. Empty means every registered kind is runnable. */
  missingEffects(): string[]
}

/**
 * Build one engine: a kind registry seeded with the core kinds plus the host's, and the host's
 * effect values. Every kind is validated by name at construction, so a malformed host kind fails
 * here, never at its first node.
 */
export function createGraphEngine(options: GraphEngineOptions): GraphEngine {
  const kinds = createRegistry<NodeKind>('graph kinds')
  for (const kind of options.coreKinds) kinds.register(validateNodeKind(kind, 'createGraphEngine'))
  for (const kind of options.kinds ?? [])
    kinds.register(validateNodeKind(kind, 'createGraphEngine'))
  const effects = Object.freeze({ ...(options.effects ?? {}) })
  if (Object.keys(effects).some((name) => name.length === 0)) {
    throw new ValidationError('createGraphEngine: an effect name must be non-empty')
  }
  const engine: GraphEngine = {
    kinds,
    effects,
    requiredEffects(): string[] {
      const names = new Set<string>()
      for (const kind of kinds.entries()) for (const name of kind.effects) names.add(name)
      return Array.from(names).sort()
    },
    missingEffects(): string[] {
      return engine.requiredEffects().filter((name) => !(name in effects))
    },
  }
  return engine
}
