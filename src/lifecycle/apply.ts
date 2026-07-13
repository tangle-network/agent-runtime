/**
 * `applyArtifact` — merge one `ProfileArtifact` onto an `AgentProfile`.
 *
 * This is the deterministic bridge between the artifact catalog and the §1.5
 * profile law: each `ArtifactKind` lands on exactly one profile field. The merge
 * is shallow-immutable — the input profile is never mutated; a new profile with
 * the artifact applied is returned. This is the ONE place that knows how a
 * `kind` maps to a profile field, so both the registry's `compose` and
 * `measureMarginalLift`'s with/without ablation share a single source of truth.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { memoryMcpServer, profileMemoryMetadataKey } from './memory'
import type { ProfileArtifact } from './types'

/**
 * Return a new profile with `artifact` merged onto `base`. Keyed kinds
 * (`tool`/`mcp`/`hook`/`subagent`) land under `artifact.key` (falling back to
 * `artifact.id`). `prompt` appends an instruction line; `skill` appends a
 * resource ref. Existing keys are overwritten by the artifact (the artifact is
 * the candidate being measured/promoted, so it wins on conflict).
 */
export function applyArtifact(base: AgentProfile, artifact: ProfileArtifact): AgentProfile {
  switch (artifact.kind) {
    case 'prompt': {
      const payload = artifact.payload as { instruction: string }
      const instructions = [...(base.prompt?.instructions ?? []), payload.instruction]
      return { ...base, prompt: { ...base.prompt, instructions } }
    }
    case 'skill': {
      const payload = artifact.payload as ProfileArtifact<'skill'>['payload']
      const skills = [...(base.resources?.skills ?? []), payload.resource]
      return { ...base, resources: { ...base.resources, skills } }
    }
    case 'tool': {
      const payload = artifact.payload as ProfileArtifact<'tool'>['payload']
      const key = keyOf(artifact)
      return { ...base, tools: { ...base.tools, [key]: payload.enabled } }
    }
    case 'mcp': {
      const payload = artifact.payload as ProfileArtifact<'mcp'>['payload']
      const key = keyOf(artifact)
      return { ...base, mcp: { ...base.mcp, [key]: payload.server } }
    }
    case 'hook': {
      const payload = artifact.payload as ProfileArtifact<'hook'>['payload']
      const existing = base.hooks?.[payload.event] ?? []
      return {
        ...base,
        hooks: { ...base.hooks, [payload.event]: [...existing, ...payload.commands] },
      }
    }
    case 'subagent': {
      const payload = artifact.payload as ProfileArtifact<'subagent'>['payload']
      const key = keyOf(artifact)
      return { ...base, subagents: { ...base.subagents, [key]: payload.profile } }
    }
    case 'memory': {
      // Double mount: the typed spec rides `metadata.memory` (the local
      // extension — the published AgentProfile has no memory field yet), and
      // the LIVE serving rides `mcp[key]` (a field the profile does have), so
      // the same-host materialization boots the memory during a scored run
      // with zero scorer changes. See lifecycle/memory.ts for the boundary.
      const payload = artifact.payload as ProfileArtifact<'memory'>['payload']
      const key = keyOf(artifact)
      return {
        ...base,
        metadata: { ...base.metadata, [profileMemoryMetadataKey]: payload.spec },
        mcp: { ...base.mcp, [key]: memoryMcpServer(payload.spec) },
      }
    }
  }
}

/** Apply many artifacts left-to-right; later artifacts win on key conflicts. */
export function applyArtifacts(
  base: AgentProfile,
  artifacts: readonly ProfileArtifact[],
): AgentProfile {
  return artifacts.reduce((profile, artifact) => applyArtifact(profile, artifact), base)
}

/** The profile-field key a keyed artifact lands under: explicit `key` or `id`. */
function keyOf(artifact: ProfileArtifact): string {
  return artifact.key ?? artifact.id
}
