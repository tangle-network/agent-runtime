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
  mergeAgentProfiles,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  CoordinationEvent,
  MakeWorkerAgent,
  QuestionPolicy,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import { spendFromUsageEvents } from './budget'
import { checkDeliverable, type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import type { CoordinationSource, PriorCoordination } from './coordination-log'
import type { CoordinationSession, CoordinationSessionOptions } from './coordination-mcp'
import { runFinalizer, runTree, type SupervisorFinalizer } from './finalizer'
import type {
  Agent,
  AgentSpec,
  Budget,
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
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget
  /** Executor chosen by the caller's one resolver for this exact profile and tree position. */
  readonly executorFactory: ExecutorFactory<unknown>
  /** Opens the coordination surface and supplies the exact provider-visible profile entry. */
  readonly openCoordination: OpenCoordination
  readonly executorShutdown: number | 'brutalKill' | 'infinity'
  readonly workerShutdown: number | 'brutalKill' | 'infinity'
  /** Independent completion check for direct driver work (`submit_result`). */
  readonly deliverable: DeliverableSpec<unknown>
  readonly maxLiveWorkers: number | null
  readonly awaitTimeoutMs: number
  readonly questionPolicy: QuestionPolicy
  readonly analysts: AnalystRegistry | null
  readonly analyzeOnSettle: ReadonlyArray<string>
  readonly watchWorkers: WorkerWatchOptions | null
  readonly stallAfterMs: number | null
  readonly onEvent:
    | ((source: CoordinationSource, event: CoordinationEvent) => void | Promise<void>)
    | null
  readonly priorCoordination?: PriorCoordination
  readonly finalizer: SupervisorFinalizer
}

/** Build a supervisor from one complete `AgentProfile` and one explicit executor configuration. */
export function supervisorAgent(
  profile: AgentProfile,
  deps: SupervisorAgentDeps,
): Agent<unknown, unknown> {
  const name = requiredProfileName(profile)
  if (Object.hasOwn(profile.mcp ?? {}, coordinationMcpName)) {
    throw new ValidationError(
      `supervisorAgent: profile.mcp.${coordinationMcpName} is reserved for the live coordination server`,
    )
  }
  let lastVerdict: { valid: boolean; score: number } | undefined

  return {
    name,
    resultVerdict: () => lastVerdict,
    async act(task, scope) {
      lastVerdict = undefined
      let mcp: CoordinationSession | undefined
      let executor: Executor<unknown> | undefined
      let executorArtifact: ExecutorResult<unknown> | undefined
      let result: unknown
      let runCompleted = false
      let runFailure: unknown

      try {
        const opened = await deps.openCoordination({
          scope,
          blobs: deps.blobs,
          makeWorkerAgent: deps.makeWorkerAgent,
          perWorker: deps.perWorker,
          workerShutdown: deps.workerShutdown,
          deliverable: deps.deliverable,
          maxLiveWorkers: deps.maxLiveWorkers,
          awaitTimeoutMs: deps.awaitTimeoutMs,
          questionPolicy: deps.questionPolicy,
          stallAfterMs: deps.stallAfterMs,
          analysts: deps.analysts,
          analyzeOnSettle: deps.analyzeOnSettle,
          watchWorkers: deps.watchWorkers,
          onEvent: deps.onEvent
            ? (event) => deps.onEvent?.({ nodeId: scope.view.root, profileName: name }, event)
            : null,
          priorQuestions: deps.priorCoordination?.questions ?? [],
          priorFindings: deps.priorCoordination?.findings ?? [],
        })

        mcp = opened.handle
        const executableProfile = mergeAgentProfiles(profile, {
          mcp: {
            [coordinationMcpName]: opened.profileEntry,
          },
        })
        if (!executableProfile) {
          throw new ValidationError('supervisorAgent: failed to materialize the driver profile')
        }

        const spec: AgentSpec = { profile: executableProfile }
        executor = gateOnDeliverable(
          deps.executorFactory(spec, {
            signal: scope.signal,
            seams: {},
          }),
          deps.deliverable,
        )
        try {
          executorArtifact = await executeAgent(executor, task, scope, name)
        } catch (error) {
          // A checked direct result is already complete; a later provider failure cannot erase it.
          if (!(error instanceof AgentBackendError) || !mcp.submittedResult()) throw error
        }
        await mcp.drainResolved()
        const submitted = mcp.submittedResult()
        const checkedArtifact =
          executorArtifact?.verdict?.valid === true ? executorArtifact : undefined
        const settled = mcp.settled()
        const finalized =
          submitted || checkedArtifact
            ? undefined
            : await runFinalizer(deps.finalizer, {
                settled,
                blobs: deps.blobs,
                tree: runTree(scope),
                budget: scope.budget,
              })
        result = submitted ? submitted.result : checkedArtifact ? checkedArtifact.out : finalized
        if (submitted) lastVerdict = { valid: true, score: 1 }
        else if (checkedArtifact) lastVerdict = checkedArtifact.verdict
        else
          lastVerdict =
            finalized === undefined
              ? { valid: false, score: 0 }
              : await checkDeliverable(finalized, deps.deliverable)
        runCompleted = true
      } catch (error) {
        runFailure = error
      }

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

function requiredProfileName(profile: AgentProfile): string {
  if (typeof profile.name !== 'string' || profile.name.trim().length === 0) {
    throw new ValidationError('supervisorAgent: profile.name is required')
  }
  return profile.name
}

function isAsyncIterable(value: unknown): value is AsyncIterable<UsageEvent> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  )
}
