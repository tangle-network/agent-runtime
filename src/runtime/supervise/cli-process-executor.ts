import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { ValidationError } from '../../errors'
import { mergeTraceEnv } from '../../mcp/trace-propagation'
import { unmeteredSpend } from '../util'
import { linkAbort } from './abortable'
import { armDeadlineTimer } from './deadline'
import { contentRef } from './executor-outcome'
import { readSeam } from './executor-seams'
import { attestRuntimeOwnedExecutor, newExecutionAttemptId } from './materialization'
import { type CliSeam, cliSeamKey } from './runtime-seams'
import { taskToPrompt } from './task-prompt'
import type { ExecutorFactory, ExecutorResult, Runtime, UsageEvent } from './types'
import { workerLineage } from './worker-lineage'
import { workerTraceEnv } from './worker-trace'

/**
 * Spawns a subprocess (`bin` + `args`). It cannot account tokens, so it is
 * `budgetExempt: true`: it remains usable as a direct executor, while budgeted supervision
 * refuses it before process execution because the CLI exposes no usage receipt. teardown is SIGTERM → SIGKILL
 * with a grace window. Streaming: yields one `iteration` event on clean exit.
 *
 * Its terminal spend is `unmeteredSpend`, NOT a zero: an unmetered runtime that reports a plain
 * `0` is indistinguishable from one that measured zero, and every ceiling downstream then reads
 * as enforced while enforcing nothing.
 */
export const cliExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<CliSeam>(ctx, cliSeamKey, 'cli')
  if (!seam.bin) throw new ValidationError('cliExecutor: CliSeam.bin required')
  // `TRACE_ID` / `PARENT_SPAN_ID` for this worker when the run records spans; `{}` otherwise.
  // Session lineage (`TANGLE_*`) joins it when this process carries a `TANGLE_RUN_ID`.
  const traceEnv = {
    ...workerLineage({
      harness: seam.bin,
      nodeId: ctx.node?.nodeId,
      label: spec.profile.name,
      local: true,
    }).env,
    ...workerTraceEnv(ctx),
  }

  const controller = linkAbort(ctx.signal)

  let proc: ReturnType<typeof spawn> | undefined
  let artifact: ExecutorResult<unknown> | undefined
  const executionId = ctx.node?.nodeId ?? `cli-process-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)

  return attestRuntimeOwnedExecutor(
    {
      runtime: 'cli' as Runtime,
      budgetExempt: true,
      execute(task, signal): AsyncIterable<UsageEvent> {
        return streamCliLeaf({
          task,
          signal,
          traceEnv,
          seam,
          controller,
          onProc: (p) => {
            proc = p
          },
          onArtifact: (a) => {
            artifact = a
          },
        })
      },
      async teardown(grace): Promise<{ destroyed: boolean }> {
        if (!proc) {
          controller.abort()
          return { destroyed: true }
        }
        // Aborting first would invoke the stream's emergency SIGKILL and discard graceful output.
        const receipt = await killWithGrace(proc, grace)
        controller.abort()
        return receipt
      },
      resultArtifact() {
        if (!artifact) {
          throw new ValidationError('cliExecutor: resultArtifact() read before stream drained')
        }
        return artifact
      },
    },
    {
      effectiveProfile: spec.profile,
      backend: 'cli',
      model: { status: 'unknown', reason: 'raw subprocess has no model identity contract' },
      execution: { kind: 'process-attempt', id: executionId },
      materializer: 'raw-cli-stdin',
      plan: {
        kind: 'raw-cli-process',
        bin: seam.bin,
        args: seam.args ?? [],
        cwd: seam.cwd ?? null,
        envOverrides: seam.env ?? {},
        ambientEnvironment: 'inherited',
      },
    },
    {
      attemptId,
      binding: {
        executionId,
        bin: seam.bin,
        cwd: seam.cwd ?? null,
      },
      descriptor: { kind: 'cli-process', transport: 'process', backend: 'cli' },
    },
  )
}

interface StreamCliArgs {
  task: unknown
  signal: AbortSignal
  seam: CliSeam
  /** Inherited `TRACE_ID` / `PARENT_SPAN_ID` for the subprocess; empty when tracing is off. */
  traceEnv: Record<string, string>
  controller: AbortController
  onProc: (p: ReturnType<typeof spawn>) => void
  onArtifact: (a: ExecutorResult<unknown>) => void
}

async function* streamCliLeaf(args: StreamCliArgs): AsyncIterable<UsageEvent> {
  const started = Date.now()
  const prompt = taskToPrompt(args.task)
  const proc = spawn(args.seam.bin, args.seam.args ?? [], {
    ...(args.seam.cwd ? { cwd: args.seam.cwd } : {}),
    // Trace context above ambient `process.env` (whose ids describe the SUPERVISOR's place in an
    // outer trace, not this child's) and below `seam.env` (a deliberate operator declaration).
    // `mergeTraceEnv`, not a plain spread: a seam that overrides the legacy pair without its own
    // `TRACEPARENT` gets the W3C wire rebuilt from ITS ids, never left as the recorder's.
    env: mergeTraceEnv(process.env, args.traceEnv, args.seam.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  args.onProc(proc)

  const onAbort = () => killWithGrace(proc, 'brutalKill')
  if (args.signal.aborted || args.controller.signal.aborted) onAbort()
  else {
    args.signal.addEventListener('abort', onAbort, { once: true })
    args.controller.signal.addEventListener('abort', onAbort, { once: true })
  }

  // Feed the task on stdin; the subprocess owns its own tool/agent loop.
  //
  // A child that exits, or closes its stdin, before reading the task leaves this write against a
  // pipe with no reader, and the kernel answers with EPIPE. Node raises that as an `'error'` on
  // the stream, and a Writable with no listener turns it into an uncaught exception: one took down
  // a full serialized kernel run on 2026-09-11 after every test in it had passed. A closed read end
  // is not this leaf's failure — the child's exit code, read below, is the verdict. Any other
  // delivery error is, and fails the leaf once the process has been reaped.
  let deliveryError: Error | undefined
  if (proc.stdin) {
    proc.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') deliveryError ??= error
    })
    proc.stdin.write(prompt)
    proc.stdin.end()
  }
  const chunks: string[] = []
  const errChunks: string[] = []
  if (proc.stdout) proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString('utf8')))
  if (proc.stderr) proc.stderr.on('data', (d: Buffer) => errChunks.push(d.toString('utf8')))

  const exit = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
    proc.once('error', (err) => resolve({ code: null, error: err }))
    proc.once('close', (code) => resolve({ code }))
  })
  args.signal.removeEventListener('abort', onAbort)
  args.controller.signal.removeEventListener('abort', onAbort)

  if (exit.error) {
    throw new ValidationError(`cliExecutor: spawn failed: ${exit.error.message}`, {
      cause: exit.error,
    })
  }
  if (exit.code !== 0) {
    throw new ValidationError(
      `cliExecutor: ${args.seam.bin} exited ${exit.code}: ${errChunks.join('').slice(0, 200)}`,
    )
  }
  if (deliveryError) {
    throw new ValidationError(
      `cliExecutor: could not deliver the task to ${args.seam.bin}: ${deliveryError.message}`,
      { cause: deliveryError },
    )
  }
  const out = { content: chunks.join('') } as unknown
  // A raw subprocess exposes no usage receipt, so its spend is UNKNOWN — not zero. Wall-clock is
  // the one thing this runtime did measure, so that is the one field reported as measured.
  args.onArtifact({
    outRef: contentRef('cli', out),
    out,
    spent: unmeteredSpend(Date.now() - started),
  })
  yield { kind: 'iteration' }
}

/** SIGTERM, then SIGKILL after `grace` ms (`'brutalKill'` = immediate SIGKILL,
 *  `'infinity'` = await clean exit, never escalate). */
function killWithGrace(
  proc: ReturnType<typeof spawn>,
  grace: number | 'brutalKill' | 'infinity',
): Promise<{ destroyed: boolean }> {
  // `killed` acknowledges sending a signal, not termination. A failed spawn has no process id.
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve({ destroyed: true })
  }
  return new Promise((resolve) => {
    let clearTimer: (() => void) | undefined
    proc.once('close', () => {
      clearTimer?.()
      resolve({ destroyed: true })
    })
    if (grace === 'brutalKill') {
      proc.kill('SIGKILL')
      return
    }
    proc.kill('SIGTERM')
    if (grace === 'infinity') return
    clearTimer = armDeadlineTimer(
      grace,
      () => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
      },
      true,
    )
  })
}
