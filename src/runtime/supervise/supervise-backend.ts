import { randomUUID } from 'node:crypto'
import {
  type AgentProfile,
  type AgentProfileSecurityPolicy,
  agentProfileSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import {
  assertProfileMaterialization,
  controlProfileMaterialization,
  defineProfileMaterializationContract,
  fullProfileMaterialization,
  type ProfileMaterializationContract,
  profileMaterializationAxes,
  promptModelProfileMaterialization,
  worktreeCliProfileMaterialization,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import type { MakeWorkerAgent } from '../../mcp/tools/coordination-types'
import { harnessRunsAgent } from '../harness-role'
import { abortableAsyncIterable, awaitAbortable } from '../turn-timeout'
import { canonicalizeAuthoredProfile } from './authoring'
import { spendFromUsageEvents } from './budget'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import { DEFAULT_SUCCESSFUL_SHUTDOWN_MS, teardownExecutor } from './deadline'
import {
  attestRuntimeOwnedScopeOwner,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
} from './materialization'
import {
  bindReusableExecutorExecutionId,
  captureReusableExecutorConfig,
  createExecutor,
  type ExecutorConfig,
} from './runtime'
import { recordScopeOwnerMaterialization, scopeOwnerExecutorNodeContext } from './scope'
import { detachedSnapshot } from './snapshot'
import type { DriveHarness } from './supervisor-agent'
import type { Agent, AgentSpec, Executor, ExecutorContext, UsageEvent } from './types'
import { WORKER_TRACE_PROPAGATION } from './worker-trace'

/**
 * Build the worker seam from a backend and optional completion check.
 * This is the one place a backend becomes a spawnable worker.
 */
export function workerFromBackend(
  backend: ExecutorConfig,
  deliverable?: DeliverableSpec<unknown>,
  seams?: () => Readonly<Record<string, unknown>>,
): MakeWorkerAgent {
  const capturedBackend = captureReusableExecutorConfig(backend, 'workerFromBackend')
  const unscopedNamespace = randomUUID()
  let unscopedOrdinal = 0
  return (rawProfile, spawnContext) => {
    const parsed = agentProfileSchema.safeParse(canonicalizeAuthoredProfile(rawProfile))
    if (!parsed.success) {
      throw new ValidationError(`workerFromBackend: invalid AgentProfile: ${parsed.error.message}`)
    }
    const profile = parsed.data
    assertBackendProfileMaterialization(profile, capturedBackend, 'workerFromBackend')
    const name = profile.name ?? 'worker'
    const assignmentId =
      spawnContext?.assignmentId ?? `unscoped:${unscopedNamespace}:${unscopedOrdinal++}`
    const boundBackend = bindReusableExecutorExecutionId(
      capturedBackend,
      externalExecutionId('supervised-worker', { assignmentId }),
    )
    const baseFactory = createExecutor(boundBackend)
    const executorFactory = (spec: AgentSpec, ctx: ExecutorContext) => {
      const extraSeams = seams?.()
      const built = baseFactory(
        spec,
        extraSeams === undefined ? ctx : { ...ctx, seams: { ...extraSeams, ...ctx.seams } },
      )
      return deliverable ? gateOnDeliverable(built, deliverable) : built
    }
    const spec: AgentSpec = {
      profile,
      harness: null,
      executorFactory,
      ...(spawnContext?.execution ? { execution: spawnContext.execution } : {}),
    }
    return { name, act: async () => '', executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
}

export function externalExecutionId(kind: string, identity: unknown): string {
  const digest = canonicalCandidateDigest({ kind, identity })
  return `${kind}-${digest.slice('sha256:'.length)}`
}

export function workerTraceUnpropagatedDeclaration(
  backend: ExecutorConfig['backend'],
): { backend: string; reason: 'no-env-channel' | 'no-worker-process' } | undefined {
  if (WORKER_TRACE_PROPAGATION[backend]) return undefined
  const reason =
    backend === 'router' || backend === 'router-tools' || backend === 'provider'
      ? ('no-worker-process' as const)
      : ('no-env-channel' as const)
  return { backend, reason }
}

export function backendProfileMaterialization(
  backend: ExecutorConfig,
): ProfileMaterializationContract {
  switch (backend.backend) {
    case 'bridge':
    case 'sandbox':
    case 'provider':
      return fullProfileMaterialization
    case 'cli-worktree':
      return backend.bridge ? fullProfileMaterialization : worktreeCliProfileMaterialization
    case 'router':
    case 'router-tools':
      return promptModelProfileMaterialization
    case 'cli':
      return controlProfileMaterialization
  }
}

export function assertProfileContract(
  profile: AgentProfile,
  contract: ProfileMaterializationContract,
  context: string,
): void {
  assertProfileMaterialization({
    contract,
    changedAxes: profileMaterializationAxes(profile),
    context,
  })
}

function assertBackendProfileMaterialization(
  profile: AgentProfile,
  backend: ExecutorConfig,
  context: string,
): void {
  assertProfileContract(profile, backendProfileMaterialization(backend), context)
}

export const routerSupervisorProfileMaterialization = defineProfileMaterializationContract({
  name: 'router-supervisor-execution',
  axes: [
    'name',
    'description',
    'version',
    'tags',
    'systemPrompt',
    'instructions',
    'resourceInstructions',
    'modelDefault',
    'modelSmall',
    'modelProvider',
    'modelReasoningEffort',
    'modelMetadata',
    'harness',
    'metadata',
  ],
})

const coordinationMcpAlias = 'agent-runtime-coordination'
const defaultAllowedMcpHosts: string[] = []
Object.freeze(defaultAllowedMcpHosts)

/** Manager-authored profiles are untrusted until product policy says otherwise. */
export const DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY: AgentProfileSecurityPolicy = Object.freeze({
  allowLocalMcp: false,
  allowHooks: false,
  allowedMcpHosts: defaultAllowedMcpHosts,
  allowConnections: false,
})

export function isExternalSupervisor(profile: AgentProfile): boolean {
  return harnessRunsAgent(profile.harness)
}

export function automaticDriverBackendSupported(backend: ExecutorConfig): boolean {
  return backend.backend === 'bridge'
}

export function backendProfileOverlays(backend: ExecutorConfig | undefined): AgentProfile[] {
  if (!backend) return []
  if (backend.backend === 'bridge' && backend.agentProfile) return [backend.agentProfile]
  if (backend.backend === 'cli-worktree' && backend.bridge?.agentProfile) {
    return [backend.bridge.agentProfile]
  }
  return []
}

export function driveHarnessFromBackend(
  backend: ExecutorConfig,
  executionId: string,
  now: () => number = Date.now,
): DriveHarness {
  const capturedBackend = captureReusableExecutorConfig(backend, 'driveHarnessFromBackend')
  const boundBackend = bindReusableExecutorExecutionId(capturedBackend, executionId)
  const baseFactory = createExecutor(boundBackend)
  let activeExecutor: Executor<unknown> | undefined
  const drive: DriveHarness = async ({
    profile,
    task,
    scope,
    coordinationMcpUrl,
    coordinationTools,
  }) => {
    const initialBudget = scope.budget
    const hasLiveCoordination = scope.view.inFlight > 0 || scope.view.waiting > 0
    if (
      !hasLiveCoordination &&
      (initialBudget.tokensLeft <= 0 ||
        initialBudget.iterationsLeft <= 0 ||
        (initialBudget.usdCapped && initialBudget.usdLeft <= 0) ||
        (initialBudget.deadlineMs > 0 && now() >= initialBudget.deadlineMs))
    ) {
      throw new ValidationError('driveHarnessFromBackend: supervisor budget exhausted')
    }
    const canonicalDriverProfile = agentProfileSchema.parse(profile)
    if (canonicalDriverProfile.mcp?.[coordinationMcpAlias] !== undefined) {
      throw new ValidationError(
        `driveHarnessFromBackend: profile MCP alias ${JSON.stringify(coordinationMcpAlias)} is reserved`,
      )
    }
    const effectiveProfile = agentProfileSchema.parse({
      ...canonicalDriverProfile,
      mcp: {
        ...canonicalDriverProfile.mcp,
        [coordinationMcpAlias]: { transport: 'http', url: coordinationMcpUrl },
      },
    })
    const stableCoordinationTools = detachedSnapshot(
      coordinationTools,
      'driveHarnessFromBackend coordination tools',
    )
    const spec: AgentSpec = {
      profile: effectiveProfile,
      harness:
        boundBackend.backend === 'sandbox'
          ? ((effectiveProfile.harness ?? boundBackend.harness ?? null) as BackendType | null)
          : null,
    }
    const executor = baseFactory(spec, {
      signal: scope.signal,
      node: scopeOwnerExecutorNodeContext(scope),
      seams: {},
    })
    activeExecutor = executor
    let completed = false
    let started = false
    let terminalAccountingCaptured = false
    let pendingUsage: UsageEvent[] = []
    let teardownStarted = false
    const deadlineAtMs = scope.budget.deadlineMs || undefined
    const teardownOnce = async (grace: number | 'brutalKill' | 'infinity') => {
      if (teardownStarted) return
      teardownStarted = true
      await teardownExecutor(executor, grace, deadlineAtMs, now)
    }
    const meterPending = async () => {
      if (pendingUsage.length === 0) return
      const batch = pendingUsage
      pendingUsage = []
      await scope.meter(spendFromUsageEvents(batch), {
        role: 'driver',
        runtime: executor.runtime,
      })
      const budget = scope.budget
      if (
        budget.tokensLeft <= 0 ||
        (budget.usdCapped && budget.usdLeft <= 0) ||
        (budget.deadlineMs > 0 && now() >= budget.deadlineMs)
      ) {
        throw new ValidationError('driveHarnessFromBackend: supervisor budget exhausted')
      }
    }
    let failed = false
    let failure: unknown
    try {
      const declaration = runtimeOwnedExecutorMaterialization(executor)
      const executionBinding = runtimeOwnedExecutorExecutionBinding(executor)
      if (declaration === undefined || executionBinding === undefined) {
        throw new ValidationError(
          `driveHarnessFromBackend: built-in runtime ${JSON.stringify(executor.runtime)} has no trusted materialization declaration or execution binding`,
        )
      }
      await recordScopeOwnerMaterialization(
        scope,
        executor.runtime,
        {
          ...declaration,
          effectiveProfile: canonicalDriverProfile,
          platformAttachments: {
            [coordinationMcpAlias]: {
              kind: 'coordination-mcp',
              transport: 'http',
              tools: stableCoordinationTools,
            },
          },
        },
        {
          ...executionBinding,
          binding: {
            stableBinding: executionBinding.binding,
            platformAttachments: {
              [coordinationMcpAlias]: {
                transport: 'http',
                url: coordinationMcpUrl,
              },
            },
          },
          descriptor: { ...executionBinding.descriptor, coordination: true },
        },
      )
      if (executor.budgetExempt) {
        throw new ValidationError(
          `driveHarnessFromBackend: runtime ${JSON.stringify(executor.runtime)} does not report usage and cannot drive a budgeted supervisor`,
        )
      }
      started = true
      const run = executor.execute(task, scope.signal)
      if (isAsyncIterable<UsageEvent>(run)) {
        for await (const event of abortableAsyncIterable(run, scope.signal)) {
          if (event.kind === 'iteration') await meterPending()
          else if (event.kind !== 'runtime_event') pendingUsage.push(event)
        }
        await meterPending()
        const artifact = executor.resultArtifact()
        terminalAccountingCaptured = true
        if (artifact.spent.tokensKnown === false || artifact.spent.usdKnown === false) {
          await scope.meter(
            {
              iterations: 0,
              tokens: { input: 0, output: 0 },
              ...(artifact.spent.tokensKnown === false ? { tokensKnown: false } : {}),
              usd: 0,
              ...(artifact.spent.usdKnown === false ? { usdKnown: false } : {}),
              ms: 0,
            },
            { role: 'driver', runtime: executor.runtime, telemetry: 'unknown' },
          )
        }
      } else {
        const artifact = await awaitAbortable(Promise.resolve(run), scope.signal)
        terminalAccountingCaptured = true
        await scope.meter(
          { ...artifact.spent, iterations: 0 },
          { role: 'driver', runtime: executor.runtime },
        )
      }
      completed = true
    } catch (error) {
      failed = true
      failure = error
    } finally {
      try {
        await meterPending()
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
      if (failed && started && !terminalAccountingCaptured) {
        try {
          await scope.meter(
            {
              iterations: 0,
              tokens: { input: 0, output: 0 },
              tokensKnown: false,
              usd: 0,
              usdKnown: false,
              ms: 0,
            },
            { role: 'driver', runtime: executor.runtime, telemetry: 'unknown-after-failure' },
          )
        } catch (error) {
          const budget = scope.budget
          if (budget.tokensKnown !== false || (budget.usdCapped && budget.usdKnown !== false)) {
            failure = error
          }
        }
      }
      try {
        await teardownOnce(completed ? DEFAULT_SUCCESSFUL_SHUTDOWN_MS : 'brutalKill')
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
      if (activeExecutor === executor) activeExecutor = undefined
    }
    if (failed) throw failure
  }
  drive.deliver = (message): boolean => {
    const deliver = activeExecutor?.deliver
    if (!deliver) return false
    return deliver.call(activeExecutor, message) !== false
  }
  return attestRuntimeOwnedScopeOwner(drive, 'cli')
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function'
  )
}
