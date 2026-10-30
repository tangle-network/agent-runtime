import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  mergeProxySecretBindings,
} from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import { ValidationError } from '../../errors'
import { COORDINATION_CLIENT_TOOL_TIMEOUT_MS } from '../../mcp/tools/coordination-request-context'
import { resolveAgentEnvironmentProvider } from '../environment-provider/provider-registry'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import { isAsyncIterable, zeroSpend } from '../util'
import { coordinationBindingHost } from './coordination-mcp'
import { type DriverAttemptIdentity, DriverExecutionAttempt } from './driver-execution-attempt'
import { seatProviderProfile } from './manager-drive-session'
import { runtimeOwnedPendingExecutorMaterialization } from './materialization'
import { assertExecutableAgentProfile } from './model-policy'
import { retainedExecutorSeamKey } from './retained-executor'
import { assertRetainedOwnerCoordinationRekey } from './retained-owner-environment-recovery'
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
  coordinationRuntimeAttachment,
  peerMailMcpAlias,
  peerMailRuntimeAttachment,
  storeCoordinationSecret,
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
  UsageEvent,
} from './types'

interface DriverAttemptInput extends Omit<Parameters<DriveHarness>[0], 'task' | 'systemPrompt'> {
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
  if (!(scope.view.inFlight > 0)) {
    const spent =
      exhaustedBudgetChannels(scope.budget, input.now()) ??
      (scope.budget.iterationsLeft <= 0 ? 'iterations: none left' : undefined)
    if (spent)
      throw new ValidationError(`driveHarnessFromBackend: supervisor budget exhausted (${spent})`)
  }
  const identity = admitDriverProfiles(input)
  const spec: AgentSpec = {
    profile: identity.providerProfile,
    harness:
      state.boundBackend.backend === 'sandbox'
        ? (identity.providerProfile.harness as BackendType)
        : null,
  }
  const turnStop = turnCap > 0 ? new AbortController() : undefined
  const budgetStop = new AbortController()
  const stopSignal = AbortSignal.any(
    [input.stopSignal, turnStop?.signal, budgetStop.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    ),
  )
  const peerMailAttachment = peerMailRuntimeAttachment(input.authoredProfile, state.boundBackend, {
    peerMailUrl: input.peerMailUrl,
  })
  const attachment = {
    transport: 'http' as const,
    url: input.coordinationMcpUrl,
    ...(input.coordinationMcpHeaders ? { headers: input.coordinationMcpHeaders } : {}),
    metadata: { toolTimeoutMs: COORDINATION_CLIENT_TOOL_TIMEOUT_MS },
  }
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
      ...(state.boundBackend.backend === 'provider'
        ? {}
        : {
            [bridgeRuntimeAttachmentsKey]: {
              ...(peerMailAttachment ?? {}),
              [coordinationMcpAlias]: attachment,
            },
          }),
    },
  })
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
  const endDrive = retainedOwner ? beginScopeRetainedOwnerDrive(scope) : () => {}
  try {
    await attempt.admit(pending)
    attempt.started = true
    if (retainedOwner?.admissions.length && !executor.recover) {
      throw new ValidationError('retained owner executor does not support recovery')
    }
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
    input.keepTranscript(executor.harnessTranscript?.())
    if (state.activeExecutor === executor) state.activeExecutor = undefined
    endDrive()
  }
  if (attempt.failed) throw attempt.failure
  state.managerArtifact = attempt.terminalArtifact
  if (attempt.turnFailure !== undefined) throw attempt.turnFailure
}

/** Validate the canonical profile and its provider projection against the mounted tools. */
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

/** Resume with unchanged profile identity and a fresh runtime attachment. */
function reusedAttemptFactory(input: DriverAttemptInput): ExecutorFactory<unknown> | undefined {
  const backend = input.state.boundBackend
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

/** Bind coordination through the provider's host-held secret manager or isolated turn transport. */
async function providerAttemptFactory(
  input: DriverAttemptInput,
  providerHarness: AgentProfile['harness'],
): Promise<ExecutorFactory<unknown>> {
  const backend = input.state.boundBackend
  if (backend.backend !== 'provider') return input.baseFactory
  const { coordinationMcpUrl, coordinationMcpHeaders, peerMailUrl } = input
  const authorization = coordinationMcpHeaders?.Authorization
  if (!authorization?.startsWith('Bearer ') || authorization.length === 7)
    throw new ValidationError('provider coordination requires a bearer credential')
  if (
    !Number.isSafeInteger(input.coordinationCredentialExpiresAt) ||
    input.coordinationCredentialExpiresAt! <= Date.now()
  )
    throw new ValidationError('provider coordination credential has no finite future expiry')
  const provider = resolveAgentEnvironmentProvider(backend.provider, backend.registry)
  const host = coordinationBindingHost(coordinationMcpUrl, providerHarness)
  const credentialName =
    'AGENT_RUNTIME_COORDINATION_TOKEN_' +
    canonicalCandidateDigest([input.executionId, provider.name, host ?? 'isolated'])
      .slice(7, 31)
      .toUpperCase()
  const defaults = backend.defaults ?? {}
  if (
    Object.keys(defaults.env ?? {}).some((name) =>
      name.startsWith('AGENT_RUNTIME_COORDINATION_TOKEN'),
    )
  )
    throw new ValidationError('provider defaults contain a reserved coordination credential name')
  for (const mcp of [
    defaults.runtimeAttachments?.mcp,
    backend.promptOptions?.backend?.runtimeAttachments?.mcp,
  ]) {
    if (
      Object.hasOwn(mcp ?? {}, coordinationMcpAlias) ||
      (peerMailUrl && Object.hasOwn(mcp ?? {}, peerMailMcpAlias))
    )
      throw new ValidationError('provider defaults contain a reserved runtime attachment alias')
  }
  if ((await provider.capabilities()).create?.runtimeAttachments?.mcp !== true)
    throw new ValidationError('provider lacks create.runtimeAttachments.mcp')
  if (host) {
    if (
      input.retainedOwner?.admissions.length &&
      !input.coordinationCredentialSigned &&
      !input.state.coordinationSecrets?.has(credentialName)
    )
      await assertRetainedOwnerCoordinationRekey(input.scope)
    input.state.coordinationSecrets ??= new Map()
    await storeCoordinationSecret(
      provider,
      input.state.coordinationSecrets,
      credentialName,
      input.coordinationBindCredential,
    )
    input.scope.signal.throwIfAborted()
  }
  const attachment = coordinationRuntimeAttachment(coordinationMcpUrl, credentialName)
  const coordinated: Extract<typeof backend, { backend: 'provider' }> = {
    ...backend,
    defaults: {
      ...defaults,
      runtimeAttachments: {
        mcp: {
          ...defaults.runtimeAttachments?.mcp,
          ...(peerMailUrl ? { [peerMailMcpAlias]: { transport: 'http', url: peerMailUrl } } : {}),
          ...(host ? { [coordinationMcpAlias]: attachment } : {}),
        },
      },
    },
  }
  if (providerHarness === 'claude-code')
    coordinated.defaults!.env = {
      [CLAUDE_CODE_ONE_HOUR_CACHE]: '1',
      ...defaults.env,
    }
  if (host)
    coordinated.defaults!.proxySecrets = mergeProxySecretBindings(defaults.proxySecrets, [
      {
        envName: credentialName,
        secretRef: { kind: 'secret-ref', key: credentialName },
        hosts: [host],
        presentation: { type: 'bearer' },
      },
    ])
  else {
    const turn = backend.promptOptions?.backend ?? {}
    coordinated.promptOptions = {
      ...backend.promptOptions,
      backend: {
        ...turn,
        runtimeSecrets: { ...turn.runtimeSecrets, [credentialName]: authorization.slice(7) },
        runtimeAttachments: {
          mcp: { ...turn.runtimeAttachments?.mcp, [coordinationMcpAlias]: attachment },
        },
      },
    }
  }
  return createExecutor(coordinated)
}
