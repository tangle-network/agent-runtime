/**
 * The workspace evidence of a retained owner's turns: which attempts hold a verified capture
 * receipt, recapture before a source is reused, and evidence debt. An accepted turn whose capture
 * fails owes its evidence; the node continues elsewhere, the source is never mutated, captures
 * retry on backoff while the supervisor lives, and the release keeps a source still owed.
 */
import {
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/spawn-journal'
import {
  captureProviderWorkspaceSnapshot,
  workspaceCaptureReceipt,
} from '../provider-workspace-retention'
import { sameControlCoordinates } from '../retained-run-binding'
import type { RetainedRunAdmission, RetainedRunEnvironmentAdmission } from '../retained-run-types'
import { sleep } from '../util'
import { runAbortable } from './abortable'
import { executorFailureReason } from './executor-outcome'
import type { OwnerRegistration, OwnerState } from './retained-scope-owner'
import type {
  ExecutionBindingReceipt,
  ExecutorNodeContext,
  NodeId,
  ResultBlobStore,
  SpawnEvent,
} from './types'

interface OwnerAttempt {
  readonly environmentIds: Set<string>
  readonly executionId?: string
  readonly workspaceRetention?: boolean
  readonly admissions: RetainedRunAdmission[]
  readonly controlByEnvironment: Map<string, AgentExactRunControlRef>
  binding?: ExecutionBindingReceipt
  result?: Extract<SpawnEvent, { kind: 'execution-result' }>
  /** Captures retained as evidence of this attempt: the capture a turn handed over after its
   *  result, or the capture of a turn that failed. */
  readonly evidence: Array<Extract<SpawnEvent, { kind: 'execution-evidence' }>>
}

/** One grouping for release and the evidence gate before another owner invocation. */
function ownerWorkspaceAttempts(events: readonly SpawnEvent[], nodeId: NodeId): OwnerAttempt[] {
  const attempts: OwnerAttempt[] = []
  let current: OwnerAttempt | undefined
  const flush = (): void => {
    if (current !== undefined) attempts.push(current)
    current = undefined
  }
  const fresh = (executionId?: string, workspaceRetention?: boolean): OwnerAttempt => ({
    workspaceRetention,
    admissions: [],
    ...(executionId === undefined ? {} : { executionId }),
    environmentIds: new Set<string>(),
    controlByEnvironment: new Map(),
    evidence: [],
  })
  for (const event of events) {
    if (!('id' in event) || event.id !== nodeId) continue
    if (event.kind === 'execution-input') {
      flush()
      current = fresh(`${nodeId}:input:${event.seq}`, event.workspaceRetention)
    } else if (event.kind === 'execution-admitted' && event.admission.phase === 'environment') {
      if (current?.result !== undefined) flush()
      current ??= fresh()
      current.environmentIds.add(event.admission.environmentId)
      current.admissions.push(event.admission)
    } else if (event.kind === 'execution-admitted' && event.admission.phase === 'dispatched') {
      current?.admissions.push(event.admission)
      current?.controlByEnvironment.set(
        event.admission.controlRef.environmentId,
        event.admission.controlRef,
      )
    } else if (event.kind === 'execution-admitted') {
      current?.admissions.push(event.admission)
    } else if (event.kind === 'execution-bound') {
      // A later coordinator may finalize without running another invocation. Its bookkeeping
      // binding cannot rename the provider attempt whose result was already accepted.
      if (current !== undefined && current.result === undefined) current.binding = event.binding
    } else if (event.kind === 'execution-result') {
      current ??= fresh()
      current.result = event
    } else if (event.kind === 'execution-evidence') {
      current?.evidence.push(event)
    }
  }
  flush()
  return attempts
}

/**
 * Group owner admissions by input and require a verified workspace receipt before deletion.
 *
 * The receipt is the attempt's committed result, or an evidence record of the same attempt: a
 * turn its manager stopped commits its result first and journals its capture as evidence after
 * it, and a turn that failed journals the capture it took of the stopped session. A root capture
 * failure can enter this cleanup barrier and still be resumed, so any receipt refused before
 * reuse must also preserve its source here.
 */
export async function ownerWorkspaceRetentionFailures(
  events: readonly SpawnEvent[],
  owner: OwnerRegistration,
  retainedOnly = false,
): Promise<ReadonlySet<string>> {
  const attempts = ownerWorkspaceAttempts(events, owner.nodeId)
  const failures = new Set<string>()
  for (const index of attempts.keys()) {
    const attempt = withLaterEvidence(attempts, index)
    if (retainedOnly && attempt.workspaceRetention !== true) continue
    if (attempt.environmentIds.size === 0) continue
    // One result receipt cannot prove which source belongs to which environment when a
    // recovered attempt admitted more than one. Preserve every source until a later run can
    // establish a one-to-one receipt rather than guessing from a shared result.
    if (attempt.environmentIds.size > 1) {
      for (const environmentId of attempt.environmentIds) failures.add(environmentId)
      continue
    }
    const environmentId = [...attempt.environmentIds][0]!
    const verified = await ownerAttemptHasCapture(
      attempt,
      environmentId,
      owner.blobs,
      attempt.workspaceRetention === true ? owner : undefined,
    )
    if (!verified) failures.add(environmentId)
  }
  return failures
}

/**
 * The attempt with the evidence journaled after it. A release's capture of a preserved source is
 * journaled after later invocations began; every receipt names its exact execution, environment
 * and control reference, so a receipt of another attempt never verifies this one.
 */
function withLaterEvidence(attempts: readonly OwnerAttempt[], index: number): OwnerAttempt {
  const attempt = attempts[index]!
  const later = attempts.slice(index + 1).flatMap((next) => next.evidence)
  return later.length === 0 ? attempt : { ...attempt, evidence: [...attempt.evidence, ...later] }
}

async function ownerAttemptHasCapture(
  attempt: OwnerAttempt,
  environmentId: string,
  blobs: ResultBlobStore,
  owner?: OwnerRegistration,
  allowPartialProcessCapture = false,
): Promise<boolean> {
  const controlRef = attempt.controlByEnvironment.get(environmentId)
  const receipts = [
    ...(attempt.result === undefined ? [] : [attempt.result.outRef]),
    ...attempt.evidence.map((event) => event.outRef),
  ]
  let verified = false
  for (const outRef of receipts) {
    const output = await storedOutput(blobs, outRef)
    const snapshot =
      output !== null && typeof output === 'object'
        ? (output as { readonly workspaceSnapshot?: unknown }).workspaceSnapshot
        : undefined
    if (
      hasDurableWorkspaceCapture(
        output,
        snapshot,
        environmentId,
        attempt.executionId,
        controlRef,
        owner === undefined ? undefined : ownerCaptureIdentity(attempt, owner),
        allowPartialProcessCapture,
      )
    ) {
      verified = true
      break
    }
  }
  return verified
}

function ownerCaptureIdentity(attempt: OwnerAttempt, owner: OwnerRegistration) {
  const intent = attempt.admissions.find((admission) => admission.phase === 'intent')
  const node: ExecutorNodeContext | undefined =
    attempt.binding === undefined
      ? undefined
      : {
          rootId: owner.executionRootId ?? owner.rootId,
          parentId: owner.nodeId,
          nodeId: owner.nodeId,
          ...(owner.depth === undefined ? {} : { depth: owner.depth }),
          attemptId: attempt.binding.attemptId,
        }
  return { profileDigest: intent?.requestedProfileDigest, node }
}

/**
 * Recover evidence before reuse. A source without a complete receipt is never mutated. A failed
 * turn's capture failure is journaled as its evidence and the next invocation starts in another
 * environment. An accepted turn's failure is evidence debt ({@link owePendingEvidence}): the turn
 * stands, and neither the node nor its supervisor stops. Returns the sources whose capture failed.
 */
export async function reconcileOwnerWorkspaceBeforeReuse(
  state: OwnerState,
  signal: AbortSignal,
): Promise<ReadonlySet<string>> {
  const { args } = state
  const indebted = new Set<string>()
  const events = (await args.journal.loadTree(args.rootId)) ?? []
  const attempts = ownerWorkspaceAttempts(events, args.nodeId)
  const latest = attempts.at(-1)
  const unusable = unusableEnvironmentIds(events.filter((event) => event.id === args.nodeId))
  if (latest === undefined) return indebted
  const reusing = new Set(latest.environmentIds)
  if (latest.result === undefined && state.priorSession !== undefined)
    reusing.add(state.priorSession.environmentId)
  for (const [index, attempt] of attempts.entries()) {
    // The obligation is what the invocation persisted, never today's backend configuration.
    if (attempt.workspaceRetention !== true || attempt.result === undefined) continue
    for (const environmentId of attempt.environmentIds) {
      if (!reusing.has(environmentId) || unusable.has(environmentId)) continue
      // A verified workspace may continue in its retained environment even when Sandbox lost
      // only raw process I/O. The partial receipt stays journaled and cleanup remains strict.
      if (await ownerAttemptHasCapture(attempt, environmentId, args.blobs, args, true)) continue
      try {
        await captureOwnerSource(state, attempts, index, environmentId, signal)
      } catch (cause) {
        const failure = capturePendingMessage(attempt.executionId ?? args.nodeId, cause)
        if (executorFailureReason(attempt.result) === undefined) {
          await owePendingEvidence(state, events, attempt, environmentId, failure)
        } else {
          // Reuse the evidence journal, retaining the original attempt's coordinates. Neither a
          // missing nor a partial receipt permits mutation or deletion of this source.
          await state.context.onEvidence!({
            executionId: attempt.executionId,
            environmentId,
            controlRef: attempt.controlByEnvironment.get(environmentId),
            ...ownerCaptureIdentity(attempt, args),
            workspaceCaptureFailure: failure,
          })
        }
        indebted.add(environmentId)
        state.forceNewSession = true
      }
    }
  }
  return indebted
}

function capturePendingMessage(executionId: string, cause: unknown): string {
  return `retained workspace capture pending for ${executionId}; source environment preserved: ${cause instanceof Error ? cause.message : String(cause)}`
}

/**
 * Record an accepted turn's failed capture as evidence debt, once per source, and start the
 * owner's capture retries. The node continues in another environment and the source is never
 * mutated, so the debt holds only the evidence, never the run.
 *
 * Throwing here instead leaves nothing driving any agent of the run, and every restart meets the
 * same failure: 66 supervisor starts in 17 Discovery runs, 76.7 wall-hours dead, between
 * 2026-10-12 and 2026-10-19 (magnetar-rust-20261016b, 24 starts on "This Platform key has
 * expired").
 */
async function owePendingEvidence(
  state: OwnerState,
  events: readonly SpawnEvent[],
  attempt: OwnerAttempt,
  environmentId: string,
  failure: string,
): Promise<void> {
  const { args } = state
  const owed = events.some(
    (event) =>
      event.kind === 'evidence-pending' &&
      event.id === args.nodeId &&
      event.environmentId === environmentId,
  )
  if (!owed) {
    const at = new Date(args.now()).toISOString()
    await args.journal.appendEvent(args.rootId, {
      kind: 'evidence-pending',
      id: args.nodeId,
      environmentId,
      ...(attempt.executionId === undefined ? {} : { executionId: attempt.executionId }),
      error: failure,
      since: at,
      seq: state.nextSequence(),
      at,
    })
  }
  retryOwnerEvidence(state)
}

/** How capture retries of owed evidence back off, measured on the run's clock. */
export const EVIDENCE_RETRY_BACKOFF_MS = { initial: 30_000, max: 5 * 60_000 } as const
/** How often the retry loop reads the run's clock. Reading it costs no provider call. */
const EVIDENCE_RETRY_TICK_MS = 1_000

/**
 * Retry the captures this node owes while the supervisor lives, backing off from
 * {@link EVIDENCE_RETRY_BACKOFF_MS}'s `initial` to its `max`. One loop per owner; it ends when
 * nothing is owed or the release stops it, and the release tries once more itself.
 */
export function retryOwnerEvidence(state: OwnerState): void {
  if (state.evidenceRetry !== undefined || state.releasing !== undefined) return
  const stop = new AbortController()
  const retry: { stop: AbortController; done: Promise<void> } = { stop, done: Promise.resolve() }
  retry.done = (async () => {
    let backoff: number = EVIDENCE_RETRY_BACKOFF_MS.initial
    let dueAt = state.args.now() + backoff
    while (!stop.signal.aborted) {
      await sleep(EVIDENCE_RETRY_TICK_MS, stop.signal, false)
      if (stop.signal.aborted || state.args.now() < dueAt) continue
      if ((await payOwedEvidence(state, stop.signal)) === 0) return
      backoff = Math.min(backoff * 2, EVIDENCE_RETRY_BACKOFF_MS.max)
      dueAt = state.args.now() + backoff
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      if (state.evidenceRetry === retry) delete state.evidenceRetry
    })
  state.evidenceRetry = retry
}

/** Stop the owner's capture retries and wait for the one in flight. */
export async function stopOwnerEvidenceRetry(state: OwnerState): Promise<void> {
  const retry = state.evidenceRetry
  if (retry === undefined) return
  retry.stop.abort(new Error('the owner settled'))
  await retry.done
}

/**
 * Capture each source this node still owes evidence for, from its `evidence-pending` rows. A
 * receipt journaled by the capture pays the debt. A source no capture can pay any more (gone,
 * without an exact execution, or admitted by a later invocation) is left to the release, which
 * keeps it. Returns how many sources are still owed and payable.
 */
async function payOwedEvidence(state: OwnerState, signal: AbortSignal): Promise<number> {
  const { args } = state
  const events = (await args.journal.loadTree(args.rootId)) ?? []
  const attempts = ownerWorkspaceAttempts(events, args.nodeId)
  const unusable = unusableEnvironmentIds(events.filter((event) => event.id === args.nodeId))
  let owed = 0
  for (const row of events) {
    if (row.kind !== 'evidence-pending' || row.id !== args.nodeId) continue
    if (unusable.has(row.environmentId)) continue
    const index = attempts.findIndex((attempt) => attempt.executionId === row.executionId)
    if (index < 0 || row.executionId === undefined) continue
    if (attempts.slice(index + 1).some((later) => later.environmentIds.has(row.environmentId)))
      continue
    const attempt = withLaterEvidence(attempts, index)
    if (await ownerAttemptHasCapture(attempt, row.environmentId, args.blobs, args, true)) continue
    if (signal.aborted) return owed + 1
    try {
      await captureOwnerSource(state, attempts, index, row.environmentId, signal)
    } catch {
      owed += 1
    }
  }
  return owed
}

/**
 * Capture the workspace an accepted turn left in its retained source and journal the receipt.
 * Throws when the capture cannot be certified for that exact attempt.
 */
async function captureOwnerSource(
  state: OwnerState,
  attempts: readonly OwnerAttempt[],
  index: number,
  environmentId: string,
  signal: AbortSignal,
): Promise<void> {
  const { args } = state
  const attempt = attempts[index]!
  if (attempt.environmentIds.size !== 1 || attempt.executionId === undefined) {
    throw new Error('accepted workspace has ambiguous admission identity')
  }
  // A later invocation in another environment leaves this source as the turn left it.
  if (attempts.slice(index + 1).some((later) => later.environmentIds.has(environmentId))) {
    throw new Error(
      'a later invocation already admitted this environment; historical workspace cannot be recaptured',
    )
  }
  const capture = state.checkpointCapture
  const provider = state.provider
  const intent = attempt.admissions.find((admission) => admission.phase === 'intent')
  const admission = attempt.admissions.find((admission) => admission.phase === 'environment')
  const dispatched = attempt.admissions.find((admission) => admission.phase === 'dispatched')
  if (
    capture === undefined ||
    provider?.get === undefined ||
    intent?.phase !== 'intent' ||
    admission?.phase !== 'environment' ||
    dispatched?.phase !== 'dispatched'
  ) {
    throw new Error('accepted workspace recovery requires its retention port and exact admissions')
  }
  const controlRef = dispatched.controlRef
  if (
    provider.name !== intent.provider ||
    admission.provider !== intent.provider ||
    controlRef.provider !== intent.provider ||
    admission.environmentId !== controlRef.environmentId ||
    admission.sessionId !== controlRef.sessionId ||
    admission.executionId !== controlRef.executionId ||
    admission.idempotencyKey !== intent.idempotencyKey ||
    dispatched.idempotencyKey !== intent.idempotencyKey ||
    admission.sessionId !== intent.sessionId ||
    admission.executionId !== intent.executionId ||
    admission.turnId !== intent.turnId ||
    dispatched.turnId !== intent.turnId ||
    canonicalAgentProfileDigest(capture.profile) !== intent.requestedProfileDigest
  ) {
    throw new Error('accepted workspace recovery does not match its original profile or admission')
  }
  // The lookup shares the retention port's bound. A box idle 21 minutes took over 30 s to
  // answer in test-acceptance-canary-20261018h, and a fixed 30 s cap left its accepted
  // workspace pending and the resumed supervisor exited. A timeout says what timed out.
  const lookupMs = capture.port.timeoutMs
  const lookupBound = AbortSignal.timeout(lookupMs)
  const environment = await runAbortable(
    () => provider.get!(environmentId),
    AbortSignal.any([signal, lookupBound]),
    'accepted workspace source lookup aborted',
  ).catch((error: unknown) => {
    if (lookupBound.aborted && !signal.aborted) {
      throw new Error(`accepted workspace source lookup timed out after ${lookupMs} ms`)
    }
    throw error
  })
  if (
    environment === null ||
    environment.id !== environmentId ||
    environment.provider !== provider.name
  )
    throw new Error('accepted workspace source is unavailable')
  const identity = ownerCaptureIdentity(attempt, args)
  const context = {
    environment,
    executionId: attempt.executionId,
    controlRef,
    providerSessionId: controlRef.sessionId,
    nativeSessionId: null,
    profile: capture.profile,
    ...(identity.node === undefined ? {} : { node: identity.node }),
  }
  const captured = await runAbortable(
    () => captureProviderWorkspaceSnapshot(capture.port, context),
    signal,
    'accepted workspace capture aborted',
  )
  const output = {
    workspaceSnapshot: captured.snapshot,
    workspaceCapture: workspaceCaptureReceipt(context, captured),
  }
  // Partial or foreign captures never authorize mutation, even with a permissive port.
  if (
    !hasDurableWorkspaceCapture(
      output,
      captured.snapshot,
      environmentId,
      attempt.executionId,
      controlRef,
      identity,
      true,
    )
  )
    throw new Error(captured.incompleteReason ?? 'accepted workspace capture is incomplete')
  await state.context.onEvidence!(output)
}

/**
 * Before a release, try once more to capture each source preserved for a missing receipt of an
 * accepted turn, so a capture fault that has cleared settles the evidence debt and frees its
 * source. A source whose capture fails again is kept for evidence.
 */
export async function recaptureOwnerSources(state: OwnerState, signal: AbortSignal): Promise<void> {
  const { args } = state
  if (state.checkpointCapture === undefined || state.provider?.get === undefined) return
  const events = (await args.journal.loadTree(args.rootId)) ?? []
  const owned = events.filter((event) => event.id === args.nodeId)
  const attempts = ownerWorkspaceAttempts(events, args.nodeId)
  const unusable = unusableEnvironmentIds(owned)
  for (const index of attempts.keys()) {
    const attempt = withLaterEvidence(attempts, index)
    if (attempt.workspaceRetention !== true || attempt.result === undefined) continue
    if (executorFailureReason(attempt.result) !== undefined) continue
    for (const environmentId of attempt.environmentIds) {
      if (unusable.has(environmentId)) continue
      if (await ownerAttemptHasCapture(attempt, environmentId, args.blobs, args)) continue
      if (signal.aborted) return
      try {
        await captureOwnerSource(state, attempts, index, environmentId, signal)
      } catch {
        // The source stays preserved and the release names it as kept for evidence.
      }
    }
  }
}

/** A stored output whose bytes match its content reference, or undefined. */
async function storedOutput(blobs: ResultBlobStore, outRef: string): Promise<unknown | undefined> {
  try {
    const output = await blobs.get(outRef)
    return output === undefined || contentAddress(output) !== outRef ? undefined : output
  } catch {
    return undefined
  }
}

/** A stored result authorizes cleanup only for the exact source and complete capture. */
function hasDurableWorkspaceCapture(
  output: unknown,
  snapshot: unknown,
  environmentId: string,
  executionId: string | undefined,
  controlRef: AgentExactRunControlRef | undefined,
  identity?: ReturnType<typeof ownerCaptureIdentity>,
  allowPartialProcessCapture = false,
): boolean {
  const parsed = agentCandidateWorkspaceSnapshotEvidenceSchema.safeParse(snapshot)
  if (
    !parsed.success ||
    !('locator' in parsed.data.manifest) ||
    !('locator' in parsed.data.archive)
  )
    return false
  if (output === null || typeof output !== 'object') return false
  const capture = (output as { readonly workspaceCapture?: unknown }).workspaceCapture
  if (capture === null || typeof capture !== 'object') return false
  const receipt = capture as Record<string, unknown>
  // Both reuse and release check persisted invocation identity. Release retains the older
  // receipt contract only for legacy inputs without a persisted retention obligation.
  if (
    identity !== undefined &&
    (identity.profileDigest === undefined ||
      receipt.profileDigest !== identity.profileDigest ||
      (identity.node === undefined
        ? receipt.node !== undefined
        : receipt.node === undefined ||
          contentAddress(receipt.node) !== contentAddress(identity.node)))
  )
    return false
  const capturedControl = AgentExactRunControlRefSchema.safeParse(receipt.controlRef)
  if (
    executionId === undefined ||
    controlRef === undefined ||
    !capturedControl.success ||
    !sameControlCoordinates(capturedControl.data, controlRef) ||
    receipt.environmentId !== environmentId ||
    receipt.executionId !== executionId ||
    (receipt.coverageComplete !== true &&
      !(allowPartialProcessCapture && hasOnlyRawProcessCaptureGap(receipt)))
  )
    return false
  const linked = agentCandidateWorkspaceSnapshotEvidenceSchema.safeParse(receipt.snapshot)
  return (
    linked.success &&
    linked.data.digest === parsed.data.digest &&
    JSON.stringify(linked.data.manifest) === JSON.stringify(parsed.data.manifest) &&
    JSON.stringify(linked.data.archive) === JSON.stringify(parsed.data.archive)
  )
}

/**
 * A process I/O gap does not invalidate a verified workspace archive or the live environment
 * that owns it. This narrow exception is for continuation only: release still requires complete
 * capture. The reason is assembled by captureProviderWorkspaceSnapshot after identity, inventory,
 * and archive checks, so any other gap keeps the accepted turn pending.
 */
function hasOnlyRawProcessCaptureGap(receipt: Record<string, unknown>): boolean {
  const reason = receipt.incompleteReason
  const prefix = 'provider workspace retention coverage incomplete: '
  if (typeof reason !== 'string' || !reason.startsWith(prefix)) return false
  const provenance = receipt.provenance
  if (provenance === null || typeof provenance !== 'object') return false
  const reported = provenance as Record<string, unknown>
  const workspace = reported.workspace
  if (
    reported.status !== 'reported' ||
    workspace === null ||
    typeof workspace !== 'object' ||
    (workspace as Record<string, unknown>).complete !== true
  )
    return false
  const sessions = reported.sessions
  if (
    !Array.isArray(sessions) ||
    !sessions.some(
      (session) =>
        session !== null &&
        typeof session === 'object' &&
        session.processStreams?.complete === false,
    )
  )
    return false
  const allowed = [
    /^process_(?:io_missing|io_unavailable|source_unavailable)(?::[\w-]+)?$/,
    /^Sandbox session [\w-]+ declared partial raw capture$/,
    /^Sandbox session [\w-]+ attempt [\w-]+\/\d+: process_(?:io_missing|io_unavailable|source_unavailable)(?::[\w-]+)?$/,
    /^Sandbox session [\w-]+ has no original process source: [\w-]+$/,
    /^Sandbox session [\w-]+: process_(?:io_missing|io_unavailable|source_unavailable)(?::[\w-]+)?$/,
    /^Raw native session capture for Sandbox session [\w-]+ is unavailable: process_(?:io_missing|io_unavailable|source_unavailable)(?::[\w-]+)?$/,
    /^Session [\w-]+ process streams incomplete$/,
    /^Attempt [\w-]+\/\d+: process_(?:io_missing|io_unavailable|source_unavailable)(?::[\w-]+)?$/,
  ]
  const gaps = reason.slice(prefix.length).split('; ')
  return gaps.length > 0 && gaps.every((gap) => allowed.some((pattern) => pattern.test(gap)))
}

/** Environments that cannot execute another turn, whether absent or terminal at the provider. */
export function unusableEnvironmentIds(owned: readonly SpawnEvent[]): ReadonlySet<string> {
  return new Set(
    owned.flatMap((event) =>
      event.kind === 'environment-terminal' ||
      (event.kind === 'environment-teardown' && event.destroyed)
        ? [event.environmentId]
        : [],
    ),
  )
}

/**
 * After {@link reconcileOwnerWorkspaceBeforeReuse}: an unfinished input an older coordinator
 * admitted into a source now owed evidence, but never dispatched there, is abandoned. Replaying
 * it would mutate the source, so the next drive is a new invocation in another environment. A
 * dispatch lost before its admission was journaled cannot be ruled out, so the outcome is
 * uncertain.
 */
export async function abandonInputAdmittedIntoDebt(
  state: OwnerState,
  indebted: ReadonlySet<string>,
): Promise<void> {
  const { args } = state
  const pending = state.admissions.find(
    (admission): admission is RetainedRunEnvironmentAdmission =>
      admission.phase === 'environment' && indebted.has(admission.environmentId),
  )
  if (
    pending === undefined ||
    state.admissions.some((admission) => admission.phase === 'dispatched')
  )
    return
  await args.journal.appendEvent(args.rootId, {
    kind: 'execution-abandoned',
    id: args.nodeId,
    inputSeq: state.inputSequence!,
    pendingCause: 'unobservable',
    failures: 1,
    detail: `admitted into ${pending.environmentId}, whose workspace capture is pending; never dispatched there`,
    outcome: 'uncertain',
    seq: state.nextSequence(),
    at: new Date(args.now()).toISOString(),
  })
  delete state.inputSequence
  delete state.taskRef
  state.admissions.length = 0
}
