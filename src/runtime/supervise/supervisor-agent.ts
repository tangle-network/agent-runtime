/**
 * Build a supervisor from the same portable profile and executor contract used by every worker.
 *
 * The runtime adds one capability to the profile for the duration of the run: the live
 * coordination MCP server. Everything that determines the driver's behavior remains in the
 * caller-authored `AgentProfile`; everything that determines where it runs comes from the caller's
 * backend resolver before this agent is built.
 */
import {
  type AgentProfile,
  type AgentProfileMcpServer,
  canonicalAgentProfileDigest,
  mergeAgentProfiles,
  snapshotAgentProfile,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  CoordinationEvent,
  MakeWorkerAgent,
  ParentQuestionPort,
} from '../../mcp/tools/coordination'
import { spendFromUsageEvents } from './budget'
import type { CoordinationSource, PriorCoordination } from './coordination-log'
import type { CoordinationSession, CoordinationSessionOptions } from './coordination-mcp'
import type { BusRecord } from './event-bus'
import type { ExecutorProgress } from './progress'
import type { TraceSource } from './trace-source'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorFactory,
  ExecutorResult,
  ResultBlobStore,
  Scope,
  Spend,
  UsageEvent,
} from './types'

const coordinationMcpName = 'coordination'

export interface OpenedCoordination {
  readonly handle: CoordinationSession
  readonly profileEntry: AgentProfileMcpServer
}

/** Caller-owned transport adapter for one live coordination surface. */
export type OpenCoordination = (options: CoordinationSessionOptions) => Promise<OpenedCoordination>

export interface SupervisorAgentDeps {
  readonly blobs: ResultBlobStore
  /** Resolve a spawned profile to the same recursive coordination-capable agent. */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Executor chosen by the caller's one resolver for this exact profile and tree position. */
  readonly executorFactory: ExecutorFactory<unknown>
  /** Opens the coordination surface and supplies the exact provider-visible profile entry. */
  readonly openCoordination: OpenCoordination
  readonly executorShutdown: number | 'brutalKill' | 'infinity'
  readonly workerShutdown: number | 'brutalKill' | 'infinity'
  readonly maxLiveWorkers: number | null
  readonly awaitTimeoutMs: number
  readonly parentQuestionPort: ParentQuestionPort | null
  readonly analysts: AnalystRegistry | null
  readonly stallAfterMs: number | null
  readonly onEvent:
    | ((source: CoordinationSource, record: BusRecord<CoordinationEvent>) => void | Promise<void>)
    | null
  readonly loadPriorCoordination: (nodeId: string) => Promise<PriorCoordination>
  readonly now: () => number
}

/** Build a supervisor from one complete `AgentProfile` and one explicit executor configuration. */
export function supervisorAgent(
  profile: AgentProfile,
  deps: SupervisorAgentDeps,
): Agent<unknown, unknown> {
  const profileSnapshot = snapshotAgentProfile(profile)
  const name = canonicalAgentProfileDigest(profileSnapshot)
  if (Object.hasOwn(profileSnapshot.mcp ?? {}, coordinationMcpName)) {
    throw new ValidationError(
      `supervisorAgent: profile.mcp.${coordinationMcpName} is reserved for the live coordination server`,
    )
  }
  let lastVerdict: { valid: boolean; score: number } | undefined
  let activeExecutor: Executor<unknown> | undefined
  let acceptingMessages = true
  const pendingMessages: unknown[] = []

  const deliver = (message: unknown): boolean => {
    if (!acceptingMessages) return false
    if (!activeExecutor) {
      pendingMessages.push(message)
      return true
    }
    if (!activeExecutor.deliver || activeExecutor.canDeliver?.() === false) return false
    return activeExecutor.deliver(message) !== false
  }

  const progress = (): ExecutorProgress | undefined => {
    const current = activeExecutor?.progress?.()
    if (pendingMessages.length === 0) return current
    return {
      ...(current ?? {}),
      pendingMessages: (current?.pendingMessages ?? 0) + pendingMessages.length,
    }
  }

  return {
    name,
    profileDigest: name,
    resultVerdict: () => lastVerdict,
    deliver,
    canDeliver: () =>
      acceptingMessages &&
      (!activeExecutor ||
        (activeExecutor.deliver !== undefined && activeExecutor.canDeliver?.() !== false)),
    progress,
    traceSource: (): TraceSource | undefined => activeExecutor?.traceSource?.(),
    async act(task, scope) {
      lastVerdict = undefined
      let mcp: CoordinationSession | undefined
      let executor: Executor<unknown> | undefined
      let executorArtifact: ExecutorResult<unknown> | undefined
      let result: unknown
      let runCompleted = false
      let runFailure: unknown

      try {
        const priorCoordination = await deps.loadPriorCoordination(scope.view.root)
        const opened = await deps.openCoordination({
          scope,
          blobs: deps.blobs,
          makeWorkerAgent: deps.makeWorkerAgent,
          workerShutdown: deps.workerShutdown,
          maxLiveWorkers: deps.maxLiveWorkers,
          awaitTimeoutMs: deps.awaitTimeoutMs,
          parentQuestionPort: deps.parentQuestionPort,
          stallAfterMs: deps.stallAfterMs,
          analysts: deps.analysts,
          onEvent: deps.onEvent
            ? (event) => deps.onEvent?.({ nodeId: scope.view.root, profileName: name }, event)
            : null,
          priorRecords: priorCoordination.records,
          now: deps.now,
        })

        mcp = opened.handle
        const mergedProfile = mergeAgentProfiles(profileSnapshot, {
          mcp: {
            [coordinationMcpName]: opened.profileEntry,
          },
        })
        if (!mergedProfile) {
          throw new ValidationError('supervisorAgent: failed to materialize the driver profile')
        }
        const executableProfile = snapshotAgentProfile(mergedProfile)

        const spec: AgentSpec = { profile: executableProfile }
        executor = deps.executorFactory(spec, {
          nodeId: scope.view.root,
          signal: scope.signal,
          seams: {},
        })
        activeExecutor = executor
        while (pendingMessages.length > 0) {
          if (!executor.deliver || executor.canDeliver?.() === false) {
            throw new ValidationError(
              'supervisorAgent: backend cannot receive a message accepted before backend creation',
            )
          }
          const message = pendingMessages[0]
          if (executor.deliver(message) === false) {
            throw new ValidationError(
              'supervisorAgent: backend refused a message accepted before backend creation',
            )
          }
          pendingMessages.shift()
        }
        try {
          executorArtifact = await executeAgent(executor, task, scope, name)
        } catch (error) {
          // A checked direct result is already complete; a later provider failure cannot erase it.
          if (!(error instanceof AgentBackendError) || !mcp.submittedResult()) throw error
        }
        await mcp.drainResolved()
        const submitted = mcp.submittedResult()
        result = submitted ? submitted.result : executorArtifact?.out
        lastVerdict = submitted ? undefined : executorArtifact?.verdict
        runCompleted = true
      } catch (error) {
        runFailure = error
      }

      acceptingMessages = false
      pendingMessages.length = 0
      let cleanupFailure: unknown
      if (executor) {
        try {
          await executor.teardown(deps.executorShutdown)
        } catch (error) {
          cleanupFailure = error
        }
      }
      if (mcp) {
        try {
          await mcp.close()
        } catch (error) {
          cleanupFailure ??= error
        }
      }
      activeExecutor = undefined
      if (runFailure !== undefined) throw runFailure
      if (cleanupFailure !== undefined && (!runCompleted || result === undefined)) {
        throw cleanupFailure
      }
      return result
    },
  }
}

async function executeAgent(
  executor: Executor<unknown>,
  task: unknown,
  scope: Scope<unknown>,
  name: string,
): Promise<ExecutorResult<unknown>> {
  const execution = executor.execute(task, scope.signal)
  if (!isAsyncIterable(execution)) {
    let artifact: ExecutorResult<unknown>
    try {
      artifact = await execution
    } catch (error) {
      throw new AgentBackendError(executor.runtime, error)
    }
    const spend = artifact.spent
    if (hasSpend(spend)) {
      await scope.meter(spend, {
        kind: 'agent-inference',
        agent: name,
        runtime: executor.runtime,
      })
    }
    return artifact
  }

  try {
    for await (const event of execution) {
      try {
        const spend = spendFromUsageEvents([event])
        if (hasSpend(spend)) {
          await scope.meter(spend, {
            kind: 'agent-inference',
            agent: name,
            runtime: executor.runtime,
          })
        }
      } catch (error) {
        throw new AgentAccountingError(error)
      }
    }
    return executor.resultArtifact()
  } catch (error) {
    if (error instanceof AgentAccountingError) throw error.cause
    throw new AgentBackendError(executor.runtime, error)
  }
}

function hasSpend(spend: Spend): boolean {
  return (
    spend.iterations !== 0 ||
    spend.tokens.input !== 0 ||
    spend.tokens.output !== 0 ||
    spend.usd !== 0 ||
    spend.ms !== 0 ||
    spend.usdKnown === false
  )
}

class AgentBackendError extends Error {
  constructor(runtime: string, cause: unknown) {
    super(`agent backend "${runtime}" failed`, { cause })
    this.name = 'AgentBackendError'
  }
}

class AgentAccountingError extends Error {
  constructor(readonly cause: unknown) {
    super('agent inference accounting failed', { cause })
    this.name = 'AgentAccountingError'
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<UsageEvent> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  )
}
