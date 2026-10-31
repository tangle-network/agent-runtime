/**
 *
 * The recursive driver-executor — the seam that lets a SPAWNED child be a DRIVER, so
 * agents drive agents drive agents over the one keystone atom.
 *
 * A spawned child resolves through the open registry to an `Executor`; the built-in
 * executors (router/inline, sandbox, cli) are LEAVES — `execute(task, signal)` runs the
 * work and settles. This executor is the recursive case: on `execute`, it mounts a NESTED
 * `Scope` (the scope hands it the mount via the `nested-scope` seam) over a child allocation
 * carved from its parent reservation, plus shared journal/blobs and the same open registry, then
 * runs the wrapped driver `Agent.act(task, nestedScope)`. The driver spawns its own
 * children into that nested scope; each resolves to EITHER a leaf executor (a worker child)
 * OR this same driver-executor (a driver child) — recursively. So a driver spawns a driver
 * spawns a worker, all on one budget-conserving tree.
 *
 * Why this preserves every keystone invariant (the scope owns the sharing; this executor
 * only runs the driver over what the scope mounts):
 *  - Conserved budget: the parent reserves the driver's whole allocation once. The nested scope
 *    partitions only that allocation, and its actual child work + driver inference reconcile the
 *    parent ticket once at settle. A deep tree cannot overspend or double-charge the root total.
 *  - Journal: the nested scope writes to its OWN tree key (`${journalRoot}/${nodeId}`) so
 *    its cursor `seq`s never collide with the parent's in the per-tree uniqueness guard,
 *    while every nested tree shares the one `SpawnJournal` — the whole recursion is one
 *    journal, queryable tree by tree.
 *  - Settlement bubbling: the driver child settles into its PARENT scope with child work and
 *    driver inference kept separate in the journal, while their sum reconciles the one parent
 *    reservation. The supervisor sees the whole sub-tree exactly once.
 *  - Depth ceiling: the nested scope runs at `depth+1`, so the supervisor's `maxDepth`
 *    (paired with the conserved pool per R3) fails a spawn closed once the recursion is too
 *    deep — exactly as it does for a flat tree.
 *
 * Layering: pure keystone composition. It reuses the scope's `NestedScopeSeam` + the shared
 * `SpawnJournal`; it builds NO new budget, journal, or selection logic. The recursion rides
 * the existing atom.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { ownedTreeRootSpawn } from '../../durable/spawn-journal/spawn-forest'
import { ValidationError } from '../../errors'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import { addSpend, zeroSpend } from '../util'
import { runAbortable } from './abortable'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import { isCredentialRefusal } from './credential-refusal'
import { ACCEPTED_RESULT_GRACE_MS, armDeadlineTimer } from './deadline'
import { classifyDriverFailure, DriverAttemptsExhaustedError } from './driver-attempt-evidence'
import { executableAgentSpecSnapshot } from './executable-spec'
import {
  attestRuntimeOwnedDeferredExecutor,
  runtimeOwnedScopeOwnerRuntime,
} from './materialization'
import type { ExecutorProgress } from './progress'
import { addResourceSpend } from './resources'
import { RetainedExecutionPendingError, retainedExecutorContext } from './retained-executor'
import {
  finalizeScopeOwnerMaterialization,
  type NestedScopeSeam,
  nestedScopeSeamKey,
  registerNestedTeardownScope,
  releaseHeldEnvironments,
  releaseManagerEnvironment,
  releaseRetainedEnvironments,
  startScopeRecoveries,
  unconfirmedTeardowns,
} from './scope'
import type { TraceSource } from './trace-source'
import { attestNestedDriverTreeOwner, driverRuntime, nestedDriverTreeRoot } from './tree-key'
import type {
  Agent,
  AgentExecutionRef,
  AgentSpec,
  DefaultVerdict,
  EnvironmentTeardownReceipt,
  Executor,
  ExecutorAccounting,
  ExecutorContext,
  ExecutorFactory,
  ExecutorRegistry,
  ExecutorResult,
  Scope,
  SpawnEvent,
  SpawnJournal,
  Spend,
} from './types'

/** A driver child's spec carries the `Agent` to run inside the nested scope. */
interface DriverSpec extends AgentSpec {
  readonly driverRuntime: typeof driverRuntime
  readonly driver: Agent<unknown, unknown>
  /** The shared journal the nested tree is one tree key inside (so the executor can
   *  begin its nested tree + sum its spend off the same record). */
  readonly journal: SpawnJournal
  /** Reads whether this manager accepted a direct result through its assignment's completion
   *  check. The check itself runs in the manager, exactly once, before this executor settles. */
  readonly acceptedSubmission?: () => boolean
  /** A seat-bearing leaf reuses the retained manager lifecycle; its original leaf check
   * still gates the outer artifact, without granting submit_result to its profile. */
  readonly leafDeliverable?: DeliverableSpec<unknown>
  /** The driver returned native evidence without an assignment quality check. */
  readonly unassessedOutput?: () => boolean
  /** Compose the settled output from the driver's result once its subtree has closed: a
   *  `run_graph` root returns `{ deliverable, edges }`, the result and the graph's edge ledger.
   *  The delivery verdict is still derived from the driver's own result. */
  readonly finishOutput?: (out: unknown) => Promise<unknown>
  readonly recoverExecutor?: ExecutorFactory<unknown>
  readonly traceSource?: () => TraceSource | undefined
  readonly progress?: () => ExecutorProgress | undefined
  /** The manager's own harness session, when its driver captures one. */
  readonly harnessTranscript?: () => HarnessTranscriptCapture | undefined
  /** Resolves once {@link harnessTranscript} is final (`Executor.harnessTranscriptSettled`). */
  readonly harnessTranscriptSettled?: () => Promise<void>
}

/**
 * Mark + carry a driver `Agent` so the recursive registry resolves it to the
 * driver-executor. The returned agent is SPAWNED (never run directly): its
 * `executorSpec` carries the exact profile, driver agent, and shared
 * journal so the executor can run its `act` inside a nested scope. `act` fails loud if
 * called directly — a driver child runs THROUGH its nested-scope executor, never as a root.
 */
export function driverChild<Out>(
  profile: AgentProfile,
  driver: Agent<unknown, Out>,
  journal: SpawnJournal,
  execution?: AgentExecutionRef,
  acceptedSubmission?: () => boolean,
  recoverExecutor?: ExecutorFactory<unknown>,
  unassessedOutput?: () => boolean,
  leafDeliverable?: DeliverableSpec<unknown>,
  finishOutput?: (out: unknown) => Promise<unknown>,
): Agent<unknown, Out> {
  const name = profile.name ?? driver.name
  const traceSource = (
    driver as Agent<unknown, Out> & {
      traceSource?: () => TraceSource | undefined
    }
  ).traceSource
  const progress = (
    driver as Agent<unknown, Out> & {
      progress?: () => ExecutorProgress | undefined
    }
  ).progress
  const harnessTranscript = driver.harnessTranscript?.bind(driver)
  const harnessTranscriptSettled = driver.harnessTranscriptSettled?.bind(driver)
  const rawSpec: DriverSpec = {
    profile,
    harness: null,
    ...(execution ? { execution } : {}),
    driverRuntime,
    driver: driver as Agent<unknown, unknown>,
    journal,
    ...(acceptedSubmission ? { acceptedSubmission } : {}),
    ...(unassessedOutput ? { unassessedOutput } : {}),
    ...(leafDeliverable ? { leafDeliverable } : {}),
    ...(finishOutput ? { finishOutput } : {}),
    ...(recoverExecutor ? { recoverExecutor } : {}),
    ...(traceSource ? { traceSource } : {}),
    ...(progress ? { progress } : {}),
    ...(harnessTranscript ? { harnessTranscript } : {}),
    ...(harnessTranscriptSettled ? { harnessTranscriptSettled } : {}),
  }
  const spec = executableAgentSpecSnapshot(rawSpec, 'driverChild') as DriverSpec
  const deliver = driver.deliver?.bind(driver)
  return {
    name,
    executorSpec: spec,
    ...(deliver
      ? {
          deliver(message: unknown): boolean {
            return deliver(message) !== false
          },
        }
      : {}),
    act(): Promise<Out> {
      throw new ValidationError(
        `driverChild: "${name}" was run directly; a driver child runs through its nested-scope executor`,
      )
    },
  } as Agent<unknown, Out> & { executorSpec: AgentSpec }
}

/** True when a spec carries Runtime's explicit nested-driver tag plus a driver Agent. */
export function isDriverSpec(spec: AgentSpec): spec is DriverSpec {
  if ((spec as { driverRuntime?: unknown }).driverRuntime !== driverRuntime) return false
  const driver = (spec as { driver?: unknown }).driver
  if (!isAgent(driver)) {
    throw new ValidationError(
      'driverExecutor: a nested-driver spec must carry a `driver` Agent to run inside its nested scope',
    )
  }
  return true
}

/**
 * The recursive driver-executor factory. `withDriverExecutor` routes a child carrying
 * Runtime's explicit nested-driver tag here; any other child resolves to a leaf built-in. On `execute`, it
 * reads the `nested-scope` seam the SCOPE seeded, mounts a nested `Scope` one `depth`
 * deeper over the driver's reserved child pool plus shared journal/blobs/registry, runs the driver
 * `Agent.act(task, nestedScope)`, and reports the conserved spend summed off the nested
 * tree's settled events — so the parent scope's reconcile rolls the whole sub-tree's spend
 * into the conserved total.
 *
 * A `down` from the nested driver (a thrown `act` or an aborted scope) propagates as a
 * thrown executor, which the parent scope types into a `down` settlement — the same
 * fail-loud-into-typed-down discipline a leaf gets.
 */
export const driverExecutorFactory: ExecutorFactory<unknown> = (rawSpec, ctx) => {
  const spec = executableAgentSpecSnapshot(rawSpec, 'driverExecutorFactory')
  if (!isDriverSpec(spec)) {
    throw new ValidationError(
      'driverExecutorFactory: spec is not a driver child (missing Runtime nested-driver tag)',
    )
  }
  const driver = spec.driver
  const deliver = driver.deliver?.bind(driver)
  const journal = spec.journal
  const seam = readNestedScopeSeam(ctx)

  let artifact: ExecutorResult<unknown> | undefined
  // The nested subtree's driver INFERENCE, cached so the parent re-homes it on settle. Computed
  // on BOTH the success AND crash paths (metered events are durable in the nested tree regardless),
  // so a sub-driver that crashes mid-run still re-homes its partial inference — pool + journal agree.
  let meteredSpend: Spend | undefined
  let accounting: ExecutorAccounting | undefined
  let recovering = false
  let previouslyMetered = zeroSpend()
  let cleanupFailure: unknown
  let active:
    | {
        readonly controller: AbortController
        readonly scope: Scope<unknown>
        close?: Promise<void>
      }
    | undefined
  // The nested scope outlives `active`: it is what the root's settlement release and teardown
  // retry reach this manager's children through, after the manager itself has settled.
  let nestedScopeHeld: Scope<unknown> | undefined
  // Read live rather than cached at close, so a descendant the settlement retry confirmed later
  // no longer holds this manager's own teardown unconfirmed.
  const unconfirmedDescendants = () =>
    nestedScopeHeld === undefined ? [] : unconfirmedTeardowns(nestedScopeHeld)

  const closeActive = (reason: string): Promise<void> => {
    if (active === undefined) return Promise.resolve()
    if (!active.close) {
      const { scope, controller } = active
      active.close = closeNestedScope(scope, controller, reason).then(
        () => undefined,
        (error: unknown) => {
          cleanupFailure = error
          throw error
        },
      )
    }
    return active.close
  }
  // Keep two journal categories while reconciling their sum against this driver's one parent
  // reservation: `spent` = settled child WORK, written on this driver's settlement; `metered` =
  // nested driver INFERENCE, re-homed as a separate metered event, on a crash too, so the pool
  // and the journal agree. Answers the child work.
  const rollUp = (events: readonly SpawnEvent[]): Spend => {
    const childWork = sumSpend(events.filter(isSettled))
    const totalMetered = sumMetered(events)
    const reservation = addSpend(childWork, totalMetered)
    meteredSpend = nonZeroOrUndef(unreportedSpend(totalMetered, previouslyMetered))
    accounting = { reported: childWork, reservation }
    return childWork
  }

  const executor: Executor<unknown> = {
    runtime: driverRuntime,
    ...(spec.traceSource ? { traceSource: spec.traceSource } : {}),
    ...(spec.progress ? { progress: spec.progress } : {}),
    ...(spec.harnessTranscript ? { harnessTranscript: spec.harnessTranscript } : {}),
    ...(spec.harnessTranscriptSettled
      ? { harnessTranscriptSettled: spec.harnessTranscriptSettled }
      : {}),
    resultAccepted: () => driver.resultAccepted?.() === true,
    ...(deliver
      ? {
          deliver(message: unknown): boolean {
            return deliver(message) !== false
          },
        }
      : {}),
    async recover(task, signal): Promise<ExecutorResult<unknown>> {
      recovering = true
      return executor.execute(task, signal) as Promise<ExecutorResult<unknown>>
    },
    async execute(task, signal): Promise<ExecutorResult<unknown>> {
      // The nested tree key namespaces this driver's children inside the ONE shared
      // journal, so its cursor seqs never collide with the parent's per-tree guard.
      const nestedRoot = nestedDriverTreeRoot(seam.journalRoot, seam.nodeId)
      const parentEvents = await journal.loadTree(seam.journalRoot)
      const parentSpawn = parentEvents?.find(
        (event) => event.kind === 'spawned' && event.id === seam.nodeId,
      )
      if (parentSpawn?.kind !== 'spawned' || parentSpawn.ownedTreeRoot !== nestedRoot) {
        throw new ValidationError('driverExecutor: nested tree has no exact owning parent spawn')
      }
      const ownedSpawn = ownedTreeRootSpawn(parentSpawn)
      previouslyMetered = recovering
        ? sumMetered((parentEvents ?? []).filter((event) => event.id === seam.nodeId))
        : zeroSpend()
      await journal.beginTree(nestedRoot, new Date(0).toISOString())
      const prior = (await journal.loadTree(nestedRoot)) ?? []
      if (prior.length === 0) {
        await journal.appendEvent(nestedRoot, ownedSpawn)
      } else if (contentAddress(prior[0]) !== contentAddress(ownedSpawn)) {
        throw new ValidationError('driverExecutor: nested recovery changed its owning parent spawn')
      } else if (prior.length !== 1 && !recovering) {
        throw new RetainedExecutionPendingError(
          new ValidationError('driverExecutor: interrupted nested execution requires recovery'),
          'nested-recovery',
        )
      }
      if (recovering && (!spec.recoverExecutor || !seam.restore)) {
        throw new RetainedExecutionPendingError(
          new ValidationError(
            'driverExecutor: nested recovery has no original executor reconstruction',
          ),
          'nested-recovery',
        )
      }
      signal.throwIfAborted()

      const controller = new AbortController()
      // A manager whose result was already accepted is ending the turn that submitted it. Aborting
      // its scope now would cut that turn off before its usage is metered and its result
      // committed, and the node would settle `down` with accepted work. It gets a bounded grace
      // to return the result instead; the parent scope waits for it (`resultAccepted`).
      let clearAcceptedGrace: (() => void) | undefined
      const onParentAbort = (): void => {
        if (driver.resultAccepted?.() === true) {
          clearAcceptedGrace ??= armDeadlineTimer(ACCEPTED_RESULT_GRACE_MS, () =>
            controller.abort(signal.reason),
          )
          return
        }
        controller.abort(signal.reason)
      }
      if (signal.aborted) onParentAbort()
      else signal.addEventListener('abort', onParentAbort, { once: true })
      let nestedScope: Scope<unknown>
      try {
        nestedScope = recovering
          ? await seam.restore!(nestedRoot, controller.signal, prior, spec.recoverExecutor!)
          : seam.mount(nestedRoot, controller.signal)
      } catch (error) {
        controller.abort(error)
        signal.removeEventListener('abort', onParentAbort)
        // The nested tree's spawn record already exists; a replacement must recover it.
        throw new RetainedExecutionPendingError(error, 'nested-recovery')
      }
      active = { controller, scope: nestedScope }
      nestedScopeHeld = nestedScope

      try {
        if (recovering) {
          await startScopeRecoveries(nestedScope)
          await retainedExecutorContext(ctx)?.onReady?.()
        }
        // Run the driver. Its `act` spawns children into the nested scope and reacts via
        // `scope.next()`; a thrown `act` propagates so the PARENT scope types it into a down.
        const out = await runAbortable(
          () => driver.act(task, nestedScope),
          controller.signal,
          'driver aborted',
        )
        await finalizeScopeOwnerMaterialization(nestedScope)

        // A driver may choose its answer while descendants still run. Its allocation is not
        // refundable until every descendant has stopped and reached a terminal journal record.
        await closeActive('driver completed')
        // No turn of this manager runs again, so the environment it kept between its turns is
        // released now rather than left to the provider's idle suspension. The release waits for
        // the last turn's handed-over capture first, so it runs beside this settlement; the run's
        // settlement joins it.
        void releaseManagerEnvironment(nestedScope).catch(() => undefined)

        const events = await loadTreeEvents(journal, nestedRoot)
        const childWork = rollUp(events)
        // A manager may finish work itself through an assignment-selected completion check. That
        // accepted submission is already independent evidence, so carry it to this settlement
        // instead of requiring an unrelated nested child or running the check again.
        const acceptedSubmission = spec.acceptedSubmission?.() === true
        const verdict =
          !acceptedSubmission && spec.unassessedOutput?.() === true
            ? undefined
            : deriveDeliveryVerdict(
                events.filter((event) => event.kind === 'settled'),
                out,
                acceptedSubmission,
              )
        const finished = spec.finishOutput ? await spec.finishOutput(out) : out
        artifact = {
          outRef: `${driverRuntime}:${nestedRoot}`,
          // No accepted finalizer output is a present, unassessed result. Undefined is the
          // blob reader's missing-artifact sentinel and cannot round-trip through JSON.
          out: finished === undefined ? null : finished,
          spent: childWork,
          ...(verdict ? { verdict } : {}),
        }
        return artifact
      } catch (err) {
        await finalizeScopeOwnerMaterialization(active?.scope ?? nestedScope).catch(() => undefined)
        const cleanupError = await closeActive('driver stopped').then(
          () => undefined,
          (error: unknown) => error,
        )
        meteredSpend = undefined
        accounting = undefined
        const events = await journal.loadTree(nestedRoot).catch(() => undefined)
        try {
          if (events) rollUp(events)
        } catch {
          // A missing tree or a malformed ledger must not mask the original error.
        }
        const settledIds = new Set(
          events
            ?.filter((event) => event.kind === 'settled' || event.kind === 'cancelled')
            .map((event) => event.id),
        )
        const terminalAdmissionRefusal = isTerminalAdmissionRefusal(err)
        const turns = events?.filter(
          (event) =>
            event.id === seam.nodeId &&
            (event.kind === 'execution-admitted' || event.kind === 'execution-result'),
        )
        const last = turns?.at(-1)
        const inDoubt =
          last?.kind === 'execution-result' && last.outcome?.success === false
            ? events?.filter((event) => !turns?.includes(event))
            : events
        if (
          driver.resultAccepted?.() === true ||
          spec.acceptedSubmission?.() === true ||
          inDoubt?.some(
            (event) =>
              (event.kind === 'execution-admitted' &&
                (event.admission.phase === 'dispatched' ||
                  (event.id === seam.nodeId &&
                    (event.admission.phase !== 'intent' || !terminalAdmissionRefusal)))) ||
              event.kind === 'execution-result' ||
              (event.kind === 'spawned' && event.parent !== undefined && !settledIds.has(event.id)),
          )
        ) {
          // Intent alone does not keep a definitive admission refusal pending, nor does a last own
          // turn that committed a failed result (institutional-compiler-20261031c:s9). Any other
          // admission, accepted output, or unfinished child still needs its original recovery.
          throw new RetainedExecutionPendingError(err, 'nested-recovery')
        }
        if (cleanupError !== undefined) throw cleanupError
        throw err
      } finally {
        signal.removeEventListener('abort', onParentAbort)
        clearAcceptedGrace?.()
        active = undefined
      }
    },
    accounting(): ExecutorAccounting | undefined {
      return accounting
    },
    metered(): Spend | undefined {
      return meteredSpend
    },
    async teardown(): Promise<{ destroyed: boolean; detail?: string }> {
      await closeActive('driver executor teardown')
      if (cleanupFailure !== undefined) throw cleanupFailure
      const unconfirmed = unconfirmedDescendants()
      return unconfirmed.length > 0
        ? {
            destroyed: false,
            detail: `Nested executor cleanup is unconfirmed: ${unconfirmed.map((node) => node.id).join(', ')}`,
          }
        : { destroyed: true }
    },
    heldEnvironments() {
      // Kept descendants stay marked `keptFor`, so the parent scope keeps them out of what a
      // sweeper deletes.
      return unconfirmedDescendants().flatMap((node) => [
        ...(node.environments ?? []),
        ...(node.kept ?? []),
      ])
    },
    async releaseRetained(): Promise<ReadonlyArray<EnvironmentTeardownReceipt>> {
      // The nested scope releases its retained owner and children and journals their receipts.
      // The executor's next teardown reports any release that remains unconfirmed.
      if (nestedScopeHeld === undefined) return []
      await releaseRetainedEnvironments(nestedScopeHeld)
      return []
    },
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) {
        throw new ValidationError('driverExecutor: resultArtifact() read before execute()')
      }
      return artifact
    },
  }
  registerNestedTeardownScope(executor, () => nestedScopeHeld)
  const treeOwner = attestNestedDriverTreeOwner(executor)
  const ownerRuntime = runtimeOwnedScopeOwnerRuntime(driver)
  return ownerRuntime === undefined
    ? treeOwner
    : attestRuntimeOwnedDeferredExecutor(treeOwner, ownerRuntime)
}

/**
 * Register the driver-executor so a child carrying Runtime's explicit nested-driver tag resolves
 * to it. The base registry resolves by harness alone, so a recursive run needs a registry that
 * routes the driver tag here first. Returns a registry decorator: a tagged driver spec → the
 * driver-executor; everything else → the base registry's resolution
 * (leaf built-ins + BYO).
 */
export function withDriverExecutor(base: ExecutorRegistry): ExecutorRegistry {
  return {
    register: base.register.bind(base),
    resolve<Out>(rawSpec: AgentSpec) {
      const spec = executableAgentSpecSnapshot(rawSpec, 'driver executor registry')
      if ((spec as { driverRuntime?: unknown }).driverRuntime === driverRuntime && !spec.executor) {
        return {
          succeeded: true as const,
          value: ((_ignored, context) =>
            isDriverSpec(spec) && spec.leafDeliverable
              ? attestNestedDriverTreeOwner(
                  gateOnDeliverable(driverExecutorFactory(spec, context), spec.leafDeliverable),
                )
              : driverExecutorFactory(spec, context)) as ExecutorFactory<Out>,
        }
      }
      const resolved = base.resolve<Out>(spec)
      if (!resolved.succeeded) return resolved
      return {
        succeeded: true as const,
        value: (_ignored, context) => resolved.value(spec, context),
      }
    },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Positive pre-dispatch refusal evidence, or a same-failure streak that ended the retry loop; a
 *  missing dispatch record proves nothing by itself. */
function isTerminalAdmissionRefusal(error: unknown): boolean {
  if (error instanceof DriverAttemptsExhaustedError && error.stop === 'repeated-failure')
    return true
  // The manager retry owner wraps its final failure once; no other wrapper establishes admission.
  const failure =
    error instanceof DriverAttemptsExhaustedError && error.stop === 'terminal-error'
      ? error.cause
      : error
  return (
    (isCredentialRefusal(failure) ||
      (failure instanceof RetainedExecutionPendingError &&
        failure.phase === 'admission' &&
        failure.pendingCause === 'request-rejected')) &&
    classifyDriverFailure(failure) === 'terminal'
  )
}

async function closeNestedScope(
  scope: Scope<unknown>,
  controller: AbortController,
  reason: string,
): Promise<void> {
  if (!controller.signal.aborted) controller.abort(reason)
  for (;;) {
    const settled = await scope.next()
    if (settled === null) break
  }
  // The join barrier: no later spawn of this scope can continue a budget-stopped worker.
  await releaseHeldEnvironments(scope)
  const view = scope.view
  if (view.inFlight > 0) {
    throw new ValidationError(`driverExecutor: nested cleanup left ${view.inFlight} running nodes`)
  }
}

/** The nested tree's full event list — the one evidence the spend, verdict, AND driver-inference
 *  roll-ups read off the same journal the supervisor sums. */
async function loadTreeEvents(journal: SpawnJournal, nestedRoot: string): Promise<SpawnEvent[]> {
  const events = await journal.loadTree(nestedRoot)
  if (events === undefined) {
    throw new ValidationError(
      `driverExecutor: nested tree '${nestedRoot}' missing from the journal after run (corrupted log)`,
    )
  }
  return events
}

function isSettled(
  ev: SpawnEvent,
): ev is Extract<SpawnEvent, { kind: 'settled' | 'cancelled' }> & { spent: Spend } {
  return ev.kind === 'settled' || (ev.kind === 'cancelled' && ev.spent !== undefined)
}

/** Sum the conserved spend over the nested tree's settled events — the honest per-channel
 *  roll-up of the whole sub-tree's child WORK. */
function sumSpend(settled: ReadonlyArray<{ spent: Spend }>): Spend {
  return settled.reduce<Spend>((total, ev) => addSpend(total, ev.spent), zeroSpend())
}

/** Sum the nested tree's `metered` events — the sub-tree's whole driver INFERENCE (this driver's
 *  own turns + any sub-driver inference already re-homed into this tree). Re-homed up to the parent
 *  as one `metered` event; never reconciled (already pool-debited live via `observe`). */
function sumMetered(events: ReadonlyArray<SpawnEvent>): Spend {
  return events.reduce<Spend>(
    (total, ev) => (ev.kind === 'metered' ? addSpend(total, ev.spend) : total),
    zeroSpend(),
  )
}

/** A spend, or `undefined` when it is all-zero — so `metered()` returns undefined for a driver
 *  whose sub-tree did no inference (and the parent journals no empty `metered` event). A spend
 *  with an UNKNOWN marker is non-zero: a sub-driver whose turns went unmeasured did real work. */
function nonZeroOrUndef(s: Spend): Spend | undefined {
  return s.iterations > 0 ||
    s.tokens.input > 0 ||
    s.tokens.output > 0 ||
    s.usd > 0 ||
    s.ms > 0 ||
    s.tokensKnown === false ||
    s.usdKnown === false ||
    Object.keys(s.resources ?? {}).length > 0
    ? s
    : undefined
}

/** Derive the driver child's delivery verdict from an accepted direct submission, or from its
 *  DIRECT children's settlements and the manager's actual finalized output: `valid` iff the
 *  manager's own assignment check accepted a submission, or a direct child delivered AND the
 *  finalizer returned a defined output;
 *  `score` = the best delivered score. Returns `undefined` when no child settled at all (the
 *  driver itself produced nothing to bubble a verdict from). Fail-closed: a child whose verdict
 *  carried no `valid` counts as not-delivered. */
function deriveDeliveryVerdict(
  settled: ReadonlyArray<{ status: 'done' | 'down'; verdict?: DefaultVerdict }>,
  finalizedOutput: unknown,
  acceptedSubmission: boolean,
): DefaultVerdict | undefined {
  if (acceptedSubmission) return { valid: true, score: 1 }
  let sawChild = false
  let anyValid = false
  let bestValidScore: number | undefined
  let bestDoneScore: number | undefined
  for (const ev of settled) {
    sawChild = true
    if (ev.status !== 'done') continue
    const score = ev.verdict?.score
    if (score !== undefined && (bestDoneScore === undefined || score > bestDoneScore)) {
      bestDoneScore = score
    }
    if (ev.verdict?.valid === true) {
      anyValid = true
      if (score !== undefined && (bestValidScore === undefined || score > bestValidScore)) {
        bestValidScore = score
      }
    }
  }
  if (!sawChild) return undefined
  const accepted = anyValid && finalizedOutput !== undefined
  return {
    valid: accepted,
    score: accepted ? (bestValidScore ?? 1) : (bestDoneScore ?? 0),
  }
}

function readNestedScopeSeam(ctx: ExecutorContext): NestedScopeSeam {
  const seam = ctx.seams[nestedScopeSeamKey] as NestedScopeSeam | undefined
  if (!seam || typeof seam.mount !== 'function') {
    throw new ValidationError(
      `driverExecutor: missing required seam "${nestedScopeSeamKey}" — a driver child must be spawned through a Scope that seeds it (the keystone scope does)`,
    )
  }
  return seam
}

function isAgent(value: unknown): value is Agent<unknown, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { act?: unknown }).act === 'function' &&
    typeof (value as { name?: unknown }).name === 'string'
  )
}

/** Parent journals may already contain an interrupted driver's inference prefix. */
function unreportedSpend(total: Spend, prior: Spend): Spend {
  const tokens = { ...total.tokens }
  for (const key of ['input', 'output', 'freshInput', 'cacheRead', 'cacheWrite'] as const) {
    const value = total.tokens[key]
    if (value !== undefined) tokens[key] = Math.max(0, value - (prior.tokens[key] ?? 0))
  }
  return {
    ...total,
    ...addResourceSpend(
      total.resources === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(total.resources).map(([name, value]) => {
              const previous = prior.resources?.[name]
              if (previous && previous.unit !== value.unit)
                throw new ValidationError(`resource ${name}: unit mismatch`)
              return [
                name,
                {
                  ...value,
                  amount: Math.max(0, value.amount - (previous?.amount ?? 0)),
                  known: value.known && (previous?.known ?? true),
                },
              ]
            }),
          ),
    ),
    iterations: Math.max(0, total.iterations - prior.iterations),
    tokens,
    usd: Math.max(0, total.usd - prior.usd),
    ms: Math.max(0, total.ms - prior.ms),
    ...(total.usdEstimated === undefined
      ? {}
      : { usdEstimated: Math.max(0, total.usdEstimated - (prior.usdEstimated ?? 0)) }),
    ...(total.boxMinutes === undefined
      ? {}
      : { boxMinutes: Math.max(0, total.boxMinutes - (prior.boxMinutes ?? 0)) }),
  }
}
