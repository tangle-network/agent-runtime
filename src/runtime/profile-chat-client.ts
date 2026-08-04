import type {
  ChatClient,
  ChatRequest,
  ChatResponse,
  CostReceiptInput,
  CustomTokenPricing,
} from '@tangle-network/agent-eval'
import { costForTokenPricing } from '@tangle-network/agent-eval'
import type {
  ExternalOptimizerModelCall,
  ExternalOptimizerModelCallRequest,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { type CollectedAgentTurn, collectAgentTurn, streamAgentTurn } from './stream-agent-turn'
import { executableAgentProfileSnapshot } from './supervise/executable-spec'
import {
  concreteModelId,
  type ProfileModelExecutionSettings,
  profileModelExecutionSettings,
} from './supervise/model-policy'
import {
  captureReusableExecutorConfig,
  createExecutor,
  type ExecutorConfig,
} from './supervise/runtime'

/** Profile-exact adapter for packages that consume agent-eval's ChatClient contract.
 * Every call still enters Runtime through createExecutor -> streamAgentTurn, and every
 * behavioral field is checked against the exact AgentProfile before any transport runs. */
export function profileChatClient(args: {
  profile: AgentProfile
  executor: ExecutorConfig
  context: string
}): ChatClient {
  const binding = bindProfileChat(args)

  return {
    transport: 'custom',
    defaultModel: binding.model,
    ...(binding.settings.retry?.maxAttempts !== undefined
      ? { maximumAttempts: binding.settings.retry.maxAttempts }
      : {}),
    async chat(req, callOpts) {
      const run = await runBoundProfileChat(binding, req, callOpts)
      if (!run.succeeded) throw new Error(run.error)
      return run.response
    },
  }
}

/** Profile-exact adapter for agent-eval's external optimizer callback.
 * Eval validates and freezes the provider-neutral request; Runtime owns the exact
 * AgentProfile, execution route, retries, usage, and finite execution evidence. */
export function profileOptimizerModelCall(args: {
  profile: AgentProfile
  executor: ExecutorConfig
  context: string
  pricing?: CustomTokenPricing
}): ExternalOptimizerModelCall {
  const binding = bindProfileChat(args)
  const profileDigest = canonicalAgentProfileDigest(binding.profile)

  return async (request) => {
    const requestDigest = canonicalCandidateDigest({
      callId: request.callId,
      request: request.request,
      endpointFormat: request.endpointFormat ?? null,
    })
    let run: ProfileChatRun
    try {
      run = await runBoundProfileChat(binding, structuredClone(request.request) as ChatRequest, {
        signal: request.signal,
        idempotencyKey: request.callId,
        correlationId: request.callId,
      })
    } catch (error) {
      return {
        succeeded: false,
        error: errorMessage(error),
        receipt: unknownOptimizerReceipt(binding.model),
        execution: {
          kind: 'agent-runtime-profile-model-call',
          profileDigest,
          requestDigest,
          callId: request.callId,
          endpointFormat: request.endpointFormat ?? null,
          executed: false,
          error: errorMessage(error),
        },
      }
    }
    const execution = optimizerExecution(profileDigest, requestDigest, request, run)
    try {
      const receipt = optimizerReceipt(binding.model, run, args.pricing)
      return run.succeeded
        ? {
            succeeded: true,
            response: { ...run.response, costUsd: optimizerResponseCostUsd(receipt) },
            receipt,
            execution,
          }
        : { succeeded: false, error: run.error, receipt, execution }
    } catch (error) {
      const message = `profile optimizer receipt normalization failed after execution: ${errorMessage(error)}`
      return {
        succeeded: false,
        error: message,
        receipt: rawOptimizerReceipt(binding.model, run, args.pricing),
        execution: {
          ...execution,
          succeeded: false,
          postCallError: message,
        },
      }
    }
  }
}

interface BoundProfileChat {
  readonly profile: AgentProfile
  readonly executor: ExecutorConfig
  readonly context: string
  readonly model: string
  readonly settings: ProfileModelExecutionSettings
}

export type ProfileChatRun =
  | { readonly succeeded: true; readonly response: ChatResponse; readonly turn: CollectedAgentTurn }
  | { readonly succeeded: false; readonly error: string; readonly turn: CollectedAgentTurn }

export function bindProfileChat(args: {
  profile: AgentProfile
  executor: ExecutorConfig
  context: string
}): BoundProfileChat {
  const profile = executableAgentProfileSnapshot(args.profile, args.context)
  const model = concreteModelId(profile.model?.default)
  if (!model) throw new Error(`${args.context}: AgentProfile.model.default must be concrete`)
  return {
    profile,
    executor: captureReusableExecutorConfig(args.executor, args.context),
    context: args.context,
    model,
    settings: profileModelExecutionSettings(profile, args.context),
  }
}

export async function runBoundProfileChat(
  binding: BoundProfileChat,
  req: ChatRequest,
  callOpts?: Parameters<ChatClient['chat']>[1],
): Promise<ProfileChatRun> {
  assertProfileChatRequest(
    req,
    binding.model,
    binding.profile.model?.reasoningEffort,
    binding.settings,
    binding.context,
  )
  assertSupportedChatCallOptions(callOpts, binding.context)
  const turnProfile = responseProfile(binding.profile, req, binding.context)
  const startedAt = performance.now()
  const turn = await collectAgentTurn(
    streamAgentTurn(
      {
        kind: 'executor',
        profile: turnProfile,
        factory: createExecutor(binding.executor),
      },
      { messages: req.messages as Array<{ role: string; content: unknown }> },
      {
        ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
        ...(callOpts?.signal ? { signal: callOpts.signal } : {}),
        ...(callOpts?.idempotencyKey ? { callId: callOpts.idempotencyKey } : {}),
        ...(callOpts?.correlationId ? { correlationId: callOpts.correlationId } : {}),
      },
    ),
  )
  if (turn.status !== 'completed') {
    return {
      succeeded: false,
      error: `${binding.context} failed: ${turn.error?.message ?? turn.status}`,
      turn,
    }
  }
  const observedModel = turn.usage.model
  if (observedModel === undefined) {
    return {
      succeeded: false,
      error: `${binding.context}: Runtime turn did not report the model actually used; refusing to label the response with the requested model`,
      turn,
    }
  }
  if (observedModel !== binding.model) {
    return {
      succeeded: false,
      error: `${binding.context}: Runtime reported model ${JSON.stringify(observedModel)} but AgentProfile requires ${JSON.stringify(binding.model)}`,
      turn,
    }
  }
  const resultOut = turn.output as { finishReason?: string } | undefined
  const promptTokens = turn.usage.input
  const completionTokens = turn.usage.output
  return {
    succeeded: true,
    turn,
    response: {
      content: turn.finalText,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        ...(turn.usage.tokensKnown === false ? { captured: false } : {}),
        ...(typeof turn.usage.promptCache?.readTokens === 'number'
          ? { cachedPromptTokens: turn.usage.promptCache.readTokens }
          : {}),
        ...(turn.usage.reasoningTokens !== undefined
          ? { reasoningTokens: turn.usage.reasoningTokens }
          : {}),
      },
      // ChatResponse.costUsd is provider-billed spend only. Runtime keeps catalog estimates in
      // `raw.estimatedCostUsd` and marks the billed channel unknown when no receipt arrived.
      costUsd:
        turn.usage.usdKnown === false || turn.usage.costUsd === undefined
          ? null
          : turn.usage.costUsd,
      model: observedModel,
      durationMs: terminalDurationMs(turn.events, performance.now() - startedAt),
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
    },
  }
}

/** @internal Exported for the adapter's fail-honest duration contract test. */
export function terminalDurationMs(
  events: ReadonlyArray<{ type: string; metadata?: Record<string, unknown> }>,
  measuredWallMs: number,
): number {
  const final = events.at(-1)?.metadata?.timing
  if (final && typeof final === 'object') {
    const duration = (final as Record<string, unknown>).durationMs
    if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) return duration
  }
  if (Number.isFinite(measuredWallMs) && measuredWallMs >= 0) return measuredWallMs
  throw new Error('profileChatClient: measured wall duration must be a finite non-negative number')
}

function assertSupportedChatCallOptions(
  opts: Parameters<ChatClient['chat']>[1],
  context: string,
): void {
  if (opts?.maxCostUsd !== undefined) {
    throw new Error(
      `${context}: maxCostUsd is not enforced by Runtime's exact turn path; refusing to treat it as a limit`,
    )
  }
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
  reasoningEffort: NonNullable<AgentProfile['model']>['reasoningEffort'],
  settings: ProfileModelExecutionSettings,
  context: string,
): void {
  if (req.model !== undefined && req.model !== model) {
    throw new Error(
      `${context}: request model ${JSON.stringify(req.model)} conflicts with AgentProfile model ${JSON.stringify(model)}`,
    )
  }
  if (req.temperature !== undefined && req.temperature !== settings.temperature) {
    throw new Error(`${context}: request temperature conflicts with AgentProfile model metadata`)
  }
  if (req.maxTokens !== undefined && req.maxTokens !== settings.maxTokens) {
    throw new Error(`${context}: request maxTokens conflicts with AgentProfile model metadata`)
  }
  if (req.thinking !== undefined) {
    const expected =
      reasoningEffort === undefined
        ? undefined
        : reasoningEffort === 'none'
          ? 'disabled'
          : 'enabled'
    if (req.thinking !== expected) {
      throw new Error(
        `${context}: request thinking conflicts with AgentProfile.model.reasoningEffort`,
      )
    }
  }
}

function optimizerReceipt(
  model: string,
  run: ProfileChatRun,
  pricing: CustomTokenPricing | undefined,
): CostReceiptInput {
  const usage = run.turn.usage
  const actualCostUsd = usage.usdKnown === false ? undefined : usage.costUsd
  if (usage.tokensKnown === false) {
    return {
      model,
      inputTokens: 0,
      outputTokens: 0,
      usageUnknown: true,
      ...(actualCostUsd !== undefined
        ? { actualCostUsd }
        : usage.estimatedCostUsd !== undefined
          ? { estimatedCostUsd: usage.estimatedCostUsd }
          : { costUnknown: true }),
    }
  }
  const cachedTokens = optimizerTokenCount(usage.promptCache?.readTokens, 'cache read tokens')
  const cacheWriteTokens = optimizerTokenCount(usage.promptCache?.writeTokens, 'cache write tokens')
  const classified = (cachedTokens ?? 0) + (cacheWriteTokens ?? 0)
  if (classified > usage.input) {
    throw new Error('profile optimizer cache classes exceed total input tokens')
  }
  return {
    model,
    inputTokens: usage.input - classified,
    outputTokens: usage.output,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(actualCostUsd !== undefined
      ? { actualCostUsd }
      : usage.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: usage.estimatedCostUsd }
        : pricing
          ? { customTokenPricing: pricing }
          : { costUnknown: true }),
  }
}

/** Preserve the observed call totals when finer receipt classification is inconsistent. */
function rawOptimizerReceipt(
  model: string,
  run: ProfileChatRun,
  pricing: CustomTokenPricing | undefined,
): CostReceiptInput {
  const usage = run.turn.usage
  const tokensKnown = usage.tokensKnown !== false
  const actualCostUsd = usage.usdKnown === false ? undefined : usage.costUsd
  return {
    model,
    inputTokens: tokensKnown ? usage.input : 0,
    outputTokens: tokensKnown ? usage.output : 0,
    ...(tokensKnown ? {} : { usageUnknown: true }),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(actualCostUsd !== undefined
      ? { actualCostUsd }
      : usage.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: usage.estimatedCostUsd }
        : pricing
          ? { customTokenPricing: pricing }
          : { costUnknown: true }),
  }
}

function optimizerExecution(
  profileDigest: string,
  requestDigest: string,
  request: ExternalOptimizerModelCallRequest,
  run: ProfileChatRun,
): Record<string, unknown> {
  return {
    kind: 'agent-runtime-profile-model-call',
    profileDigest,
    requestDigest,
    callId: request.callId,
    endpointFormat: request.endpointFormat ?? null,
    executed: true,
    succeeded: run.succeeded,
    status: run.turn.status,
    model: run.turn.usage.model ?? null,
    transportAttempts: run.turn.transportAttempts ?? null,
    eventTypes: run.turn.events.map((event) => event.type),
  }
}

function unknownOptimizerReceipt(model: string): CostReceiptInput {
  return {
    model,
    inputTokens: 0,
    outputTokens: 0,
    usageUnknown: true,
    costUnknown: true,
  }
}

function optimizerResponseCostUsd(receipt: CostReceiptInput): number | null {
  if (receipt.actualCostUsd !== undefined) return receipt.actualCostUsd
  if (receipt.estimatedCostUsd !== undefined) return receipt.estimatedCostUsd
  if (receipt.customTokenPricing !== undefined && receipt.usageUnknown !== true) {
    return costForTokenPricing(receipt.customTokenPricing, receipt)
  }
  return null
}

function optimizerTokenCount(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`profile optimizer ${label} must be a non-negative integer`)
  }
  return value as number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
