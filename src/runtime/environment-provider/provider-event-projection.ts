import type { TokenUsage } from '@tangle-network/agent-interface'
import type { AgentEnvironmentEvent } from '@tangle-network/agent-interface/environment-provider'
import {
  collectAgentFinalMessageText,
  collectAgentResponseText,
  isToolBearingEvent,
  type SandboxEvent,
} from '@tangle-network/sandbox'
import { type AgentRunOutcome, createAgentRunOutcomeTracker } from '@tangle-network/sandbox/runtime'
import { recordValue } from '../../record-value'
import { isSandboxTerminalEvent, sandboxTerminalUsageField } from '../sandbox-events'
import type { ExecutorResult } from '../supervise/types'
import type { ProviderLeafOut } from './provider-executor-admission'
import { ValidationError } from './provider-validation-error'

export function sandboxEventFromEnvironmentEvent(event: AgentEnvironmentEvent): SandboxEvent {
  const normalized = event.normalized
  const type = normalized?.type ?? event.type
  const baseData = normalized ? sandboxDataFromNormalizedEvent(event.data, normalized) : event.data
  const usage = event.usage ? tokenUsageData(event.usage) : undefined
  const data = (() => {
    if (!usage) return baseData
    if (isUsageType(type))
      return {
        ...baseData,
        tokensIn: event.usage?.inputTokens,
        tokensOut: event.usage?.outputTokens,
        ...(event.usage?.cost !== undefined ? { costUsd: event.usage.cost } : {}),
        ...usage,
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
  // A provider adapter's numeric usage cost is not a billing receipt unless the source marked
  // it as one. Preserve explicit Router/provider provenance and mark bare numbers uncaptured.
  const costProvenance = data.costProvenance ?? data.cost_provenance
  const nestedUsage = data.usage ?? data.tokenUsage
  const nestedCost =
    nestedUsage && typeof nestedUsage === 'object'
      ? ((nestedUsage as Record<string, unknown>).cost ??
        (nestedUsage as Record<string, unknown>).costUsd ??
        (nestedUsage as Record<string, unknown>).totalCostUsd)
      : undefined
  const untrustedProviderCost =
    (event.usage?.cost !== undefined ||
      data.costUsd !== undefined ||
      data.totalCostUsd !== undefined ||
      nestedCost !== undefined) &&
    costProvenance === undefined
  const normalizedData = untrustedProviderCost ? { ...data, costProvenance: 'uncaptured' } : data
  return {
    type,
    data: 'usageMode' in event ? { ...normalizedData, usageMode: event.usageMode } : normalizedData,
    ...(event.id ? { id: event.id } : {}),
  }
}

function providerFailureEvent(
  event: AgentEnvironmentEvent,
  sandboxEvent: SandboxEvent,
): SandboxEvent | undefined {
  if (event.type === 'error') {
    const errorCode = failureCode(sandboxEvent.data)
    return {
      type: 'error',
      data: { ...sandboxEvent.data, ...(errorCode ? { code: errorCode } : {}) },
    }
  }

  const normalized = event.normalized
  const failedStatus =
    (event.type === 'status' && event.data.status === 'failed') ||
    (normalized?.type === 'status' && normalized.status === 'failed')
  const terminalFrame = sandboxEvent.type === 'done' || sandboxEvent.type === 'result'
  const outcome = recordValue(sandboxEvent.data.outcome)
  const result = recordValue(sandboxEvent.data.result)
  const failedTerminal =
    terminalFrame &&
    (sandboxEvent.data.success === false ||
      sandboxEvent.data.status === 'failed' ||
      outcome?.type === 'failed' ||
      outcome?.status === 'failed' ||
      result?.status === 'failed')
  if (!failedStatus && !failedTerminal) return undefined

  const detail =
    failureDetail(sandboxEvent.data) ??
    failureDetail(outcome) ??
    failureDetail(result) ??
    (normalized?.type === 'status' ? normalized.detail : undefined)
  const errorCode = failureCode(sandboxEvent.data) ?? failureCode(outcome) ?? failureCode(result)
  const statusCode =
    failureStatusCode(sandboxEvent.data) ?? failureStatusCode(outcome) ?? failureStatusCode(result)
  return {
    type: 'result',
    data: {
      status: 'failed',
      ...(detail ? { error: detail } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(statusCode === undefined ? {} : { statusCode }),
    },
  }
}

/** The statuses the sandbox outcome tracker itself reads as success, so a frame that would settle
 *  `success: true` there is the same frame that supersedes a transient error here. */
const TERMINAL_SUCCESS_STATUSES = new Set(['completed', 'done', 'ok', 'success'])

/**
 * Whether a frame says, explicitly, that the run succeeded: a raw or normalized
 * `status: completed` (the same form `isTerminalEnvironmentEvent` reads as terminal), or a
 * terminal `done`/`result` with `success: true` or a success status on the frame, its outcome,
 * or its nested result. An empty `done` says nothing and supersedes nothing — the stream that
 * ends `status: failed` then `done: {}` stays failed.
 */
function providerTerminalSuccess(
  event: AgentEnvironmentEvent,
  sandboxEvent: SandboxEvent,
): boolean {
  if (event.type === 'status' && event.data.status === 'completed') return true
  if (event.normalized?.type === 'status' && event.normalized.status === 'completed') return true
  if (sandboxEvent.type !== 'done' && sandboxEvent.type !== 'result') return false
  const data = sandboxEvent.data
  if (data.success === true) return true
  if (data.success === false) return false
  const outcome = recordValue(data.outcome)
  const result = recordValue(data.result)
  return [data.status, outcome?.type, outcome?.status, result?.status].some(
    (status) => typeof status === 'string' && TERMINAL_SUCCESS_STATUSES.has(status),
  )
}

/**
 * Holds a stream's failure frames until it ends, so the terminal frame decides the outcome.
 *
 * The sandbox outcome tracker latches the first `error` frame as the run's error and settles
 * `failed` on it whatever the terminal frame says; and until this ledger existed the runtime
 * only ever showed the tracker its failure frames, so a terminal `success: true` was never in
 * evidence at all. A transport error that the harness recovered from — a stream break the
 * sidecar re-attached, a tool backend that failed once — therefore settled the whole child
 * `down` with the transient error as its reason, and the artifact the child had banked was
 * discarded. On the 2026-09-20 fleet corpus, 25 children that finished their work settled that
 * way.
 *
 * The rule: `error` frames are forgiven when the stream reports success and carries no verdict;
 * a failed status or a failed terminal frame is the provider's own verdict on the run, and once
 * one exists every failure frame is evidence again, in order, so the tracker names the first
 * `error` as it always did. The existing contracts hold unchanged: `status: failed` then
 * `done: {}` is failed, and the retained Claude tail `completed → failed → error → done` is
 * failed with the error frame's message. The forgiven frames stay in the event archive the trace
 * reads; only the outcome stops claiming them.
 */
export function createProviderFailureLedger(): {
  observe(event: AgentEnvironmentEvent, sandboxEvent: SandboxEvent): void
  finish(): AgentRunOutcome | undefined
} {
  const failures: SandboxEvent[] = []
  let verdicts = 0
  let succeeded = false
  return {
    observe(event, sandboxEvent) {
      const failureEvent = providerFailureEvent(event, sandboxEvent)
      if (failureEvent) {
        failures.push(failureEvent)
        if (failureEvent.type !== 'error') verdicts += 1
        return
      }
      if (providerTerminalSuccess(event, sandboxEvent)) succeeded = true
    },
    finish() {
      if (failures.length === 0 || (verdicts === 0 && succeeded)) return undefined
      const tracker = createAgentRunOutcomeTracker()
      for (const frame of failures) tracker.observe(frame)
      return tracker.finish()
    },
  }
}

function failureDetail(value: Record<string, unknown> | undefined): string | undefined {
  const error = value?.error
  if (typeof error === 'string') return error
  const nestedError = recordValue(error)
  if (typeof nestedError?.message === 'string') return nestedError.message
  if (typeof value?.message === 'string') return value.message
  return typeof value?.detail === 'string' ? value.detail : undefined
}

/** Preserve the Sandbox outcome's numeric HTTP metadata across the provider adapter. */
export function failureStatusCode(value: unknown): number | undefined {
  const statusCode = recordValue(value)?.statusCode
  return typeof statusCode === 'number' &&
    Number.isInteger(statusCode) &&
    statusCode >= 400 &&
    statusCode <= 599
    ? statusCode
    : undefined
}

function failureCode(value: Record<string, unknown> | undefined): string | undefined {
  const error = recordValue(value?.error)
  return (
    stringValue(value?.errorCode) ??
    stringValue(value?.code) ??
    stringValue(error?.errorCode) ??
    stringValue(error?.code)
  )
}

export function usageSandboxEvent(event: AgentEnvironmentEvent): SandboxEvent | undefined {
  const type = event.normalized?.type ?? event.type
  if (!event.usage || isUsageType(type) || isNestedUsageType(type) || type === 'done') {
    return undefined
  }
  const usage = tokenUsageData(event.usage)
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.totalCostUsd === undefined
  ) {
    return undefined
  }
  return {
    type: 'usage',
    data: {
      ...event.data,
      ...usage,
      ...('usageMode' in event ? { usageMode: event.usageMode } : {}),
    },
    ...(event.id ? { id: event.id } : {}),
  }
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

function tokenUsageData(usage: TokenUsage): Record<string, number> {
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

/**
 * The archive one provider turn settles on, as `ProviderLeafOut` documents it. A superseded slot is
 * cleared when the superseding frame arrives, so a cumulative part holds one copy of its text no
 * matter how many frames restate it, and the kept events stay in streamed order.
 */
export function createTurnEventArchive(): {
  append(event: AgentEnvironmentEvent): void
  events(): AgentEnvironmentEvent[]
  readonly superseded: number
} {
  const slots: Array<AgentEnvironmentEvent | undefined> = []
  const latestByPart = new Map<string, { index: number; text: string }>()
  let superseded = 0
  return {
    append(event) {
      const update = cumulativePartUpdate(event)
      if (update !== undefined) {
        const latest = latestByPart.get(update.key)
        if (latest !== undefined && update.text.startsWith(latest.text)) {
          slots[latest.index] = undefined
          superseded += 1
        }
        latestByPart.set(update.key, { index: slots.length, text: update.text })
      }
      slots.push(event)
    },
    events: () => slots.filter((event): event is AgentEnvironmentEvent => event !== undefined),
    get superseded() {
      return superseded
    },
  }
}

/** A text or reasoning part update's identity and whole text, read from the canonical event. */
function cumulativePartUpdate(
  event: AgentEnvironmentEvent,
): { key: string; text: string } | undefined {
  const normalized = event.normalized
  if (normalized?.type !== 'message.part.updated') return undefined
  const part = normalized.part
  if (part.type !== 'text' && part.type !== 'reasoning') return undefined
  if (typeof part.id !== 'string' || part.id.length === 0 || typeof part.text !== 'string') {
    return undefined
  }
  return { key: JSON.stringify([part.type, part.messageID, part.id]), text: part.text }
}

export function resultFromEvents(
  events: AgentEnvironmentEvent[],
  fallbackText: string,
): ProviderLeafOut {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    const text = event ? resultTextFromData(event.data) : undefined
    if (text !== undefined) return { content: text, events }
  }
  return { content: fallbackText, events }
}

/** Decode only the final assistant message, keeping the unmodified stream as evidence. */
export function jsonResultFromEvents(
  events: AgentEnvironmentEvent[],
): Pick<ExecutorResult<unknown>, 'out' | 'outcome'> {
  if (events.some((event) => event.type === 'result' && event.data.eventStreamComplete === false))
    throw new ValidationError('provider JSON output: complete native event observation is required')
  const projected = events.map(sandboxEventFromEnvironmentEvent)
  const text =
    collectAgentFinalMessageText(projected) ??
    (projected.some(isToolBearingEvent) ? undefined : collectAgentResponseText(projected))
  try {
    return {
      out: JSON.parse(text ?? '', (_key, value) => {
        if (typeof value === 'number' && !Number.isFinite(value))
          throw new SyntaxError('JSON number is not finite')
        return value
      }),
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return {
      out: null,
      outcome: {
        success: false,
        error: `provider JSON output: ${text === undefined ? 'missing final assistant message' : 'invalid final assistant JSON'}; return only a JSON value after tool use`,
        errorCode: 'RUNTIME_OUTPUT_FORMAT_INVALID',
      },
    }
  }
}

export function textFromEnvironmentEvent(event: AgentEnvironmentEvent): string {
  if (event.normalized?.type === 'message.part.updated') {
    return typeof event.normalized.delta === 'string' ? event.normalized.delta : ''
  }
  const data = event.data
  for (const key of ['delta', 'chunk', 'content', 'text']) {
    if (typeof data[key] === 'string' && !isTerminalEnvironmentEvent(event)) return data[key]
  }
  return ''
}

export function resultTextFromData(data: Record<string, unknown>): string | undefined {
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
  if (type === 'error' || isSandboxTerminalEvent(type)) return true
  // A namespaced completion this provider transport may emit under any prefix. Broader than the
  // named sandbox list on purpose: an unknown `<x>.completed` still ends the stream.
  if (type.endsWith('.completed') || type.endsWith('.failed')) return true
  if (type !== 'status') return false
  return data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled'
}

function isUsageType(type: string): boolean {
  return type === 'llm_call' || type === 'usage' || type === 'cost.usage'
}

/** A terminal event whose usage rides `data.usage` — the nested shape this transport unwraps. */
function isNestedUsageType(type: string): boolean {
  return isSandboxTerminalEvent(type) && sandboxTerminalUsageField(type) === 'usage'
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
