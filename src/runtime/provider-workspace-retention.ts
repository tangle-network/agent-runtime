import type {
  AgentCandidateCapturedArtifact,
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentExactRunControlRef,
  AgentProfile,
} from '@tangle-network/agent-interface'
import { AgentExactRunControlRefSchema } from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { verifyWorkspaceSnapshotArtifacts } from '../candidate-execution/artifacts'
import type { AgentCandidateArtifactPort } from '../candidate-execution/types'
import {
  type AgentCandidateWorkspaceArchiveLimits,
  verifyAgentCandidateWorkspaceArchive,
} from '../candidate-execution/workspace-archive'
import { verifyAgentCandidateWorkspaceArtifacts } from '../candidate-execution/workspace-streams'
import { ValidationError } from '../errors'
import { sameControlCoordinates } from './retained-run-binding'
import { runAbortable } from './supervise/abortable'
import { armDeadlineTimer } from './supervise/deadline'
import { detachedSnapshot } from './supervise/snapshot'
import type { ExecutorNodeContext } from './supervise/types'
import { createWorkerSlots, openSlotGroup, type SlotGroup } from './supervise/worker-slots'

/** The caller-owned boundary used to retain an executable provider workspace. */
export interface ProviderWorkspaceRetentionPort {
  /** Maximum wall-clock time Runtime gives queueing, capture, and verification. */
  readonly timeoutMs: number
  /**
   * Maximum simultaneous captures and verifications using this exact port object, including
   * recursive children. Omit for no admission bound. Share the port to share the bound.
   * Timed-out callbacks keep their slot until they settle, even if they ignore cancellation.
   */
  readonly maxConcurrentCaptures?: number
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
  /**
   * Capture only the harness's native session evidence, without the workspace, into the same
   * durable artifacts, reporting `workspaceScope: 'none'`.
   *
   * Runtime calls it every {@link nativeIntervalMs} while a turn runs and once more on every way
   * the turn ends: settled, failed, and an abort or deadline that closes the stream without
   * reaching either. A crash, deadline, credential renewal, reap or coordinator loss then loses
   * at most one interval of the session, and a workspace too large to capture no longer costs
   * the session. Measured before this existed: 85 of the 116 Discovery nodes that ran on Runtime
   * 0.297.x kept no session because their turn ended on an abort path, which never captured.
   *
   * When a deadline or an explicit cancellation ends a retained turn, Runtime stops its harness
   * and waits for the provider to report it stopped, within a 30 s bound, before the failure
   * capture and the final native copy, so both read a session that has stopped changing.
   *
   * Its captures use their own queue and bound, so they never wait behind workspace captures.
   */
  captureNative?(
    context: ProviderWorkspaceRetentionContext,
  ): Promise<ProviderWorkspaceCaptureResult>
  /** Milliseconds between native captures of a running turn. Default 120,000. */
  readonly nativeIntervalMs?: number
  /** Bound on one native capture, including its queue wait. Default 120,000. */
  readonly nativeTimeoutMs?: number
}

/** When {@link ProviderWorkspaceRetentionPort.captureNative} runs relative to its turn. */
export type ProviderNativeCapturePhase = 'running' | 'settled' | 'failed' | 'interrupted'

/** Default {@link ProviderWorkspaceRetentionPort.nativeIntervalMs}. */
export const DEFAULT_NATIVE_CAPTURE_INTERVAL_MS = 120_000
/** Default {@link ProviderWorkspaceRetentionPort.nativeTimeoutMs}. */
export const DEFAULT_NATIVE_CAPTURE_TIMEOUT_MS = 120_000

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
  /** Exact admitted provider execution; executionId above remains the Runtime artifact identity. */
  readonly controlRef?: AgentExactRunControlRef
  /** `none` marks a native-only capture: no workspace was scanned. */
  readonly workspaceScope?: 'environment' | 'none'
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
        readonly sourceId?: string
        readonly rootScope: 'session-home' | 'workspace-session'
        readonly path: string
        readonly kind: 'file' | 'directory' | 'symlink'
        readonly mode: number
        readonly sizeBytes: number
        readonly sha256: string | null
        readonly linkTarget: string | null
      }>
      readonly excludedPaths: ReadonlyArray<{
        readonly sourceId?: string
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

/**
 * Where one workspace capture's time went: the wait for a slot of the port's queue, which every
 * recursive environment shares, and the capture itself. Reported once per workspace capture, on
 * success and on failure, so a run records the split instead of leaving it to inference: on
 * Discovery Lab run terraform-economics-20261005f a turn's result arrived 4 to 28 minutes after its
 * stream ended, and nothing said how much of that was queue.
 */
export interface ProviderWorkspaceCaptureTiming {
  /** Captures of this port holding or waiting for a slot when this one was requested. */
  readonly ahead: number
  /** From the request to the slot being granted, or to the failure when none was granted. */
  readonly queuedMs: number
  /** From the slot being granted to the verified archive, or to the failure. Absent when the
   *  capture never held a slot. */
  readonly captureMs?: number
  /** Bytes of the verified workspace archive. */
  readonly archiveBytes?: number
  readonly outcome: 'captured' | 'failed'
  /** Why a failed capture failed, bounded. */
  readonly error?: string
}

/** The exact live execution facts supplied to a retention callback. */
export interface ProviderWorkspaceRetentionContext {
  readonly environment: AgentEnvironment
  /** Runtime invocation identity used by the artifact store; never a provider session coordinate. */
  readonly executionId: string
  /** Exact admitted provider execution, available even before the harness emits its session id. */
  readonly controlRef?: AgentExactRunControlRef
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
  /** Set on native captures only: whether the turn was still running or how it ended. */
  readonly phase?: ProviderNativeCapturePhase
  /** A fresh signal bounded by {@link ProviderWorkspaceRetentionPort.timeoutMs}. */
  readonly signal: AbortSignal
}

/** Durable join from one provider box to the verified bytes retained before cleanup. */
export interface ProviderWorkspaceCaptureReceipt {
  readonly executionId: string
  /** Durable provider-native identity, separate from the Runtime invocation identity. */
  readonly controlRef?: AgentExactRunControlRef
  readonly node?: ExecutorNodeContext
  readonly environmentId: string
  /** Exact provider-create profile identity; materialization receipts bind it to the authored profile. */
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
  if (
    port.maxConcurrentCaptures !== undefined &&
    (!Number.isSafeInteger(port.maxConcurrentCaptures) || port.maxConcurrentCaptures <= 0)
  ) {
    throw new ValidationError(
      `${context}: workspaceRetention.maxConcurrentCaptures must be a positive safe integer`,
    )
  }
  if (port.artifacts === null || typeof port.artifacts?.read !== 'function') {
    throw new ValidationError(`${context}: workspaceRetention.artifacts.read is required`)
  }
  if (typeof port.capture !== 'function') {
    throw new ValidationError(`${context}: workspaceRetention.capture is required`)
  }
  if (port.captureNative !== undefined && typeof port.captureNative !== 'function') {
    throw new ValidationError(`${context}: workspaceRetention.captureNative must be a function`)
  }
  for (const key of ['nativeIntervalMs', 'nativeTimeoutMs'] as const) {
    const value = port[key]
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new ValidationError(
        `${context}: workspaceRetention.${key} must be a positive safe integer`,
      )
    }
  }
}

type CaptureSlots = Pick<ProviderWorkspaceRetentionPort, 'maxConcurrentCaptures'>
const captureGroups = new WeakMap<CaptureSlots, SlotGroup>()
// Native captures are small and frequent; their own queue keeps them out from behind
// multi-gigabyte workspace captures at a deadline wave. One stable key per port shares it.
const nativeSlotKeys = new WeakMap<ProviderWorkspaceRetentionPort, CaptureSlots>()
function nativeSlots(port: ProviderWorkspaceRetentionPort): CaptureSlots {
  let key = nativeSlotKeys.get(port)
  if (key === undefined) {
    key = Object.freeze({ maxConcurrentCaptures: port.maxConcurrentCaptures })
    nativeSlotKeys.set(port, key)
  }
  return key
}

// Captures of one port that hold or wait for a slot, read as `ahead` by the next request.
const capturesInFlight = new WeakMap<CaptureSlots, number>()

async function withCaptureSlot<T>(
  port: CaptureSlots,
  signal: AbortSignal,
  capture: () => Promise<T>,
): Promise<T> {
  if (port.maxConcurrentCaptures === undefined) return capture()
  let group = captureGroups.get(port)
  if (group === undefined) {
    // A root group never lends slots. Equal depths reuse the maintained allocator's FIFO queue.
    group = openSlotGroup(createWorkerSlots(port.maxConcurrentCaptures))
    captureGroups.set(port, group)
  }
  const permit = group.acquire(0)
  try {
    await runAbortable(() => permit.ready, signal, 'provider workspace retention queue aborted')
    signal.throwIfAborted()
    return await capture()
  } finally {
    // Release the actual operation, not its outer timeout race: late I/O still consumes capacity.
    permit.release()
  }
}

/** Count one capture of `port` in flight until `work` settles, and say how many were ahead. */
function trackCapture<T>(port: CaptureSlots, work: (ahead: number) => Promise<T>): Promise<T> {
  const ahead = capturesInFlight.get(port) ?? 0
  capturesInFlight.set(port, ahead + 1)
  return work(ahead).finally(() => {
    capturesInFlight.set(port, Math.max(0, (capturesInFlight.get(port) ?? 1) - 1))
  })
}

/**
 * Capture, require durable refs, and verify every returned manifest/archive byte.
 * `native` calls {@link ProviderWorkspaceRetentionPort.captureNative} under its own queue and
 * bound, and judges coverage by the sessions alone. `onTiming` receives the queue wait and the
 * capture time of a workspace capture once it settles, whether it succeeded or failed.
 */
export async function captureProviderWorkspaceSnapshot(
  port: ProviderWorkspaceRetentionPort,
  context: Omit<ProviderWorkspaceRetentionContext, 'signal'>,
  scope: 'environment' | 'native' = 'environment',
  onTiming?: (timing: ProviderWorkspaceCaptureTiming) => void,
): Promise<ProviderWorkspaceCaptureResult> {
  assertProviderWorkspaceRetentionPort(port, 'provider workspace retention')
  if (scope === 'native' || onTiming === undefined) {
    return await captureWithinSlot(port, context, scope)
  }
  return await trackCapture(port, async (ahead) => {
    const requestedAt = Date.now()
    let grantedAt: number | undefined
    const report = (timing: Omit<ProviderWorkspaceCaptureTiming, 'ahead' | 'queuedMs'>): void => {
      const settledAt = Date.now()
      try {
        onTiming({
          ahead,
          queuedMs: (grantedAt ?? settledAt) - requestedAt,
          ...(grantedAt === undefined ? {} : { captureMs: settledAt - grantedAt }),
          ...timing,
        })
      } catch {
        // An observer that throws must not change the capture's outcome.
      }
    }
    try {
      const captured = await captureWithinSlot(port, context, scope, () => {
        grantedAt = Date.now()
      })
      report({ outcome: 'captured', archiveBytes: captured.snapshot.archive.byteLength })
      return captured
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report({ outcome: 'failed', error: message.slice(0, 1_000) })
      throw error
    }
  })
}

async function captureWithinSlot(
  port: ProviderWorkspaceRetentionPort,
  context: Omit<ProviderWorkspaceRetentionContext, 'signal'>,
  scope: 'environment' | 'native',
  onGranted?: () => void,
): Promise<ProviderWorkspaceCaptureResult> {
  const native = scope === 'native'
  if (native && port.captureNative === undefined) {
    throw new ValidationError('provider workspace retention: the port has no captureNative')
  }
  const timeoutMs = native
    ? (port.nativeTimeoutMs ?? DEFAULT_NATIVE_CAPTURE_TIMEOUT_MS)
    : port.timeoutMs
  const controlRef =
    context.controlRef === undefined
      ? undefined
      : AgentExactRunControlRefSchema.parse(context.controlRef)
  if (
    controlRef !== undefined &&
    (controlRef.environmentId !== context.environment.id ||
      controlRef.provider !== context.environment.provider ||
      (context.providerSessionId != null && controlRef.sessionId !== context.providerSessionId))
  )
    throw new Error(
      'provider workspace retention control reference names another environment or session',
    )
  const controller = new AbortController()
  const clearDeadline = armDeadlineTimer(
    timeoutMs,
    () =>
      controller.abort(new Error(`provider workspace retention timed out after ${timeoutMs}ms`)),
    true,
  )
  try {
    const snapshot = await runAbortable(
      () =>
        withCaptureSlot(native ? nativeSlots(port) : port, controller.signal, async () => {
          onGranted?.()
          // Detach before any asynchronous artifact read. The callback owns its return object and
          // could otherwise mutate the manifest or archive references while verification is in flight.
          const input = {
            ...context,
            ...(controlRef === undefined ? {} : { controlRef: Object.freeze({ ...controlRef }) }),
            signal: controller.signal,
          }
          const result = detachedSnapshot(
            native ? await port.captureNative!(input) : await port.capture(input),
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
          if (
            provenance.controlRef !== undefined &&
            (controlRef === undefined ||
              !sameControlCoordinates(
                AgentExactRunControlRefSchema.parse(provenance.controlRef),
                controlRef,
              ))
          )
            throw new Error(
              'provider workspace retention provenance names another admitted execution',
            )
          const coverageGaps = [...provenance.missing]
          if (controlRef !== undefined) {
            if (provenance.controlRef === undefined)
              coverageGaps.push('Exact admitted control reference missing')
            if (
              !provenance.sessions?.some(
                (session) =>
                  session.id === controlRef.sessionId &&
                  session.executionIds?.includes(controlRef.executionId),
              )
            )
              coverageGaps.push('Exact admitted provider execution missing from capture')
          }
          if (provenance.status !== 'reported') coverageGaps.push('Coverage metadata unavailable')
          if (provenance.executionId !== context.executionId)
            coverageGaps.push('Exact execution identity missing')
          if (native) {
            if (provenance.workspaceScope !== 'none')
              coverageGaps.push('Native capture did not report a native-only scope')
          } else if (provenance.workspace?.complete !== true)
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
          if (port.artifacts.readStream) {
            await verifyAgentCandidateWorkspaceArtifacts({
              role: 'candidate',
              snapshot,
              artifacts: port.artifacts,
              signal: controller.signal,
              ...(port.limits === undefined ? {} : { limits: port.limits }),
            })
          } else {
            const { archive } = await verifyWorkspaceSnapshotArtifacts(snapshot, port.artifacts)
            await verifyAgentCandidateWorkspaceArchive({
              role: 'candidate',
              snapshot,
              archive,
              ...(port.limits === undefined ? {} : { limits: port.limits }),
            })
          }
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
        }),
      controller.signal,
      `provider workspace retention timed out after ${timeoutMs}ms`,
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
