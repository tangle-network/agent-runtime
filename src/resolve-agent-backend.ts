/**
 * The product-facing backend selector for `runChatThroughRuntime` /
 * `runAgentTaskStream`: one call turns a `--backend {router,tcloud,cli-bridge,
 * sandbox}` choice into the `AgentExecutionBackend` the chat leg runs on.
 *
 * It is the `AgentExecutionBackend` sibling of `resolveSandboxClient` (which
 * resolves the `SandboxClient` a `runLoop` drives). Both exist for the same
 * reason: every in-process eval product hand-rolled the identical
 * "`backend-name` → `createOpenAICompatibleBackend`" branch, and the copies
 * drift. This is the single generic resolver they share.
 *
 *   - `router` / `tcloud` / `cli-bridge` → OpenAI-compatible chat completions.
 *     All three speak `POST {baseUrl}/chat/completions` in OpenAI's SSE shape —
 *     the router (a.k.a. tcloud) IS that endpoint, and cli-bridge fronts a
 *     harness CLI behind the same protocol at its own `/v1`. They differ only
 *     in `baseUrl` / `apiKey` and the `kind` label a product wants on its
 *     traces. cli-bridge REQUIRES `model` in the request body, so it MUST route
 *     through `createOpenAICompatibleBackend` (which sends it), never a
 *     transport that drops the field.
 *   - `sandbox` → the caller's own domain backend. The sandbox variant carries
 *     product specifics (system prompt, workspace id, in-box D1 executor) that
 *     do NOT belong in the substrate, so the product passes a `sandboxBackend()`
 *     seam that this resolver simply invokes.
 *
 * This resolver is PURE backend selection. Product concerns — credit hard-cuts,
 * fetch-capture shims, D1 platform wiring — stay as product-side WRAPPERS
 * around the returned backend. The OpenAI-compat passthrough fields (`tools`,
 * `toolChoice`, `responseFormat`, `fetchImpl`, `retry`) are forwarded verbatim
 * so a product can advertise its app tools or install a capturing fetch without
 * re-opening the branch this consolidation closes.
 */

import { createOpenAICompatibleBackend } from './backends'
import type { AgentBackendInput, AgentExecutionBackend } from './types'

/** The transport a chat backend runs on. */
export type AgentBackendKind = 'router' | 'tcloud' | 'cli-bridge' | 'sandbox'

/**
 * OpenAI-compat passthrough forwarded to `createOpenAICompatibleBackend` for
 * the `router` / `tcloud` / `cli-bridge` kinds. Mirrors that factory's optional
 * inputs so a product keeps its tool advertising / capture-fetch without
 * re-implementing the backend branch.
 */
type OpenAICompatPassthrough = Pick<
  Parameters<typeof createOpenAICompatibleBackend>[0],
  'tools' | 'toolChoice' | 'responseFormat' | 'fetchImpl' | 'retry'
>

export interface ResolveAgentBackendOptions<TInput extends AgentBackendInput = AgentBackendInput>
  extends OpenAICompatPassthrough {
  /** The chat transport to resolve. */
  kind: AgentBackendKind
  /**
   * Bearer credential for the OpenAI-compat kinds. Empty string is valid for a
   * loopback-anonymous cli-bridge; a `router`/`tcloud` route with an empty key
   * is a caller bug the product surfaces before calling in.
   */
  apiKey: string
  /** Base URL for the OpenAI-compat kinds. cli-bridge's is its `/v1`. */
  baseUrl: string
  /** Model id sent on every request. cli-bridge rejects a request without it. */
  model: string
  /** `kind` label stamped on the resolved backend + its traces. Defaults to `kind`. */
  label?: string
  /**
   * `sandbox` kind: the product's own domain backend. Required for that kind —
   * the substrate owns no product sandbox shape, so a `sandbox` resolution with
   * no seam is a caller bug, not a silent fallback.
   */
  sandboxBackend?: () => AgentExecutionBackend<TInput>
}

/**
 * Resolve the `AgentExecutionBackend` for the chosen `kind`. Reuse this instead
 * of hand-rolling the `createOpenAICompatibleBackend` branch in each product.
 */
export function resolveAgentBackend<TInput extends AgentBackendInput = AgentBackendInput>(
  opts: ResolveAgentBackendOptions<TInput>,
): AgentExecutionBackend<TInput> {
  switch (opts.kind) {
    case 'router':
    case 'tcloud':
    case 'cli-bridge': {
      const passthrough: OpenAICompatPassthrough = {}
      // Forward only the fields a caller actually set — an explicit
      // `tools: []` / `undefined` would otherwise reach the factory and change
      // its request shape (some providers reject an empty `tools` array).
      if (opts.tools !== undefined) passthrough.tools = opts.tools
      if (opts.toolChoice !== undefined) passthrough.toolChoice = opts.toolChoice
      if (opts.responseFormat !== undefined) passthrough.responseFormat = opts.responseFormat
      if (opts.fetchImpl !== undefined) passthrough.fetchImpl = opts.fetchImpl
      if (opts.retry !== undefined) passthrough.retry = opts.retry
      return createOpenAICompatibleBackend<TInput>({
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        model: opts.model,
        kind: opts.label ?? opts.kind,
        ...passthrough,
      })
    }
    case 'sandbox': {
      if (!opts.sandboxBackend) {
        throw new Error("resolveAgentBackend: kind 'sandbox' requires opts.sandboxBackend")
      }
      return opts.sandboxBackend()
    }
  }
}
