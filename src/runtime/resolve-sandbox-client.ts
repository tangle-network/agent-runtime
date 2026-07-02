/**
 * The product-facing backend selector: one call picks the execution transport a
 * `runLoop` (or any consumer that drives a `SandboxClient`) runs on, from the
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
 */

import { inlineSandboxClient } from './inline-sandbox-client'
import { createExecutor } from './supervise/runtime'
import type { SandboxClient } from './types'

export interface ResolveSandboxClientOptions {
  /** The execution transport for the driven loop. */
  backend: 'sandbox' | 'bridge' | 'router'
  /** `sandbox` backend: the caller's real Sandbox-backed client. Required for that backend. */
  sandboxClient?: SandboxClient
  /** `bridge` backend: local cli-bridge transport. `bearer` + `model` required. */
  bridge?: {
    /** cli-bridge base URL. Defaults to `http://127.0.0.1:3355`. */
    url?: string
    bearer: string
    /** Bridge model id, doubling as the harness selector (e.g. `claude-code/sonnet`). */
    model: string
    /** Per-turn deadline (ms). */
    timeoutMs?: number
  }
  /** `router` backend: router chat-completion transport. All three fields required. */
  router?: {
    baseUrl: string
    key: string
    model: string
  }
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
      if (!bridge?.bearer || !bridge.model) {
        throw new Error(
          "resolveSandboxClient: backend 'bridge' requires bridge.bearer and bridge.model",
        )
      }
      return inlineSandboxClient(
        createExecutor({
          backend: 'bridge',
          bridgeUrl: bridge.url ?? 'http://127.0.0.1:3355',
          bridgeBearer: bridge.bearer,
          model: bridge.model,
          timeoutMs: bridge.timeoutMs,
        }),
      )
    }
    case 'router': {
      const router = opts.router
      if (!router?.baseUrl || !router.key || !router.model) {
        throw new Error(
          "resolveSandboxClient: backend 'router' requires router.baseUrl, router.key and router.model",
        )
      }
      return inlineSandboxClient(
        createExecutor({
          backend: 'router',
          routerBaseUrl: router.baseUrl,
          routerKey: router.key,
          model: router.model,
        }),
      )
    }
  }
}
