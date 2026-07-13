/**
 * `worktreeBuildCandidate` — the PRODUCTION `BuildCandidate`: one fan-out leaf
 * that builds a real tool / MCP server in a fresh git worktree with a real
 * coding harness, and verifies it by the surface's intrinsic check.
 *
 * It is the wiring that makes `buildableGenerator`'s dispatch real, composed
 * entirely from shipped engines — NO new execution model:
 *
 *   - `gitWorktreeAdapter` (agent-eval/campaign) cuts the isolated worktree.
 *   - `improvementDriver` (this repo) owns the worktree lifecycle (create →
 *     generate → finalize/discard) and drives ONE candidate.
 *   - `agenticGenerator` (this repo) runs the coding harness IN the worktree
 *     with the surface's build-prompt (`toolBuildPrompt` / `mcpBuildPrompt`):
 *     research → implement → test, multi-shot resume-on-failure.
 *   - the surface's verifier proves the result: `commandVerifier('pnpm', ['test'])`
 *     for a tool (compiles + tests pass), `mcpServeVerifier(serve)` for an MCP
 *     (boots over stdio + answers `tools/list`). A build that never verifies is
 *     dropped by `agenticGenerator` (no `CodeSurface` finalized) → `verified:false`.
 *
 * Kept out of `tool-generator.ts` so the dispatch core stays process-free and
 * unit-testable; this file is the one call a consumer makes to wire the real
 * harness fan-out.
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import {
  type CodeSurface,
  gitWorktreeAdapter,
  resolveWorktreePath,
} from '@tangle-network/agent-eval/campaign'
import { ValidationError } from '../errors'
import { agenticGenerator, commandVerifier } from '../improvement/agentic-generator'
import { mcpBuildPrompt, toolBuildPrompt } from '../improvement/build-prompts'
import { driverLoopGenerator } from '../improvement/driver-loop-generator'
import { type McpServeSpec, mcpServeVerifier } from '../improvement/mcp-serve-verifier'
import type { LocalHarness } from '../mcp/local-harness'
import type { ToolLoopChat } from '../runtime/tool-loop'
import type { GenerateContext } from './generator'
import type { BuildableKind, BuildCandidate, BuiltCandidate } from './tool-generator'

export interface WorktreeBuildOptions {
  /** The buildable surface to build (`tool` / `mcp`). */
  kind: BuildableKind
  /** Absolute path to the git checkout each candidate worktree is cut from. */
  repoRoot: string
  /** Which local coding harness drives the build. Default `claude`. */
  harness?: LocalHarness
  /** Base ref each worktree forks from. Default `main`. */
  baseRef?: string
  /** Max harness shots per candidate (the depth dial — resume-on-failure). Default 3. */
  maxShots?: number
  /** Per-shot wall-clock timeout (ms). Forwarded to `agenticGenerator`. */
  timeoutMs?: number
  /**
   * For a `tool` build: the verify command (run in the worktree, exit 0 = pass)
   * and the tool name the resulting grant lands under. Default command
   * `pnpm test`.
   */
  tool?: { verifyCommand?: string; verifyArgs?: string[]; toolName: string }
  /**
   * For an `mcp` build: how to BOOT the built server (the boot-and-probe spec)
   * — used both to verify it serves AND as the artifact's start command. The
   * `cwd` defaults to the candidate worktree.
   */
  mcp?: McpServeSpec
  /**
   * The driver-LLM seam (the canonical `ToolLoopChat`, e.g. `routerBrain(cfg)`).
   * When set — the default composition for tool/mcp builds — the build runs the
   * driver→worker atom (`driverLoopGenerator`): a driver LLM authors each worker
   * instruction, observes the session's diff + verifier output, rates it, and
   * decides refine / re-scope / decompose. Unset ⇒ the plain multi-shot
   * `agenticGenerator` (canned resume notes, no LLM driver) — the offline path.
   */
  driver?: { brain: ToolLoopChat; maxTurns?: number }
}

/**
 * Build the production per-candidate seam for `buildableGenerator`. Each call to
 * the returned `BuildCandidate` cuts a fresh worktree, drives the harness to
 * implement + verify the surface, and reports the verified worktree (or
 * `verified:false` with the reason) back to the dispatch for ranking.
 */
export function worktreeBuildCandidate(opts: WorktreeBuildOptions): BuildCandidate {
  const harness = opts.harness ?? 'claude'
  const baseRef = opts.baseRef ?? 'main'
  const maxShots = opts.maxShots ?? 3
  const worktree = gitWorktreeAdapter({
    repoRoot: opts.repoRoot,
    branchPrefix: `build-${opts.kind}`,
  })

  // The build generator: surface-specific build-prompt + surface-specific
  // verifier, everything else shared. With a driver brain configured the
  // driver→worker atom steers the sessions (the default composition for
  // tool/mcp); without one, the offline multi-shot respawn loop runs.
  const shared = {
    harness,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    buildPrompt: opts.kind === 'mcp' ? mcpBuildPrompt : toolBuildPrompt,
    verify: buildVerifier(opts),
  }
  const generator = opts.driver
    ? driverLoopGenerator({
        ...shared,
        brain: opts.driver.brain,
        ...(opts.driver.maxTurns !== undefined ? { maxTurns: opts.driver.maxTurns } : {}),
      })
    : agenticGenerator(shared)

  return async (
    ctx: GenerateContext,
    index: number,
    signal: AbortSignal,
  ): Promise<BuiltCandidate> => {
    const label = `${opts.kind}-cand${index}`
    const wt = await worktree.create({ baseRef, label })
    try {
      const { applied, summary } = await generator.generate({
        worktreePath: wt.path,
        report: undefined,
        findings: [...ctx.findings] as AnalystFinding[],
        maxShots,
        signal,
      })
      if (!applied) {
        // The harness never produced a verified change — drop the worktree, and
        // report an unverified build so the dispatch ranks the survivors only.
        await worktree.discard(wt).catch(() => {})
        return {
          label,
          verified: false,
          worktreeRef: wt.path,
          failureReason: 'no verified candidate within maxShots',
        }
      }
      const surface = await worktree.finalize(wt, summary)
      return verifiedBuild(opts, label, surface)
    } catch (err) {
      await worktree.discard(wt).catch(() => {})
      throw err
    }
  }
}

/** The intrinsic verifier for the surface: `pnpm test` (tool) or boot-and-probe
 *  the MCP server (mcp). The verifier is what makes "verified" mean compiled +
 *  serves, not "the harness said it was done". */
function buildVerifier(opts: WorktreeBuildOptions) {
  if (opts.kind === 'mcp') {
    if (!opts.mcp) {
      throw new ValidationError(
        'worktreeBuildCandidate: an mcp build requires opts.mcp (the boot-and-probe serve spec)',
      )
    }
    return mcpServeVerifier(opts.mcp)
  }
  const command = opts.tool?.verifyCommand ?? 'pnpm'
  const args = opts.tool?.verifyArgs ?? (opts.tool?.verifyCommand ? [] : ['test'])
  return commandVerifier(command, args)
}

/** Turn a finalized `CodeSurface` into a verified `BuiltCandidate`, carrying the
 *  per-surface payload (tool name, or the MCP serve command) the artifact needs. */
function verifiedBuild(
  opts: WorktreeBuildOptions,
  label: string,
  surface: CodeSurface,
): BuiltCandidate {
  const worktreeRef = resolveWorktreePath(surface)
  if (opts.kind === 'tool') {
    const toolName = opts.tool?.toolName
    if (!toolName || toolName.trim().length === 0) {
      throw new ValidationError(
        'worktreeBuildCandidate: a tool build requires opts.tool.toolName for the grant key',
      )
    }
    return {
      label,
      verified: true,
      worktreeRef,
      toolName,
      metadata: { summary: surface.summary, baseRef: surface.baseRef },
    }
  }
  const mcp = opts.mcp!
  return {
    label,
    verified: true,
    worktreeRef,
    serve: {
      command: mcp.command,
      ...(mcp.args ? { args: mcp.args } : {}),
      cwd: worktreeRef,
      ...(mcp.env ? { env: mcp.env } : {}),
    },
    metadata: { summary: surface.summary, baseRef: surface.baseRef },
  }
}
