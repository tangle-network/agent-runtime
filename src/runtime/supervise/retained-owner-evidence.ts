/** Retained-owner capture receipts, source verification before reuse, and accepted-turn evidence debt. */
import {
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
  AgentRetainedFilePublicationSchema,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { recordValue } from '../../record-value'
import { sameControlCoordinates } from '../retained-run-binding'
import type { RetainedRunAdmission, RetainedRunEnvironmentAdmission } from '../retained-run-types'
import { executorFailureReason } from './executor-outcome'
import { RetainedExecutionPendingError } from './retained-executor'
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
  outputFilePolicyDigest?: string
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
      if (current && event.admission.phase === 'intent' && event.admission.outputFilePolicyDigest)
        current.outputFilePolicyDigest =
          current.outputFilePolicyDigest === undefined ||
          current.outputFilePolicyDigest === event.admission.outputFilePolicyDigest
            ? event.admission.outputFilePolicyDigest
            : 'conflicting-file-policies'
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

/** Group owner admissions by input. A source with no verified workspace receipt is preserved, including one a later resume can still use. */
const UNVERIFIED_SOURCE =
  'provider workspace retention: source preserved because the owner execution has no verified workspace receipt'

export async function ownerWorkspaceRetentionFailures(
  events: readonly SpawnEvent[],
  owner: OwnerRegistration,
): Promise<ReadonlyMap<string, string>> {
  const attempts = ownerWorkspaceAttempts(events, owner.nodeId)
  const failures = new Map<string, string>()
  for (const index of attempts.keys()) {
    const attempt = withLaterEvidence(attempts, index)
    if (attempt.workspaceRetention !== true && attempt.outputFilePolicyDigest === undefined)
      continue
    if (attempt.environmentIds.size === 0) continue
    // One result receipt cannot prove which source belongs to which environment when a
    // recovered attempt admitted more than one. Preserve every source until a later run can
    // establish a one-to-one receipt rather than guessing from a shared result.
    if (attempt.environmentIds.size > 1) {
      for (const environmentId of attempt.environmentIds)
        failures.set(environmentId, UNVERIFIED_SOURCE)
      continue
    }
    const environmentId = [...attempt.environmentIds][0]!
    const reason = await ownerAttemptHasCapture(attempt, environmentId, owner.blobs, owner)
    if (reason !== undefined) failures.set(environmentId, reason)
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

/** Undefined when a receipt authorizes destroying the source. Otherwise why it stays. */
async function ownerAttemptHasCapture(
  attempt: OwnerAttempt,
  environmentId: string,
  blobs: ResultBlobStore,
  owner?: OwnerRegistration,
  allowPartialProcessCapture = false,
): Promise<string | undefined> {
  const controlRef = attempt.controlByEnvironment.get(environmentId)
  if (attempt.outputFilePolicyDigest !== undefined) {
    // Only the original durable result discharges file custody; positive side evidence alone
    // cannot authorize release between physical capture and the original result commit.
    const output =
      attempt.result === undefined
        ? undefined
        : recordValue(await storedOutput(blobs, attempt.result.outRef))
    const publication = AgentRetainedFilePublicationSchema.safeParse(output?.publication)
    const node = owner === undefined ? undefined : ownerCaptureIdentity(attempt, owner).node
    if (
      !output ||
      output.kind !== 'retained-file-output' ||
      output.version !== 1 ||
      output.invocationId !== attempt.executionId ||
      output.policyDigest !== attempt.outputFilePolicyDigest ||
      !Object.hasOwn(output, 'submission') ||
      !recordValue(output.node) ||
      output.submissionRef !== contentAddress(output.submission) ||
      !node ||
      contentAddress(output.node) !== contentAddress(node) ||
      !publication.success ||
      !controlRef ||
      !sameControlCoordinates(publication.data.controlRef, controlRef) ||
      canonicalCandidateDigest(publication.data.policy) !== attempt.outputFilePolicyDigest
    )
      return UNVERIFIED_SOURCE
    if (attempt.workspaceRetention !== true) return undefined
  }
  const receipts = [
    ...(attempt.result === undefined || attempt.result.outputFormat === 'json'
      ? []
      : [attempt.result.outRef]),
    ...attempt.evidence.map((event) => event.outRef),
  ]
  const identity = owner === undefined ? undefined : ownerCaptureIdentity(attempt, owner)
  let verified = false
  let nativeHold: string | undefined
  for (const outRef of receipts) {
    const output = await storedOutput(blobs, outRef)
    const snapshot =
      output !== null && typeof output === 'object'
        ? (output as { readonly workspaceSnapshot?: unknown }).workspaceSnapshot
        : undefined
    const capture =
      output !== null && typeof output === 'object'
        ? (output as { readonly workspaceCapture?: unknown }).workspaceCapture
        : undefined
    const receipt =
      capture !== null && typeof capture === 'object'
        ? (capture as Record<string, unknown>)
        : undefined
    const matches =
      receipt !== undefined &&
      receipt.environmentId === environmentId &&
      receipt.executionId === attempt.executionId
    const durable = hasDurableWorkspaceCapture(
      output,
      snapshot,
      environmentId,
      attempt.executionId,
      controlRef,
      identity,
      allowPartialProcessCapture,
    )
    if (matches && receipt !== undefined) {
      const hold = nativeSessionCopyHoldReason(receipt)
      // The last copy of this execution decides. An earlier complete snapshot does not
      // authorize destroying a later incomplete native store.
      if (hold !== undefined) {
        nativeHold = hold
        verified = false
      } else if (durable) {
        nativeHold = undefined
        verified = true
      }
    } else if (nativeHold === undefined && durable) verified = true
  }
  if (nativeHold !== undefined) return nativeHold
  return verified ? undefined : UNVERIFIED_SOURCE
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

/** Recover evidence before reuse. Failed unverified turns keep their invocation; accepted turns owe evidence. */
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
  for (const attempt of attempts) {
    // The obligation is what the invocation persisted, never today's backend configuration.
    if (
      (attempt.workspaceRetention !== true || attempt.result === undefined) &&
      attempt.outputFilePolicyDigest === undefined
    )
      continue
    for (const environmentId of attempt.environmentIds) {
      if (!reusing.has(environmentId) || unusable.has(environmentId)) continue
      // A verified workspace may continue when Sandbox lost only raw process I/O.
      if (
        (await ownerAttemptHasCapture(attempt, environmentId, args.blobs, args, true)) === undefined
      )
        continue
      if (attempt.outputFilePolicyDigest !== undefined)
        throw new RetainedExecutionPendingError(new Error(UNVERIFIED_SOURCE), 'unobservable')
      if (attempt.result === undefined) continue
      signal.throwIfAborted()
      const failure = capturePendingMessage(
        attempt.executionId ?? args.nodeId,
        new Error('client capture writers are retired; a persisted verified receipt is required'),
      )
      if (executorFailureReason(attempt.result) === undefined) {
        await owePendingEvidence(state, events, attempt, environmentId, failure)
      } else {
        await state.context.onEvidence!({
          executionId: attempt.executionId,
          environmentId,
          controlRef: attempt.controlByEnvironment.get(environmentId),
          ...ownerCaptureIdentity(attempt, args),
          workspaceCaptureFailure: failure,
        })
        throw new RetainedExecutionPendingError(new Error(failure), 'unobservable')
      }
      indebted.add(environmentId)
      state.forceNewSession = true
    }
  }
  return indebted
}

function capturePendingMessage(executionId: string, cause: unknown): string {
  return `retained workspace capture pending for ${executionId}; source environment preserved: ${cause instanceof Error ? cause.message : String(cause)}`
}

/** Preserve a historical capture obligation without blocking work in a fresh environment. */
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
    !captureAuthorizesDestroy(receipt, allowPartialProcessCapture)
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

const NATIVE_STORE_GAP = /(?:^|\s)((?:over_bound|store_file_):[^\s;]+)/g
const COVERAGE_GAP_PREFIX = 'provider workspace retention coverage incomplete: '
const PROCESS_GAP = [
  /^process_(?:io_missing|io_unavailable|source_unavailable)(?::[\w-]+)?$/,
  /^Sandbox session [\w-]+ declared partial raw capture$/,
  /^Sandbox session [\w-]+ attempt [\w-]+\/\d+: process_(?:io_missing|io_unavailable|source_unavailable)(?::[\w-]+)?$/,
  /^Sandbox session [\w-]+ has no original process source: [\w-]+$/,
  /^Sandbox session [\w-]+: process_(?:io_missing|io_unavailable|source_unavailable)(?::[\w-]+)?$/,
  /^Raw native session capture for Sandbox session [\w-]+ is unavailable: process_(?:io_missing|io_unavailable|source_unavailable)(?::[\w-]+)?$/,
  /^Session [\w-]+ process streams incomplete$/,
  /^Attempt [\w-]+\/\d+: process_(?:io_missing|io_unavailable|source_unavailable)(?::[\w-]+)?$/,
]
const EVENT_GAP = /(?:^|:\s)events_incomplete(?::[\w.-]+)?$/

/** Keep the box when the final native copy is incomplete. Process I/O or event-log gaps do not. */
function nativeSessionCopyHoldReason(receipt: Record<string, unknown>): string | undefined {
  const provenance = receipt.provenance
  if (provenance === null || typeof provenance !== 'object') return undefined
  const reported = provenance as Record<string, unknown>
  const sessions = Array.isArray(reported.sessions) ? reported.sessions : []
  let incomplete = false
  const tokens = new Set<string>()
  const take = (value: unknown): void => {
    const text = Array.isArray(value)
      ? value.filter((item) => typeof item === 'string').join('; ')
      : typeof value === 'string'
        ? value
        : ''
    for (const match of text.matchAll(NATIVE_STORE_GAP)) tokens.add(match[1]!)
  }
  for (const session of sessions) {
    if (session === null || typeof session !== 'object') continue
    const row = session as Record<string, unknown>
    const store = row.nativeStore
    if (
      store !== null &&
      typeof store === 'object' &&
      (store as { complete?: unknown }).complete === false
    )
      incomplete = true
    take(row.nativeReason)
    if (store !== null && typeof store === 'object')
      take((store as { missingReasons?: unknown }).missingReasons)
  }
  take(reported.missing)
  if (!incomplete && tokens.size === 0) return undefined
  const detail = tokens.size > 0 ? [...tokens].join('; ') : 'nativeStore incomplete'
  return `native session copy incomplete: ${detail}`
}

function captureAuthorizesDestroy(
  receipt: Record<string, unknown>,
  allowPartialProcessCapture: boolean,
): boolean {
  if (nativeSessionCopyHoldReason(receipt) !== undefined) return false
  if (receipt.coverageComplete === true) return true
  // Reuse accepts a process I/O gap only. Release also accepts an event-log gap alone.
  return hasOnlyRawProcessCaptureGap(receipt, !allowPartialProcessCapture)
}

function captureGapTexts(receipt: Record<string, unknown>): string[] {
  const reason = receipt.incompleteReason
  const named =
    typeof reason === 'string' && reason.startsWith(COVERAGE_GAP_PREFIX)
      ? reason.slice(COVERAGE_GAP_PREFIX.length).split('; ')
      : []
  const provenance = receipt.provenance
  const missing =
    provenance !== null &&
    typeof provenance === 'object' &&
    Array.isArray((provenance as { missing?: unknown }).missing)
      ? (provenance as { missing: unknown[] }).missing.filter(
          (item): item is string => typeof item === 'string',
        )
      : []
  return [...named, ...missing].map((gap) => gap.trim()).filter((gap) => gap.length > 0)
}

/**
 * A process I/O gap does not invalidate a verified workspace. `includeEvents` is the release
 * rule: an event-log gap alone also authorizes destroy. Any other gap keeps the source.
 */
function hasOnlyRawProcessCaptureGap(
  receipt: Record<string, unknown>,
  includeEvents = false,
): boolean {
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
        (session.processStreams?.complete === false ||
          (includeEvents && session.nativeEvents?.complete === false)),
    )
  )
    return false
  const gaps = captureGapTexts(receipt)
  return (
    gaps.length > 0 &&
    gaps.every(
      (gap) =>
        PROCESS_GAP.some((pattern) => pattern.test(gap)) || (includeEvents && EVENT_GAP.test(gap)),
    )
  )
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
