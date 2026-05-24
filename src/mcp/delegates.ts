/**
 * @experimental
 *
 * Delegate factories — the layer between MCP tool handlers and the
 * underlying `runLoop` runners.
 *
 * The MCP server is profile-agnostic: it owns the task queue + feedback
 * store + transport. Each `*Delegate` is the closure that the queue
 * invokes when a task runs. Consumers can override either delegate to
 * inject custom drivers, mocks, fleet-aware dispatchers, etc.
 *
 * The default coder delegate is wired here because we own
 * `coderProfile` / `multiHarnessCoderFanout`. The default researcher
 * delegate is **not** wired in this file — `agent-knowledge` cannot be
 * imported from `agent-runtime` without inducing a cycle. Consumers
 * pass `researcherDelegate` explicitly when constructing the server.
 */

import type { LoopSandboxClient } from '../loops'
import { runLoop } from '../loops'
import { coderProfile, multiHarnessCoderFanout } from '../profiles/coder'
import type {
  CoderTask,
  DelegateCodeArgs,
  DelegateResearchArgs,
  DelegationProgress,
  ResearchOutputShape,
} from './types'

/** @experimental */
export interface DelegateRunCtx {
  signal: AbortSignal
  report(progress: DelegationProgress): void
}

/** @experimental */
export type CoderDelegate = (
  args: DelegateCodeArgs,
  ctx: DelegateRunCtx,
) => Promise<import('../profiles/coder').CoderOutput>

/** @experimental */
export type ResearcherDelegate = (
  args: DelegateResearchArgs,
  ctx: DelegateRunCtx,
) => Promise<ResearchOutputShape>

/** @experimental */
export interface CreateDefaultCoderDelegateOptions {
  sandboxClient: LoopSandboxClient
  /** Default `['claude-code', 'codex', 'opencode/zai-coding-plan/glm-5.1']` when variants > 1. */
  fanoutHarnesses?: string[]
  /** Hard cap on the kernel's per-batch concurrency. Default 4. */
  maxConcurrency?: number
}

/**
 * Build a coder delegate that drives `runLoop` against the project's
 * sandbox client + coder profile. When `args.variants > 1` it switches
 * to the multi-harness fanout topology.
 *
 * @experimental
 */
export function createDefaultCoderDelegate(
  options: CreateDefaultCoderDelegateOptions,
): CoderDelegate {
  const sandboxClient = options.sandboxClient
  const fanoutHarnesses = options.fanoutHarnesses
  const maxConcurrency = options.maxConcurrency ?? 4
  return async (args, ctx) => {
    const task: CoderTask = {
      goal: buildCoderGoal(args),
      repoRoot: args.repoRoot,
      testCmd: args.config?.testCmd,
      typecheckCmd: args.config?.typecheckCmd,
      forbiddenPaths: args.config?.forbiddenPaths,
      maxDiffLines: args.config?.maxDiffLines,
    }
    const variants = Math.max(1, Math.trunc(args.variants ?? 1))
    ctx.report({ iteration: 0, phase: 'starting' })
    if (variants <= 1) {
      const { agentRunSpec, output, validator } = coderProfile({ task })
      const result = await runLoop({
        driver: singleShotDriver,
        agentRun: agentRunSpec,
        output,
        validator,
        task,
        ctx: { sandboxClient, signal: ctx.signal },
        maxIterations: 1,
        maxConcurrency,
      })
      const winner = result.winner
      if (!winner) {
        throw new Error('coder delegate produced no winner')
      }
      ctx.report({ iteration: 1, phase: 'completed' })
      return winner.output
    }
    const fanout = multiHarnessCoderFanout(
      fanoutHarnesses && fanoutHarnesses.length > 0
        ? { harnesses: fanoutHarnesses.slice(0, variants) }
        : { harnesses: undefined },
    )
    const agentRuns = fanout.agentRuns.slice(0, variants)
    const result = await runLoop({
      driver: fanout.driver,
      agentRuns,
      output: fanout.output,
      validator: fanout.validator,
      task,
      ctx: { sandboxClient, signal: ctx.signal },
      maxIterations: variants,
      maxConcurrency: Math.min(maxConcurrency, variants),
    })
    const winner = result.winner
    if (!winner) {
      throw new Error('coder delegate fanout produced no winner')
    }
    ctx.report({ iteration: agentRuns.length, phase: 'completed' })
    return winner.output
  }
}

function buildCoderGoal(args: DelegateCodeArgs): string {
  if (!args.contextHint) return args.goal
  return [args.goal, '', '## Context', args.contextHint].join('\n')
}

/**
 * Single-shot driver — plan one task on iteration 0, stop after one
 * iteration. Used by the coder delegate when `variants <= 1`. Keeps the
 * runLoop kernel-level accounting (timing, cost, trace emission) while
 * skipping fanout/refine topology overhead.
 */
const singleShotDriver = {
  name: 'mcp-single-shot',
  async plan<Task>(task: Task, history: ReadonlyArray<unknown>): Promise<Task[]> {
    return history.length === 0 ? [task] : []
  },
  decide(history: ReadonlyArray<unknown>): 'pick-winner' | 'fail' {
    return history.length > 0 ? 'pick-winner' : 'fail'
  },
}
