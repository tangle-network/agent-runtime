import { ValidationError } from '../errors'
import { runWorkflow } from './runtime'
import type {
  WorkflowAgentDelegate,
  WorkflowAgentOptions,
  WorkflowAnalystDelegate,
  WorkflowBudgetCaps,
  WorkflowDelegateContext,
  WorkflowDelegateResult,
  WorkflowLoopDelegate,
  WorkflowResult,
  WorkflowReviewerDelegate,
  WorkflowTraceEmitter,
  WorkflowVerifierDelegate,
} from './types'

export interface NestedWorkflowDelegateInput {
  source: string
  options: WorkflowAgentOptions
  parent: WorkflowDelegateContext
}

export type NestedWorkflowCapsResolver =
  | WorkflowBudgetCaps
  | ((input: NestedWorkflowDelegateInput) => WorkflowBudgetCaps)

export type NestedWorkflowMetadataResolver =
  | Record<string, unknown>
  | ((input: NestedWorkflowDelegateInput) => Record<string, unknown> | undefined)

export interface NestedWorkflowTrace {
  nested: true
  runId: string
  parentRunId: string
  depth: number
  metaName: string
  eventCount: number
  eventKinds: string[]
  durationMs: number
  costUsd: number
  tokenUsage: WorkflowResult['tokenUsage']
  agentCalls: number
  loopCalls: number
  events?: WorkflowResult['events']
}

export interface CreateNestedWorkflowAgentDelegateOptions {
  /**
   * Real worker delegate used for normal agent() calls and for child workflow
   * agent() calls that do not opt into allowWorkflow.
   */
  agent: WorkflowAgentDelegate
  caps: NestedWorkflowCapsResolver
  loop?: WorkflowLoopDelegate
  verifier?: WorkflowVerifierDelegate
  analyst?: WorkflowAnalystDelegate
  reviewer?: WorkflowReviewerDelegate
  metadata?: NestedWorkflowMetadataResolver
  traceEmitter?: WorkflowTraceEmitter
  includeEventsInTrace?: boolean
  runId?: (input: NestedWorkflowDelegateInput) => string
  toOutput?: (result: WorkflowResult, input: NestedWorkflowDelegateInput) => unknown
  toTrace?: (result: WorkflowResult, input: NestedWorkflowDelegateInput) => unknown
}

export function createNestedWorkflowAgentDelegate(
  options: CreateNestedWorkflowAgentDelegateOptions,
): WorkflowAgentDelegate {
  if (!options.agent) {
    throw new ValidationError('nested workflow delegate: base agent delegate is required')
  }

  const delegate: WorkflowAgentDelegate = async (prompt, agentOptions, ctx) => {
    if (!agentOptions.allowWorkflow) return options.agent(prompt, agentOptions, ctx)
    assertNestedDepth(ctx)

    const input: NestedWorkflowDelegateInput = {
      source: prompt,
      options: agentOptions,
      parent: ctx,
    }
    const caps = boundNestedCaps(resolveNestedCaps(options.caps, input), ctx)
    const metadata = resolveMetadata(options.metadata, input)
    const result = await runWorkflow({
      source: prompt,
      runId: options.runId?.(input),
      depth: ctx.depth + 1,
      caps,
      metadata: {
        parentWorkflowRunId: ctx.workflowRunId,
        parentPhase: ctx.phase,
        parentAgentLabel: agentOptions.label,
        ...(ctx.metadata ?? {}),
        ...(metadata ?? {}),
      },
      signal: ctx.signal,
      agent: delegate,
      loop: options.loop,
      verifier: options.verifier,
      analyst: options.analyst,
      reviewer: options.reviewer,
      traceEmitter: options.traceEmitter,
    })

    return {
      output: options.toOutput ? options.toOutput(result, input) : result.output,
      costUsd: result.costUsd,
      tokenUsage: result.tokenUsage,
      agentCalls: result.agentCalls,
      loopCalls: result.loopCalls,
      trace: options.toTrace
        ? options.toTrace(result, input)
        : defaultTrace(result, input, options),
    } satisfies WorkflowDelegateResult
  }

  return delegate
}

function resolveNestedCaps(
  resolver: NestedWorkflowCapsResolver,
  input: NestedWorkflowDelegateInput,
): WorkflowBudgetCaps {
  const caps = typeof resolver === 'function' ? resolver(input) : resolver
  if (!caps || typeof caps !== 'object') {
    throw new ValidationError('nested workflow caps must be an object')
  }
  assertFiniteCap(caps.maxWallMs, 'maxWallMs')
  assertFiniteCap(caps.maxAgentCalls, 'maxAgentCalls')
  assertFiniteCap(caps.maxLoopCalls, 'maxLoopCalls')
  assertFiniteCap(caps.maxFanout, 'maxFanout')
  assertFiniteCap(caps.maxDepth, 'maxDepth')
  if (caps.maxCostUsd !== undefined) assertFiniteCap(caps.maxCostUsd, 'maxCostUsd')
  if (caps.maxTokens !== undefined) assertFiniteCap(caps.maxTokens, 'maxTokens')
  return caps
}

function boundNestedCaps(
  caps: WorkflowBudgetCaps,
  ctx: WorkflowDelegateContext,
): WorkflowBudgetCaps {
  const remaining = ctx.budget.remaining()
  return {
    ...caps,
    maxCostUsd: minOptionalCap(caps.maxCostUsd, remaining.costUsd),
    maxTokens: minOptionalCap(caps.maxTokens, remaining.tokens),
    maxWallMs: minRequiredCap(caps.maxWallMs, remaining.wallMs, 'maxWallMs'),
    maxAgentCalls: minRequiredCap(caps.maxAgentCalls, remaining.agentCalls, 'maxAgentCalls'),
    maxLoopCalls: minRequiredCap(caps.maxLoopCalls, remaining.loopCalls, 'maxLoopCalls'),
    maxFanout: minRequiredCap(caps.maxFanout, ctx.caps.maxFanout, 'maxFanout'),
    maxDepth: minRequiredCap(caps.maxDepth, ctx.caps.maxDepth, 'maxDepth'),
  }
}

function assertNestedDepth(ctx: WorkflowDelegateContext): void {
  const maxDepth = ctx.caps.maxDepth
  if (typeof maxDepth !== 'number' || !Number.isFinite(maxDepth)) {
    throw new ValidationError('nested workflow parent caps.maxDepth must be finite')
  }
  const childDepth = ctx.depth + 1
  if (childDepth > maxDepth) {
    throw new ValidationError(`nested workflow depth ${childDepth} exceeds maxDepth=${maxDepth}`)
  }
}

function minRequiredCap(
  child: number | undefined,
  parent: number | undefined,
  field: keyof WorkflowBudgetCaps,
): number {
  assertFiniteCap(child, field)
  if (parent === undefined || !Number.isFinite(parent)) return child
  return Math.min(child, parent)
}

function minOptionalCap(child: number | undefined, parent: number | undefined): number | undefined {
  if (child !== undefined && parent !== undefined && Number.isFinite(parent)) {
    return Math.min(child, parent)
  }
  if (child !== undefined) return child
  return parent !== undefined && Number.isFinite(parent) ? parent : undefined
}

function assertFiniteCap(
  value: number | undefined,
  field: keyof WorkflowBudgetCaps,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(`nested workflow caps.${field} must be a finite non-negative number`)
  }
  if (
    (field === 'maxAgentCalls' ||
      field === 'maxLoopCalls' ||
      field === 'maxFanout' ||
      field === 'maxDepth') &&
    !Number.isInteger(value)
  ) {
    throw new ValidationError(`nested workflow caps.${field} must be an integer`)
  }
}

function resolveMetadata(
  resolver: NestedWorkflowMetadataResolver | undefined,
  input: NestedWorkflowDelegateInput,
): Record<string, unknown> | undefined {
  return typeof resolver === 'function' ? resolver(input) : resolver
}

function defaultTrace(
  result: WorkflowResult,
  input: NestedWorkflowDelegateInput,
  options: CreateNestedWorkflowAgentDelegateOptions,
): NestedWorkflowTrace {
  return {
    nested: true,
    runId: result.runId,
    parentRunId: input.parent.workflowRunId,
    depth: input.parent.depth + 1,
    metaName: result.meta.name,
    eventCount: result.events.length,
    eventKinds: result.events.map((event) => event.kind),
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    tokenUsage: result.tokenUsage,
    agentCalls: result.agentCalls,
    loopCalls: result.loopCalls,
    ...(options.includeEventsInTrace ? { events: result.events } : {}),
  }
}
