import { canonicalCandidateDigest, type Sha256Digest } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import {
  authoredProfileDigest,
  knownExecutionBindingReceipt,
  knownMaterializationReceipt,
  unknownExecutionBindingReceipt,
  unknownMaterializationReceipt,
} from './materialization'
import type { ScopeArgs } from './scope-types'
import { detachedSnapshot } from './snapshot'
import type {
  ExecutionBindingReceipt,
  ExecutorExecutionBinding,
  ExecutorMaterialization,
  ExecutorNodeContext,
  NodeId,
  NodeSnapshot,
  ProfileMaterializationReceipt,
  Scope,
  SpawnJournal,
} from './types'

interface OwnerMaterializationState {
  readonly journal: SpawnJournal
  readonly root: NodeId
  readonly nodeId: NodeId
  readonly runtime: NodeSnapshot['runtime']
  readonly attemptId: string
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
}

const ownerMaterializationStates = new WeakMap<Scope<unknown>, OwnerMaterializationState>()

export function initializeOwnerMaterializationState(
  scope: Scope<unknown>,
  args: ScopeArgs,
  now: () => number,
): void {
  const owner = args.ownerMaterialization
  if (owner === undefined) return
  const authoredProfile =
    owner.authoredProfile === undefined
      ? undefined
      : detachedSnapshot(owner.authoredProfile, 'scope owner authored profile')
  ownerMaterializationStates.set(scope, {
    journal: args.journal,
    root: owner.journalRoot ?? args.root,
    nodeId: owner.nodeId ?? args.parentId,
    runtime: owner.runtime,
    attemptId: owner.attemptId,
    ...(authoredProfile === undefined ? {} : { authoredProfile }),
    ...(authoredProfile === undefined
      ? {}
      : { authoredProfileDigest: authoredProfileDigest(authoredProfile) }),
    ...(owner.prior === undefined ? {} : { prior: owner.prior }),
    requiredKnown: owner.requiredKnown === true,
    ...(owner.onReceipt === undefined ? {} : { onReceipt: owner.onReceipt }),
    now,
    receipt: owner.prior,
    bindingPublished: false,
    publishedThisProcess: false,
  })
}

export async function recordScopeOwnerMaterialization(
  scope: Scope<unknown>,
  runtime: NodeSnapshot['runtime'],
  declaration: ExecutorMaterialization,
  bindingInput: ExecutorExecutionBinding,
): Promise<void> {
  const state = ownerMaterializationState(scope)
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
    if (canonicalCandidateDigest(declaration.effectiveProfile) !== state.authoredProfileDigest) {
      throw new ValidationError(
        'scope owner stable effective profile conflicts with its admitted authored profile',
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
  if (state.prior !== undefined) {
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
  if (state.receipt !== undefined) {
    throw new ValidationError('scope owner materialization was already recorded')
  }
  await appendOwnerMaterialization(state, receipt, binding)
  state.onReceipt?.(receipt, binding)
  state.publishedThisProcess = true
}

export function scopeOwnerExecutorNodeContext(scope: Scope<unknown>): ExecutorNodeContext {
  const state = ownerMaterializationState(scope)
  return Object.freeze({
    rootId: state.root,
    parentId: state.nodeId,
    nodeId: state.nodeId,
    attemptId: state.attemptId,
  })
}

export async function finalizeScopeOwnerMaterialization(scope: Scope<unknown>): Promise<void> {
  const state = ownerMaterializationStates.get(scope)
  if (state === undefined || state.publishedThisProcess) return
  if (state.prior !== undefined) {
    await appendUnknownOwnerBinding(state, state.prior, 'root-agent-did-not-report')
    throw new ValidationError(
      'resumed scope owner did not re-attest its prior materialization before execution',
    )
  }
  if (state.receipt !== undefined) return
  const receipt = unknownMaterializationReceipt({
    ...(state.authoredProfileDigest === undefined
      ? {}
      : { authoredProfileDigest: state.authoredProfileDigest }),
    runtime: state.runtime,
    reason: 'root-agent-did-not-report',
  })
  const binding = unknownExecutionBindingReceipt(
    receipt,
    state.attemptId,
    'root-agent-did-not-report',
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

async function appendOwnerMaterialization(
  state: OwnerMaterializationState,
  receipt: ProfileMaterializationReceipt,
  binding: ExecutionBindingReceipt,
): Promise<void> {
  await state.journal.appendEvent(state.root, {
    kind: 'materialized',
    id: state.nodeId,
    receipt,
    seq: 0,
    at: new Date(state.now()).toISOString(),
  })
  state.receipt = receipt
  await appendOwnerBinding(state, binding)
}

async function appendOwnerBinding(
  state: OwnerMaterializationState,
  binding: ExecutionBindingReceipt,
): Promise<void> {
  await state.journal.appendEvent(state.root, {
    kind: 'execution-bound',
    id: state.nodeId,
    binding,
    seq: 0,
    at: new Date(state.now()).toISOString(),
  })
  state.bindingPublished = true
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
