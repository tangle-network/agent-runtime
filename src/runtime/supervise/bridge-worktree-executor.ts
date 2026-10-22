import { randomUUID } from 'node:crypto'
import { agentProfileSchema } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import {
  captureWorktreeDiff,
  createWorktree,
  removeWorktree,
  type WorktreeHandle,
} from '../../mcp/worktree'
import { runWorktreeChecks, type WorktreeHarnessResult } from '../../mcp/worktree-harness'
import { isAsyncIterable } from '../util'
import { linkAbort } from './abortable'
import { type BridgeSeam, bridgeSeamKey } from './bridge-config'
import { bridgeExecutor, bridgeProfileModel } from './bridge-executor'
import { contentRef } from './executor-outcome'
import {
  attestRuntimeOwnedPendingExecutor,
  finalizeRuntimeOwnedPendingExecutor,
  newExecutionAttemptId,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
} from './materialization'
import type { CliWorktreeSeam } from './runtime-seams'
import type {
  AgentSpec,
  Executor,
  ExecutorContext,
  ExecutorResult,
  Runtime,
  Spend,
  UsageEvent,
} from './types'

export function bridgeWorktreeExecutor(
  spec: AgentSpec,
  ctx: ExecutorContext,
  seam: CliWorktreeSeam,
): Executor<WorktreeHarnessResult> {
  const bridge = seam.bridge
  if (!bridge) {
    throw new ValidationError('cliWorktreeExecutor: bridge transport missing')
  }
  if (!bridge.bridgeUrl || !bridge.bridgeBearer) {
    throw new ValidationError(
      'cliWorktreeExecutor: bridge.bridgeUrl + bridge.bridgeBearer required',
    )
  }

  const runId = seam.runId ?? randomUUID()
  const sessionId = bridge.sessionId ?? `bridge-worktree-${runId}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(runId)
  const effectiveProfile = agentProfileSchema.parse(spec.profile)
  const model = bridgeProfileModel(effectiveProfile, 'cliWorktreeExecutor bridge')
  const controller = new AbortController()
  const pending: unknown[] = []
  let inner: Executor<unknown> | undefined
  let worktree: WorktreeHandle | undefined
  let removed = false
  let artifact: ExecutorResult<WorktreeHarnessResult> | undefined

  const cleanupWorktree = async (): Promise<void> => {
    if (!worktree || removed) return
    const target = worktree
    removed = true
    worktree = undefined
    await removeWorktree({
      worktree: target,
      repoRoot: seam.repoRoot,
      ...(seam.runGit ? { runGit: seam.runGit } : {}),
    }).catch(() => undefined)
  }

  const deliver = (msg: unknown): void => {
    if (inner?.deliver) {
      inner.deliver(msg)
      return
    }
    pending.push(msg)
  }

  const plannedDeclaration = {
    effectiveProfile,
    backend: 'bridge-worktree',
    model: { status: 'known' as const, id: model },
    execution: { kind: 'worktree-session', id: `${runId}:${sessionId}` },
    materializer: 'bridge-worktree-agent-profile',
    plan: {
      kind: 'bridge-worktree-session',
      runId,
      sessionId,
      baseRef: seam.baseRef ?? 'HEAD',
      model,
      testCmd: seam.testCmd ?? null,
      typecheckCmd: seam.typecheckCmd ?? null,
      checkTimeoutMs:
        seam.checkTimeoutMs ?? seam.harnessTimeoutMs ?? bridge.timeoutMs ?? 5 * 60 * 1000,
      checkOutputCap: seam.checkOutputCap ?? 16_000,
      bridgeAcknowledgement: null,
    },
  }
  const plannedBinding = {
    attemptId,
    binding: {
      bridgeUrl: bridge.bridgeUrl,
      effectiveProfile,
      model,
      repoRoot: seam.repoRoot,
      runId,
      sessionId,
    },
    descriptor: {
      kind: 'bridge-worktree-session',
      transport: 'http',
      backend: 'bridge-worktree',
    },
  }
  let executor!: Executor<WorktreeHarnessResult>
  executor = {
    runtime: 'cli' as Runtime,
    budgetExempt: seam.budgetExempt ?? false,
    deliver,
    execute(task, signal): AsyncIterable<UsageEvent> {
      return (async function* bridgeWorktreeStream() {
        const started = Date.now()
        const linked = linkAbort(signal, controller.signal).signal
        let bridgeArtifact: ExecutorResult<unknown> | undefined

        try {
          worktree = await createWorktree({
            repoRoot: seam.repoRoot,
            runId,
            ...(seam.baseRef ? { baseRef: seam.baseRef } : {}),
            ...(seam.runGit ? { runGit: seam.runGit } : {}),
          })
          removed = false

          const bridgeSeam: BridgeSeam = {
            bridgeUrl: bridge.bridgeUrl,
            bridgeBearer: bridge.bridgeBearer,
            cwd: worktree.path,
            sessionId,
            ...(bridge.timeoutMs !== undefined ? { timeoutMs: bridge.timeoutMs } : {}),
            ...(bridge.maxReconnects !== undefined ? { maxReconnects: bridge.maxReconnects } : {}),
          }
          const bridgeCtx: ExecutorContext = {
            ...ctx,
            signal: linked,
            seams: { ...ctx.seams, [bridgeSeamKey]: bridgeSeam },
          }
          inner = bridgeExecutor(spec, bridgeCtx)
          for (const msg of pending.splice(0)) inner.deliver?.(msg)

          const run = inner.execute(task, linked)
          if (isAsyncIterable<UsageEvent>(run)) {
            for await (const event of run) yield event
            bridgeArtifact = inner.resultArtifact()
          } else {
            bridgeArtifact = await run
          }

          const bridgeDeclaration = runtimeOwnedExecutorMaterialization(inner)
          const bridgeBinding = runtimeOwnedExecutorExecutionBinding(inner)
          if (bridgeDeclaration === undefined || bridgeBinding === undefined) {
            throw new ValidationError(
              'cliWorktreeExecutor: bridge completed without a terminal materialization acknowledgement',
            )
          }
          finalizeRuntimeOwnedPendingExecutor(
            executor,
            {
              ...plannedDeclaration,
              plan: {
                ...plannedDeclaration.plan,
                bridgeAcknowledgement: bridgeDeclaration.plan,
              },
            },
            {
              ...plannedBinding,
              binding: {
                ...plannedBinding.binding,
                worktreePath: worktree.path,
                bridgeBinding: bridgeBinding.binding,
              },
            },
          )

          const diff = await captureWorktreeDiff({
            worktree,
            ...(seam.runGit ? { runGit: seam.runGit } : {}),
          })
          const checks = await runWorktreeChecks({
            worktreePath: worktree.path,
            ...(seam.testCmd !== undefined ? { testCmd: seam.testCmd } : {}),
            ...(seam.typecheckCmd !== undefined ? { typecheckCmd: seam.typecheckCmd } : {}),
            timeoutMs:
              seam.checkTimeoutMs ?? seam.harnessTimeoutMs ?? bridge.timeoutMs ?? 5 * 60 * 1000,
            cap: seam.checkOutputCap ?? 16_000,
            ...(seam.runCommand ? { runCommand: seam.runCommand } : {}),
            signal: linked,
          })

          const result: WorktreeHarnessResult = {
            branch: worktree.branch,
            patch: diff.patch,
            stats: diff.stats,
            harness: {
              name: 'bridge',
              exitCode: null,
              timedOut: false,
              killedBySignal: null,
              durationMs: bridgeArtifact.spent.ms || Date.now() - started,
              stdout: bridgeOutputText(bridgeArtifact.out),
              stderr: '',
            },
            ...(checks ? { checks } : {}),
          }
          const spent: Spend = {
            ...bridgeArtifact.spent,
            ms: bridgeArtifact.spent.ms || Date.now() - started,
          }
          artifact = {
            outRef: contentRef('bridge-worktree', { sessionId, result }),
            out: result,
            spent,
          }
        } catch (err) {
          controller.abort()
          await inner?.teardown('brutalKill').catch(() => undefined)
          await cleanupWorktree()
          throw err
        }
      })()
    },
    async teardown(grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      let destroyed = true
      try {
        if (inner) {
          destroyed = (await inner.teardown(grace)).destroyed
        }
      } finally {
        await cleanupWorktree()
      }
      return { destroyed }
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError(
          'cliWorktreeExecutor: bridge resultArtifact() read before stream drained',
        )
      }
      return artifact
    },
  }
  return attestRuntimeOwnedPendingExecutor(executor, 'cli', plannedDeclaration, plannedBinding)
}

function bridgeOutputText(out: unknown): string {
  if (typeof out === 'string') return out
  if (out && typeof out === 'object') {
    const content = (out as { content?: unknown }).content
    if (typeof content === 'string') return content
  }
  try {
    return JSON.stringify(out) ?? String(out)
  } catch {
    return String(out)
  }
}

/**
 * The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored
 * `AgentProfile` driving claude / codex / opencode / pi / kimi-code on its own worktree. `budgetExempt` like
 * the other CLI leaves; the authored systemPrompt + model reach the harness via §1.5.
 */
