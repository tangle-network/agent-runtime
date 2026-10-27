import { AgentTurnInputSchema } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { exactSession } from '../retained-run-binding'
import {
  assertRetainedRunReplayMaterial,
  mintRetainedIdentity,
  reconnectRetainedRun,
  recoverRetainedRun,
  startRetainedRun,
} from '../retained-run-start'
import type { RetainedRunHandle } from '../retained-run-types'
import { RetainedExecutionPendingError } from '../supervise/retained-executor'
import { verifyWorkspaceMarker } from '../supervise/workspace-checkpoint'
import type { StreamProviderExecutorArgs } from './provider-invocation'
import { type RetainedAwaitingResult, RetainedObservation } from './provider-retained-observation'
import {
  assertRuntimeMcpAttachments,
  hasRuntimeMcpAttachments,
  subscriptionTurnProfile,
} from './provider-turn-input'

type Retention = NonNullable<StreamProviderExecutorArgs['retention']>
type RetentionAdmission = Parameters<Retention['onAdmission']>[0]
type RetainedMaterial = ReturnType<typeof retainedDispatchMaterial>['material']

/** What the journal already proves about this dispatch, which decides how a failure classifies. */
interface AdmissionProof {
  admitted: boolean
  executionAdmitted: boolean
}

/** The environment, turn and identity a retained dispatch creates or replays. */
function retainedDispatchMaterial(
  args: StreamProviderExecutorArgs,
  retention: Retention,
  selectedTurn: AgentTurnInput,
  signal: AbortSignal,
) {
  const priorSession = retention.priorSession
  const environmentKey = priorSession?.idempotencyKey ?? `runtime:${args.executionId}`
  const turnId = `${args.executionId}:turn:0`
  // A new environment that replaces one the provider lost starts from its latest checkpoint, so
  // the re-entered manager keeps its files. An environment that is continued needs none.
  const restore = priorSession === undefined ? retention.restoreWorkspace : undefined
  const material = {
    environment: {
      ...args.options.defaults,
      ...(restore === undefined
        ? {}
        : { workspace: { ...args.options.defaults?.workspace, checkpoint: restore.checkpoint } }),
      profile: args.createProfile,
      idempotencyKey: environmentKey,
      signal,
    },
    turn: { ...selectedTurn, turnId },
    preserveEnvironment: retention.preserveEnvironment,
    ...(priorSession === undefined
      ? {}
      : {
          existingEnvironmentId: priorSession.environmentId,
          // A new session in the same environment is minted from this invocation's own keys,
          // exactly as a first invocation's is, so a recovery replays the same identity.
          identity: {
            sessionId: retention.newSession
              ? mintRetainedIdentity(environmentKey, turnId).sessionId
              : priorSession.sessionId,
            executionId: mintRetainedIdentity(environmentKey, turnId).executionId,
          },
        }),
  }
  return { material, restore, turnId }
}

/** A recovery replays only the intent's exact material; a new turn may carry the selected profile. */
function assertReplayMaterial(
  args: StreamProviderExecutorArgs,
  material: RetainedMaterial,
  intent: Extract<RetentionAdmission, { phase: 'intent' }>,
  turn: AgentTurnInput,
  selectedTurn: AgentTurnInput,
  turnId: string,
): void {
  try {
    assertRetainedRunReplayMaterial(args.provider, material, intent)
  } catch (error) {
    if (selectedTurn === turn) throw error
    // An older admission may have relied on the create-time profile. Only
    // its exact original material may replay; a new turn uses the profile.
    const original = { ...material, turn: { ...turn, turnId } }
    assertRetainedRunReplayMaterial(args.provider, original, intent)
    material.turn = original.turn
  }
}

/** Reconnect, recover or start the retained run, whichever the journal's admissions call for. */
async function acquireRetainedHandle(
  args: StreamProviderExecutorArgs,
  retention: Retention,
  material: RetainedMaterial,
  onAdmission: (admission: RetentionAdmission) => Promise<void>,
  turnInputs: { turn: AgentTurnInput; selectedTurn: AgentTurnInput; turnId: string },
): Promise<RetainedRunHandle> {
  const admissions = retention.admissions
  const dispatched = [...admissions].reverse().find((admission) => admission.phase === 'dispatched')
  const intent = admissions.find((admission) => admission.phase === 'intent')
  // A journaled execution input can precede the first provider admission. In that case
  // no provider call happened: onAdmission(intent) is awaited before create/dispatch.
  // Start with the original execution keys; once any admission exists, validate its intent.
  if (args.recovering && admissions.length > 0) {
    if (!intent) throw new Error('retained provider execution has no original intent')
    assertReplayMaterial(
      args,
      material,
      intent,
      turnInputs.turn,
      turnInputs.selectedTurn,
      turnInputs.turnId,
    )
  }
  if (args.recovering && dispatched?.phase === 'dispatched') {
    const reconnected = await reconnectRetainedRun({
      provider: args.provider,
      controlRef: dispatched.controlRef,
    })
    if (!reconnected) throw new Error('retained provider environment is unavailable')
    return reconnected
  }
  // Without a dispatched reference, replay the validated intent with its original keys.
  // An environment admission alone does not require a selected backend or prove absence.
  if (args.recovering && intent?.phase === 'intent') {
    const recovered = await recoverRetainedRun({
      provider: args.provider,
      admission: intent,
      replay: material,
      onAdmission,
    })
    if (recovered.outcome !== 'recovered')
      throw new Error(`retained provider execution is ${recovered.outcome}`)
    return recovered.handle
  }
  if (args.recovering && admissions.length > 0)
    throw new Error('retained provider execution has no durable admission')
  return startRetainedRun({ provider: args.provider, ...material, onAdmission })
}

/** One retained dispatch owns creation, replay, result identity, and cancellation. */
async function retainedExecution(
  args: StreamProviderExecutorArgs,
  retention: Retention,
  turn: AgentTurnInput,
  selectedTurn: AgentTurnInput,
  signal: AbortSignal,
) {
  const proof: AdmissionProof = {
    admitted: args.recovering,
    executionAdmitted:
      args.recovering && retention.admissions.some((admission) => admission.phase === 'dispatched'),
  }
  const onAdmission = async (admission: RetentionAdmission) => {
    if (admission.phase === 'dispatched') proof.executionAdmitted = true
    await retention.onAdmission(admission)
    proof.admitted = true
    args.scope.state.pending = true
  }
  const { material, restore, turnId } = retainedDispatchMaterial(
    args,
    retention,
    selectedTurn,
    signal,
  )
  try {
    const handle = await acquireRetainedHandle(args, retention, material, onAdmission, {
      turn,
      selectedTurn,
      turnId,
    })
    proof.executionAdmitted = true
    args.onRetained(handle)
    args.scope.state.pending = true
    const environment = await args.provider.get?.(handle.controlRef.environmentId)
    if (!environment) throw new Error('retained provider environment is unavailable')
    if (restore !== undefined && !args.recovering) {
      // The provider restores a checkpoint or fails the create; the marker Runtime wrote before
      // the checkpoint is the evidence it did, journaled before the turn's result is judged.
      const found = await verifyWorkspaceMarker(environment, restore.marker, signal)
      await retention.onWorkspaceRestored?.({
        environmentId: environment.id,
        checkpoint: restore.checkpoint,
        ...found,
      })
    }
    const session = exactSession(environment, handle.controlRef).session
    const events = new RetainedObservation(handle, signal).observe(session)
    return { environment, events, retained: true }
  } catch (error) {
    // A durable dispatch or exact reattachment proves execution admission before observation starts.
    if (proof.admitted)
      throw new RetainedExecutionPendingError(
        error,
        proof.executionAdmitted ? 'execution' : 'admission',
      )
    throw error
  }
}

export async function providerExecutionSource(
  args: StreamProviderExecutorArgs,
  turn: AgentTurnInput,
  signal: AbortSignal,
): Promise<{
  environment: AgentEnvironment
  events: AsyncIterable<AgentEnvironmentEvent | RetainedAwaitingResult>
  retained: boolean
}> {
  const selectedTurn = subscriptionTurnProfile(turn, args.profile)
  AgentTurnInputSchema.parse(selectedTurn)
  const needsMcp = hasRuntimeMcpAttachments(args.options.defaults)
  const capabilities = args.retention || needsMcp ? await args.provider.capabilities() : undefined
  assertRuntimeMcpAttachments(args.provider.name, args.options.defaults, capabilities)
  if (args.retention !== undefined && capabilities?.retainedControl !== undefined) {
    return retainedExecution(args, args.retention, turn, selectedTurn, signal)
  }
  if (args.recovering)
    throw new Error(`provider ${args.provider.name} cannot recover retained executions`)
  const environment = await args.provider.create({
    ...args.options.defaults,
    profile: args.createProfile,
    signal,
  })
  return { environment, events: environment.stream(selectedTurn), retained: false }
}
