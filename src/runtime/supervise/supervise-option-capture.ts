import { ConfigError, ValidationError } from '../../errors'
import type { DeliverableSpec } from './completion-gate'

import { snapshotExecutorConfig } from './runtime'
import { detachedSnapshot } from './snapshot'

import type { SuperviseOptions } from './supervise-options'

/**
 * Every `SuperviseOptions` key, as data.
 *
 * `supervise()` reads the options it knows and leaves the rest untouched, so a key no reader
 * consults — a typo, or a seam whose name moved in a later version — is discarded in silence: the
 * call type-checks against a widened value, the run succeeds, and the capability the caller asked
 * for is simply not there. Nothing downstream can detect that, because nothing downstream knows it
 * was supposed to happen. {@link assertSuperviseOptionKeys} turns it into a refusal before any
 * compute, naming the key.
 *
 * The two assignments below fail to COMPILE, naming the offender, when this list and
 * `keyof SuperviseOptions` disagree in either direction — a new option cannot go missing from it,
 * and a removed one cannot linger.
 */
const superviseOptionKeys = [
  'allowedModels',
  'analysts',
  'analyzeOnSettle',
  'mapOnSettle',
  'routeFlow',
  'decideGate',
  'authorizeMessage',
  'authorizeSpawn',
  'backend',
  'selectSeat',
  'blobs',
  'budget',
  'childSettleGraceMs',
  'teardownConfirmMs',
  'retainedAtSettlement',
  'compaction',
  'continuityByProfile',
  'coordination',
  'deliverable',
  'driveHarness',
  'driveHarnessMaterialization',
  'driverBackend',
  'driverRetry',
  'executeExtraTool',
  'execution',
  'extraTools',
  'finalizer',
  'graphRegistry',
  'hooks',
  'inheritSpawnRights',
  'journal',
  'makeLeafAgent',
  'makeWorkerAgent',
  'escalateQuestion',
  'maxDepth',
  'maxTurns',
  'now',
  'onCoordinationEvent',
  'onDriverAttempt',
  'onProgressStop',
  'otel',
  'peerMail',
  'peerAudit',
  'traceTools',
  'perWorker',
  'reservationPolicy',
  'deadlineCheckIn',
  'budgetStopHoldMs',
  'profileGuidance',
  'profileSecurity',
  'registry',
  'resolveDeliverable',
  'resolveDriveHarness',
  'resolveSpawnProfile',
  'resolveSupervisorTools',
  'rootDriverFromBackend',
  'rootHandle',
  'router',
  'runDir',
  'resume',
  'segment',
  'runContext',
  'runId',
  'signal',
  'stallAfterMs',
  'wake',
  'steerDir',
  'stopRule',
  'watchWorkers',
  'continuation',
  'workerRetry',
  'onWorkerRetry',
  'workerSlots',
  'recoverExecutor',
] as const

type UnlistedSuperviseOption = Exclude<keyof SuperviseOptions, (typeof superviseOptionKeys)[number]>

/** A `SuperviseOptions` key missing from `superviseOptionKeys` makes this assignment fail, and the
 *  compiler error names the key. Add it to the list. */
const everySuperviseOptionIsListed: UnlistedSuperviseOption extends never
  ? true
  : UnlistedSuperviseOption = true
void everySuperviseOptionIsListed

type StaleSuperviseOptionKey = Exclude<(typeof superviseOptionKeys)[number], keyof SuperviseOptions>

/** A listed key that `SuperviseOptions` no longer declares makes this assignment fail. Remove it,
 *  or the check would accept an option no reader consults. */
const everyListedSuperviseOptionExists: StaleSuperviseOptionKey extends never
  ? true
  : StaleSuperviseOptionKey = true
void everyListedSuperviseOptionExists

const superviseOptionKeySet: ReadonlySet<string> = new Set<string>(superviseOptionKeys)

/**
 * Refuse a top-level option key `supervise()` reads nowhere, naming it.
 *
 * The shape is `assertExactConfigKeys`, which does the same for one executor configuration: an
 * unknown field is a caller asking for behavior that will not happen, and intake is the only
 * moment it is observable. The error class is not the same, on purpose. A bad `SuperviseOptions`
 * key is a configuration fault, and `ConfigError` is already what `supervise()` throws for one —
 * see `resolveNamed`, for an option that names a registry entry the registry does not hold.
 */
function assertSuperviseOptionKeys(opts: SuperviseOptions, context: string): void {
  const unknown = Object.keys(opts).filter((key) => !superviseOptionKeySet.has(key))
  if (unknown.length > 0) {
    throw new ConfigError(
      `${context}: unknown option ${unknown.sort().join(', ')} — no reader consults that name, ` +
        'so the value would be discarded and the capability it asks for would silently be absent',
    )
  }
}

export function captureDeliverable(
  deliverable: DeliverableSpec<unknown>,
  context: string,
): DeliverableSpec<unknown> {
  if (typeof deliverable !== 'object' || deliverable === null || Array.isArray(deliverable)) {
    throw new ValidationError(`${context}: deliverable must be an object`)
  }
  if (typeof deliverable.check !== 'function') {
    throw new ValidationError(`${context}: deliverable.check must be a function`)
  }
  if (deliverable.checkState !== undefined && typeof deliverable.checkState !== 'function') {
    throw new ValidationError(`${context}: deliverable.checkState must be a function`)
  }
  if (
    deliverable.feedback !== undefined &&
    deliverable.feedback !== 'verbatim' &&
    deliverable.feedback !== 'pass-only'
  ) {
    throw new ValidationError(`${context}: deliverable.feedback must be 'verbatim' or 'pass-only'`)
  }
  return Object.freeze({
    ...detachedSnapshot(
      {
        describe: deliverable.describe,
        ...(deliverable.feedback === undefined ? {} : { feedback: deliverable.feedback }),
        ...(deliverable.sealed === undefined ? {} : { sealed: deliverable.sealed === true }),
      },
      `${context} configuration`,
    ),
    check: deliverable.check,
    ...(deliverable.checkState === undefined ? {} : { checkState: deliverable.checkState }),
  })
}

/**
 * Every `SuperviseOptions` key whose value IS a callback, as data.
 *
 * `captureSuperviseOptions` detaches its decision data with `detachedSnapshot`, which
 * structured-clones. A function cannot be structured-cloned, so a callback key that the capture
 * does not lift out of the remainder makes `supervise()` throw
 * `supervise options: input must be structured-cloneable` before any compute — a refusal that names
 * the snapshot rather than the option, so a caller reads it as a bad value and not as a capability
 * the entry point cannot carry.
 *
 * That is what happened to the retired `onUnmetContract`: added with the re-prompt path in 0.186.0,
 * accepted by the option-key check, forwarded by `supervisorAgent`, read by the retry loop, and
 * never destructured here. Every `supervisePursuit` run that passed the callback failed at
 * construction on 0.186.0, 0.187.1 and 0.188.0, and the only working configuration was the number
 * alone.
 *
 * The assignment below fails to COMPILE, naming the offender, when a callback-valued option is not
 * in this list, so the next one cannot be added silently. The list is not merely documentation:
 * {@link assertNoUncapturedExecutableOption} refuses at runtime any callback that still reaches the
 * snapshot, including one nested in an option this type test cannot see.
 */
const superviseExecutableOptionKeys = [
  'authorizeMessage',
  'authorizeSpawn',
  'decideGate',
  'driveHarness',
  'escalateQuestion',
  'executeExtraTool',
  'finalizer',
  'makeLeafAgent',
  'makeWorkerAgent',
  'now',
  'onCoordinationEvent',
  'onDriverAttempt',
  'onProgressStop',
  'onWorkerRetry',
  'recoverExecutor',
  'resolveDeliverable',
  'resolveDriveHarness',
  'resolveSpawnProfile',
  'selectSeat',
  'resolveSupervisorTools',
  'stopRule',
] as const

/** A `SuperviseOptions` key whose value is callable. An object-valued option that CONTAINS a
 *  callback (`router.complete`, `compaction.distill`, `analysts.run`) is captured field by field and
 *  is deliberately outside this test; the runtime guard covers what a type cannot see. */
type CallableSuperviseOption = {
  [K in keyof SuperviseOptions]-?: NonNullable<SuperviseOptions[K]> extends (
    ...args: never[]
  ) => unknown
    ? K
    : never
}[keyof SuperviseOptions]

type UncapturedCallableOption = Exclude<
  CallableSuperviseOption,
  (typeof superviseExecutableOptionKeys)[number]
>

/** A callback-valued option missing from `superviseExecutableOptionKeys` makes this assignment
 *  fail, and the compiler error names the key. Add it to the list AND to the destructuring below —
 *  the list alone carries no value through. */
const everyCallableOptionIsListed: UncapturedCallableOption extends never
  ? true
  : UncapturedCallableOption = true
void everyCallableOptionIsListed

type StaleExecutableOptionKey = Exclude<
  (typeof superviseExecutableOptionKeys)[number],
  keyof SuperviseOptions
>

/** A listed key that `SuperviseOptions` no longer declares makes this assignment fail. */
const everyListedExecutableOptionExists: StaleExecutableOptionKey extends never
  ? true
  : StaleExecutableOptionKey = true
void everyListedExecutableOptionExists

/** The callback-valued options, for a test that proves the capture forwards each one. */
export const SUPERVISE_EXECUTABLE_OPTION_KEYS: ReadonlyArray<keyof SuperviseOptions> =
  Object.freeze([...superviseExecutableOptionKeys])

/**
 * Refuse a callback that reached the decision-data remainder, naming the option.
 *
 * The type test above cannot see a callback nested inside an object-valued option, and
 * `detachedSnapshot` would report only that its input is not structured-cloneable. This says which
 * key carries the callback and what to do about it, so the next occurrence is a five-second fix
 * instead of a bisect over every option a caller passed.
 */
function assertNoUncapturedExecutableOption(decisionData: Readonly<Record<string, unknown>>): void {
  const carried = Object.entries(decisionData)
    .filter(([, value]) => typeof value === 'function')
    .map(([key]) => key)
  if (carried.length > 0) {
    throw new ValidationError(
      `supervise: option ${carried.sort().join(', ')} carries a callback that the option capture ` +
        'does not forward, so the run would fail on a structured-clone refusal that names the ' +
        'snapshot instead of the option; lift the key out of the decision data in ' +
        'captureSuperviseOptions and add it to superviseExecutableOptionKeys',
    )
  }
}

/** Capture the public one-call configuration before any asynchronous work starts. Decision data is
 * detached and frozen; executable ports are copied as the exact references selected at intake.
 * Service internals intentionally remain live, while replacing a callback/service on the caller's
 * mutable options object can no longer change an in-flight run. */

export function captureSuperviseOptions(opts: SuperviseOptions): SuperviseOptions {
  assertSuperviseOptionKeys(opts, 'supervise')
  const {
    backend,
    selectSeat,
    coordination,
    driverBackend,
    deliverable,
    resolveDeliverable,
    router,
    compaction,
    watchWorkers,
    analysts,
    makeWorkerAgent,
    makeLeafAgent,
    recoverExecutor,
    resume,
    resolveSpawnProfile,
    blobs,
    journal,
    runContext,
    registry,
    hooks,
    otel,
    authorizeSpawn,
    authorizeMessage,
    driveHarness,
    resolveDriveHarness,
    resolveSupervisorTools,
    escalateQuestion,
    decideGate,
    onCoordinationEvent,
    executeExtraTool,
    stopRule,
    onProgressStop,
    onDriverAttempt,
    continuation,
    workerRetry,
    onWorkerRetry,
    finalizer,
    now,
    signal,
    rootHandle,
    workerSlots,
    ...decisionData
  } = opts
  assertNoUncapturedExecutableOption(decisionData)
  const capturedData = detachedSnapshot(decisionData, 'supervise options')
  const capturedCoordination =
    coordination === undefined
      ? undefined
      : (() => {
          const { publicUrl, onAudit, ...configuration } = coordination
          return Object.freeze({
            ...detachedSnapshot(configuration, 'supervise coordination configuration'),
            ...(publicUrl === undefined ? {} : { publicUrl }),
            ...(onAudit === undefined ? {} : { onAudit }),
          })
        })()
  const capturedBackend = backend === undefined ? undefined : snapshotExecutorConfig(backend)
  const capturedDriverBackend =
    driverBackend === undefined ? undefined : snapshotExecutorConfig(driverBackend)
  // A string names a registry entry; it is resolved (and the resolved spec validated) by
  // `resolveNamed` before anything is built or spent.
  const capturedDeliverable =
    deliverable === undefined || typeof deliverable === 'string'
      ? deliverable
      : captureDeliverable(deliverable, 'supervise deliverable')
  const capturedRouter =
    router === undefined
      ? undefined
      : (() => {
          const { complete, ...routerData } = router
          return Object.freeze({
            ...detachedSnapshot(routerData, 'supervise router configuration'),
            ...(complete === undefined ? {} : { complete }),
          })
        })()
  const capturedCompaction =
    compaction === undefined
      ? undefined
      : (() => {
          const { distill, estimateTokens, onCompact, ...compactionData } = compaction
          return Object.freeze({
            ...detachedSnapshot(compactionData, 'supervise compaction configuration'),
            ...(distill === undefined ? {} : { distill }),
            ...(estimateTokens === undefined ? {} : { estimateTokens }),
            ...(onCompact === undefined ? {} : { onCompact }),
          })
        })()
  const capturedWatchWorkers =
    watchWorkers === undefined
      ? undefined
      : Object.freeze({
          ...detachedSnapshot(
            { maxFindingsPerWorker: watchWorkers.maxFindingsPerWorker },
            'supervise worker-watch configuration',
          ),
          ...(watchWorkers.detectors === undefined
            ? {}
            : { detectors: Object.freeze([...watchWorkers.detectors]) }),
        })
  // A RegExp does not survive a JSON snapshot, so the policy's numbers are snapshot and its
  // signatures are copied as the exact values the caller selected.
  const capturedWorkerRetry =
    workerRetry === undefined
      ? undefined
      : Object.freeze({
          ...detachedSnapshot(
            {
              ...(workerRetry.enabled === undefined ? {} : { enabled: workerRetry.enabled }),
              ...(workerRetry.maxTotalMs === undefined
                ? {}
                : { maxTotalMs: workerRetry.maxTotalMs }),
              ...(workerRetry.initialBackoffMs === undefined
                ? {}
                : { initialBackoffMs: workerRetry.initialBackoffMs }),
              ...(workerRetry.maxBackoffMs === undefined
                ? {}
                : { maxBackoffMs: workerRetry.maxBackoffMs }),
            },
            'supervise worker-retry configuration',
          ),
          ...(workerRetry.additionalPreSpawnSignatures === undefined
            ? {}
            : {
                additionalPreSpawnSignatures: Object.freeze([
                  ...workerRetry.additionalPreSpawnSignatures,
                ]),
              }),
        })

  // Rebuilt field by field so a caller's mutable registry object cannot be held live. EVERY
  // callable field must be listed: an omitted one is silently dropped at intake and the capability
  // it carries disappears from every manager in the tree with no type error, because the field is
  // optional. `register` is what mounts `define_analyst`.
  const capturedAnalysts =
    analysts === undefined || typeof analysts === 'string'
      ? analysts
      : Object.freeze({
          kinds: detachedSnapshot(analysts.kinds, 'supervise analyst kinds'),
          run: analysts.run,
          ...(typeof analysts.register === 'function' ? { register: analysts.register } : {}),
        })

  // The policy is decision data except its two functions, which are captured by reference.
  const capturedContinuation =
    continuation === undefined
      ? undefined
      : (() => {
          const { runPanel, append, ...policy } = continuation
          return Object.freeze({
            ...detachedSnapshot(policy, 'supervise continuation'),
            ...(runPanel === undefined ? {} : { runPanel }),
            ...(append === undefined ? {} : { append }),
          })
        })()

  return Object.freeze({
    ...capturedData,
    ...(capturedCoordination === undefined ? {} : { coordination: capturedCoordination }),
    ...(capturedBackend === undefined ? {} : { backend: capturedBackend }),
    ...(selectSeat === undefined ? {} : { selectSeat }),
    ...(capturedDriverBackend === undefined ? {} : { driverBackend: capturedDriverBackend }),
    ...(capturedDeliverable === undefined ? {} : { deliverable: capturedDeliverable }),
    ...(resolveDeliverable === undefined ? {} : { resolveDeliverable }),
    ...(capturedRouter === undefined ? {} : { router: capturedRouter }),
    ...(capturedCompaction === undefined ? {} : { compaction: capturedCompaction }),
    ...(capturedWatchWorkers === undefined ? {} : { watchWorkers: capturedWatchWorkers }),
    ...(capturedAnalysts === undefined ? {} : { analysts: capturedAnalysts }),
    ...(makeWorkerAgent === undefined ? {} : { makeWorkerAgent }),
    ...(makeLeafAgent === undefined ? {} : { makeLeafAgent }),
    ...(recoverExecutor === undefined ? {} : { recoverExecutor }),
    ...(resolveSpawnProfile === undefined ? {} : { resolveSpawnProfile }),
    ...(blobs === undefined ? {} : { blobs }),
    ...(journal === undefined ? {} : { journal }),
    ...(resume === undefined ? {} : { resume }),
    ...(runContext === undefined ? {} : { runContext }),
    // A number is decision data; a shared allocator is a live collaborator other runs also hold.
    ...(workerSlots === undefined ? {} : { workerSlots }),
    ...(authorizeSpawn === undefined ? {} : { authorizeSpawn }),
    ...(authorizeMessage === undefined ? {} : { authorizeMessage }),
    ...(driveHarness === undefined ? {} : { driveHarness }),
    ...(resolveDriveHarness === undefined ? {} : { resolveDriveHarness }),
    ...(resolveSupervisorTools === undefined ? {} : { resolveSupervisorTools }),
    ...(escalateQuestion === undefined ? {} : { escalateQuestion }),
    ...(decideGate === undefined ? {} : { decideGate }),
    ...(onCoordinationEvent === undefined ? {} : { onCoordinationEvent }),
    ...(executeExtraTool === undefined ? {} : { executeExtraTool }),
    ...(stopRule === undefined ? {} : { stopRule }),
    ...(onProgressStop === undefined ? {} : { onProgressStop }),
    ...(onDriverAttempt === undefined ? {} : { onDriverAttempt }),
    ...(capturedContinuation === undefined ? {} : { continuation: capturedContinuation }),
    ...(capturedWorkerRetry === undefined ? {} : { workerRetry: capturedWorkerRetry }),
    ...(onWorkerRetry === undefined ? {} : { onWorkerRetry }),
    ...(finalizer === undefined ? {} : { finalizer }),
    ...(now === undefined ? {} : { now }),
    ...(signal === undefined ? {} : { signal }),
    ...(rootHandle === undefined ? {} : { rootHandle }),
    // Live collaborators: registries resolve lazily, hooks and otel exporters are process objects.
    // They are captured as the exact references selected at intake, never deep-snapshot.
    ...(registry === undefined ? {} : { registry }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(otel === undefined ? {} : { otel }),
  })
}
