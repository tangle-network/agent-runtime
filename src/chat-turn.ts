/**
 * Chat-turn primitive — the canonical wire pattern for sending an AgentProfile
 * to a sandbox runtime per turn.
 *
 * Today's product agents (legal/gtm/tax/creative) implement variants of this
 * same loop in their own `src/lib/.server/agent-runtime/chat.ts` files — 1,249
 * lines duplicated across 3 repos at ~80% overlap. Only tax-agent does the
 * canonical pattern (`packages/api-worker/src/routes/sessions.ts:611-720`):
 * builds a per-turn profile via `mergeAgentProfiles`, POSTs it to the
 * sandbox's `/runtime/agents/run/stream` endpoint. The other 3 ship a stub
 * profile to `client.create()` and pass the system prompt as a flat string.
 * The canonical AgentProfile — its subagents, MCP servers, permissions —
 * never reaches the sandbox.
 *
 * `runChatTurn` is the extraction. Every consumer passes their canonical
 * profile + the user's message; the helper composes the per-turn overlay,
 * POSTs the FULL profile, and bridges the SSE stream back as
 * `RuntimeStreamEvent`s. Callers consume the same iterable surface
 * `runAgentTaskStream` already exposes — so existing UI / persistence /
 * trace bridges keep working unchanged.
 *
 * This is the linchpin of canonical conformance: when all 4 product agents
 * use this, the full AgentProfile reaches the sandbox per turn by
 * construction, and the "stub profile" anti-pattern is eliminated by API
 * shape rather than discipline.
 */

import type {
  AgentProfile,
  AgentProfilePrompt,
  AgentProfileResources,
  AgentSubagentProfile,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { mergeAgentProfiles } from '@tangle-network/sandbox'
import type { RuntimeStreamEvent } from './types'

/** A message in the chat turn's prior context. Provider-neutral. */
export interface ChatTurnMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** Optional metadata the consumer wants threaded through (timestamps, msg id, etc). */
  metadata?: Record<string, unknown>
}

/**
 * Per-turn profile overlay. The caller's profile is the durable contract;
 * the overlay carries volatile per-turn context (workspace facts, dynamic-
 * advisor instructions, RAG hits) that the runtime should see but that
 * doesn't belong in the canonical profile.
 *
 * Composed via `mergeAgentProfiles(baseProfile, overlay)` — the same
 * primitive tax-agent uses (`packages/api-worker/src/routes/sessions.ts:638-641`).
 */
export interface ChatTurnOverlay {
  /** Volatile prompt additions: dynamic-advisor context, intake gate output, RAG citations. */
  promptOverlay?: AgentProfilePrompt
  /** Per-turn additional file mounts (vault docs, recent uploads). */
  resourcesOverlay?: AgentProfileResources
  /** Override or augment the subagent map for this turn (rare). */
  subagentsOverlay?: Record<string, AgentSubagentProfile>
  /** Free-form metadata threaded into the runtime call. */
  metadata?: Record<string, unknown>
}

/**
 * Sandbox runtime contract — the subset of `SandboxInstance` `runChatTurn`
 * actually invokes. Defined as an interface so consumers can inject a
 * stub in tests without standing up a real sandbox.
 */
export interface ChatTurnSandbox {
  /** Sandbox identifier used in the runtime URL. */
  readonly id: string
  /** Base URL of the sandbox runtime, e.g. `https://sandbox.tangle.tools/v1/sandboxes/&lt;id&gt;`. */
  readonly runtimeUrl: string
  /** Optional bearer for the runtime call (sidecar auth). */
  readonly authHeader?: { name: string; value: string }
}

export interface RunChatTurnOptions {
  /** Canonical agent profile — the durable contract. */
  profile: AgentProfile
  /** Volatile per-turn additions. */
  overlay?: ChatTurnOverlay
  /** Current user message. */
  message: string
  /** Prior conversation. */
  priorMessages: readonly ChatTurnMessage[]
  /** Sandbox the turn should run inside. */
  sandbox: ChatTurnSandbox
  /** Override model for this turn (otherwise profile.model.default is used). */
  modelOverride?: string
  /** AbortSignal for cancellation (timeouts, client disconnect, etc). */
  signal?: AbortSignal
  /** Override fetch (for tests). */
  fetch?: typeof fetch
}

const RUNTIME_PATH = '/runtime/agents/run/stream'

/**
 * The canonical chat-turn primitive.
 *
 * Composes per-turn profile via `mergeAgentProfiles(profile, overlay)`, POSTs
 * to the sandbox's runtime streaming endpoint with the FULL composed profile
 * (the runtime resolves prompt + subagents + MCP servers + permissions from
 * the profile — consumers never have to hand-craft `backend.profile` shape),
 * and yields parsed `RuntimeStreamEvent`s.
 *
 * Caller pattern (replaces ~400 lines of legal/gtm/creative chat-runtime
 * wrappers):
 *
 *     for await (const event of runChatTurn({ profile, overlay, message, priorMessages, sandbox })) {
 *       // existing event handling — type === 'message' / 'tool_call' / 'task_complete' / etc.
 *     }
 */
export async function* runChatTurn(
  options: RunChatTurnOptions,
): AsyncIterable<RuntimeStreamEvent> {
  const turnProfile = options.overlay
    ? composeTurnProfile(options.profile, options.overlay)
    : options.profile
  const url = `${options.sandbox.runtimeUrl}${RUNTIME_PATH}`
  // `AgentProfile` itself doesn't carry a `backend.type` — that's a transport-
  // level concern. Consumers can hint via `metadata.backend` if they want a
  // non-default backend; otherwise we send the canonical `claude-code` shape.
  const backendType = ((turnProfile.metadata as { backend?: { type?: string } } | undefined)?.backend?.type)
    ?? 'claude-code'
  const body = JSON.stringify({
    backend: {
      type: backendType,
      profile: turnProfile,
      ...(options.modelOverride ? { model: { default: options.modelOverride } } : {}),
    },
    messages: [...options.priorMessages, { role: 'user', content: options.message }],
  })
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (options.sandbox.authHeader) {
    headers[options.sandbox.authHeader.name] = options.sandbox.authHeader.value
  }
  const fetchImpl = options.fetch ?? fetch
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body,
    signal: options.signal,
  })
  if (!response.ok || !response.body) {
    const text = response.body ? await response.text() : ''
    throw new ChatTurnError(
      `runChatTurn: sandbox returned ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
      response.status,
    )
  }
  yield* parseSseStream(response.body)
}

/**
 * Compose the per-turn AgentProfile. Public-and-pure so consumers can
 * preview/log/persist the composed shape without firing a runtime call.
 */
export function composeTurnProfile(base: AgentProfile, overlay: ChatTurnOverlay): AgentProfile {
  const partial: Partial<AgentProfile> = {}
  if (overlay.promptOverlay) partial.prompt = overlay.promptOverlay
  if (overlay.resourcesOverlay) partial.resources = overlay.resourcesOverlay
  if (overlay.subagentsOverlay) partial.subagents = overlay.subagentsOverlay
  if (overlay.metadata) partial.metadata = overlay.metadata
  return mergeAgentProfiles(base, partial) ?? base
}

/** SSE/NDJSON line parser — handles the standard runtime stream shape. */
async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<RuntimeStreamEvent> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '').trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        // SSE: lines starting with `data:` carry the JSON payload.
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line
        if (payload === '[DONE]' || payload === '') continue
        try {
          const parsed = JSON.parse(payload) as RuntimeStreamEvent
          yield parsed
        } catch {
          // Non-JSON sentinel line (heartbeats, comments, etc) — skip silently.
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export class ChatTurnError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ChatTurnError'
  }
}

/**
 * Convenience: build a `ChatTurnSandbox` from a full `SandboxInstance`. Most
 * callers already have one of these from `client.create()`. The runtime URL
 * is derived from the instance's transport configuration.
 */
export function sandboxAsChatTurnTarget(
  instance: SandboxInstance,
  opts?: { authHeader?: { name: string; value: string } },
): ChatTurnSandbox {
  // `SandboxInstance.url` is the live agent URL when set (see
  // `@tangle-network/sandbox` types). The runtime path is appended in
  // `runChatTurn`, so we strip any trailing slash here.
  const base = (instance as unknown as { url?: string }).url
    ?? (instance as unknown as { connection?: { runtimeUrl?: string } }).connection?.runtimeUrl
    ?? ''
  if (!base) {
    throw new ChatTurnError(
      `sandboxAsChatTurnTarget: SandboxInstance has neither .url nor .connection.runtimeUrl set`,
    )
  }
  return {
    id: instance.id,
    runtimeUrl: base.replace(/\/+$/, ''),
    authHeader: opts?.authHeader,
  }
}
