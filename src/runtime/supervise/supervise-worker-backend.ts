import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { agentProfileSchema } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { MakeWorkerAgent, WorkerSpawnContext } from '../../mcp/tools/coordination-contracts'
import { recordValue } from '../../record-value'
import { agentHarness } from '../harness-role'
import { type DeliverableSpec, gateFactoryOnDeliverable } from './completion-gate'
import { profileBridgeWireModel, profileProviderModel } from './model-policy'
import { retainedExecutorContext, retainedExecutorSeamKey } from './retained-executor'
import {
  bindReusableExecutorExecutionId,
  bridgeRuntimeAttachmentsKey,
  captureReusableExecutorConfig,
  createExecutor,
  type ExecutorConfig,
} from './runtime'
import { externalExecutionId } from './supervise-identity'
import {
  assertBackendProfileMaterialization,
  assertBridgeProfileMaterializes,
} from './supervise-profile-admission'
import { peerMailMcpAlias, peerMailRuntimeAttachment } from './supervise-runtime-attachments'
import type { Agent, AgentSpec, ExecutorContext, SpawnModelSubstitution } from './types'
import { WORKER_TRACE_PROPAGATION } from './worker-trace'

/**
 * Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the
 * deliverable check that makes "settled ⟺ delivered" true — the guard against "ran but didn't
 * deliver"). The ONE place a backend becomes a spawnable worker.
 *
 * `seams` exists because this path builds the leaf executor EAGERLY and hands it back as a BYO
 * `executorSpec.executor`. The registry resolves a BYO executor without ever consulting the
 * per-child `ExecutorContext` the `Scope` seeds, so anything the scope would have supplied is
 * invisible here and has to be passed in. It is a FUNCTION because it is resolved once per worker
 * construction, so a caller may hand back something the run only learns later — which is exactly how
 * `supervise()` gives a traced run's workers their trace context without ordering the span recorder
 * ahead of the worker seam.
 *
 * Continuity: the `bridge` and `provider` backends honor `continuity: 'resume'` by session
 * re-attachment. A bridge session id IS the harness conversation key (cli-bridge maps it to the
 * CLI's own resume — opencode `-s <id>`, claude `--resume`, codex `exec resume`), and a retained
 * provider session is that same key one layer up, so this seam records the session each supervised
 * spawn was bound to, keyed by the worker id the Scope assigned, and a resume spawn binds the prior
 * worker's recorded session instead of deriving a fresh one. A provider worker's session is the
 * one its retained environment admission names; the resumed worker gets a new environment, since
 * the earlier one is torn down when its node settles, and dispatches its first turn into that
 * session. The record is process-local by construction, which matches the kernel's resume boundary
 * (a prior process's workers are not resume targets). Every other backend keeps failing loud: their
 * executors have no re-attachable session, and accepting the spawn would ledger
 * `continuity: 'resume'` over a brand-new session — a stamp asserting something that never
 * happened.
 */
export function workerFromBackend(
  backend: ExecutorConfig,
  deliverable?: DeliverableSpec<unknown>,
  seams?: () => Readonly<Record<string, unknown>>,
): MakeWorkerAgent {
  const capturedBackend = captureReusableExecutorConfig(backend, 'workerFromBackend')
  const unscopedNamespace = randomUUID()
  let unscopedOrdinal = 0
  const sessionByWorker = new Map<string, string>()
  return (rawProfile, spawnContext) => {
    const parsed = agentProfileSchema.safeParse(rawProfile)
    if (!parsed.success) {
      throw new ValidationError(`workerFromBackend: invalid AgentProfile: ${parsed.error.message}`)
    }
    const profile = parsed.data
    assertBackendProfileMaterialization(profile, capturedBackend, 'workerFromBackend')
    assertBridgeProfileMaterializes(profile, capturedBackend, 'workerFromBackend')
    // Resolved BEFORE any worker exists, so a resume this seam cannot honor fails the spawn
    // itself and the kernel never ledgers a `continuity: 'resume'` stamp for it.
    const resumeSessionId = resumeSessionIdFor(capturedBackend, spawnContext, sessionByWorker)
    const name = profile.name ?? 'worker'
    // A Scope assignment is stable across reconstruction. Direct callers that omit that context
    // still get isolation, but only Scope-backed calls claim durable external-session recovery.
    const assignmentId =
      spawnContext?.assignmentId ?? `unscoped:${unscopedNamespace}:${unscopedOrdinal++}`
    // Scoped by the spawning manager: ordinals restart under every manager, so an unscoped id would
    // map worker 1 of every run to one bridge session. A replay re-derives the same ids.
    const executionScope = spawnContext?.parentNodeId
    const boundBackend = bindReusableExecutorExecutionId(
      capturedBackend,
      (capturedBackend.backend === 'bridge' ? resumeSessionId : undefined) ??
        externalExecutionId('supervised-worker', {
          assignmentId,
          ...(executionScope === undefined ? {} : { scope: executionScope }),
        }),
    )
    const boundSessionId = boundBackend.backend === 'bridge' ? boundBackend.sessionId : undefined
    // Before the executor exists: peer mail on a backend that cannot deliver it fails the spawn.
    const peerMailAttachment = peerMailRuntimeAttachment(profile, capturedBackend, spawnContext)
    if (
      spawnContext?.peerMailUrl &&
      boundBackend.backend === 'provider' &&
      Object.hasOwn(boundBackend.defaults?.runtimeAttachments?.mcp ?? {}, peerMailMcpAlias)
    ) {
      throw new ValidationError(
        'workerFromBackend: provider defaults contain the reserved peer-mail attachment alias',
      )
    }
    const sizedBackend =
      spawnContext?.resources !== undefined && boundBackend.backend === 'provider'
        ? {
            ...boundBackend,
            defaults: {
              ...boundBackend.defaults,
              resources: { ...boundBackend.defaults?.resources, ...spawnContext.resources },
            },
          }
        : boundBackend
    const leafBackend =
      spawnContext?.peerMailUrl && sizedBackend.backend === 'provider'
        ? {
            ...sizedBackend,
            steering: sizedBackend.steering ?? {},
            defaults: {
              ...(sizedBackend.defaults ?? {}),
              runtimeAttachments: {
                ...(sizedBackend.defaults?.runtimeAttachments ?? {}),
                mcp: {
                  ...(sizedBackend.defaults?.runtimeAttachments?.mcp ?? {}),
                  [peerMailMcpAlias]: { transport: 'http' as const, url: spawnContext.peerMailUrl },
                },
              },
            },
          }
        : sizedBackend
    // An analyst run grades a worker: the worker's validator and deliverable never grade it (#1775).
    const analyst = spawnContext?.analyst !== undefined
    const rawFactory = createExecutor(
      analyst && 'validator' in leafBackend
        ? { ...leafBackend, validator: undefined }
        : leafBackend,
    )
    const baseFactory =
      deliverable && !analyst ? gateFactoryOnDeliverable(rawFactory, deliverable) : rawFactory
    // Carry the configured factory into Scope. It is built only AFTER reservation with the real
    // child signal/context, so a rejected or already-completed keyed spawn creates no executor.
    const executorFactory = (spec: AgentSpec, ctx: ExecutorContext) => {
      // Record the bridge session this worker is bound to under its Scope-assigned worker id,
      // so a later resume of the node can re-attach it. A resumed worker records the SAME
      // session under its own id, which is what keeps a fresh → resume → resume chain on one
      // harness conversation.
      if (boundSessionId !== undefined && ctx.node?.nodeId !== undefined) {
        sessionByWorker.set(ctx.node.nodeId, boundSessionId)
      }
      // Caller-supplied seams sit UNDER the per-child seams the Scope seeds, so the scope's
      // recursion and trace context always win on a key collision. The peer-mail attachment sits
      // ABOVE both: it is Runtime-owned, minted by the coordination layer for this exact spawn,
      // and nothing a caller passes may replace the endpoint a sibling's identity is bound to.
      const extraSeams = seams?.()
      const seamsForChild =
        extraSeams === undefined &&
        (peerMailAttachment === undefined || boundBackend.backend === 'provider')
          ? ctx.seams
          : {
              ...extraSeams,
              ...ctx.seams,
              ...(peerMailAttachment === undefined || boundBackend.backend === 'provider'
                ? {}
                : {
                    [bridgeRuntimeAttachmentsKey]: {
                      ...recordValue(ctx.seams[bridgeRuntimeAttachmentsKey]),
                      ...peerMailAttachment,
                    },
                  }),
            }
      const built = baseFactory(
        spec,
        providerResumeContext(
          seamsForChild === ctx.seams ? ctx : { ...ctx, seams: seamsForChild },
          boundBackend,
          resumeSessionId,
          sessionByWorker,
        ),
      )
      return built
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

/**
 * A provider worker's session is known only once its retained environment is admitted: record it
 * then under the worker's Scope id, and give a resumed worker the session it continues. A worker
 * without a retained context (no journal, or a provider without retained control) records nothing,
 * so a later resume of it is refused before any worker exists.
 */
function providerResumeContext(
  ctx: ExecutorContext,
  backend: ExecutorConfig,
  resumeSessionId: string | undefined,
  sessionByWorker: Map<string, string>,
): ExecutorContext {
  const retention = backend.backend === 'provider' ? retainedExecutorContext(ctx) : undefined
  const workerId = ctx.node?.nodeId
  if (retention === undefined || workerId === undefined) return ctx
  return {
    ...ctx,
    seams: {
      ...ctx.seams,
      [retainedExecutorSeamKey]: {
        ...retention,
        ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
        onAdmission: async (admission: Parameters<typeof retention.onAdmission>[0]) => {
          await retention.onAdmission(admission)
          if (admission.phase === 'environment') sessionByWorker.set(workerId, admission.sessionId)
        },
      },
    },
  }
}

/**
 * The session id a `'resume'` spawn re-attaches, or `undefined` for a fresh spawn: the bridge
 * session the prior worker was bound to, or the retained provider session its environment
 * admission named. Every refusal throws BEFORE a worker exists, which is what keeps the kernel's
 * continuity ledger true: a `'resume'` stamp can only appear over a session that was re-attached.
 */
function resumeSessionIdFor(
  backend: ExecutorConfig,
  spawnContext: WorkerSpawnContext | undefined,
  sessions: ReadonlyMap<string, string>,
): string | undefined {
  if (spawnContext?.continuity !== 'resume') return undefined
  if (backend.backend !== 'bridge' && backend.backend !== 'provider') {
    throw new ValidationError(
      `workerFromBackend: the '${backend.backend}' backend seam does not re-attach sessions and ` +
        "cannot honor continuity: 'resume' — only the 'bridge' and 'provider' backends resume " +
        'here (cli-bridge keys the harness conversation by session id). Provide a ' +
        "makeWorkerAgent that resumes (it receives spawnContext.resume.ofWorker), or use continuity: 'fresh'",
    )
  }
  const ofWorker = spawnContext.resume?.ofWorker
  if (ofWorker === undefined) {
    throw new ValidationError(
      "workerFromBackend: a 'resume' spawn carries no resume lineage — the kernel stamps " +
        'spawnContext.resume for ledgered spawns; a direct caller must pass { ofWorker, sequence }',
    )
  }
  const prior = sessions.get(ofWorker)
  if (prior === undefined) {
    throw new ValidationError(
      `workerFromBackend: no recorded ${backend.backend} session for worker '${ofWorker}' — this ` +
        'seam re-attaches only sessions it bound in this process (the kernel resume boundary), ' +
        'and a provider worker records one only once its retained environment is admitted. ' +
        "Spawn the node fresh first, or use continuity: 'fresh'",
    )
  }
  return prior
}

/**
 * The `trace-unpropagated` declaration for a worker backend, or `undefined` when the backend HAS a
 * propagation channel. The census (`WORKER_TRACE_PROPAGATION`) says WHETHER a backend propagates;
 * this maps the non-propagating arms to WHY: `router`/`router-tools`/`provider` have no worker
 * process to inherit an environment, `cli-worktree` has a worker but no environment channel
 * through its transport.
 */
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

/**
 * The route a spawn authorization replaced, when the parent authored part of it. Only a part the
 * parent named counts: authorization filling an omitted harness or provider is not a substitution.
 */
export function spawnModelSubstitution(
  authored: AgentProfile,
  authorized: AgentProfile,
): SpawnModelSubstitution | undefined {
  const harness = agentHarness(authored.harness)
  const provider = authored.model?.provider?.trim() || undefined
  const model = profileProviderModel(authored)
  if (model === undefined) return undefined
  const changed =
    (harness !== undefined && harness !== agentHarness(authorized.harness)) ||
    (provider !== undefined && provider !== authorized.model?.provider?.trim()) ||
    model !== profileProviderModel(authorized)
  if (!changed) return undefined
  return Object.freeze({
    requested: profileBridgeWireModel(authored) ?? model,
    ran: profileBridgeWireModel(authorized) ?? 'unspecified',
  })
}

/** The worker agent with the substitution on its spec, which Scope journals on `spawned`. */
export function withModelSubstitution<A>(
  agent: A,
  substitution: SpawnModelSubstitution | undefined,
): A {
  if (substitution === undefined) return agent
  const spec = (agent as { executorSpec?: AgentSpec }).executorSpec
  if (spec === undefined) return agent
  return { ...agent, executorSpec: { ...spec, modelSubstitution: substitution } }
}
