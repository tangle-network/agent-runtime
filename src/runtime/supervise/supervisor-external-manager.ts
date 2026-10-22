import { ValidationError } from '../../errors'
import { errorMessage } from '../util'
import type { CoordinationMcpHandle } from './coordination-mcp'
import { attestRuntimeOwnedScopeOwner, runtimeOwnedScopeOwnerRuntime } from './materialization'
import { providerVisibleProfile } from './provider-visible-profile'
import { RunParkedError } from './run-parking'
import { detachedSnapshot } from './snapshot'
import type { SupervisorAgentDeps } from './supervisor-agent-contracts'
import {
  type ExternalManagerConfig,
  type ExternalManagerLive,
  observeManagerControls,
  openManagerSession,
} from './supervisor-manager-session'
import { driveManagerTurns, managerFinalizer } from './supervisor-manager-turns'
import type { Agent, Scope } from './types'
import { resolveWakePolicy } from './wake'

/** The values `buildSupervisorAgent` fixed for an external-harness manager. */
type ExternalManagerBuild = Omit<
  ExternalManagerConfig,
  'driveHarness' | 'deliver' | 'deliverReady' | 'wakePolicy' | 'live'
>

/** EXTERNAL arm: a caller-driven harness uses the coordination verbs over the live scope. */
export function externalSupervisorAgent(build: ExternalManagerBuild): Agent<unknown, unknown> {
  const { deps, name } = build
  const driveHarness = deps.driveHarness
  if (!driveHarness) {
    throw new ValidationError(
      `supervisorAgent: profile.harness="${build.profile.harness}" needs deps.driveHarness (how to run the harness with the coordination MCP mounted)`,
    )
  }
  const deliver = driveHarness.deliver?.bind(driveHarness)
  const rawDeliverReady = driveHarness.deliverReady
  if (rawDeliverReady !== undefined && typeof rawDeliverReady !== 'function') {
    throw new ValidationError(
      'supervisorAgent: driveHarness.deliverReady must be a function when provided',
    )
  }
  const deliverReady = rawDeliverReady?.bind(driveHarness)
  const live: ExternalManagerLive = {
    inbox: undefined,
    waitingOn: undefined,
    coordinator: undefined,
  }
  const config: ExternalManagerConfig = {
    ...build,
    driveHarness,
    deliver,
    deliverReady,
    wakePolicy: resolveWakePolicy(deps.wake),
    live,
  }
  const externalAgent: Agent<unknown, unknown> = {
    name,
    deliver(message: unknown): boolean {
      return live.inbox?.(message) ?? false
    },
    resultAccepted: () => Boolean(live.coordinator?.submittedResult()),
    traceSource: () => driveHarness.traceSource?.(),
    progress: () => {
      const harnessProgress = driveHarness.progress?.()
      const waitingOn = live.waitingOn
      if (waitingOn === undefined) return harnessProgress
      return {
        ...harnessProgress,
        note: `waiting for ${waitingOn} worker${waitingOn === 1 ? '' : 's'}; Runtime wakes it when one reports`,
      }
    },
    // Present only when the harness has a transcript port, so an absent one still settles as
    // `executor-exposes-no-transcript` rather than as a capture that did not run.
    ...(driveHarness.harnessTranscript
      ? { harnessTranscript: () => driveHarness.harnessTranscript?.() }
      : {}),
    ...(driveHarness.harnessTranscriptSettled
      ? {
          harnessTranscriptSettled: () =>
            driveHarness.harnessTranscriptSettled?.() ?? Promise.resolve(),
        }
      : {}),
    act: (task, scope) => actExternalManager(config, task, scope),
  }
  const runtime = runtimeOwnedScopeOwnerRuntime(driveHarness)
  return runtime === undefined
    ? externalAgent
    : attestRuntimeOwnedScopeOwner(externalAgent, runtime)
}

/** One `act`: serve coordination, drive the harness through its turns, settle what it produced. */
async function actExternalManager(
  config: ExternalManagerConfig,
  task: unknown,
  scope: Scope<unknown>,
): Promise<unknown> {
  const { deps } = config
  const session = await openManagerSession(config, task, scope)
  const { mcp, state } = session
  const coordinationTools = state.slot.descriptors()
  const providerProfile = detachedSnapshot(
    providerVisibleProfile(config.profile),
    'supervisorAgent provider-visible profile',
  )
  let controlObserver: ReturnType<typeof observeManagerControls>
  try {
    controlObserver = observeManagerControls(config, session)
    // A restored `submission` record proves this manager's completion check already accepted
    // the value. Return it before starting another harness process.
    const recoveredSubmission = mcp.submittedResult()
    if (recoveredSubmission) {
      deps.onAcceptedSubmission?.(recoveredSubmission.result)
      return recoveredSubmission.result
    }
    const contractDeclared = deps.deliverable !== undefined
    const finalize = managerFinalizer(deps, session)
    const candidate = await driveManagerTurns({
      config,
      session,
      contractDeclared,
      finalize,
      coordinationTools,
      providerProfile,
    })
    return await settleManagerOutput(config, mcp, contractDeclared, finalize, candidate)
  } catch (error) {
    if (error instanceof RunParkedError && error.runId === scope.view.root) throw error
    await mcp.finishAnalysis({
      status: 'down',
      reason: errorMessage(error),
    })
    throw error
  } finally {
    config.live.inbox = undefined
    state.nextTurnInbox.failPending('the manager finished before a turn read the message')
    state.coordinationLifetime.abort(new Error('supervisor manager stopped'))
    try {
      await controlObserver?.close()
    } finally {
      await mcp.close()
    }
  }
}

/** Return the manager's output in eligibility order, closing its analysis with it. */
async function settleManagerOutput(
  config: ExternalManagerConfig,
  mcp: CoordinationMcpHandle,
  contractDeclared: boolean,
  finalize: () => Promise<unknown>,
  candidate: unknown,
): Promise<unknown> {
  const deps: SupervisorAgentDeps = config.deps
  // Without a parent oracle, preserve the single finalization after the driver finishes.
  if (!contractDeclared) await mcp.drainResolved()
  // Direct work is eligible only through `submit_result`, after the injected independent
  // check passes. Raw harness prose remains ineligible.
  const submitted = mcp.submittedResult()
  if (submitted) {
    deps.onAcceptedSubmission?.(submitted.result)
    await mcp.finishAnalysis({ status: 'done', output: submitted.result })
    return submitted.result
  }
  if (contractDeclared) {
    await mcp.finishAnalysis({ status: 'done', output: candidate })
    return candidate
  }
  const finalized = await finalize()
  if (finalized !== undefined) {
    await mcp.finishAnalysis({ status: 'done', output: finalized })
    return finalized
  }
  // An unchecked child may do direct work. Retain its terminal report through the same
  // settlement and blob reader, without treating native completion as quality acceptance.
  const harnessResult = config.driveHarness.resultArtifact?.()
  if (
    config.nodeContextSeed !== undefined &&
    config.nodeContextSeed.depth > 0 &&
    harnessResult?.out !== undefined &&
    harnessResult.out !== null
  ) {
    deps.onUnassessedOutput?.(harnessResult.out)
    await mcp.finishAnalysis({ status: 'done', output: harnessResult.out })
    return harnessResult.out
  }
  await mcp.finishAnalysis({ status: 'done' })
  return undefined
}
