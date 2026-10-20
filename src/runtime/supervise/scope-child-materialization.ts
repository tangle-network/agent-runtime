import { ValidationError } from '../../errors'
import { authoredProfileDigest, knownExecutionBindingReceipt, knownMaterializationReceipt, runtimeOwnedDeferredExecutorRuntime, runtimeOwnedExecutorExecutionBinding, runtimeOwnedExecutorMaterialization, runtimeOwnedPendingExecutorMaterialization, unknownExecutionBindingReceipt, unknownMaterializationReceipt } from './materialization'
import { type RetainedChildRecovery } from './retained-executor'
import { type DeferredOwnerSlot, type LiveChild, type ScopeArgs } from './scope-contract'
import { appendExactMaterializationEvent } from './scope-owner-materialization'
import { type AgentSpec, type ExecutionBindingReceipt, type Executor, type NodeExecutionIdentity, type NodeId, type ProfileMaterializationReceipt } from './types'

/** Publish the execution receipt only after the child spawn is durable. */
export function createChildMaterialization({ args, spawnCommitted, identity, spec, executor,
  deferredOwner, attemptId, id, recovery, live, ordinal, now,
}: {
  args: ScopeArgs; spawnCommitted: Promise<void>; identity: NodeExecutionIdentity | undefined;
  spec: AgentSpec; executor: Executor<unknown>; deferredOwner: DeferredOwnerSlot;
  attemptId: string; id: NodeId; recovery: RetainedChildRecovery | undefined;
  live: LiveChild; ordinal: number; now: () => number;
}) {
  let pendingEvidence: { complete: () => Promise<void>; fail: () => Promise<void> } | undefined
  const ready = spawnCommitted.then(async () => {
    const profileDigest = identity?.profileDigest ?? authoredProfileDigest(spec.profile)
    let receipt: ProfileMaterializationReceipt
    let binding: ExecutionBindingReceipt
    const declaration = runtimeOwnedExecutorMaterialization(executor)
    const pending = runtimeOwnedPendingExecutorMaterialization(executor)
    const deferredRuntime = runtimeOwnedDeferredExecutorRuntime(executor)
    if (deferredRuntime !== undefined) {
      deferredOwner.ownerMaterialization = {
        runtime: deferredRuntime,
        authoredProfile: spec.profile,
        attemptId,
        journalRoot: args.root,
        nodeId: id,
        requiredKnown: true,
        ...(recovery?.priorMaterialization ? { prior: recovery.priorMaterialization } : {}),
        onReceipt(materialization, executionBinding) {
          live.runtime = materialization.runtime
          live.materialization = materialization
          live.executionBindings.push(executionBinding)
        },
      }
      return
    }
    if (pending !== undefined) {
      if (profileDigest === undefined) {
        throw new ValidationError(
          'scope.spawn: a pending materialization requires a canonical authored profile',
        )
      }
      if (pending.runtime !== executor.runtime || pending.binding.attemptId !== attemptId) {
        throw new ValidationError(
          'scope.spawn: pending executor did not bind the kernel-minted attempt id',
        )
      }
      // Validate the planned shape before spend, but do not persist it as proof that the
      // external bridge actually used it. Only the terminal acknowledgement can finalize it.
      const plannedReceipt = knownMaterializationReceipt({
        authoredProfileDigest: profileDigest,
        runtime: executor.runtime,
        declaration: pending.declaration,
      })
      if (plannedReceipt.status !== 'known') {
        throw new ValidationError('scope.spawn: pending executor returned an unknown receipt')
      }
      let recorded = false
      pendingEvidence = {
        complete: async () => {
          if (recorded) return
          const acknowledged = runtimeOwnedExecutorMaterialization(executor)
          const acknowledgedBinding = runtimeOwnedExecutorExecutionBinding(executor)
          if (acknowledged === undefined || acknowledgedBinding?.attemptId !== attemptId) {
            throw new ValidationError(
              'scope.spawn: external executor completed without a terminal materialization acknowledgement',
            )
          }
          const finalReceipt = knownMaterializationReceipt({
            authoredProfileDigest: profileDigest,
            runtime: executor.runtime,
            declaration: acknowledged,
          })
          if (finalReceipt.status !== 'known') {
            throw new ValidationError('scope.spawn: terminal materialization remained unknown')
          }
          const finalBinding = knownExecutionBindingReceipt(finalReceipt, acknowledgedBinding)
          await appendNodeMaterialization(args, id, ordinal, finalReceipt, finalBinding, now)
          live.materialization = finalReceipt
          live.executionBindings.push(finalBinding)
          recorded = true
        },
        fail: async () => {
          if (recorded) return
          // The remote turn can be acknowledged before a later local persistence/check step
          // fails. Preserve that known execution truth even though the child settles down.
          if (runtimeOwnedExecutorMaterialization(executor) !== undefined) {
            await pendingEvidence?.complete()
            return
          }
          // This is the terminal record for a failed attempt, so the receipt is not pending:
          // the child is down and the executor will never acknowledge. Recording a wait that
          // has already ended reads as "not yet known" on a row that is final, and a consumer
          // fleet mined exactly that value as a pre-launch death predictor (41 of 41 deaths).
          // The correlation was total because only this failure path ever wrote the value.
          const unknown = unknownMaterializationReceipt({
            authoredProfileDigest: profileDigest,
            runtime: executor.runtime,
            reason: 'executor-failed-before-receipt',
          })
          const unknownBinding = unknownExecutionBindingReceipt(
            unknown,
            attemptId,
            'executor-failed-before-receipt',
          )
          await appendNodeMaterialization(args, id, ordinal, unknown, unknownBinding, now)
          live.materialization = unknown
          live.executionBindings.push(unknownBinding)
          recorded = true
        },
      }
      return
    }
    if (declaration === undefined) {
      receipt = unknownMaterializationReceipt({
        ...(profileDigest === undefined ? {} : { authoredProfileDigest: profileDigest }),
        runtime: executor.runtime,
        reason: 'executor-did-not-report',
      })
      binding = unknownExecutionBindingReceipt(receipt, attemptId, 'executor-did-not-report')
    } else {
      try {
        if (profileDigest === undefined) {
          throw new ValidationError(
            'scope.spawn: a known materialization requires a canonical authored profile',
          )
        }
        receipt = knownMaterializationReceipt({
          authoredProfileDigest: profileDigest,
          runtime: executor.runtime,
          declaration,
        })
        const reportedBinding = runtimeOwnedExecutorExecutionBinding(executor)
        if (reportedBinding === undefined || reportedBinding.attemptId !== attemptId) {
          throw new ValidationError(
            'scope.spawn: trusted executor did not bind the kernel-minted attempt id',
          )
        }
        binding = knownExecutionBindingReceipt(receipt, reportedBinding)
      } catch (error) {
        receipt = unknownMaterializationReceipt({
          ...(profileDigest === undefined ? {} : { authoredProfileDigest: profileDigest }),
          runtime: executor.runtime,
          reason: 'invalid-executor-report',
        })
        binding = unknownExecutionBindingReceipt(receipt, attemptId, 'invalid-executor-report')
        await appendNodeMaterialization(args, id, ordinal, receipt, binding, now)
        live.materialization = receipt
        live.executionBindings.push(binding)
        throw new ValidationError(
          `scope.spawn: executor ${JSON.stringify(executor.runtime)} returned invalid materialization evidence`,
          { cause: error },
        )
      }
    }
    await appendNodeMaterialization(args, id, ordinal, receipt, binding, now)
    live.materialization = receipt
    live.executionBindings.push(binding)
  })
  return { ready,
    complete: async () => pendingEvidence?.complete(),
    fail: async () => pendingEvidence?.fail(),
  }
}
export async function appendNodeMaterialization(
  args: Pick<ScopeArgs, 'journal' | 'root'>,
  id: NodeId,
  seq: number,
  receipt: ProfileMaterializationReceipt,
  binding: ExecutionBindingReceipt,
  now: () => number,
): Promise<void> {
  const at = new Date(now()).toISOString()
  await appendExactMaterializationEvent(args.journal, args.root, {
    kind: 'materialized',
    id,
    receipt,
    seq,
    at,
  })
  await appendExactMaterializationEvent(args.journal, args.root, {
    kind: 'execution-bound',
    id,
    binding,
    seq,
    at,
  })
}
