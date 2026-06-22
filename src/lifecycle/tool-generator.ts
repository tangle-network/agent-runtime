/**
 * `buildableGenerator` — the `CandidateGenerator` for the BUILDABLE surfaces
 * (`tool` and `mcp`), and the answer to "a profile can't *write* a new tool from
 * a prompt rewrite — who builds it?".
 *
 * Unlike the prompt and skill surfaces, where a candidate is a piece of TEXT an
 * LLM authors in one call, a tool or an MCP server is CODE that must compile,
 * pass its tests, and — for an MCP server — actually boot and serve. You cannot
 * one-shot that reliably. So this generator is a SUPERVISOR DISPATCH, not a
 * single author:
 *
 *   1. FAN OUT  — spawn N parallel candidate implementations, each built in its
 *                 OWN git worktree by a real coding harness (research → implement
 *                 → test → prove it compiles / actually serves). The per-candidate
 *                 build is the `buildCandidate` seam; production wires it to the
 *                 shipped `improvementDriver` + `agenticGenerator` + a verifier
 *                 (`commandVerifier` for a tool, `mcpServeVerifier` for an MCP).
 *   2. FILTER   — keep only the VERIFIED builds. An unverified worktree is never a
 *                 candidate (the verifier is the gate — same valid-only discipline
 *                 as `worktreeFanout`'s `selectValidWinner`). A build that never
 *                 compiles/serves is discarded, never ranked.
 *   3. RANK     — score each verified survivor by `measureMarginalLift` against
 *                 `ctx.baseline` (the with/without held-back ablation — the SAME
 *                 selector the rest of the lifecycle uses; never a judge).
 *   4. EMIT     — return the single best survivor as ONE `tool` / `mcp` artifact,
 *                 carrying the measured lift + the winning worktree ref as
 *                 auditable provenance in metadata.
 *
 * Steps 2–4 (filter, lift-rank, emit) are surface-agnostic and live here; only
 * `buildCandidate` (the per-candidate worktree build) varies, and it is INJECTED
 * — production wires the real harness fan-out, a test injects pure stubs so the
 * dispatch is deterministically exercisable without spawning processes or models.
 *
 * NB the lifecycle orchestrator (`runLifecycle`) STILL measures + gates whatever
 * this returns. The rank here is an INTERNAL selection — "which of the N parallel
 * builds is the best candidate to put forward" — not the promotion gate. A
 * generator that puts forward a measured-best candidate and an orchestrator that
 * re-measures it on the held-back exam are not redundant: the first picks among
 * siblings, the second decides whether the winner clears the bar to ship.
 */

import type { AgentProfileMcpServer } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import type { CandidateGenerator, GenerateContext } from './generator'
import { type EvalRunner, measureMarginalLift } from './marginal-lift'
import { ArtifactRegistry } from './registry'
import type { ArtifactInput, ProfileArtifact } from './types'

/** The buildable surfaces — the kinds whose candidate IS code that must compile
 *  / serve, so building one is a fan-out-and-verify dispatch, not a one-shot. */
export type BuildableKind = 'tool' | 'mcp'

/**
 * The result of building ONE candidate in its own worktree. A build either
 * verified (compiled + tests passed, or — for an MCP — booted and served) or it
 * did not; an unverified build is dropped before ranking, so `verified:false`
 * carries the reason for the audit trail but never becomes a candidate.
 */
export interface BuiltCandidate {
  /** A short label for this candidate (worktree branch / trace node). */
  label: string
  /** Did the build compile + pass its verifier? Only verified builds rank. */
  verified: boolean
  /** The worktree path / git ref holding the built change (provenance). */
  worktreeRef: string
  /**
   * For an `mcp` candidate: how to START the built server (stdio transport).
   * Becomes the `AgentProfileMcpServer` the artifact carries. REQUIRED for an
   * `mcp` build; ignored for a `tool` build.
   */
  serve?: { command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
  /**
   * For a `tool` candidate: the tool name the grant lands under (the profile
   * `tools` key). REQUIRED for a `tool` build; ignored for an `mcp` build.
   */
  toolName?: string
  /** Why the build failed verification, when `verified` is false (audit only). */
  failureReason?: string
  /** Free-form provenance to ride into the artifact metadata (build summary, …). */
  metadata?: Record<string, unknown>
}

/**
 * BUILD ONE candidate. Given the lifecycle context and the index in the fan-out,
 * produce a fresh worktree implementation and report whether it verified. The
 * production implementation drives a real coding harness in a fresh worktree
 * (`worktreeBuildCandidate`); a test injects a pure function.
 *
 * MUST NOT measure lift, gate, or register — that is the dispatch's / the
 * orchestrator's job. It only builds + verifies ONE sibling.
 */
export type BuildCandidate = (
  ctx: GenerateContext,
  index: number,
  signal: AbortSignal,
) => Promise<BuiltCandidate>

export interface BuildableGeneratorOptions {
  /** The buildable surface this generator targets (`tool` or `mcp`). */
  kind: BuildableKind
  /** The per-candidate build seam (the fan-out leaf). REQUIRED. */
  buildCandidate: BuildCandidate
  /** How many candidate implementations to build in parallel each generation.
   *  Default 3. Must be >= 1. The conserved-budget / live-worker caps that bound
   *  the real fan-out live in the production `buildCandidate` wiring. */
  fanout?: number
  /** Scores a profile on the held-back split — used to RANK the verified
   *  siblings by `measureMarginalLift`. REQUIRED: without it there is no way to
   *  pick the best of N, and "best" is the whole point of a fan-out. */
  evalRunner: EvalRunner
}

/**
 * Build a `CandidateGenerator` for a buildable surface (`tool` / `mcp`). Each
 * generation it fans out `fanout` parallel worktree builds, keeps the verified
 * ones, ranks them by held-back marginal lift, and emits the single best as one
 * artifact. Returns `[]` when no build verifies — the surface had nothing
 * shippable to contribute this round (a valid, common outcome for hard builds).
 *
 * @example Production wiring (build = real harness fan-out, rank = held-back eval):
 *   buildableGenerator({
 *     kind: 'mcp',
 *     buildCandidate: worktreeBuildCandidate({ repoRoot, harness: 'claude' }),
 *     evalRunner: scoreOnHeldBackSplit,
 *     fanout: 4,
 *   })
 */
export function buildableGenerator(
  opts: BuildableGeneratorOptions,
): CandidateGenerator<BuildableKind> {
  const fanout = opts.fanout ?? 3
  if (fanout < 1) {
    throw new ValidationError(
      `buildableGenerator: fanout must be >= 1 (got ${fanout}) — a dispatch with no candidates can never build anything`,
    )
  }

  return {
    kind: opts.kind,
    async generate(ctx): Promise<ArtifactInput<BuildableKind>[]> {
      const signal = ctx.signal ?? new AbortController().signal

      // 1. FAN OUT — N parallel candidate builds, each in its own worktree.
      const settled = await Promise.all(
        Array.from({ length: fanout }, (_unused, i) => opts.buildCandidate(ctx, i, signal)),
      )

      // 2. FILTER — only VERIFIED builds are candidates. An unverified worktree
      //    (failed to compile / never served) is discarded, never ranked.
      const verified = settled.filter((b) => b.verified)
      if (verified.length === 0) return []

      // 3. RANK — score each survivor by the held-back ablation against the
      //    shared baseline (measured once, reused across siblings).
      const baselineResult = await opts.evalRunner(ctx.baseline, signal)
      const ranked: Array<{ built: BuiltCandidate; scoreDelta: number; costDelta: number }> = []
      for (const built of verified) {
        if (signal.aborted) break
        // Stage each survivor as a throwaway artifact so the SAME `applyArtifact`
        // bridge `measureMarginalLift` uses elsewhere applies the built surface.
        const probe = stageProbeArtifact(opts.kind, built)
        const lift = await measureMarginalLift({
          baseline: ctx.baseline,
          candidate: probe,
          evalRunner: opts.evalRunner,
          baselineResult,
          signal,
        })
        ranked.push({ built, scoreDelta: lift.scoreDelta, costDelta: lift.costDelta })
      }
      if (ranked.length === 0) return []

      // 4. EMIT the single best survivor as one artifact. Ties → the
      //    earliest-built (the fan-out order) wins, matching the kernel's
      //    `defaultSelectWinner` tie-break.
      ranked.sort((a, b) => b.scoreDelta - a.scoreDelta)
      const winner = ranked[0]!
      return [toArtifact(opts.kind, winner.built, winner.scoreDelta, winner.costDelta, fanout)]
    },
  }
}

/**
 * A throwaway artifact used ONLY to drive `applyArtifact` inside the internal
 * rank — it is registered into a private registry (never the lifecycle's), so it
 * gets a real id for `measureMarginalLift` without polluting the caller's
 * catalog. The orchestrator re-registers the EMITTED winner with provenance.
 */
const probeRegistry = new ArtifactRegistry()
function stageProbeArtifact(kind: BuildableKind, built: BuiltCandidate): ProfileArtifact {
  return probeRegistry.register(bareArtifact(kind, built))
}

/** The artifact shape for a built candidate, WITHOUT the lift/provenance the
 *  emit step stamps — shared by the probe (internal rank) and the emit. */
function bareArtifact(kind: BuildableKind, built: BuiltCandidate): ArtifactInput<BuildableKind> {
  if (kind === 'tool') {
    const toolName = built.toolName
    if (!toolName || toolName.trim().length === 0) {
      throw new ValidationError(
        `buildableGenerator: a verified 'tool' build must report a toolName (label=${built.label})`,
      )
    }
    return {
      kind: 'tool',
      key: toolName,
      name: toolName,
      payload: { enabled: true },
    } as ArtifactInput<BuildableKind>
  }
  const serve = built.serve
  if (!serve?.command || serve.command.trim().length === 0) {
    throw new ValidationError(
      `buildableGenerator: a verified 'mcp' build must report a serve command (label=${built.label})`,
    )
  }
  const server: AgentProfileMcpServer = {
    transport: 'stdio',
    command: serve.command,
    ...(serve.args ? { args: serve.args } : {}),
    ...(serve.cwd ? { cwd: serve.cwd } : { cwd: built.worktreeRef }),
    ...(serve.env ? { env: serve.env } : {}),
    enabled: true,
  }
  return {
    kind: 'mcp',
    key: built.label,
    name: built.label,
    payload: { server },
  } as ArtifactInput<BuildableKind>
}

/** The EMITTED winner: the bare artifact plus the measured lift + worktree
 *  provenance in metadata, so the promotion decision is auditable. The
 *  orchestrator stamps domain/generation provenance on top when it registers. */
function toArtifact(
  kind: BuildableKind,
  built: BuiltCandidate,
  scoreDelta: number,
  costDelta: number,
  fanout: number,
): ArtifactInput<BuildableKind> {
  const bare = bareArtifact(kind, built)
  return {
    ...bare,
    description: `built via ${fanout}-way fan-out; won on +${scoreDelta.toFixed(4)} held-back lift`,
    metadata: {
      ...built.metadata,
      worktreeRef: built.worktreeRef,
      buildLabel: built.label,
      fanout,
      // The INTERNAL rank lift (best-of-N selection), distinct from the
      // orchestrator's promotion-gate measurement.
      siblingScoreDelta: scoreDelta,
      siblingCostDelta: costDelta,
    },
  }
}
