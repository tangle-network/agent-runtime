import {
  type AgentCandidateWorkspaceSnapshotEvidence,
  type AgentProfile,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import type { SandboxInstance } from '@tangle-network/sandbox'
import type { AgentCandidateArtifactPort } from '../candidate-execution/types'
import type { AgentCandidateWorkspaceArchiveLimits } from '../candidate-execution/workspace-archive'
import { ValidationError } from '../errors'
import {
  captureProviderWorkspaceSnapshot,
  type ProviderWorkspaceCaptureProvenance,
} from './provider-workspace-retention'

/** One durable capture before a Sandbox box is removed. */
export interface SandboxEvidenceRetentionPort {
  readonly timeoutMs: number
  readonly limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
  readonly artifacts: AgentCandidateArtifactPort
  capture(context: SandboxEvidenceContext & { readonly signal: AbortSignal }): Promise<{
    readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
    readonly provenance: ProviderWorkspaceCaptureProvenance
  }>
  /** Must durably record this exact verified receipt before returning. */
  record(receipt: SandboxEvidenceReceipt): Promise<void>
}

export interface SandboxEvidenceContext {
  readonly box: SandboxInstance
  readonly executionId: string
  readonly profile: AgentProfile
  readonly sandboxSessionIds: ReadonlyArray<string>
  readonly nativeSessionIds?: ReadonlyArray<string>
  readonly sessionExecutionIds: Readonly<Record<string, ReadonlyArray<string>>>
}

export interface SandboxEvidenceReceipt {
  readonly boxId: string
  readonly executionId: string
  /** Exact authored profile identity without copying credentials into the receipt. */
  readonly profileDigest: string
  readonly scope: 'box'
  readonly sandboxSessionIds: ReadonlyArray<string>
  readonly nativeSessionIds?: ReadonlyArray<string>
  readonly sessionExecutionIds: Readonly<Record<string, ReadonlyArray<string>>>
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  readonly provenance: ProviderWorkspaceCaptureProvenance
  readonly coverageComplete: boolean
  readonly incompleteReason?: string
}

/** A failed capture keeps the live source handle available for an explicit retry. */
export class SandboxEvidenceRetentionError extends Error {
  readonly box: SandboxInstance

  constructor(box: SandboxInstance, cause: unknown) {
    super(
      `Sandbox evidence retention failed for box ${String(box.id)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
    this.name = 'SandboxEvidenceRetentionError'
    this.box = box
  }
}

/** Capture, verify, durably record, then destroy. A failure leaves the source intact. */
export async function captureBeforeDestroy(
  port: SandboxEvidenceRetentionPort,
  context: SandboxEvidenceContext,
  destroy: () => Promise<void>,
): Promise<SandboxEvidenceReceipt> {
  const environment = { id: String(context.box.id), provider: 'sandbox' } as AgentEnvironment
  const result = await captureProviderWorkspaceSnapshot(
    {
      timeoutMs: port.timeoutMs,
      ...(port.limits === undefined ? {} : { limits: port.limits }),
      artifacts: port.artifacts,
      capture: ({ signal }) => port.capture({ ...context, signal }),
    },
    {
      environment,
      executionId: context.executionId,
      providerSessionId: context.sandboxSessionIds[0] ?? null,
      nativeSessionId: null,
      profile: context.profile,
    },
  )
  const missing = context.sandboxSessionIds.filter(
    (id) =>
      !result.provenance.sessions?.some(
        (session) => session.id === id && session.executionId === context.executionId,
      ),
  )
  for (const nativeId of context.nativeSessionIds ?? []) {
    if (!result.provenance.sessions?.some((session) => session.nativeSessionId === nativeId)) {
      missing.push(`native/${nativeId}`)
    }
  }
  for (const sessionId of context.sandboxSessionIds) {
    if ((context.sessionExecutionIds[sessionId]?.length ?? 0) === 0) {
      missing.push(`${sessionId}/execution-id-unobserved`)
    }
  }
  for (const [sessionId, executionIds] of Object.entries(context.sessionExecutionIds)) {
    const session = result.provenance.sessions?.find((item) => item.id === sessionId)
    for (const executionId of executionIds) {
      if (
        !session?.executionIds?.includes(executionId) ||
        !session.eventCountsByExecutionId?.[executionId]
      ) {
        missing.push(`${sessionId}/${executionId}`)
      }
    }
  }
  const coverageComplete = result.coverageComplete === true && missing.length === 0
  const incompleteReason = coverageComplete
    ? undefined
    : [
        result.incompleteReason,
        ...missing.map((id) => `Sandbox session ${id} missing from capture`),
      ]
        .filter((reason): reason is string => reason !== undefined)
        .join('; ')
  const receipt: SandboxEvidenceReceipt = {
    boxId: String(context.box.id),
    executionId: context.executionId,
    profileDigest: canonicalAgentProfileDigest(context.profile),
    scope: 'box',
    sandboxSessionIds: [...context.sandboxSessionIds],
    ...(context.nativeSessionIds === undefined
      ? {}
      : { nativeSessionIds: [...context.nativeSessionIds] }),
    sessionExecutionIds: Object.fromEntries(
      Object.entries(context.sessionExecutionIds).map(([id, executions]) => [id, [...executions]]),
    ),
    snapshot: result.snapshot,
    provenance: result.provenance,
    coverageComplete,
    ...(incompleteReason === undefined ? {} : { incompleteReason }),
  }
  await port.record(receipt)
  if (!coverageComplete) throw new Error(incompleteReason ?? 'Sandbox evidence coverage incomplete')
  await destroy()
  return receipt
}

/** Execution-scoped inventory of every Sandbox session and turn observed by a loop. */
export class SandboxEvidenceTracker {
  private readonly boxes = new Map<
    SandboxInstance,
    {
      profile: AgentProfile
      sessions: Map<string, Set<string>>
    }
  >()

  constructor(
    private readonly port: SandboxEvidenceRetentionPort,
    private readonly runId: string,
  ) {
    if (!Number.isSafeInteger(port.timeoutMs) || port.timeoutMs <= 0) {
      throw new ValidationError(
        'Sandbox evidence retention.timeoutMs must be a positive safe integer',
      )
    }
    if (typeof port.artifacts?.read !== 'function') {
      throw new ValidationError('Sandbox evidence retention.artifacts.read is required')
    }
    if (typeof port.capture !== 'function') {
      throw new ValidationError('Sandbox evidence retention.capture is required')
    }
    if (typeof port.record !== 'function') {
      throw new ValidationError('Sandbox evidence retention.record is required')
    }
  }

  register(box: SandboxInstance, profile: AgentProfile, sessionId?: string): void {
    let state = this.boxes.get(box)
    if (state === undefined) {
      state = { profile, sessions: new Map() }
      this.boxes.set(box, state)
    }
    if (sessionId !== undefined && !state.sessions.has(sessionId)) {
      state.sessions.set(sessionId, new Set())
    }
  }

  recordDispatch(box: SandboxInstance, sessionId: string, executionId: string): void {
    const state = this.boxes.get(box)
    if (state === undefined) throw new Error('Sandbox evidence dispatched before box registration')
    const executions = state.sessions.get(sessionId) ?? new Set<string>()
    executions.add(executionId)
    state.sessions.set(sessionId, executions)
  }

  observe(
    box: SandboxInstance,
    event: { readonly data: Record<string, unknown> },
    sessionHint?: string,
  ): void {
    const state = this.boxes.get(box)
    if (state === undefined) throw new Error('Sandbox evidence observed before box registration')
    const sessionId =
      typeof event.data.runtimeSessionId === 'string' ? event.data.runtimeSessionId : sessionHint
    if (sessionId === undefined) return
    const executions = state.sessions.get(sessionId) ?? new Set<string>()
    if (typeof event.data.executionId === 'string') executions.add(event.data.executionId)
    state.sessions.set(sessionId, executions)
  }

  async destroy(box: SandboxInstance): Promise<void> {
    const state = this.boxes.get(box)
    if (state === undefined)
      throw new Error(`Sandbox evidence has no registered source ${String(box.id)}`)
    const sandboxSessionIds = [...state.sessions.keys()].sort()
    const sessionExecutionIds = Object.fromEntries(
      [...state.sessions.entries()].map(([id, executions]) => [id, [...executions].sort()]),
    )
    try {
      await captureBeforeDestroy(
        this.port,
        {
          box,
          executionId: this.runId,
          profile: state.profile,
          sandboxSessionIds,
          sessionExecutionIds,
        },
        async () => {
          await box.delete()
        },
      )
      this.boxes.delete(box)
    } catch (error) {
      throw new SandboxEvidenceRetentionError(box, error)
    }
  }
}
