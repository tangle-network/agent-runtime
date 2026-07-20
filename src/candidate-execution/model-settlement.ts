import { isLlmSpan, type LlmSpan, type TraceStore } from '@tangle-network/agent-eval'
import type {
  AgentCandidateFixedSpend,
  AgentCandidateModelSettlementCall,
} from '@tangle-network/agent-interface'
import { assertExactObjectKeys } from './exact-object'
import type { AgentCandidateProtectedModelSettlement } from './types'

const USD_NANOS = 1_000_000_000

export interface SealedAgentCandidateModelSettlement {
  readonly value: AgentCandidateProtectedModelSettlement
  readonly usage: AgentCandidateFixedSpend
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
  let costUsdNanos = 0
  const calls = settlement.calls.map((source, index) => {
    assertExactObjectKeys(
      source,
      [
        'callId',
        'generationId',
        'traceSpanId',
        'status',
        'model',
        'startedAtMs',
        'endedAtMs',
        'inputTokens',
        'outputTokens',
        'cachedInputTokens',
        'reasoningTokens',
        'costUsdNanos',
      ],
      `model settlement call ${index}`,
    )
    assertIdentifier(source.callId, `model settlement call ${index} callId`)
    assertIdentifier(source.generationId, `model settlement call ${index} generationId`)
    assertIdentifier(source.traceSpanId, `model settlement call ${index} traceSpanId`)
    if (source.traceSpanId !== source.generationId) {
      throw new Error(`model settlement call ${index} traceSpanId is not its router generationId`)
    }
    if (source.status !== 'succeeded' && source.status !== 'failed') {
      throw new Error(`model settlement call ${index} has an invalid status`)
    }
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
    assertTimestamp(source.startedAtMs, `model settlement call ${index} startedAtMs`)
    assertTimestamp(source.endedAtMs, `model settlement call ${index} endedAtMs`)
    if (source.endedAtMs < source.startedAtMs) {
      throw new Error(`model settlement call ${index} ended before it started`)
    }
    assertCount(source.inputTokens, `model settlement call ${index} inputTokens`)
    assertCount(source.outputTokens, `model settlement call ${index} outputTokens`)
    assertCount(source.cachedInputTokens, `model settlement call ${index} cachedInputTokens`)
    cachedInputTokens = safeAdd(
      cachedInputTokens,
      source.cachedInputTokens,
      'cached input token total',
    )
    assertCount(source.reasoningTokens, `model settlement call ${index} reasoningTokens`)
    reasoningTokens = safeAdd(reasoningTokens, source.reasoningTokens, 'reasoning token total')
    assertCount(source.costUsdNanos, `model settlement call ${index} costUsdNanos`)
    inputTokens = safeAdd(inputTokens, source.inputTokens, 'input token total')
    outputTokens = safeAdd(outputTokens, source.outputTokens, 'output token total')
    costUsdNanos = safeAdd(costUsdNanos, source.costUsdNanos, 'cost total')
    return Object.freeze({ ...source })
  })

  const usage = Object.freeze({
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
  })
}

/**
 * Append the only accepted LLM spans from the router's closed ledger.
 * Candidate and executor code may write tool/process spans, but never model usage.
 */
export async function appendAuthoritativeModelSettlementSpans(
  traceStore: TraceStore,
  runId: string,
  settlement: SealedAgentCandidateModelSettlement,
): Promise<void> {
  const run = await traceStore.getRun(runId)
  if (!run) throw new Error(`protected trace run is missing before model settlement: ${runId}`)
  if (run.status === 'running' || run.endedAt === undefined) {
    throw new Error('protected trace run must be terminal before model spans are appended')
  }
  const existing = await traceStore.spans({ runId })
  if (existing.some(isLlmSpan)) {
    throw new Error(
      'protected trace contains a model span not authored from the closed router ledger',
    )
  }
  const occupiedIds = new Set(existing.map((span) => span.spanId))
  for (const call of settlement.value.calls) {
    if (occupiedIds.has(call.traceSpanId)) {
      throw new Error(
        `protected trace span identity collides with router generation ${call.generationId}`,
      )
    }
    await traceStore.appendSpan({
      runId,
      spanId: call.traceSpanId,
      kind: 'llm',
      name: 'protected model call',
      model: call.model,
      messages: [],
      startedAt: call.startedAtMs,
      endedAt: call.endedAtMs,
      status: call.status === 'succeeded' ? 'ok' : 'error',
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cachedTokens: call.cachedInputTokens,
      reasoningTokens: call.reasoningTokens,
      costUsd: call.costUsdNanos / USD_NANOS,
      attributes: {
        'tangle.protected_model.source': 'router-settlement',
        'tangle.router.call_id': call.callId,
        'tangle.router.generation_id': call.generationId,
      },
    })
  }
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

function assertTraceCall(span: LlmSpan, call: AgentCandidateModelSettlementCall): void {
  if (span.model !== call.model) {
    throw new Error(`protected trace span ${span.spanId} model does not match model ledger`)
  }
  if (
    span.startedAt !== call.startedAtMs ||
    span.endedAt !== call.endedAtMs ||
    span.status !== (call.status === 'succeeded' ? 'ok' : 'error')
  ) {
    throw new Error(
      `protected trace span ${span.spanId} timing or status does not match model ledger`,
    )
  }
  if (
    span.attributes?.['tangle.protected_model.source'] !== 'router-settlement' ||
    span.attributes?.['tangle.router.call_id'] !== call.callId ||
    span.attributes?.['tangle.router.generation_id'] !== call.generationId
  ) {
    throw new Error(`protected trace span ${span.spanId} lacks router settlement provenance`)
  }
  for (const [name, traced, settled] of [
    ['inputTokens', span.inputTokens, call.inputTokens],
    ['outputTokens', span.outputTokens, call.outputTokens],
    ['cachedInputTokens', span.cachedTokens ?? 0, call.cachedInputTokens],
    ['reasoningTokens', span.reasoningTokens ?? 0, call.reasoningTokens],
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

function assertTimestamp(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }
}

function safeAdd(left: number, right: number, label: string): number {
  const total = left + right
  if (!Number.isSafeInteger(total)) throw new Error(`${label} exceeds safe integer range`)
  return total
}
