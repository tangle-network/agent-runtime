/**
 * The ONE harness → worker-client mapping for the bench layer. Every bench entrypoint
 * (rsi.ts, run.ts, …) derives the `SandboxClient` the kernel's `runAgentRounds` drives from a single
 * selector instead of hand-rolling the branch:
 *
 *   - `router`               → OFF-BOX: a router chat-completion as the leaf executor, presented
 *                              as a SandboxClient (no sandbox dependency). For deployable-checker
 *                              domains whose worker is a completion, or where box egress is blocked.
 *   - `router` + searchProvider → OFF-BOX `router-tools`: the same off-box loop with a live
 *                              `web_search` tool (the capability axis research benches need).
 *   - `bridge`               → OFF-BOX: a local cli-bridge fronting a harness CLI
 *                              (opencode/kimi-code/…) as the leaf executor. Same resumable
 *                              `bridgeExecutor` the supervisor uses; harness+model ride the
 *                              bridge `model` id (`${harness}/${model}`).
 *   - anything else (`sandbox`/a BackendType) → IN-BOX: a real `Sandbox`. The in-box backend
 *                              TYPE (opencode/codex/…) is set separately on the `AgentRunSpec`;
 *                              this only decides off-box-vs-in-box transport for `runAgentRounds`.
 *
 * Centralizing it here means a new entrypoint gets the full off-box/in-box matrix for free and
 * the mapping can't drift between callers.
 */
import {
  createExecutor,
  inlineSandboxClient,
  resolveSandboxClient,
  type SandboxClient,
} from '@tangle-network/agent-runtime/kernel'
import { Sandbox } from '@tangle-network/sandbox'
import { makeSearchExecutor, webSearchTool } from './search-tool'

export interface ResolveBenchClientOptions {
  /** The selector (the `BACKEND` env value): `router` = off-box; anything else = in-box Sandbox. */
  backend: string
  routerBaseUrl: string
  routerKey: string
  model: string
  /** When set on the `router` backend, the off-box worker becomes a `router-tools` agentic loop
   *  with a live `web_search` tool backed by this provider (`you`/`exa`/…). */
  searchProvider?: string
  sandboxBaseUrl?: string
  /** In-box sandbox timeout (ms). Also the per-turn deadline for the `bridge` backend. */
  timeoutMs?: number
  /** `bridge` backend: cli-bridge base URL. Defaults to `http://127.0.0.1:3355`. */
  bridgeUrl?: string
  /** `bridge` backend: bearer the bridge requires. Falls back to `routerKey` when unset. */
  bridgeBearer?: string
}

export function resolveBenchClient(opts: ResolveBenchClientOptions): SandboxClient {
  const { backend, routerBaseUrl, routerKey, model, searchProvider } = opts
  if (backend === 'router') {
    if (searchProvider) {
      return inlineSandboxClient(
        createExecutor({
          backend: 'router-tools',
          routerBaseUrl,
          routerKey,
          model,
          tools: [webSearchTool],
          executeToolCall: makeSearchExecutor({ routerBaseUrl, routerKey, provider: searchProvider }),
        }),
      )
    }
    return inlineSandboxClient(createExecutor({ backend: 'router', routerBaseUrl, routerKey, model }))
  }
  if (backend === 'bridge') {
    // bench's bearer fallback (`?? routerKey`) resolves first, then the shared
    // resolver core wires the bridge seam — no re-implemented createExecutor branch.
    const bridgeBearer = opts.bridgeBearer ?? routerKey
    if (!bridgeBearer) throw new Error("resolveBenchClient: backend 'bridge' needs bridgeBearer or routerKey")
    return resolveSandboxClient({
      backend: 'bridge',
      bridge: { url: opts.bridgeUrl, bearer: bridgeBearer, model, timeoutMs: opts.timeoutMs },
    })
  }
  return new Sandbox({
    baseUrl: opts.sandboxBaseUrl ?? 'https://sandbox.tangle.tools',
    apiKey: routerKey,
    timeoutMs: opts.timeoutMs ?? 1_200_000,
  } as never)
}
