/**
 * Sandbox bridge for `AgentRuntime.act` — prod-faithful eval execution.
 *
 * The point of this adapter is parity: the eval substrate must run the agent
 * through the SAME profile the production chat turn uses, or scorecard numbers
 * grade a profile that never ships. `createSandboxAct` composes the production
 * profile via {@link composeProductionAgentProfile}, boots a sandbox with it
 * through the loop kernel's own {@link createSandboxForSpec}, streams the
 * `streamPrompt` events mapped to the `RuntimeStreamEvent` vocabulary, and
 * resolves the `OutputAdapter`-parsed output for rubric scoring — satisfying
 * the `act` streaming contract with one code path shared by chat and eval.
 *
 * Agents with a bespoke streaming chat turn should wire THAT into `act`
 * directly (the contract is designed for it); this adapter is the default for
 * agents whose turn is a plain prod-profile sandbox dispatch — notably the
 * agents agent-builder generates.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { SandboxEvent } from '@tangle-network/sandbox'
import type { ComposeProductionAgentProfileOptions } from '../mcp/delegation-profile'
import { composeProductionAgentProfile } from '../mcp/delegation-profile'
import type { AgentRunSpec, OutputAdapter, SandboxClient } from '../runtime'
import { mapSandboxEvent } from '../runtime'
import { createSandboxForSpec } from '../runtime/run-loop'
import type { RuntimeStreamEvent } from '../types'
import type { AgentRunContext, AgentRunInvocation } from './define-agent'

export interface CreateSandboxActOptions<TPersona, TRunOutput> {
  /** Canonical agent profile — the same one the prod chat turn composes from. */
  baseProfile: AgentProfile
  /** Sandbox client used to boot the per-run sandbox. */
  sandboxClient: SandboxClient
  /** Persona → prompt. Pure; the eval cell's input. */
  buildPrompt: (persona: TPersona) => string
  /** Sandbox event stream → typed output the rubric scores. */
  output: OutputAdapter<TRunOutput>
  /**
   * Per-persona composition overrides (workspace-augmented system prompt,
   * extra file mounts, sandbox key). Merged into
   * {@link composeProductionAgentProfile}; `env` here is overridden by the
   * top-level `env` option when both are set.
   */
  compose?: (persona: TPersona) => ComposeProductionAgentProfileOptions
  /** Sandbox-SDK overrides forwarded to `createSandboxForSpec`. */
  sandboxOverrides?: AgentRunSpec<unknown>['sandboxOverrides']
  /** Stable run name surfaced in mapped `llm_call` events. */
  name?: string
  /** Override the `SandboxEvent → RuntimeStreamEvent` mapper. */
  mapEvent?: (
    event: SandboxEvent,
    opts: { agentRunName?: string },
  ) => RuntimeStreamEvent | undefined
  /** Environment source for delegation-MCP composition. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
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
    const profile = composeProductionAgentProfile(options.baseProfile, {
      ...(options.compose?.(persona) ?? {}),
      ...(options.env ? { env: options.env } : {}),
    })
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
