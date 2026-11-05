import { closesCursorSlot } from '../../durable/spawn-journal/event-index'
import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { errMessage } from './error-message'
import { isTerminalNodeStatus } from './node-status'
import { retainedOwnerReleaseRetriable } from './retained-scope-owner'
import {
  closeRetainedSlots,
  hasRetriableTeardowns,
  nestedManagerScopeReaders,
  RETAINED_RELEASE_TIMEOUT_MS,
  retainedReleasers,
  retainedSlotClosers,
  retryUnconfirmedTeardowns,
  teardownRetriable,
  teardownRetriers,
  unconfirmedTeardowns,
} from './scope-capabilities'
import type { LiveChild, ScopeArgs } from './scope-contract'
import { appendEnvironmentTeardown } from './scope-settlement'
import { releasedChildPayload, terminalDownEvent } from './terminal-record'
import type {
  EnvironmentTeardownReceipt,
  HeldRelease,
  NodeId,
  RetainedExecutionState,
  Scope,
  SpawnEvent,
} from './types'

/** Release settled child environments and close their retained journal slots. */
export function createHeldChildRelease(args: ScopeArgs, now: () => number) {
  // In flight, so the join barrier waits for a ceiling or cancel release that already started.
  const heldReleases = new Set<Promise<boolean>>()
  /** Release the environment a settled child holds after a budget stop, once, and journal why. */
  function releaseHeld(child: LiveChild, reason: HeldRelease): Promise<boolean> {
    const held = child.held
    if (held === undefined) return Promise.resolve(false)
    child.held = undefined
    held.clearCeiling?.()
    const release = (async () => {
      const answer = await held.continuation
        .release()
        .catch((error: unknown) => ({ destroyed: false, detail: errMessage(error) }))
      if (answer.destroyed) child.cleanupConfirmed = true
      else if (answer.detail !== undefined) child.teardownDetail = answer.detail
      await appendEnvironmentTeardown(
        args.journal,
        args.root,
        child.id,
        {
          provider: held.continuation.provider,
          environmentId: held.continuation.environmentId,
          destroyed: answer.destroyed,
          ...(answer.detail === undefined ? {} : { detail: answer.detail }),
        },
        new Date(now()).toISOString(),
        reason,
      ).catch(() => undefined)
      return true
    })()
    heldReleases.add(release)
    void release.finally(() => heldReleases.delete(release))
    return release
  }

  return { releaseHeld, heldReleases }
}

export function bindChildTeardown<Out>(
  scope: Scope<Out>,
  args: ScopeArgs,
  children: Map<NodeId, LiveChild>,
  now: () => number,
): void {
  // Pending owned managers still need their own release even after descendants confirmed.
  const retainedHeld = (): LiveChild[] =>
    [...children.values()].filter(
      (child) =>
        isTerminalNodeStatus(child.status) &&
        (!child.cleanupConfirmed ||
          (child.recoveryPending === true && child.ownedTreeRoot !== undefined)) &&
        child.retainedExecution !== 'released' &&
        (child.recoveryPending === true || child.ownedTreeRoot !== undefined) &&
        child.teardownPermanent !== true &&
        child.releaseRetained !== undefined &&
        child.confirmTeardown !== undefined,
    )
  // Ordinary cleanup retries skip retained executions; their continuation owns release.
  const retriableTeardowns = (): LiveChild[] =>
    [...children.values()].filter((child) => {
      if (
        !isTerminalNodeStatus(child.status) ||
        child.cleanupConfirmed ||
        child.recoveryPending === true ||
        child.teardownPermanent === true ||
        child.askTeardown === undefined
      ) {
        return false
      }
      const nested = child.readNestedScope?.()
      return (
        nested === undefined ||
        unconfirmedTeardowns(nested).length === 0 ||
        hasRetriableTeardowns(nested, false)
      )
    })
  // Permanent refusals cannot change on another sweep.
  const releasable = (): LiveChild[] =>
    retainedHeld().filter((child) => {
      const nested = child.readNestedScope?.()
      return (
        child.ownedTreeRoot === undefined ||
        nested === undefined ||
        hasRetriableTeardowns(nested, true)
      )
    })
  teardownRetriable.set(
    scope,
    (release) =>
      retriableTeardowns().length > 0 ||
      (release && (releasable().length > 0 || retainedOwnerReleaseRetriable(scope))),
  )
  nestedManagerScopeReaders.set(scope, () =>
    [...children.values()].flatMap((child) => {
      const nested = child.readNestedScope?.()
      return nested === undefined ? [] : [nested]
    }),
  )
  teardownRetriers.set(scope, async () => {
    await Promise.all(
      retriableTeardowns().map((child) => {
        child.teardownRetry ??= (async () => {
          try {
            // Descendants first: a manager's teardown confirms only once its own tree has.
            const nested = child.readNestedScope?.()
            if (nested !== undefined) await retryUnconfirmedTeardowns(nested)
            // A settlement request that missed its acknowledgement window is still this child's
            // request in flight; the asker hands it back rather than sending another beside it.
            const receipt = await child.askTeardown!('brutalKill')
            if (receipt.destroyed) {
              child.cleanupConfirmed = true
              child.teardownDetail = undefined
            } else {
              child.teardownDetail = `executor teardown reported destroyed=false${
                receipt.detail ? `: ${receipt.detail}` : ''
              }`
              if (receipt.permanent === true) child.teardownPermanent = true
            }
          } catch (error) {
            child.teardownDetail = errMessage(error)
          } finally {
            child.teardownRetry = undefined
          }
        })()
        return child.teardownRetry
      }),
    )
  })
  retainedReleasers.set(scope, async () => {
    // Any other unconfirmed child (a destroy that failed on the ordinary path) is retried by
    // `teardownRetriers`, not here.
    const held = retainedHeld()
    const released = await Promise.all(
      held.map(
        async (
          child,
        ): Promise<{ child: LiveChild; receipts: ReadonlyArray<EnvironmentTeardownReceipt> }> => {
          child.cleanupConfirmed = false
          const bound = new AbortController()
          const timer = setTimeout(
            () =>
              bound.abort(
                new ValidationError(
                  `retained release did not acknowledge within ${RETAINED_RELEASE_TIMEOUT_MS}ms`,
                ),
              ),
            RETAINED_RELEASE_TIMEOUT_MS,
          )
          timer.unref?.()
          try {
            const receipts = await child.releaseRetained!(bound.signal)
            // An environment the executor keeps on purpose, or cannot destroy, is not released by
            // asking again.
            if (receipts.some((receipt) => !receipt.destroyed && receipt.permanent === true)) {
              child.teardownPermanent = true
            }
            if (receipts.every((receipt) => receipt.destroyed)) {
              try {
                await child.confirmTeardown!()
                child.cleanupConfirmed = true
              } catch {
                // Still unconfirmed; the barrier names the node as it did before. A leaf that
                // named no environment to release has nothing a later release could destroy.
                if (receipts.length === 0 && child.ownedTreeRoot === undefined) {
                  child.teardownPermanent = true
                }
              }
            }
            return { child, receipts }
          } catch {
            // The executor answered with no receipt at all. Nothing can be named, so the node
            // stays unconfirmed rather than being receipted as released.
            return { child, receipts: [] }
          } finally {
            clearTimeout(timer)
          }
        },
      ),
    )
    // Snapshot duplicate guards once for the whole sweep.
    const prior = released.length > 0 ? ((await args.journal.loadTree(args.root)) ?? []) : []
    for (const { child, receipts } of released) {
      for (const receipt of receipts) {
        await appendEnvironmentTeardown(
          args.journal,
          args.root,
          child.id,
          receipt,
          new Date(now()).toISOString(),
        )
      }
      // Only acknowledged native receipts may reduce a paused child's remaining backing.
      await child.admission.prepareAccounting?.()
      // Close only after this pass's release and confirmation acknowledgements. A manager
      // journals its native receipts inside its own tree and may return []; confirmation
      // must still find no owner or descendant debt. Refusals remain unconfirmed.
      // The durable floor retains the original settlement and cursor seq for crash healing.
      if (child.cleanupConfirmed) await closeRetainedSlot(child, 'released', prior)
    }
  })
  // One writer for the record that closes a retained child's slot, in either state, so the
  // released record and the unconfirmed one can never disagree on a field.
  const closeRetainedSlot = async (
    child: LiveChild,
    state: Exclude<RetainedExecutionState, 'pending'>,
    prior: ReadonlyArray<SpawnEvent>,
  ): Promise<void> => {
    if (
      child.recoveryPending !== true ||
      child.resolved?.kind !== 'down' ||
      child.settledSeq === undefined ||
      child.settledAt === undefined ||
      child.retainedExecution === 'released' ||
      child.retainedExecution === 'release-unconfirmed' ||
      prior.some((event) => event.id === child.id && closesCursorSlot(event))
    ) {
      return
    }
    child.budgetViolation = child.retainedViolation
    const settledAt = child.settledAt
    // The record restates the driver's settlement, with one exception: a session the release read
    // after the failure path could not. Only an available receipt replaces the earlier one.
    let settlement = child.resolved
    if (settlement.harnessTranscript?.status !== 'available' && child.readTranscriptAtRelease) {
      const atRelease = await child.readTranscriptAtRelease()
      if (atRelease.status === 'available')
        settlement = { ...settlement, harnessTranscript: atRelease }
    }
    await args.journal.appendEvent(
      args.root,
      terminalDownEvent(
        child,
        settlement,
        child.settledSeq,
        new Date(settledAt).toISOString(),
        state,
      ),
    )
    child.retainedExecution = state
    const closedAt = now()
    // Restate the settlement in hook order without metering inference twice.
    notifyRuntimeHookEvent(
      args.hooks,
      {
        id: `${child.id}:${state}`,
        runId: args.root,
        target: 'agent.child',
        phase: 'after',
        timestamp: closedAt,
        stepIndex: child.settledSeq,
        parentId: args.parentId,
        payload: releasedChildPayload(child, settlement, settledAt, closedAt, state),
      },
      { signal: args.signal },
    )
  }
  retainedSlotClosers.set(scope, async () => {
    // Descendants first, in their own trees: a nested manager's retained children close where its
    // scope journals them, whether the manager itself settled or is retained too.
    for (const child of children.values()) {
      const nested = child.readNestedScope?.()
      if (nested !== undefined) await closeRetainedSlots(nested)
    }
    // The sweep (or crash healing) owns confirmed release. Close remaining cursor slots
    // as unconfirmed, independently of a stale descendant-only cleanup flag.
    const open = [...children.values()].filter(
      (child) =>
        child.recoveryPending === true &&
        isTerminalNodeStatus(child.status) &&
        child.retainedExecution !== 'released' &&
        child.retainedExecution !== 'release-unconfirmed',
    )
    if (open.length === 0) return
    const prior = (await args.journal.loadTree(args.root)) ?? []
    for (const child of open) await closeRetainedSlot(child, 'release-unconfirmed', prior)
  })
}
