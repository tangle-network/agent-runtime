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
 * Ordinary CLI output is unmetered. Explicit native-session output captures the qualified native
 * session's reported tokens and preserves incomplete accounting as unknown. The leaf remains
 * `budgetExempt`: a per-completion output ceiling is not a live whole-session budget.
 *
 * @experimental
 */

import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import { LOCAL_HARNESSES, type LocalHarness } from '../../mcp/local-harness-invocation'
import type { runLocalHarness } from '../../mcp/local-harness-process'
import {
  type InPlaceHarnessResult,
  runInPlaceHarness,
  worktreeProfileExecutionPlan,
} from '../../mcp/worktree-harness'
import { observedModelMatchesDeclared } from '../model-identity'
import { unmeteredSpend } from '../util'
import { linkAbort } from './abortable'
import { errMessage } from './error-message'
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
  /** Return a validated OpenCode 2.3.0 native response alongside the execution artifact. */
  outputFormat?: 'native-session'
  /** Variables set (a string) or removed (`undefined`) for this executor's harness process only,
   *  e.g. the account a seat rotation selected (`CODEX_HOME`, `CLAUDE_CODE_OAUTH_TOKEN`).
   *  `process.env` is never mutated, and no value reaches a receipt or the result. */
  env?: Readonly<Record<string, string | undefined>>
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
  if (options.outputFormat !== undefined && options.outputFormat !== 'native-session') {
    throw new ValidationError('createInPlaceCliExecutor: unsupported outputFormat')
  }
  if (options.outputFormat === 'native-session' && harness !== 'opencode') {
    throw new ValidationError(
      'createInPlaceCliExecutor: native-session output requires OpenCode 2.3.0',
    )
  }
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
  let running: Promise<InPlaceHarnessResult> | undefined

  const profilePlan = worktreeProfileExecutionPlan(
    profile,
    harness,
    options.outputFormat === 'native-session',
  )
  const profileModel = concreteProfileModel(profile)
  if (!profileModel) {
    throw new ValidationError('createInPlaceCliExecutor: exact profile model unexpectedly missing')
  }
  return attestRuntimeOwnedExecutor(
    {
      runtime: 'cli',
      budgetExempt: true,
      async execute(task, signal): Promise<ExecutorResult<InPlaceHarnessResult>> {
        const started = Date.now()
        const taskPrompt = executionTaskPrompt(task, options.taskPrompt)

        running = runInPlaceHarness({
          workspacePath: options.workspacePath,
          profile,
          harness,
          taskPrompt,
          ...(options.outputFormat === 'native-session' ? { nativeSession: true } : {}),
          harnessTimeoutMs:
            options.harnessTimeoutMs !== undefined ? options.harnessTimeoutMs : undefined,
          signal: linkAbort(signal, controller.signal).signal,
          ...(options.env ? { env: options.env } : {}),
          ...(options.runHarness ? { runHarness: options.runHarness } : {}),
        })
        const result = await running

        const nativeSession = result.harness.nativeSession
        const nativeUsage = nativeSession?.usage
        const nativeRouteMismatch =
          nativeSession?.nativeModel !== undefined &&
          nativeSession.nativeModel !== null &&
          !observedModelMatchesDeclared(nativeSession.nativeModel, profileModel)
        const spent: Spend = {
          ...unmeteredSpend(Date.now() - started),
          iterations: 1,
          ...(nativeUsage
            ? {
                tokens: {
                  // Unknown totals retain observed class subtotals as lower bounds.
                  input:
                    nativeUsage.input ??
                    (nativeUsage.freshInput ?? 0) +
                      (nativeUsage.cachedInput ?? 0) +
                      (nativeUsage.cacheWriteInput ?? 0),
                  output:
                    nativeUsage.output ??
                    (nativeUsage.visibleOutput ?? 0) + (nativeUsage.reasoningOutput ?? 0),
                  ...(nativeUsage.cachedInput === null
                    ? {}
                    : { cacheRead: nativeUsage.cachedInput }),
                  ...(nativeUsage.cacheWriteInput === null
                    ? {}
                    : { cacheWrite: nativeUsage.cacheWriteInput }),
                },
                tokensKnown: nativeSession.tokensKnown,
              }
            : {}),
        }
        // A harness that exited nonzero, timed out or was cancelled did not do the work, even when
        // it wrote nothing wrong: report it in the executor envelope so the node settles down
        // instead of done, and no flow counts it a winner (a 1 s acct refusal settled `done`).
        const exit = result.harness
        const failed =
          exit.exitCode !== 0 ||
          exit.timedOut ||
          nativeRouteMismatch ||
          (options.outputFormat === 'native-session' && nativeSession?.status !== 'completed')
        const output = nativeSession
          ? {
              ...result,
              nativeSession,
              content: nativeSession.finalText,
              ...(nativeSession.finishReason ? { finishReason: nativeSession.finishReason } : {}),
              ...(nativeUsage
                ? {
                    ...(nativeUsage.reasoningOutput === null
                      ? {}
                      : { reasoningTokens: nativeUsage.reasoningOutput }),
                    ...(nativeUsage.cachedInput === null && nativeUsage.cacheWriteInput === null
                      ? {}
                      : {
                          promptCache: {
                            ...(nativeUsage.cachedInput === null
                              ? {}
                              : { readTokens: nativeUsage.cachedInput }),
                            ...(nativeUsage.cacheWriteInput === null
                              ? {}
                              : { writeTokens: nativeUsage.cacheWriteInput }),
                          },
                        }),
                  }
                : {}),
            }
          : result
        artifact = {
          outRef: contentAddress(output),
          out: output,
          spent,
          ...(failed
            ? {
                outcome: {
                  success: false,
                  error: nativeRouteMismatch
                    ? `OpenCode native route ${nativeSession?.nativeModel} differs from profile ${profileModel}`
                    : (nativeSession?.error ??
                      `${harness} exited ${exit.exitCode ?? exit.killedBySignal}${exit.timedOut ? ' after its timeout' : ''}: ${exit.stderr.trim().slice(-300)}`),
                },
              }
            : {}),
        }
        return artifact
      },
      teardown(_grace) {
        // Join this leaf's process/profile cleanup; the caller keeps its workspace.
        // A settled rejection stays unconfirmed and cannot change on retry, including
        // a caller-cancel rejection after physical closure. Never turn it into destruction.
        controller.abort()
        return Promise.resolve(running)
          .then(() => ({ destroyed: true }))
          .catch((error) => ({ destroyed: false, permanent: true, detail: errMessage(error) }))
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
        outputFormat: options.outputFormat ?? null,
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
