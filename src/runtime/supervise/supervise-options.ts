import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalCandidateDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import type { CoordinationEvent, WorkerSpawnContext } from '../../mcp/tools/coordination-types'
import type { DeliverableSpec } from './completion-gate'
import { snapshotExecutorConfig } from './runtime'
import { deriveNodeExecutionIdentity } from './scope'
import { detachedSnapshot } from './snapshot'
import type { SuperviseOptions, SuperviseRegistryTable } from './supervise-options-types'
import type { SupervisorNodeContext, SupervisorProfile } from './supervisor-agent'
import type { AgentExecutionRef, Budget, NodeExecutionIdentity } from './types'

interface SuperviseRegistryTableFor {
  readonly deliverable: 'deliverables'
  readonly finalizer: 'finalizers'
  readonly analysts: 'analysts'
  readonly probes: 'probes'
}

export function resolveNamed<K extends keyof SuperviseRegistryTableFor, T extends object>(
  option: K,
  table: SuperviseRegistryTableFor[K],
  value: T | string | undefined,
  registry: SuperviseRegistryTable<T> | undefined,
): T | undefined {
  if (typeof value !== 'string') return value
  if (!registry) {
    throw new ConfigError(
      `supervise: opts.${option} = ${JSON.stringify(value)} names a registry entry, but no ` +
        `opts.registry.${table} was provided to resolve it against`,
    )
  }
  const entry = registry.resolve(value)
  if (entry === undefined) {
    throw new ConfigError(
      `supervise: opts.${option} = ${JSON.stringify(value)} is not in opts.registry.${table} — ` +
        'the table resolved no entry under that name',
    )
  }
  return entry
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
  return Object.freeze({
    ...detachedSnapshot({ describe: deliverable.describe }, `${context} configuration`),
    check: deliverable.check,
  })
}

export function captureSuperviseOptions(opts: SuperviseOptions): SuperviseOptions {
  const {
    backend,
    driverBackend,
    deliverable,
    resolveDeliverable,
    router,
    compaction,
    watchWorkers,
    analysts,
    makeWorkerAgent,
    blobs,
    journal,
    probes,
    registry,
    hooks,
    otel,
    authorizeSpawn,
    authorizeMessage,
    isDriverProfile,
    brain,
    driveHarness,
    resolveDriveHarness,
    resolveSupervisorTools,
    onCoordinationEvent,
    executeExtraTool,
    stopRule,
    onProgressStop,
    finalizer,
    now,
    signal,
    rootHandle,
    ...decisionData
  } = opts
  const capturedData = detachedSnapshot(decisionData, 'supervise options')
  const capturedBackend = backend === undefined ? undefined : snapshotExecutorConfig(backend)
  const capturedDriverBackend =
    driverBackend === undefined ? undefined : snapshotExecutorConfig(driverBackend)
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
  const capturedAnalysts =
    analysts === undefined || typeof analysts === 'string'
      ? analysts
      : Object.freeze({
          kinds: detachedSnapshot(analysts.kinds, 'supervise analyst kinds'),
          run: analysts.run,
        })

  return Object.freeze({
    ...capturedData,
    ...(capturedBackend === undefined ? {} : { backend: capturedBackend }),
    ...(capturedDriverBackend === undefined ? {} : { driverBackend: capturedDriverBackend }),
    ...(capturedDeliverable === undefined ? {} : { deliverable: capturedDeliverable }),
    ...(resolveDeliverable === undefined ? {} : { resolveDeliverable }),
    ...(capturedRouter === undefined ? {} : { router: capturedRouter }),
    ...(capturedCompaction === undefined ? {} : { compaction: capturedCompaction }),
    ...(capturedWatchWorkers === undefined ? {} : { watchWorkers: capturedWatchWorkers }),
    ...(capturedAnalysts === undefined ? {} : { analysts: capturedAnalysts }),
    ...(makeWorkerAgent === undefined ? {} : { makeWorkerAgent }),
    ...(blobs === undefined ? {} : { blobs }),
    ...(journal === undefined ? {} : { journal }),
    ...(probes === undefined ? {} : { probes }),
    ...(authorizeSpawn === undefined ? {} : { authorizeSpawn }),
    ...(authorizeMessage === undefined ? {} : { authorizeMessage }),
    ...(isDriverProfile === undefined ? {} : { isDriverProfile }),
    ...(brain === undefined ? {} : { brain }),
    ...(driveHarness === undefined ? {} : { driveHarness }),
    ...(resolveDriveHarness === undefined ? {} : { resolveDriveHarness }),
    ...(resolveSupervisorTools === undefined ? {} : { resolveSupervisorTools }),
    ...(onCoordinationEvent === undefined ? {} : { onCoordinationEvent }),
    ...(executeExtraTool === undefined ? {} : { executeExtraTool }),
    ...(stopRule === undefined ? {} : { stopRule }),
    ...(onProgressStop === undefined ? {} : { onProgressStop }),
    ...(finalizer === undefined ? {} : { finalizer }),
    ...(now === undefined ? {} : { now }),
    ...(signal === undefined ? {} : { signal }),
    ...(rootHandle === undefined ? {} : { rootHandle }),
    ...(registry === undefined ? {} : { registry }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(otel === undefined ? {} : { otel }),
  })
}

export function defaultPerWorker(budget: Budget): Budget {
  return {
    maxIterations: Math.max(1, Math.floor(budget.maxIterations / 4)),
    maxTokens: Math.max(1, Math.floor(budget.maxTokens / 4)),
    ...(budget.maxUsd !== undefined ? { maxUsd: budget.maxUsd / 4 } : {}),
  }
}

export function freezeDetached<T>(value: T): T {
  return detachedSnapshot(value, 'supervise')
}

export function freezeDetachedProfile(value: unknown): AgentProfile {
  return freezeDetached(agentProfileSchema.parse(value))
}

export function canonicalSupervisorProfileInput(profile: SupervisorProfile): unknown {
  if (typeof profile !== 'object' || profile === null) return profile
  const { harness, model, systemPrompt, prompt, ...rest } = profile as SupervisorProfile &
    Record<string, unknown>
  const promptSystem = prompt?.systemPrompt
  if (systemPrompt !== undefined && promptSystem !== undefined && systemPrompt !== promptSystem) {
    throw new ValidationError(
      'supervise: profile.prompt.systemPrompt and profile.systemPrompt are both set and differ — ' +
        'they are the same standing instruction, so keep exactly one',
    )
  }
  const canonicalPrompt =
    systemPrompt !== undefined ? { ...prompt, systemPrompt } : (prompt as unknown)
  return {
    ...rest,
    ...(harness === null || harness === undefined ? {} : { harness }),
    ...(model === undefined
      ? {}
      : { model: typeof model === 'string' ? { default: model } : model }),
    ...(canonicalPrompt === undefined ? {} : { prompt: canonicalPrompt }),
  }
}

export function canonicalExecution(
  profile: AgentProfile,
  task: unknown,
  rawExecution: AgentExecutionRef | undefined,
  context: string,
): { readonly identity: NodeExecutionIdentity; readonly ref?: AgentExecutionRef } {
  const execution = rawExecution === undefined ? undefined : freezeDetached(rawExecution)
  if (execution !== undefined) {
    if (typeof execution !== 'object' || execution === null || Array.isArray(execution)) {
      throw new ValidationError(`${context}: execution must be an object`)
    }
    const unknown = Object.keys(execution).filter(
      (key) => key !== 'candidateDigest' && key !== 'correlation',
    )
    if (unknown.length > 0) {
      throw new ValidationError(`${context}: unknown execution fields: ${unknown.join(', ')}`)
    }
  }
  const identity = deriveNodeExecutionIdentity({ profile, execution }, task)
  if (!identity?.profileDigest || !identity.taskDigest) {
    throw new ValidationError(
      `${context}: profile and task must be finite, acyclic canonical JSON for durable identity`,
    )
  }
  const ref: AgentExecutionRef | undefined =
    identity.candidateDigest || identity.correlation
      ? Object.freeze({
          ...(identity.candidateDigest ? { candidateDigest: identity.candidateDigest } : {}),
          ...(identity.correlation ? { correlation: identity.correlation } : {}),
        })
      : undefined
  return { identity, ...(ref ? { ref } : {}) }
}

export function rootCoordinationOwner(identity: NodeExecutionIdentity): string {
  return canonicalCandidateDigest({ kind: 'supervisor-root', identity })
}

export function childCoordinationOwner(
  parentOwnerId: string,
  identity: NodeExecutionIdentity,
  context: WorkerSpawnContext,
  depth: number,
): string {
  return canonicalCandidateDigest({
    kind: 'supervisor-child',
    parentOwnerId,
    identity,
    assignment: {
      id: context.assignmentId,
      label: context.label,
      key: context.key ?? null,
      depth,
    },
  })
}

export function supervisionRunNamespace(runDir: string | undefined, runId: string): string {
  return canonicalCandidateDigest(
    runDir === undefined
      ? { kind: 'supervise-ephemeral-run', runId, nonce: randomUUID() }
      : { kind: 'supervise-durable-run', runId, runDir: resolve(runDir) },
  )
}

export function workerAssignmentNamespace(
  runNamespace: string,
  parentOwnerId: string,
  assignmentId: string,
): string {
  return canonicalCandidateDigest({
    kind: 'supervise-worker-assignment',
    runNamespace,
    parentOwnerId,
    assignmentId,
  })
}

export function coordinationEventId(
  context: SupervisorNodeContext,
  event: CoordinationEvent,
): Sha256Digest {
  const durableEvent =
    event.type === 'settled' && event.worker.resumed === true
      ? (() => {
          const { resumed: _resumed, ...worker } = event.worker
          return { type: 'settled' as const, worker }
        })()
      : event
  return canonicalCandidateDigest({
    kind: 'supervise-coordination-event',
    runNamespace: context.runNamespace,
    ownerId: context.ownerId,
    event: detachedSnapshot(durableEvent, 'supervise coordination event identity'),
  })
}
