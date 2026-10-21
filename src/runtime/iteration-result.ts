import type { RunAgentRoundsOptions } from './agent-rounds'
import { emitRunLoopHook, emitTrace } from './iteration-events'
import type {
  Iteration,
  LoopResult,
  LoopTokenUsage,
  LoopWinner,
  MountManifestEntry,
  SelectionReceipt,
} from './types'
import { addTokenUsage, stringifySafe, zeroTokenUsage } from './util'

interface FinalizeArgs<Task, Output, Decision> {
  options: RunAgentRoundsOptions<Task, Output, Decision>
  decision: Decision
  iterations: Iteration<Task, Output>[]
  startMs: number
  now: () => number
  runId: string
  /** Provenance mounts recorded across the run's box preparations. */
  mounts: MountManifestEntry[]
}

function finalize<Task, Output, Decision>(
  args: FinalizeArgs<Task, Output, Decision>,
): LoopResult<Task, Output, Decision> {
  // Precedence: an explicit caller `selectWinner` wins; else a driver-AUTHORED
  // winner (a `select` topology move); else the default argmax. A driver that
  // declares nothing returns undefined and falls through — existing behavior.
  // Track which selector produced the winner so the receipts attribute it.
  let selector: SelectionReceipt['selector']
  let winner: LoopWinner<Task, Output> | undefined
  if (args.options.selectWinner) {
    selector = 'caller'
    winner = args.options.selectWinner(args.iterations)
  } else {
    const authored = args.options.driver.selectWinner?.(args.iterations)
    if (authored) {
      selector = 'driver'
      winner = authored
    } else {
      selector = 'default'
      winner = defaultSelectWinner(args.iterations)
    }
  }
  const costUsd = args.iterations.reduce((sum, iter) => sum + iter.costUsd, 0)
  const costUsdKnown = args.iterations.every((iter) => iter.costUsdKnown !== false)
  const unprovenCostUsd = args.iterations.reduce(
    (sum, iter) => sum + (iter.unprovenCostUsd ?? 0),
    0,
  )
  const estimatedCostUsd = args.iterations.reduce(
    (sum, iter) => sum + (iter.estimatedCostUsd ?? 0),
    0,
  )
  const promptCache: Record<string, number | string> = {}
  for (const iteration of args.iterations) {
    if (iteration.promptCache) mergeUsageMetadata(promptCache, iteration.promptCache)
  }
  const tokenUsage = args.iterations.reduce((acc: LoopTokenUsage, iter) => {
    addTokenUsage(acc, iter.tokenUsage)
    return acc
  }, zeroTokenUsage())
  // Box time sums only over the iterations that could pair an acquire with a teardown. An
  // iteration that ran a box and could not time it makes the sum a floor; a run where NO iteration
  // could time one reports no box time at all rather than a zero.
  const timedBoxes = args.iterations.filter((iter) => iter.boxLiveMs !== undefined)
  const boxLiveMs = timedBoxes.reduce((sum, iter) => sum + (iter.boxLiveMs ?? 0), 0)
  const boxLiveMsKnown =
    timedBoxes.length === args.iterations.length &&
    args.iterations.every((iter) => iter.boxLiveMsKnown !== false)
  const result: LoopResult<Task, Output, Decision> = {
    decision: args.decision,
    iterations: args.iterations,
    winner,
    durationMs: args.now() - args.startMs,
    costUsd,
    ...(costUsdKnown ? {} : { costUsdKnown: false }),
    ...(unprovenCostUsd > 0 ? { unprovenCostUsd } : {}),
    ...(estimatedCostUsd > 0 ? { estimatedCostUsd } : {}),
    ...(Object.keys(promptCache).length > 0 ? { promptCache } : {}),
    tokenUsage,
    ...(timedBoxes.length > 0 ? { boxLiveMs } : {}),
    ...(boxLiveMsKnown ? {} : { boxLiveMsKnown: false as const }),
    provenance: {
      mounts: args.mounts,
      selectionReceipts: buildSelectionReceipts(args.iterations, winner, selector),
    },
  }
  return result
}

export function mergeUsageMetadata(
  target: Record<string, number | string>,
  source: Readonly<Record<string, number | string>>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number') target[key] = (Number(target[key]) || 0) + value
    else target[key] = value
  }
}

/**
 * One receipt per scored candidate — a candidate being an iteration that
 * produced an output without erroring (an errored or output-less iteration was
 * never selectable, so it gets no receipt). The receipt records the candidate's
 * score and whether the selector chose it as the winner, attributed to the
 * selector identity that ran. Domain-free: it states WHAT was selected and its
 * score, never anything about the task or output content.
 */
function buildSelectionReceipts<Task, Output>(
  iterations: Iteration<Task, Output>[],
  winner: LoopWinner<Task, Output> | undefined,
  selector: SelectionReceipt['selector'],
): SelectionReceipt[] {
  const receipts: SelectionReceipt[] = []
  for (const iter of iterations) {
    if (iter.output === undefined || iter.error) continue
    const selected = winner?.iterationIndex === iter.index
    const receipt: SelectionReceipt = {
      candidateIndex: iter.index,
      selected,
      selector,
    }
    if (iter.verdict?.score !== undefined) receipt.score = iter.verdict.score
    // The kernel can only speak to its OWN selection logic. A caller- or
    // driver-authored winner runs by its own rationale, so the kernel leaves
    // `reason` unset rather than inventing one.
    if (selector === 'default') receipt.reason = defaultSelectorReason(iter, selected)
    receipts.push(receipt)
  }
  return receipts
}

/** Plain-language reason for the default selector's decision (best-valid-score,
 *  earliest-index tiebreak, falling back to best non-errored when none valid). */
function defaultSelectorReason<Task, Output>(
  iter: Iteration<Task, Output>,
  selected: boolean,
): string {
  const valid = iter.verdict?.valid === true
  if (selected) return valid ? 'best valid score' : 'best non-errored score (no valid candidate)'
  return valid ? 'valid but not top score' : 'not selected'
}

/**
 * Run `decide`, emit the `loop.decision` trace, then finalize and emit
 * `loop.ended`. The two post-while exits (cap reached / `plan()` returned `[]`)
 * share this exact sequence.
 */
export async function decideAndFinalize<Task, Output, Decision>(
  options: RunAgentRoundsOptions<Task, Output, Decision>,
  iterations: Iteration<Task, Output>[],
  startMs: number,
  now: () => number,
  runId: string,
  mounts: MountManifestEntry[],
): Promise<LoopResult<Task, Output, Decision>> {
  emitRunLoopHook(options, {
    target: 'agent.decision',
    phase: 'before',
    runId,
    timestamp: now(),
    payload: { historyLength: iterations.length },
  })
  const decision = await options.driver.decide(iterations)
  emitRunLoopHook(options, {
    target: 'agent.decision',
    phase: 'after',
    runId,
    timestamp: now(),
    payload: { decision: stringifySafe(decision), historyLength: iterations.length },
  })
  await emitTrace(options.ctx.traceEmitter, {
    kind: 'loop.decision',
    runId,
    timestamp: now(),
    payload: { decision: stringifySafe(decision), historyLength: iterations.length },
  })
  return finalizeAndEmitEnded(options, decision, iterations, startMs, now, runId, mounts)
}

/** Finalize the loop and emit the terminal `loop.ended` span. Used by the
 *  in-loop terminal path (decision trace already emitted) and decideAndFinalize. */
export async function finalizeAndEmitEnded<Task, Output, Decision>(
  options: RunAgentRoundsOptions<Task, Output, Decision>,
  decision: Decision,
  iterations: Iteration<Task, Output>[],
  startMs: number,
  now: () => number,
  runId: string,
  mounts: MountManifestEntry[],
): Promise<LoopResult<Task, Output, Decision>> {
  const result = finalize({ options, decision, iterations, startMs, now, runId, mounts })
  emitRunLoopHook(options, {
    target: 'agent.run',
    phase: 'after',
    runId,
    timestamp: now(),
    payload: {
      decision: stringifySafe(decision),
      winnerIterationIndex: result.winner?.iterationIndex,
      totalCostUsd: result.costUsd,
      ...(result.costUsdKnown === false ? { costUsdKnown: false } : {}),
      ...(result.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: result.estimatedCostUsd }
        : {}),
      durationMs: result.durationMs,
      iterations: iterations.length,
    },
  })
  // Await the terminal span (unlike a fire-and-forget) so a process exiting
  // right after runAgentRounds resolves (MCP subprocess / CLI dispatch) can't drop it.
  await emitTrace(options.ctx.traceEmitter, {
    kind: 'loop.ended',
    runId,
    timestamp: now(),
    payload: {
      winnerIterationIndex: result.winner?.iterationIndex,
      totalCostUsd: result.costUsd,
      ...(result.costUsdKnown === false ? { costUsdKnown: false } : {}),
      ...(result.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: result.estimatedCostUsd }
        : {}),
      durationMs: result.durationMs,
      iterations: iterations.length,
    },
  })
  return result
}

/**
 * The kernel's winner argmax — best-valid-score, ties broken by earliest index,
 * falling back to the best-scoring non-errored output when none is valid. Exported
 * so the `runProgram` tree executor selects across merged sub-loop iterations with
 * the SAME semantics the kernel uses at a single loop's finalize (one selector, not
 * a forked copy).
 */
export function defaultSelectWinner<Task, Output>(
  iterations: Iteration<Task, Output>[],
): LoopWinner<Task, Output> | undefined {
  const candidates = iterations.filter((iter) => iter.output !== undefined && !iter.error)
  if (candidates.length === 0) return undefined
  const valid = candidates.filter((iter) => iter.verdict?.valid === true)
  const pool = valid.length > 0 ? valid : candidates
  const sorted = [...pool].sort(
    (a, b) => (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0) || a.index - b.index,
  )
  const top = sorted[0]
  if (!top || top.output === undefined) return undefined
  return {
    task: top.task,
    output: top.output,
    verdict: top.verdict,
    iterationIndex: top.index,
    agentRunName: top.agentRunName,
  }
}

/**
 * Decision values the kernel treats as terminal. Every other value returned by
 * `decide` continues the loop. Type a driver's `decide` return as
 * `'your-word' | TerminalDecision` so caller vocabulary and kernel keywords
 * stay visibly distinct.
 *
 * @stable
 */
export const TERMINAL_DECISIONS = ['stop', 'pick-winner', 'fail', 'done'] as const

/** One of the kernel's terminal decision values. @stable */
export type TerminalDecision = (typeof TERMINAL_DECISIONS)[number]

/** True when the kernel stops the loop for this decision value. @stable */
export function isTerminalDecision(decision: unknown): decision is TerminalDecision {
  return (TERMINAL_DECISIONS as readonly unknown[]).includes(decision)
}
