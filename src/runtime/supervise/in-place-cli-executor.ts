/**
 *
 * The in-place CLI leaf executor — a supervisor-authored `AgentProfile` driving a local
 * coding-harness CLI (claude-code / codex / opencode / pi) on a workspace the CALLER supplies,
 * surfaced as the open `Executor<Out>` port (`./types`).
 *
 * The difference from `createWorktreeCliExecutor` is the whole point of it: that leaf cuts a git
 * worktree of its own and hands back the diff, so the directory it was pointed at is never edited;
 * this leaf runs the harness in the directory it was given, so the edits ARE that directory and
 * they are still there when the call returns. That is what a caller needs when the workspace has
 * to survive between calls — a multi-shot author that resumes on top of its own edits, or a
 * candidate directory the caller commits itself.
 *
 * Both leaves share one physical act (`runInPlaceHarness` / `runWorktreeHarness`, both in
 * `../../mcp/worktree-harness`): the same profile materializer, the same `harnessInvocation`
 * mapper, the same subprocess spawn. Only workspace ownership differs.
 *
 * The profile inputs this path materializes are removed before it returns, so the workspace the
 * caller reads holds the harness's own edits and nothing else.
 *
 * Token accounting: a harness CLI run reports no usage receipt, so this leaf is `budgetExempt` and
 * its `Spend` marks `tokensKnown: false` — the `{0,0}` is a floor, never a measured-free run.
 *
 * @experimental
 */

import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { LOCAL_HARNESSES, type LocalHarness, type runLocalHarness } from '../../mcp/local-harness'
import {
  type InPlaceHarnessResult,
  runInPlaceHarness,
  worktreeProfileExecutionPlan,
} from '../../mcp/worktree-harness'
import { linkAbort } from './abortable'
import { executableAgentProfileSnapshot } from './executable-spec'
import { attestRuntimeOwnedExecutor, newExecutionAttemptId } from './materialization'
import { concreteProfileModel } from './model-policy'
import { taskToPrompt } from './task-prompt'
import type { Executor, ExecutorResult, Spend } from './types'

export type { InPlaceHarnessResult }

/** @experimental */
export interface InPlaceCliExecutorOptions {
  /** Absolute path to the EXISTING directory the harness edits. The caller owns its lifecycle:
   *  this leaf never creates it, never cleans it, and never removes it at teardown. */
  workspacePath: string
  /**
   * The supervisor-authored prompt/model plus materializable structural resources.
   * `model.default` selects the one-shot model. Routing-only model hints, placement concerns,
   * provider extensions, and `resources.failOnError` fail before execution because this path
   * cannot honor them. Harness-specific values the materializer cannot preserve also fail closed.
   */
  profile: AgentProfile
  /** Default instruction for direct `execute(undefined, signal)` calls. An execution-time task
   *  is authoritative. Omit when the caller always supplies the task to `execute`. */
  taskPrompt?: string
  /** Optional wall-clock cap per harness subprocess (ms). Omit it for no timer. */
  harnessTimeoutMs?: number
  /** Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`. */
  runHarness?: typeof runLocalHarness
  /** @internal Kernel-minted attempt identity threaded by the built-in registry. */
  executionAttemptId?: string
}

/**
 * Build an in-place CLI leaf `Executor`. Per-spawn, but NOT per-workspace: repeated spawns against
 * the same `workspacePath` run in the same directory on purpose, each seeing what the last one
 * wrote.
 *
 * Fail-loud: an empty `workspacePath`, an incomplete/unsupported profile, a separate harness
 * override, or an explicitly empty `taskPrompt` throws at construction. A `workspacePath` that is
 * not an existing directory throws before the harness launches. `resultArtifact()` before
 * `execute()` resolves throws.
 *
 * @experimental
 */
export function createInPlaceCliExecutor(
  options: InPlaceCliExecutorOptions,
): Executor<InPlaceHarnessResult> {
  if (!options.workspacePath) {
    throw new ValidationError('createInPlaceCliExecutor: workspacePath required')
  }
  if ('harness' in options) {
    throw new ValidationError(
      'createInPlaceCliExecutor: separate harness is forbidden; set AgentProfile.harness',
    )
  }
  const profile = executableAgentProfileSnapshot(options.profile, 'createInPlaceCliExecutor')
  const harness = localHarnessFromProfile(profile)
  if (
    options.taskPrompt !== undefined &&
    (typeof options.taskPrompt !== 'string' || options.taskPrompt.length === 0)
  ) {
    throw new ValidationError('createInPlaceCliExecutor: taskPrompt required')
  }

  const executionId = randomUUID()
  const attemptId = options.executionAttemptId ?? newExecutionAttemptId(executionId)
  const controller = new AbortController()

  let artifact: ExecutorResult<InPlaceHarnessResult> | undefined

  const profilePlan = worktreeProfileExecutionPlan(profile, harness)
  const profileModel = concreteProfileModel(profile)
  if (!profileModel) {
    throw new ValidationError('createInPlaceCliExecutor: exact profile model unexpectedly missing')
  }
  return attestRuntimeOwnedExecutor(
    {
      runtime: 'cli',
      budgetExempt: true,
      async execute(task, signal): Promise<ExecutorResult<InPlaceHarnessResult>> {
        const linked = linkAbort(signal, controller.signal).signal
        const started = Date.now()
        const taskPrompt = executionTaskPrompt(task, options.taskPrompt)

        const result = await runInPlaceHarness({
          workspacePath: options.workspacePath,
          profile,
          harness,
          taskPrompt,
          ...(options.harnessTimeoutMs !== undefined
            ? { harnessTimeoutMs: options.harnessTimeoutMs }
            : {}),
          ...(linked ? { signal: linked } : {}),
          ...(options.runHarness ? { runHarness: options.runHarness } : {}),
        })

        // No usage receipt exists for a harness CLI run, so its `{0,0}` is a FLOOR, not a
        // measurement. Left unmarked it is byte-identical to a run that truly cost nothing, and a
        // token-priced ceiling over this leaf then reads as enforced while enforcing nothing.
        // `tokensKnown` is the marker; the dollar channel is left alone because `usdKnown: false`
        // under a dollar-capped root is a reconcile REFUSAL in `budget.ts`, which would contradict
        // the exemption this leaf was granted.
        const spent: Spend = {
          iterations: 1,
          tokens: { input: 0, output: 0 },
          tokensKnown: false,
          usd: 0,
          ms: Date.now() - started,
        }
        artifact = { outRef: contentAddress(result), out: result, spent }
        return artifact
      },
      async teardown(_grace): Promise<{ destroyed: boolean }> {
        // The workspace belongs to the caller: teardown stops this leaf's own work and leaves the
        // directory exactly as the harness left it.
        controller.abort()
        return { destroyed: true }
      },
      resultArtifact() {
        if (!artifact) {
          throw new ValidationError(
            'createInPlaceCliExecutor: resultArtifact() read before execute() resolved',
          )
        }
        return artifact
      },
    },
    {
      effectiveProfile: profile,
      backend: `cli-in-place:${harness}`,
      model: { status: 'known', id: profileModel },
      execution: { kind: 'in-place-run', id: executionId },
      materializer: 'agent-profile-worktree-plan',
      plan: {
        kind: 'cli-in-place',
        profilePlan,
        harness,
        harnessTimeoutMs: options.harnessTimeoutMs ?? null,
      },
    },
    {
      attemptId,
      binding: {
        workspacePath: options.workspacePath,
        executionId,
        harness,
        model: profileModel,
      },
      descriptor: {
        kind: 'in-place-cli-run',
        transport: 'process',
        backend: harness,
      },
    },
  )
}

function localHarnessFromProfile(profile: AgentProfile): LocalHarness {
  const harness = profile.harness
  if (LOCAL_HARNESSES.includes(harness as LocalHarness)) return harness as LocalHarness
  throw new ValidationError(
    `createInPlaceCliExecutor: AgentProfile.harness must select ${LOCAL_HARNESSES.join(', ')}`,
  )
}

/** A scoped execution task is authoritative. The configured prompt remains the unambiguous
 *  direct-call default for `execute(undefined, signal)` consumers. */
function executionTaskPrompt(task: unknown, configuredPrompt: string | undefined): string {
  if (task === undefined) {
    if (configuredPrompt !== undefined) return configuredPrompt
    throw new ValidationError(
      'createInPlaceCliExecutor: execute task required when taskPrompt is not configured',
    )
  }
  const prompt = taskToPrompt(task)
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new ValidationError('createInPlaceCliExecutor: execute task produced no prompt text')
  }
  return prompt
}
