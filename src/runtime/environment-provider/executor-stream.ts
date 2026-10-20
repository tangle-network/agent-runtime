import {
  type AgentCandidateWorkspaceSnapshotEvidence,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type { SandboxEvent } from '@tangle-network/sandbox'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { captureHarnessTranscript } from '../harness-transcript'
import {
  canonicalSandboxUsageMode,
  createSandboxToolPartState,
  createSandboxUsageLedger,
  sandboxProgressEvents,
} from '../sandbox-events'
import type { SandboxOutcomeCarrier } from '../sandbox-outcome'
import { priceUnreceiptedWork } from '../supervise/cost-estimate'
import { errorText } from '../supervise/error-message'
import { contentRef } from '../supervise/executor-outcome'
import { concreteProfileModel } from '../supervise/model-policy'
import { RetainedExecutionPendingError } from '../supervise/retained-executor'
import { detachedSnapshot } from '../supervise/snapshot'
import { decodeBoxPart } from '../supervise/trace-source'
import type { ExecutorResult, Spend, UsageEvent } from '../supervise/types'
import { unavailableSignalOfFailure } from '../supervise/upstream-unavailable'
import { addSpend, addTokenUsage, cloneTokenUsage, zeroTokenUsage } from '../util'
import type {
  ProviderInvocationEnd,
  ProviderLeafOut,
  StreamProviderExecutorArgs,
} from './contracts'
import {
  createProviderFailureLedger,
  createTurnEventArchive,
  failureStatusCode,
  isTerminalEnvironmentEvent,
  resultFromEvents,
  sandboxEventFromEnvironmentEvent,
  textFromEnvironmentEvent,
  usageSandboxEvent,
} from './events'
import { providerExecutionSource } from './execution-source'
import { environmentAsSandboxInstance } from './sandbox-adapter'
import { providerTurnDefaults, providerTurnWithDefaults, taskToTurnInput } from './turn-input'
import { ValidationError } from './validation-error'
import { providerWorkspaceCaptureReceipt } from './workspace-receipt'

export async function* streamProviderExecutor(
  args: StreamProviderExecutorArgs,
): AsyncGenerator<UsageEvent, ProviderInvocationEnd, undefined> {
  const started = Date.now()
  const linked = args.signal
  // READINESS IS THE PROVIDER'S CONTRACT. `create` resolves with an environment that can take a
  // turn, so this streams straight into it and adds no wait of its own. The sandbox seam's
  // `acquireSandbox` exists because a raw `SandboxClient.create` returns before the box is ready;
  // wrapping a second readiness poll around a provider that already honors the contract would hide
  // a provider that does not, and a provider that does not is an upstream defect to report.
  const defaultTurn = taskToTurnInput(args.task, linked)
  let turn = providerTurnWithDefaults(
    providerTurnDefaults(args.options.promptOptions, `providerAsExecutor(${args.provider.name})`),
    args.options.taskToTurn?.(args.task, args.profile, defaultTurn) ?? defaultTurn,
    linked,
  )
  if (args.options.defaults?.metadata?.runtimeProviderPlacement !== undefined) {
    if (turn.model !== undefined && turn.model !== concreteProfileModel(args.profile)) {
      throw new ValidationError('provider placement: taskToTurn cannot replace the profile model')
    }
    const declared = providerTurnDefaults(args.options.promptOptions, 'provider placement')
    if (
      canonicalCandidateDigest(turn.providerOptions ?? {}) !==
      canonicalCandidateDigest(declared?.providerOptions ?? {})
    ) {
      throw new ValidationError(
        'provider placement: taskToTurn cannot replace declared provider options',
      )
    }
    const { signal: _signal, ...material } = turn
    turn = { ...detachedSnapshot(material, 'provider placement turn'), signal: linked }
  }
  args.onProviderSessionId(turn.sessionId ?? null)
  const source = await providerExecutionSource(args, turn, linked)
  const environment = source.environment
  args.onEnvironment(environment)
  args.startNativeMirror(environment)
  const archive = createTurnEventArchive()
  const seenTraceCalls = new Set<string>()
  let tokens = zeroTokenUsage()
  const usageLedger = createSandboxUsageLedger(args.profile.harness)
  let sawCompleteTokenReceipt = false
  let sawIncompleteTokenReceipt = false
  let sawCostReceipt = false
  let sawUnknownCostReceipt = false
  let sawCostEstimate = false
  let pendingUnpricedWork = false
  let pendingEstimate: number | undefined
  /** The model id a usage receipt reported, when it reported one. Only a catalog can price a run
   *  the provider never billed, and only a model id can address a catalog. */
  let observedModel: string | undefined
  let usdEstimated = 0
  let usd = 0
  let text = ''
  let terminal = false
  const failures = createProviderFailureLedger()
  // The artifact this turn settled with, once it exists. Its presence is what separates "the work
  // finished and the resource would not release" from "the work never finished".
  let settled: ExecutorResult<unknown> | undefined
  // The body's own failure, held so the `finally` cannot REPLACE it. A `finally` that throws
  // discards the in-flight exception, so a teardown error would otherwise mask the real cause of a
  // turn that failed for its own reasons.
  let failure: unknown
  let failed = false
  // Set when the turn was refused for capacity and the caller will continue in this environment.
  let unavailable: ProviderInvocationEnd['unavailable']
  // Whether the turn's final session copy was already taken: a turn whose workspace capture the
  // owner took over copies its session before it hands the capture over.
  let finalCopyTaken = false
  // Whether this turn's owner takes its workspace capture over, so the turn ends without waiting
  // for it. The owner's environment outlives its turns; the owner awaits the capture before the
  // environment's next turn and before it destroys the environment, and the capture's receipt is
  // journaled as evidence of this invocation. Only a port that copies the session on its own
  // queue hands the capture over: without one, the workspace capture is the only record of the
  // session the node settles with.
  const ownerTakesCapture = (): boolean =>
    args.options.workspaceRetention?.captureNative !== undefined &&
    args.createProfile.harness !== undefined &&
    source.retained &&
    args.retention?.preserveEnvironment === true &&
    args.retention.onEndOfTurnWork !== undefined
  // Hand the workspace capture to the owner. Its receipt reaches the journal as evidence of this
  // invocation; a capture that fails leaves none, and the owner's release then keeps the source.
  const handCaptureToOwner = (
    reported: object,
    captureOutcome: AgentRunOutcome | undefined,
    publish: boolean,
    beforeCapture?: () => Promise<void>,
  ): void => {
    args.retention?.onEndOfTurnWork?.(
      (async () => {
        // The final native copy runs beside the workspace capture, which holds the session too and
        // replaces the copy as the transcript when it settles. Neither holds the completed turn
        // open; the retained owner waits for this work before reuse or release. On canary
        // test-acceptance-canary-20261019o (Runtime 0.332.2) the copy ran first, for 17.8 s, and the
        // workspace capture started 59-66 s after the turn's result. A native copy is best-effort
        // evidence: its failure leaves the workspace capture as the owner's retention boundary.
        const finalCopy = (async () => {
          try {
            await beforeCapture?.()
          } catch {
            // The workspace receipt remains the owner's retention boundary.
          }
        })()
        let snapshot: Awaited<ReturnType<typeof args.captureWorkspace>>
        try {
          snapshot = await args.captureWorkspace(environment, captureOutcome)
        } finally {
          await finalCopy
        }
        if (publish) args.onPublishedSnapshot(snapshot)
        if (snapshot === undefined) return
        await args.retention?.onEvidence?.({
          ...reported,
          workspaceSnapshot: snapshot,
          workspaceCapture: providerWorkspaceCaptureReceipt(
            args,
            environment,
            snapshot,
            turn.sessionId ?? null,
          ),
        })
      })().catch(() => undefined),
    )
  }
  // A deadline or a cancellation stops the harness once, before any capture of its session, so
  // the failure capture and the final copy read a session that has stopped changing.
  let harnessStop: Promise<void> | undefined
  const stopEndedHarness = (): Promise<void> => {
    if (settled !== undefined || !linked.aborted) return Promise.resolve()
    harnessStop ??= args.stopEndedHarness(linked)
    return harnessStop
  }
  try {
    const toolParts = createSandboxToolPartState()
    for await (const event of source.events) {
      if ('awaitingResultSince' in event) {
        yield {
          kind: 'progress',
          progress: { kind: 'awaiting-result', since: event.awaitingResultSince },
        }
        continue
      }
      args.noteProviderEvent()
      archive.append(event)
      text += textFromEnvironmentEvent(event)
      const sandboxEvent = sandboxEventFromEnvironmentEvent(event)
      const eventData = sandboxEvent.data
      const part =
        eventData !== null && typeof eventData === 'object'
          ? (eventData as { readonly part?: unknown }).part
          : undefined
      if (part !== undefined) {
        const step = decodeBoxPart(part, args.profile.harness)
        if (step !== undefined && (step.callId === undefined || !seenTraceCalls.has(step.callId))) {
          if (step.callId !== undefined) seenTraceCalls.add(step.callId)
          args.trace.record(step)
        }
      }
      failures.observe(event, sandboxEvent)
      // One projection for every sandbox-shaped stream: the provider event is adapted to the
      // sandbox wire the mappers already read, so live output needs no provider-specific parser.
      for (const progress of sandboxProgressEvents(sandboxEvent, toolParts)) {
        yield { kind: 'progress', progress }
      }
      const usageEvent = usageSandboxEvent(event)
      if (usageEvent)
        yield* creditUsage(
          usageLedger.observe(usageEvent, args.profile.name ?? 'agent'),
          usageEvent,
        )
      yield* creditUsage(
        usageLedger.observe(sandboxEvent, args.profile.name ?? 'agent'),
        sandboxEvent,
      )
      if (
        source.retained &&
        event.type === 'result' &&
        event.data.eventStreamComplete === false &&
        event.data.usdKnown === false
      ) {
        sawUnknownCostReceipt = true
      }
      if (isTerminalEnvironmentEvent(event)) terminal = true
    }
    yield* creditUsage(usageLedger.settleTurn(args.profile.name ?? 'agent'))
    // Interim missing prices and catalog estimates may be covered by a later cumulative bill.
    // Only unresolved work becomes unknown at settlement; do not add a quote to that bill.
    if (pendingUnpricedWork) {
      // A provider that reports tokens and no dollars used to settle a bare `$0`, so a sandbox-
      // rooted run that certainly spent money reported a dollar total of zero with no estimate at
      // all. The catalog answers what the provider WOULD bill, so the amount rides `usdEstimated`
      // and `usdKnown` stays false below: a price is not a receipt and must never become one.
      //
      // Priced only when NO dollars reached the channel for this execution. `tokens` is the
      // execution's cumulative total, not the unresolved remainder, so pricing it alongside any
      // receipt — billed or already marked unknown — would charge the same tokens twice. A
      // partially billed execution therefore keeps its unresolved part unknown, which is true.
      const estimated = pendingEstimate ?? (usd === 0 ? catalogPrice() : undefined)
      const estimate = estimated ?? 0
      sawUnknownCostReceipt = true
      usd += estimate
      if (estimated !== undefined) {
        sawCostEstimate = true
        usdEstimated += estimate
      }
      yield {
        kind: 'cost',
        usd: estimate,
        usdKnown: false,
        ...(estimated === undefined ? {} : { usdEstimated: estimate }),
        provenance: estimated === undefined ? 'uncaptured' : 'catalog-estimate',
      }
    }
    if ((args.options.requireTerminalEvent ?? true) && !terminal) {
      throw new ValidationError(
        `providerAsExecutor(${args.provider.name}): stream ended without a terminal result/done/status event`,
      )
    }
    // Continuations share one iteration; recovery restores it from the prior committed spend.
    if (args.carried === undefined) yield { kind: 'iteration' }
    // Retention captures once below and exposes that verified archive through the transcript port.
    // Environments without retention keep the existing bounded live-read path.
    if (args.options.workspaceRetention === undefined) {
      args.onHarnessTranscript(
        await captureHarnessTranscript(
          environment as Parameters<typeof captureHarnessTranscript>[0],
          args.profile.harness,
          linked,
        ),
      )
    }
    const outcome = failures.finish()
    const result: ProviderLeafOut & SandboxOutcomeCarrier = {
      ...resultFromEvents(archive.events(), text),
      ...(archive.superseded > 0 ? { supersededPartUpdates: archive.superseded } : {}),
      ...(outcome ? { outcome } : {}),
    }
    const spent: Spend = {
      iterations: 1,
      tokens,
      // Distinct partial receipts cannot prove each other's missing counters.
      ...(sawCompleteTokenReceipt && !sawIncompleteTokenReceipt ? {} : { tokensKnown: false }),
      usd,
      // A dollar total is known only when a canonical receipt arrived and none was marked
      // unknown. Bare provider numbers remain untrusted; Router billing receipts survive.
      usdKnown: sawCostReceipt && !sawUnknownCostReceipt,
      // Only unverified amounts are estimates; a mixed run must retain its billed subtotal.
      ...(sawCostEstimate ? { usdEstimated } : {}),
      ms: Date.now() - started,
    }
    const executionSpent: Spend =
      args.carried === undefined
        ? spent
        : {
            ...addSpend(args.carried, { ...spent, iterations: 0 }),
            ms: Date.now() - args.executionStartedAt,
          }
    // Scored HERE, before the `finally` destroys the environment: a validator that reads a file or
    // runs a command needs the environment it is scoring to still exist. Every other supervised
    // hook fires after teardown and can only read the artifact.
    const verdict = await args.options.validator?.validate(result, {
      iteration: 0,
      ...(args.node === undefined ? {} : { node: args.node }),
      box: environmentAsSandboxInstance(environment, {
        profile: args.profile,
        requireTerminalEvent: args.options.requireTerminalEvent ?? true,
      }),
      signal: linked,
    })
    // Every retained owner with a native copy commits its turn before the slow workspace capture.
    // The owner waits for that capture before its next turn or environment release, so a queued or
    // failed capture cannot hide a completed provider result from the caller. Discovery's contract
    // canary had both exact Sandbox executions complete while their results stayed unjournaled for
    // over 18 minutes behind capture (2026-10-14).
    const deferCapture = ownerTakesCapture()
    // The turn has settled, so a capture that fails or exceeds its deadline is a fact about the
    // evidence, never the turn's outcome. Measured 2026-10-03 on Runtime 0.295.4: one capture that
    // waited past its 1,200,000 ms deadline behind a two-slot queue shared by 34 workers threw an
    // AbortError, the driver classified it terminal, and two research roots ended with 13 and 0 of
    // their children settled. The source stays preserved because no receipt exists, the retained
    // owner reads the receipt-less result as a retention failure, and the turn is not re-run.
    let retainedWorkspace: AgentCandidateWorkspaceSnapshotEvidence | undefined
    let workspaceCaptureFailure: string | undefined
    if (!deferCapture) {
      try {
        retainedWorkspace = await args.captureWorkspace(environment, outcome)
      } catch (error) {
        workspaceCaptureFailure = `${errorText(error instanceof Error ? error.message : error)}; source environment preserved`
      }
      args.onPublishedSnapshot(retainedWorkspace)
    }
    const settledResult: ProviderLeafOut & SandboxOutcomeCarrier = {
      ...result,
      ...(workspaceCaptureFailure === undefined ? {} : { workspaceCaptureFailure }),
      ...(retainedWorkspace === undefined
        ? {}
        : {
            workspaceSnapshot: retainedWorkspace,
            workspaceCapture: providerWorkspaceCaptureReceipt(
              args,
              environment,
              retainedWorkspace,
              turn.sessionId ?? null,
            ),
          }),
    }
    settled = {
      ...(result.outcome?.status === 'failed'
        ? {
            outcome: {
              success: false,
              ...(result.outcome.error ? { error: result.outcome.error } : {}),
              // The code, not the text, is what a retry policy may branch on.
              ...(result.outcome.errorCode ? { errorCode: result.outcome.errorCode } : {}),
              ...(failureStatusCode(result.outcome) === undefined
                ? {}
                : { statusCode: failureStatusCode(result.outcome) }),
            },
          }
        : {}),
      outRef: contentRef(`provider:${args.provider.name}`, settledResult),
      out: settledResult,
      ...(verdict ? { verdict } : {}),
      spent: executionSpent,
    }
    const refusal =
      args.mayContinue && source.retained && result.outcome?.status === 'failed'
        ? unavailableSignalOfFailure({
            error: result.outcome.error ?? '',
            ...(result.outcome.errorCode ? { errorCode: result.outcome.errorCode } : {}),
            ...(failureStatusCode(result.outcome) === undefined
              ? {}
              : { statusCode: failureStatusCode(result.outcome) }),
          })
        : undefined
    if (refusal !== undefined) {
      unavailable = { signal: refusal, cause: errorText(result.outcome?.error ?? '') }
    }
    if (source.retained) await args.retention?.onResult(settled)
    else if (retainedWorkspace !== undefined) await args.retention?.onEvidence?.(settledResult)
    args.onPending(false)
    args.onArtifact(settled)
    if (deferCapture) {
      // The session copy this turn settles with is taken first, on the native queue, which never
      // waits behind workspace captures; the workspace capture then reads a session that ended.
      // Both copies belong to the owner so neither delays delivery of this result to the caller.
      finalCopyTaken = true
      handCaptureToOwner(settledResult, outcome, true, () =>
        args.finishNativeMirror(environment, 'settled'),
      )
    }
  } catch (error) {
    // A limit or transport stop may omit the terminal aggregate. Credit completed native
    // response receipts before the failed attempt is journaled, without replaying the turn.
    yield* creditUsage(usageLedger.settleTurn(args.profile.name ?? 'agent'))
    failure = source.retained ? new RetainedExecutionPendingError(error) : error
    failed = true
    // A failed or cancelled stream has no ProviderLeafOut for the caller to retrieve. Keep the
    // live source even when capture succeeds, so its executable state remains the receipt boundary.
    if (args.options.workspaceRetention !== undefined) args.onUnsettledFailure()
    const failureOutcome =
      failures.finish() ??
      ({
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        ...(linked.aborted ? { errorCode: 'cancelled' } : {}),
      } satisfies AgentRunOutcome)
    await stopEndedHarness()
    // The scope settles an aborted node as soon as the abort reaches it and reads the transcript
    // this executor holds then. The stopped harness's final session copy is taken here, before the
    // capture of the whole workspace, which can run for minutes; the 2026-10-04 trace proof
    // settled a deadline node with its last running copy, `native_snapshot_live`.
    if (linked.aborted) await args.finishNativeMirror(environment, 'failed')
    args.onTranscriptSettled()
    if (ownerTakesCapture()) {
      // The owner takes this failed turn's capture over too, so the drive ends now and the
      // owner's release reads the capture's receipt before it decides what to destroy.
      if (!linked.aborted) await args.finishNativeMirror(environment, 'failed')
      finalCopyTaken = true
      handCaptureToOwner(
        { ...resultFromEvents(archive.events(), text), outcome: failureOutcome },
        failureOutcome,
        false,
      )
    } else {
      try {
        const retainedWorkspace = await args.captureWorkspace(environment, failureOutcome)
        if (retainedWorkspace !== undefined && args.retention?.onEvidence !== undefined) {
          await args.retention.onEvidence({
            ...resultFromEvents(archive.events(), text),
            outcome: failureOutcome,
            workspaceSnapshot: retainedWorkspace,
            workspaceCapture: providerWorkspaceCaptureReceipt(
              args,
              environment,
              retainedWorkspace,
              turn.sessionId ?? null,
            ),
          })
        }
      } catch (captureError) {
        // Preserve the stream failure alongside capture's own cause. A persistence error can
        // be shared with the supervisor, so never replace its cause or make it refer to itself
        // when capture was also the original failure.
        if (captureError instanceof Error && captureError !== error) {
          failure =
            captureError.cause === undefined
              ? Object.assign(captureError, { cause: failure })
              : new AggregateError([captureError, failure], captureError.message, {
                  cause: captureError,
                })
        } else {
          failure = captureError
        }
      }
    }
    if (args.options.workspaceRetention === undefined) {
      args.onHarnessTranscript(
        await captureHarnessTranscript(
          environment as Parameters<typeof captureHarnessTranscript>[0],
          args.profile.harness,
          linked,
        ),
      )
    }
  } finally {
    await stopEndedHarness()
    // Before any teardown: the final copy reads the session from the live environment. This is
    // the only capture that runs when the stream was closed by an abort or a deadline.
    if (!finalCopyTaken) {
      await args.finishNativeMirror(
        environment,
        failed ? 'failed' : settled !== undefined ? 'settled' : 'interrupted',
      )
    }
    // A keyed turn that ended over its budget keeps its environment, so a re-spawn of its key
    // with more budget runs the next turn in this same environment and harness session.
    const held =
      source.retained &&
      settled !== undefined &&
      !failed &&
      unavailable === undefined &&
      args.retention?.preserveEnvironment !== true &&
      args.retention?.holdOnSettle?.(settled.spent) === true
    if (held) args.onHeld()
    if (
      (!source.retained || (settled !== undefined && !failed)) &&
      !(source.retained && args.retention?.preserveEnvironment) &&
      // A refused turn keeps its environment: the executor continues in it.
      !(unavailable !== undefined && !failed) &&
      !held &&
      (args.options.destroyOnSettle ?? true)
    ) {
      const cleanup = await args.destroyEnvironment()
      if (!cleanup.destroyed) {
        const error = new Error(cleanup.detail ?? 'provider environment teardown was not confirmed')
        // ONCE THE TURN HAS SETTLED, TEARDOWN CANNOT CHANGE THE OUTCOME. Measured: a second DELETE
        // answered 409, the rejection escaped this `finally`, and a run whose turn had completed
        // (`spent.iterations: 1`, artifact produced) was reported as a failure. The resource fact is
        // recorded beside the result; the result stands.
        //
        // Before the turn settles there is no outcome to protect, so the failure IS the outcome and
        // is rethrown — a create-then-fail-then-leak path must still fail loudly.
        if (settled !== undefined) {
          args.onArtifact({
            ...settled,
            teardown: {
              failed: true,
              error: error.message,
              at: new Date().toISOString(),
            },
          })
        } else if (!failed) {
          // Nothing settled and the body did not fail on its own: the teardown failure IS the
          // outcome, so a create-then-leak path still fails loudly.
          failure = error
          failed = true
        } else {
          // The body already failed. ITS error is the cause a reader needs; the teardown failure
          // rides along as `cause` rather than displacing it.
          failure =
            failure instanceof Error
              ? Object.assign(failure, { cause: failure.cause ?? error })
              : failure
        }
      }
    }
  }
  if (failed) throw failure
  return {
    ...(unavailable === undefined ? {} : { unavailable }),
    ...(settled === undefined ? {} : { spent: settled.spent }),
    madeProgress: tokens.input > 0 || tokens.output > 0 || usd > 0,
    durationMs: Date.now() - started,
  }

  /**
   * The catalog price of this execution's whole token total, under the first model id the catalog
   * knows. Undefined when none prices, so an unpriced model settles with no estimate at all rather
   * than a zero one — absence says "nothing could be priced", a zero would say "priced at nothing".
   *
   * Candidates run most specific first: the id a usage receipt reported, then the turn's own
   * model, then the profile's. A provider that selected its own default declares no profile model,
   * so a reported id is then the only one a catalog can match.
   */
  function catalogPrice(): number | undefined {
    for (const model of [observedModel, turn.model, concreteProfileModel(args.createProfile)]) {
      if (model === undefined) continue
      const priced = priceUnreceiptedWork({
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        ...(tokens.cacheRead === undefined ? {} : { cacheReadTokens: tokens.cacheRead }),
        ...(tokens.cacheWrite === undefined ? {} : { cacheWriteTokens: tokens.cacheWrite }),
        model,
      })
      if (priced.usdKnown === false && priced.usdEstimated !== undefined) return priced.usdEstimated
    }
    return undefined
  }

  /** This invocation's cumulative tokens as the execution's: a continuation adds what its earlier
   *  invocations already reported. */
  function executionTokens(own: ReturnType<typeof usageLedger.tokenUsage>) {
    if (args.carried === undefined) return own
    const total = cloneTokenUsage(args.carried.tokens)
    addTokenUsage(total, own)
    return total
  }

  function* creditUsage(
    receipt: ReturnType<typeof usageLedger.observe>,
    event?: SandboxEvent,
  ): Iterable<UsageEvent> {
    if (receipt === undefined) return
    // A receipt that named no model is stamped with the worker's name, which is not a model id and
    // prices nothing. Only a different value is evidence of what the provider actually served.
    if (receipt.model !== (args.profile.name ?? 'agent')) observedModel = receipt.model
    const hasTokens = receipt.tokensIn !== undefined || receipt.tokensOut !== undefined
    if (
      hasTokens &&
      receipt.tokensIn !== undefined &&
      receipt.tokensOut !== undefined &&
      receipt.tokensKnown !== false
    ) {
      sawCompleteTokenReceipt = true
    } else if (hasTokens || receipt.tokensKnown === false || receipt.tokensUnknownReason) {
      sawIncompleteTokenReceipt = true
    }
    const input = receipt.tokensIn ?? 0
    const output = receipt.tokensOut ?? 0
    if (input || output || receipt.tokensKnown === false || receipt.promptCache !== undefined) {
      tokens = usageLedger.tokenUsage()
      yield {
        kind: 'tokens',
        mode: 'cumulative',
        ...executionTokens(tokens),
        ...(receipt.tokensKnown === false ? { tokensKnown: false } : {}),
      }
    }
    const amount = receipt.costUsd
    if (amount !== undefined) {
      sawCostReceipt = true
      usd += amount
      if (receipt.usdKnown === false) {
        sawUnknownCostReceipt = true
        sawCostEstimate = true
        usdEstimated += amount
        yield {
          kind: 'cost',
          usdKnown: false,
          usd: amount,
          usdEstimated: amount,
          provenance: 'uncaptured',
        }
      } else {
        if (event && canonicalSandboxUsageMode(event) === 'cumulative') {
          // This receipt covers the bound execution's prior work, not just one new call.
          pendingUnpricedWork = false
          pendingEstimate = undefined
        }
        yield { kind: 'cost', usdKnown: true, usd: amount, provenance: 'provider-receipt' }
      }
    } else if (receipt.estimatedCostUsd !== undefined) {
      pendingUnpricedWork = true
      pendingEstimate = (pendingEstimate ?? 0) + receipt.estimatedCostUsd
    } else if (input > 0 || output > 0 || receipt.tokensKnown === false) {
      // A duplicate terminal token total credits zero and cannot invent more unpriced work.
      pendingUnpricedWork = true
    }
  }
}
