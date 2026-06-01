import vm from 'node:vm'
import { ValidationError } from '../errors'
import type { WorkflowBudget } from './budget'
import { installWorkflowGlobals, type WorkflowRuntimeGlobals } from './realm'
import { validateJsonSchema } from './schema'
import type { WorkflowBudgetCaps, WorkflowDelegateResult } from './types'

export type WorkflowCheckpointRuntimeKind = 'verifier' | 'analyst' | 'reviewer'

const DEFAULT_CAPS: Required<WorkflowBudgetCaps> = {
  maxCostUsd: Number.POSITIVE_INFINITY,
  maxTokens: Number.POSITIVE_INFINITY,
  maxWallMs: 10 * 60_000,
  maxAgentCalls: 32,
  maxLoopCalls: 16,
  maxFanout: 8,
  maxDepth: 1,
}

export async function runWorkflowBody(
  body: string,
  workflowName: string,
  globals: WorkflowRuntimeGlobals,
  syncTimeoutMs = 1000,
): Promise<unknown> {
  const context = vm.createContext(Object.create(null), {
    name: `workflow:${workflowName}`,
    codeGeneration: { strings: false, wasm: false },
  })
  installWorkflowGlobals(context, globals)
  const script = new vm.Script(
    `
'use strict'
const __workflowMain = async () => {
${body}
}
__workflowMain()
`,
    { filename: `${workflowName}.workflow.js` },
  )
  return script.runInContext(context, { timeout: syncTimeoutMs })
}

export function decodeWorkflowDelegateResult<
  TOptions extends { schema?: unknown; decode?: (value: unknown) => unknown },
>(result: WorkflowDelegateResult, options: TOptions): unknown {
  if (options.schema) validateJsonSchema(result.output, options.schema as never)
  return options.decode ? options.decode(result.output) : result.output
}

export function normalizeWorkflowCaps(caps: WorkflowBudgetCaps = {}): Required<WorkflowBudgetCaps> {
  return {
    maxCostUsd: normalizeCap(caps.maxCostUsd, DEFAULT_CAPS.maxCostUsd, 'maxCostUsd'),
    maxTokens: normalizeCap(caps.maxTokens, DEFAULT_CAPS.maxTokens, 'maxTokens'),
    maxWallMs: normalizeCap(caps.maxWallMs, DEFAULT_CAPS.maxWallMs, 'maxWallMs'),
    maxAgentCalls: normalizeCap(caps.maxAgentCalls, DEFAULT_CAPS.maxAgentCalls, 'maxAgentCalls', {
      integer: true,
    }),
    maxLoopCalls: normalizeCap(caps.maxLoopCalls, DEFAULT_CAPS.maxLoopCalls, 'maxLoopCalls', {
      integer: true,
    }),
    maxFanout: normalizeCap(caps.maxFanout, DEFAULT_CAPS.maxFanout, 'maxFanout', {
      integer: true,
    }),
    maxDepth: normalizeCap(caps.maxDepth, DEFAULT_CAPS.maxDepth, 'maxDepth', { integer: true }),
  }
}

export async function waitForWorkflowBudget<T>(
  run: () => Promise<T>,
  budget: WorkflowBudget,
  signal: AbortSignal | undefined,
  abortWorkflow?: () => void,
  scope: 'delegate' | 'body' = 'delegate',
): Promise<T> {
  budget.assertWall()
  const wallMs = budget.remainingWallMs()
  if (signal?.aborted) throw new ValidationError(`workflow aborted before ${scope} completed`)
  if (wallMs !== undefined && wallMs <= 0) {
    throw new ValidationError('workflow budget exhausted: maxWallMs reached')
  }
  const promise = run()
  if (wallMs === undefined || !Number.isFinite(wallMs)) return promise
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new ValidationError(`workflow ${scope} timed out`))
          abortWorkflow?.()
        }, wallMs)
        abort = () => reject(new ValidationError(`workflow aborted before ${scope} completed`))
        signal?.addEventListener('abort', abort, { once: true })
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (abort) signal?.removeEventListener('abort', abort)
  }
}

export function createWorkflowSignal(external: AbortSignal | undefined): {
  signal: AbortSignal
  abort: () => void
  cleanup: () => void
} {
  const controller = new AbortController()
  const abort = () => {
    if (!controller.signal.aborted) controller.abort()
  }
  if (external) {
    if (external.aborted) {
      abort()
    } else {
      external.addEventListener('abort', abort, { once: true })
    }
  }
  return {
    signal: controller.signal,
    abort,
    cleanup: () => external?.removeEventListener('abort', abort),
  }
}

export function checkpointStartedKind(
  kind: WorkflowCheckpointRuntimeKind,
): 'workflow.verifier.started' | 'workflow.analyst.started' | 'workflow.reviewer.started' {
  switch (kind) {
    case 'verifier':
      return 'workflow.verifier.started'
    case 'analyst':
      return 'workflow.analyst.started'
    case 'reviewer':
      return 'workflow.reviewer.started'
  }
}

export function checkpointEndedKind(
  kind: WorkflowCheckpointRuntimeKind,
): 'workflow.verifier.ended' | 'workflow.analyst.ended' | 'workflow.reviewer.ended' {
  switch (kind) {
    case 'verifier':
      return 'workflow.verifier.ended'
    case 'analyst':
      return 'workflow.analyst.ended'
    case 'reviewer':
      return 'workflow.reviewer.ended'
  }
}

export function assertWorkflowString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`workflow ${name} must be a non-empty string`)
  }
}

export function isRejected<T>(settled: PromiseSettledResult<T>): settled is PromiseRejectedResult {
  return settled.status === 'rejected'
}

export function fulfilledValues<T>(settled: readonly PromiseSettledResult<T>[]): T[] {
  return settled.map((item) => (item as PromiseFulfilledResult<T>).value)
}

function normalizeCap(
  value: number | undefined,
  fallback: number,
  field: keyof WorkflowBudgetCaps,
  options: { integer?: boolean } = {},
): number {
  const cap = value ?? fallback
  if (typeof cap !== 'number' || Number.isNaN(cap) || cap < 0) {
    throw new ValidationError(`workflow caps.${field} must be a non-negative number`)
  }
  if (options.integer && Number.isFinite(cap) && !Number.isInteger(cap)) {
    throw new ValidationError(`workflow caps.${field} must be an integer`)
  }
  return cap
}
