/**
 * `CandidateGenerator` — the ONE per-surface seam of the artifact lifecycle.
 *
 * Everything else in the lifecycle (measure → gate → store → compose) is
 * surface-agnostic: it operates on `ProfileArtifact`s regardless of whether they
 * are skills, tools, prompts, or MCP servers. The ONLY thing that varies by
 * surface is HOW a fresh candidate piece is produced from the agent's history —
 * a skill is DISTILLED from traces then refined; a tool grant is proposed from a
 * "the agent lacked an action" finding; a prompt line is drafted from a recurring
 * mistake. That per-surface logic is isolated here, behind one interface, so the
 * orchestrator never grows a `switch (surface)`.
 *
 * A generator is pure-ish: given the lifecycle context (the baseline profile, the
 * captured traces/findings, the registry of what already exists), it returns zero
 * or more `ArtifactInput`s — candidate pieces that have NOT been measured yet.
 * The orchestrator owns registration, measurement, gating, and storage; the
 * generator owns only "what new pieces could this surface contribute".
 *
 * This is the interface the per-surface stages (skills, tools, prompt, mcp)
 * implement. The skill generator (`skillGenerator`) is the reference
 * implementation and the literal answer to "an empty profile has no skills":
 * its `distill` step CREATES a skill from traces (the step `skillOpt` cannot do),
 * then `refine` optimizes it.
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { ArtifactInput, ArtifactKind } from './types'

/**
 * The read-only context a generator sees when proposing candidates. It is the
 * agent's HISTORY (what to learn from) plus the agent's CURRENT shape (what
 * already exists, so the generator does not re-propose a duplicate).
 */
export interface GenerateContext {
  /** The baseline profile candidates are proposed on top of. A generator reads
   *  it to avoid re-proposing something the profile already has. */
  baseline: AgentProfile
  /** The domain/agent id the lifecycle is running for — namespaces provenance
   *  and lets a generator scope its proposals (e.g. distill from this domain's
   *  traces only). */
  domain: string
  /** Trace-analyst findings to ground proposals in observed behavior. The
   *  firewall holds: these are OBSERVED signals, never judge verdicts. */
  findings: ReadonlyArray<AnalystFinding>
  /** Raw captured trace text/records to distill from, opaque to the
   *  orchestrator. A skill generator's `distill` reads this; a tool generator
   *  may ignore it and read `findings` instead. */
  traces?: unknown
  /** Cooperative cancellation, forwarded from `runLifecycle`. */
  signal?: AbortSignal
}

/**
 * Produces fresh, UNMEASURED candidate artifacts for ONE profile surface.
 *
 * `kind` is the `ArtifactKind` this generator targets (so the orchestrator can
 * report and group by surface). `generate` returns candidate inputs the
 * orchestrator will register, measure (`measureMarginalLift`), gate
 * (`HeldOutGate`), and — on a pass — promote into the registry. Returning `[]`
 * is valid: the surface had nothing to contribute this round.
 */
export interface CandidateGenerator<K extends ArtifactKind = ArtifactKind> {
  /** The profile surface this generator targets. */
  kind: K
  /**
   * Propose candidate artifacts from the lifecycle context. MUST NOT measure,
   * gate, or register — that is the orchestrator's job. MUST NOT mutate
   * `ctx.baseline`. Returns unmeasured `ArtifactInput`s (no lift score yet); the
   * orchestrator stamps provenance + the measured lift before promotion.
   */
  generate(ctx: GenerateContext): Promise<ArtifactInput<K>[]>
}
