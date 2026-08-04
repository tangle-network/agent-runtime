/**
 * The product-facing backend selector: one call picks the execution transport a
 * `runAgentRounds` (or any consumer that drives a `SandboxClient`) runs on, from the
 * package a product already depends on. It is pure sugar over the existing
 * primitives — `createExecutor({ backend })` + `inlineSandboxClient` — and adds
 * ZERO transport code (the node:http cli-bridge transport lives in `bridgeExecutor`).
 *
 * The heavy `resolveBenchClient` in `@tangle-network/agent-bench` is the bench-side
 * sibling: it layers router/search specifics a product should not have to depend on.
 * This is the generic, dep-light core products call to switch backends:
 *
 *   - `backend: 'sandbox'` → IN-BOX: return the caller's real Sandbox-backed
 *                            `sandboxClient` unchanged. Fail loud if absent — a
 *                            product on the sandbox backend already holds its box.
 *   - `backend: 'bridge'`  → OFF-BOX: a local cli-bridge fronting a harness CLI
 *                            (opencode / kimi-code / …) as the leaf executor, wired
 *                            through the resumable `bridgeExecutor`.
 *   - `backend: 'router'`  → OFF-BOX: a router chat-completion as the leaf executor,
 *                            presented as a `SandboxClient` (no sandbox dependency).
 *   - `backend: 'local'`   → SAME-HOST: a router-brain tool loop with the
 *                            profile's stdio MCP servers spawned as LOCAL child
 *                            processes — the only backend that can reach an MCP
 *                            server built into a host worktree.
 */

import { inlineSandboxClient } from './inline-sandbox-client'
import { type LocalSandboxClientOptions, localSandboxClient } from './local-sandbox-client'
import { createExecutor } from './supervise/runtime'
import type { SandboxClient } from './types'

export interface ResolveSandboxClientOptions {
  /** The execution transport for the driven loop. */
  backend: 'sandbox' | 'bridge' | 'router' | 'local'
  /** `sandbox` backend: the caller's real Sandbox-backed client. Required for that backend. */
  sandboxClient?: SandboxClient
  /** `bridge` backend: local cli-bridge transport. The per-create profile owns the model. */
  bridge?: {
    /** cli-bridge base URL. Defaults to `http://127.0.0.1:3355`. */
    url?: string
    bearer: string
    /** Per-turn deadline (ms). */
    timeoutMs?: number
  }
  /** `router` backend: endpoint/auth only; the per-create profile owns behavior. */
  router?: {
    baseUrl: string
    key: string
  }
  /** `local` backend: same-host pseudo-box — the router brain drives a tool loop
   *  with the profile's stdio MCP servers spawned as local children. */
  local?: LocalSandboxClientOptions
}

/**
 * Resolve a `SandboxClient` for the chosen backend. The generic, dep-light core
 * that `resolveBenchClient` builds on — reuse this instead of hand-rolling the
 * `createExecutor`/`inlineSandboxClient` branch in each product.
 */
export function resolveSandboxClient(opts: ResolveSandboxClientOptions): SandboxClient {
  switch (opts.backend) {
    case 'sandbox': {
      if (!opts.sandboxClient) {
        throw new Error("resolveSandboxClient: backend 'sandbox' requires opts.sandboxClient")
      }
      return opts.sandboxClient
    }
    case 'bridge': {
      const bridge = opts.bridge
      if (!bridge?.bearer) {
        throw new Error("resolveSandboxClient: backend 'bridge' requires bridge.bearer")
      }
      return inlineSandboxClient(
        createExecutor({
          backend: 'bridge',
          bridgeUrl: bridge.url ?? 'http://127.0.0.1:3355',
          bridgeBearer: bridge.bearer,
          timeoutMs: bridge.timeoutMs,
        }),
      )
    }
    case 'router': {
      const router = opts.router
      if (!router?.baseUrl || !router.key) {
        throw new Error(
          "resolveSandboxClient: backend 'router' requires router.baseUrl and router.key",
        )
      }
      return inlineSandboxClient(
        createExecutor({
          backend: 'router',
          routerBaseUrl: router.baseUrl,
          routerKey: router.key,
        }),
      )
    }
    case 'local': {
      const local = opts.local
      if (!local?.router?.baseUrl || !local.router.key) {
        throw new Error(
          "resolveSandboxClient: backend 'local' requires local.router.baseUrl and local.router.key",
        )
      }
      return localSandboxClient(local)
    }
  }
}
