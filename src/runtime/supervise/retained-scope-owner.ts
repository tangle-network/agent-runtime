import { agentCandidateWorkspaceSnapshotEvidenceSchema } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { environmentReader, type SpawnResourceReader } from '../../mcp/tools/spawn-resource-paths'
import type { RetainedRunAdmission, RetainedRunEnvironmentAdmission } from '../retained-run-types'
import { addSpend, zeroSpend } from '../util'
import { runAbortable } from './abortable'
import { assertValidSpend } from './budget'
import { executorFailureReason } from './executor-outcome'
import type { RetainedExecutorContext } from './retained-executor'
import { detachedSnapshot } from './snapshot'
import type {
  ExecutorResult,
  NodeId,
  ResultBlobStore,
  Scope,
  SpawnEvent,
  SpawnJournal,
  UnconfirmedTeardown,
} from './types'

interface OwnerState {
  readonly admissions: RetainedRunAdmission[]
  readonly context: RetainedExecutorContext
  readonly args: OwnerRegistration
  inputSequence?: number
  prepared?: boolean
  acceptedConsumed?: boolean
  priorSession?: RetainedRunEnvironmentAdmission
  provider?: AgentEnvironmentProvider
  /** The provider backend captures executable workspace evidence for unsettled owner turns. */
  workspaceRetention: boolean
  /** The owner's current environment id, from its executor's materialization receipt. Set by the
   *  drive harness; populated on the retained AND non-retained provider paths, where an
   *  `environment` admission exists only on the retained one. */
  liveEnvironmentId?: () => string | undefined
  nextSequence: () => number
  taskRef?: string
  accepted?: ExecutorResult<unknown>
  acceptedRef?: Extract<SpawnEvent, { kind: 'execution-result' }>
}
interface OwnerRegistration {
  readonly rootId: NodeId
  readonly nodeId: NodeId
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly priorEvents: readonly SpawnEvent[]
  readonly now: () => number
}
const owners = new WeakMap<object, OwnerState>()

/** @internal Scope construction carries this private policy to every nested owner scope. */
export const retainedOwnerWorkspaceRetentionSeamKey = 'runtime.retainedOwnerWorkspaceRetention'

/** The scope owns these writers; provider adapters receive only the restricted context. */
export function registerScopeRetainedOwner(scope: Scope<unknown>, args: OwnerRegistration): void {
  const events = args.priorEvents.filter((event) => 'id' in event && event.id === args.nodeId)
  const taskEvent = [...events].reverse().find((event) => event.kind === 'execution-input')
  const start = taskEvent === undefined ? 0 : events.indexOf(taskEvent)
  const attempt = events.slice(start)
  const beforeInput = taskEvent === undefined ? [] : events.slice(0, start)
  const priorInput = [...beforeInput].reverse().find((event) => event.kind === 'execution-input')
  const priorAttempt =
    priorInput === undefined ? [] : beforeInput.slice(beforeInput.indexOf(priorInput))
  const admissions = attempt.flatMap((event) =>
    event.kind === 'execution-admitted' ? [event.admission] : [],
  )
  const acceptedRef = [...attempt].reverse().find((event) => event.kind === 'execution-result')
  const priorResult = [...priorAttempt].reverse().find((event) => event.kind === 'execution-result')
  const priorSession =
    priorResult?.kind === 'execution-result'
      ? priorAttempt
          .slice(0, priorAttempt.indexOf(priorResult))
          .reverse()
          .flatMap((event) =>
            event.kind === 'execution-admitted' && event.admission.phase === 'environment'
              ? [event.admission]
              : [],
          )[0]
      : undefined
  let sequence = Math.max(0, ...events.map((event) => ('seq' in event ? event.seq : 0)))
  const state: OwnerState = {
    args,
    admissions,
    workspaceRetention: false,
    nextSequence: () => ++sequence,
    ...(taskEvent?.kind === 'execution-input'
      ? { taskRef: taskEvent.taskRef, inputSequence: taskEvent.seq }
      : {}),
    ...(acceptedRef?.kind === 'execution-result' ? { acceptedRef } : {}),
    ...(priorSession ? { priorSession } : {}),
    context: {
      get executionId() {
        if (state.inputSequence === undefined)
          throw new ValidationError('retained owner input was not committed')
        return `${args.nodeId}:input:${state.inputSequence}`
      },
      get priorSession() {
        return state.priorSession
      },
      // The first retained turn must stay alive so a later deliberate invocation can reuse it.
      // The owning scope releases it once the complete manager scope finishes.
      preserveEnvironment: true,
      admissions,
      onAdmission: async (admission) => {
        scope.signal.throwIfAborted()
        const prior = admissions.find((record) => record.phase === admission.phase)
        if (prior !== undefined) {
          if (contentAddress(prior) !== contentAddress(admission)) {
            throw new ValidationError('retained owner admission conflicts with its committed phase')
          }
          return
        }
        await args.journal.appendEvent(args.rootId, {
          kind: 'execution-admitted',
          id: args.nodeId,
          admission: detachedSnapshot(admission, 'retained owner admission'),
          seq: ++sequence,
          at: new Date(args.now()).toISOString(),
        })
        scope.signal.throwIfAborted()
        admissions.push(detachedSnapshot(admission, 'retained owner admission'))
      },
      onResult: async (result) => {
        scope.signal.throwIfAborted()
        assertValidSpend(result.spent, 'retained owner result')
        executorFailureReason(result)
        const outRef = contentAddress(result.out)
        await args.blobs.put(outRef, result.out)
        scope.signal.throwIfAborted()
        const event: Extract<SpawnEvent, { kind: 'execution-result' }> = {
          kind: 'execution-result',
          id: args.nodeId,
          outRef,
          spent: detachedSnapshot(result.spent, 'retained owner spend'),
          ...(result.verdict ? { verdict: result.verdict } : {}),
          ...(result.outcome ? { outcome: result.outcome } : {}),
          seq: ++sequence,
          at: new Date(args.now()).toISOString(),
        }
        await args.journal.appendEvent(args.rootId, event)
        state.acceptedRef = event
        state.accepted = detachedSnapshot(result, 'retained owner result')
        state.acceptedConsumed = true
      },
    },
  }
  owners.set(scope, state)
}

export function scopeRetainedOwnerContext(
  scope: Scope<unknown>,
): RetainedExecutorContext | undefined {
  return owners.get(scope)?.context
}

/** Bind cleanup before replay can return an already accepted owner result. */
export function bindScopeRetainedOwnerProvider(
  scope: Scope<unknown>,
  provider: AgentEnvironmentProvider,
): void {
  const state = owners.get(scope)
  if (state) state.provider = provider
}

/** Bind the owner cleanup policy selected by its provider executor. */
export function bindScopeRetainedOwnerWorkspaceRetention(
  scope: Scope<unknown>,
  enabled: boolean,
): void {
  const state = owners.get(scope)
  if (state) state.workspaceRetention = enabled
}

/**
 * Bind where the owner's CURRENT environment id can be read from. The drive harness supplies a
 * resolver over its active executor's materialization receipt, which every provider path
 * publishes once the environment exists. The `environment` admission is written only on the
 * retained path, and the production tangle provider declares no `retainedControl`, so a reader
 * that scanned admissions alone would refuse every read on a real sandbox root while looking
 * correct in every test that uses the retained fixture.
 */
export function bindScopeRetainedOwnerEnvironmentId(
  scope: Scope<unknown>,
  liveEnvironmentId: () => string | undefined,
): void {
  const state = owners.get(scope)
  if (state) state.liveEnvironmentId = liveEnvironmentId
}

/**
 * The owner's environment as a source of by-path spawn resources.
 *
 * Built once per scope, before the environment exists: the coordination tools are created ahead
 * of the owner's first turn, and the environment is admitted during it. So the reader resolves
 * its target on every read — the latest environment admission on this node, reconstructed through
 * the bound provider the same way cleanup reconstructs it, with the same identity check. A manager
 * that has not yet been admitted, or whose provider was never bound, gets a refusal that names the
 * missing piece rather than a read from nowhere.
 *
 * The environment's `read()` serves the sandbox's own workspace; containment against that
 * workspace is the provider's. The relative-path and `..` rules are the reader's, in
 * `environmentReader`, so a manager is refused for the rule it broke.
 */
export function scopeRetainedOwnerResourceReader(
  scope: Scope<unknown>,
): SpawnResourceReader | undefined {
  const state = owners.get(scope)
  if (state === undefined) return undefined
  const latestEnvironmentId = (): string | undefined =>
    state.liveEnvironmentId?.() ??
    [...state.admissions]
      .reverse()
      .flatMap((admission) =>
        admission.phase === 'environment' ? [admission.environmentId] : [],
      )[0]
  return {
    get describe() {
      return `environment ${latestEnvironmentId() ?? '<not yet admitted>'}`
    },
    async read(path) {
      const provider = state.provider
      if (provider === undefined) {
        return { ok: false, reason: 'the manager’s environment provider is not bound yet' }
      }
      const environmentId = latestEnvironmentId()
      if (environmentId === undefined) {
        return { ok: false, reason: 'the manager’s environment has not been admitted yet' }
      }
      if (!provider.get) {
        return {
          ok: false,
          reason: `provider ${provider.name} cannot reconstruct the manager’s environment`,
        }
      }
      let environment: Awaited<ReturnType<NonNullable<AgentEnvironmentProvider['get']>>>
      try {
        environment = await provider.get(environmentId)
      } catch (error) {
        return {
          ok: false,
          reason: `environment ${environmentId}: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      if (environment === null) {
        return { ok: false, reason: `environment ${environmentId} is gone` }
      }
      if (environment.id !== environmentId || environment.provider !== provider.name) {
        return { ok: false, reason: `provider returned another environment for ${environmentId}` }
      }
      if (typeof environment.read !== 'function') {
        return {
          ok: false,
          reason: `environment ${environmentId} does not expose read; its provider cannot serve a resource by path`,
        }
      }
      const read = environment.read.bind(environment)
      return environmentReader({ id: environment.id, read }).read(path)
    },
  }
}

/** The existing scope settlement barrier releases the owner's environment after all its turns. */
export async function releaseScopeRetainedOwnerEnvironment(
  scope: Scope<unknown>,
): Promise<readonly UnconfirmedTeardown[]> {
  const state = owners.get(scope)
  if (!state?.provider) return []
  const { provider, args } = state
  const events = (await args.journal.loadTree(args.rootId)) ?? []
  const released = new Set(
    events.flatMap((event) =>
      event.kind === 'environment-teardown' &&
      event.id === args.nodeId &&
      event.provider === provider.name &&
      event.destroyed
        ? [event.environmentId]
        : [],
    ),
  )
  const environments = new Set(
    events.flatMap((event) =>
      event.id === args.nodeId &&
      event.kind === 'execution-admitted' &&
      event.admission.phase === 'environment'
        ? [event.admission.environmentId]
        : [],
    ),
  )
  const retentionConfigured =
    state.workspaceRetention ||
    events.some(
      (event) =>
        event.kind === 'execution-input' &&
        event.id === args.nodeId &&
        event.workspaceRetention === true,
    )
  const retentionFailures = retentionConfigured
    ? await ownerWorkspaceRetentionFailures(events, args.nodeId, args.blobs)
    : new Set<string>()
  let unconfirmed = false
  for (const environmentId of environments) {
    if (released.has(environmentId)) continue
    let destroyed = false
    let detail: string | undefined
    if (retentionFailures.has(environmentId)) {
      detail =
        'provider workspace retention: source preserved because the owner execution has no verified workspace receipt'
      unconfirmed = true
    } else {
      try {
        await runAbortable(
          async () => {
            if (!provider.get)
              throw new Error('provider cannot reconstruct the retained environment')
            const environment = await provider.get(environmentId)
            if (environment === null) return
            if (environment.id !== environmentId || environment.provider !== provider.name) {
              throw new Error('provider returned another retained environment')
            }
            if (!environment.destroy)
              throw new Error('provider cannot destroy the retained environment')
            await environment.destroy()
          },
          AbortSignal.timeout(30_000),
          'retained owner cleanup timed out',
        )
        destroyed = true
      } catch {
        detail = 'retained owner environment cleanup was not confirmed'
        unconfirmed = true
      }
    }
    await args.journal.appendEvent(args.rootId, {
      kind: 'environment-teardown',
      id: args.nodeId,
      provider: provider.name,
      environmentId,
      destroyed,
      ...(detail === undefined ? {} : { detail }),
      seq: state.nextSequence(),
      at: new Date(args.now()).toISOString(),
    })
  }
  return unconfirmed
    ? [{ id: args.nodeId, label: 'scope owner', runtime: provider.name, status: 'done' }]
    : []
}

interface OwnerAttempt {
  readonly environmentIds: Set<string>
  result?: Extract<SpawnEvent, { kind: 'execution-result' }>
}

/** Group owner admissions by input and require a verified workspace receipt before deletion. */
async function ownerWorkspaceRetentionFailures(
  events: readonly SpawnEvent[],
  nodeId: NodeId,
  blobs: ResultBlobStore,
): Promise<ReadonlySet<string>> {
  const attempts: OwnerAttempt[] = []
  let current: OwnerAttempt | undefined
  const flush = (): void => {
    if (current !== undefined) attempts.push(current)
    current = undefined
  }
  for (const event of events) {
    if (!('id' in event) || event.id !== nodeId) continue
    if (event.kind === 'execution-input') {
      flush()
      current = { environmentIds: new Set<string>() }
    } else if (event.kind === 'execution-admitted' && event.admission.phase === 'environment') {
      if (current?.result !== undefined) flush()
      current ??= { environmentIds: new Set<string>() }
      current.environmentIds.add(event.admission.environmentId)
    } else if (event.kind === 'execution-result') {
      current ??= { environmentIds: new Set<string>() }
      current.result = event
    }
  }
  flush()
  const failures = new Set<string>()
  for (const attempt of attempts) {
    if (attempt.environmentIds.size === 0) continue
    // One result receipt cannot prove which source belongs to which environment when a
    // recovered attempt admitted more than one. Preserve every source until a later run can
    // establish a one-to-one receipt rather than guessing from a shared result.
    if (attempt.environmentIds.size > 1) {
      for (const environmentId of attempt.environmentIds) failures.add(environmentId)
      continue
    }
    const result = attempt.result
    if (result === undefined) {
      for (const environmentId of attempt.environmentIds) failures.add(environmentId)
      continue
    }
    let output: unknown | undefined
    try {
      output = await blobs.get(result.outRef)
      if (output === undefined || contentAddress(output) !== result.outRef) throw new Error()
    } catch {
      output = undefined
    }
    const snapshot =
      output !== null && typeof output === 'object'
        ? (output as { readonly workspaceSnapshot?: unknown }).workspaceSnapshot
        : undefined
    if (!hasDurableWorkspaceSnapshot(snapshot)) {
      for (const environmentId of attempt.environmentIds) failures.add(environmentId)
    }
  }
  return failures
}

/** A stored result is deletion authority only when it names the durable archive capture wrote. */
function hasDurableWorkspaceSnapshot(value: unknown): boolean {
  const parsed = agentCandidateWorkspaceSnapshotEvidenceSchema.safeParse(value)
  return parsed.success && 'locator' in parsed.data.manifest && 'locator' in parsed.data.archive
}

/** Resume the original backend prompt; rebuilt coordination observations cannot replace it. */
export async function prepareScopeRetainedOwnerTask(
  scope: Scope<unknown>,
  task: unknown,
): Promise<unknown> {
  const state = owners.get(scope)
  if (!state) return task
  const { args } = state
  scope.signal.throwIfAborted()
  const journal = (await args.journal.loadTree(args.rootId)) ?? []
  const owned = journal.filter((event) => event.id === args.nodeId)
  const latestInput = [...owned].reverse().find((event) => event.kind === 'execution-input')
  if (latestInput?.kind === 'execution-input') {
    const attempt = owned.slice(owned.indexOf(latestInput))
    state.taskRef = latestInput.taskRef
    state.inputSequence = latestInput.seq
    state.admissions.splice(
      0,
      state.admissions.length,
      ...attempt.flatMap((event) => (event.kind === 'execution-admitted' ? [event.admission] : [])),
    )
    const accepted = [...attempt].reverse().find((event) => event.kind === 'execution-result')
    if (accepted?.kind === 'execution-result') state.acceptedRef = accepted
  }
  if (state.prepared && state.acceptedRef && state.acceptedConsumed) {
    const currentEnvironment = [...state.admissions]
      .reverse()
      .find((admission) => admission.phase === 'environment')
    if (currentEnvironment?.phase === 'environment') state.priorSession = currentEnvironment
    delete state.inputSequence
    delete state.taskRef
    delete state.acceptedRef
    delete state.accepted
    // A deliberate later drive starts a distinct invocation after an accepted result.
    state.admissions.length = 0
    delete state.acceptedConsumed
  }
  state.prepared = true
  if (state.taskRef !== undefined) {
    const original = await args.blobs.get(state.taskRef)
    if (original === undefined || contentAddress(original) !== state.taskRef) {
      throw new ValidationError('retained owner task is missing or corrupt')
    }
    return original
  }
  const snapshot = detachedSnapshot(task, 'retained owner task')
  const taskRef = contentAddress(snapshot)
  await args.blobs.put(taskRef, snapshot)
  scope.signal.throwIfAborted()
  const inputSequence = state.nextSequence()
  await args.journal.appendEvent(args.rootId, {
    kind: 'execution-input',
    id: args.nodeId,
    taskRef,
    ...(state.workspaceRetention ? { workspaceRetention: true } : {}),
    seq: inputSequence,
    at: new Date(args.now()).toISOString(),
  })
  state.taskRef = taskRef
  state.inputSequence = inputSequence
  return snapshot
}

/** Accepted backend output remains evidence, never the supervisor's finalized output. */
export async function scopeRetainedOwnerResult(
  scope: Scope<unknown>,
): Promise<ExecutorResult<unknown> | undefined> {
  const state = owners.get(scope)
  if (!state?.acceptedRef) return undefined
  if (state.accepted) return state.accepted
  const event = state.acceptedRef
  const out = await state.args.blobs.get(event.outRef)
  if (out === undefined || contentAddress(out) !== event.outRef) {
    throw new ValidationError('retained owner result is missing or corrupt')
  }
  assertValidSpend(event.spent, 'replayed retained owner result')
  return {
    outRef: event.outRef,
    out,
    spent: event.spent,
    ...(event.verdict ? { verdict: event.verdict } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
  }
}

export async function scopeRetainedOwnerPriorSpend(scope: Scope<unknown>) {
  const state = owners.get(scope)
  if (!state) return zeroSpend()
  const events = ((await state.args.journal.loadTree(state.args.rootId)) ?? []).filter(
    (event) => event.id === state.args.nodeId,
  )
  const input = [...events].reverse().find((event) => event.kind === 'execution-input')
  if (!input) return zeroSpend()
  return events
    .slice(events.indexOf(input))
    .reduce(
      (total, event) => (event.kind === 'metered' ? addSpend(total, event.spend) : total),
      zeroSpend(),
    )
}

/** Called only after the scope verifies the accepted invocation's materialization. */
export function consumeScopeRetainedOwnerResult(scope: Scope<unknown>): void {
  const state = owners.get(scope)
  if (!state?.acceptedRef) throw new ValidationError('retained owner has no accepted result')
  state.acceptedConsumed = true
}
