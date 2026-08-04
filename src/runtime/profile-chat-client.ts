import type { ChatClient, ChatRequest } from '@tangle-network/agent-eval'
import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { collectAgentTurn, streamAgentTurn } from './stream-agent-turn'
import {
  assertExecutableAgentProfile,
  concreteModelId,
  type ProfileModelExecutionSettings,
  profileModelExecutionSettings,
} from './supervise/model-policy'
import { createExecutor, type ExecutorConfig } from './supervise/runtime'

/** Internal adapter for packages that consume agent-eval's ChatClient contract.
 * Every call still enters Runtime through createExecutor -> streamAgentTurn, and every
 * behavioral field is checked against the exact AgentProfile before any transport runs. */
export function profileChatClient(args: {
  profile: AgentProfile
  executor: ExecutorConfig
  context: string
}): ChatClient {
  const profile = agentProfileSchema.parse(args.profile)
  assertExecutableAgentProfile(profile, args.context)
  const model = concreteModelId(profile.model?.default)
  if (!model) throw new Error(`${args.context}: AgentProfile.model.default must be concrete`)
  const settings = profileModelExecutionSettings(profile, args.context)
  const systemPrompt = profile.prompt?.systemPrompt ?? ''

  return {
    transport: 'custom',
    defaultModel: model,
    ...(settings.maxAttempts !== undefined ? { maximumAttempts: settings.maxAttempts } : {}),
    async chat(req, callOpts) {
      assertProfileChatRequest(req, model, systemPrompt, settings, args.context)
      const messages = [
        ...(systemPrompt && req.messages[0]?.role !== 'system'
          ? [{ role: 'system' as const, content: systemPrompt }]
          : []),
        ...req.messages,
      ]
      const turnProfile = responseProfile(profile, req, args.context)
      const turn = await collectAgentTurn(
        streamAgentTurn(
          {
            kind: 'executor',
            profile: turnProfile,
            factory: createExecutor(args.executor),
          },
          { messages: messages as Array<{ role: string; content: unknown }> },
          {
            ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
            ...(callOpts?.signal ? { signal: callOpts.signal } : {}),
          },
        ),
      )
      if (turn.status !== 'completed') {
        throw new Error(`${args.context} failed: ${turn.error?.message ?? turn.status}`)
      }
      const resultOut = turn.output as { finishReason?: string } | undefined
      const promptTokens = turn.usage.input
      const completionTokens = turn.usage.output
      return {
        content: turn.finalText,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          ...(turn.usage.tokensKnown === false ? { captured: false } : {}),
          ...(typeof turn.usage.promptCache?.readTokens === 'number'
            ? { cachedPromptTokens: turn.usage.promptCache.readTokens }
            : {}),
        },
        // Runtime exposes catalog estimates separately; ChatResponse.costUsd is reserved
        // for provider-billed cost and therefore stays unknown here.
        costUsd: null,
        model,
        durationMs: terminalDurationMs(turn.events),
        finishReason: resultOut?.finishReason ?? null,
        contentEmpty: turn.finalText.trim().length === 0,
        raw: {
          ...(turn.usage.estimatedCostUsd !== undefined
            ? { estimatedCostUsd: turn.usage.estimatedCostUsd }
            : {}),
          ...(turn.usage.promptCache ? { promptCache: turn.usage.promptCache } : {}),
          ...(turn.transportAttempts !== undefined
            ? { transportAttempts: turn.transportAttempts }
            : {}),
        },
      }
    },
  }
}

function terminalDurationMs(
  events: ReadonlyArray<{ type: string; metadata?: Record<string, unknown> }>,
): number {
  const final = events.at(-1)?.metadata?.timing
  if (!final || typeof final !== 'object') return 0
  const duration = (final as Record<string, unknown>).durationMs
  return typeof duration === 'number' && Number.isFinite(duration) ? duration : 0
}

function responseProfile(profile: AgentProfile, req: ChatRequest, context: string): AgentProfile {
  const responseFormat = req.jsonSchema
    ? { type: 'json_schema', json_schema: req.jsonSchema }
    : req.jsonMode
      ? { type: 'json_object' }
      : undefined
  if (!responseFormat) return profile
  const existing = profile.model?.metadata?.extraBody
  if (
    existing !== undefined &&
    (typeof existing !== 'object' || existing === null || Array.isArray(existing))
  ) {
    throw new Error(`${context}: AgentProfile.model.metadata.extraBody must be an object`)
  }
  const existingFormat = (existing as Record<string, unknown> | undefined)?.response_format
  if (
    existingFormat !== undefined &&
    JSON.stringify(existingFormat) !== JSON.stringify(responseFormat)
  ) {
    throw new Error(`${context}: requested response format conflicts with AgentProfile`)
  }
  return agentProfileSchema.parse({
    ...profile,
    model: {
      ...profile.model,
      metadata: {
        ...(profile.model?.metadata ?? {}),
        extraBody: {
          ...(existing as Record<string, unknown> | undefined),
          response_format: responseFormat,
        },
      },
    },
  })
}

function assertProfileChatRequest(
  req: ChatRequest,
  model: string,
  systemPrompt: string,
  settings: ProfileModelExecutionSettings,
  context: string,
): void {
  if (req.model !== undefined && req.model !== model) {
    throw new Error(
      `${context}: request model ${JSON.stringify(req.model)} conflicts with AgentProfile model ${JSON.stringify(model)}`,
    )
  }
  const requestSystem = req.messages[0]?.role === 'system' ? req.messages[0].content : undefined
  if (requestSystem !== undefined && requestSystem !== systemPrompt) {
    throw new Error(`${context}: request system prompt conflicts with AgentProfile prompt`)
  }
  if (req.temperature !== undefined && req.temperature !== settings.temperature) {
    throw new Error(`${context}: request temperature conflicts with AgentProfile model metadata`)
  }
  if (req.maxTokens !== undefined && req.maxTokens !== settings.maxTokens) {
    throw new Error(`${context}: request maxTokens conflicts with AgentProfile model metadata`)
  }
}
