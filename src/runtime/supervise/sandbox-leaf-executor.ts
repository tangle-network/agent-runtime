import { randomUUID } from 'node:crypto'
import type { BackendType, SandboxEvent } from '@tangle-network/sandbox'
import { ValidationError } from '../../errors'
import { type RunAgentRoundsOptions, runAgentRounds } from '../agent-rounds'
import {
  type SandboxLeafOut,
  type SandboxOutputMarker,
  sandboxLeafOutputFromEvents,
} from '../sandbox-executor-output'
import type { AgentRunSpec, Driver, ExecCtx, Iteration, OutputAdapter, Validator } from '../types'
import { cloneTokenUsage, roundBoxMinutes } from '../util'
import { linkAbort } from './abortable'
import { localAbortCancellation } from './executor-local-cancellation'
import { contentRef } from './executor-outcome'
import { readSeam } from './executor-seams'
import { createInbox, failPendingAfter } from './inbox'
import { attestRuntimeOwnedExecutor, newExecutionAttemptId } from './materialization'
import {
  concreteProfileModel,
  enforceTokenLimits,
  profileModelExecutionSettings,
} from './model-policy'
import type { ExecutorProgress } from './progress'
import { type SandboxSeam, sandboxCaptureOutputSeamKey, sandboxSeamKey } from './runtime-seams'
import { createSteerableSandboxSession } from './sandbox-session'
import { taskToPrompt } from './task-prompt'
import type { TraceSource } from './trace-source'
import type {
  AgentSpec,
  DefaultVerdict,
  Executor,
  ExecutorCancellation,
  ExecutorContext,
  ExecutorFactory,
  ExecutorResult,
  Runtime,
  Spend,
  UsageEvent,
} from './types'
import { workerLineage } from './worker-lineage'
import { workerTraceEnv } from './worker-trace'

/**
 * COMPOSES `runAgentRounds` as a single-task leaf: one box, a refine driver bounded to
 * the seam's `maxIterations` (default 1), the spec's profile as the agent run.
 * Surfaces the loop's aggregated `tokenUsage` + `costUsd` as `UsageEvent`s after
 * it drains, and yields one `iteration` event per loop iteration. Forwards the
 * optional `lineage` passthrough WITHOUT importing sandbox-lineage / reinventing
 * checkpoint/fork.
 *
 * Streaming shape: the loop runs to completion inside the first `next()`, then
 * the recorded usage events are yielded; the terminal artifact is read from
 * `resultArtifact()` after the stream drains.
 */
export const sandboxExecutor: ExecutorFactory<unknown> = (spec, ctx) =>
  sandboxExecutorForPath(spec, ctx, 'sandbox')

// The provider adapter preserves credential intent; a direct sandbox client cannot enforce it.
export function sandboxExecutorForPath(
  spec: AgentSpec,
  ctx: ExecutorContext,
  modelPath: 'sandbox' | 'provider',
): Executor<unknown> {
  if (spec.harness === null) {
    throw new ValidationError('sandboxExecutor: harness is null (router/inline) — wrong executor')
  }
  const harness = spec.harness as BackendType
  const seam = readSeam<SandboxSeam>(ctx, sandboxSeamKey, 'sandbox')
  if (!seam.sandboxClient || typeof seam.sandboxClient.create !== 'function') {
    throw new ValidationError('sandboxExecutor: SandboxSeam.sandboxClient.create required')
  }
  const maxIterations = seam.maxIterations ?? 1
  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    throw new ValidationError('sandboxExecutor: maxIterations must be > 0')
  }
  // The harness owns its own model calls inside the box and the Sandbox API exposes no completion
  // cap, so a requested ceiling is refused here rather than dropped on the way to a paid run.
  const sandboxTokenLimits = enforceTokenLimits(
    profileModelExecutionSettings(spec.profile, 'sandboxExecutor', modelPath).tokenLimits,
    'sandbox',
    'sandboxExecutor',
  )
  // The cross-MACHINE case this exists for: the box gets `TRACE_ID` / `PARENT_SPAN_ID` through
  // `CreateSandboxOptions.env`, so whatever the remote worker emits lands in this run's trace under
  // the spawning node's span. Empty when the run records no spans, and an empty record adds no
  // `env` key to the create options at all. Session lineage rides the same env when this process
  // was launched with a `TANGLE_RUN_ID` (see `worker-lineage.ts`); the box's host is not ours.
  const traceEnv = {
    ...workerLineage({
      harness,
      nodeId: ctx.node?.nodeId,
      label: spec.profile.name,
      local: false,
    }).env,
    ...workerTraceEnv(ctx),
  }

  const controller = linkAbort(ctx.signal)

  let artifact: ExecutorResult<unknown> | undefined
  const executionId = ctx.node?.nodeId ?? `sandbox-run-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)
  const profileModel = concreteProfileModel(spec.profile)
  const sandboxMaterialization = {
    effectiveProfile: spec.profile,
    backend: harness,
    model: profileModel
      ? ({ status: 'known', id: profileModel } as const)
      : ({ status: 'unknown', reason: 'sandbox harness selected its default model' } as const),
    execution: {
      kind: 'run',
      id: executionId,
    },
    materializer: 'sandbox-agent-profile',
    plan: {
      kind: 'sandbox-agent-rounds',
      harness,
      maxIterations,
      steering: seam.steering !== undefined,
      tokenLimits: sandboxTokenLimits,
    },
  }
  const sandboxBinding = {
    attemptId,
    binding: {
      executionId,
      harness,
      model: profileModel ?? null,
    },
    descriptor: { kind: 'sandbox-run', transport: 'sandbox', backend: harness },
  }

  // STEERABLE mode (opt-in): the worker becomes a multi-turn session on one box, with a real
  // inbox, so a driver's steer has a turn boundary to be folded into. This is the path that
  // makes `Scope.send` return `true` for the DEFAULT cloud worker.
  if (seam.steering) {
    if (seam.validator) {
      throw new ValidationError(
        'sandboxExecutor: validator is not representable with steering — the steerable session is not a runAgentRounds composition, so the score would be silently dropped',
      )
    }
    const inbox = createInbox()
    const session = createSteerableSandboxSession({
      controller,
      profile: spec.profile,
      harness,
      sandboxClient: seam.sandboxClient,
      failOnDestroyError: seam.failOnDestroyError,
      workspaceCaptures: seam.workspaceCaptures,
      inbox,
      taskToPrompt: (t) => taskToPrompt(t),
      options: seam.steering,
      ...(seam.loopCtx ? { loopCtx: seam.loopCtx } : {}),
      ...(Object.keys(traceEnv).length > 0 ? { traceEnv } : {}),
      contentRef,
    })
    const bindCaptureOutput = ctx.seams[sandboxCaptureOutputSeamKey]
    if (typeof bindCaptureOutput === 'function') bindCaptureOutput(() => session.output())
    return attestRuntimeOwnedExecutor(
      {
        runtime: 'sandbox' as Runtime,
        deliver: (m) => inbox.deliver(m),
        progress: (): ExecutorProgress => session.progress(),
        cancel: (request): Promise<ExecutorCancellation> => session.cancel(request),
        traceSource: (): TraceSource => session.traceSource(),
        execute(task, signal): AsyncIterable<UsageEvent> {
          return failPendingAfter(inbox, session.stream(task, signal))
        },
        async teardown(_grace): Promise<{ destroyed: boolean }> {
          controller.abort()
          await session.teardown()
          return { destroyed: true }
        },
        resultArtifact() {
          const a = session.artifact()
          if (!a) {
            throw new ValidationError(
              'sandboxExecutor(steering): resultArtifact() read before stream drained',
            )
          }
          return a
        },
      },
      sandboxMaterialization,
      sandboxBinding,
    )
  }

  // The leaf runs an opaque, self-parallelizing coding harness. Runtime keeps
  // its complete event archive and projects the visible answer and tool calls.
  const output: OutputAdapter<SandboxLeafOut> = {
    parse(events: SandboxEvent[]): SandboxLeafOut {
      return sandboxLeafOutputFromEvents(events)
    },
  }
  const driver = singleShotDriver<SandboxLeafOut>(maxIterations)

  return attestRuntimeOwnedExecutor(
    {
      runtime: 'sandbox' as Runtime,
      execute(task, signal): AsyncIterable<UsageEvent> {
        return streamSandboxLeaf({
          task,
          signal,
          harness,
          spec,
          seam,
          output,
          driver,
          maxIterations,
          controller,
          loopCtx: seam.loopCtx,
          ...(seam.validator ? { validator: seam.validator } : {}),
          traceEnv,
          onArtifact: (a) => {
            artifact = a
          },
        })
      },
      cancel(_request): Promise<ExecutorCancellation> {
        controller.abort('executor cancelled')
        return Promise.resolve(
          localAbortCancellation(
            'the composed sandbox run owns its boxes, so this executor retains no exact session control reference to cancel against',
          ),
        )
      },
      teardown(_grace): Promise<{ destroyed: boolean }> {
        // The composed runAgentRounds owns its box teardown (finally{allSettled(destroy)});
        // aborting the loop's signal cascades into that barrier.
        controller.abort()
        return Promise.resolve({ destroyed: true })
      },
      resultArtifact() {
        if (!artifact) {
          throw new ValidationError('sandboxExecutor: resultArtifact() read before stream drained')
        }
        return artifact
      },
    },
    sandboxMaterialization,
    sandboxBinding,
  )
}

interface StreamSandboxArgs {
  task: unknown
  signal: AbortSignal
  harness: BackendType
  spec: AgentSpec
  seam: SandboxSeam
  output: OutputAdapter<SandboxLeafOut>
  driver: Driver<unknown, SandboxLeafOut, string>
  maxIterations: number
  controller: AbortController
  /** Forwarded to the composed loop, which scores each iteration against its LIVE box. */
  validator?: Validator<SandboxLeafOut>
  loopCtx?: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>
  /** Inherited `TRACE_ID` / `PARENT_SPAN_ID` for the box; empty when tracing is off. */
  traceEnv: Record<string, string>
  onArtifact: (a: ExecutorResult<unknown>) => void
}

async function* streamSandboxLeaf(args: StreamSandboxArgs): AsyncIterable<UsageEvent> {
  const linked = linkAbort(args.signal, args.controller.signal)

  const agentRun: AgentRunSpec<unknown> = {
    profile: args.spec.profile,
    taskToPrompt: (t) => taskToPrompt(t),
    name: args.spec.profile.name ?? args.harness,
    sandboxOverrides: {
      backend: { type: args.harness },
      // Absent entirely when tracing is off, so the create options are byte-identical to before.
      ...(Object.keys(args.traceEnv).length > 0 ? { env: args.traceEnv } : {}),
    },
  }
  const started = Date.now()

  // `lineage` is a PR #150 RunAgentRoundsOptions field absent on this branch — forwarded
  // forward-compatibly without coupling to its (not-yet-present) static type.
  const loopOptions = {
    driver: args.driver,
    agentRun,
    output: args.output,
    ...(args.validator ? { validator: args.validator } : {}),
    task: args.task,
    maxIterations: args.maxIterations,
    maxConcurrency: 1,
    ctx: {
      ...(args.loopCtx ?? {}),
      sandboxClient: args.seam.sandboxClient,
      signal: linked.signal,
    } as ExecCtx,
    ...(args.seam.lineage !== undefined ? { lineage: args.seam.lineage } : {}),
  } as RunAgentRoundsOptions<unknown, SandboxLeafOut, string>

  try {
    const result = await runAgentRounds(loopOptions)
    // Fail loud on a round that produced nothing: the worker settles `down`
    // carrying the loop's own reason (a rejected profile, a box that would not
    // provision) rather than an artifact it never produced.
    const failure = failedRound(result)
    if (failure) throw failure
    const winningIteration = result.winner
      ? result.iterations.find((iteration) => iteration.index === result.winner?.iterationIndex)
      : result.iterations.at(-1)
    const out =
      winningIteration?.output ?? sandboxLeafOutputFromEvents(winningIteration?.events ?? [])
    const sandboxOutcome = winningIteration?.sandboxOutcome
    const outWithOutcome: SandboxLeafOut = {
      ...out,
      ...(sandboxOutcome ? { outcome: sandboxOutcome } : {}),
    }
    const verdict =
      sandboxOutcome && !sandboxOutcome.success
        ? { valid: false, score: 0 }
        : (result.winner?.verdict ?? leafVerdict(result))
    const tokensKnown = result.tokenUsage.tokensKnown !== false
    const usdKnown = result.costUsdKnown !== false
    // The dollars no billing receipt proves are a price rather than a charge. Naming them on the
    // estimate channel is what keeps `usd - usdEstimated` reading as billed money: without it a
    // cloud child's whole figure read as provider spend and a pursuit report was 40x the money
    // that had actually moved (#1175).
    //
    // The amount comes from the loop's PER-CALL sum, never from `costUsdKnown`: that flag is an
    // AND across every call and iteration, so a settlement mixing a receipted turn with an
    // unproven one would price the receipted dollars too and report $0 billed against money a
    // provider really did charge. Clamped by `costUsd` because the estimate is a part OF the
    // total, which is the pool's own rule (`assertValidSpend`). `usdKnown` is untouched — an
    // unproven number never becomes a receipt, and a dollar cap still refuses it.
    const unprovenUsd = Math.min(result.unprovenCostUsd ?? 0, result.costUsd)
    const usdEstimated = unprovenUsd > 0 ? unprovenUsd : undefined
    const outWithUsage = {
      ...outWithOutcome,
      ...(result.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: result.estimatedCostUsd }
        : {}),
      ...(result.promptCache ? { promptCache: result.promptCache } : {}),
    }
    // The platform channel. A sandbox worker on a subscription seat pays no marginal dollar per
    // model call, so box wall time is the only real resource it consumes — and until this channel
    // existed the run reported `$0` with nothing beside it. The number is DERIVED from the box
    // lifetime this loop watched, never a platform receipt, so it rides as `'estimated'` and the
    // conserved budget pool never reserves against it (`budget.ts`). A run whose boxes could not
    // be paired says `'uncaptured'` and carries no number: a missing measurement is not a zero.
    const boxMinutes =
      result.boxLiveMs === undefined ? undefined : roundBoxMinutes(result.boxLiveMs / 60_000)
    const spent: Spend = {
      iterations: result.iterations.length,
      tokens: cloneTokenUsage(result.tokenUsage),
      ...(tokensKnown ? {} : { tokensKnown: false }),
      usd: result.costUsd,
      ...(usdKnown ? {} : { usdKnown: false }),
      ...(usdEstimated === undefined ? {} : { usdEstimated }),
      ms: Date.now() - started,
      ...(boxMinutes === undefined
        ? { boxMinutesKnown: false, boxMinutesProvenance: 'uncaptured' as const }
        : {
            boxMinutes,
            boxMinutesKnown: result.boxLiveMsKnown !== false,
            boxMinutesProvenance: 'estimated' as const,
          }),
    }
    args.onArtifact({
      outRef: contentRef('sandbox', { harness: args.harness, out: outWithUsage }),
      out: outWithUsage,
      ...(verdict ? { verdict } : {}),
      spent,
    })
    for (let i = 0; i < result.iterations.length; i += 1) yield { kind: 'iteration' }
    if (result.iterations.length > 0 || result.tokenUsage.input || result.tokenUsage.output) {
      yield {
        kind: 'tokens',
        input: result.tokenUsage.input,
        output: result.tokenUsage.output,
        ...(tokensKnown ? {} : { tokensKnown: false }),
        ...(result.tokenUsage.freshInput !== undefined
          ? { freshInput: result.tokenUsage.freshInput }
          : {}),
        ...(result.tokenUsage.cacheRead !== undefined
          ? { cacheRead: result.tokenUsage.cacheRead }
          : {}),
        ...(result.tokenUsage.cacheWrite !== undefined
          ? { cacheWrite: result.tokenUsage.cacheWrite }
          : {}),
        ...(result.tokenUsage.cacheBreakdownKnown === false
          ? { cacheBreakdownKnown: false as const }
          : {}),
      }
    }
    if (result.iterations.length > 0 || result.costUsd) {
      yield usdKnown
        ? { kind: 'cost', usdKnown: true, usd: result.costUsd, provenance: 'provider-receipt' }
        : {
            kind: 'cost',
            usdKnown: false,
            usd: result.costUsd,
            ...(usdEstimated === undefined ? {} : { usdEstimated }),
            provenance: 'uncaptured',
          }
    }
  } finally {
    linked.release()
  }
}

/** The loop's own failure, when NO iteration produced an output: the first error it
 *  recorded, renamed so the settled worker names the leaf it died in. `undefined`
 *  when any iteration produced an output — a partly-failed round still has material
 *  to settle on. */
function failedRound(result: {
  iterations: ReadonlyArray<{ output?: unknown; error?: Error }>
}): Error | undefined {
  if (result.iterations.length === 0) return undefined
  if (result.iterations.some((iteration) => iteration.output !== undefined)) return undefined
  const first = result.iterations.find((iteration) => iteration.error)?.error
  if (!first) return undefined
  return new Error(`sandboxExecutor: agent round failed — ${first.message}`, { cause: first })
}

/**
 * The leaf's OWN verdict, for a round the loop scored no validator against.
 *
 * `settled ⟺ delivered` is written by the completion oracle, and a caller that
 * passes one keeps it: `gateOnDeliverable` wraps this executor and overrides
 * `valid` from its check. This is the sandbox backend's structural answer for a
 * run with no oracle at all — without it nothing ever writes `valid`, no settled
 * child is ever DELIVERED, and the finalizer has nothing to select no matter how
 * well the worker ran. Structural, never self-reported: the round's
 * {@link SandboxOutputMarker} says what the harness produced, and the verdict is
 * that marker.
 *
 * `text` is the only marker that passes. `empty` (a text-bearing terminal event
 * carrying an empty string) and `absent` (no text-bearing event at all) each settle
 * `valid: false` with the marker named in `notes`, because a box that answered
 * nothing is not a worker whose output a finalizer may select. The two stay
 * distinct: `empty` reports a box that ran and said nothing, `absent` reports an
 * answer no reader can confirm was ever produced.
 */
function leafVerdict(result: { winner?: { output?: SandboxLeafOut } }): DefaultVerdict | undefined {
  const output = result.winner?.output
  if (output === undefined) return undefined
  return verdictForOutputMarker(output.output)
}

/** The verdict one {@link SandboxOutputMarker} settles, with the marker named in `notes`. */
function verdictForOutputMarker(marker: SandboxOutputMarker): DefaultVerdict {
  switch (marker.kind) {
    case 'text':
      return { valid: true, score: 1 }
    case 'empty':
      return {
        valid: false,
        score: 0,
        notes:
          'sandbox output marker empty: the round produced a text-bearing terminal event that carried no answer',
      }
    case 'absent':
      return {
        valid: false,
        score: 0,
        notes:
          'sandbox output marker absent: the round produced no text-bearing event, so no answer was observed',
      }
  }
}

function singleShotDriver<Out>(maxIterations: number): Driver<unknown, Out, string> {
  return {
    name: 'leaf',
    plan(task, history): Promise<unknown[]> {
      return Promise.resolve(history.length >= maxIterations ? [] : [task])
    },
    decide(history: ReadonlyArray<Iteration<unknown, Out>>): string {
      return history.length >= maxIterations ? 'stop' : 'continue'
    },
  }
}
