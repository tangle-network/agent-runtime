import type {
  AgentCandidateCapturedArtifact,
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { verifyWorkspaceSnapshotArtifacts } from '../candidate-execution/artifacts'
import type { AgentCandidateArtifactPort } from '../candidate-execution/types'
import {
  type AgentCandidateWorkspaceArchiveLimits,
  verifyAgentCandidateWorkspaceArchive,
} from '../candidate-execution/workspace-archive'
import { ValidationError } from '../errors'
import { runAbortable } from './supervise/abortable'
import { armDeadlineTimer } from './supervise/deadline'
import { detachedSnapshot } from './supervise/snapshot'
import type { ExecutorNodeContext } from './supervise/types'

/** The caller-owned boundary used to retain an executable provider workspace. */
export interface ProviderWorkspaceRetentionPort {
  /** Maximum wall-clock time Runtime gives capture and verification. */
  readonly timeoutMs: number
  /** Same explicit archive bounds used by the capture callback. */
  readonly limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
  /** Refuse cleanup while any native session or workspace coverage remains missing. */
  readonly requireCompleteProvenance?: boolean
  /** Reads the durable manifest and archive after capture returns. */
  readonly artifacts: AgentCandidateArtifactPort
  /** Capture the live environment into the standard candidate workspace evidence shape. */
  capture(
    context: ProviderWorkspaceRetentionContext,
  ): Promise<AgentCandidateWorkspaceSnapshotEvidence | ProviderWorkspaceCaptureResult>
}

/** Source inventory metadata for a workspace entry. */
export interface ProviderWorkspaceEntryMetadata {
  readonly path: string
  readonly type: 'file' | 'directory' | 'symlink'
  readonly sizeBytes: number
  readonly mode: number
  readonly owner?: string | null
  readonly group?: string | null
  readonly modifiedAt?: string | null
  readonly accessedAt?: string | null
  readonly symlinkTarget?: string | null
}

/** One Sidecar execution attempt; retries remain separate evidence. */
export interface ProviderWorkspaceAttemptProvenance {
  readonly executionId: string
  readonly ordinal: number
  readonly providerSessionId: string
  readonly nativeSessionIds: ReadonlyArray<string>
  readonly processIds: ReadonlyArray<string>
  readonly outcome: 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  readonly missingReasons: ReadonlyArray<string>
}

/** Source-reported coverage retained with the verified archive reference. */
export interface ProviderWorkspaceCaptureProvenance {
  readonly status: 'reported' | 'unavailable'
  readonly provider?: string
  readonly environmentId?: string
  readonly executionId?: string
  readonly workspaceScope?: 'environment'
  readonly workspaceRoot?: string
  readonly capturedAt?: string
  readonly entries?: ReadonlyArray<ProviderWorkspaceEntryMetadata>
  readonly excludedPaths?: ReadonlyArray<
    ProviderWorkspaceEntryMetadata & { readonly reason: string }
  >
  readonly workspace?: {
    readonly scannedFiles: number
    readonly scannedDirectories: number
    readonly reportedFiles: number
    readonly reportedDirectories: number
    readonly complete: boolean
  }
  /** Sidecar attempts join sessions through executionIds, not the Runtime node ID. */
  readonly attempts?: ReadonlyArray<ProviderWorkspaceAttemptProvenance>
  readonly sessions?: ReadonlyArray<{
    readonly id: string
    readonly executionId: string
    readonly transportEvents: string
    readonly eventCount: number
    readonly messageCount: number
    readonly messageScope?: string
    readonly backendType?: string
    readonly executionIds?: ReadonlyArray<string>
    readonly eventCountsByExecutionId?: Readonly<Record<string, number>>
    readonly nativeSessionId?: string | null
    readonly nativeReason?: string | null
    readonly sidecarImageDigest?: string | null
    readonly sidecarBundleRevision?: string | null
    readonly nativeStore?: {
      readonly scope: 'session'
      readonly roots: ReadonlyArray<{
        readonly scope: 'session-home' | 'workspace-session'
        readonly path: string
      }>
      readonly inventory: {
        readonly scannedFiles: number
        readonly reportedFiles: number
        readonly scannedDirectories: number
        readonly reportedDirectories: number
        readonly scannedSymlinks: number
        readonly reportedSymlinks: number
        readonly skippedEntries: number
      } | null
      readonly complete: boolean
      readonly entries: ReadonlyArray<{
        readonly rootScope: 'session-home' | 'workspace-session'
        readonly path: string
        readonly kind: 'file' | 'directory' | 'symlink'
        readonly mode: number
        readonly sizeBytes: number
        readonly sha256: string | null
        readonly linkTarget: string | null
      }>
      readonly excludedPaths: ReadonlyArray<{
        readonly rootScope: 'session-home' | 'workspace-session'
        readonly path: string
        readonly kind: 'file' | 'directory' | 'symlink'
        readonly mode: number
        readonly sizeBytes: number
        readonly reason: 'credential'
      }>
    }
    readonly processStreams?: {
      readonly complete: boolean
      readonly streamCount: number
      readonly stdinBytes: number
      readonly stdoutBytes: number
      readonly stderrBytes: number
      readonly protocolBytes: number
    }
    readonly nativeEvents?: { readonly complete: boolean; readonly count: number }
  }>
  readonly missing: ReadonlyArray<string>
}

export interface ProviderWorkspaceCaptureResult {
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  readonly provenance: ProviderWorkspaceCaptureProvenance
  readonly coverageComplete?: boolean
  readonly incompleteReason?: string
}

/** The exact live execution facts supplied to a retention callback. */
export interface ProviderWorkspaceRetentionContext {
  readonly environment: AgentEnvironment
  readonly executionId: string
  /** Exact supervised tree identity, when a supervisor created this execution. */
  readonly node?: ExecutorNodeContext
  /** Sandbox/provider session used for this turn; null means no session id was observed. */
  readonly providerSessionId?: string | null
  /** The harness's own session identity is unknown until a provider reports it. */
  readonly nativeSessionId?: string | null
  /** The exact profile used to create the provider environment. */
  readonly profile: AgentProfile
  /** The provider-derived outcome, when one was available before cleanup. */
  readonly outcome?: AgentRunOutcome
  /** A fresh signal bounded by {@link ProviderWorkspaceRetentionPort.timeoutMs}. */
  readonly signal: AbortSignal
}

/** Durable join from one provider box to the verified bytes retained before cleanup. */
export interface ProviderWorkspaceCaptureReceipt {
  readonly executionId: string
  readonly node?: ExecutorNodeContext
  readonly environmentId: string
  /** Immutable authored AgentProfile identity; run records retain its content. */
  readonly profileDigest: string
  readonly providerSessionId: string | null
  readonly nativeSessionId: string | null
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  readonly provenance: ProviderWorkspaceCaptureProvenance
  readonly coverageComplete: boolean
  readonly incompleteReason?: string
}

/** Validate the executable retention port at the create boundary. */
export function assertProviderWorkspaceRetentionPort(
  port: ProviderWorkspaceRetentionPort,
  context: string,
): void {
  if (!Number.isSafeInteger(port.timeoutMs) || port.timeoutMs <= 0) {
    throw new ValidationError(
      `${context}: workspaceRetention.timeoutMs must be a positive safe integer`,
    )
  }
  if (port.artifacts === null || typeof port.artifacts?.read !== 'function') {
    throw new ValidationError(`${context}: workspaceRetention.artifacts.read is required`)
  }
  if (typeof port.capture !== 'function') {
    throw new ValidationError(`${context}: workspaceRetention.capture is required`)
  }
}

/** Capture, require durable refs, and verify every returned manifest/archive byte. */
export async function captureProviderWorkspaceSnapshot(
  port: ProviderWorkspaceRetentionPort,
  context: Omit<ProviderWorkspaceRetentionContext, 'signal'>,
): Promise<ProviderWorkspaceCaptureResult> {
  assertProviderWorkspaceRetentionPort(port, 'provider workspace retention')
  const controller = new AbortController()
  const clearDeadline = armDeadlineTimer(
    port.timeoutMs,
    () =>
      controller.abort(
        new Error(`provider workspace retention timed out after ${port.timeoutMs}ms`),
      ),
    true,
  )
  try {
    const snapshot = await runAbortable(
      async () => {
        // Detach before any asynchronous artifact read. The callback owns its return object and
        // could otherwise mutate the manifest or archive references while verification is in flight.
        const result = detachedSnapshot(
          await port.capture({ ...context, signal: controller.signal }),
          'provider workspace retention snapshot',
        )
        const snapshot = 'snapshot' in result ? result.snapshot : result
        const provenance =
          'snapshot' in result
            ? detachedSnapshot(result.provenance, 'provider workspace retention provenance')
            : {
                status: 'unavailable' as const,
                missing: ['Capture callback returned no coverage metadata'],
              }
        if (
          !Array.isArray(provenance.missing) ||
          !['reported', 'unavailable'].includes(provenance.status)
        ) {
          throw new Error('provider workspace retention provenance is malformed')
        }
        if (
          provenance.status === 'reported' &&
          provenance.environmentId !== context.environment.id
        ) {
          throw new Error('provider workspace retention provenance names another environment')
        }
        if (
          provenance.executionId !== undefined &&
          provenance.executionId !== context.executionId
        ) {
          throw new Error('provider workspace retention provenance names another execution')
        }
        const coverageGaps = [...provenance.missing]
        if (provenance.status !== 'reported') coverageGaps.push('Coverage metadata unavailable')
        if (provenance.executionId !== context.executionId)
          coverageGaps.push('Exact execution identity missing')
        if (provenance.workspace?.complete !== true)
          coverageGaps.push('Workspace inventory incomplete')
        if (provenance.sessions === undefined) coverageGaps.push('Session inventory missing')
        if (
          context.providerSessionId != null &&
          !provenance.sessions?.some(
            (session) =>
              session.id === context.providerSessionId &&
              session.executionId === context.executionId,
          )
        )
          coverageGaps.push(`Provider session ${context.providerSessionId} missing from capture`)
        for (const session of provenance.sessions ?? []) {
          if (session.executionId !== context.executionId)
            coverageGaps.push(`Session ${session.id} names another execution`)
          if (session.transportEvents !== 'complete')
            coverageGaps.push(`Session ${session.id} transport events unavailable`)
          if (session.backendType !== context.profile.harness)
            coverageGaps.push(`Session ${session.id} harness identity mismatch`)
          if (
            session.nativeStore?.complete !== true ||
            session.nativeStore.inventory?.skippedEntries !== 0
          )
            coverageGaps.push(`Session ${session.id} native store incomplete`)
          if (session.processStreams?.complete !== true)
            coverageGaps.push(`Session ${session.id} process streams incomplete`)
          if (session.nativeEvents?.complete !== true)
            coverageGaps.push(`Session ${session.id} native events incomplete`)
          if (!/^sha256:[0-9a-f]{64}$/.test(session.sidecarImageDigest ?? ''))
            coverageGaps.push(`Session ${session.id} sidecar image digest missing`)
          if (!/^[0-9a-f]{40}$/.test(session.sidecarBundleRevision ?? ''))
            coverageGaps.push(`Session ${session.id} sidecar bundle revision missing`)
        }
        coverageGaps.push(
          ...attemptCoverageGaps(provenance, port.requireCompleteProvenance === true),
        )
        const coverageComplete = coverageGaps.length === 0
        requireDurableWorkspaceArtifacts(snapshot)
        const { archive } = await verifyWorkspaceSnapshotArtifacts(snapshot, port.artifacts)
        await verifyAgentCandidateWorkspaceArchive({
          role: 'candidate',
          snapshot,
          archive,
          ...(port.limits === undefined ? {} : { limits: port.limits }),
        })
        return {
          snapshot,
          provenance,
          coverageComplete,
          ...(coverageComplete
            ? {}
            : {
                incompleteReason: `provider workspace retention coverage incomplete: ${coverageGaps.join('; ')}`,
              }),
        }
      },
      controller.signal,
      `provider workspace retention timed out after ${port.timeoutMs}ms`,
    )
    return snapshot
  } finally {
    clearDeadline()
  }
}

/** Reconcile Sidecar attempts to the exact captured session executions. */
function attemptCoverageGaps(
  provenance: ProviderWorkspaceCaptureProvenance,
  strict: boolean,
): string[] {
  const attempts = provenance.attempts
  if (attempts === undefined) return strict ? ['Attempt inventory missing'] : []
  if (!Array.isArray(attempts)) return ['Attempt inventory malformed']
  const gaps: string[] = []
  if (strict && attempts.length === 0) gaps.push('Attempt inventory empty')
  const owners = new Map<string, string>()
  for (const session of provenance.sessions ?? []) {
    if (!Array.isArray(session.executionIds) || session.executionIds.length === 0) {
      gaps.push(`Session ${session.id} has no Sidecar execution inventory`)
      continue
    }
    for (const id of session.executionIds) {
      if (typeof id !== 'string' || id.trim() === '') {
        gaps.push(`Session ${session.id} has an invalid Sidecar execution ID`)
        continue
      }
      if (owners.has(id)) gaps.push(`Sidecar execution ${id} has multiple session owners`)
      else owners.set(id, session.id)
      const count = session.eventCountsByExecutionId?.[id]
      if (!Number.isSafeInteger(count) || (count ?? 0) <= 0)
        gaps.push(`Sidecar execution ${id} has no retained event count`)
    }
  }
  const ordinals = new Map<string, Set<number>>()
  for (const [index, attempt] of attempts.entries()) {
    if (attempt === null || typeof attempt !== 'object') {
      gaps.push(`Attempt ${index} is malformed`)
      continue
    }
    const id = attempt.executionId
    if (typeof id !== 'string' || id.trim() === '' || !owners.has(id)) {
      gaps.push(`Attempt ${index} has no exact Sidecar execution owner`)
      continue
    }
    if (typeof attempt.providerSessionId !== 'string' || attempt.providerSessionId.trim() === '')
      gaps.push(`Attempt ${id} has no provider session ID`)
    if (!Number.isSafeInteger(attempt.ordinal) || attempt.ordinal <= 0) {
      gaps.push(`Attempt ${id} has an invalid ordinal`)
    } else {
      const seen = ordinals.get(id) ?? new Set<number>()
      if (seen.has(attempt.ordinal)) gaps.push(`Attempt ${id} repeats ordinal ${attempt.ordinal}`)
      seen.add(attempt.ordinal)
      ordinals.set(id, seen)
    }
    if (
      !Array.isArray(attempt.nativeSessionIds) ||
      attempt.nativeSessionIds.length === 0 ||
      attempt.nativeSessionIds.some(
        (nativeId: unknown) => typeof nativeId !== 'string' || nativeId.trim() === '',
      ) ||
      new Set(attempt.nativeSessionIds).size !== attempt.nativeSessionIds.length
    )
      gaps.push(`Attempt ${id}/${attempt.ordinal} has incomplete native session identity`)
    if (
      !Array.isArray(attempt.processIds) ||
      attempt.processIds.some(
        (processId: unknown) => typeof processId !== 'string' || processId.trim() === '',
      ) ||
      new Set(attempt.processIds).size !== attempt.processIds.length
    )
      gaps.push(`Attempt ${id}/${attempt.ordinal} has invalid process identity`)
    if (!['succeeded', 'failed', 'cancelled', 'unknown'].includes(attempt.outcome))
      gaps.push(`Attempt ${id}/${attempt.ordinal} has invalid outcome`)
    else if (strict && attempt.outcome === 'unknown')
      gaps.push(`Attempt ${id}/${attempt.ordinal} has unknown outcome`)
    if (
      !Array.isArray(attempt.missingReasons) ||
      attempt.missingReasons.some(
        (reason: unknown) => typeof reason !== 'string' || reason.trim() === '',
      )
    )
      gaps.push(`Attempt ${id}/${attempt.ordinal} has malformed missing reasons`)
    else if (attempt.missingReasons.length > 0)
      gaps.push(`Attempt ${id}/${attempt.ordinal}: ${attempt.missingReasons.join('; ')}`)
  }
  for (const session of provenance.sessions ?? []) {
    const ownedAttempts = attempts.filter(
      (attempt) =>
        attempt != null &&
        typeof attempt === 'object' &&
        session.executionIds?.includes(attempt.executionId),
    )
    if (session.nativeSessionId != null) {
      const nativeIds = new Set(
        ownedAttempts.flatMap((attempt) =>
          Array.isArray(attempt.nativeSessionIds) ? attempt.nativeSessionIds : [],
        ),
      )
      if (!nativeIds.has(session.nativeSessionId))
        gaps.push(`Session ${session.id} native identity conflicts with attempt inventory`)
    }
    if (
      (session.processStreams?.streamCount ?? 0) > 0 &&
      !ownedAttempts.some(
        (attempt) => Array.isArray(attempt.processIds) && attempt.processIds.length > 0,
      )
    )
      gaps.push(`Session ${session.id} process streams lack attempt process identity`)
  }
  for (const id of owners.keys()) {
    const seen = ordinals.get(id)
    if (!seen || seen.size === 0) {
      gaps.push(`Sidecar execution ${id} has no attempt record`)
      continue
    }
    for (let ordinal = 1; ordinal <= seen.size; ordinal++)
      if (!seen.has(ordinal))
        gaps.push(`Sidecar execution ${id} is missing attempt ordinal ${ordinal}`)
  }
  return gaps
}

/** Native checkpoints, embedded bytes, and digest-only values cannot outlive their source. */
function requireDurableWorkspaceArtifacts(snapshot: AgentCandidateWorkspaceSnapshotEvidence): void {
  if (!isDurableArtifact(snapshot.manifest) || !isDurableArtifact(snapshot.archive)) {
    throw new Error(
      'provider workspace retention requires durable manifest and archive artifact references',
    )
  }
}

function isDurableArtifact(artifact: AgentCandidateCapturedArtifact): boolean {
  return 'locator' in artifact
}
