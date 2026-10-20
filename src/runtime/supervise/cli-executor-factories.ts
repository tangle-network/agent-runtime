import { agentProfileSchema } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import { bridgeWorktreeExecutor } from './bridge-worktree-executor'
import { readSeam } from './executor-seams'
import { createInPlaceCliExecutor } from './in-place-cli-executor'
import { assertExecutableAgentProfile } from './model-policy'
import {
  type CliInPlaceSeam,
  type CliWorktreeSeam,
  cliInPlaceSeamKey,
  cliWorktreeSeamKey,
} from './runtime-seams'
import type { Executor, ExecutorFactory } from './types'
import { createWorktreeCliExecutor } from './worktree-cli-executor'

export const cliWorktreeExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<CliWorktreeSeam>(ctx, cliWorktreeSeamKey, 'cli-worktree')
  if (!seam.repoRoot) {
    throw new ValidationError('cliWorktreeExecutor: CliWorktreeSeam.repoRoot required')
  }
  if (seam.bridge) return bridgeWorktreeExecutor(spec, ctx, seam)
  const effectiveProfile = agentProfileSchema.parse(spec.profile)
  assertExecutableAgentProfile(effectiveProfile, 'cliWorktreeExecutor')
  return createWorktreeCliExecutor({
    repoRoot: seam.repoRoot,
    profile: effectiveProfile,
    ...(seam.taskPrompt !== undefined ? { taskPrompt: seam.taskPrompt } : {}),
    ...(seam.runId ? { runId: seam.runId } : {}),
    ...(seam.baseRef ? { baseRef: seam.baseRef } : {}),
    ...(seam.harnessTimeoutMs !== undefined ? { harnessTimeoutMs: seam.harnessTimeoutMs } : {}),
    ...(seam.codexReproducible ? { codexReproducible: true } : {}),
    ...(seam.codexReadDeniedPaths ? { codexReadDeniedPaths: seam.codexReadDeniedPaths } : {}),
    ...(seam.testCmd !== undefined ? { testCmd: seam.testCmd } : {}),
    ...(seam.typecheckCmd !== undefined ? { typecheckCmd: seam.typecheckCmd } : {}),
    ...(seam.checkTimeoutMs !== undefined ? { checkTimeoutMs: seam.checkTimeoutMs } : {}),
    ...(seam.checkOutputCap !== undefined ? { checkOutputCap: seam.checkOutputCap } : {}),
    ...(seam.runGit ? { runGit: seam.runGit } : {}),
    ...(seam.runCommand ? { runCommand: seam.runCommand } : {}),
    ...(seam.budgetExempt !== undefined ? { budgetExempt: seam.budgetExempt } : {}),
    ...(ctx.node?.attemptId !== undefined ? { executionAttemptId: ctx.node.attemptId } : {}),
  }) as Executor<unknown>
}

/**
 * The leaf `createInPlaceCliExecutor` as a backend-as-data factory: a supervisor-authored
 * `AgentProfile` driving a local coding CLI in the workspace the caller supplied, so its edits are
 * still there for the next spawn. `budgetExempt` like the other CLI leaves; the authored
 * systemPrompt + model reach the harness via §1.5.
 */
export const cliInPlaceExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<CliInPlaceSeam>(ctx, cliInPlaceSeamKey, 'cli-in-place')
  if (!seam.workspacePath) {
    throw new ValidationError('cliInPlaceExecutor: CliInPlaceSeam.workspacePath required')
  }
  const effectiveProfile = agentProfileSchema.parse(spec.profile)
  assertExecutableAgentProfile(effectiveProfile, 'cliInPlaceExecutor')
  return createInPlaceCliExecutor({
    workspacePath: seam.workspacePath,
    profile: effectiveProfile,
    ...(seam.taskPrompt !== undefined ? { taskPrompt: seam.taskPrompt } : {}),
    ...(seam.harnessTimeoutMs !== undefined ? { harnessTimeoutMs: seam.harnessTimeoutMs } : {}),
    ...(seam.runHarness ? { runHarness: seam.runHarness } : {}),
    ...(ctx.node?.attemptId !== undefined ? { executionAttemptId: ctx.node.attemptId } : {}),
  }) as Executor<unknown>
}
