import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import { ValidationError } from '../../errors'
import { COORDINATION_CLIENT_TOOL_TIMEOUT_MS } from '../../mcp/tools/coordination-request-context'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import { isAsyncIterable, zeroSpend } from '../util'
import { type DriverAttemptIdentity, DriverExecutionAttempt } from './driver-execution-attempt'
import { seatProviderProfile } from './manager-drive-session'
import { runtimeOwnedPendingExecutorMaterialization } from './materialization'
import { assertExecutableAgentProfile } from './model-policy'
import { retainedExecutorSeamKey } from './retained-executor'
import {
  beginScopeRetainedOwnerDrive,
  type scopeRetainedOwnerContext,
  scopeRetainedOwnerPriorSpend,
} from './retained-scope-owner'
import type { RootStreamSink } from './root-stream'
import {
  bindReusableExecutorExecutionId,
  bridgeRuntimeAttachmentsKey,
  bridgeStopSignalKey,
  createExecutor,
} from './runtime'
import { scopeOwnerExecutorNodeContext } from './scope'
import type { ActiveSeat } from './seat-chain'
import { detachedSnapshot } from './snapshot'
import { exhaustedBudgetChannels } from './supervise-budget'
import type { DriverSessionState } from './supervise-driver-session'
import { externalExecutionId } from './supervise-identity'
import {
  assertBackendProfileMaterialization,
  assertBridgeProfileMaterializes,
} from './supervise-profile-admission'
import {
  CLAUDE_CODE_ONE_HOUR_CACHE,
  peerMailMcpAlias,
  peerMailRuntimeAttachment,
  providerAcceptsCoordinationAttachments,
} from './supervise-runtime-attachments'
import {
  assertNoReservedCoordinationMcpAlias,
  coordinationMcpAlias,
  type DriveHarness,
} from './supervisor-agent'
import type {
  AgentSpec,
  ExecutorFactory,
  ExecutorProgressEvent,
  ExecutorResult,
  Scope,
  UsageEvent,
} from './types'

interface DriverAttemptInput
  extends Pick<
    Parameters<DriveHarness>[0],
    | 'profile'
    | 'authoredProfile'
    | 'registeredProfile'
    | 'scope'
    | 'coordinationMcpUrl'
    | 'coordinationMcpHeaders'
    | 'peerMailUrl'
    | 'stopSignal'
    | 'coordinationTools'
    | 'session'
    | 'reentry'
    | 'onModelEvent'
  > {
  readonly state: DriverSessionState
  readonly retainedOwner: ReturnType<typeof scopeRetainedOwnerContext>
  readonly originalTask: unknown
  readonly activeSeat: ActiveSeat | undefined
  readonly baseFactory: ExecutorFactory<unknown>
  readonly executionId: string
  readonly now: () => number
  readonly turnCap: number
  readonly rootStream: RootStreamSink | undefined
  readonly keepTranscript: (capture: HarnessTranscriptCapture | undefined) => void
  readonly noteDriveProgress: (event: ExecutorProgressEvent) => void
  readonly drive: DriveHarness
}

export async function executeDriverAttempt(input: DriverAttemptInput): Promise<void> {
  const { state, scope, retainedOwner, turnCap } = input
  if (!(scope.view.inFlight > 0)) assertDriverBudgetOpen(scope, input.now)
  const identity = admitDriverProfiles(input)
  const spec: AgentSpec = {
    profile: identity.providerProfile,
    harness:
      state.boundBackend.backend === 'sandbox'
        ? (identity.providerProfile.harness as BackendType)
        : null,
  }
  // The turn cap rides the SAME stop lever the coordination stop uses: the harness runs its own
  // loop, so the only honest bound is "stop at the next turn boundary". Composing the two
  // signals keeps one lever rather than a second stop path.
  const turnStop = turnCap > 0 ? new AbortController() : undefined
  // A metered turn found past its budget ends the drive at the turn boundary, on the same lever,
  // and the turn's committed result stands.
  const budgetStop = new AbortController()
  const stopSignal = AbortSignal.any(
    [input.stopSignal, turnStop?.signal, budgetStop.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    ),
  )
  // The harness is asked for a 300 s tool-call timeout so a fenced tool can hold its response
  // longer than the 60 s harness default; a sidecar that applies it says so on each request.
  const peerMailAttachment = peerMailRuntimeAttachment(input.authoredProfile, state.boundBackend, {
    peerMailUrl: input.peerMailUrl,
  })
  const attachment = {
    transport: 'http' as const,
    url: input.coordinationMcpUrl,
    ...(input.coordinationMcpHeaders ? { headers: input.coordinationMcpHeaders } : {}),
    metadata: { toolTimeoutMs: COORDINATION_CLIENT_TOOL_TIMEOUT_MS },
  }
  // Only the provider path awaits, as it always did: the others add no tick before the executor.
  const factory =
    reusedAttemptFactory(input) ??
    (await providerAttemptFactory(input, identity.providerProfile.harness))
  const executor = factory(spec, {
    signal: scope.signal,
    node: scopeOwnerExecutorNodeContext(scope),
    seams: {
      ...(retainedOwner
        ? {
            [retainedExecutorSeamKey]: {
              ...retainedOwner,
              onResult: async (result: ExecutorResult<unknown>) =>
                attempt.commitOwnerResult(result),
            },
          }
        : {}),
      [bridgeStopSignalKey]: stopSignal,
      [bridgeRuntimeAttachmentsKey]: {
        ...(peerMailAttachment ?? {}),
        [coordinationMcpAlias]: attachment,
      },
    },
  })
  // The attempt this one replaces may have captured since it returned.
  input.keepTranscript(state.lastExecutor?.harnessTranscript?.())
  state.activeExecutor = executor
  state.lastExecutor = executor
  const attempt = new DriverExecutionAttempt(
    scope,
    executor,
    identity,
    retainedOwner,
    retainedOwner ? await scopeRetainedOwnerPriorSpend(scope) : zeroSpend(),
    { signal: stopSignal, turnStop, budgetStop },
    input.now,
  )
  const pending = runtimeOwnedPendingExecutorMaterialization(executor)
  // The owner's release waits for this drive to end its turn, so it reads the turn's receipt.
  const endDrive = retainedOwner ? beginScopeRetainedOwnerDrive(scope) : () => {}
  try {
    await attempt.admit(pending)
    attempt.started = true
    // A coordination completion stops the NEXT external turn. The active bridge request must
    // drain so its served model and terminal materialization remain valid evidence.
    if (retainedOwner?.admissions.length && !executor.recover) {
      throw new ValidationError('retained owner executor does not support recovery')
    }
    // The stream file opens at the first attempt that actually runs an executor, so a resumed
    // owner whose accepted result was restored above leaves it untouched.
    await input.rootStream?.beginAttempt()
    const run = retainedOwner?.admissions.length
      ? executor.recover!(input.originalTask, scope.signal)
      : executor.execute(input.originalTask, scope.signal)
    if (isAsyncIterable<UsageEvent>(run)) {
      await attempt.drainStream(run, input)
    } else {
      await attempt.settleReturned(await run)
    }
    await attempt.publishAcknowledgement(pending)
    attempt.completed = true
  } catch (error) {
    attempt.noteFailure(error)
  } finally {
    await attempt.release(pending, input.drive)
    // The provider executor reads the session store at the end of its stream, before any
    // teardown. A later attempt in the same environment reads that store again, longer.
    input.keepTranscript(executor.harnessTranscript?.())
    if (state.activeExecutor === executor) state.activeExecutor = undefined
    endDrive()
  }
  if (attempt.failed) throw attempt.failure
  state.managerArtifact = attempt.terminalArtifact
  if (attempt.turnFailure !== undefined) throw attempt.turnFailure
}

/** A drive with no coordination in flight needs budget left to start a turn at all. */
function assertDriverBudgetOpen(scope: Scope<unknown>, now: () => number): void {
  const initialBudget = scope.budget
  const spent = [
    exhaustedBudgetChannels(initialBudget, now()),
    initialBudget.iterationsLeft <= 0 ? 'iterations: none left' : undefined,
  ]
    .filter((channel) => channel !== undefined)
    .join('; ')
  if (spent !== '')
    throw new ValidationError(`driveHarnessFromBackend: supervisor budget exhausted (${spent})`)
}

/**
 * `supervise` passes a canonical profile plus its provider projection. Parse both at this
 * boundary and prove the projection still matches the exact descriptors mounted for this turn.
 */
function admitDriverProfiles(input: DriverAttemptInput): DriverAttemptIdentity {
  const { activeSeat, state } = input
  const canonicalProfile = agentProfileSchema.parse(input.authoredProfile)
  assertNoReservedCoordinationMcpAlias(canonicalProfile, 'driveHarnessFromBackend')
  const coordinationTools = detachedSnapshot(
    input.coordinationTools,
    'driveHarnessFromBackend coordination tools',
  )
  const expectedProviderProfile = seatProviderProfile(canonicalProfile, activeSeat)
  if (activeSeat) {
    assertExecutableAgentProfile(expectedProviderProfile, 'selected seat')
    assertBackendProfileMaterialization(
      expectedProviderProfile,
      state.boundBackend,
      'selected seat',
    )
    assertBridgeProfileMaterializes(expectedProviderProfile, state.boundBackend, 'selected seat')
  }
  const providerProfile = activeSeat
    ? expectedProviderProfile
    : agentProfileSchema.parse(input.profile)
  if (
    canonicalAgentProfileDigest(providerProfile) !==
    canonicalAgentProfileDigest(expectedProviderProfile)
  ) {
    throw new ValidationError(
      'driveHarnessFromBackend: supervisor passed a provider profile that does not match its canonical profile and mounted coordination tools',
    )
  }
  return {
    registeredProfile: input.registeredProfile,
    canonicalProfile,
    providerProfile,
    coordinationTools,
    coordinationMcpUrl: input.coordinationMcpUrl,
  }
}

/**
 * The executor factory this attempt runs on. The authored profile travels unchanged; the
 * coordination server is a Runtime-owned attachment that rides the executor's attachment seam, so
 * a resumed run that rebinds the port keeps the profile digest a durable bridge session is bound to.
 */
function reusedAttemptFactory(input: DriverAttemptInput): ExecutorFactory<unknown> | undefined {
  const backend = input.state.boundBackend
  // A bridge keys the harness conversation by session id. A fresh re-entry binds a new one,
  // derived from the owner's attempt id, which is new for every re-entry and every process.
  if (input.session === 'fresh' && input.reentry !== undefined && backend.backend === 'bridge') {
    return createExecutor(
      bindReusableExecutorExecutionId(
        backend,
        externalExecutionId('supervised-manager-session', {
          sessionId: backend.sessionId ?? input.executionId,
          attemptId: scopeOwnerExecutorNodeContext(input.scope).attemptId,
        }),
      ),
    )
  }
  return backend.backend === 'provider' ? undefined : input.baseFactory
}

/** A provider backend's factory, with the coordination attachment and its credential bound. */
async function providerAttemptFactory(
  input: DriverAttemptInput,
  providerHarness: AgentProfile['harness'],
): Promise<ExecutorFactory<unknown>> {
  const backend = input.state.boundBackend
  if (backend.backend !== 'provider') return input.baseFactory
  const { coordinationMcpUrl, coordinationMcpHeaders, peerMailUrl } = input
  const credentialName = 'AGENT_RUNTIME_COORDINATION_TOKEN'
  const authorization = coordinationMcpHeaders?.Authorization
  if (!authorization?.startsWith('Bearer ')) {
    throw new ValidationError(
      'driveHarnessFromBackend: provider coordination requires a bearer credential',
    )
  }
  if (Object.hasOwn(backend.defaults?.env ?? {}, credentialName)) {
    throw new ValidationError(
      'driveHarnessFromBackend: provider defaults contain the reserved coordination credential name',
    )
  }
  if (Object.hasOwn(backend.defaults?.runtimeAttachments?.mcp ?? {}, coordinationMcpAlias)) {
    throw new ValidationError(
      'driveHarnessFromBackend: provider defaults contain the reserved coordination attachment alias',
    )
  }
  if (
    peerMailUrl &&
    Object.hasOwn(backend.defaults?.runtimeAttachments?.mcp ?? {}, peerMailMcpAlias)
  ) {
    throw new ValidationError(
      'driveHarnessFromBackend: provider defaults contain the reserved peer-mail attachment alias',
    )
  }
  if (!(await providerAcceptsCoordinationAttachments(backend))) {
    throw new ValidationError(
      'driveHarnessFromBackend: provider does not advertise create.runtimeAttachments.mcp; no environment was created',
    )
  }
  return createExecutor({
    ...backend,
    defaults: {
      ...(backend.defaults ?? {}),
      env: {
        ...(providerHarness === 'claude-code' ? { [CLAUDE_CODE_ONE_HOUR_CACHE]: '1' } : {}),
        ...(backend.defaults?.env ?? {}),
        [credentialName]: authorization.slice(7),
      },
      runtimeAttachments: {
        mcp: {
          ...(backend.defaults?.runtimeAttachments?.mcp ?? {}),
          ...(peerMailUrl
            ? { [peerMailMcpAlias]: { transport: 'http' as const, url: peerMailUrl } }
            : {}),
          [coordinationMcpAlias]: {
            transport: 'http',
            url: coordinationMcpUrl,
            headers: {
              Authorization: { kind: 'secret-ref', key: credentialName, format: 'bearer' },
            },
            metadata: { toolTimeoutMs: COORDINATION_CLIENT_TOOL_TIMEOUT_MS },
          },
        },
      },
    },
  })
}
