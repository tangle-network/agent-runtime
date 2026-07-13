/**
 * `localSandboxClient` — the SAME-HOST pseudo-box: a `SandboxClient` whose
 * `create()` MATERIALIZES the profile's stdio MCP servers as local child
 * processes (`materializeLocalMcp`) and whose `streamPrompt` drives a real
 * tool loop (`runBrainLoop` over the router brain) with those live tools.
 *
 * This is the backend between `inlineSandboxClient` (off-box, ZERO tools) and
 * a real sandbox (in-box, remote): a locally-BUILT MCP server (its cwd is a
 * host worktree) is unreachable from a remote box and invisible to the
 * one-shot inline executors — here it is spawned next to the worker and its
 * tools are live for the whole session. `delete()` kills the children.
 *
 * The profile arrives per-create on `options.backend.profile` — exactly what
 * the kernel's `createSandboxForSpec` sets via `buildBackendOptions` — so the
 * same client materializes a different candidate profile per box. The
 * profile's prompt surface (systemPrompt + instructions) becomes the system
 * message, so BOTH optimizable surfaces are live here.
 *
 * Event protocol matches `inlineSandboxClient`: one `llm_call` metering event
 * + one terminal `result` event with finalText/tokenUsage/costUsd.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { routerBrain } from './router-client'
import { materializeLocalMcp } from './stdio-mcp-client'
import { runBrainLoop, type ToolLoopChat } from './tool-loop'
import type { SandboxClient } from './types'

export interface LocalSandboxClientOptions {
  /** The worker brain: router chat-completions with tool-calling. All three required. */
  router: { baseUrl: string; key: string; model: string }
  /** Tool-loop turns per prompt. Default 8. */
  maxTurns?: number
  /** Brain sampling temperature. Default: `routerBrain`'s (0.4). */
  temperature?: number
  /** Fallback profile when `create(options)` carries none on `backend.profile`. */
  profile?: AgentProfile
}

/** A `SandboxClient` that runs the worker same-host with the profile's stdio MCP servers live. */
export function localSandboxClient(opts: LocalSandboxClientOptions): SandboxClient {
  const maxTurns = opts.maxTurns ?? 8
  let seq = 0
  return {
    async create(options?: CreateSandboxOptions): Promise<SandboxInstance> {
      const profile =
        (options?.backend as { profile?: AgentProfile } | undefined)?.profile ?? opts.profile ?? {}
      // Materialize NOW: a declared server that cannot boot fails the create,
      // not the first prompt — matching the real sandbox backend, where a box
      // whose MCP cannot start never comes up.
      const mcp = await materializeLocalMcp(profile)
      const brain: ToolLoopChat = routerBrain(
        {
          routerBaseUrl: opts.router.baseUrl,
          routerKey: opts.router.key,
          model: opts.router.model,
        },
        opts.temperature !== undefined ? { temperature: opts.temperature } : {},
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
          let costUsd = 0
          const chat: ToolLoopChat = async (messages, tools) => {
            const r = await brain(messages, tools)
            if (r.costUsd) costUsd += r.costUsd
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
            maxTurns,
            hooks: { stopBefore: () => popts?.signal?.aborted === true },
          })
          // Speak the runtime's metering protocol (see inlineSandboxClient):
          // a flat `llm_call` event so the kernel never meters a fabricated $0.
          if (r.usage.input || r.usage.output || costUsd) {
            yield {
              type: 'llm_call',
              data: { tokensIn: r.usage.input, tokensOut: r.usage.output, costUsd },
            } as unknown as SandboxEvent
          }
          yield {
            type: 'result',
            data: {
              finalText: r.final,
              tokenUsage: { inputTokens: r.usage.input, outputTokens: r.usage.output },
              costUsd,
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
