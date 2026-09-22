import {
  AgentEnvironmentCapabilitiesSchema,
  AgentRunControlRefSchema,
  type ContextTransferRequest,
  ContextTransferRequestSchema,
  type ContextTransferResult,
  ContextTransferResultSchema,
  contextTransferReceiptMatches,
  type InputPart,
  type PortableContextPartPlan,
  PortableContextPartPlanSchema,
  type PortableContextPlanRequest,
  PortableContextPlanRequestSchema,
  type PortableContextPlanResult,
  PortableContextPlanResultSchema,
  PortableContextPlanSchema,
  portableContextPlanDigest,
  portableConversationContextDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  AgentSessionRef,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { type RetainedRunHandle, reconnectRetainedRun } from './retained-run'
import { freshTurnInput } from './turn-input'

/** One explicit decision for a source part that is not already portable. @stable */
export interface PortableContextPartDecisionInput {
  readonly messageId: string
  readonly partIndex: number
  readonly part: unknown
}

/** Pure planning policy. No provider or execution object is available here. @stable */
export interface PlanPortableContextOptions {
  readonly decidePart?: (input: PortableContextPartDecisionInput) => PortableContextPartPlan
  readonly estimateTokens?: (context: PortableContextPlanRequest['source']) => number
}

/** Result and retained handle after destination admission. @stable */
export interface PortableContextTransferExecution {
  readonly result: ContextTransferResult
  readonly run?: RetainedRunHandle
}

/** Inputs for one fresh-session context transfer. @stable */
export interface ExecutePortableContextTransferOptions {
  readonly provider: AgentEnvironmentProvider
  readonly environment: Omit<CreateAgentEnvironmentInput, 'idempotencyKey'>
  readonly request: ContextTransferRequest
  readonly turn: Omit<
    AgentTurnInput,
    | 'contextTransfer'
    | 'controlRef'
    | 'detach'
    | 'executionId'
    | 'lastEventId'
    | 'nativeContinuation'
    | 'sessionId'
    | 'turnId'
  >
  readonly now?: () => number
}

/**
 * Build a complete canonical context plan without creating an environment or
 * dispatching a run. Unknown parts require an explicit transform or omission.
 *
 * @stable
 */
export function planPortableContext(
  request: PortableContextPlanRequest,
  options: PlanPortableContextOptions = {},
): PortableContextPlanResult {
  const exactRequest = PortableContextPlanRequestSchema.parse(request)
  const messagePlans = [] as Array<{
    messageId: string
    action: 'include' | 'omit'
    parts: PortableContextPartPlan[]
    reason?: string
  }>
  const outputMessages = [] as PortableContextPlanRequest['source']['messages']

  for (const message of exactRequest.source.messages) {
    const parts = message.parts.map((part, partIndex) => {
      if (isInputPart(part)) return { partIndex, action: 'include' as const }
      return options.decidePart?.({ messageId: message.id, partIndex, part })
    })
    if (parts.some((part) => part === undefined)) {
      return PortableContextPlanResultSchema.parse({
        status: 'unsupported',
        requestId: exactRequest.requestId,
        requestDigest: exactRequest.requestDigest,
        message: `message "${message.id}" contains a part that requires an explicit transform or omission`,
      })
    }
    const exactParts = parts as PortableContextPartPlan[]
    const outputParts = exactParts.flatMap((part) => {
      if (part.action === 'omit') return []
      if (part.action === 'transform') return part.output === undefined ? [] : [part.output]
      return [message.parts[part.partIndex] as InputPart]
    })
    const omitted = outputParts.length === 0
    const reason = omitted
      ? (exactParts.find((part) => part.reason !== undefined)?.reason ??
        'every part was omitted by the context policy')
      : undefined
    messagePlans.push({
      messageId: message.id,
      action: omitted ? 'omit' : 'include',
      parts: omitted
        ? exactParts.map((part) => ({
            partIndex: part.partIndex,
            action: 'omit' as const,
            reason: part.reason ?? reason,
          }))
        : exactParts,
      ...(reason === undefined ? {} : { reason }),
    })
    if (!omitted) outputMessages.push({ ...message, parts: outputParts })
  }

  const changed = messagePlans.some(
    (message) =>
      message.action === 'omit' || message.parts.some((part) => part.action !== 'include'),
  )
  const completeness: 'complete' | 'partial' =
    changed || exactRequest.source.completeness === 'partial' ? 'partial' : 'complete'
  const includedAttachments = exactRequest.source.attachments.filter((attachment) => {
    const message = messagePlans.find((candidate) => candidate.messageId === attachment.messageId)
    const part = message?.parts.find((candidate) => candidate.partIndex === attachment.partIndex)
    return message?.action === 'include' && part?.action === 'include'
  })
  const contextMaterial = {
    source: exactRequest.source.source,
    completeness,
    messages: outputMessages,
    attachments: includedAttachments,
  }
  const context = {
    ...contextMaterial,
    digest: portableConversationContextDigest(contextMaterial),
  }
  let estimatedTokens: number | undefined
  if (options.estimateTokens) {
    estimatedTokens = options.estimateTokens(context)
    if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0) {
      throw new Error('portable context token estimate must be a non-negative safe integer')
    }
  } else if (exactRequest.maxInputTokens !== undefined) {
    return PortableContextPlanResultSchema.parse({
      status: 'unsupported',
      requestId: exactRequest.requestId,
      requestDigest: exactRequest.requestDigest,
      message: 'a token estimator is required when the destination has an input limit',
    })
  }
  if (
    exactRequest.maxInputTokens !== undefined &&
    estimatedTokens !== undefined &&
    estimatedTokens > exactRequest.maxInputTokens
  ) {
    return PortableContextPlanResultSchema.parse({
      status: 'over_limit',
      requestId: exactRequest.requestId,
      requestDigest: exactRequest.requestDigest,
      estimatedTokens,
      maxInputTokens: exactRequest.maxInputTokens,
      message: `planned context uses ${estimatedTokens} tokens, above the ${exactRequest.maxInputTokens} token limit`,
    })
  }

  const planMaterial = {
    planId: exactRequest.requestId,
    source: exactRequest.source,
    destination: exactRequest.destination,
    messages: messagePlans,
    context,
    ...(estimatedTokens === undefined ? {} : { estimatedTokens }),
    requiresAcceptance: changed || exactRequest.source.completeness === 'partial',
  }
  const plan = PortableContextPlanSchema.parse({
    ...planMaterial,
    digest: portableContextPlanDigest(planMaterial),
  })
  return PortableContextPlanResultSchema.parse({
    status: 'ready',
    requestId: exactRequest.requestId,
    requestDigest: exactRequest.requestDigest,
    plan,
  })
}

/**
 * Admit one accepted context into a provider-created fresh session and accept
 * success only when the provider returns the exact shared receipt.
 *
 * @stable
 */
export async function executePortableContextTransfer(
  options: ExecutePortableContextTransferOptions,
): Promise<PortableContextTransferExecution> {
  const request = ContextTransferRequestSchema.parse(options.request)
  if (
    request.plan.destination.provider !== undefined &&
    request.plan.destination.provider !== options.provider.name
  ) {
    throw new Error(
      `context destination provider "${request.plan.destination.provider}" does not match "${options.provider.name}"`,
    )
  }
  const capabilities = AgentEnvironmentCapabilitiesSchema.parse(
    await options.provider.capabilities(),
  )
  const providerMarkers = options.provider as AgentEnvironmentProviderMarkers
  if (providerMarkers.supportsPortableContextTransfer === false) {
    return {
      result: ContextTransferResultSchema.parse({
        status: 'unknown',
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        message: `provider "${options.provider.name}" cannot transfer canonical context with its installed adapter`,
        retryable: false,
      }),
    }
  }
  const missingCapabilities = [
    capabilities.streaming.live ? undefined : 'live streaming',
    capabilities.streaming.replay ? undefined : 'event replay',
    capabilities.streaming.detach ? undefined : 'detached sessions',
    capabilities.streaming.turnIdempotency ? undefined : 'turn idempotency',
    capabilities.retainedControl?.exactRunIdentity === true ? undefined : 'exact run identity',
    capabilities.retainedControl?.resultIdentity === true ? undefined : 'result identity',
    capabilities.retainedControl?.eventIdentity === true ? undefined : 'event identity',
    capabilities.retainedControl?.cancellationIdempotency === true
      ? undefined
      : 'cancellation idempotency',
  ].filter((capability): capability is string => capability !== undefined)
  if (missingCapabilities.length > 0 || !options.provider.get) {
    return {
      result: ContextTransferResultSchema.parse({
        status: 'unknown',
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        message:
          missingCapabilities.length > 0
            ? `provider "${options.provider.name}" does not support portable transfer: ${missingCapabilities.join(', ')}`
            : `provider "${options.provider.name}" cannot reconstruct an environment by id`,
        retryable: false,
      }),
    }
  }
  let environment: AgentEnvironment | undefined
  let dispatchStarted = false
  let retryableTransportFailure = true
  try {
    environment = await options.provider.create({
      ...options.environment,
      idempotencyKey: request.operationId,
    })
    if (!environment.dispatch) {
      const unusedEnvironment = environment
      environment = undefined
      retryableTransportFailure = false
      try {
        await unusedEnvironment.destroy?.()
      } catch (cleanupError) {
        throw new AggregateError(
          [
            new Error(`provider "${options.provider.name}" does not support detached dispatch`),
            cleanupError,
          ],
          'context transfer could not start and its unused environment could not be destroyed',
        )
      }
      throw new Error(`provider "${options.provider.name}" does not support detached dispatch`)
    }
    dispatchStarted = true
    const dispatchInput = freshTurnInput(options.turn, {
      turnId: request.operationId,
      detach: true,
      contextTransfer: request,
    })
    try {
      return await completeTransfer(
        await environment.dispatch(dispatchInput),
        request,
        options.provider,
        environment,
        options.now,
      )
    } catch (firstError) {
      // The turn id is the provider's durable lookup key. Retry one identical
      // admission so a lost or malformed response can return its receipt.
      try {
        return await completeTransfer(
          await environment.dispatch(dispatchInput),
          request,
          options.provider,
          environment,
          options.now,
        )
      } catch (recoveryError) {
        throw new AggregateError(
          [firstError, recoveryError],
          'context transfer admission was not recoverable by its operation id',
        )
      }
    }
  } catch (error) {
    return {
      result: ContextTransferResultSchema.parse({
        status: dispatchStarted ? 'unknown' : 'transport_failure',
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        message: error instanceof Error ? error.message : String(error),
        retryable: dispatchStarted ? true : retryableTransportFailure,
      }),
    }
  }
}

async function completeTransfer(
  reference: AgentSessionRef,
  request: ContextTransferRequest,
  provider: AgentEnvironmentProvider,
  environment: AgentEnvironment,
  now: (() => number) | undefined,
): Promise<PortableContextTransferExecution> {
  const receipt = reference.contextTransferReceipt
  if (
    !receipt ||
    !contextTransferReceiptMatches(request, receipt) ||
    receipt.provider !== provider.name ||
    (reference.provider !== undefined && reference.provider !== provider.name) ||
    receipt.environmentId !== environment.id ||
    receipt.sessionId !== reference.id
  ) {
    throw new Error('provider admitted the destination without an exact context transfer receipt')
  }
  const controlRef = reference.controlRef && AgentRunControlRefSchema.parse(reference.controlRef)
  if (
    !controlRef ||
    controlRef.runId.length === 0 ||
    controlRef.executionId === undefined ||
    controlRef.provider !== receipt.provider ||
    controlRef.environmentId !== receipt.environmentId ||
    controlRef.sessionId !== receipt.sessionId
  ) {
    throw new Error('context was admitted but its run control coordinates identify another session')
  }
  if (
    controlRef.requestDigest !== undefined &&
    controlRef.requestDigest !== request.requestDigest
  ) {
    throw new Error('context was admitted with a run control reference for another request')
  }
  const run = await reconnectRetainedRun({
    provider,
    controlRef,
    ...(now === undefined ? {} : { now }),
  })
  if (!run) {
    throw new Error('context was admitted but durable run control could not be reconstructed')
  }
  return { result: ContextTransferResultSchema.parse(receipt), run }
}

interface AgentEnvironmentProviderMarkers {
  readonly supportsPortableContextTransfer?: boolean
}

function isInputPart(part: unknown): part is InputPart {
  return PortableContextPartPlanSchema.safeParse({
    partIndex: 0,
    action: 'transform',
    output: part,
    reason: 'validate portable input part',
  }).success
}
