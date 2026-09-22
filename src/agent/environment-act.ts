/**
 * Provider-backed `AgentRuntime.act` for production-equivalent evaluation.
 *
 * The adapter creates an environment from the same profile production uses,
 * streams official environment events into the runtime event vocabulary, and
 * parses the unchanged raw stream for scoring.
 */

import { randomUUID } from 'node:crypto'
import type { TraceEmitter } from '@tangle-network/agent-eval'
import type {
  AgentProfile,
  AgentProfileFileMount,
  AgentProfileMcpServer,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { createEnvironmentForSpec } from '../runtime/environment-create'
import { mapAgentEnvironmentEvent } from '../runtime/environment-events'
import { turnEvents } from '../runtime/environment-lineage'
import type { AgentRunSpec, OutputAdapter } from '../runtime/types'
import { destroyEnvironmentSafe } from '../runtime/util'
import type { RuntimeStreamEvent } from '../types'
import {
  AGENT_PROFILE_MATERIALIZATION_AXES,
  type AgentProfileMaterializationAxis,
  assertProfileMaterialization,
  defineProfileMaterializationContract,
} from './profile-materialization'

/** Profile fields consumed by `createEnvironmentAct`. */
export const environmentActProfileMaterialization = defineProfileMaterializationContract({
  name: 'createEnvironmentAct',
  axes: AGENT_PROFILE_MATERIALIZATION_AXES,
})

export interface AgentRunContext {
  emitter: TraceEmitter
  runId: string
  variantId?: string
  deadlineMs?: number
  signal?: AbortSignal
}

export interface AgentRunInvocation<Output> {
  events: AsyncIterable<RuntimeStreamEvent>
  output: Promise<Output>
}

/** Collect a streamed agent run and its final output. */
export async function collectAgentRun<Output>(
  invocation: AgentRunInvocation<Output>,
): Promise<{ events: RuntimeStreamEvent[]; output: Output }> {
  const events: RuntimeStreamEvent[] = []
  for await (const event of invocation.events) events.push(event)
  return { events, output: await invocation.output }
}

/** Per-persona profile-merge slots applied over the base profile (§1.5: the caller authors the
 *  per-persona profile). Each slot overlays the base; an absent slot leaves the base untouched. */
export interface EnvironmentActComposeOverrides {
  /** Replace the base profile's system prompt (e.g. a workspace-augmented prompt). */
  systemPrompt?: string
  /** Extra file mounts layered after the base profile's `resources.files`. */
  extraFiles?: AgentProfileFileMount[]
  /** Override the profile `name`. Defaults to the base profile's name. */
  name?: string
  /** Provider built-in tool flags merged over the base profile's `tools` (overlay wins per key). */
  tools?: Record<string, boolean>
  /** MCP connections merged over the base profile's `mcp` (overlay wins per key). */
  mcpConnections?: Record<string, AgentProfileMcpServer>
}

export interface CreateEnvironmentActOptions<TPersona, TRunOutput> {
  /** Canonical agent profile — the same one the prod chat turn uses. */
  baseProfile: AgentProfile
  /** Provider used to create one isolated environment per invocation. */
  environmentProvider: AgentEnvironmentProvider
  /** Persona → prompt. Pure; the eval cell's input. */
  buildPrompt: (persona: TPersona) => string
  /** Raw environment event stream → typed output the rubric scores. */
  output: OutputAdapter<TRunOutput>
  /**
   * Per-persona profile overrides (workspace-augmented system prompt, extra
   * file mounts, tool flags, MCP connections). Overlaid onto `baseProfile`.
   */
  compose?: (persona: TPersona) => EnvironmentActComposeOverrides
  /** Provider-neutral fields forwarded to environment creation. */
  environment?: AgentRunSpec<unknown>['environment']
  /** Live streaming by default; polling requires provider detach support. */
  streaming?: 'sse' | 'poll'
  /** Optional changed axes the caller expects this path to carry. */
  requiredProfileAxes?: readonly AgentProfileMaterializationAxis[]
  /** Stable run name surfaced in mapped `llm_call` events. */
  name?: string
  /** Override the environment-event → runtime-event mapper. */
  mapEvent?: (
    event: AgentEnvironmentEvent,
    opts: { agentRunName?: string },
  ) => RuntimeStreamEvent | undefined
}

/**
 * Build an evaluation callback backed by one production-profile environment
 * run. The returned function returns
 * synchronously with a live `events` iterator and an `output` promise that
 * resolves only after the iterator drains.
 */
export function createEnvironmentAct<TPersona, TRunOutput>(
  options: CreateEnvironmentActOptions<TPersona, TRunOutput>,
): (persona: TPersona, ctx: AgentRunContext) => AgentRunInvocation<TRunOutput> {
  assertProfileMaterialization({
    contract: environmentActProfileMaterialization,
    changedAxes: options.requiredProfileAxes ?? [],
    context: 'createEnvironmentAct',
  })
  const mapEvent = options.mapEvent ?? mapAgentEnvironmentEvent

  return (persona: TPersona, ctx: AgentRunContext): AgentRunInvocation<TRunOutput> => {
    const profile = applyComposeOverrides(options.baseProfile, options.compose?.(persona))
    const agentRunName = options.name ?? profile.name ?? 'agent'
    const message = options.buildPrompt(persona)
    const signal = ctx.signal ?? new AbortController().signal

    const raw: AgentEnvironmentEvent[] = []
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
      ...(options.environment ? { environment: options.environment } : {}),
    }

    async function* events(): AsyncIterable<RuntimeStreamEvent> {
      let environment: AgentEnvironment | undefined
      try {
        environment = await createEnvironmentForSpec(options.environmentProvider, spec, signal)
        for await (const event of turnEvents(
          options.streaming ?? 'sse',
          environment,
          message,
          randomUUID(),
          signal,
        )) {
          raw.push(event)
          const mapped = mapEvent(event, { agentRunName })
          if (mapped) yield mapped
        }
        settle(options.output.parse(raw))
      } catch (err) {
        fail(err)
        throw err
      } finally {
        await destroyEnvironmentSafe(environment)
      }
    }

    return { events: events(), output }
  }
}

/** Overlay the per-persona overrides onto the base profile. Each slot merges over the base; an
 *  absent override leaves the base profile untouched. */
function applyComposeOverrides(
  base: AgentProfile,
  overrides: EnvironmentActComposeOverrides | undefined,
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
