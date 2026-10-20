import {
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { assertValidSpend } from './budget'
import {
  authoredProfileDigest,
  knownExecutionBindingReceipt,
  knownMaterializationReceipt,
  newExecutionAttemptId,
  unknownExecutionBindingReceipt,
  unknownMaterializationReceipt,
} from './materialization'
import { providerVisibleProfile } from './provider-visible-profile'
import type { ScopeArgs } from './scope-contract'
import { authoredSeatStages, seatExecutionProfile } from './seat-chain'
import { detachedSnapshot } from './snapshot'
import type {
  ExecutionBindingReceipt,
  ExecutorExecutionBinding,
  ExecutorNodeContext,
  MaterializedExecutionIdentity,
  NodeId,
  NodeSnapshot,
  ProfileMaterializationReceipt,
  ResultBlobStore,
  Scope,
  SpawnEvent,
  SpawnJournal,
} from './types'

interface OwnerMaterializationState {
  readonly retainedRoot: NodeId
  readonly blobs: ResultBlobStore
  readonly journal: SpawnJournal
  readonly root: NodeId
  readonly nodeId: NodeId
  readonly depth: number
  readonly runtime: NodeSnapshot['runtime']
  /** Rotated by `beginScopeOwnerAttempt` on every driver attempt after the first. */
  attemptId: string
  readonly authoredProfile?: unknown
  readonly authoredProfileDigest?: Sha256Digest
  readonly prior?: ProfileMaterializationReceipt
  readonly requiredKnown: boolean
  readonly onReceipt?: (
    materialization: ProfileMaterializationReceipt,
    binding: ExecutionBindingReceipt,
  ) => void
  readonly now: () => number
  receipt?: ProfileMaterializationReceipt
  bindingPublished: boolean
  publishedThisProcess: boolean
  /** The execution the latest attempt started under a pending executor plan, before any
   *  acknowledgement. Finalization names it when no receipt ever arrived. */
  plannedExecution?: {
    readonly attemptId: string
    readonly execution: MaterializedExecutionIdentity
  }
  /** The latest owner materialization write; the next one starts after it settles. */
  writes?: Promise<unknown>
}

/**
 * @internal Record the execution a pending executor started for the current attempt. A bridge
 * manager whose turn ends before the bridge acknowledges it then still names its session:
 * magnetar-rust-20261018b:s2 ran 177 model calls in supervised-manager-46c412bb9975, and its
 * receipts read `root-agent-did-not-report` with no session at all.
 */
export function noteScopeOwnerPlannedExecution(
  scope: Scope<unknown>,
  execution: MaterializedExecutionIdentity,
): void {
  const state = ownerMaterializationStates.get(scope)
  if (state === undefined) return
  state.plannedExecution = Object.freeze({
    attemptId: state.attemptId,
    execution: Object.freeze({ ...execution }),
  })
}

export const ownerMaterializationStates = new WeakMap<Scope<unknown>, OwnerMaterializationState>()

/**
 * One owner materialization write at a time. A cancelled run settles without waiting for its root
 * driver, so the driver's late receipt and the settlement's finalization could each read no
 * receipt before the other's journal append returned, and both appended one: the journal then
 * refused the run as corrupted (duplicate materialization receipt).
 */
function serializedOwnerWrite<T>(
  state: OwnerMaterializationState,
  write: () => Promise<T>,
): Promise<T> {
  const next = (state.writes ?? Promise.resolve()).then(write, write)
  state.writes = next.catch(() => undefined)
  return next
}

/**
 * @internal Publish exact root-manager materialization from a runtime-owned adapter after dynamic
 * attachments exist and before its executor starts. This is deliberately a module function backed
 * by a private WeakMap, not a Scope method an Agent can call.
 */
export async function recordScopeOwnerMaterialization(
  scope: Scope<unknown>,
  runtime: NodeSnapshot['runtime'],
  declaration: import('./types').ExecutorMaterialization,
  bindingInput: ExecutorExecutionBinding,
): Promise<void> {
  const state = ownerMaterializationState(scope)
  await serializedOwnerWrite(state, () =>
    publishOwnerMaterialization(state, runtime, declaration, bindingInput),
  )
}

async function publishOwnerMaterialization(
  state: OwnerMaterializationState,
  runtime: NodeSnapshot['runtime'],
  declaration: import('./types').ExecutorMaterialization,
  bindingInput: ExecutorExecutionBinding,
): Promise<void> {
  if (runtime !== state.runtime) {
    await rejectOwnerMaterialization(state)
    throw new ValidationError(
      `scope owner materialization runtime ${JSON.stringify(runtime)} does not match ${JSON.stringify(state.runtime)}`,
    )
  }
  if (state.authoredProfileDigest === undefined) {
    await rejectOwnerMaterialization(state)
    throw new ValidationError('scope owner materialization requires an exact authored profile')
  }
  let receipt: ProfileMaterializationReceipt
  let binding: ExecutionBindingReceipt
  try {
    if (bindingInput.attemptId !== state.attemptId) {
      throw new ValidationError(
        'scope owner execution binding does not use the kernel-minted attempt id',
      )
    }
    receipt = knownMaterializationReceipt({
      authoredProfileDigest: state.authoredProfileDigest,
      runtime,
      declaration,
    })
    binding = knownExecutionBindingReceipt(receipt, bindingInput)
  } catch (error) {
    await rejectOwnerMaterialization(state)
    throw new ValidationError('scope owner returned invalid materialization evidence', {
      cause: error,
    })
  }
  const committed = state.receipt ?? state.prior
  if (
    committed?.status === 'known' &&
    canonicalCandidateDigest(committed) !== canonicalCandidateDigest(receipt)
  ) {
    const events = (await state.journal.loadTree(state.retainedRoot)) ?? []
    const started = [...events]
      .reverse()
      .find(
        (event) =>
          event.id === state.nodeId && event.kind === 'seat-segment' && event.phase === 'started',
      )
    const latestMaterialization = [...events]
      .reverse()
      .find(
        (event) =>
          event.id === state.nodeId &&
          (event.kind === 'materialized' || event.kind === 'seat-materialized'),
      )
    const lastSegmentIndex =
      latestMaterialization?.kind === 'seat-materialized' ? latestMaterialization.segmentIndex : 0
    const authored = agentProfileSchema.safeParse(state.authoredProfile)
    const authoredProfile = authored.success ? authored.data : undefined
    const stage =
      authoredProfile && started?.kind === 'seat-segment'
        ? authoredSeatStages(authoredProfile)?.[started.stageIndex]
        : undefined
    if (
      authoredProfile &&
      stage &&
      started?.kind === 'seat-segment' &&
      started.segmentIndex > lastSegmentIndex &&
      started.harness === stage.harness &&
      started.provider === stage.provider &&
      started.model === stage.model &&
      receipt.status === 'known' &&
      receipt.effectiveProfileDigest ===
        canonicalAgentProfileDigest(
          providerVisibleProfile(seatExecutionProfile(authoredProfile, stage)),
        ) &&
      receipt.model.status === 'known' &&
      receipt.model.id === stage.model
    ) {
      await appendOwnerSeatMaterialization(state, started.segmentIndex, receipt, binding)
      state.onReceipt?.(receipt, binding)
      state.publishedThisProcess = true
      return
    }
    // A root resumed on another segment of its registered profile (another model, effort or harness:
    // `SuperviseOptions.segment`) materializes that segment once, after its `root-segment` record, under the same
    // authored profile. Before this, the resumed root's every drive was refused "materialization changed mid-run"
    // until its retry bound (the one-run-one-id canary, 2026-10-08, 14 attempts on gpt-6.1-sol).
    const rootSegment = [...events]
      .reverse()
      .find(
        (event): event is Extract<SpawnEvent, { kind: 'root-segment' }> =>
          event.id === state.nodeId && event.kind === 'root-segment',
      )
    if (
      rootSegment !== undefined &&
      (latestMaterialization === undefined ||
        events.indexOf(rootSegment) > events.indexOf(latestMaterialization)) &&
      receipt.status === 'known' &&
      receipt.authoredProfileDigest === committed.authoredProfileDigest &&
      (rootSegment.to.model === undefined ||
        (receipt.model.status === 'known' && receipt.model.id === rootSegment.to.model))
    ) {
      await appendOwnerSeatMaterialization(state, lastSegmentIndex + 1, receipt, binding)
      state.onReceipt?.(receipt, binding)
      state.publishedThisProcess = true
      return
    }
  }
  if (state.prior !== undefined && state.receipt === undefined) {
    if (canonicalCandidateDigest(state.prior) !== canonicalCandidateDigest(receipt)) {
      await rejectOwnerMaterialization(state)
      throw new ValidationError(
        'scope owner materialization changed across resume; backend, model, execution identity, and plan must match',
      )
    }
    state.receipt = state.prior
    await appendOwnerBinding(state, binding)
    state.onReceipt?.(state.prior, binding)
    state.publishedThisProcess = true
    return
  }
  if (state.receipt !== undefined && state.receipt.status !== 'known') {
    // The committed receipt is `unknown`: an attempt ended before its agent reported, and
    // finalization recorded that (finalizeOwnerMaterialization). It attests no backend, model, plan
    // or execution identity, so a report that arrives later cannot have changed one. Refusing it
    // as "changed mid-run: status" killed owners that had already done their work: a retained
    // owner whose pending executor publishes at result time loses the race to the scope's
    // finalization, and an owner whose first attempt failed before reporting dies on the attempt
    // that succeeds. Measured on Discovery 2026-10-01..05: 20 such refusals, classified terminal,
    // after 5 to 96 minutes of each node's work. The committed record stays `unknown`; an attempt
    // not yet bound binds its transport to it, and an attempt finalization already bound keeps
    // that binding, because the journal holds one binding per attempt.
    if (!state.bindingPublished) {
      const boundToCommitted = knownExecutionBindingReceipt(state.receipt, bindingInput)
      await appendOwnerBinding(state, boundToCommitted)
      state.onReceipt?.(state.receipt, boundToCommitted)
    }
    state.publishedThisProcess = true
    return
  }
  if (state.receipt !== undefined) {
    // A root driver may be re-entered inside one process after a transient executor failure
    // (`runDriverWithRetry`, #741). That attempt publishes the SAME materialization with a NEW
    // execution binding, which is the resume path's shape minus the process boundary — so it
    // appends a binding rather than a second receipt. A materialization that actually CHANGED is
    // still a fault: backend, model, execution identity, and plan may not move under a live run.
    if (canonicalCandidateDigest(state.receipt) !== canonicalCandidateDigest(receipt)) {
      const changed = changedRunIdentityFields(state.receipt, receipt)
      if (changed.length > 0) {
        await rejectOwnerMaterialization(state)
        throw new ValidationError(
          'scope owner materialization changed mid-run; these fields must match across driver ' +
            `attempts but differ: ${changed.join(', ')}`,
        )
      }
      // The attempt ran in a DIFFERENT execution instance with everything else identical, which is
      // Runtime's own doing: a continuation re-entry asks the provider for a new environment,
      // and a retained environment can be replaced between attempts. Rejecting it stranded a root
      // that had already completed a turn (agent-runtime#1225): the refusal surfaced as a transient
      // RetainedExecutionPendingError and every remaining driver attempt hit the same wall.
      // The committed materialization stays the run's identity — the journal commits one per node —
      // and this attempt binds to it. Which instance served the attempt is per-attempt routing, and
      // the admission events already name it.
      const boundToCommitted = knownExecutionBindingReceipt(state.receipt, bindingInput)
      await appendOwnerBinding(state, boundToCommitted)
      state.onReceipt?.(state.receipt, boundToCommitted)
      state.publishedThisProcess = true
      return
    }
    await appendOwnerBinding(state, binding)
    state.onReceipt?.(state.receipt, binding)
    state.publishedThisProcess = true
    return
  }
  await appendOwnerMaterialization(state, receipt, binding)
  state.onReceipt?.(receipt, binding)
  state.publishedThisProcess = true
}

/** @internal Kernel identity for constructing the exact deferred owner executor. */
/**
 * @internal Each driver attempt of the scope owner is its own execution attempt. A driver retry
 * after a failed drive, and the continuation re-entry after an unmet completion check, both
 * run the harness again and report a new execution binding; the journal keys owner bindings by
 * attempt id, so every attempt after the first is given a fresh kernel-minted id and its
 * published flags are cleared, and the new binding lands beside the earlier ones. The first
 * attempt keeps the id minted at run start. Returns the id the attempt reports under, or
 * undefined when the scope owner is not a deferred runtime-owned root.
 */
export function beginScopeOwnerAttempt(scope: Scope<unknown>, attempt: number): string | undefined {
  const state = ownerMaterializationStates.get(scope)
  if (state === undefined) return undefined
  if (attempt > 1) {
    state.attemptId = newExecutionAttemptId(state.nodeId)
    state.bindingPublished = false
    state.publishedThisProcess = false
  }
  return state.attemptId
}

export function scopeOwnerExecutorNodeContext(scope: Scope<unknown>): ExecutorNodeContext {
  const state = ownerMaterializationState(scope)
  return Object.freeze({
    rootId: state.root,
    parentId: state.nodeId,
    nodeId: state.nodeId,
    depth: state.depth,
    attemptId: state.attemptId,
  })
}

/** Reuse a committed owner invocation without inventing another provider attempt. @internal */
export async function restoreScopeOwnerAcceptedExecution(scope: Scope<unknown>): Promise<void> {
  const state = ownerMaterializationState(scope)
  const events = (await state.journal.loadTree(state.retainedRoot)) ?? []
  const owned = events.filter((event) => event.id === state.nodeId)
  const latestInput = [...owned].reverse().find((event) => event.kind === 'execution-input')
  const latestResult = [...owned].reverse().find((event) => event.kind === 'execution-result')
  const inputIndex = latestInput === undefined ? -1 : owned.indexOf(latestInput)
  const resultIndex = latestResult === undefined ? -1 : owned.indexOf(latestResult)
  const result = owned[resultIndex]
  if (inputIndex < 0 || resultIndex <= inputIndex || result?.kind !== 'execution-result') {
    throw new ValidationError('scope owner has no accepted retained invocation')
  }
  const receiptEvent = owned
    .slice(0, resultIndex)
    .reverse()
    .find((event) => event.kind === 'materialized' || event.kind === 'seat-materialized')
  const bindingEvent = owned
    .slice(inputIndex, resultIndex)
    .reverse()
    .find((event) => event.kind === 'execution-bound')
  if (
    (receiptEvent?.kind !== 'materialized' && receiptEvent?.kind !== 'seat-materialized') ||
    bindingEvent?.kind !== 'execution-bound'
  ) {
    throw new ValidationError(
      'accepted scope owner result has no preceding materialization evidence',
    )
  }
  const { receipt } = receiptEvent
  const { binding } = bindingEvent
  if (
    receipt.status !== 'known' ||
    binding.status !== 'known' ||
    receipt.runtime !== state.runtime ||
    receipt.authoredProfileDigest !== state.authoredProfileDigest ||
    binding.materializationReceiptDigest !== canonicalCandidateDigest(receipt) ||
    ((state.receipt ?? state.prior) !== undefined &&
      canonicalCandidateDigest(state.receipt ?? state.prior) !== canonicalCandidateDigest(receipt))
  ) {
    throw new ValidationError(
      'accepted scope owner materialization does not match the resumed owner',
    )
  }
  assertValidSpend(result.spent, 'accepted scope owner result')
  const output = await state.blobs.get(result.outRef)
  if (output === undefined || contentAddress(output) !== result.outRef) {
    throw new ValidationError('accepted scope owner output is missing or corrupt')
  }
  state.receipt = receipt
  state.bindingPublished = true
  state.publishedThisProcess = true
  state.onReceipt?.(receipt, binding)
}

/** @internal Ensure a deferred root that never published evidence remains visibly unknown. */
export async function finalizeScopeOwnerMaterialization(scope: Scope<unknown>): Promise<void> {
  const state = ownerMaterializationStates.get(scope)
  if (state === undefined) return
  await serializedOwnerWrite(state, () => finalizeOwnerMaterialization(state))
}

async function finalizeOwnerMaterialization(state: OwnerMaterializationState): Promise<void> {
  // Rejection paths publish an unknown binding before returning the original validation error.
  // Finalization still runs after that error, so it must not append the same attempt again.
  if (state.publishedThisProcess || state.bindingPublished) return
  if (state.prior !== undefined) {
    await appendUnknownOwnerBinding(state, state.prior, 'root-agent-did-not-report')
    throw new ValidationError(
      'resumed scope owner did not re-attest its prior materialization before execution',
    )
  }
  if (state.receipt !== undefined) return
  // An attempt that started a planned execution and ended before its acknowledgement failed
  // before its receipt; only an owner that never started one did not report.
  const planned =
    state.plannedExecution?.attemptId === state.attemptId ? state.plannedExecution : undefined
  const reason = planned ? 'executor-failed-before-receipt' : 'root-agent-did-not-report'
  const receipt = unknownMaterializationReceipt({
    ...(state.authoredProfileDigest === undefined
      ? {}
      : { authoredProfileDigest: state.authoredProfileDigest }),
    runtime: state.runtime,
    reason,
  })
  const binding = unknownExecutionBindingReceipt(
    receipt,
    state.attemptId,
    reason,
    planned?.execution,
  )
  await appendOwnerMaterialization(state, receipt, binding)
  state.onReceipt?.(receipt, binding)
  if (state.requiredKnown) {
    throw new ValidationError(
      'runtime-owned scope owner did not publish materialization before completing',
    )
  }
}

function ownerMaterializationState(scope: Scope<unknown>): OwnerMaterializationState {
  const state = ownerMaterializationStates.get(scope)
  if (state === undefined) {
    throw new ValidationError('scope has no deferred runtime-owned root materialization channel')
  }
  return state
}

async function rejectOwnerMaterialization(state: OwnerMaterializationState): Promise<void> {
  if (state.bindingPublished) return
  if (state.prior !== undefined) {
    await appendUnknownOwnerBinding(state, state.prior, 'invalid-executor-report')
    return
  }
  if (state.receipt !== undefined) {
    await appendUnknownOwnerBinding(state, state.receipt, 'invalid-executor-report')
    return
  }
  const receipt = unknownMaterializationReceipt({
    ...(state.authoredProfileDigest === undefined
      ? {}
      : { authoredProfileDigest: state.authoredProfileDigest }),
    runtime: state.runtime,
    reason: 'invalid-executor-report',
  })
  const binding = unknownExecutionBindingReceipt(
    receipt,
    state.attemptId,
    'invalid-executor-report',
  )
  await appendOwnerMaterialization(state, receipt, binding)
  state.onReceipt?.(receipt, binding)
}

/**
 * The fields two known receipts disagree on, ignoring which execution instance served the attempt.
 * Empty means only the instance moved, which a re-prompted attempt is allowed to do: Runtime asks
 * the provider for a new environment when it re-prompts an unmet completion check, and a retained
 * environment can be replaced between attempts.
 *
 * This answers WHICH field moved, not just THAT one did. The guard used to return a boolean, so a
 * production rejection named four candidate fields and identified none of them. Measured on
 * mech-interp-foundations-pi-20260915g and -20260915h: ten rejected bindings across two runs, and
 * the receipt that was rejected is not journalled, so no operator could tell from the record which
 * field had changed. A guard that refuses a live run owes the reason.
 */
function changedRunIdentityFields(
  prior: ProfileMaterializationReceipt,
  next: ProfileMaterializationReceipt,
): readonly string[] {
  if (prior.status !== 'known' || next.status !== 'known') return ['status']
  const withoutInstance = (
    receipt: Extract<ProfileMaterializationReceipt, { status: 'known' }>,
  ): Record<string, unknown> => {
    const { execution, ...rest } = receipt
    return { ...rest, execution: { kind: execution.kind } }
  }
  const before = withoutInstance(prior)
  const after = withoutInstance(next)
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return names.filter(
    (name) => canonicalCandidateDigest(before[name]) !== canonicalCandidateDigest(after[name]),
  )
}

async function appendOwnerMaterialization(
  state: OwnerMaterializationState,
  receipt: ProfileMaterializationReceipt,
  binding: ExecutionBindingReceipt,
): Promise<void> {
  await appendOwnerEvidence(state, {
    kind: 'materialized',
    id: state.nodeId,
    receipt,
    seq: 0,
    at: new Date(state.now()).toISOString(),
  })
  state.receipt = receipt
  await appendOwnerBinding(state, binding)
}

async function appendOwnerSeatMaterialization(
  state: OwnerMaterializationState,
  segmentIndex: number,
  receipt: ProfileMaterializationReceipt,
  binding: ExecutionBindingReceipt,
): Promise<void> {
  await appendOwnerEvidence(state, {
    kind: 'seat-materialized',
    id: state.nodeId,
    segmentIndex,
    receipt,
    seq: segmentIndex,
    at: new Date(state.now()).toISOString(),
  })
  state.receipt = receipt
  await appendOwnerBinding(state, binding)
}

async function appendOwnerBinding(
  state: OwnerMaterializationState,
  binding: ExecutionBindingReceipt,
): Promise<void> {
  await appendOwnerEvidence(state, {
    kind: 'execution-bound',
    id: state.nodeId,
    binding,
    seq: 0,
    at: new Date(state.now()).toISOString(),
  })
  state.bindingPublished = true
}

async function appendOwnerEvidence(
  state: OwnerMaterializationState,
  event: Extract<SpawnEvent, { kind: 'materialized' | 'seat-materialized' | 'execution-bound' }>,
): Promise<void> {
  for (const root of new Set([state.root, state.retainedRoot])) {
    await appendExactMaterializationEvent(state.journal, root, event)
  }
}

export async function appendExactMaterializationEvent(
  journal: SpawnJournal,
  root: NodeId,
  event: Extract<SpawnEvent, { kind: 'materialized' | 'seat-materialized' | 'execution-bound' }>,
): Promise<void> {
  const prior = (await journal.loadTree(root))?.find(
    (item) =>
      item.id === event.id &&
      (event.kind === 'materialized'
        ? item.kind === 'materialized'
        : event.kind === 'seat-materialized'
          ? item.kind === 'seat-materialized' && item.segmentIndex === event.segmentIndex
          : item.kind === 'execution-bound' && item.binding.attemptId === event.binding.attemptId),
  )
  if (
    prior?.kind === 'materialized' ||
    prior?.kind === 'seat-materialized' ||
    prior?.kind === 'execution-bound'
  ) {
    const previous = prior.kind === 'execution-bound' ? prior.binding : prior.receipt
    const next = event.kind === 'execution-bound' ? event.binding : event.receipt
    if (canonicalCandidateDigest(previous) !== canonicalCandidateDigest(next)) {
      throw new ValidationError('scope execution evidence conflicts with its committed record')
    }
    return
  }
  await journal.appendEvent(root, event)
}

async function appendUnknownOwnerBinding(
  state: OwnerMaterializationState,
  receipt: ProfileMaterializationReceipt,
  reason: import('./types').UnknownMaterializationReason,
): Promise<void> {
  const binding = unknownExecutionBindingReceipt(receipt, state.attemptId, reason)
  await appendOwnerBinding(state, binding)
  state.onReceipt?.(receipt, binding)
}

export function bindScopeOwnerMaterialization(
  scope: Scope<unknown>,
  args: ScopeArgs,
  now: () => number,
): void {
  if (args.ownerMaterialization !== undefined) {
    const authoredProfile =
      args.ownerMaterialization.authoredProfile === undefined
        ? undefined
        : detachedSnapshot(
            args.ownerMaterialization.authoredProfile,
            'scope owner authored profile',
          )
    ownerMaterializationStates.set(scope as Scope<unknown>, {
      retainedRoot: args.root,
      blobs: args.blobs,
      journal: args.journal,
      root: args.ownerMaterialization.journalRoot ?? args.root,
      nodeId: args.ownerMaterialization.nodeId ?? args.parentId,
      depth: args.depth,
      runtime: args.ownerMaterialization.runtime,
      attemptId: args.ownerMaterialization.attemptId,
      ...(authoredProfile === undefined ? {} : { authoredProfile }),
      ...(authoredProfile === undefined
        ? {}
        : { authoredProfileDigest: authoredProfileDigest(authoredProfile) }),
      ...(args.ownerMaterialization.prior === undefined
        ? {}
        : { prior: args.ownerMaterialization.prior }),
      requiredKnown: args.ownerMaterialization.requiredKnown === true,
      ...(args.ownerMaterialization.onReceipt === undefined
        ? {}
        : { onReceipt: args.ownerMaterialization.onReceipt }),
      now,
      receipt: args.ownerMaterialization.prior,
      bindingPublished: false,
      publishedThisProcess: false,
    })
  }
}
