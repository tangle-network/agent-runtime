import { agentProfileSchema } from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import { agentHarness } from '../harness-role'
import type { ToolLoopChat } from '../tool-loop'
import { admitContinuationPolicy } from './continuation'
import type { PriorCoordination } from './coordination-log'
import { driverAgent } from './driver-brain-agent'
import { isRuntimeFlowBrain, runtimeFlowAgent } from './flow-brain'
import { createInbox } from './inbox'
import { assertExecutableAgentProfile } from './model-policy'
import { coordinationProfileToolPrefix } from './provider-visible-profile'
import { createRouterTranscript } from './router-transcript'
import { detachedSnapshot } from './snapshot'
import type {
  CoordinationBinding,
  SupervisorAgentDeps,
  SupervisorNodeContextSeed,
} from './supervisor-agent-contracts'
import {
  assertNoReservedCoordinationMcpAlias,
  assertRouterArmResourcePolicy,
  declaredRuntimeToolNames,
  ownSubmissionDeliverable,
  resolveSupervisorModelId,
  resolveSupervisorSystemPrompt,
  runtimeToolDeclarationError,
  type SupervisorProfile,
} from './supervisor-agent-profile'
import { supervisorCoordinationObservers } from './supervisor-coordination-observers'
import { externalSupervisorAgent } from './supervisor-external-manager'
import {
  assertCoordinationBinding,
  routerBrainFromProfile,
  snapshotRouterTransportConfig,
} from './supervisor-router-config'
import {
  bindSupervisorNodeObserver,
  bindSupervisorTools,
  createVerbSlot,
  supervisorNodeContext,
  type VerbSlot,
} from './supervisor-tool-binding'
import type { Agent } from './types'

export function buildSupervisorAgent(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
  testBrain?: ToolLoopChat,
): Agent<unknown, unknown> {
  const exactProfile = agentProfileSchema.parse(profile)
  if (!testBrain || !isRuntimeFlowBrain(testBrain))
    assertExecutableAgentProfile(exactProfile, 'supervisorAgent')
  const stableProfile = detachedSnapshot(exactProfile, 'supervisorAgent profile')
  const registeredProfile =
    deps.registeredProfile === undefined
      ? stableProfile
      : detachedSnapshot(
          agentProfileSchema.parse(deps.registeredProfile),
          'supervisorAgent registered profile',
        )
  const stableRouter =
    deps.router === undefined ? undefined : snapshotRouterTransportConfig(deps.router)
  const resolveTools = deps.resolveSupervisorTools
  assertNoReservedCoordinationMcpAlias(stableProfile, 'supervisorAgent')
  const harness = agentHarness(stableProfile.harness) ?? null
  // `extraTools` is mounted only by the router tool-loop. An external harness receives product
  // tools only through its coordination MCP, so it must have a node-scoped resolver instead.
  const runtimeToolError = runtimeToolDeclarationError(
    stableProfile,
    resolveTools !== undefined,
    harness === null ? deps.extraTools?.map((tool) => tool.name) : undefined,
  )
  if (runtimeToolError !== undefined) {
    throw new ValidationError(`supervisorAgent: ${runtimeToolError}`)
  }
  const observeNodeEvent = deps.observeNodeEvent
  const nodeContextSeed =
    deps.nodeContext === undefined
      ? undefined
      : detachedSnapshot(deps.nodeContext, 'supervisorAgent node context')
  if ((resolveTools || observeNodeEvent) && !nodeContextSeed) {
    throw new ValidationError(
      'supervisorAgent: nodeContext is required with resolveSupervisorTools or observeNodeEvent',
    )
  }
  const name = stableProfile.name ?? 'supervisor'
  // The prompt is consumed by BOTH arms so it resolves here; the model id is router-arm-only and
  // resolves there. No fallback: both arms get only the prompt and instruction bytes the profile declares.
  const profilePrompt = resolveSupervisorSystemPrompt(stableProfile)
  const runtimeToolNames = declaredRuntimeToolNames(stableProfile)

  // Bind safety is a BUILD-time fault: throw before any compute, on the synchronous path of the
  // other guards. The binding is SNAPSHOT here and that snapshot is both checked and bound by
  // `act()`, so a later mutation of `deps.coordination` cannot slip an unchecked host past.
  const coordination: CoordinationBinding | undefined = deps.coordination
    ? { ...deps.coordination }
    : undefined
  assertCoordinationBinding(coordination)

  assertSupervisorArmPolicy(harness, deps, runtimeToolNames, coordination)
  const continuationDeadlineMs =
    deps.continuation === undefined
      ? undefined
      : admitContinuationPolicy(deps.continuation, 'supervisorAgent')

  if (harness === null) {
    const agent = routerSupervisorAgent({
      name,
      deps,
      profile: stableProfile,
      runtimeToolNames,
      nodeContextSeed,
      testBrain,
      router: stableRouter,
      resolveTools,
      observeNodeEvent,
    })
    return runtimeFlowAgent(agent, testBrain)
  }
  return externalSupervisorAgent({
    name,
    deps,
    profile: stableProfile,
    registeredProfile,
    profilePrompt,
    runtimeToolNames,
    nodeContextSeed,
    coordination,
    continuationDeadlineMs,
    resolveTools,
    observeNodeEvent,
  })
}

/** Refuse a dependency that the profile's arm would silently ignore, before any compute. */
function assertSupervisorArmPolicy(
  harness: string | null,
  deps: SupervisorAgentDeps,
  runtimeToolNames: ReadonlyArray<string>,
  coordination: CoordinationBinding | undefined,
): void {
  if (harness === null && coordination !== undefined) {
    throw new ConfigError(
      'supervisorAgent: coordination binding is only meaningful for a harness-brained supervisor ' +
        '(profile.harness set). A router-brained supervisor calls the coordination verbs in ' +
        'process and serves no MCP, so this binding would be silently ignored.',
    )
  }

  if (harness === null && deps.peerMail) {
    throw new ValidationError(
      'supervisorAgent: peerMail is only served by a harness-brained supervisor ' +
        '(profile.harness set). A router-brained supervisor serves no coordination MCP listener, ' +
        'so there is no peer-mail post office to mint worker capabilities from.',
    )
  }

  if (harness !== null && deps.compaction) {
    throw new ValidationError(
      'supervisorAgent: compaction is only supported for router-brained supervisors (profile.harness omitted or cli-base)',
    )
  }

  if (harness === null && deps.continuation !== undefined) {
    throw new ValidationError(
      'supervisorAgent: continuation applies to an EXTERNAL-harness supervisor only (profile.harness ' +
        'set). A router-brained supervisor runs its own turn loop in process, so the policy would ' +
        'be silently ignored.',
    )
  }
  if (deps.continuation !== undefined && deps.deliverable === undefined) {
    throw new ValidationError(
      'supervisorAgent: continuation needs a `deliverable` completion check — with no check there ' +
        'is no contract that can be unmet',
    )
  }
  if (
    harness !== null &&
    deps.deliverable !== undefined &&
    deps.deliverable !== ownSubmissionDeliverable &&
    deps.continuation === undefined
  ) {
    throw new ValidationError(
      'supervisorAgent: a manager with a completion check needs a continuation policy (deadline, ' +
        'maxBarren, the note profile and switches). Runtime supplies no default: how long to send ' +
        "a director back, and what to tell it, is the record's decision",
    )
  }
  // One way out: a manager with a check ends when the check passes or when a bound ends it.
  // Refused before any compute, on both arms.
  if (deps.deliverable !== undefined && runtimeToolNames.includes('stop')) {
    throw new ValidationError(
      `supervisorAgent: the profile grants ${coordinationProfileToolPrefix}stop to a manager with a ` +
        'completion check. Such a manager ends only through submit_result (the check passes) or a ' +
        'bound (deadline, budget, cancellation, no progress); remove stop from its tools',
    )
  }
}

interface RouterSupervisorBuild {
  readonly name: string
  readonly deps: SupervisorAgentDeps
  readonly profile: SupervisorProfile
  readonly runtimeToolNames: ReadonlyArray<string>
  readonly nodeContextSeed: SupervisorNodeContextSeed | undefined
  readonly testBrain: ToolLoopChat | undefined
  readonly router: ReturnType<typeof snapshotRouterTransportConfig> | undefined
  readonly resolveTools: SupervisorAgentDeps['resolveSupervisorTools']
  readonly observeNodeEvent: SupervisorAgentDeps['observeNodeEvent']
}

/**
 * ROUTER arm: the in-process tool-loop. `routerBrain` is an internal detail — a production caller
 * passes a profile, never a hand-built brain. Deterministic source tests use the separately
 * exported `/testing` constructor.
 */
function routerSupervisorAgent(arm: RouterSupervisorBuild): Agent<unknown, unknown> {
  const { name, deps, profile: stableProfile, runtimeToolNames, nodeContextSeed, testBrain } = arm
  const { resolveTools, observeNodeEvent } = arm
  assertRouterArmResourcePolicy(stableProfile)
  const brain = testBrain ?? routerBrainFromProfile(stableProfile, arm.router)
  const inbox = createInbox()
  // One conversation per agent, whichever driver `act` builds for an attempt.
  const transcript = createRouterTranscript()
  const build = (
    priorCoordination?: PriorCoordination,
    nodeTools?: ReadonlyArray<McpToolDescriptor>,
    onEvent?: SupervisorAgentDeps['onEvent'],
    slot?: VerbSlot,
  ) =>
    driverAgent({
      name,
      brain,
      transcript,
      ...(testBrain === undefined
        ? { expectedModel: resolveSupervisorModelId(stableProfile) }
        : {}),
      ...(deps.onProviderModel ? { onProviderModel: deps.onProviderModel } : {}),
      blobs: deps.blobs,
      makeWorkerAgent: deps.makeWorkerAgent,
      ...(deps.graphs ? { graphs: deps.graphs } : {}),
      ...(deps.authorizeDownMessage ? { authorizeDownMessage: deps.authorizeDownMessage } : {}),
      perWorker: deps.perWorker,
      ...(deps.preserveOwnerTurns ? { preserveOwnerTurns: true as const } : {}),
      // An omitted prompt means no standing system text. Runtime executes the exact profile and
      // never chooses a research policy for it.
      systemPrompt: resolveSupervisorSystemPrompt(stableProfile) ?? '',
      ...(deps.deliverable ? { deliverable: deps.deliverable } : {}),
      ...(deps.onAcceptedSubmission ? { onAcceptedSubmission: deps.onAcceptedSubmission } : {}),
      toolNames: runtimeToolNames,
      ...(nodeTools?.length ? { nodeTools } : {}),
      ...(deps.extraTools ? { extraTools: deps.extraTools } : {}),
      ...(deps.executeExtraTool ? { executeExtraTool: deps.executeExtraTool } : {}),
      ...supervisorCoordinationObservers(deps),
      ...(deps.routeFlow ? { routeFlow: deps.routeFlow } : {}),
      ...(deps.decideGate ? { decideGate: deps.decideGate } : {}),
      ...(deps.wake !== undefined ? { wake: deps.wake } : {}),
      ...(deps.continuityByProfile ? { continuityByProfile: deps.continuityByProfile } : {}),
      ...(deps.preflightSpawn ? { preflightSpawn: deps.preflightSpawn } : {}),
      ...(deps.resolveSpawnProfile ? { resolveSpawnProfile: deps.resolveSpawnProfile } : {}),
      ...(deps.composeSpawnProfile ? { composeSpawnProfile: deps.composeSpawnProfile } : {}),
      ...(deps.profiles ? { profiles: deps.profiles } : {}),
      ...(deps.spawnResourceRoot ? { spawnResourceRoot: deps.spawnResourceRoot } : {}),
      ...(deps.spawnResourceReader ? { spawnResourceReader: deps.spawnResourceReader } : {}),
      ...(deps.stopRule ? { stopRule: deps.stopRule } : {}),
      ...(deps.onProgressStop ? { onProgressStop: deps.onProgressStop } : {}),
      ...(deps.maxTurns !== undefined ? { maxTurns: deps.maxTurns } : {}),
      ...(deps.compaction ? { compaction: deps.compaction } : {}),
      ...(onEvent ? { onEvent } : {}),
      ...(deps.replaySettlements ? { replaySettlements: true } : {}),
      ...(priorCoordination ? { priorCoordination } : {}),
      ...(deps.finalizer ? { finalizer: deps.finalizer } : {}),
      ...(slot
        ? { onCoordinationTools: (tools, coordination) => slot.bind(tools, coordination) }
        : {}),
      ...(deps.controlDir === undefined ? {} : { controlDir: deps.controlDir }),
      ...(deps.steerDir === undefined ? {} : { steerDir: deps.steerDir }),
      ...(deps.controlScope === undefined ? {} : { controlScope: deps.controlScope }),
      ...(deps.abortRun ? { abortRun: deps.abortRun } : {}),
      inbox,
    })
  if (!deps.loadPriorCoordination && !resolveTools && !observeNodeEvent) {
    return build(deps.priorCoordination, undefined, deps.onEvent)
  }
  return {
    name,
    deliver(message): boolean {
      return inbox.deliver(message)
    },
    harnessTranscript: () => transcript.capture(),
    async act(task, scope) {
      const context = nodeContextSeed
        ? supervisorNodeContext(nodeContextSeed, stableProfile, task, scope)
        : undefined
      const priorCoordination = await deps.loadPriorCoordination?.()
      // Filled by `driverAgent` the moment it builds this manager's coordination tools, which
      // is after the product tools are bound — hence the slot rather than a value.
      const slot = createVerbSlot()
      const nodeTools =
        resolveTools && context
          ? await bindSupervisorTools(resolveTools, context, scope.signal, slot)
          : undefined
      const onEvent = bindSupervisorNodeObserver(context, observeNodeEvent, deps.onEvent)
      return build(priorCoordination, nodeTools, onEvent, slot).act(task, scope)
    },
  }
}
