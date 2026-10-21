/**
 * Runtime-owned worker seam for a provider's native interactive coding-agent process.
 *
 * This adapter composes the retained-interactive lifecycle. It does not create a second stream,
 * replay buffer, session id, or cancellation protocol. The provider owns process state; Scope owns
 * the supervised worker, journal, budget, and local control inbox.
 */

import { randomUUID } from 'node:crypto'
import {
  type AgentInteractiveSessionRef,
  type AgentProfile,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentProvider,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { MakeWorkerAgent, WorkerSpawnContext } from '../../mcp/tools/coordination-contracts'
import type { RetainedInteractiveAdmission } from '../retained-run-types'
import { executableAgentProfileSnapshot } from './executable-spec'
import {
  type InteractiveAdmissionWriter,
  interactiveAdmissionSeamKey,
} from './interactive-admission'
import { interactiveExecutor } from './interactive-executor'
import { detachedSnapshot } from './snapshot'
import type { Agent, AgentSpec, Executor, ExecutorContext, Runtime } from './types'

/** Environment fields supplied to every interactive worker after Runtime adds the exact profile. */
export type InteractiveWorkerEnvironment = Omit<
  CreateAgentEnvironmentInput,
  'profile' | 'idempotencyKey' | 'signal'
>

/** Native interactive worker output. Provider usage is intentionally not fabricated. */
export interface InteractiveWorkerResult {
  readonly provider: string
  readonly environmentId: string
  readonly sessionId: string
  readonly executionId: string
  readonly state: 'exited' | 'unknown'
  readonly ref: AgentInteractiveSessionRef
  readonly reason?: string
  readonly exitCode?: number
  readonly exitSignal?: string
}

/** Configuration shared by every worker produced by `workerFromInteractiveProvider`. */
export interface InteractiveWorkerOptions {
  /** Provider create fields. Runtime supplies `profile`, the two idempotency keys, and `signal`. */
  readonly environment?: InteractiveWorkerEnvironment
  /** Stable environment identity override. Defaults to a digest of the exact worker assignment. */
  readonly environmentIdempotencyKey?: (input: InteractiveWorkerKeyInput) => string
  /** Stable interactive-session identity override. Defaults to a digest of assignment and task. */
  readonly interactiveIdempotencyKey?: (input: InteractiveWorkerKeyInput) => string
  /** Provider holder id used only while the worker sends a steer or stop command. */
  readonly holderId?: string | ((input: InteractiveWorkerKeyInput) => string)
  /** Initial prompt override. The exact worker task is the default prompt. */
  readonly initialPrompt?: string | ((task: unknown, input: InteractiveWorkerKeyInput) => string)
  readonly cwd?: string
  readonly cols?: number
  readonly rows?: number
  /** Runtime tag written into tree snapshots. Defaults to the provider name. */
  readonly runtime?: Runtime
  /** Poll delay used while waiting for the provider's native process to exit. */
  readonly pollIntervalMs?: number
  /** Destroy the provider environment after the process is terminal. Defaults to true. */
  readonly destroyEnvironmentOnTeardown?: boolean
}

/** Stable input available to key and holder functions. */
export interface InteractiveWorkerKeyInput {
  readonly provider: string
  readonly profile: AgentProfile
  readonly context?: WorkerSpawnContext
  readonly task?: unknown
  readonly nodeId?: string
}

/**
 * Build a `MakeWorkerAgent` that starts one exact provider-owned native TUI per worker.
 *
 * A Scope supplies the durable admission hook and kernel-minted node attempt. The returned worker
 * exposes `interactiveReady`, so Scope writes the exact provider reference before the worker can be
 * attached by a different process. `attachWorker` then reconnects that same reference through the
 * provider's public `get`/interactive contract.
 */
export function workerFromInteractiveProvider(
  provider: AgentEnvironmentProvider,
  options: InteractiveWorkerOptions = {},
): MakeWorkerAgent {
  if (!provider.name.trim())
    throw new Error('workerFromInteractiveProvider: provider.name required')
  if (!provider.get) {
    throw new Error(
      `workerFromInteractiveProvider(${provider.name}): provider.get is required for reconnect`,
    )
  }
  const capturedEnvironment = options.environment
    ? (structuredClone(options.environment) as InteractiveWorkerEnvironment)
    : undefined
  const unscopedNamespace = randomUUID()
  let unscopedOrdinal = 0
  const runtime = options.runtime ?? (provider.name as Runtime)

  return (rawProfile, spawnContext) => {
    const profile = executableAgentProfileSnapshot(
      rawProfile,
      `workerFromInteractiveProvider(${provider.name})`,
    )
    const input: InteractiveWorkerKeyInput = {
      provider: provider.name,
      profile,
      ...(spawnContext === undefined ? {} : { context: spawnContext }),
    }
    const assignmentId =
      spawnContext?.assignmentId ?? `unscoped:${unscopedNamespace}:${unscopedOrdinal++}`
    const baseInput = { ...input, nodeId: spawnContext?.parentNodeId }
    const environmentKey = stableKey(
      options.environmentIdempotencyKey?.({ ...baseInput }) ??
        derivedKey('supervised-interactive-environment', {
          provider: provider.name,
          assignmentId,
          parentNodeId: spawnContext?.parentNodeId,
          profile,
        }),
      'environment idempotency key',
    )
    const name = profile.name ?? 'interactive-worker'

    const executorFactory = (
      spec: AgentSpec,
      ctx: ExecutorContext,
    ): Executor<InteractiveWorkerResult> =>
      interactiveExecutor({
        provider,
        profile: spec.profile,
        context: spawnContext,
        environment: capturedEnvironment,
        environmentKey,
        interactiveKey: (task: unknown) =>
          stableKey(
            options.interactiveIdempotencyKey?.({
              ...baseInput,
              task,
            }) ??
              derivedKey('supervised-interactive-session', {
                provider: provider.name,
                assignmentId,
                parentNodeId: spawnContext?.parentNodeId,
                profile: spec.profile,
                task,
              }),
            'interactive idempotency key',
          ),
        holderId: (task: unknown) => {
          const selected =
            typeof options.holderId === 'function'
              ? options.holderId({ ...baseInput, task })
              : options.holderId
          return stableKey(
            selected ??
              `runtime-interactive-worker:${canonicalCandidateDigest({
                provider: provider.name,
                assignmentId,
              })}`,
            'interactive holder id',
          )
        },
        initialPrompt: options.initialPrompt,
        cwd: options.cwd,
        cols: options.cols,
        rows: options.rows,
        runtime,
        pollIntervalMs: options.pollIntervalMs,
        destroyEnvironmentOnTeardown: options.destroyEnvironmentOnTeardown,
        executionAttemptId: ctx.node?.attemptId,
        nodeId: ctx.node?.nodeId,
        admission: admissionWriter(ctx, provider.name, ctx.node?.nodeId),
      })

    const spec: AgentSpec = {
      profile,
      harness: null,
      executorFactory,
      ...(spawnContext?.execution ? { execution: spawnContext.execution } : {}),
    }
    return {
      name,
      act: async () => {
        throw new Error(
          'workerFromInteractiveProvider: interactive workers execute through executorSpec',
        )
      },
      executorSpec: spec,
    } as Agent<unknown, InteractiveWorkerResult> & { executorSpec: AgentSpec }
  }
}

function admissionWriter(
  ctx: ExecutorContext,
  provider: string,
  workerId: string | undefined,
): InteractiveAdmissionWriter {
  const candidate = ctx.seams[interactiveAdmissionSeamKey]
  if (typeof candidate === 'function') {
    return async (admission) => {
      await (candidate as (value: RetainedInteractiveAdmission) => Promise<void>)(admission)
    }
  }
  // In-memory runs still need a real hook because retained-start refuses an omitted hook. The
  // durable Scope path always supplies the Runtime-owned writer above; this fallback is explicit
  // and process-local, never mistaken for restart evidence.
  const records = new Map<string, RetainedInteractiveAdmission>()
  return async (admission) => {
    const prior = records.get(admission.phase)
    if (prior && canonicalCandidateDigest(prior) !== canonicalCandidateDigest(admission)) {
      throw new Error(
        `worker ${workerId ?? '(unscoped)'} provider ${provider} admission changed in memory`,
      )
    }
    records.set(admission.phase, detachedSnapshot(admission, 'interactive admission'))
  }
}

function derivedKey(kind: string, value: unknown): string {
  return `${kind}-${canonicalCandidateDigest(value).slice('sha256:'.length)}`
}

function stableKey(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  const key = value.trim()
  if (key.length > 256) throw new Error(`${label} must not exceed 256 bytes`)
  return key
}
