/**
 * @experimental
 *
 * Dynamic workflow substrate.
 *
 * A workflow is driver-authored code executed by a restricted runtime. The
 * runtime owns orchestration mechanics (phase/progress, fanout, budget,
 * cancellation, trace emission); product code supplies delegates that actually
 * run agents and loops. That boundary keeps this package generic while still
 * letting consumers wire real sandboxes underneath `agent()` and `loop()`.
 */

export interface WorkflowPhaseMeta {
  title: string
}

export interface WorkflowMeta {
  name: string
  description: string
  phases?: WorkflowPhaseMeta[]
}

export type JsonSchema =
  | { type: 'string'; minLength?: number; maxLength?: number; enum?: string[] }
  | { type: 'number'; minimum?: number; maximum?: number; enum?: number[] }
  | { type: 'integer'; minimum?: number; maximum?: number; enum?: number[] }
  | { type: 'boolean'; enum?: boolean[] }
  | { type: 'null' }
  | { type: 'array'; items?: JsonSchema; minItems?: number; maxItems?: number }
  | {
      type: 'object'
      properties?: Record<string, JsonSchema>
      required?: string[]
      additionalProperties?: boolean
    }

export interface WorkflowTokenUsage {
  input: number
  output: number
}

export interface WorkflowBudgetSnapshot {
  costUsd: number
  tokens: WorkflowTokenUsage
  agentCalls: number
  loopCalls: number
  elapsedMs: number
}

export interface WorkflowBudgetRemaining {
  costUsd?: number
  tokens?: number
  agentCalls?: number
  loopCalls?: number
  wallMs?: number
}

export interface WorkflowBudgetCaps {
  maxCostUsd?: number
  maxTokens?: number
  maxWallMs?: number
  maxAgentCalls?: number
  maxLoopCalls?: number
  maxFanout?: number
  maxDepth?: number
}

export interface WorkflowBudgetView {
  readonly total: WorkflowBudgetCaps
  spent(): WorkflowBudgetSnapshot
  remaining(): WorkflowBudgetRemaining
}

export interface WorkflowAgentOptions<TOutput = unknown> {
  label?: string
  schema?: JsonSchema
  metadata?: Record<string, unknown>
  /**
   * Nested workflows are denied by default. Consumers that expose them through
   * a delegate must also honor `ctx.depth` and `ctx.caps.maxDepth`.
   */
  allowWorkflow?: boolean
  decode?: (value: unknown) => TOutput
}

export interface WorkflowLoopOptions<TOutput = unknown> {
  label?: string
  schema?: JsonSchema
  metadata?: Record<string, unknown>
  decode?: (value: unknown) => TOutput
}

export interface WorkflowCheckpointOptions<TOutput = unknown> {
  label?: string
  schema?: JsonSchema
  metadata?: Record<string, unknown>
  decode?: (value: unknown) => TOutput
}

export interface WorkflowDelegateResult {
  output: unknown
  costUsd?: number
  tokenUsage?: Partial<WorkflowTokenUsage>
  /** Additional downstream workflow agent calls consumed inside this delegate. */
  agentCalls?: number
  /** Additional downstream workflow loop calls consumed inside this delegate. */
  loopCalls?: number
  trace?: unknown
}

export interface WorkflowDelegateContext {
  workflowRunId: string
  depth: number
  phase?: string
  signal: AbortSignal
  caps: WorkflowBudgetCaps
  budget: WorkflowBudgetView
  metadata?: Record<string, unknown>
}

export type WorkflowAgentDelegate = (
  prompt: string,
  options: WorkflowAgentOptions,
  ctx: WorkflowDelegateContext,
) => Promise<WorkflowDelegateResult>

export type WorkflowLoopDelegate = (
  input: unknown,
  options: WorkflowLoopOptions,
  ctx: WorkflowDelegateContext,
) => Promise<WorkflowDelegateResult>

export type WorkflowVerifierDelegate = (
  input: unknown,
  options: WorkflowCheckpointOptions,
  ctx: WorkflowDelegateContext,
) => Promise<WorkflowDelegateResult>

export type WorkflowAnalystDelegate = (
  input: unknown,
  options: WorkflowCheckpointOptions,
  ctx: WorkflowDelegateContext,
) => Promise<WorkflowDelegateResult>

export type WorkflowReviewerDelegate = (
  input: unknown,
  options: WorkflowCheckpointOptions,
  ctx: WorkflowDelegateContext,
) => Promise<WorkflowDelegateResult>

export type WorkflowTraceEvent =
  | { kind: 'workflow.started'; runId: string; timestamp: number; payload: WorkflowStartedPayload }
  | { kind: 'workflow.phase'; runId: string; timestamp: number; payload: WorkflowPhasePayload }
  | { kind: 'workflow.log'; runId: string; timestamp: number; payload: WorkflowLogPayload }
  | {
      kind: 'workflow.parallel.started'
      runId: string
      timestamp: number
      payload: WorkflowParallelStartedPayload
    }
  | {
      kind: 'workflow.parallel.ended'
      runId: string
      timestamp: number
      payload: WorkflowParallelEndedPayload
    }
  | {
      kind: 'workflow.pipeline.started'
      runId: string
      timestamp: number
      payload: WorkflowPipelineStartedPayload
    }
  | {
      kind: 'workflow.pipeline.ended'
      runId: string
      timestamp: number
      payload: WorkflowPipelineEndedPayload
    }
  | {
      kind: 'workflow.branch.started'
      runId: string
      timestamp: number
      payload: WorkflowBranchStartedPayload
    }
  | {
      kind: 'workflow.branch.ended'
      runId: string
      timestamp: number
      payload: WorkflowBranchEndedPayload
    }
  | {
      kind: 'workflow.branch.failed'
      runId: string
      timestamp: number
      payload: WorkflowBranchFailedPayload
    }
  | {
      kind: 'workflow.agent.started'
      runId: string
      timestamp: number
      payload: WorkflowAgentStartedPayload
    }
  | {
      kind: 'workflow.agent.ended'
      runId: string
      timestamp: number
      payload: WorkflowAgentEndedPayload
    }
  | {
      kind: 'workflow.loop.started'
      runId: string
      timestamp: number
      payload: WorkflowLoopStartedPayload
    }
  | {
      kind: 'workflow.loop.ended'
      runId: string
      timestamp: number
      payload: WorkflowLoopEndedPayload
    }
  | {
      kind: 'workflow.verifier.started'
      runId: string
      timestamp: number
      payload: WorkflowCheckpointStartedPayload
    }
  | {
      kind: 'workflow.verifier.ended'
      runId: string
      timestamp: number
      payload: WorkflowCheckpointEndedPayload
    }
  | {
      kind: 'workflow.analyst.started'
      runId: string
      timestamp: number
      payload: WorkflowCheckpointStartedPayload
    }
  | {
      kind: 'workflow.analyst.ended'
      runId: string
      timestamp: number
      payload: WorkflowCheckpointEndedPayload
    }
  | {
      kind: 'workflow.reviewer.started'
      runId: string
      timestamp: number
      payload: WorkflowCheckpointStartedPayload
    }
  | {
      kind: 'workflow.reviewer.ended'
      runId: string
      timestamp: number
      payload: WorkflowCheckpointEndedPayload
    }
  | { kind: 'workflow.failed'; runId: string; timestamp: number; payload: WorkflowFailedPayload }
  | { kind: 'workflow.ended'; runId: string; timestamp: number; payload: WorkflowEndedPayload }

export interface WorkflowStartedPayload {
  meta: WorkflowMeta
  depth: number
  caps: WorkflowBudgetCaps
}

export interface WorkflowPhasePayload {
  title: string
}

export interface WorkflowLogPayload {
  message: string
  phase?: string
}

export interface WorkflowParallelStartedPayload {
  branchCount: number
  phase?: string
}

export interface WorkflowParallelEndedPayload {
  branchCount: number
  durationMs: number
  phase?: string
}

export interface WorkflowPipelineStartedPayload {
  itemCount: number
  stageCount: number
  phase?: string
}

export interface WorkflowPipelineEndedPayload {
  itemCount: number
  stageCount: number
  durationMs: number
  phase?: string
}

export type WorkflowBranchOperation = 'parallel' | 'pipeline'

export interface WorkflowBranchStartedPayload {
  operation: WorkflowBranchOperation
  branchIndex: number
  phase?: string
  stageCount?: number
}

export interface WorkflowBranchEndedPayload {
  operation: WorkflowBranchOperation
  branchIndex: number
  durationMs: number
  phase?: string
  stageCount?: number
}

export interface WorkflowBranchFailedPayload {
  operation: WorkflowBranchOperation
  branchIndex: number
  durationMs: number
  message: string
  code?: string
  phase?: string
  stageIndex?: number
}

export interface WorkflowAgentStartedPayload {
  index: number
  label?: string
  promptChars: number
  phase?: string
  metadata?: Record<string, unknown>
}

export interface WorkflowAgentEndedPayload {
  index: number
  label?: string
  durationMs: number
  costUsd: number
  tokenUsage: WorkflowTokenUsage
  phase?: string
  trace?: unknown
}

export interface WorkflowLoopStartedPayload {
  index: number
  label?: string
  phase?: string
  metadata?: Record<string, unknown>
}

export interface WorkflowLoopEndedPayload {
  index: number
  label?: string
  durationMs: number
  costUsd: number
  tokenUsage: WorkflowTokenUsage
  phase?: string
  trace?: unknown
}

export interface WorkflowCheckpointStartedPayload {
  index: number
  label?: string
  phase?: string
  metadata?: Record<string, unknown>
}

export interface WorkflowCheckpointEndedPayload {
  index: number
  label?: string
  durationMs: number
  costUsd: number
  tokenUsage: WorkflowTokenUsage
  phase?: string
  trace?: unknown
}

export interface WorkflowFailedPayload {
  message: string
  code?: string
  phase?: string
}

export interface WorkflowEndedPayload {
  durationMs: number
  costUsd: number
  tokenUsage: WorkflowTokenUsage
  agentCalls: number
  loopCalls: number
}

export interface WorkflowTraceEmitter {
  emit(event: WorkflowTraceEvent): void | Promise<void>
}

export interface WorkflowRuntimeOptions {
  source: string
  agent: WorkflowAgentDelegate
  loop?: WorkflowLoopDelegate
  verifier?: WorkflowVerifierDelegate
  analyst?: WorkflowAnalystDelegate
  reviewer?: WorkflowReviewerDelegate
  runId?: string
  depth?: number
  caps?: WorkflowBudgetCaps
  metadata?: Record<string, unknown>
  signal?: AbortSignal
  traceEmitter?: WorkflowTraceEmitter
  now?: () => number
  syncTimeoutMs?: number
}

export interface WorkflowResult<TOutput = unknown> {
  runId: string
  meta: WorkflowMeta
  output: TOutput
  events: WorkflowTraceEvent[]
  durationMs: number
  costUsd: number
  tokenUsage: WorkflowTokenUsage
  agentCalls: number
  loopCalls: number
}
