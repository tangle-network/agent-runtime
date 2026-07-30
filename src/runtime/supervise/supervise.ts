/**
 * `supervise` — build and run a supervisor from one complete `AgentProfile`.
 *
 * Every profile becomes the same coordination-capable atom. The caller resolves each exact authored
 * profile to an executor factory; the runtime always supplies recursion. There is no worker/driver
 * role discriminator: an agent may submit checked work directly, spawn descendants, or do both
 * until the one explicit depth ceiling refuses another spawn.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  QuestionPolicy,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import type { RuntimeHooks } from '../../runtime-hooks'
import type { DeliverableSpec } from './completion-gate'
import { driverChild, withDriverExecutor } from './driver-executor'
import type { SupervisorFinalizer } from './finalizer'
import { assertModelAllowed } from './model-policy'
import type { RunContext } from './run-context'
import { createSupervisor } from './supervisor'
import { type OpenCoordination, supervisorAgent } from './supervisor-agent'
import type { Budget, ExecutorFactory } from './types'
import type { WaitProbeRegistry } from './wait'

/** Structural position supplied to backend resolution. It describes the tree; it chooses nothing. */
export interface AgentExecutionContext {
  readonly depth: number
  readonly path: readonly string[]
}

/**
 * Resolve one exact authored profile to its executor factory.
 *
 * The runtime calls this for the root and every descendant. Returning a different backend by
 * profile, depth, or path is caller policy; the runtime neither rewrites profiles nor infers an
 * executor.
 */
export type ResolveExecutor = (
  profile: AgentProfile,
  context: AgentExecutionContext,
) => ExecutorFactory<unknown>

type NamedAgentProfile = AgentProfile & { readonly name: string }

export interface SuperviseOptions {
  readonly context: RunContext
  readonly budget: Budget
  readonly resolveExecutor: ResolveExecutor
  readonly openCoordination: OpenCoordination
  readonly deliverable: DeliverableSpec<unknown>
  readonly finalizer: SupervisorFinalizer
  readonly perWorker: Budget
  /** Positive finite cap, or explicit null for unbounded concurrency. */
  readonly maxLiveWorkers: number | null
  readonly maxDepth: number
  readonly runId: string
  readonly executorShutdown: number | 'brutalKill' | 'infinity'
  readonly workerShutdown: number | 'brutalKill' | 'infinity'
  readonly failureWindow: { readonly maxFailures: number; readonly withinMs: number } | null
  readonly questionPolicy: QuestionPolicy
  readonly awaitTimeoutMs: number
  /** Non-negative threshold, or explicit null to disable stalled classification. */
  readonly stallAfterMs: number | null
  readonly analysts: AnalystRegistry | null
  readonly analyzeOnSettle: ReadonlyArray<string>
  readonly watchWorkers: WorkerWatchOptions | null
  /** Predicate registry for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so the
   *  wait survives a restart; this is what the name resolves against. Unset ⇒ `poll` waits are
   *  refused `unknown-probe` and `timer` waits still work. */
  readonly probes: WaitProbeRegistry | null
  readonly now?: () => number
  /** Existing lifecycle event sink; explicit null disables emission. */
  readonly hooks: RuntimeHooks | null
  /** Existing caller cancellation source; explicit null makes the run caller-unabortable. */
  readonly signal: AbortSignal | null
  /** Restrict the run to this subset of models. When set, every configured model — the
   *  authored profile's model hints must be members,
   *  or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted. */
  readonly allowedModels: readonly string[] | null
}

/** Build and run one explicitly configured supervisor. */
export function supervise(profile: AgentProfile, task: unknown, opts: SuperviseOptions) {
  const rootProfile = requireProfile(profile)
  validateSuperviseOptions(rootProfile, opts)
  const allowedModels = opts.allowedModels ?? undefined
  assertModelAllowed(rootProfile.model?.default, allowedModels)
  assertModelAllowed(rootProfile.model?.small, allowedModels)

  const ctx = opts.context
  const blobs = ctx.blobs
  const journal = ctx.journal
  const executors = withDriverExecutor(ctx.executors)
  const runId = opts.runId
  const log = ctx.coordinationLog
  const now = opts.now ?? Date.now
  const onCoordinationEvent = log
    ? (source: Parameters<typeof log.append>[1], event: Parameters<typeof log.append>[2]) =>
        log.append(runId, source, event, new Date(now()).toISOString())
    : undefined

  const buildAgent = (
    authoredProfile: NamedAgentProfile,
    execution: AgentExecutionContext,
    priorCoordination?: import('./coordination-log').PriorCoordination,
  ): ReturnType<typeof supervisorAgent> => {
    // Resolve only when this exact agent is admitted to execution. Building a would-be descendant
    // must not select or initialize a backend before the scope's depth/budget checks accept it.
    const executorFactory: ExecutorFactory<unknown> = (spec, context) =>
      resolveExecutorFactory(authoredProfile, execution, opts)(spec, context)
    const makeRecursiveAgent = (rawProfile: unknown) => {
      const childProfile = requireProfile(rawProfile)
      const childExecution = executionContext(childProfile, execution.depth + 1, execution.path)
      return driverChild(childProfile, buildAgent(childProfile, childExecution), journal)
    }
    return supervisorAgent(authoredProfile, {
      blobs,
      makeWorkerAgent: makeRecursiveAgent,
      perWorker: opts.perWorker,
      executorFactory,
      openCoordination: opts.openCoordination,
      executorShutdown: opts.executorShutdown,
      workerShutdown: opts.workerShutdown,
      deliverable: opts.deliverable,
      finalizer: opts.finalizer,
      maxLiveWorkers: opts.maxLiveWorkers,
      awaitTimeoutMs: opts.awaitTimeoutMs,
      questionPolicy: opts.questionPolicy,
      stallAfterMs: opts.stallAfterMs,
      ...(priorCoordination ? { priorCoordination } : {}),
      analysts: opts.analysts,
      analyzeOnSettle: opts.analyzeOnSettle,
      watchWorkers: opts.watchWorkers,
      onEvent: onCoordinationEvent ?? null,
    })
  }

  const start = async () => {
    const priorCoordination = log ? await log.load(runId) : undefined

    const rootExecution = executionContext(rootProfile, 0, [])
    const agent = buildAgent(rootProfile, rootExecution, priorCoordination)

    return createSupervisor<unknown, unknown>().run(agent, task, {
      budget: opts.budget,
      runId,
      journal,
      blobs,
      executors,
      maxDepth: opts.maxDepth,
      ...(opts.failureWindow
        ? {
            maxFailures: opts.failureWindow.maxFailures,
            withinMs: opts.failureWindow.withinMs,
          }
        : {}),
      ...(opts.probes ? { probes: opts.probes } : {}),
      ...(ctx.resume === true ? { resume: true } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.hooks ? { hooks: opts.hooks } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  return start()
}

function requireProfile(value: unknown): NamedAgentProfile {
  if (!value || typeof value !== 'object') {
    throw new ValidationError('supervise: spawned profile must be an AgentProfile object')
  }
  const profile = value as AgentProfile
  if (typeof profile.name !== 'string' || profile.name.trim().length === 0) {
    throw new ValidationError('supervise: every spawned AgentProfile requires name')
  }
  return profile as NamedAgentProfile
}

function validateSuperviseOptions(_profile: NamedAgentProfile, opts: SuperviseOptions): void {
  const requiredFields = [
    'context',
    'budget',
    'resolveExecutor',
    'openCoordination',
    'deliverable',
    'finalizer',
    'perWorker',
    'maxLiveWorkers',
    'maxDepth',
    'runId',
    'executorShutdown',
    'workerShutdown',
    'failureWindow',
    'questionPolicy',
    'awaitTimeoutMs',
    'stallAfterMs',
    'analysts',
    'analyzeOnSettle',
    'watchWorkers',
    'probes',
    'hooks',
    'signal',
    'allowedModels',
  ] as const
  for (const field of requiredFields) {
    if (!Object.hasOwn(opts, field)) {
      throw new ValidationError(`supervise: ${field} must be supplied explicitly`)
    }
  }
  if (
    !opts.context ||
    typeof opts.context !== 'object' ||
    typeof opts.context.journal?.beginTree !== 'function' ||
    typeof opts.context.blobs?.put !== 'function' ||
    typeof opts.context.executors?.resolve !== 'function'
  ) {
    throw new ValidationError('supervise: context must be a RunContext')
  }
  if (typeof opts.resolveExecutor !== 'function') {
    throw new ValidationError('supervise: resolveExecutor is required')
  }
  if (typeof opts.openCoordination !== 'function') {
    throw new ValidationError('supervise: openCoordination is required')
  }
  if (typeof opts.deliverable?.check !== 'function') {
    throw new ValidationError('supervise: deliverable.check is required')
  }
  if (typeof opts.finalizer !== 'function') {
    throw new ValidationError('supervise: finalizer is required')
  }
  requireShutdown(opts.executorShutdown, 'executorShutdown')
  requireShutdown(opts.workerShutdown, 'workerShutdown')
  if (!Number.isInteger(opts.maxDepth) || opts.maxDepth < 0) {
    throw new ValidationError('supervise: maxDepth must be a non-negative integer')
  }
  if (typeof opts.runId !== 'string' || opts.runId.trim().length === 0) {
    throw new ValidationError('supervise: runId is required')
  }
  if (
    opts.maxLiveWorkers !== null &&
    (!Number.isInteger(opts.maxLiveWorkers) || opts.maxLiveWorkers <= 0)
  ) {
    throw new ValidationError('supervise: maxLiveWorkers must be a positive integer or null')
  }
  if (
    opts.stallAfterMs !== null &&
    (!Number.isFinite(opts.stallAfterMs) || opts.stallAfterMs < 0)
  ) {
    throw new ValidationError('supervise: stallAfterMs must be non-negative or null')
  }
  if (!Number.isFinite(opts.awaitTimeoutMs) || opts.awaitTimeoutMs < 0) {
    throw new ValidationError('supervise: awaitTimeoutMs must be non-negative')
  }
  if (opts.failureWindow !== null) {
    if (
      !Number.isInteger(opts.failureWindow.maxFailures) ||
      opts.failureWindow.maxFailures < 0 ||
      !Number.isFinite(opts.failureWindow.withinMs) ||
      opts.failureWindow.withinMs < 0
    ) {
      throw new ValidationError(
        'supervise: failureWindow requires non-negative maxFailures and withinMs',
      )
    }
  }
  if (!Array.isArray(opts.analyzeOnSettle)) {
    throw new ValidationError('supervise: analyzeOnSettle must be an explicit array')
  }
  if (opts.analyzeOnSettle.length > 0 && !opts.analysts) {
    throw new ValidationError('supervise: analyzeOnSettle requires analysts')
  }
  if (
    opts.analysts !== null &&
    (!Array.isArray(opts.analysts?.kinds) || typeof opts.analysts?.run !== 'function')
  ) {
    throw new ValidationError('supervise: analysts must be an AnalystRegistry or null')
  }
  if (opts.watchWorkers !== null) {
    if (!Array.isArray(opts.watchWorkers.detectors)) {
      throw new ValidationError('supervise: watchWorkers.detectors must be explicit')
    }
    if (!Number.isInteger(opts.watchWorkers.maxFindingsPerWorker)) {
      throw new ValidationError(
        'supervise: watchWorkers.maxFindingsPerWorker must be an explicit integer',
      )
    }
  }
  if (opts.probes !== null && typeof opts.probes?.resolve !== 'function') {
    throw new ValidationError('supervise: probes must be a WaitProbeRegistry or null')
  }
  if (opts.hooks !== null && (typeof opts.hooks !== 'object' || opts.hooks === undefined)) {
    throw new ValidationError('supervise: hooks must be RuntimeHooks or null')
  }
  if (
    opts.signal !== null &&
    (typeof opts.signal !== 'object' || typeof opts.signal.addEventListener !== 'function')
  ) {
    throw new ValidationError('supervise: signal must be an AbortSignal or null')
  }
  if (
    opts.allowedModels !== null &&
    (!Array.isArray(opts.allowedModels) ||
      opts.allowedModels.some((model) => typeof model !== 'string'))
  ) {
    throw new ValidationError('supervise: allowedModels must be a string array or null')
  }
  if (!['auto', 'mustDecide', 'bubble', 'failClosed'].includes(opts.questionPolicy)) {
    throw new ValidationError('supervise: questionPolicy is invalid')
  }
}

function resolveExecutorFactory(
  profile: NamedAgentProfile,
  context: AgentExecutionContext,
  opts: SuperviseOptions,
): ExecutorFactory<unknown> {
  const allowedModels = opts.allowedModels ?? undefined
  assertModelAllowed(profile.model?.default, allowedModels)
  assertModelAllowed(profile.model?.small, allowedModels)
  const resolved = opts.resolveExecutor(profile, context)
  if (typeof resolved !== 'function') {
    throw new ValidationError(
      `supervise: resolveExecutor returned no ExecutorFactory for "${profile.name}" at depth ${context.depth}`,
    )
  }
  return resolved
}

function executionContext(
  profile: NamedAgentProfile,
  depth: number,
  parentPath: readonly string[],
): AgentExecutionContext {
  return Object.freeze({
    depth,
    path: Object.freeze([...parentPath, profile.name]),
  })
}

function requireShutdown(value: number | 'brutalKill' | 'infinity', field: string): void {
  if (value !== 'brutalKill' && value !== 'infinity' && (!Number.isFinite(value) || value < 0)) {
    throw new ValidationError(`supervise: ${field} must be non-negative, brutalKill, or infinity`)
  }
}
