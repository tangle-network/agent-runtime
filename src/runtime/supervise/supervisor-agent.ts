/**
 * `supervisorAgent` — build a supervisor `Agent` FROM its profile. The brain is resolved from
 * `profile.harness` exactly as `createExecutor({ backend })` resolves a worker: backend-as-data,
 * no hand-built brain. The supervisor stops being special — it's one profile, materialized by the
 * same resolution rule as every other agent.
 *
 *  - `harness` null/undefined → the in-process router tool-loop: `coordinationDriverAgent` over the
 *    canonical `ToolLoopChat`, built by `routerBrain` from the profile's model + the router seam.
 *  - `harness` a coding CLI (`claude-code`/`opencode`/`codex`/…) → a SANDBOXED harness drives the
 *    coordination verbs: `serveCoordinationMcp` exposes spawn/await/steer/stop over the live scope,
 *    and the caller's `driveHarness` runs the harness with that MCP mounted. The harness IS the brain.
 *
 * Both arms spawn children through the SAME `makeWorkerAgent` seam and settle on the SAME completion
 * oracle (`finalizeBestDelivered` — the best DELIVERED child, never the driver's own prose).
 */
import { ValidationError } from '../../errors'
import type { MakeWorkerAgent } from '../../mcp/tools/coordination'
import { type RouterConfig, routerBrain } from '../router-client'
import type { ToolLoopChat } from '../tool-loop'
import { coordinationDriverAgent, finalizeBestDelivered } from './coordination-driver'
import { serveCoordinationMcp } from './coordination-mcp'
import type { Agent, Budget, ResultBlobStore, Scope } from './types'

/** The supervisor's profile — the subset of an `AgentProfile` that selects + shapes its brain.
 *  `harness` is the backend-as-data discriminant; `systemPrompt` is the standing instruction. */
export interface SupervisorProfile {
  readonly name?: string
  /** null/undefined → router brain (in-process tool-loop); a coding-CLI harness → sandboxed brain. */
  readonly harness?: string | null
  /** The router model when the brain is router-driven (falls back to the deps router config). */
  readonly model?: string
  /** The standing instructions ("you delegate, you do not solve"). */
  readonly systemPrompt?: string
}

/** How to run a sandboxed harness as the DRIVER, with the coordination verbs mounted — the substrate
 *  seam the caller supplies (mirrors `makeWorkerAgent` for spawned children). It runs `profile` on
 *  `task` in its backend (sandbox / cli-bridge) with `coordinationMcpUrl` mounted as an MCP server,
 *  so the harness calls spawn_agent / await_event / stop as native tools over the live scope. */
export type DriveHarness = (args: {
  readonly profile: SupervisorProfile
  readonly task: unknown
  readonly scope: Scope<unknown>
  readonly coordinationMcpUrl: string
}) => Promise<void>

export interface SupervisorAgentDeps {
  readonly blobs: ResultBlobStore
  /** Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms). */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget
  /** Router substrate for a router-brained supervisor (`harness` null). The profile's model wins. */
  readonly router?: RouterConfig
  /** Inject the brain directly (tests / advanced) instead of resolving `routerBrain` from the profile. */
  readonly brain?: ToolLoopChat
  /** Required for a sandboxed-harness supervisor (`harness` set): runs the harness as the driver. */
  readonly driveHarness?: DriveHarness
  /** WORK tools the supervisor may call DIRECTLY (router arm) — so it can do simple work ITSELF and
   *  only delegate when it needs parallelism. Pair with `executeExtraTool`. */
  readonly extraTools?: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly parameters: Record<string, unknown>
  }>
  /** Runs an `extraTools` call; null/undefined falls through to the coordination dispatch. */
  readonly executeExtraTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string | null | undefined>
  readonly maxTurns?: number
}

export function supervisorAgent(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
): Agent<unknown, unknown> {
  const name = profile.name ?? 'supervisor'
  const systemPrompt = profile.systemPrompt ?? ''
  const harness = profile.harness ?? null

  if (harness === null) {
    // ROUTER arm: the in-process tool-loop. `routerBrain` is now an internal detail — the caller
    // passes a profile, not a hand-built brain (a test may still inject `deps.brain`).
    const brain = deps.brain ?? routerBrainFromProfile(profile, deps)
    return coordinationDriverAgent({
      name,
      brain,
      blobs: deps.blobs,
      makeWorkerAgent: deps.makeWorkerAgent,
      perWorker: deps.perWorker,
      systemPrompt,
      ...(deps.extraTools ? { extraTools: deps.extraTools } : {}),
      ...(deps.executeExtraTool ? { executeExtraTool: deps.executeExtraTool } : {}),
      ...(deps.maxTurns !== undefined ? { maxTurns: deps.maxTurns } : {}),
    })
  }

  // SANDBOX arm: a sandboxed harness drives the coordination verbs over the live scope.
  const driveHarness = deps.driveHarness
  if (!driveHarness) {
    throw new ValidationError(
      `supervisorAgent: profile.harness="${harness}" needs deps.driveHarness (how to run the harness with the coordination MCP mounted)`,
    )
  }
  return {
    name,
    async act(task, scope) {
      const mcp = await serveCoordinationMcp({
        scope,
        blobs: deps.blobs,
        makeWorkerAgent: deps.makeWorkerAgent,
        perWorker: deps.perWorker,
      })
      try {
        await driveHarness({ profile, task, scope, coordinationMcpUrl: mcp.url })
        // The deliverable is the best DELIVERED child, never the harness's own output (Foreman 0/18).
        return await finalizeBestDelivered(mcp.settled(), deps.blobs)
      } finally {
        await mcp.close()
      }
    },
  }
}

function routerBrainFromProfile(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
): ToolLoopChat {
  if (!deps.router) {
    throw new ValidationError(
      'supervisorAgent: a router-brained supervisor (harness null) needs deps.router (or deps.brain)',
    )
  }
  return routerBrain({ ...deps.router, model: profile.model ?? deps.router.model })
}
