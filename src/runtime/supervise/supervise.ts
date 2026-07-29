/**
 * `supervise` — the one-call "just invoke the supervisor". Builds + runs a supervisor from its
 * profile with sensible defaults, so the common case is `supervise(profile, task, { backend, budget })`
 * instead of hand-wiring `blobs` / `perWorker` / `journal` / `executors` / `maxDepth`. The raw seams
 * (`supervisorAgent` + `createSupervisor().run`) stay available for power use.
 *
 * `workerFromBackend` derives the worker seam (`makeWorkerAgent`) from a backend config + an optional
 * completion oracle — so "where the workers run" is one data choice, not a hand-rolled factory.
 */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import {
  type AgentProfile,
  type AgentProfileSecurityPolicy,
  agentProfileSchema,
  canonicalCandidateDigest,
  type Sha256Digest,
  validateAgentProfileSecurity,
} from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import {
  assertProfileMaterialization,
  controlProfileMaterialization,
  fullProfileMaterialization,
  type ProfileMaterializationContract,
  profileMaterializationAxes,
  promptControlProfileMaterialization,
  promptModelProfileMaterialization,
  worktreeCliProfileMaterialization,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  AuthorizeDownMessage,
  AuthorizedDownMessage,
  CoordinationEvent,
  DownMessageAuthorizationInput,
  MakeWorkerAgent,
  WorkerSpawnContext,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import type { RouterConfig } from '../router-client'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import { assertValidBudget, spendFromUsageEvents } from './budget'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import { DEFAULT_SUCCESSFUL_SHUTDOWN_MS, teardownExecutor } from './deadline'
import { driverChild } from './driver-executor'
import type { BusRecord } from './event-bus'
import type { SupervisorFinalizer } from './finalizer'
import {
  attestRuntimeOwnedScopeOwner,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedScopeOwnerRuntime,
} from './materialization'
import { assertModelAllowed, assertProfileModelsAllowed } from './model-policy'
import { createFileRunContext, createInMemoryRunContext } from './run-context'
import {
  bindReusableExecutorExecutionId,
  captureReusableExecutorConfig,
  createExecutor,
  type ExecutorConfig,
  snapshotExecutorConfig,
} from './runtime'
import {
  deriveNodeExecutionIdentity,
  recordScopeOwnerMaterialization,
  scopeOwnerExecutorNodeContext,
} from './scope'
import { detachedSnapshot } from './snapshot'
import type { StopRule } from './stop-rules'
import { createSupervisor } from './supervisor'
import {
  type DriveHarness,
  type DriveHarnessOwnerContext,
  type ResolveDriveHarness,
  type ResolveSupervisorTools,
  type SupervisorNodeContext,
  type SupervisorProfile,
  supervisorAgent,
} from './supervisor-agent'
import type {
  Agent,
  AgentExecutionRef,
  AgentSpec,
  Budget,
  Executor,
  ExecutorContext,
  NodeExecutionIdentity,
  ResultBlobStore,
  RootHandle,
  SpawnJournal,
  UsageEvent,
} from './types'
import type { WaitProbeRegistry } from './wait'

/** Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the
 *  deliverable check that makes "settled ⟺ delivered" true — the guard against "ran but didn't
 *  deliver"). The ONE place a backend becomes a spawnable worker. */
export function workerFromBackend(
  backend: ExecutorConfig,
  deliverable?: DeliverableSpec<unknown>,
): MakeWorkerAgent {
  const capturedBackend = captureReusableExecutorConfig(backend, 'workerFromBackend')
  const unscopedNamespace = randomUUID()
  let unscopedOrdinal = 0
  return (rawProfile, spawnContext) => {
    const parsed = agentProfileSchema.safeParse(rawProfile)
    if (!parsed.success) {
      throw new ValidationError(`workerFromBackend: invalid AgentProfile: ${parsed.error.message}`)
    }
    const profile = parsed.data
    assertBackendProfileMaterialization(profile, capturedBackend, 'workerFromBackend')
    const name = profile.name ?? 'worker'
    // A Scope assignment is stable across reconstruction. Direct callers that omit that context
    // still get isolation, but only Scope-backed calls claim durable external-session recovery.
    const assignmentId =
      spawnContext?.assignmentId ?? `unscoped:${unscopedNamespace}:${unscopedOrdinal++}`
    const boundBackend = bindReusableExecutorExecutionId(
      capturedBackend,
      externalExecutionId('supervised-worker', { assignmentId }),
    )
    const baseFactory = createExecutor(boundBackend)
    // Carry the configured factory into Scope. It is built only AFTER reservation with the real
    // child signal/context, so a rejected or already-completed keyed spawn creates no executor.
    const executorFactory = (spec: AgentSpec, ctx: ExecutorContext) => {
      const built = baseFactory(spec, ctx)
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

function externalExecutionId(kind: string, identity: unknown): string {
  const digest = canonicalCandidateDigest({ kind, identity })
  return `${kind}-${digest.slice('sha256:'.length)}`
}

function backendProfileMaterialization(backend: ExecutorConfig): ProfileMaterializationContract {
  switch (backend.backend) {
    case 'bridge':
    case 'sandbox':
    case 'provider':
      return fullProfileMaterialization
    case 'cli-worktree':
      return backend.bridge ? fullProfileMaterialization : worktreeCliProfileMaterialization
    case 'router':
    case 'router-tools':
    case 'pi':
      return promptModelProfileMaterialization
    case 'cli':
      return controlProfileMaterialization
  }
}

function assertProfileContract(
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

const coordinationMcpAlias = 'agent-runtime-coordination'
const defaultAllowedMcpHosts: string[] = []
Object.freeze(defaultAllowedMcpHosts)

/** Manager-authored profiles are untrusted until product policy says otherwise. Remote MCP and
 * ambient connection grants therefore fail closed by default, in addition to local MCP and hooks. */
export const DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY: AgentProfileSecurityPolicy = Object.freeze({
  allowLocalMcp: false,
  allowHooks: false,
  allowedMcpHosts: defaultAllowedMcpHosts,
  allowConnections: false,
})

function isExternalSupervisor(profile: AgentProfile): boolean {
  return profile.harness !== undefined && profile.harness !== 'cli-base'
}

function automaticDriverBackendSupported(backend: ExecutorConfig): boolean {
  // The built-in coordination server binds host loopback. A local bridge can reach it; a remote
  // sandbox cannot until the caller supplies an explicit relay/tunnel through `driveHarness`.
  return backend.backend === 'bridge'
}

function backendProfileOverlays(backend: ExecutorConfig | undefined): AgentProfile[] {
  if (!backend) return []
  if (backend.backend === 'bridge' && backend.agentProfile) return [backend.agentProfile]
  if (backend.backend === 'cli-worktree' && backend.bridge?.agentProfile) {
    return [backend.bridge.agentProfile]
  }
  return []
}

/** Run a harness-brained manager through the same executor factory as its children. The manager's
 * full profile is preserved, the live coordination server is added under one reserved alias, and
 * every streamed turn is charged to the manager's scope before it may continue. */
function driveHarnessFromBackend(
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
    if (profile.mcp?.[coordinationMcpAlias] !== undefined) {
      throw new ValidationError(
        `driveHarnessFromBackend: profile MCP alias ${JSON.stringify(coordinationMcpAlias)} is reserved`,
      )
    }
    const effectiveProfile = agentProfileSchema.parse({
      ...profile,
      mcp: {
        ...profile.mcp,
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
      // Construction transfers cleanup ownership immediately. Even a rejected receipt or an
      // unmetered runtime reaches the single bounded teardown path below.
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
          // The endpoint is one attempt's transport binding, not AgentProfile identity. Keep the
          // admitted profile stable and commit the logical coordination capability separately.
          effectiveProfile: profile,
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
          descriptor: {
            ...executionBinding.descriptor,
            coordination: true,
          },
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
        for await (const event of run) {
          if (event.kind === 'iteration') {
            await meterPending()
          } else {
            pendingUsage.push(event)
          }
        }
        await meterPending()
        const artifact = executor.resultArtifact()
        terminalAccountingCaptured = true
        // A stream carries increments, while its terminal artifact says whether either accounting
        // channel was omitted. Preserve unknowns in the shared pool instead of treating them as 0.
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
        const artifact = await run
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
          // The budget pool intentionally throws after durably recording unknown capped usage and
          // closing that capacity. Only replace the original failure if the marker did not land.
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

export interface SuperviseOptions {
  /** The conserved compute pool for the whole run. */
  readonly budget: Budget
  /** Caller-created live handle for observing, steering, or cancelling this root manager. Runtime
   * attaches it before execution and detaches it after the join barrier. */
  readonly rootHandle?: RootHandle<unknown>
  /** Caller-owned cancellation for the complete recursive run. Aborting it cascades through the
   * root scope and every live child, including acquisition and backend execution. */
  readonly signal?: AbortSignal
  /** Trusted candidate and pursuit attribution for the root. The runtime derives profile/task
   * digests itself from the exact detached values it executes. */
  readonly execution?: AgentExecutionRef
  /** WHERE workers run — derives the worker seam. Provide this OR an explicit `makeWorkerAgent`. */
  readonly backend?: ExecutorConfig
  /** The completion oracle for backend-derived workers (settled ⟺ delivered). Strongly recommended:
   *  without it the supervisor trusts a worker's self-report — exactly the "ran but didn't deliver"
   *  failure mode of a static orchestrator. */
  readonly deliverable?: DeliverableSpec<unknown>
  /** Resolve the completion check for one exact authorized backend-derived leaf. The callback runs
   * after spawn authorization and driver classification, receives a detached immutable context,
   * and may return `undefined` to use the run-wide `deliverable`. Driver profiles never call it. */
  readonly resolveDeliverable?: (
    input: DeliverableResolutionInput,
  ) => DeliverableSpec<unknown> | undefined
  /** Override the worker seam directly (tests / advanced) instead of deriving it from `backend`.
   *  This is caller-owned execution: profile security, spawn authorization, and recursive-driver
   *  selection below apply only to the backend-derived worker path. `authorizeMessage` still
   *  governs continuations sent through Runtime's coordination tools. */
  readonly makeWorkerAgent?: MakeWorkerAgent
  /** Run harness-brained supervisors here. Automatic execution supports a local `bridge`; a remote
   *  sandbox requires an explicit `driveHarness` with a reachable coordination relay or tunnel.
   *  Defaults to `backend`; separate it when managers and workers use different services. */
  readonly driverBackend?: ExecutorConfig
  /** Security policy applied to every manager-authored child profile before budget reservation.
   *  The default blocks local and remote MCP, hooks, and connection grants. Pass an explicit
   *  allowlist to grant remote MCP hosts or other author-controlled capabilities. */
  readonly profileSecurity?: AgentProfileSecurityPolicy
  /** Product authority over one complete manager-authored spawn. The callback sees the detached,
   *  immutable profile, task, budget, label, and key together, so approving a profile cannot
   *  authorize a different task. Return the exact allowed profile (which may be narrowed) plus
   *  trusted candidate/pursuit attribution, or throw to refuse the whole spawn before reservation. */
  readonly authorizeSpawn?: (input: {
    readonly profile: AgentProfile
    readonly parent: AgentProfile
    /** Trusted identity of the manager authorizing this exact child. */
    readonly parentIdentity: NodeExecutionIdentity
    /** Concrete manager node; never accepted from model-authored tool arguments. */
    readonly parentNodeId: string
    /** Stable manager-scoped assignment, including deterministic unkeyed siblings. */
    readonly assignmentId: string
    readonly task: unknown
    readonly budget: Budget
    readonly label: string
    readonly key?: string
    readonly depth: number
  }) => AuthorizedSpawn
  /** Product authority over every continuation sent to a live child. When spawn authorization is
   * enabled, omitting this refuses steer/answer instructions instead of silently extending the
   * authorized task. The exact worker identity and detached bytes are recorded before delivery. */
  readonly authorizeMessage?: (
    input: DownMessageAuthorizationInput & {
      readonly parent: AgentProfile
      readonly depth: number
    },
  ) => AuthorizedDownMessage
  /** Decide whether an authorized child becomes another supervisor. By default only
   *  `metadata.role === 'driver'` does. Products receive the same frozen post-authorization
   *  context as `resolveDeliverable`, so trusted execution/assignment authority can override
   *  model-authored metadata without a side channel. */
  readonly isDriverProfile?: (input: AuthorizedSpawnContext) => boolean
  /** The supervisor's router substrate (`profile.harness` omitted or `cli-base`). The profile's
   *  model wins. */
  readonly router?: RouterConfig
  /** Inject the supervisor brain directly (tests / advanced). */
  readonly brain?: ToolLoopChat
  /** Run an external-harness supervisor explicitly. Required for a remote sandbox; optional as a
   *  caller-owned override for a local bridge. */
  readonly driveHarness?: DriveHarness
  /** Resolve one custom external-harness session per trusted manager identity. Use this instead of
   * `driveHarness` when recursive managers must be independently steerable. */
  readonly resolveDriveHarness?: ResolveDriveHarness
  /** Required with a custom `driveHarness` or `resolveDriveHarness`: declares which complete
   * AgentProfile axes that path really applies. Built-in bridge driving supplies its own
   * full-profile contract. */
  readonly driveHarnessMaterialization?: ProfileMaterializationContract
  /** Resolve product-owned tools from the exact trusted manager context. The same descriptors and
   * handlers are bound to router and external-harness managers; resolution happens once per node. */
  readonly resolveSupervisorTools?: ResolveSupervisorTools
  /** Awaited product transaction hook for every coordination record. `eventId` is stable across a
   * lost acknowledgement and durable restart; the record is not pull-visible until this commits. */
  readonly onCoordinationEvent?: (
    context: SupervisorNodeContext,
    eventId: Sha256Digest,
    record: BusRecord<CoordinationEvent>,
  ) => void | Promise<void>
  /** WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
   *  itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
   *  `executeExtraTool`. Router arm only (`profile.harness` omitted or `cli-base`). */
  readonly extraTools?: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly parameters: Record<string, unknown>
  }>
  /** Runs an `extraTools` call; null/undefined falls through to the coordination dispatch. */
  readonly executeExtraTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string | null | undefined>
  /** Per-child budget reserved on each spawn. Defaults to a quarter of the pool's tokens. */
  readonly perWorker?: Budget
  /** Hard cap on simultaneously executing spawned workers across the WHOLE recursive tree. The
   *  root is excluded; nested drivers and leaves share one allocation, so recursion cannot multiply
   *  the cap. Omit/`<= 0` = no cap (the conserved pool stays the only bound). */
  readonly maxLiveWorkers?: number
  /** Analyst lenses available to the driver. Required for `analyzeOnSettle`. Unset → status quo
   *  (the driver receives settled worker outputs, no analyst findings). */
  readonly analysts?: AnalystRegistry
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
   *  the driver pulls (`await_event`) and composes its next steer from. The self-improving UP-leg,
   *  threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
   *  Omit/empty = status quo (no analyst feed). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string>
  /**
   * Watch every worker's LIVE tool trace with the online detector panel and raise a `finding` the
   * moment one loops or error-storms — so the supervisor learns it mid-run (via `await_event`)
   * instead of at settle. Pairs with a steerable worker: the finding is the evidence, `steer_agent`
   * is the correction. Requires a backend whose executor exposes a trace source (the steerable
   * sandbox worker and the pi wrapper do); other runtimes are simply not watched.
   *
   * Omit = off (status quo — no online watching, no extra events).
   */
  readonly watchWorkers?: WorkerWatchOptions
  /** Idle time after which `observe_agent` reports a running worker as `stalled`. A derived read
   *  at observation time — nothing is killed or retried. Omit = the runtime default. */
  readonly stallAfterMs?: number
  /** Worker output store. Defaults to in-memory. */
  readonly blobs?: ResultBlobStore
  /**
   * Make the run DURABLE: journal + result blobs + the coordination side-log are file-backed under
   * this directory (`createFileRunContext`), fsynced per write, and the supervisor reads the prior
   * tree first. Re-running with the same `runDir` AND the same `runId` resumes only when the exact
   * root profile/task identity and declared budget match. The original absolute deadline and prior
   * measured spend are restored before new admission. The built-in driver is resume-aware: children
   * that already settled, including their exact execution identities, are replayed onto
   * `Scope.resume` (and into the driver's settled ledger + its first context), keyed assignments
   * (`spawn_agent`'s `key`) resolve to their committed results instead of re-running, pending
   * waits re-arm on their original deadlines, and the coordination log loads prior questions,
   * findings, and instruction receipts. The router arm receives all three in its resume brief; the
   * external arm seeds prior questions while findings and receipts remain in the durable log.
   * Instruction receipts are evidence and are never delivered automatically to a replacement
   * worker. The final result spans both processes' work. Unset = in-memory, fresh every call.
   *
   * The boundary that remains: work that was IN FLIGHT when the process died is not recovered —
   * the built-in executors cannot re-attach to a dead process's executions. Each such assignment
   * resumes as explicitly lost/in-doubt, its full declared reservation is charged conservatively,
   * and its token/dollar telemetry remains unknown. A retry is admitted only from safely remaining
   * capacity, so restart cannot mint a fresh budget or slide the original absolute deadline.
   *
   * `runId` matters here: it defaults to the constant `'supervise'`, which is fine for a single
   * resumable run per directory but collides across concurrent runs sharing one `runDir`.
   */
  readonly runDir?: string
  /** Override the spawn journal directly (advanced; `runDir` is the ordinary durable path). Pair
   *  with `blobs` — a journal whose result payloads live in a different store cannot replay. */
  readonly journal?: SpawnJournal
  /** Predicate registry for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so the
   *  wait survives a restart; this is what the name resolves against. Unset ⇒ `poll` waits are
   *  refused `unknown-probe` and `timer` waits still work. */
  readonly probes?: WaitProbeRegistry
  /**
   * PROGRESS-derived stop rule (router-brained supervisor). Ends a run that has stopped LEARNING
   * before it exhausts a ceiling — the answer to "a run should end because it is done or stuck,
   * not because it ran out". It composes with the budget guards and can never override one.
   *
   * Build it from `supervise/stop-rules`: `plateau({window, minDelta})`,
   * `noProgressFor({ms, settles})`, `allWorkersStalled({...})`, combined with `anyOf`/`allOf`. The
   * thresholds are policy and stay with you; the enforcement lives in the runtime. Omit = ceilings
   * only (unchanged behavior).
   */
  readonly stopRule?: StopRule
  /** One-shot notification of WHY a `stopRule` ended the run — so a caller records the reason
   *  instead of inferring an early stop from an unexhausted budget. */
  readonly onProgressStop?: (reason: string) => void
  readonly maxDepth?: number
  readonly maxTurns?: number
  /** Give the supervisor brain a chapter-lifecycle on its OWN context window (router arm only): once
   *  its coordination transcript exceeds `thresholdTokens` it distills to a compact progress note and
   *  continues, instead of re-billing the whole transcript every turn (the cost that makes the LLM-brain
   *  front door lose to a dumb-Ralph respawn). The live `Scope` roster is the durable state across
   *  chapters. Default off. `distill` defaults to a brain self-summary + the settled-worker roster. */
  readonly compaction?: ToolLoopCompactionOptions
  readonly runId?: string
  readonly now?: () => number
  /** Restrict the run to this subset of models. When set, every configured model — the
   *  supervisor router model, the profile's model, and the backend's model — must be a member,
   *  or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted. */
  readonly allowedModels?: readonly string[]
  /** How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
   *  highest-scoring DELIVERED child (the exact behavior every existing caller had). Alternatives:
   *  `collectDelivered` (every verified distinct output with provenance — a Pareto set / recorded
   *  disagreement) or a custom `SupervisorFinalizer`. Whatever the finalizer, it operates on
   *  structurally DELIVERED outputs only — an undelivered or invalid child stays ineligible. */
  readonly finalizer?: SupervisorFinalizer
}

/** The product-authorized result for one complete spawn request. Attribution is never accepted
 * from the manager itself; it enters only through this trusted callback. */
export interface AuthorizedSpawn {
  readonly profile: AgentProfile
  readonly execution?: AgentExecutionRef
}

/** Exact trusted context after a manager-authored spawn has passed product authorization. */
export interface AuthorizedSpawnContext {
  readonly profile: AgentProfile
  readonly parent: AgentProfile
  readonly parentIdentity: NodeExecutionIdentity
  readonly execution: NodeExecutionIdentity
  readonly parentNodeId: string
  readonly assignmentId: string
  readonly task: unknown
  readonly budget: Budget
  readonly label: string
  readonly key?: string
  readonly depth: number
}

/** Exact trusted context for selecting one backend-derived leaf's completion check. */
export type DeliverableResolutionInput = AuthorizedSpawnContext

function captureDeliverable(
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

/** Capture the public one-call configuration before any asynchronous work starts. Decision data is
 * detached and frozen; executable ports are copied as the exact references selected at intake.
 * Service internals intentionally remain live, while replacing a callback/service on the caller's
 * mutable options object can no longer change an in-flight run. */
function captureSuperviseOptions(opts: SuperviseOptions): SuperviseOptions {
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
    deliverable === undefined ? undefined : captureDeliverable(deliverable, 'supervise deliverable')
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
    analysts === undefined
      ? undefined
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
  })
}

/** A quarter of token and optional dollar capacity per worker; nested managers partition again. */
function defaultPerWorker(budget: Budget): Budget {
  return {
    maxIterations: Math.max(1, Math.floor(budget.maxIterations / 4)),
    maxTokens: Math.max(1, Math.floor(budget.maxTokens / 4)),
    ...(budget.maxUsd !== undefined ? { maxUsd: budget.maxUsd / 4 } : {}),
  }
}

function freezeDetached<T>(value: T): T {
  return detachedSnapshot(value, 'supervise')
}

function freezeDetachedProfile(value: unknown): AgentProfile {
  return freezeDetached(agentProfileSchema.parse(value))
}

function canonicalExecution(
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

function rootCoordinationOwner(identity: NodeExecutionIdentity): string {
  return canonicalCandidateDigest({ kind: 'supervisor-root', identity })
}

function childCoordinationOwner(
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

function supervisionRunNamespace(runDir: string | undefined, runId: string): string {
  return canonicalCandidateDigest(
    runDir === undefined
      ? { kind: 'supervise-ephemeral-run', runId, nonce: randomUUID() }
      : { kind: 'supervise-durable-run', runId, runDir: resolve(runDir) },
  )
}

function workerAssignmentNamespace(
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

/** Hash only durable coordination meaning. Bus sequence/timestamp are delivery metadata and a
 * resumed projection's marker describes the reader, not the original settlement. */
function coordinationEventId(
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

/** One-call supervisor: build + run a supervisor from its profile with sensible defaults; the raw `supervisorAgent` + `createSupervisor().run` seams stay available for power use. */
export function supervise(profile: SupervisorProfile, task: unknown, opts: SuperviseOptions) {
  const options = captureSuperviseOptions(opts)
  assertValidBudget(options.budget, 'supervise budget')
  // Fail loud before any compute: every configured model must be in the allowed subset (no-op
  // when allowedModels is unset). The backend seam carries its own model on most backends.
  const parsedProfile = agentProfileSchema.safeParse(profile)
  if (!parsedProfile.success) {
    throw new ValidationError(`supervise: invalid AgentProfile: ${parsedProfile.error.message}`)
  }
  const canonicalProfile = freezeDetachedProfile(parsedProfile.data)
  const canonicalTask = freezeDetached(task)
  if (options.makeWorkerAgent && options.authorizeSpawn) {
    throw new ValidationError(
      'supervise: authorizeSpawn cannot be combined with caller-owned makeWorkerAgent; wrap and authorize the custom factory explicitly or use backend-derived workers',
    )
  }
  if (options.makeWorkerAgent && options.resolveDeliverable) {
    throw new ValidationError(
      'supervise: resolveDeliverable applies only to backend-derived workers; wrap a caller-owned makeWorkerAgent with its completion checks explicitly',
    )
  }
  const authorizeDownFor = (
    parent: AgentProfile,
    depth: number,
  ): AuthorizeDownMessage | undefined => {
    if (!options.authorizeSpawn && !options.authorizeMessage) return undefined
    return (input) => {
      if (!options.authorizeMessage) {
        throw new ValidationError(
          'supervise: authorizeMessage is required before steer_agent or answer_question when authorizeSpawn is enabled',
        )
      }
      return freezeDetached(
        options.authorizeMessage(
          freezeDetached({
            ...input,
            parent,
            depth,
          }),
        ),
      )
    }
  }
  const rootExecution = canonicalExecution(
    canonicalProfile,
    canonicalTask,
    options.execution,
    'supervise root',
  )
  const backendModel = (options.backend as { model?: unknown } | undefined)?.model
  const driverBackendModel = (options.driverBackend as { model?: unknown } | undefined)?.model
  const overlays = [
    ...backendProfileOverlays(options.backend),
    ...backendProfileOverlays(options.driverBackend),
  ]
  if (overlays.length > 0) {
    throw new ValidationError(
      'supervise: backend agentProfile overlays are not allowed because they run after spawn authorization; merge the overlay into the exact profile before calling supervise',
    )
  }
  assertModelAllowed(options.router?.model, options.allowedModels)
  assertProfileModelsAllowed(canonicalProfile, options.allowedModels)
  assertModelAllowed(
    typeof backendModel === 'string' ? backendModel : undefined,
    options.allowedModels,
  )
  assertModelAllowed(
    typeof driverBackendModel === 'string' ? driverBackendModel : undefined,
    options.allowedModels,
  )

  // `withDriver: true` is the wiring invariant either way (a `role: 'driver'` child must resolve
  // to the nested-scope executor); `runDir` only changes WHERE the journal and blobs live.
  const ctx =
    options.runDir !== undefined
      ? createFileRunContext(options.runDir, { withDriver: true })
      : createInMemoryRunContext({ withDriver: true })
  const blobs = options.blobs ?? ctx.blobs
  const perWorker = options.perWorker ?? defaultPerWorker(options.budget)
  assertValidBudget(perWorker, 'supervise perWorker')
  const journal = options.journal ?? ctx.journal
  const runId = options.runId ?? 'supervise'
  const runNamespace = supervisionRunNamespace(options.runDir, runId)
  const log = ctx.coordinationLog
  const rootOwnerId = rootCoordinationOwner(rootExecution.identity)
  const observeNodeEvent = options.onCoordinationEvent
    ? async (
        context: SupervisorNodeContext,
        event: CoordinationEvent,
        record: BusRecord<CoordinationEvent>,
      ) => {
        await options.onCoordinationEvent?.(context, coordinationEventId(context, event), record)
      }
    : undefined
  const managerBackend = options.driverBackend ?? options.backend
  if (options.driveHarness && options.resolveDriveHarness) {
    throw new ValidationError('supervise: provide driveHarness or resolveDriveHarness, not both')
  }
  const hasCustomDriveHarness = Boolean(options.driveHarness || options.resolveDriveHarness)
  if (hasCustomDriveHarness && !options.driveHarnessMaterialization) {
    throw new ValidationError(
      'supervise: custom driveHarness or resolveDriveHarness requires driveHarnessMaterialization so profile fields cannot be silently dropped',
    )
  }
  const driverMaterialization = hasCustomDriveHarness
    ? options.driveHarnessMaterialization
    : managerBackend && automaticDriverBackendSupported(managerBackend)
      ? backendProfileMaterialization(managerBackend)
      : undefined
  if (
    isExternalSupervisor(canonicalProfile) &&
    !options.driveHarness &&
    !options.resolveDriveHarness &&
    (!managerBackend || !automaticDriverBackendSupported(managerBackend))
  ) {
    throw new ValidationError(
      `supervise: external supervisor profile.harness=${JSON.stringify(canonicalProfile.harness)} requires a local bridge driverBackend, an explicit driveHarness, or resolveDriveHarness with reachable coordination transport`,
    )
  }
  const harnessClaims = new WeakMap<
    DriveHarness,
    { readonly owners: Set<string>; steerable: boolean }
  >()
  const claimDriveHarness = (rawHarness: unknown, ownerId: string): DriveHarness => {
    if (typeof rawHarness !== 'function') {
      throw new ValidationError(
        'supervise: resolveDriveHarness must return a DriveHarness function',
      )
    }
    const harness = rawHarness as DriveHarness
    const deliver: unknown = harness.deliver
    if (deliver !== undefined && typeof deliver !== 'function') {
      throw new ValidationError('supervise: driveHarness.deliver must be a function when provided')
    }
    const claim = harnessClaims.get(harness)
    const conflictingOwner = claim
      ? [...claim.owners].find((claimedOwner) => claimedOwner !== ownerId)
      : undefined
    const steerable = typeof deliver === 'function'
    if (conflictingOwner !== undefined && (steerable || claim?.steerable === true)) {
      throw new ValidationError(
        `supervise: steerable driveHarness is already bound to manager owner ${JSON.stringify(conflictingOwner)}; resolveDriveHarness must return a distinct steerable instance for owner ${JSON.stringify(ownerId)}`,
      )
    }
    if (claim) {
      claim.owners.add(ownerId)
      claim.steerable ||= steerable
    } else {
      harnessClaims.set(harness, { owners: new Set([ownerId]), steerable })
    }
    return harness
  }
  const driveHarnessForOwner = (context: DriveHarnessOwnerContext): DriveHarness | undefined => {
    if (options.resolveDriveHarness) {
      return claimDriveHarness(options.resolveDriveHarness(context), context.ownerId)
    }
    if (options.driveHarness) {
      return claimDriveHarness(options.driveHarness, context.ownerId)
    }
    return managerBackend && automaticDriverBackendSupported(managerBackend)
      ? driveHarnessFromBackend(
          managerBackend,
          externalExecutionId('supervised-manager', {
            runNamespace,
            ownerId: context.ownerId,
          }),
          options.now ?? Date.now,
        )
      : undefined
  }
  const rootDriveHarness = isExternalSupervisor(canonicalProfile)
    ? driveHarnessForOwner(
        freezeDetached({
          runId,
          runNamespace,
          ownerId: rootOwnerId,
          depth: 0,
          identity: rootExecution.identity,
          profile: canonicalProfile,
          task: canonicalTask,
        }),
      )
    : undefined
  const rootOwnerRuntime =
    !isExternalSupervisor(canonicalProfile) || rootDriveHarness === undefined
      ? undefined
      : runtimeOwnedScopeOwnerRuntime(rootDriveHarness)
  assertProfileContract(
    canonicalProfile,
    isExternalSupervisor(canonicalProfile)
      ? (driverMaterialization as ProfileMaterializationContract)
      : options.brain
        ? promptControlProfileMaterialization
        : promptModelProfileMaterialization,
    'supervise root',
  )

  let makeWorkerAgent = options.makeWorkerAgent
  if (!makeWorkerAgent) {
    if (!options.backend) {
      throw new ValidationError(
        'supervise: provide opts.backend (where workers run) or opts.makeWorkerAgent',
      )
    }
    const makeLeaf = workerFromBackend(options.backend, options.deliverable)
    const securityPolicy = options.profileSecurity ?? DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY

    const makeRecursiveWorkerFor = (
      parent: AgentProfile,
      parentIdentity: NodeExecutionIdentity,
      depth: number,
      parentOwnerId: string,
    ): MakeWorkerAgent => {
      const makeRecursiveWorker: MakeWorkerAgent = (authoredProfile, spawnContext) => {
        if (!spawnContext) {
          throw new ValidationError('supervise: backend-derived workers require spawn context')
        }
        const input = freezeDetachedProfile(authoredProfile)
        const authorizationInput = Object.freeze({
          profile: input,
          parent,
          parentIdentity,
          parentNodeId: spawnContext.parentNodeId,
          assignmentId: spawnContext.assignmentId,
          task: spawnContext.task,
          budget: spawnContext.budget,
          label: spawnContext.label,
          ...(spawnContext.key !== undefined ? { key: spawnContext.key } : {}),
          depth,
        })
        const decision = options.authorizeSpawn
          ? freezeDetached(options.authorizeSpawn(authorizationInput))
          : Object.freeze({
              profile: input,
              ...(spawnContext.execution ? { execution: spawnContext.execution } : {}),
            })
        if (typeof decision !== 'object' || decision === null || Array.isArray(decision)) {
          throw new ValidationError('supervise: authorizeSpawn must return an AuthorizedSpawn')
        }
        const authorized = freezeDetachedProfile(decision.profile)
        const childExecution = canonicalExecution(
          authorized,
          spawnContext.task,
          decision.execution,
          `supervise spawn ${JSON.stringify(spawnContext.label)}`,
        )
        const authorizedContext = Object.freeze({
          ...spawnContext,
          ...(childExecution.ref ? { execution: childExecution.ref } : {}),
        })
        const postAuthorizationContext: AuthorizedSpawnContext = freezeDetached({
          profile: authorized,
          parent,
          parentIdentity,
          execution: childExecution.identity,
          parentNodeId: spawnContext.parentNodeId,
          assignmentId: spawnContext.assignmentId,
          task: spawnContext.task,
          budget: spawnContext.budget,
          label: spawnContext.label,
          ...(spawnContext.key !== undefined ? { key: spawnContext.key } : {}),
          depth,
        })
        const security = validateAgentProfileSecurity(authorized, securityPolicy)
        if (!security.ok) {
          const details = security.issues
            .filter((issue) => issue.level === 'error')
            .map((issue) => `${issue.code}${issue.path ? ` at ${issue.path}` : ''}`)
            .join(', ')
          throw new ValidationError(`supervise: spawned AgentProfile refused: ${details}`)
        }
        assertProfileModelsAllowed(authorized, options.allowedModels)
        let isDriver: boolean
        if (options.isDriverProfile) {
          const driverDecision: unknown = options.isDriverProfile(postAuthorizationContext)
          if (typeof driverDecision !== 'boolean') {
            throw new ValidationError('supervise: isDriverProfile must return a boolean')
          }
          isDriver = driverDecision
        } else {
          isDriver = authorized.metadata?.role === 'driver'
        }
        if (!isDriver) {
          const selectedDeliverable = options.resolveDeliverable?.(postAuthorizationContext)
          const leafDeliverable =
            selectedDeliverable === undefined
              ? options.deliverable
              : captureDeliverable(
                  selectedDeliverable,
                  `supervise deliverable for ${JSON.stringify(spawnContext.label)}`,
                )
          const makeSelectedLeaf =
            leafDeliverable === options.deliverable
              ? makeLeaf
              : workerFromBackend(options.backend as ExecutorConfig, leafDeliverable)
          return makeSelectedLeaf(
            authorized,
            Object.freeze({
              ...authorizedContext,
              assignmentId: workerAssignmentNamespace(
                runNamespace,
                parentOwnerId,
                spawnContext.assignmentId,
              ),
            }),
          )
        }
        const ownerId = childCoordinationOwner(
          parentOwnerId,
          childExecution.identity,
          spawnContext,
          depth,
        )
        const nestedDriveHarness = isExternalSupervisor(authorized)
          ? driveHarnessForOwner(
              freezeDetached({
                runId,
                runNamespace,
                ownerId,
                depth,
                identity: childExecution.identity,
                assignmentId: spawnContext.assignmentId,
                profile: authorized,
                task: spawnContext.task,
              }),
            )
          : undefined
        if (isExternalSupervisor(authorized) && !nestedDriveHarness) {
          throw new ValidationError(
            `supervise: authored external supervisor profile.harness=${JSON.stringify(authorized.harness)} requires a local bridge driverBackend, an explicit driveHarness, or resolveDriveHarness with reachable coordination transport`,
          )
        }
        assertProfileContract(
          authorized,
          isExternalSupervisor(authorized)
            ? (driverMaterialization as ProfileMaterializationContract)
            : promptModelProfileMaterialization,
          `supervise driver ${JSON.stringify(spawnContext.label)}`,
        )

        const childFactory = makeRecursiveWorkerFor(
          authorized,
          childExecution.identity,
          depth + 1,
          ownerId,
        )
        const nestedPerWorker = defaultPerWorker(spawnContext.budget)
        const authorizeNestedMessage = authorizeDownFor(authorized, depth + 1)
        const nested = supervisorAgent(authorized, {
          blobs,
          makeWorkerAgent: childFactory,
          ...(authorizeNestedMessage ? { authorizeDownMessage: authorizeNestedMessage } : {}),
          perWorker: nestedPerWorker,
          ...(options.router ? { router: options.router } : {}),
          ...(nestedDriveHarness ? { driveHarness: nestedDriveHarness } : {}),
          nodeContext: {
            runId,
            runNamespace,
            ownerId,
            depth,
            identity: childExecution.identity,
            assignmentId: spawnContext.assignmentId,
          },
          ...(options.resolveSupervisorTools
            ? { resolveSupervisorTools: options.resolveSupervisorTools }
            : {}),
          ...(observeNodeEvent ? { observeNodeEvent, replaySettlements: true } : {}),
          ...(options.analysts ? { analysts: options.analysts } : {}),
          ...(options.analyzeOnSettle ? { analyzeOnSettle: options.analyzeOnSettle } : {}),
          ...(options.watchWorkers ? { watchWorkers: options.watchWorkers } : {}),
          ...(options.stallAfterMs !== undefined ? { stallAfterMs: options.stallAfterMs } : {}),
          ...(options.stopRule ? { stopRule: options.stopRule } : {}),
          ...(options.onProgressStop ? { onProgressStop: options.onProgressStop } : {}),
          ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
          ...(options.compaction ? { compaction: options.compaction } : {}),
          ...(log
            ? {
                onEvent: (_event, record) => log.append(runId, record, ownerId),
                loadPriorCoordination: () => log.load(runId, ownerId),
              }
            : {}),
          ...(options.finalizer ? { finalizer: options.finalizer } : {}),
        })
        return driverChild(authorized, nested, journal, childExecution.ref)
      }
      return makeRecursiveWorker
    }

    makeWorkerAgent = makeRecursiveWorkerFor(
      canonicalProfile,
      rootExecution.identity,
      1,
      rootOwnerId,
    )
  }
  const workerFactory = makeWorkerAgent

  // Every configuration fault above throws SYNCHRONOUSLY — a caller that guards with
  // `expect(() => supervise(...)).toThrow` still sees the throw, and no compute starts. Only the
  // durable coordination replay needs to await, so the run begins inside this closure.
  const start = async () => {
    // The durable coordination side-log (file contexts only) loads prior questions, findings, and
    // authorized instruction receipts, then appends this process's evidence as it publishes. The
    // router arm receives all three in its resume brief; the external arm seeds prior questions and
    // leaves the other evidence in the log. No prior instruction is auto-delivered.
    const priorCoordination = log ? await log.load(runId, rootOwnerId) : undefined

    const authorizeRootMessage = authorizeDownFor(canonicalProfile, 1)
    const agent = supervisorAgent(canonicalProfile, {
      blobs,
      makeWorkerAgent: workerFactory,
      ...(authorizeRootMessage ? { authorizeDownMessage: authorizeRootMessage } : {}),
      perWorker,
      ...(log
        ? {
            onEvent: (_event, record) => log.append(runId, record, rootOwnerId),
          }
        : {}),
      ...(priorCoordination &&
      (priorCoordination.questions.length > 0 ||
        priorCoordination.findings.length > 0 ||
        priorCoordination.continuations.length > 0 ||
        priorCoordination.deliveryEvidence.length > 0)
        ? { priorCoordination }
        : {}),
      ...(options.finalizer ? { finalizer: options.finalizer } : {}),
      ...(options.router ? { router: options.router } : {}),
      ...(options.brain ? { brain: options.brain } : {}),
      ...(rootDriveHarness ? { driveHarness: rootDriveHarness } : {}),
      nodeContext: {
        runId,
        runNamespace,
        ownerId: rootOwnerId,
        depth: 0,
        identity: rootExecution.identity,
      },
      ...(options.resolveSupervisorTools
        ? { resolveSupervisorTools: options.resolveSupervisorTools }
        : {}),
      ...(observeNodeEvent ? { observeNodeEvent, replaySettlements: true } : {}),
      ...(options.extraTools ? { extraTools: options.extraTools } : {}),
      ...(options.executeExtraTool ? { executeExtraTool: options.executeExtraTool } : {}),
      ...(options.analysts ? { analysts: options.analysts } : {}),
      ...(options.analyzeOnSettle ? { analyzeOnSettle: options.analyzeOnSettle } : {}),
      ...(options.watchWorkers ? { watchWorkers: options.watchWorkers } : {}),
      ...(options.stallAfterMs !== undefined ? { stallAfterMs: options.stallAfterMs } : {}),
      ...(options.stopRule ? { stopRule: options.stopRule } : {}),
      ...(options.onProgressStop ? { onProgressStop: options.onProgressStop } : {}),
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(options.compaction ? { compaction: options.compaction } : {}),
    })

    const supervisor = createSupervisor<unknown, unknown>()
    if (options.rootHandle) supervisor.attach(options.rootHandle)
    return supervisor.run(agent, canonicalTask, {
      budget: options.budget,
      runId,
      journal,
      blobs,
      executors: ctx.executors,
      rootIdentity: rootExecution.identity,
      ...(rootOwnerRuntime === undefined
        ? {}
        : {
            rootMaterialization: {
              runtime: rootOwnerRuntime,
              declaration: 'deferred' as const,
              authoredProfile: canonicalProfile,
            },
          }),
      maxDepth: options.maxDepth ?? 8,
      ...(options.maxLiveWorkers !== undefined ? { maxLiveWorkers: options.maxLiveWorkers } : {}),
      ...(options.probes ? { probes: options.probes } : {}),
      ...(ctx.resume === true ? { resume: true } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  }

  return start()
}
