/**
 * `localSandboxClient` — the SAME-HOST pseudo-box: a `SandboxClient` whose
 * `create()` MATERIALIZES the profile's stdio MCP servers as local child
 * processes (`materializeLocalMcp`) and whose `streamPrompt` drives a real
 * tool loop (`runBrainLoop` over the router brain) with those live tools.
 *
 * Despite the interface name, this does NOT isolate processes. It is only for
 * author-controlled profiles whose local MCP commands a caller explicitly
 * trusts; user- or model-authored code belongs in a real sandbox. `delete()`
 * kills the children.
 *
 * A per-create profile may change the prompt surface. Permission to start a
 * local MCP process applies only when its full canonical bytes match the fixed
 * constructor profile; a different generated profile is refused.
 *
 * Event protocol matches `inlineSandboxClient`: known token usage is emitted as one `llm_call`;
 * Router catalog cost remains a separately-labelled estimate, never billed spend.
 */

import {
  type AgentProfile,
  type AgentProfileSecurityPolicy,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import type { KeyProvider } from './key-provider'
import { routerBrain } from './router-client'
import { materializeLocalMcp } from './stdio-mcp-client'
import { executableAgentProfileSnapshot } from './supervise/executable-spec'
import { profileModelExecutionSettings, profileProviderModel } from './supervise/model-policy'
import { runBrainLoop, type ToolLoopChat } from './tool-loop'
import type { SandboxClient } from './types'

export interface LocalSandboxClientOptions {
  /** Router endpoint/auth. The exact per-create profile owns model and loop behavior. */
  router: { baseUrl: string; key: string }
  /** Fallback profile when `create(options)` carries none on `backend.profile`. */
  profile?: AgentProfile
  /** Resolves profile-declared MCP secret names at child-process spawn time. */
  keys?: KeyProvider
  /** Explicit trust decision for the exact `profile` bytes supplied here.
   * Omit to refuse local processes. A permissive policy never transfers to a
   * different per-create profile and provides no host isolation. */
  profileSecurityPolicy?: AgentProfileSecurityPolicy
}

/** A same-host `SandboxClient` adapter with no process isolation. Local MCP is
 * refused unless the caller explicitly supplies a policy that allows it. */
export function localSandboxClient(opts: LocalSandboxClientOptions): SandboxClient {
  const defaultProfile =
    opts.profile === undefined
      ? undefined
      : executableAgentProfileSnapshot(opts.profile, 'localSandboxClient default profile')
  const router = Object.freeze({ ...opts.router })
  if (opts.profileSecurityPolicy?.allowLocalMcp && defaultProfile === undefined) {
    throw new ValidationError(
      'localSandboxClient: allowLocalMcp requires a fixed author-controlled profile; dynamic profiles need a real sandbox',
    )
  }
  const trustedProfileDigest =
    opts.profileSecurityPolicy?.allowLocalMcp && defaultProfile !== undefined
      ? canonicalAgentProfileDigest(defaultProfile)
      : undefined
  let seq = 0
  return {
    async create(options?: CreateSandboxOptions): Promise<SandboxInstance> {
      const profile = executableAgentProfileSnapshot(
        (options?.backend as { profile?: AgentProfile } | undefined)?.profile ?? defaultProfile,
        'localSandboxClient',
      )
      const profileModel = profileProviderModel(profile)
      const model = profileModel!
      const settings = profileModelExecutionSettings(profile, 'localSandboxClient')
      const policyApplies =
        opts.profileSecurityPolicy !== undefined &&
        (!opts.profileSecurityPolicy.allowLocalMcp ||
          (trustedProfileDigest !== undefined &&
            canonicalAgentProfileDigest(profile) === trustedProfileDigest))
      // Materialize NOW: a declared server that cannot boot fails the create,
      // not the first prompt — matching the real sandbox backend, where a box
      // whose MCP cannot start never comes up.
      const mcp = await materializeLocalMcp(profile, {
        ...(opts.keys ? { keys: opts.keys } : {}),
        ...(policyApplies ? { profileSecurityPolicy: opts.profileSecurityPolicy } : {}),
      })
      const brain: ToolLoopChat = routerBrain(
        {
          routerBaseUrl: router.baseUrl,
          routerKey: router.key,
          model,
          ...(settings.retry !== undefined ? { retry: settings.retry } : {}),
          ...(settings.maxTokens !== undefined ? { maxTokens: settings.maxTokens } : {}),
          ...(settings.stream !== undefined ? { stream: settings.stream } : {}),
        },
        {
          ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
          ...(settings.seed !== undefined ? { seed: settings.seed } : {}),
          ...(settings.toolChoice !== undefined ? { toolChoice: settings.toolChoice } : {}),
          ...(settings.extraBody !== undefined ? { extraBody: settings.extraBody } : {}),
          ...(profile.model?.reasoningEffort
            ? { reasoningEffort: profile.model.reasoningEffort }
            : {}),
        },
      )
      const system = [profile.prompt?.systemPrompt, ...(profile.prompt?.instructions ?? [])]
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .join('\n\n')
      const id = `local-${seq++}`
      return {
        id,
        async *streamPrompt(
          message: string,
          popts?: { signal?: AbortSignal },
        ): AsyncGenerator<SandboxEvent> {
          let estimatedCostUsd = 0
          let sawEstimatedCost = false
          const chat: ToolLoopChat = async (messages, tools) => {
            const r = await brain(messages, tools)
            if (r.costProvenance === 'catalog-estimate' && r.costUsd !== undefined) {
              estimatedCostUsd += r.costUsd
              sawEstimatedCost = true
            }
            return r
          }
          const r = await runBrainLoop({
            chat,
            tools: mcp.tools,
            execute: (name, args) => mcp.call(name, args),
            initialMessages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              { role: 'user', content: message },
            ],
            maxTurns: settings.maxTurns ?? 0,
            hooks: { stopBefore: () => popts?.signal?.aborted === true },
          })
          // RouterClient prices locally. Emit measured tokens only when every turn reported them;
          // never project the catalog estimate into SandboxEvent.costUsd.
          if (r.turns > 0) {
            yield {
              type: 'llm_call',
              data: {
                model,
                ...(r.tokensKnown === false
                  ? { tokensKnown: false }
                  : { tokensIn: r.usage.input, tokensOut: r.usage.output }),
                costKnown: false,
                ...(sawEstimatedCost ? { estimatedCostUsd } : {}),
              },
            } as unknown as SandboxEvent
          }
          yield {
            type: 'result',
            data: {
              finalText: r.final,
              ...(r.tokensKnown === false
                ? { tokensKnown: false }
                : { tokenUsage: { inputTokens: r.usage.input, outputTokens: r.usage.output } }),
              costKnown: false,
              ...(sawEstimatedCost ? { estimatedCostUsd } : {}),
            },
          } as unknown as SandboxEvent
        },
        async delete(): Promise<void> {
          await mcp.close()
        },
      } as unknown as SandboxInstance
    },
  }
}
