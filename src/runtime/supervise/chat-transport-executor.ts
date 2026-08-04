/**
 * A session-owning composition over Runtime's canonical Router tool-loop executor.
 *
 * This module adds conversation persistence for graph-edge `resume` continuity. It does not own
 * model selection, prompts, generation controls, retries, tool policy, or provider accounting:
 * those are lowered from one exact `AgentProfile` by `createExecutor({ backend: 'router-tools' })`.
 *
 * @experimental
 */

import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import type {
  MakeWorkerAgent,
  WorkerResumeContext,
  WorkerSpawnContext,
} from '../../mcp/tools/coordination'
import type { ToolSpec } from '../router-client'
import { type DeliverableSpec, gateOnDeliverable, mapExecutorResult } from './completion-gate'
import { assertExecutableAgentProfile } from './model-policy'
import { createExecutor, type RouterToolsSeam } from './runtime'
import type { Agent, AgentSpec, Executor, ExecutorContext, ExecutorResult } from './types'

/** Buffered OpenAI-compatible completion port used only for offline execution. */
export type ChatCompletionsTransport = NonNullable<RouterToolsSeam['complete']>

/** Conversation history keyed by the settled Runtime worker id. */
export interface ChatSessionStore {
  load(workerId: string): ReadonlyArray<Readonly<Record<string, unknown>>> | undefined
  save(workerId: string, messages: ReadonlyArray<Readonly<Record<string, unknown>>>): void
}

/** In-memory, process-local conversation store with detached reads and writes. */
export function createChatSessionStore(): ChatSessionStore {
  const sessions = new Map<string, ReadonlyArray<Readonly<Record<string, unknown>>>>()
  return {
    load(workerId) {
      const messages = sessions.get(workerId)
      return messages === undefined
        ? undefined
        : (structuredClone(messages) as ReadonlyArray<Readonly<Record<string, unknown>>>)
    },
    save(workerId, messages) {
      sessions.set(
        workerId,
        structuredClone(messages) as ReadonlyArray<Readonly<Record<string, unknown>>>,
      )
    },
  }
}

/** One profile-authorized function tool and its host implementation. */
export interface ChatTransportTool {
  readonly spec: ToolSpec
  readonly execute: (args: Record<string, unknown>, task: unknown) => Promise<string>
}

/**
 * Transport and session data for one exact profile-driven conversation.
 * Behavioral controls belong only in `profile.model.metadata`.
 */
export interface ChatTransportExecutorOptions {
  readonly profile: AgentProfile
  readonly url?: string
  readonly bearer?: string
  readonly tools?: ReadonlyArray<ChatTransportTool>
  readonly complete?: ChatCompletionsTransport
  readonly sessions?: ChatSessionStore
  readonly sessionKey?: string
  readonly resume?: WorkerResumeContext
}

function exactProfile(profile: AgentProfile, context: string): AgentProfile {
  const parsed = agentProfileSchema.safeParse(profile)
  if (!parsed.success)
    throw new ValidationError(`${context}: invalid AgentProfile: ${parsed.error.message}`)
  assertExecutableAgentProfile(parsed.data, context)
  return parsed.data
}

function initialMessages(
  opts: ChatTransportExecutorOptions,
): ReadonlyArray<Readonly<Record<string, unknown>>> | undefined {
  if (!opts.resume) return undefined
  if (!opts.sessions) {
    throw new ValidationError(
      "chat transport: a 'resume' spawn needs the session store holding the prior conversation",
    )
  }
  const prior = opts.sessions.load(opts.resume.ofWorker)
  if (prior === undefined) {
    throw new ValidationError(
      `chat transport: no recorded conversation for worker '${opts.resume.ofWorker}'`,
    )
  }
  return prior
}

function executorConfig(opts: ChatTransportExecutorOptions): {
  config: { backend: 'router-tools' } & RouterToolsSeam
  profile: AgentProfile
} {
  const profile = exactProfile(opts.profile, 'chat transport')
  if (!opts.complete && !opts.url) {
    throw new ValidationError('chat transport: url required unless complete is injected')
  }
  const tools = opts.tools ?? []
  for (const tool of tools) {
    if (!tool.spec.function.name || typeof tool.execute !== 'function') {
      throw new ValidationError('chat transport: every tool needs spec.function.name and execute')
    }
  }
  const resumed = initialMessages(opts)
  return {
    profile,
    config: {
      backend: 'router-tools',
      routerBaseUrl: opts.url ?? 'http://injected.invalid',
      routerKey: opts.bearer ?? (opts.complete ? 'injected-transport' : ''),
      tools: tools.map((tool) => tool.spec),
      executeToolCall: async (name, args, task) => {
        const tool = tools.find((candidate) => candidate.spec.function.name === name)
        if (!tool) throw new ValidationError(`chat transport: unknown tool ${JSON.stringify(name)}`)
        return tool.execute(args, task)
      },
      ...(opts.complete ? { complete: opts.complete } : {}),
      ...(resumed ? { initialMessages: resumed } : {}),
      ...(opts.sessions && opts.sessionKey
        ? {
            onMessages: (messages: ReadonlyArray<Readonly<Record<string, unknown>>>) => {
              opts.sessions?.save(opts.sessionKey as string, messages)
            },
          }
        : {}),
    },
  }
}

function buildChatTransportExecutor(
  opts: ChatTransportExecutorOptions,
  context: ExecutorContext,
): Executor<string> {
  const { config, profile } = executorConfig(opts)
  const spec: AgentSpec = { profile, harness: null }
  const inner = createExecutor(config)(spec, context) as Executor<unknown>
  return mapExecutorResult(inner, (result: ExecutorResult<unknown>) => {
    const raw = result.out as { content?: unknown }
    const content = typeof raw?.content === 'string' ? raw.content : ''
    return {
      outRef: contentAddress({ kind: 'chat-transport', profile, content }),
      out: content,
      ...(result.verdict ? { verdict: result.verdict } : {}),
    }
  })
}

/**
 * Build one exact profile-driven chat executor through `createExecutor`.
 * Prefer `chatWorkerSeam` for supervised work because it supplies trusted node identity.
 */
export function chatTransportExecutor(opts: ChatTransportExecutorOptions): Executor<string> {
  return buildChatTransportExecutor(opts, {
    signal: new AbortController().signal,
    seams: {},
  })
}

/** Transport/session configuration shared by every spawned exact profile. */
export interface ChatWorkerSeamOptions {
  readonly url?: string
  readonly bearer?: string
  readonly tools?: ReadonlyArray<ChatTransportTool>
  readonly complete?: ChatCompletionsTransport
  readonly sessions?: ChatSessionStore
  readonly deliverable?: DeliverableSpec<unknown>
}

/** Session-owning worker factory for graph continuity. */
export function chatWorkerSeam(opts: ChatWorkerSeamOptions): MakeWorkerAgent {
  if (!opts.complete && !opts.url) {
    throw new ValidationError('chatWorkerSeam: url required unless complete is injected')
  }
  const sessions = opts.sessions ?? createChatSessionStore()
  return (rawProfile, spawnContext?: WorkerSpawnContext) => {
    const profile = exactProfile(rawProfile, 'chatWorkerSeam')
    const name = profile.name ?? 'chat-worker'
    const spec: AgentSpec = {
      profile,
      harness: null,
      executorFactory: (executorSpec, context) => {
        const executor = buildChatTransportExecutor(
          {
            profile: executorSpec.profile,
            ...(opts.url ? { url: opts.url } : {}),
            ...(opts.bearer ? { bearer: opts.bearer } : {}),
            ...(opts.tools ? { tools: opts.tools } : {}),
            ...(opts.complete ? { complete: opts.complete } : {}),
            sessions,
            ...(context.node?.nodeId ? { sessionKey: context.node.nodeId } : {}),
            ...(spawnContext?.resume ? { resume: spawnContext.resume } : {}),
          },
          context,
        )
        return opts.deliverable ? gateOnDeliverable(executor, opts.deliverable) : executor
      },
    }
    return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
}
