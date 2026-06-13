/**
 * @experimental
 *
 * EffortPolicy — pure data, no execution. Resolves a named tier into a flat
 * settings object the Intelligence wrapper reads to decide WHICH intelligence
 * spawns are admitted. The composer never runs anything; it only describes the
 * shape of intelligence a tier permits.
 *
 * The billing boundary lives one layer above this (the wrapper tags trace usage
 * by class). What this module owns is the single law the OFF tier rests on:
 * `'off'` ⇒ every intelligence knob OFF (analysts:false, corpus:'off',
 * fanout:1, loops:false, intelligenceBudgetUsd:0). At OFF the wrapper runs the
 * agent as pure passthrough and only intelligence-class usage can prove to be
 * zero — there is nothing to spawn.
 */

/** The named effort tiers, lowest to highest. `'off'` is the honest floor
 *  below `'eco'`: intelligence fully off, telemetry still best-effort. */
export type EffortTier = 'off' | 'eco' | 'standard' | 'thorough' | 'max'

/** Corpus access an intelligence tier permits. `'off'` reads and writes
 *  nothing; `'read'` consults the cross-run corpus without contributing;
 *  `'read-write'` both consults and accumulates. */
export type CorpusAccess = 'off' | 'read' | 'read-write'

/**
 * The flat, resolved settings a tier compiles to. Every field is individually
 * overridable through `resolveEffort`. Pure data — read by the wrapper, never
 * self-executing.
 */
export interface EffortSettings {
  /** Whether trace-derived analyst diagnosis may spawn. `false` ⇒ no analyst. */
  analysts: boolean
  /** Cross-run corpus access this tier permits. */
  corpus: CorpusAccess
  /** Parallel candidate width. `1` ⇒ single-shot, no breadth. */
  fanout: number
  /** Whether multi-step improvement loops (refine / fanout-vote) may run. */
  loops: boolean
  /**
   * Ceiling, in USD, for INTELLIGENCE-class spawns only (analysts, corpus,
   * loops) — NOT base inference. `0` refuses every intelligence spawn; `null`
   * means uncapped (the spend lands on the Pareto receipt). Base-stream
   * inference is billed on its own channel and is never constrained here.
   */
  intelligenceBudgetUsd: number | null
}

/** Per-field overrides applied on top of a tier preset. Any subset of the
 *  resolved settings; each provided field wins over the preset. */
export type EffortOverrides = Partial<EffortSettings>

const presets: Readonly<Record<EffortTier, Readonly<EffortSettings>>> = {
  off: {
    analysts: false,
    corpus: 'off',
    fanout: 1,
    loops: false,
    intelligenceBudgetUsd: 0,
  },
  eco: {
    analysts: true,
    corpus: 'read',
    fanout: 1,
    loops: false,
    intelligenceBudgetUsd: 0.25,
  },
  standard: {
    analysts: true,
    corpus: 'read-write',
    fanout: 3,
    loops: true,
    intelligenceBudgetUsd: 2,
  },
  thorough: {
    analysts: true,
    corpus: 'read-write',
    fanout: 5,
    loops: true,
    intelligenceBudgetUsd: 10,
  },
  max: {
    analysts: true,
    corpus: 'read-write',
    fanout: 8,
    loops: true,
    intelligenceBudgetUsd: null,
  },
}

/** The default tier when a client declares no effort. `'standard'` turns
 *  intelligence on with sensible knobs; opt down to `'off'`/`'eco'` or up to
 *  `'thorough'`/`'max'`. */
export const defaultEffortTier: EffortTier = 'standard'

/**
 * Compile a named tier (plus optional per-field overrides) into the flat
 * `EffortSettings` the wrapper reads. Pure: same inputs → same object, no I/O,
 * no execution. Fails loud on an unknown tier rather than silently defaulting —
 * a typo'd tier must not quietly grant or deny intelligence.
 *
 * Invariant preserved for the billing floor: `resolveEffort('off')` always
 * yields `intelligenceBudgetUsd: 0` with every intelligence knob off UNLESS the
 * caller explicitly overrides a field — overriding off is an opt-in the caller
 * owns, not a default the composer leaks.
 */
export function resolveEffort(tier: EffortTier, overrides?: EffortOverrides): EffortSettings {
  const preset = presets[tier]
  if (!preset) {
    throw new Error(
      `resolveEffort: unknown effort tier ${JSON.stringify(tier)} (expected one of ${(
        Object.keys(presets) as EffortTier[]
      )
        .map((t) => `'${t}'`)
        .join(', ')})`,
    )
  }
  return { ...preset, ...(overrides ?? {}) }
}

/**
 * True when these settings admit NO intelligence spawn — the passthrough
 * predicate the wrapper branches on. Every intelligence axis must be off:
 * analysts disabled, corpus off, no breadth, no loops, and a zero intelligence
 * budget. A caller who overrides any one of these back on is no longer at the
 * OFF floor and the wrapper treats them as an intelligence-enabled run.
 */
export function isIntelligenceOff(settings: EffortSettings): boolean {
  return (
    settings.analysts === false &&
    settings.corpus === 'off' &&
    settings.fanout <= 1 &&
    settings.loops === false &&
    settings.intelligenceBudgetUsd === 0
  )
}
