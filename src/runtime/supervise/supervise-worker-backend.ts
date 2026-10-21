import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { agentProfileSchema } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { MakeWorkerAgent, WorkerSpawnContext } from '../../mcp/tools/coordination-contracts'
import { agentHarness } from '../harness-role'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import { profileBridgeWireModel, profileProviderModel } from './model-policy'
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
import {
  peerMailMcpAlias,
  peerMailRuntimeAttachment,
  readCallerRuntimeAttachments,
} from './supervise-runtime-attachments'
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
 * Continuity: the `bridge` backend honors `continuity: 'resume'` by session re-attachment. A
 * bridge session id IS the harness conversation key (cli-bridge maps it to the CLI's own resume —
 * opencode `-s <id>`, claude `--resume`), so this seam records the session id each supervised
 * spawn was bound to, keyed by the worker id the Scope assigned, and a resume spawn binds the
 * prior worker's recorded session id instead of deriving a fresh one. The record is process-local
 * by construction, which matches the kernel's resume boundary (a prior process's workers are not
 * resume targets). Every other backend keeps failing loud: their executors have no re-attachable
 * session, and accepting the spawn would ledger `continuity: 'resume'` over a brand-new session —
 * a stamp asserting something that never happened.
 */
export function workerFromBackend(
  backend: ExecutorConfig,
  deliverable?: DeliverableSpec<unknown>,
  seams?: () => Readonly<Record<string, unknown>>,
): MakeWorkerAgent {
  const capturedBackend = captureReusableExecutorConfig(backend, 'workerFromBackend')
  const unscopedNamespace = randomUUID()
  let unscopedOrdinal = 0
  const bridgeSessionByWorker = new Map<string, string>()
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
    const resumeSessionId = bridgeResumeSessionId(
      capturedBackend,
      spawnContext,
      bridgeSessionByWorker,
    )
    const name = profile.name ?? 'worker'
    // A Scope assignment is stable across reconstruction. Direct callers that omit that context
    // still get isolation, but only Scope-backed calls claim durable external-session recovery.
    const assignmentId =
      spawnContext?.assignmentId ?? `unscoped:${unscopedNamespace}:${unscopedOrdinal++}`
    // The derived execution id scopes by the spawning manager: assignment ordinals restart at
    // `ordinal:0` under every manager, so an unscoped digest maps worker 1 of EVERY run (and of
    // every sibling manager) to one external session — on a bridge with a persistent session
    // store, a 'fresh' spawn then silently continues a foreign run's harness conversation.
    // Durable recovery is preserved: a replay of the same run re-issues the same manager node id
    // and the same assignments, so it derives the same session ids.
    const executionScope = spawnContext?.parentNodeId
    const boundBackend = bindReusableExecutorExecutionId(
      capturedBackend,
      resumeSessionId ??
        externalExecutionId('supervised-worker', {
          assignmentId,
          ...(executionScope === undefined ? {} : { scope: executionScope }),
        }),
    )
    const boundSessionId = boundBackend.backend === 'bridge' ? boundBackend.sessionId : undefined
    // Resolved BEFORE the executor exists, so a run that asked for peer mail on a backend that
    // cannot deliver it fails the spawn instead of handing the worker a capability nobody serves.
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
    const leafBackend =
      spawnContext?.peerMailUrl && boundBackend.backend === 'provider'
        ? {
            ...boundBackend,
            steering: boundBackend.steering ?? {},
            defaults: {
              ...(boundBackend.defaults ?? {}),
              runtimeAttachments: {
                ...(boundBackend.defaults?.runtimeAttachments ?? {}),
                mcp: {
                  ...(boundBackend.defaults?.runtimeAttachments?.mcp ?? {}),
                  [peerMailMcpAlias]: { transport: 'http' as const, url: spawnContext.peerMailUrl },
                },
              },
            },
          }
        : boundBackend
    const baseFactory = createExecutor(leafBackend)
    // Carry the configured factory into Scope. It is built only AFTER reservation with the real
    // child signal/context, so a rejected or already-completed keyed spawn creates no executor.
    const executorFactory = (spec: AgentSpec, ctx: ExecutorContext) => {
      // Record the bridge session this worker is bound to under its Scope-assigned worker id,
      // so a later resume of the node can re-attach it. A resumed worker records the SAME
      // session under its own id, which is what keeps a fresh → resume → resume chain on one
      // harness conversation.
      if (boundSessionId !== undefined && ctx.node?.nodeId !== undefined) {
        bridgeSessionByWorker.set(ctx.node.nodeId, boundSessionId)
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
                      ...readCallerRuntimeAttachments(ctx.seams),
                      ...peerMailAttachment,
                    },
                  }),
            }
      const built = baseFactory(
        spec,
        seamsForChild === ctx.seams ? ctx : { ...ctx, seams: seamsForChild },
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

/**
 * The bridge session id a `'resume'` spawn re-attaches, or `undefined` for a fresh spawn.
 * Every refusal throws BEFORE a worker exists, which is what keeps the kernel's continuity
 * ledger true: a `'resume'` stamp can only appear over a session that was actually re-attached.
 */
function bridgeResumeSessionId(
  backend: ExecutorConfig,
  spawnContext: WorkerSpawnContext | undefined,
  sessions: ReadonlyMap<string, string>,
): string | undefined {
  if (spawnContext?.continuity !== 'resume') return undefined
  if (backend.backend !== 'bridge') {
    throw new ValidationError(
      `workerFromBackend: the '${backend.backend}' backend seam does not re-attach sessions and ` +
        "cannot honor continuity: 'resume' — only the 'bridge' backend resumes here (cli-bridge " +
        'keys the harness conversation by session id). Provide a makeWorkerAgent that resumes ' +
        "(it receives spawnContext.resume.ofWorker), or use continuity: 'fresh'",
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
      `workerFromBackend: no recorded bridge session for worker '${ofWorker}' — this seam ` +
        're-attaches only sessions it bound in this process (the kernel resume boundary). ' +
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
