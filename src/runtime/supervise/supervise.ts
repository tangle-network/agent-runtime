/**
 * `supervise` — build and run a supervisor from one complete `AgentProfile`.
 *
 * Every profile becomes the same coordination-capable atom. The caller resolves each exact authored
 * profile to an executor factory; the runtime always supplies recursion. There is no worker/driver
 * role discriminator: an agent may submit checked work directly, spawn descendants, or do both
 * until the one explicit depth ceiling refuses another spawn.
 */
import { type AgentProfile, snapshotAgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { AnalystRegistry, ParentQuestionPort } from '../../mcp/tools/coordination'
import type { RuntimeHooks } from '../../runtime-hooks'
import { driverChild, withDriverExecutor } from './driver-executor'
import { assertProfileModelsAllowed } from './model-policy'
import type { RunContext } from './run-context'
import { createSupervisor } from './supervisor'
import { type OpenCoordination, supervisorAgent } from './supervisor-agent'
import type { Budget, ExecutorFactory } from './types'
import type { WaitProbeRegistry } from './wait'

/** Structural position supplied to backend resolution. It describes the tree; it chooses nothing. */
export interface AgentExecutionContext {
  readonly nodeId: string
  readonly depth: number
}

interface AgentTreePosition {
  readonly depth: number
}

/**
 * Resolve one exact authored profile to its executor factory.
 *
 * The runtime calls this for the root and every descendant. Returning a different backend by
 * profile or depth is caller policy; the runtime neither rewrites profiles nor infers an
 * executor.
 */
export type ResolveExecutor = (
  profile: AgentProfile,
  context: AgentExecutionContext,
) => ExecutorFactory<unknown>

export interface SuperviseOptions {
  readonly context: RunContext
  readonly budget: Budget
  readonly resolveExecutor: ResolveExecutor
  readonly openCoordination: OpenCoordination
  /** Positive finite cap, or explicit null for unbounded concurrency. */
  readonly maxLiveWorkers: number | null
  readonly maxDepth: number
  readonly runId: string
  /** Continue the exact runId from the supplied stores. False starts a fresh run. */
  readonly resume: boolean
  readonly executorShutdown: number | 'brutalKill' | 'infinity'
  readonly workerShutdown: number | 'brutalKill' | 'infinity'
  readonly failureWindow: { readonly maxFailures: number; readonly withinMs: number } | null
  /** Explicit upward route for the root, or null when the root has no parent. */
  readonly parentQuestionPort: ParentQuestionPort | null
  readonly awaitTimeoutMs: number
  /** Non-negative threshold, or explicit null to disable stalled classification. */
  readonly stallAfterMs: number | null
  readonly analysts: AnalystRegistry | null
  /** Predicate registry for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so the
   *  wait survives a restart; this is what the name resolves against. Unset ⇒ `poll` waits are
   *  refused `unknown-probe` and `timer` waits still work. */
  readonly probes: WaitProbeRegistry | null
  readonly now: () => number
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
  assertProfileModelsAllowed(rootProfile, opts.allowedModels)

  const ctx = opts.context
  const blobs = ctx.blobs
  const journal = ctx.journal
  const executors = withDriverExecutor(ctx.executors)
  const runId = opts.runId
  const log = ctx.coordinationLog
  const now = opts.now
  const onCoordinationEvent = (
    source: Parameters<typeof log.append>[1],
    record: Parameters<typeof log.append>[2],
  ) => log.append(runId, source, record)

  const buildAgent = (
    authoredProfile: AgentProfile,
    position: AgentTreePosition,
    parentQuestionPort: ParentQuestionPort | null,
  ): ReturnType<typeof supervisorAgent> => {
    // Resolve only when this exact agent is admitted to execution. Building a would-be descendant
    // must not select or initialize a backend before the scope's depth/budget checks accept it.
    const executorFactory: ExecutorFactory<unknown> = (spec, context) => {
      const execution = executionContext(context.nodeId, position)
      return resolveExecutorFactory(authoredProfile, execution, opts)(spec, context)
    }
    const makeRecursiveAgent = (
      rawProfile: unknown,
      childParentQuestionPort: ParentQuestionPort,
    ) => {
      const childProfile = requireProfile(rawProfile)
      const childPosition = treePosition(position.depth + 1)
      return driverChild(
        childProfile,
        buildAgent(childProfile, childPosition, childParentQuestionPort),
        journal,
      )
    }
    return supervisorAgent(authoredProfile, {
      blobs,
      makeWorkerAgent: makeRecursiveAgent,
      executorFactory,
      openCoordination: opts.openCoordination,
      executorShutdown: opts.executorShutdown,
      workerShutdown: opts.workerShutdown,
      maxLiveWorkers: opts.maxLiveWorkers,
      awaitTimeoutMs: opts.awaitTimeoutMs,
      parentQuestionPort,
      stallAfterMs: opts.stallAfterMs,
      analysts: opts.analysts,
      loadPriorCoordination: (nodeId) =>
        opts.resume
          ? log.load(runId, nodeId)
          : Promise.resolve({ records: [], questions: [], findings: [] }),
      onEvent: onCoordinationEvent,
      now,
    })
  }

  const start = async () => {
    const rootPosition = treePosition(0)
    const agent = buildAgent(rootProfile, rootPosition, opts.parentQuestionPort)

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
      ...(opts.resume ? { resume: true } : {}),
      now,
      ...(opts.hooks ? { hooks: opts.hooks } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  }

  return start()
}

function requireProfile(value: unknown): AgentProfile {
  if (!value || typeof value !== 'object') {
    throw new ValidationError('supervise: spawned profile must be an AgentProfile object')
  }
  return snapshotAgentProfile(value)
}

function validateSuperviseOptions(_profile: AgentProfile, opts: SuperviseOptions): void {
  const requiredFields = [
    'context',
    'budget',
    'resolveExecutor',
    'openCoordination',
    'maxLiveWorkers',
    'maxDepth',
    'runId',
    'resume',
    'executorShutdown',
    'workerShutdown',
    'failureWindow',
    'parentQuestionPort',
    'awaitTimeoutMs',
    'stallAfterMs',
    'analysts',
    'probes',
    'hooks',
    'signal',
    'allowedModels',
    'now',
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
    typeof opts.context.executors?.resolve !== 'function' ||
    typeof opts.context.coordinationLog?.append !== 'function' ||
    typeof opts.context.coordinationLog?.load !== 'function'
  ) {
    throw new ValidationError('supervise: context must be a RunContext')
  }
  if (typeof opts.resolveExecutor !== 'function') {
    throw new ValidationError('supervise: resolveExecutor is required')
  }
  if (typeof opts.now !== 'function') {
    throw new ValidationError('supervise: now must be a function')
  }
  if (typeof opts.openCoordination !== 'function') {
    throw new ValidationError('supervise: openCoordination is required')
  }
  requireShutdown(opts.executorShutdown, 'executorShutdown')
  requireShutdown(opts.workerShutdown, 'workerShutdown')
  if (!Number.isInteger(opts.maxDepth) || opts.maxDepth < 0) {
    throw new ValidationError('supervise: maxDepth must be a non-negative integer')
  }
  if (typeof opts.runId !== 'string' || opts.runId.trim().length === 0) {
    throw new ValidationError('supervise: runId is required')
  }
  if (typeof opts.resume !== 'boolean') {
    throw new ValidationError('supervise: resume must be boolean')
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
  if (
    opts.analysts !== null &&
    (typeof opts.analysts?.list !== 'function' || typeof opts.analysts?.run !== 'function')
  ) {
    throw new ValidationError('supervise: analysts must be an AnalystRegistry or null')
  }
  if (opts.parentQuestionPort !== null && typeof opts.parentQuestionPort?.ask !== 'function') {
    throw new ValidationError('supervise: parentQuestionPort must be a ParentQuestionPort or null')
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
}

function resolveExecutorFactory(
  profile: AgentProfile,
  context: AgentExecutionContext,
  opts: SuperviseOptions,
): ExecutorFactory<unknown> {
  assertProfileModelsAllowed(profile, opts.allowedModels)
  const resolved = opts.resolveExecutor(profile, context)
  if (typeof resolved !== 'function') {
    throw new ValidationError(
      `supervise: resolveExecutor returned no ExecutorFactory for node "${context.nodeId}" at depth ${context.depth}`,
    )
  }
  return resolved
}

function treePosition(depth: number): AgentTreePosition {
  return Object.freeze({ depth })
}

function executionContext(nodeId: string, position: AgentTreePosition): AgentExecutionContext {
  return Object.freeze({
    nodeId,
    depth: position.depth,
  })
}

function requireShutdown(value: number | 'brutalKill' | 'infinity', field: string): void {
  if (value !== 'brutalKill' && value !== 'infinity' && (!Number.isFinite(value) || value < 0)) {
    throw new ValidationError(`supervise: ${field} must be non-negative, brutalKill, or infinity`)
  }
}
