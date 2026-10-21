/**
 * The evidence one agentic author shot leaves: its receipt (identity, timing,
 * usage and cost basis), the run-ledger cost receipt, and the callbacks that
 * persist both the receipt and the worktree disposition before the loop moves
 * on. A callback that throws aborts the candidate, so evidence persistence
 * fails closed.
 */
import type { CostReceipt, CostReceiptInput } from '@tangle-network/agent-eval'
import type { AgentProfile, HarnessType } from '@tangle-network/agent-interface'
import { sha256 } from '../content-digest'
import type { AgentTurnUsage, CollectedAgentTurn } from '../runtime/stream-agent-turn'
import type {
  AgenticGeneratorOptions,
  AgenticGeneratorShotDisposition,
  AgenticGeneratorShotExecution,
  AgenticGeneratorShotReceipt,
} from './agentic-generator'

export async function emitShotReceipt(
  callback: AgenticGeneratorOptions['onShotCompleted'],
  receipt: AgenticGeneratorShotReceipt,
  execution: AgenticGeneratorShotExecution | null,
  primaryError: Error | null,
): Promise<void> {
  try {
    await callback?.(receipt, execution)
  } catch (callbackError) {
    if (primaryError !== null) {
      throw new AggregateError(
        [primaryError, callbackError],
        'agenticGenerator: author shot failed and its receipt could not be persisted',
      )
    }
    throw callbackError
  }
  if (primaryError !== null) throw primaryError
}

export async function emitShotDisposition(
  callback: AgenticGeneratorOptions['onShotDisposition'],
  receipt: AgenticGeneratorShotReceipt,
  disposition: AgenticGeneratorShotDisposition,
): Promise<void> {
  await callback?.(receipt, disposition)
}

export async function rethrowShotSetupError(
  callback: AgenticGeneratorOptions['onShotDisposition'],
  receipt: AgenticGeneratorShotReceipt,
  worktreePath: string,
  stage: Extract<AgenticGeneratorShotDisposition, { kind: 'setup-error' }>['stage'],
  cause: unknown,
): Promise<never> {
  const error = cause instanceof Error ? cause : new Error(String(cause))
  try {
    await emitShotDisposition(callback, receipt, {
      kind: 'setup-error',
      worktreePath,
      stage,
      error: { name: error.name, message: error.message },
    })
  } catch (callbackError) {
    throw new AggregateError(
      [cause, callbackError],
      'agenticGenerator: shot processing failed and its worktree disposition could not be persisted',
    )
  }
  throw cause
}

export function shotReceipt(input: {
  readonly generation: number | undefined
  readonly candidateIndex: number | undefined
  readonly shot: number
  readonly maxShots: number
  readonly harness: HarnessType
  readonly provider: string
  readonly model: string
  readonly profile: AgentProfile
  readonly profileDigest: string
  readonly prompt: string
  readonly startedAt: Date
  readonly completedAt: Date
  readonly result: AgenticGeneratorShotExecution | null
  readonly costCallId: string | null
  readonly costReceipt: CostReceipt | null
  readonly error: unknown
}): AgenticGeneratorShotReceipt {
  const error = input.error
    ? {
        name: input.error instanceof Error ? input.error.name : 'Error',
        message: input.error instanceof Error ? input.error.message : String(input.error),
      }
    : null
  const result = input.result
  const costBasis = costBasisFor(input.costReceipt, result)
  const costUsd =
    input.costReceipt?.costUsd ?? result?.usage.costUsd ?? result?.usage.estimatedCostUsd ?? null
  return {
    generation: input.generation ?? null,
    candidateIndex: input.candidateIndex ?? null,
    shot: input.shot + 1,
    maxShots: input.maxShots,
    profileDigest: input.profileDigest,
    harness: input.harness,
    provider: input.provider,
    model: input.model,
    reasoningEffort: input.profile.model?.reasoningEffort ?? null,
    promptSha256: `sha256:${sha256(input.prompt)}`,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    status: result?.status ?? null,
    usage: result ? { ...result.usage } : null,
    transportAttempts: result?.transportAttempts ?? null,
    costCallId: input.costCallId,
    costBasis,
    costUsd: costBasis === 'unknown' ? null : costUsd,
    costUsdKnown: costBasis === 'provider-reported',
    error,
  }
}

function costBasisFor(
  receipt: CostReceipt | null,
  turn: AgenticGeneratorShotExecution | null,
): AgenticGeneratorShotReceipt['costBasis'] {
  if (receipt) {
    if (receipt.costUnknown) return 'unknown'
    return receipt.actualCostUsd === undefined ? 'estimated-pricing' : 'provider-reported'
  }
  if (turn?.usage.usdKnown !== false && turn?.usage.costUsd !== undefined) {
    return 'provider-reported'
  }
  return turn?.usage.estimatedCostUsd !== undefined ? 'estimated-pricing' : 'unknown'
}

export function shotFailure(result: CollectedAgentTurn): Error | null {
  if (result.status === 'completed') return null
  if (result.status === 'aborted') {
    return new Error('agenticGenerator: author shot was cancelled by the caller')
  }
  return new Error(
    `agenticGenerator: author shot failed${result.error?.message ? `: ${result.error.message}` : ''}`,
  )
}

export function costReceiptFromTurn(result: CollectedAgentTurn, model: string): CostReceiptInput {
  const tokensKnown = result.usage.tokensKnown !== false
  const actualCostUsd = result.usage.usdKnown === false ? undefined : result.usage.costUsd
  const cachedTokens = promptCacheReadTokens(result.usage)
  return {
    model,
    inputTokens: tokensKnown ? Math.max(0, result.usage.input - (cachedTokens ?? 0)) : 0,
    outputTokens: tokensKnown ? result.usage.output : 0,
    ...(tokensKnown ? {} : { usageUnknown: true }),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(result.usage.reasoningTokens !== undefined
      ? { reasoningTokens: result.usage.reasoningTokens }
      : {}),
    ...(actualCostUsd !== undefined
      ? { actualCostUsd }
      : result.usage.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: result.usage.estimatedCostUsd }
        : { costUnknown: true }),
  }
}

function promptCacheReadTokens(usage: AgentTurnUsage): number | undefined {
  const cache = usage.promptCache
  if (!cache) return undefined
  for (const field of ['readTokens', 'cachedInputTokens', 'cacheReadInputTokens']) {
    const value = cache[field]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return undefined
}
