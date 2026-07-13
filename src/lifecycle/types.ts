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
import type { AgentMemorySpec } from '../mcp/memory-server'
import type { ExternalMcpGrant } from './connection'

/**
 * The profile levers an artifact can target. One-to-one with the §1.5 profile
 * surface (`prompt + skills + tools + mcp + hooks + subagents`), plus `memory`
 * — the Phase-5 surface the published `AgentProfile` does not yet name (it
 * mounts as a local extension; see lifecycle/memory.ts) — and `connection` —
 * the Phase-6 adopt-not-build surface: a grant for an EXTERNAL MCP server
 * (see lifecycle/connection.ts). Each kind maps deterministically onto the
 * profile (see `applyArtifact`).
 */
export type ArtifactKind =
  | 'skill'
  | 'tool'
  | 'mcp'
  | 'hook'
  | 'subagent'
  | 'prompt'
  | 'memory'
  | 'connection'

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
 *   - `memory`   — a memory spec: the typed record lands on
 *                  `profile.metadata.memory` (local extension — the published
 *                  profile has no memory field) AND a stdio server entry that
 *                  SERVES it lands under `profile.mcp[name]`, so the same-host
 *                  materialization boots the memory live during a scored run.
 *   - `connection` — an EXTERNAL MCP grant (adopt, not build): the server entry
 *                  lands under `profile.mcp[name]` with secrets by NAME only,
 *                  and an optional hub grant lands on `profile.connections`.
 */
export interface ArtifactPayloads {
  prompt: { instruction: string }
  skill: { resource: AgentProfileResourceRef }
  tool: { enabled: boolean }
  mcp: { server: AgentProfileMcpServer }
  hook: { event: string; commands: AgentProfileHookCommand[] }
  subagent: { profile: AgentSubagentProfile }
  memory: { spec: AgentMemorySpec }
  connection: { grant: ExternalMcpGrant }
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
   * Lifecycle status — the full artifact state machine:
   *
   *   `candidate` → `active` → `decayed` (re-promotable)
   *                         ↘ `retired` (terminal)
   *
   *   - `candidate` — registered, not yet promoted. The default at register time.
   *   - `active`    — passed the promotion gate and carries a measured held-back
   *                   lift; the only status `composeProfile` folds into a profile.
   *   - `decayed`   — was active, but a later re-measure (`driftWatch`) found its
   *                   lift fell below the keep-bar. Demoted out of the composed
   *                   profile; kept as an auditable record and a re-promotion
   *                   candidate if a future re-measure recovers the lift.
   *   - `retired`   — permanently removed from the active set (`dedupeArtifacts`
   *                   retires the weaker half of a non-stacking pair). Terminal.
   *
   * The registry never auto-promotes; every transition is an explicit call
   * (`promote`/`promoteWithLift`/`demote`/`retire`).
   */
  status: ArtifactStatus
  /** Free-form metadata (provenance, generation id, the measured lift, …). */
  metadata?: Record<string, unknown>
}

/**
 * The artifact lifecycle states. `active` is the load-bearing one — it is the
 * sole status `composeProfile` folds into a deployable profile, and it is gated
 * by a measured held-back lift (the registry invariant). `decayed` and `retired`
 * are the two ways an artifact LEAVES the active set: a decayed artifact lost its
 * lift on re-measure (reversible — `driftWatch`), a retired one was deduped away
 * (terminal — `dedupeArtifacts`).
 */
export type ArtifactStatus = 'candidate' | 'active' | 'decayed' | 'retired'

/** The input to `register` — everything on `ProfileArtifact` except the
 *  registry-owned `id` and `status`. An explicit `id` may be supplied for
 *  deterministic/idempotent registration; otherwise the registry assigns one. */
export type ArtifactInput<K extends ArtifactKind = ArtifactKind> = Omit<
  ProfileArtifact<K>,
  'id' | 'status'
> & { id?: string; status?: ArtifactStatus }
