import type { PromptOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { createAgentRunOutcomeTracker } from '@tangle-network/sandbox/runtime'
import { ValidationError } from '../errors'
import type { RuntimeStreamEvent } from '../types'
import { emitTrace } from './iteration-events'
import { mergeUsageMetadata } from './iteration-result'
import {
  createSandboxForSpec,
  describeSandboxPlacement,
  destroySandboxSafe,
  type LineageRoundPlan,
  type LineageState,
} from './iteration-sandboxes'
import { hashJson } from './json-content-hash'
import {
  assertSandboxServedModel,
  createSandboxTurnEventCollector,
  createSandboxUsageLedger,
  notifySandboxEventObserver,
} from './sandbox-events'
import type { SandboxEvidenceTracker } from './sandbox-evidence-retention'
import { promptEvents } from './sandbox-lineage'
import { projectSandboxOutcome } from './sandbox-outcome'
import { concreteProfileModel } from './supervise/model-policy'
import { runTaskQueue } from './task-queue'
import type {
  AgentRunSpec,
  ExecCtx,
  Iteration,
  MountRecorder,
  OutputAdapter,
  Validator,
} from './types'
import {
  addTokenUsage,
  isAbortError,
  promptCacheTokenClasses,
  randomUuid,
  stringifySafe,
  throwAbort,
} from './util'

interface RunBatchArgs<Task, Output> {
  slice: Task[]
  baseIndex: number
  iterations: Iteration<Task, Output>[]
  specs: AgentRunSpec<Task>[]
  output: OutputAdapter<Output>
  validator: Validator<Output> | undefined
  maxConcurrency: number
  signal: AbortSignal
  ctx: ExecCtx
  runId: string
  now: () => number
  /** Plan round these iterations belong to — stamped as `groupId`. */
  roundIndex: number
  /** Iteration this round branched from — stamped as `parentIndex`. */
  parentIndex?: number
  /**
   * Same-sandbox mode: when set, a finished iteration's box is handed here
   * (kept alive for the planner) instead of being torn down. `undefined` =
   * default per-iteration teardown.
   */
  collectBox?: (box: SandboxInstance) => void
  /**
   * Lineage mode: per-offset stream sources for this round. When set, an
   * iteration acquires its sandbox stream through the lineage (continue / fork /
   * fresh) instead of `createSandboxForSpec`, and the lineage — not the
   * iteration — owns box teardown (deferred to loop end).
   */
  lineagePlan?: LineageRoundPlan
  /** The loop's lineage state; iterations record their handle here for the next
   *  round to descend from. Set iff `lineagePlan` is. */
  lineageState?: LineageState
  evidenceTracker?: SandboxEvidenceTracker
  /** Sandbox streaming mode for the default fresh-box path. 'poll' fire-and-
   *  detaches + status-polls the terminal result (drop-resilient for long batch
   *  turns); 'sse' streams live (default). */
  streaming: 'sse' | 'poll'
  /** The run's provenance recorder, forwarded to `prepareBox` on the default
   *  fresh-box path so a mount declares itself into the manifest. (The lineage
   *  path carries its own recorder from `createSandboxLineage`.) */
  recordMount: MountRecorder
  /** Validated `ExecCtx.promptOptions` — forwarded into this round's prompts. */
  promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>
}

export async function runBatch<Task, Output>(args: RunBatchArgs<Task, Output>) {
  const queue = args.slice.map((task, offset) => ({ task, index: args.baseIndex + offset }))
  for await (const settled of runTaskQueue({
    concurrency: Math.max(1, Math.min(Math.ceil(args.maxConcurrency), queue.length)),
    take: () => {
      const item = queue.shift()
      return item === undefined ? undefined : { id: String(item.index), value: item }
    },
    execute: ({ value: item }) => executeIteration({ ...args, item }),
  })) {
    if (settled.status === 'rejected') throw settled.reason
  }
}

interface ExecuteIterationArgs<Task, Output> extends RunBatchArgs<Task, Output> {
  item: { task: Task; index: number }
}

async function executeIteration<Task, Output>(args: ExecuteIterationArgs<Task, Output>) {
  const slot = args.iterations[args.item.index]
  if (!slot)
    throw new ValidationError(`runAgentRounds: missing iteration slot at index ${args.item.index}`)
  const spec = args.specs[args.item.index % args.specs.length]
  if (!spec) throw new ValidationError('runAgentRounds: no AgentRunSpec available for iteration')
  slot.startedAt = args.now()
  slot.agentRunName = spec.name ?? spec.profile.name ?? 'agent'

  await emitTrace(args.ctx.traceEmitter, {
    kind: 'loop.iteration.started',
    runId: args.runId,
    timestamp: args.now(),
    payload: {
      iterationIndex: args.item.index,
      agentRunName: slot.agentRunName,
      taskHash: hashJson(args.item.task),
      groupId: args.roundIndex,
      parentIndex: args.parentIndex,
    },
  })

  let box: SandboxInstance | undefined
  // When this iteration's box became live. Paired with the teardown below to state the box's
  // wall time — the one platform resource a subscription-seat run really consumes, and the only
  // one the platform does not bill per call.
  let boxAcquiredAt: number | undefined
  // Lineage-owned boxes are torn down by the lineage at loop end, not here. The
  // flag tracks whether THIS iteration's box came from the lineage so the
  // teardown branch below skips it.
  let lineageOwned = false
  let sawLlmCall = false
  // One ledger for this iteration's single turn: it credits the canonical usage events as they
  // arrive and holds the harness's own usage receipt until the turn ends, so a turn that reports
  // both is charged once. Both live outside the try so a turn that ends mid-stream still credits
  // what the harness already reported.
  const usageLedger = createSandboxUsageLedger(spec.profile.harness)
  const creditLlmCall = (llmCall: RuntimeStreamEvent & { type: 'llm_call' }): void => {
    sawLlmCall = true
    slot.costUsd += llmCall.costUsd ?? 0
    if (llmCall.usdKnown === false) {
      slot.costUsdKnown = false
      // Accumulated per CALL, because `costUsdKnown` is an AND over the whole iteration: one
      // unproven call marks the iteration unknown, and a consumer that priced the iteration TOTAL
      // from that flag would relabel every receipt-backed dollar beside it as a price.
      slot.unprovenCostUsd = (slot.unprovenCostUsd ?? 0) + (llmCall.costUsd ?? 0)
    }
    if (llmCall.estimatedCostUsd !== undefined) {
      slot.estimatedCostUsd = (slot.estimatedCostUsd ?? 0) + llmCall.estimatedCostUsd
    }
    if (llmCall.promptCache) {
      slot.promptCache ??= {}
      mergeUsageMetadata(slot.promptCache, llmCall.promptCache)
    }
    // The prompt-cache report is spend evidence, not only telemetry: it is what tells the
    // budget which prompt tokens are a re-read of content already charged. Classify per call,
    // because only this record's own `input` is the total its classes must partition.
    addTokenUsage(slot.tokenUsage, {
      input: llmCall.tokensIn,
      output: llmCall.tokensOut,
      ...(llmCall.tokensKnown === false ? { tokensKnown: false } : {}),
      ...promptCacheTokenClasses(llmCall.tokensIn, llmCall.promptCache),
    })
    args.ctx.runHandle?.observe(llmCall)
  }
  try {
    // Stream source: the lineage (continue / fork / fresh) when this round runs
    // under lineage, else a fresh box + a single `streamPrompt` (today's path,
    // byte-identical when no lineage). The lineage path supplies a session id on
    // the stream; the fresh path passes none — preserving N-independent-boxes.
    let stream: AsyncIterable<SandboxEvent>
    let sandboxSessionId: string | undefined
    let dispatchedExecutionId: string | undefined
    const source = args.lineagePlan?.[args.item.index - args.baseIndex]
    if (source) {
      const acquired = await source.acquire()
      box = acquired.handle.box
      boxAcquiredAt = args.now()
      lineageOwned = true
      args.lineageState?.handles.set(args.item.index, acquired.handle)
      args.evidenceTracker?.register(box, spec.profile, acquired.handle.sessionId)
      stream = acquired.events
      sandboxSessionId = acquired.handle.sessionId
      dispatchedExecutionId = acquired.executionId
    } else {
      box = await createSandboxForSpec(
        args.ctx.sandboxClient,
        spec,
        args.signal,
        args.recordMount,
        args.evidenceTracker,
      )
      boxAcquiredAt = args.now()
      const prompt = spec.taskToPrompt(args.item.task)
      // 'poll' (opt-in) fire-and-detaches + status-polls the terminal result so a
      // long, quiet turn never holds a drop-prone live SSE; 'sse' (default)
      // streams live — byte-identical to the prior path.
      // The caller's per-prompt SDK options ride every turn; the kernel's own
      // session id and signal are applied after them and always win.
      const sandboxSessionIdForTurn = args.evidenceTracker === undefined ? undefined : randomUuid()
      sandboxSessionId = sandboxSessionIdForTurn
      dispatchedExecutionId = args.evidenceTracker === undefined ? undefined : randomUuid()
      const promptOptions =
        dispatchedExecutionId === undefined
          ? args.promptOptions
          : { ...(args.promptOptions ?? {}), executionId: dispatchedExecutionId }
      stream =
        args.streaming === 'poll'
          ? promptEvents(
              'poll',
              box,
              prompt,
              sandboxSessionIdForTurn ?? `${args.runId}-i${args.item.index}`,
              args.signal,
              promptOptions,
            )
          : box.streamPrompt(prompt, {
              ...(promptOptions ?? {}),
              ...(sandboxSessionIdForTurn === undefined
                ? {}
                : { sessionId: sandboxSessionIdForTurn }),
              signal: args.signal,
            })
    }
    if (
      box !== undefined &&
      sandboxSessionId !== undefined &&
      dispatchedExecutionId !== undefined
    ) {
      args.evidenceTracker?.recordDispatch(box, sandboxSessionId, dispatchedExecutionId)
    }
    const placement = describeSandboxPlacement(args.ctx.sandboxClient, box)
    await emitTrace(args.ctx.traceEmitter, {
      kind: 'loop.iteration.dispatch',
      runId: args.runId,
      timestamp: args.now(),
      payload: {
        iterationIndex: args.item.index,
        agentRunName: slot.agentRunName,
        placement: placement.kind,
        sandboxId: placement.sandboxId,
        fleetId: placement.fleetId,
        machineId: placement.machineId,
        groupId: args.roundIndex,
        parentIndex: args.parentIndex,
      },
    })
    // One snapshot per streamed part, not every cumulative frame (see the collector). Published in
    // the drain's finally, so a run that fails mid-stream keeps the events it did receive and the
    // failure can be read from evidence rather than reconstructed.
    const collector = createSandboxTurnEventCollector()
    // The exact instrument this iteration asked the box for. The platform reports what it
    // actually bound; a mismatch fails the iteration instead of attributing its evidence to a
    // model that did not run (agent-runtime#892).
    const requestedModel = concreteProfileModel(spec.profile)
    const requested = {
      ...(spec.profile.model?.provider !== undefined
        ? { provider: spec.profile.model.provider }
        : {}),
      ...(requestedModel !== undefined ? { model: requestedModel } : {}),
    }
    const outcomeTracker = createAgentRunOutcomeTracker()
    try {
      for await (const event of stream) {
        collector.push(event)
        if (box !== undefined)
          args.evidenceTracker?.observe(
            box,
            event,
            source ? args.lineageState?.handles.get(args.item.index)?.sessionId : undefined,
          )
        outcomeTracker.observe(event)
        // Tee each raw event to an optional host observer so a caller can stream
        // the agent's live output. Best-effort + isolated: the observer gets a
        // defensive copy (mutating it cannot corrupt the event the run itself
        // consumes for cost accounting + output parsing below), and a sync throw
        // or a rejected async result is swallowed — it can never break the run.
        notifySandboxEventObserver(event, args.ctx.onSandboxEvent, {
          iterationIndex: args.item.index,
          agentRunName: slot.agentRunName,
        })
        const llmCall = usageLedger.observe(event, slot.agentRunName)
        if (llmCall) creditLlmCall(llmCall)
        assertSandboxServedModel(event, requested)
      }
    } finally {
      slot.events = collector.events()
    }
    const harnessCall = usageLedger.settleTurn(slot.agentRunName)
    if (harnessCall) creditLlmCall(harnessCall)
    const outcome = outcomeTracker.finish()
    slot.sandboxOutcome = outcome
    if (!sawLlmCall) {
      slot.tokenUsage.tokensKnown = false
      slot.costUsdKnown = false
    }
    slot.output = args.output.parse(slot.events)
    const projection = projectSandboxOutcome(outcome)
    if (projection.status === 'failed') {
      throw new Error(projection.reason)
    }
    if (projection.status === 'completed' && args.validator) {
      slot.verdict = await args.validator.validate(slot.output, {
        iteration: args.item.index,
        ...(box ? { box } : {}),
        signal: args.signal,
        traceEmitter: args.ctx.traceEmitter,
      })
    } else if (projection.status !== 'completed') {
      slot.verdict = projection.verdict
    }
  } catch (err) {
    slot.error = err instanceof Error ? err : new Error(String(err))
    // A stream that ends mid-turn still spent whatever the harness already reported, so the held
    // receipt is credited before the iteration is recorded as failed.
    const abortedCall = usageLedger.settleTurn(slot.agentRunName)
    if (abortedCall) creditLlmCall(abortedCall)
  } finally {
    slot.endedAt = args.now()
    await emitTrace(args.ctx.traceEmitter, {
      kind: 'loop.iteration.ended',
      runId: args.runId,
      timestamp: args.now(),
      payload: {
        iterationIndex: args.item.index,
        agentRunName: slot.agentRunName,
        outputHash: slot.output !== undefined ? hashJson(slot.output) : undefined,
        verdict: slot.verdict,
        error: slot.error?.message,
        costUsd: slot.costUsd,
        ...(slot.costUsdKnown === false ? { costUsdKnown: false } : {}),
        ...(slot.estimatedCostUsd !== undefined ? { estimatedCostUsd: slot.estimatedCostUsd } : {}),
        ...(slot.promptCache ? { promptCache: slot.promptCache } : {}),
        durationMs: slot.endedAt - slot.startedAt,
        tokenUsage:
          slot.tokenUsage.input || slot.tokenUsage.output ? { ...slot.tokenUsage } : undefined,
        groupId: args.roundIndex,
        parentIndex: args.parentIndex,
        outputPreview:
          slot.output !== undefined ? stringifySafe(slot.output, { max: 280 }) : undefined,
      },
    })
    // The loop owns the per-shot box lifecycle. Default: tear it down now so
    // sandboxes don't leak. Same-sandbox mode: hand it to the kernel to keep
    // alive for the planner. Lineage mode: the lineage owns the box and keeps it
    // alive across rounds (a later round may continue/fork it), tearing it down
    // at loop end — so skip per-iteration teardown here.
    if (lineageOwned) {
      // no-op: lineage.teardown() reaps this box at loop end. Its lifetime therefore closes after
      // the loop has already built its result, so this iteration reports no box time rather than a
      // number it cannot pair.
    } else if (args.collectBox && box) {
      args.collectBox(box)
    } else {
      const teardown =
        args.evidenceTracker === undefined || box === undefined
          ? await destroySandboxSafe(box, args.ctx.traceEmitter, args.runId, args.now)
          : await args.evidenceTracker.destroy(box).then(() => 'deleted' as const)
      // The platform bills a box until it is deleted, so the lifetime closes on the delete, not on
      // the stream. A delete this loop could not prove leaves the number a floor: the box may have
      // outlived it.
      if (boxAcquiredAt !== undefined && teardown !== 'no-delete-api') {
        slot.boxLiveMs = Math.max(0, args.now() - boxAcquiredAt)
        if (teardown !== 'deleted') slot.boxLiveMsKnown = false
      }
    }
  }
  // An abort caught above is NOT a soft per-iteration failure — it must
  // short-circuit the batch, not degrade to a recorded empty iteration. The
  // trace was already emitted in the finally, so re-throw it now.
  if (isAbortError(slot.error) || args.signal.aborted) {
    if (slot.error) throw slot.error
    throwAbort()
  }
  // A structural lineage error (a dropped session, a fork-capability contract
  // violation, a missing spec) is likewise not a soft worker failure: it
  // invalidates the run's continuity/branching guarantee, so propagate it
  // instead of degrading to a recorded empty iteration the driver might ignore.
  if (slot.error instanceof ValidationError) throw slot.error
}
