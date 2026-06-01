import { ValidationError } from '../errors'
import type {
  WorkflowBudgetCaps,
  WorkflowBudgetRemaining,
  WorkflowBudgetSnapshot,
  WorkflowBudgetView,
  WorkflowDelegateResult,
  WorkflowTokenUsage,
} from './types'

export class WorkflowBudget implements WorkflowBudgetView {
  readonly total: WorkflowBudgetCaps
  private readonly startedAt: number
  private readonly now: () => number
  private costUsd = 0
  private tokens: WorkflowTokenUsage = { input: 0, output: 0 }
  private agentCallCount = 0
  private loopCallCount = 0

  constructor(total: WorkflowBudgetCaps, now: () => number) {
    this.total = total
    this.now = now
    this.startedAt = now()
  }

  spent(): WorkflowBudgetSnapshot {
    return {
      costUsd: this.costUsd,
      tokens: { ...this.tokens },
      agentCalls: this.agentCallCount,
      loopCalls: this.loopCallCount,
      elapsedMs: this.elapsedMs(),
    }
  }

  remaining(): WorkflowBudgetRemaining {
    const out: WorkflowBudgetRemaining = {}
    if (this.total.maxCostUsd !== undefined) out.costUsd = this.total.maxCostUsd - this.costUsd
    if (this.total.maxTokens !== undefined) {
      out.tokens = this.total.maxTokens - this.tokens.input - this.tokens.output
    }
    if (this.total.maxAgentCalls !== undefined) {
      out.agentCalls = this.total.maxAgentCalls - this.agentCallCount
    }
    if (this.total.maxLoopCalls !== undefined) {
      out.loopCalls = this.total.maxLoopCalls - this.loopCallCount
    }
    if (this.total.maxWallMs !== undefined) out.wallMs = this.total.maxWallMs - this.elapsedMs()
    return out
  }

  nextAgentIndex(): number {
    this.assertWall()
    if (this.total.maxAgentCalls !== undefined && this.agentCallCount >= this.total.maxAgentCalls) {
      throw new ValidationError(
        `workflow budget exhausted: maxAgentCalls=${this.total.maxAgentCalls}`,
      )
    }
    const index = this.agentCallCount
    this.agentCallCount += 1
    return index
  }

  nextLoopIndex(): number {
    this.assertWall()
    if (this.total.maxLoopCalls !== undefined && this.loopCallCount >= this.total.maxLoopCalls) {
      throw new ValidationError(
        `workflow budget exhausted: maxLoopCalls=${this.total.maxLoopCalls}`,
      )
    }
    const index = this.loopCallCount
    this.loopCallCount += 1
    return index
  }

  assertFanout(count: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new ValidationError(
        `workflow fanout count must be a non-negative integer, got ${count}`,
      )
    }
    if (this.total.maxFanout !== undefined && count > this.total.maxFanout) {
      throw new ValidationError(
        `workflow fanout ${count} exceeds maxFanout=${this.total.maxFanout}`,
      )
    }
  }

  observe(result: WorkflowDelegateResult): { costUsd: number; tokenUsage: WorkflowTokenUsage } {
    const costUsd = finiteNonNegative(result.costUsd ?? 0, 'costUsd')
    const tokenUsage = {
      input: finiteNonNegative(result.tokenUsage?.input ?? 0, 'tokenUsage.input'),
      output: finiteNonNegative(result.tokenUsage?.output ?? 0, 'tokenUsage.output'),
    }
    this.costUsd += costUsd
    this.tokens.input += tokenUsage.input
    this.tokens.output += tokenUsage.output
    this.assertSpend()
    return { costUsd, tokenUsage }
  }

  assertWall(): void {
    if (this.total.maxWallMs !== undefined && this.elapsedMs() > this.total.maxWallMs) {
      throw new ValidationError(`workflow budget exhausted: maxWallMs=${this.total.maxWallMs}`)
    }
  }

  remainingWallMs(): number | undefined {
    if (this.total.maxWallMs === undefined) return undefined
    return Math.max(0, this.total.maxWallMs - this.elapsedMs())
  }

  private elapsedMs(): number {
    return Math.max(0, this.now() - this.startedAt)
  }

  private assertSpend(): void {
    if (this.total.maxCostUsd !== undefined && this.costUsd > this.total.maxCostUsd) {
      throw new ValidationError(`workflow budget exhausted: maxCostUsd=${this.total.maxCostUsd}`)
    }
    if (
      this.total.maxTokens !== undefined &&
      this.tokens.input + this.tokens.output > this.total.maxTokens
    ) {
      throw new ValidationError(`workflow budget exhausted: maxTokens=${this.total.maxTokens}`)
    }
  }
}

function finiteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError(`workflow delegate returned invalid ${field}: ${value}`)
  }
  return value
}
