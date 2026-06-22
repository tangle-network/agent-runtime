/**
 * Sandbox bridge for `AgentRuntime.act` — prod-faithful eval execution.
 *
 * The point of this adapter is parity: the eval substrate must run the agent
 * through the SAME profile the production chat turn uses, or scorecard numbers
 * grade a profile that never ships. `createSandboxAct` boots a sandbox with the
 * agent's profile (the caller's `baseProfile`, with optional per-persona
 * overrides) through the loop kernel's own {@link createSandboxForSpec},
 * streams the `streamPrompt` events mapped to the `RuntimeStreamEvent`
 * vocabulary, and resolves the `OutputAdapter`-parsed output for rubric scoring
 * — satisfying the `act` streaming contract with one code path shared by chat
 * and eval.
 *
 * Agents with a bespoke streaming chat turn should wire THAT into `act`
 * directly (the contract is designed for it); this adapter is the default for
 * agents whose turn is a plain prod-profile sandbox dispatch — notably the
 * agents agent-builder generates.
 */

import type {
  AgentProfile,
  AgentProfileFileMount,
  AgentProfileMcpServer,
} from '@tangle-network/agent-interface'
import type { SandboxEvent } from '@tangle-network/sandbox'
import type { AgentRunSpec, OutputAdapter, SandboxClient } from '../runtime'
import { mapSandboxEvent } from '../runtime'
import { createSandboxForSpec } from '../runtime/run-loop'
import type { RuntimeStreamEvent } from '../types'
import type { AgentRunContext, AgentRunInvocation } from './define-agent'

/** Per-persona profile-merge slots applied over the base profile (§1.5: the caller authors the
 *  per-persona profile). Each slot overlays the base; an absent slot leaves the base untouched. */
export interface SandboxActComposeOverrides {
  /** Replace the base profile's system prompt (e.g. a workspace-augmented prompt). */
  systemPrompt?: string
  /** Extra file mounts layered after the base profile's `resources.files`. */
  extraFiles?: AgentProfileFileMount[]
  /** Override the profile `name`. Defaults to the base profile's name. */
  name?: string
  /** Box built-in tool ON/OFF flags merged over the base profile's `tools` (overlay wins per key). */
  tools?: Record<string, boolean>
  /** MCP connections merged over the base profile's `mcp` (overlay wins per key). */
  mcpConnections?: Record<string, AgentProfileMcpServer>
}

export interface CreateSandboxActOptions<TPersona, TRunOutput> {
  /** Canonical agent profile — the same one the prod chat turn uses. */
  baseProfile: AgentProfile
  /** Sandbox client used to boot the per-run sandbox. */
  sandboxClient: SandboxClient
  /** Persona → prompt. Pure; the eval cell's input. */
  buildPrompt: (persona: TPersona) => string
  /** Sandbox event stream → typed output the rubric scores. */
  output: OutputAdapter<TRunOutput>
  /**
   * Per-persona profile overrides (workspace-augmented system prompt, extra
   * file mounts, tool flags, MCP connections). Overlaid onto `baseProfile`.
   */
  compose?: (persona: TPersona) => SandboxActComposeOverrides
  /** Sandbox-SDK overrides forwarded to `createSandboxForSpec`. */
  sandboxOverrides?: AgentRunSpec<unknown>['sandboxOverrides']
  /** Stable run name surfaced in mapped `llm_call` events. */
  name?: string
  /** Override the `SandboxEvent → RuntimeStreamEvent` mapper. */
  mapEvent?: (
    event: SandboxEvent,
    opts: { agentRunName?: string },
  ) => RuntimeStreamEvent | undefined
}

/**
 * Build an `AgentRuntime.act` implementation backed by a single prod-profile
 * sandbox run. The returned function honours the `act` contract: it returns
 * synchronously with a live `events` iterator and an `output` promise that
 * resolves only after the iterator drains.
 */
export function createSandboxAct<TPersona, TRunOutput>(
  options: CreateSandboxActOptions<TPersona, TRunOutput>,
): (persona: TPersona, ctx: AgentRunContext) => AgentRunInvocation<TRunOutput> {
  const mapEvent = options.mapEvent ?? mapSandboxEvent

  return (persona: TPersona, ctx: AgentRunContext): AgentRunInvocation<TRunOutput> => {
    const profile = applyComposeOverrides(options.baseProfile, options.compose?.(persona))
    const agentRunName = options.name ?? profile.name ?? 'agent'
    const message = options.buildPrompt(persona)
    const signal = ctx.signal ?? new AbortController().signal

    const raw: SandboxEvent[] = []
    let settle!: (value: TRunOutput) => void
    let fail!: (err: unknown) => void
    const output = new Promise<TRunOutput>((resolve, reject) => {
      settle = resolve
      fail = reject
    })
    // The output promise rejects when the stream errors; if the caller ignores
    // `output` (chat UX) the rejection is still observed by the events iterator
    // throwing. Attach a no-op catch so an ignored rejection is never "unhandled".
    output.catch(() => {})

    const spec: AgentRunSpec<unknown> = {
      profile,
      taskToPrompt: () => message,
      name: agentRunName,
      ...(options.sandboxOverrides ? { sandboxOverrides: options.sandboxOverrides } : {}),
    }

    async function* events(): AsyncIterable<RuntimeStreamEvent> {
      try {
        const box = await createSandboxForSpec(options.sandboxClient, spec, signal)
        for await (const event of box.streamPrompt(message, { signal })) {
          raw.push(event)
          const mapped = mapEvent(event, { agentRunName })
          if (mapped) yield mapped
        }
        settle(options.output.parse(raw))
      } catch (err) {
        fail(err)
        throw err
      }
    }

    return { events: events(), output }
  }
}

/** Overlay the per-persona overrides onto the base profile. Each slot merges over the base; an
 *  absent override leaves the base profile untouched. */
function applyComposeOverrides(
  base: AgentProfile,
  overrides: SandboxActComposeOverrides | undefined,
): AgentProfile {
  if (!overrides) return base
  const prompt = overrides.systemPrompt
    ? { ...base.prompt, systemPrompt: overrides.systemPrompt }
    : base.prompt
  const mergedTools = overrides.tools ? { ...(base.tools ?? {}), ...overrides.tools } : base.tools
  const mergedMcp = overrides.mcpConnections
    ? { ...(base.mcp ?? {}), ...overrides.mcpConnections }
    : base.mcp
  const baseFiles = base.resources?.files ?? []
  const mergedFiles: AgentProfileFileMount[] = overrides.extraFiles?.length
    ? [...baseFiles, ...overrides.extraFiles]
    : [...baseFiles]
  return {
    ...base,
    name: overrides.name ?? base.name,
    prompt,
    ...(mergedTools ? { tools: mergedTools } : {}),
    ...(mergedMcp ? { mcp: mergedMcp } : {}),
    resources: { ...base.resources, files: mergedFiles },
  }
}
