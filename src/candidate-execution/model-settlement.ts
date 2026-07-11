import type { LlmSpan } from '@tangle-network/agent-eval'
import type { AgentCandidateSpend } from '@tangle-network/agent-interface'
import type { AgentCandidateExecutionUsage } from './claim'
import { assertExactObjectKeys } from './exact-object'
import type {
  AgentCandidateProtectedModelCall,
  AgentCandidateProtectedModelSettlement,
} from './types'

const USD_NANOS = 1_000_000_000

export interface SealedAgentCandidateModelSettlement {
  readonly value: AgentCandidateProtectedModelSettlement
  readonly usage: AgentCandidateSpend
  readonly fixedUsage: AgentCandidateExecutionUsage
  readonly costUsdNanos: number
}

/** Validate and detach the evaluator gateway's terminal, revoked call ledger. */
export function sealAgentCandidateModelSettlement(
  settlement: AgentCandidateProtectedModelSettlement,
  expected: { preparationId: string; grantDigest: string; model: string },
): SealedAgentCandidateModelSettlement {
  assertExactObjectKeys(
    settlement,
    ['preparationId', 'grantDigest', 'closed', 'calls'],
    'model settlement',
  )
  if (settlement.closed !== true) throw new Error('protected model grant is not closed')
  if (settlement.grantDigest !== expected.grantDigest) {
    throw new Error('protected model settlement grant digest does not match the reservation')
  }
  if (settlement.preparationId !== expected.preparationId) {
    throw new Error('protected model settlement preparation does not match the reservation')
  }
  if (!Array.isArray(settlement.calls)) {
    throw new Error('protected model settlement calls must be an array')
  }

  const callIds = new Set<string>()
  const spanIds = new Set<string>()
  let inputTokens = 0
  let outputTokens = 0
  let cachedInputTokens = 0
  let reasoningTokens = 0
  let hasCachedInput = false
  let costUsdNanos = 0
  const calls = settlement.calls.map((source, index) => {
    assertExactObjectKeys(
      source,
      ['callId', 'traceSpanId', 'model', 'inputTokens', 'outputTokens', 'costUsdNanos'],
      `model settlement call ${index}`,
      ['cachedInputTokens', 'reasoningTokens'],
    )
    assertIdentifier(source.callId, `model settlement call ${index} callId`)
    assertIdentifier(source.traceSpanId, `model settlement call ${index} traceSpanId`)
    if (callIds.has(source.callId))
      throw new Error('protected model settlement has duplicate call ids')
    if (spanIds.has(source.traceSpanId)) {
      throw new Error('protected model settlement has duplicate trace span ids')
    }
    callIds.add(source.callId)
    spanIds.add(source.traceSpanId)
    if (source.model !== expected.model) {
      throw new Error(`protected model settlement call ${index} has an unexpected model`)
    }
    assertCount(source.inputTokens, `model settlement call ${index} inputTokens`)
    assertCount(source.outputTokens, `model settlement call ${index} outputTokens`)
    if (source.cachedInputTokens !== undefined) {
      assertCount(source.cachedInputTokens, `model settlement call ${index} cachedInputTokens`)
      cachedInputTokens = safeAdd(
        cachedInputTokens,
        source.cachedInputTokens,
        'cached input token total',
      )
      hasCachedInput = true
    }
    if (source.reasoningTokens !== undefined) {
      assertCount(source.reasoningTokens, `model settlement call ${index} reasoningTokens`)
      reasoningTokens = safeAdd(reasoningTokens, source.reasoningTokens, 'reasoning token total')
    }
    assertCount(source.costUsdNanos, `model settlement call ${index} costUsdNanos`)
    inputTokens = safeAdd(inputTokens, source.inputTokens, 'input token total')
    outputTokens = safeAdd(outputTokens, source.outputTokens, 'output token total')
    costUsdNanos = safeAdd(costUsdNanos, source.costUsdNanos, 'cost total')
    return Object.freeze({ ...source })
  })

  const usage = Object.freeze({
    costUsd: costUsdNanos / USD_NANOS,
    inputTokens,
    outputTokens,
    ...(hasCachedInput ? { cachedInputTokens } : {}),
    modelCalls: calls.length,
  })
  const fixedUsage = Object.freeze({
    costUsdNanos,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    modelCalls: calls.length,
  })
  return Object.freeze({
    value: Object.freeze({
      preparationId: settlement.preparationId,
      grantDigest: settlement.grantDigest,
      closed: true as const,
      calls: Object.freeze(calls),
    }),
    usage,
    fixedUsage,
    costUsdNanos,
  })
}

/** Match every protected trace span one-for-one against gateway call evidence. */
export function assertTraceMatchesModelSettlement(
  spans: readonly LlmSpan[],
  settlement: SealedAgentCandidateModelSettlement,
): void {
  if (spans.length !== settlement.value.calls.length) {
    throw new Error(
      `protected trace model calls ${spans.length} do not match model ledger ${settlement.value.calls.length}`,
    )
  }
  const byId = new Map(spans.map((span) => [span.spanId, span]))
  if (byId.size !== spans.length) throw new Error('protected trace has duplicate model span ids')
  for (const call of settlement.value.calls) {
    const span = byId.get(call.traceSpanId)
    if (!span) {
      throw new Error(`protected trace is missing model ledger span ${call.traceSpanId}`)
    }
    assertTraceCall(span, call)
  }
}

export function usdToNanos(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be nonnegative`)
  const nanos = Math.round(value * USD_NANOS)
  if (!Number.isSafeInteger(nanos)) throw new Error(`${label} exceeds fixed-point range`)
  return nanos
}

function assertTraceCall(span: LlmSpan, call: AgentCandidateProtectedModelCall): void {
  if (span.model !== call.model) {
    throw new Error(`protected trace span ${span.spanId} model does not match model ledger`)
  }
  for (const [name, traced, settled] of [
    ['inputTokens', span.inputTokens, call.inputTokens],
    ['outputTokens', span.outputTokens, call.outputTokens],
    ['cachedInputTokens', span.cachedTokens ?? 0, call.cachedInputTokens ?? 0],
    ['reasoningTokens', span.reasoningTokens ?? 0, call.reasoningTokens ?? 0],
  ] as const) {
    if (traced === undefined || traced !== settled) {
      throw new Error(
        `protected trace span ${span.spanId} ${name} ${traced} does not match model ledger ${settled}`,
      )
    }
  }
  if (span.costUsd === undefined) {
    throw new Error(`protected trace span ${span.spanId} is missing costUsd`)
  }
  const tracedCost = usdToNanos(span.costUsd, `protected trace span ${span.spanId} costUsd`)
  if (tracedCost !== call.costUsdNanos) {
    throw new Error(
      `protected trace span ${span.spanId} costUsdNanos ${tracedCost} does not match model ledger ${call.costUsdNanos}`,
    )
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error(`${label} must be a non-empty bounded string`)
  }
}

function assertCount(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`)
  }
}

function safeAdd(left: number, right: number, label: string): number {
  const total = left + right
  if (!Number.isSafeInteger(total)) throw new Error(`${label} exceeds safe integer range`)
  return total
}
