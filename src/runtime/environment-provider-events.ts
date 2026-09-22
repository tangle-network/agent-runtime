import type { TokenUsage } from '@tangle-network/agent-interface'
import {
  AgentRunControlRefSchema,
  ContextTransferReceiptSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentEvent,
  AgentSessionRef,
  AgentTurnInput,
  AgentTurnResult,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  PromptInputPart,
  PromptResult,
  SandboxEvent,
  ExecResult as SandboxExecResult,
} from '@tangle-network/sandbox'
import { ValidationError } from './environment-provider-adapters'
import { promptFromTurnInput } from './environment-provider-input'
import { sessionStatusFromUnknown } from './environment-provider-support'

export function environmentEventFromSandboxEvent(event: SandboxEvent): AgentEnvironmentEvent {
  const record = event as unknown as Record<string, unknown>
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  return {
    type: String(event.type),
    data,
    ...(event.id ? { id: event.id } : {}),
    ...(record.normalized === undefined ? {} : { normalized: record.normalized as never }),
    usage: tokenUsageFromData(data),
    providerEvent: event,
  }
}

export function sandboxEventFromEnvironmentEvent(event: AgentEnvironmentEvent): SandboxEvent {
  const normalized = event.normalized
  const type = normalized?.type ?? event.type
  const baseData = normalized ? sandboxDataFromNormalizedEvent(event.data, normalized) : event.data
  const usage = event.usage ? tokenUsageData(event.usage) : undefined
  const data = (() => {
    if (!usage) return baseData
    if (isUsageType(type)) {
      return {
        ...baseData,
        tokensIn: event.usage?.inputTokens,
        tokensOut: event.usage?.outputTokens,
        ...(event.usage?.cost !== undefined ? { costUsd: event.usage.cost } : {}),
        ...usage,
      }
    }
    if (isNestedUsageType(type)) return { ...baseData, usage }
    if (type === 'done') {
      return {
        ...baseData,
        tokenUsage: usage,
        ...(usage.totalCostUsd !== undefined ? { totalCostUsd: usage.totalCostUsd } : {}),
      }
    }
    return baseData
  })()
  return {
    type,
    data,
    ...(event.id ? { id: event.id } : {}),
    ...(event.providerEvent ? { providerEvent: event.providerEvent } : {}),
  }
}

export function usageSandboxEvent(event: AgentEnvironmentEvent): SandboxEvent | undefined {
  const type = event.normalized?.type ?? event.type
  if (!event.usage || isUsageType(type) || isNestedUsageType(type) || type === 'done')
    return undefined
  const usage = tokenUsageData(event.usage)
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.totalCostUsd === undefined
  ) {
    return undefined
  }
  return { type: 'llm_call', data: usage }
}

function sandboxDataFromNormalizedEvent(
  rawData: Record<string, unknown>,
  normalized: NonNullable<AgentEnvironmentEvent['normalized']>,
): Record<string, unknown> {
  const { type: _type, ...normalizedData } = normalized
  return {
    ...rawData,
    ...normalizedData,
    ...(normalized.type === 'message.part.updated' && normalized.part.type === 'text'
      ? { text: normalized.part.text }
      : {}),
  }
}

export function tokenUsageData(usage: TokenUsage): Record<string, number> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage.cacheReadInputTokens !== undefined
      ? { cacheReadInputTokens: usage.cacheReadInputTokens }
      : {}),
    ...(usage.cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
      : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(usage.cost !== undefined ? { totalCostUsd: usage.cost } : {}),
  }
}

export function promptFromTurnInputForSandbox(input: AgentTurnInput): string | PromptInputPart[] {
  return promptFromTurnInput(input)
}

export function resultFromEvents(
  events: AgentEnvironmentEvent[],
  fallbackText: string,
): { content: string; events: AgentEnvironmentEvent[] } {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    const text = event ? resultTextFromData(event.data) : undefined
    if (text !== undefined) return { content: text, events }
  }
  return { content: fallbackText, events }
}

export function textFromEnvironmentEvent(event: AgentEnvironmentEvent): string {
  if (
    typeof event.normalized === 'object' &&
    event.normalized &&
    event.normalized.type === 'message.part.updated'
  ) {
    return typeof event.normalized.delta === 'string' ? event.normalized.delta : ''
  }
  for (const key of ['delta', 'chunk', 'content', 'text']) {
    if (typeof event.data[key] === 'string' && !isTerminalEnvironmentEvent(event)) {
      return event.data[key]
    }
  }
  return ''
}

function resultTextFromData(data: Record<string, unknown>): string | undefined {
  for (const key of ['finalText', 'text', 'response', 'resultSummary', 'content']) {
    if (typeof data[key] === 'string') return data[key]
  }
  return undefined
}

export function isTerminalEnvironmentEvent(event: AgentEnvironmentEvent): boolean {
  if (isTerminalEventShape(event.type, event.data)) return true
  const normalized = event.normalized
  return (
    normalized?.type === 'status' &&
    (normalized.status === 'completed' || normalized.status === 'failed')
  )
}

function isTerminalEventShape(type: string, data: Record<string, unknown>): boolean {
  if (type === 'result' || type === 'done' || type === 'final') return true
  if (type.endsWith('.completed') || type.endsWith('.failed') || type === 'error') return true
  return (
    type === 'status' &&
    (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled')
  )
}

function isUsageType(type: string): boolean {
  return type === 'llm_call' || type === 'usage' || type === 'cost.usage'
}

function isNestedUsageType(type: string): boolean {
  return type === 'message.completed' || type === 'result' || type === 'final'
}

export function usageFromEnvironmentEvent(event: AgentEnvironmentEvent): {
  input: number
  output: number
  usd: number
} {
  const usage = event.usage ?? tokenUsageFromData(event.data)
  return {
    input: finiteNumber(usage?.inputTokens) ?? 0,
    output: (finiteNumber(usage?.outputTokens) ?? 0) + (finiteNumber(usage?.reasoningTokens) ?? 0),
    usd:
      finiteNumber(usage?.cost) ??
      finiteNumber(event.data.costUsd) ??
      finiteNumber(event.data.totalCostUsd) ??
      0,
  }
}

export function tokenUsageFromData(data: Record<string, unknown>): TokenUsage | undefined {
  const usageRecord =
    data.usage && typeof data.usage === 'object'
      ? (data.usage as Record<string, unknown>)
      : data.tokenUsage && typeof data.tokenUsage === 'object'
        ? (data.tokenUsage as Record<string, unknown>)
        : data
  const inputTokens =
    finiteNumber(usageRecord.inputTokens) ??
    finiteNumber(usageRecord.tokensIn) ??
    finiteNumber(usageRecord.prompt_tokens)
  const outputTokens =
    finiteNumber(usageRecord.outputTokens) ??
    finiteNumber(usageRecord.tokensOut) ??
    finiteNumber(usageRecord.completion_tokens)
  const totalTokens = finiteNumber(usageRecord.totalTokens)
  const cacheReadInputTokens = finiteNumber(usageRecord.cacheReadInputTokens)
  const cacheCreationInputTokens = finiteNumber(usageRecord.cacheCreationInputTokens)
  const reasoningTokens = finiteNumber(usageRecord.reasoningTokens)
  const cost =
    finiteNumber(usageRecord.cost) ??
    finiteNumber(usageRecord.costUsd) ??
    finiteNumber(usageRecord.totalCostUsd) ??
    finiteNumber(data.costUsd) ??
    finiteNumber(data.totalCostUsd)
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cacheReadInputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    reasoningTokens === undefined &&
    cost === undefined
  ) {
    return undefined
  }
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cost !== undefined ? { cost } : {}),
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function mergeTokenUsage(
  left: TokenUsage | undefined,
  right: TokenUsage | undefined,
): TokenUsage | undefined {
  if (!left) return right
  if (!right) return left
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    ...(left.totalTokens !== undefined || right.totalTokens !== undefined
      ? { totalTokens: (left.totalTokens ?? 0) + (right.totalTokens ?? 0) }
      : {}),
    ...(left.cacheReadInputTokens !== undefined || right.cacheReadInputTokens !== undefined
      ? {
          cacheReadInputTokens:
            (left.cacheReadInputTokens ?? 0) + (right.cacheReadInputTokens ?? 0),
        }
      : {}),
    ...(left.cacheCreationInputTokens !== undefined || right.cacheCreationInputTokens !== undefined
      ? {
          cacheCreationInputTokens:
            (left.cacheCreationInputTokens ?? 0) + (right.cacheCreationInputTokens ?? 0),
        }
      : {}),
    ...(left.reasoningTokens !== undefined || right.reasoningTokens !== undefined
      ? { reasoningTokens: (left.reasoningTokens ?? 0) + (right.reasoningTokens ?? 0) }
      : {}),
    ...(left.cost !== undefined || right.cost !== undefined
      ? { cost: (left.cost ?? 0) + (right.cost ?? 0) }
      : {}),
  }
}

export function agentTurnResultFromPromptResult(result: PromptResult): AgentTurnResult {
  const record = result as unknown as Record<string, unknown>
  const contextTransferReceipt =
    record.contextTransferReceipt === undefined
      ? undefined
      : ContextTransferReceiptSchema.parse(record.contextTransferReceipt)
  const text =
    typeof record.response === 'string'
      ? record.response
      : typeof record.text === 'string'
        ? record.text
        : typeof record.finalText === 'string'
          ? record.finalText
          : ''
  const success = typeof record.success === 'boolean' ? record.success : true
  return {
    text,
    success,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    usage: tokenUsageFromData(record),
    ...(typeof record.executionId === 'string'
      ? { metadata: { executionId: record.executionId } }
      : {}),
    ...(contextTransferReceipt === undefined ? {} : { contextTransferReceipt }),
  }
}

export function sandboxDispatchResultFromSessionRef(
  session: AgentSessionRef,
): Record<string, unknown> {
  const hasStatus = session.metadata && Object.hasOwn(session.metadata, 'status')
  const status = hasStatus ? sessionStatusFromUnknown(session.metadata?.status) : 'running'
  return {
    sessionId: session.id,
    status,
    alreadyExisted: session.metadata?.alreadyExisted === true,
    ...(session.controlRef?.executionId === undefined
      ? {}
      : { executionId: session.controlRef.executionId }),
    ...(session.controlRef ? { controlRef: session.controlRef } : {}),
    ...(session.contextTransferReceipt
      ? { contextTransferReceipt: session.contextTransferReceipt }
      : {}),
  }
}

export function sessionRefFromSandboxDispatch(
  dispatched: unknown,
  providerName: string,
  environmentId: string,
  input: AgentTurnInput,
  requireExactControlRef: boolean,
): AgentSessionRef {
  const record =
    dispatched && typeof dispatched === 'object'
      ? (dispatched as Record<string, unknown>)
      : undefined
  const id = record?.sessionId ?? record?.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new ValidationError('sandboxClientAsProvider: dispatch returned no session id')
  }
  if (!record)
    throw new ValidationError('sandboxClientAsProvider: dispatch returned no session record')
  const reportedExecutionId =
    typeof record.executionId === 'string' ? record.executionId : undefined
  const returnedControlRef =
    record.controlRef && typeof record.controlRef === 'object'
      ? AgentRunControlRefSchema.parse(record.controlRef)
      : undefined
  if (returnedControlRef) {
    if (
      returnedControlRef.provider !== providerName ||
      returnedControlRef.environmentId !== environmentId ||
      returnedControlRef.sessionId !== id ||
      (reportedExecutionId !== undefined &&
        returnedControlRef.executionId !== reportedExecutionId) ||
      (input.controlRef &&
        canonicalCandidateDigest(returnedControlRef) !== canonicalCandidateDigest(input.controlRef))
    ) {
      throw new ValidationError(
        'sandbox dispatch returned a control reference for another execution',
      )
    }
  }
  if (requireExactControlRef && !returnedControlRef) {
    throw new ValidationError(
      'sandbox dispatch did not return the exact control reference required by this provider',
    )
  }
  const contextTransferReceipt =
    record.contextTransferReceipt === undefined
      ? undefined
      : ContextTransferReceiptSchema.parse(record.contextTransferReceipt)
  return {
    id,
    provider: providerName,
    ...(requireExactControlRef && returnedControlRef ? { controlRef: returnedControlRef } : {}),
    ...(contextTransferReceipt ? { contextTransferReceipt } : {}),
    metadata: {
      ...(record.status ? { status: record.status } : {}),
      ...(record.alreadyExisted !== undefined ? { alreadyExisted: record.alreadyExisted } : {}),
    },
  }
}

export function sandboxControlRefKey(environmentId: string, sessionId: string): string {
  return `${environmentId}\u0000${sessionId}`
}

export function execResultFromSandboxExecResult(result: SandboxExecResult) {
  const record = result as unknown as Record<string, unknown>
  const exitCode = finiteNumber(record.exitCode) ?? finiteNumber(record.code)
  if (exitCode === undefined)
    throw new ValidationError('sandboxClientAsProvider: exec returned no exit code')
  return {
    exitCode,
    stdout: typeof record.stdout === 'string' ? record.stdout : '',
    stderr: typeof record.stderr === 'string' ? record.stderr : '',
  }
}
