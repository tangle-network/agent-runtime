import { type LoopResult, runLoop } from '../runtime'
import type { RunLoopOptions } from '../runtime/run-loop'
import type {
  WorkflowDelegateContext,
  WorkflowDelegateResult,
  WorkflowLoopDelegate,
  WorkflowLoopOptions,
} from './types'

export interface CreateRunLoopWorkflowDelegateOptions<Input, Task, Output, Decision> {
  toRunLoopOptions(
    input: Input,
    options: WorkflowLoopOptions,
    ctx: WorkflowDelegateContext,
  ): RunLoopOptions<Task, Output, Decision>
  toOutput?: (result: LoopResult<Task, Output, Decision>) => unknown
  toTrace?: (result: LoopResult<Task, Output, Decision>) => unknown
}

export function createRunLoopWorkflowDelegate<Input, Task, Output, Decision>(
  options: CreateRunLoopWorkflowDelegateOptions<Input, Task, Output, Decision>,
): WorkflowLoopDelegate {
  return async (input, loopOptions, ctx): Promise<WorkflowDelegateResult> => {
    const result = await runLoop(options.toRunLoopOptions(input as Input, loopOptions, ctx))
    return {
      output: options.toOutput ? options.toOutput(result) : defaultOutput(result),
      costUsd: result.costUsd,
      tokenUsage: result.tokenUsage,
      trace: options.toTrace ? options.toTrace(result) : defaultTrace(result),
    }
  }
}

function defaultOutput<Task, Output, Decision>(
  result: LoopResult<Task, Output, Decision>,
): unknown {
  return (
    result.winner?.output ?? {
      decision: result.decision,
      iterations: result.iterations.length,
    }
  )
}

function defaultTrace<Task, Output, Decision>(result: LoopResult<Task, Output, Decision>): unknown {
  return {
    decision: result.decision,
    iterations: result.iterations.length,
    winnerIterationIndex: result.winner?.iterationIndex,
    costUsd: result.costUsd,
    tokenUsage: result.tokenUsage,
  }
}
