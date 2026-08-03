/**
 * The chat-transport leaf executor: a worker whose runtime is a plain OpenAI-compatible
 * `/v1/chat/completions` transport — the worker IS a model conversation, not a sandboxed process
 * (#721). Tool calls are optional (none, or a caller-provided tool table executed on this host).
 * A chat worker gets everything real workers get through the open `Executor` port: node pinning,
 * conserved spend, settle/verdict, journal + edge ledger.
 *
 * Module home: a standalone leaf-executor module beside `worktree-cli-executor.ts` — a direct
 * `(options) → Executor` constructor, NOT a `createExecutor` backend variant. The reason is
 * continuity: `workerFromBackend` (the backend-as-data path every `ExecutorConfig` rides) creates
 * a fresh executor per spawn with no session re-attachment and deliberately FAILS LOUD on a
 * `continuity: 'resume'` spawn; the documented resume consumer is a session-owning
 * `makeWorkerAgent` seam. {@link chatWorkerSeam} is that seam, and this module ships both halves
 * together so no caller re-derives the resume wiring.
 *
 * Transport shape: NON-streaming, one buffered POST per turn — the simplest honest choice.
 * A streaming executor cannot mark an unmetered turn today (`UsageEvent`'s `tokens` variant has
 * no `tokensKnown: false` twin — see the documented limitation in `./types`), while the one-shot
 * path returns a whole `Spend` that carries both markers. Honesty wins over liveness here.
 *
 * Metering: tokens come from the transport's `usage` fields; a turn without usage marks
 * `tokensKnown: false`. Dollars come ONLY from the response's own cost fields (`usage.cost` /
 * `usage.cost_usd`, the cli-bridge and OpenRouter conventions); a turn without one marks
 * `usdKnown: false`. NEVER estimated from a local price table — this executor speaks to arbitrary
 * OpenAI-compatible endpoints whose models a local table cannot price, and a silent estimate is a
 * fabricated measurement.
 *
 * @experimental
 */

import { randomUUID } from 'node:crypto'
import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import type {
  MakeWorkerAgent,
  WorkerResumeContext,
  WorkerSpawnContext,
} from '../../mcp/tools/coordination'
import type { ToolSpec } from '../router-client'
import { zeroTokenUsage } from '../util'
import { canonicalizeAuthoredProfile } from './authoring'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import { attestRuntimeOwnedExecutor, newExecutionAttemptId } from './materialization'
import { concreteModelId, concreteProfileModel } from './model-policy'
import { mergeAbortSignals, taskToPrompt } from './runtime'
import type { Agent, AgentSpec, Executor, ExecutorResult, Runtime, Spend } from './types'

// ── The transport ──────────────────────────────────────────────────────────────

/** One buffered chat-completions call: the OpenAI-shape request body in, the parsed completion
 *  JSON out. The ONE wire function of this module — the executor's default transport is built
 *  from it, and a harness that must prove two arms share a substrate (P1 parity) drives BOTH
 *  through the same instance. */
export type ChatCompletionsTransport = (
  body: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>

/** The default transport: POST `${url}/chat/completions` with an optional bearer. Fail-loud on
 *  any non-2xx — the status and body head become the settle reason. */
export function chatCompletionsTransport(opts: {
  url: string
  bearer?: string
}): ChatCompletionsTransport {
  if (typeof opts.url !== 'string' || opts.url.length === 0) {
    throw new ValidationError('chatCompletionsTransport: url required')
  }
  const endpoint = `${opts.url.replace(/\/$/, '')}/chat/completions`
  return async (body, signal) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) {
      throw new ValidationError(`chat transport ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
    return res.json()
  }
}

// ── The session store (continuity substrate) ───────────────────────────────────

/** Conversation history keyed by the settled worker id — the resume substrate. The kernel owns
 *  identity, ordering, ledger truth, and spend continuity; this store owns only the message
 *  lists a `'resume'` spawn continues (`WorkerSpawnContext.resume.ofWorker` is the load key).
 *  PROCESS-LOCAL by the same boundary the kernel documents for resume itself: a prior process's
 *  workers are not resume targets. */
export interface ChatSessionStore {
  load(workerId: string): ReadonlyArray<Record<string, unknown>> | undefined
  save(workerId: string, messages: ReadonlyArray<Record<string, unknown>>): void
}

/** In-memory `ChatSessionStore`. Entries are detached copies — a caller mutating a saved array
 *  cannot corrupt a recorded session. */
export function createChatSessionStore(): ChatSessionStore {
  const sessions = new Map<string, ReadonlyArray<Record<string, unknown>>>()
  return {
    load: (workerId) => sessions.get(workerId),
    save: (workerId, messages) => {
      sessions.set(workerId, structuredClone(messages) as ReadonlyArray<Record<string, unknown>>)
    },
  }
}

// ── The executor ───────────────────────────────────────────────────────────────

/** One entry of the caller-provided tool table: the OpenAI function spec the model sees, and the
 *  host-side implementation run when the model calls it. */
export interface ChatTransportTool {
  readonly spec: ToolSpec
  /** Runs ON THIS HOST; the returned string folds back as the `tool` message. A throw is fed
   *  back as an error message for the model to correct — a bad tool call is a real outcome, not
   *  an infra fault. */
  readonly execute: (args: Record<string, unknown>, task: unknown) => Promise<string>
}

export interface ChatTransportExecutorOptions {
  /** OpenAI-compatible base URL (with or without `/v1`); the executor POSTs to
   *  `${url}/chat/completions`. Ignored when `complete` is injected. */
  url: string
  /** Bearer token for the default transport. Omit for an unauthenticated endpoint. */
  bearer?: string
  /** The wire model id sent on every completion. */
  model: string
  /** System prompt seeding a FRESH conversation. A resumed conversation keeps the system message
   *  it was recorded with — a session continues; it is not re-primed. */
  system?: string
  /** Tool table. Omitted = a pure conversation (no `tools` field on the wire). */
  tools?: ReadonlyArray<ChatTransportTool>
  temperature?: number
  /** Output-token ceiling for ONE completion, sent as `max_tokens` on every request when set.
   *  Omitted = no field on the wire, so the endpoint's own default governs. A harness pairing
   *  this executor against another sampling path (P1 parity) pins BOTH arms to one value. */
  maxTokens?: number
  /** Inference-turn cap for ONE shot (one `execute`). Default 200 — a runaway backstop, not a
   *  workflow limit (mirrors `routerToolsInlineExecutor.maxTurns`). */
  maxTurnsPerShot?: number
  /** Injected buffered transport — the offline seam (mirrors `RouterConfig.complete`). When set,
   *  `url`/`bearer` are unused and NO network is touched. */
  complete?: ChatCompletionsTransport
  /** Session store backing continuity. Required to record this conversation (with `sessionKey`)
   *  or to continue a prior one (with `resume`). */
  sessions?: ChatSessionStore
  /** The id this worker's conversation is recorded under at settle — the kernel node id when
   *  spawned through a scope, so a later `'resume'` spawn's `resume.ofWorker` finds it. */
  sessionKey?: string
  /** The resume lineage from `WorkerSpawnContext.resume`: this shot continues `ofWorker`'s
   *  recorded message list. Requires `sessions` holding that conversation — fails loud before
   *  any spend when it does not. */
  resume?: WorkerResumeContext
  /** Profile this executor materializes, for the kernel's materialization receipt. Omitted =
   *  the node's receipt reads `executor-did-not-report` (a direct, unsupervised use). */
  profile?: AgentProfile
  /** Kernel-minted attempt id (`ExecutorNodeContext.attemptId`) binding the receipt to this
   *  exact spawn. */
  attemptId?: string
}

interface ChatCompletionMessage {
  content?: string | null
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: ChatCompletionMessage }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    cost?: number
    cost_usd?: number
  }
}

const CHAT_TRANSPORT_RUNTIME: Runtime = 'chat-transport'

/**
 * Build the chat-transport `Executor`: one `execute` = one conversation SHOT — seed (fresh system
 * prompt, or the resumed session's recorded history) + the task as the next user message, then
 * loop completion → host tool calls → tool messages until the model answers without a tool call
 * (or the turn cap). Settles with the final assistant text as `out`.
 *
 * Fail-loud contract: transport failures (non-2xx, network faults, malformed completions) throw
 * `ValidationError`, which the scope settles as an INFRA failure (`Settled.down.infra`) — never a
 * fake success. The accumulated conversation is still recorded before the throw when a store is
 * configured, because the inference HAPPENED and a resume may continue a failed session (the
 * kernel deliberately allows resume-after-failure; the seam decides).
 */
export function chatTransportExecutor(opts: ChatTransportExecutorOptions): Executor<string> {
  const model = concreteModelId(opts.model)
  if (!model) throw new ValidationError('chatTransportExecutor: model required')
  if (!opts.complete && (typeof opts.url !== 'string' || opts.url.length === 0)) {
    throw new ValidationError('chatTransportExecutor: url required (or inject `complete`)')
  }
  for (const tool of opts.tools ?? []) {
    if (typeof tool.spec?.function?.name !== 'string' || typeof tool.execute !== 'function') {
      throw new ValidationError(
        'chatTransportExecutor: every tools entry needs spec.function.name + execute',
      )
    }
  }
  const maxTurns = opts.maxTurnsPerShot ?? 200
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new ValidationError('chatTransportExecutor: maxTurnsPerShot must be a positive integer')
  }
  if (opts.maxTokens !== undefined && (!Number.isInteger(opts.maxTokens) || opts.maxTokens < 1)) {
    throw new ValidationError('chatTransportExecutor: maxTokens must be a positive integer')
  }
  // Resolve the seed BEFORE any spend: a resume that cannot re-attach is a configuration fault.
  let seed: Array<Record<string, unknown>>
  if (opts.resume) {
    if (!opts.sessions) {
      throw new ValidationError(
        "chatTransportExecutor: a 'resume' spawn needs `sessions` — the store holding the " +
          'conversation this shot continues',
      )
    }
    const prior = opts.sessions.load(opts.resume.ofWorker)
    if (prior === undefined) {
      throw new ValidationError(
        `chatTransportExecutor: no recorded conversation for worker '${opts.resume.ofWorker}' — ` +
          'the session store holds only conversations recorded by this process (the kernel’s ' +
          'process-local resume boundary)',
      )
    }
    seed = structuredClone(prior) as Array<Record<string, unknown>>
  } else {
    seed =
      opts.system !== undefined && opts.system.length > 0
        ? [{ role: 'system', content: opts.system }]
        : []
  }
  const transport =
    opts.complete ??
    chatCompletionsTransport({ url: opts.url, ...(opts.bearer ? { bearer: opts.bearer } : {}) })
  const toolSpecs = (opts.tools ?? []).map((tool) => tool.spec)
  const toolByName = new Map((opts.tools ?? []).map((tool) => [tool.spec.function.name, tool]))

  const controller = new AbortController()
  let artifact: ExecutorResult<string> | undefined
  let executed = false
  const executionId = opts.sessionKey ?? `chat-session-${randomUUID()}`
  const attemptId = opts.attemptId ?? newExecutionAttemptId(executionId)

  const executor: Executor<string> = {
    runtime: CHAT_TRANSPORT_RUNTIME,
    async execute(task, signal): Promise<ExecutorResult<string>> {
      // The seed is consumed once: a second execute would replay a stale conversation and
      // double-record the session. One executor instance = one shot, per the spawn contract.
      if (executed) {
        throw new ValidationError('chatTransportExecutor: execute() called twice on one instance')
      }
      executed = true
      const started = Date.now()
      const messages = seed
      messages.push({ role: 'user', content: taskToPrompt(task) })
      const linked = mergeAbortSignals(signal, controller.signal)
      const tokens = zeroTokenUsage()
      let tokensKnown = true
      let usd = 0
      let usdKnown = true
      let turns = 0
      let lastText = ''
      try {
        for (let t = 0; t < maxTurns; t += 1) {
          const body: Record<string, unknown> = {
            model,
            messages,
            ...(toolSpecs.length > 0 ? { tools: toolSpecs, tool_choice: 'auto' } : {}),
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
            ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
          }
          let raw: unknown
          try {
            raw = await transport(body, linked)
          } catch (cause) {
            // An abort is the caller's own teardown/deadline — propagate untouched so the scope
            // classifies it as the abort it is, not as a transport fault of this executor.
            if (cause instanceof Error && cause.name === 'AbortError') throw cause
            if (cause instanceof ValidationError) throw cause
            throw new ValidationError(
              `chatTransportExecutor: transport failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
          }
          turns += 1
          const data = raw as ChatCompletionResponse
          const usage = data?.usage
          if (
            usage &&
            typeof usage.prompt_tokens === 'number' &&
            typeof usage.completion_tokens === 'number'
          ) {
            tokens.input += usage.prompt_tokens
            tokens.output += usage.completion_tokens
          } else {
            tokensKnown = false
          }
          const turnCost =
            typeof usage?.cost === 'number'
              ? usage.cost
              : typeof usage?.cost_usd === 'number'
                ? usage.cost_usd
                : undefined
          if (turnCost !== undefined) usd += turnCost
          else usdKnown = false
          const msg = data?.choices?.[0]?.message
          if (msg === undefined) {
            throw new ValidationError(
              'chatTransportExecutor: transport returned no choices[0].message',
            )
          }
          if (typeof msg.content === 'string' && msg.content.length > 0) lastText = msg.content
          const toolCalls = msg.tool_calls ?? []
          if (toolCalls.length === 0 || toolSpecs.length === 0) {
            // Record the terminal assistant turn so a resumed session continues from it.
            messages.push({ role: 'assistant', content: msg.content ?? '' })
            break
          }
          // Record the assistant turn verbatim, then run each call on the host and fold the
          // result back as a `tool` message for the next turn (the routerToolsInline shape).
          messages.push({
            role: 'assistant',
            content: msg.content ?? '',
            tool_calls: toolCalls.map((tc, i) => ({
              id: tc.id ?? `call_${i}`,
              type: 'function',
              function: {
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '{}',
              },
            })),
          })
          for (let i = 0; i < toolCalls.length; i += 1) {
            const tc = toolCalls[i]
            const id = tc?.id ?? `call_${i}`
            const name = tc?.function?.name ?? ''
            const tool = toolByName.get(name)
            if (!tool) {
              messages.push({
                role: 'tool',
                tool_call_id: id,
                content: `error: unknown tool '${name}'`,
              })
              continue
            }
            let args: Record<string, unknown>
            try {
              args = JSON.parse(tc?.function?.arguments ?? '{}') as Record<string, unknown>
            } catch {
              messages.push({
                role: 'tool',
                tool_call_id: id,
                content: 'error: tool arguments were not valid JSON',
              })
              continue
            }
            let result: string
            try {
              result = await tool.execute(args, task)
            } catch (cause) {
              result = `error: ${cause instanceof Error ? cause.message : String(cause)}`
            }
            messages.push({ role: 'tool', tool_call_id: id, content: result })
          }
        }
      } finally {
        // The turns that RAN are recorded even when the shot failed: the kernel deliberately
        // allows resuming a failed prior worker, and the seam decides. Recording only successes
        // would silently amputate a resumed session's real history.
        if (opts.sessions && opts.sessionKey !== undefined) {
          opts.sessions.save(opts.sessionKey, messages)
        }
      }
      const spent: Spend = {
        iterations: turns,
        tokens,
        ...(tokensKnown ? {} : { tokensKnown: false }),
        usd,
        ...(usdKnown ? {} : { usdKnown: false }),
        ms: Date.now() - started,
      }
      artifact = {
        outRef: contentAddress({ kind: 'chat-transport', model, content: lastText, turns }),
        out: lastText,
        spent,
      }
      return artifact
    },
    teardown(_grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError('chatTransportExecutor: resultArtifact() read before execute()')
      }
      return { ...artifact, spent: artifact.spent }
    },
  }
  if (opts.profile === undefined) return executor
  return attestRuntimeOwnedExecutor(
    executor,
    {
      effectiveProfile: opts.profile,
      backend: 'chat-transport',
      model: { status: 'known', id: model },
      execution: { kind: 'session', id: executionId },
      materializer: 'chat-transport-conversation',
      plan: {
        kind: 'openai-chat-conversation',
        model,
        maxTurnsPerShot: maxTurns,
        tools: toolSpecs,
        resumeOf: opts.resume?.ofWorker ?? null,
      },
    },
    {
      attemptId,
      binding: {
        endpoint: opts.complete ? 'injected-transport' : opts.url,
        model,
        sessionKey: opts.sessionKey ?? null,
      },
      descriptor: {
        kind: 'chat-transport-session',
        transport: opts.complete ? 'injected' : 'http',
        backend: 'chat-transport',
      },
    },
  )
}

// ── The worker seam (the resume consumer) ──────────────────────────────────────

export interface ChatWorkerSeamOptions {
  /** OpenAI-compatible base URL every spawned worker speaks. Unused when `complete` is set. */
  url: string
  bearer?: string
  /** Fallback wire model when a spawned profile carries none (`profile.model.default` wins). */
  model?: string
  tools?: ReadonlyArray<ChatTransportTool>
  temperature?: number
  /** Per-completion `max_tokens` for every spawned worker (see
   *  {@link ChatTransportExecutorOptions.maxTokens}). */
  maxTokens?: number
  maxTurnsPerShot?: number
  /** Injected buffered transport — the offline seam; no network is touched when set. */
  complete?: ChatCompletionsTransport
  /** Session store backing continuity. Default: one fresh in-memory store PER SEAM, matching the
   *  kernel's process-local resume boundary (one seam = one run's sessions). */
  sessions?: ChatSessionStore
  /** The completion oracle: each worker settles `valid` ⟺ this check passes on its final
   *  assistant text (`gateOnDeliverable` — settled ⟺ DELIVERED, exactly how `workerFromBackend`
   *  composes it). Pass the graph's deliverable so a keep-best driver can pick a winner; omitted,
   *  workers settle unverdicted and only a driver `submit_result` can win. */
  deliverable?: DeliverableSpec<unknown>
}

/**
 * The `makeWorkerAgent` seam over {@link chatTransportExecutor} — the continuity consumer
 * `workerFromBackend` refuses to be. Every spawn becomes one conversation shot: the spawned
 * profile's system prompt + instructions (which is where a graph's delegates directive lands)
 * seed a fresh session, and a `'resume'` spawn re-attaches by loading `resume.ofWorker`'s
 * recorded message list from the seam's session store. Conversations are recorded under the
 * kernel node id, which is exactly what a later `resume.ofWorker` names.
 */
export function chatWorkerSeam(opts: ChatWorkerSeamOptions): MakeWorkerAgent {
  if (!opts.complete && (typeof opts.url !== 'string' || opts.url.length === 0)) {
    throw new ValidationError('chatWorkerSeam: url required (or inject `complete`)')
  }
  const sessions = opts.sessions ?? createChatSessionStore()
  return (rawProfile, spawnContext?: WorkerSpawnContext) => {
    // The supervisor authors in the skill's flat vocabulary; lift + validate here exactly like
    // `workerFromBackend` — the one other place a profile becomes a spawnable worker.
    const parsed = agentProfileSchema.safeParse(canonicalizeAuthoredProfile(rawProfile))
    if (!parsed.success) {
      throw new ValidationError(`chatWorkerSeam: invalid AgentProfile: ${parsed.error.message}`)
    }
    const profile = parsed.data
    const model = concreteProfileModel(profile) ?? concreteModelId(opts.model)
    if (!model) {
      throw new ValidationError(
        'chatWorkerSeam: no model — set ChatWorkerSeamOptions.model or AgentProfile.model.default',
      )
    }
    const system = [profile.prompt?.systemPrompt, ...(profile.prompt?.instructions ?? [])]
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      .join('\n')
    const name = profile.name ?? 'chat-worker'
    const spec: AgentSpec = {
      profile,
      harness: null,
      // Per-spawn factory: built only after admission, with the kernel node context — the node id
      // is the session-record key a later resume names, and the attempt id binds the receipt.
      executorFactory: (executorSpec, ctx) => {
        const executor = chatTransportExecutor({
          url: opts.url,
          ...(opts.bearer !== undefined ? { bearer: opts.bearer } : {}),
          model,
          ...(system.length > 0 ? { system } : {}),
          ...(opts.tools !== undefined ? { tools: opts.tools } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
          ...(opts.maxTurnsPerShot !== undefined ? { maxTurnsPerShot: opts.maxTurnsPerShot } : {}),
          ...(opts.complete !== undefined ? { complete: opts.complete } : {}),
          sessions,
          ...(ctx.node?.nodeId !== undefined ? { sessionKey: ctx.node.nodeId } : {}),
          ...(spawnContext?.resume !== undefined ? { resume: spawnContext.resume } : {}),
          profile: executorSpec.profile,
          ...(ctx.node?.attemptId !== undefined ? { attemptId: ctx.node.attemptId } : {}),
        })
        return opts.deliverable ? gateOnDeliverable(executor, opts.deliverable) : executor
      },
    }
    return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
}
