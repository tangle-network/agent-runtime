/**
 * `@tangle-network/agent-runtime/lifecycle` — artifact-lifecycle FOUNDATION.
 *
 * The §1.5 law says an agent IS its `AgentProfile`, and the profile is the WHOLE
 * agent: prompt + skills + tools + mcp + hooks + subagents. This module names the
 * discrete, individually-promotable PIECES of that profile — "artifacts" — and
 * gives them stable ids so the rest of a self-improvement lifecycle (propose →
 * measure → promote → ship) has something concrete to hang off.
 *
 * This is PHASE 1: just the two primitives the rest hangs off.
 *   1. `ArtifactRegistry` — a typed catalog of profile artifacts with stable ids.
 *   2. `measureMarginalLift` — the with-vs-without ablation: how much score/cost a
 *      single artifact adds on top of a baseline profile.
 *
 * The per-surface lifecycles, the `BuildableSurface` author contract, and the
 * promotion-gate wiring are deferred to later phases.
 */

import type {
  AgentProfileHookCommand,
  AgentProfileMcpServer,
  AgentProfileResourceRef,
  AgentSubagentProfile,
} from '@tangle-network/agent-interface'

/**
 * The profile levers an artifact can target. One-to-one with the §1.5 profile
 * surface (`prompt + skills + tools + mcp + hooks + subagents`). Each kind maps to
 * exactly one field of `AgentProfile`, so an artifact can be applied onto a
 * baseline profile deterministically (see `applyArtifact`).
 */
export type ArtifactKind = 'skill' | 'tool' | 'mcp' | 'hook' | 'subagent' | 'prompt'

/**
 * The payload for each `ArtifactKind`. The shapes are the SAME types the
 * `AgentProfile` field carries, so applying an artifact is a structural merge
 * onto the profile — never a bespoke per-kind transform.
 *
 *   - `prompt`   — an instruction line appended to `profile.prompt.instructions`.
 *   - `skill`    — a `SKILL.md`-style resource ref added to `profile.resources.skills`.
 *   - `tool`     — a tool grant: `{ enabled }` set under `profile.tools[name]`.
 *   - `mcp`      — one MCP server added under `profile.mcp[name]`.
 *   - `hook`     — one or more hook commands added under `profile.hooks[event]`.
 *   - `subagent` — one subagent profile added under `profile.subagents[name]`.
 */
export interface ArtifactPayloads {
  prompt: { instruction: string }
  skill: { resource: AgentProfileResourceRef }
  tool: { enabled: boolean }
  mcp: { server: AgentProfileMcpServer }
  hook: { event: string; commands: AgentProfileHookCommand[] }
  subagent: { profile: AgentSubagentProfile }
}

/**
 * A discrete, individually-promotable piece of an agent profile.
 *
 * `kind` selects the profile lever; `payload` is the kind-specific value; `key`
 * is the profile-field key the payload lands under (the tool name, the MCP server
 * name, the subagent name — unused for `prompt`, which appends). `id` is stable:
 * once registered, it never changes, so a marginal-lift measurement, a promotion
 * decision, and a ship record all reference the same artifact.
 */
export interface ProfileArtifact<K extends ArtifactKind = ArtifactKind> {
  /** Stable id. Assigned by the registry at register time; never reassigned. */
  id: string
  kind: K
  /**
   * The profile-field key this artifact lands under (e.g. the tool name, the MCP
   * server name, the subagent name, the hook event). Optional for `prompt`
   * (instructions append, they have no key). Defaults to `id` when applying a
   * keyed artifact without an explicit key.
   */
  key?: string
  /** Human-facing label for review surfaces. */
  name: string
  /** Optional one-line description of what this artifact does. */
  description?: string
  payload: ArtifactPayloads[K]
  /**
   * Lifecycle status. Phase 1 tracks only `candidate` (registered, not yet
   * promoted) and `promoted` (passed whatever gate the caller ran). The
   * registry never auto-promotes; promotion is an explicit `promote(id)` call.
   */
  status: ArtifactStatus
  /** Free-form metadata (provenance, generation id, the measured lift, …). */
  metadata?: Record<string, unknown>
}

export type ArtifactStatus = 'candidate' | 'promoted'

/** The input to `register` — everything on `ProfileArtifact` except the
 *  registry-owned `id` and `status`. An explicit `id` may be supplied for
 *  deterministic/idempotent registration; otherwise the registry assigns one. */
export type ArtifactInput<K extends ArtifactKind = ArtifactKind> = Omit<
  ProfileArtifact<K>,
  'id' | 'status'
> & { id?: string; status?: ArtifactStatus }
