import { ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import type { CoordinationTools } from '../../mcp/tools/coordination-contracts'
import { createCoordinationTools } from '../../mcp/tools/coordination-manager'
import type { ToolSpec } from '../router-request-body'
import type { DriverAgentOptions } from './driver-agent-options'
import { scopeRetainedOwnerResourceReader } from './retained-scope-owner'
import type { Scope } from './types'

/** The tools one driver turn loop runs with: the live coordination verbs and the granted set. */
export interface DriverToolSurface {
  readonly coord: CoordinationTools
  /** Every granted tool name, in grant order. */
  readonly toolNames: ReadonlyArray<string>
  /** The granted work tools the driver runs itself. */
  readonly extraNames: ReadonlySet<string>
  /** The granted coordination and node tools, by name. */
  readonly byName: ReadonlyMap<string, McpToolDescriptor>
  /** What the model is told it may call. */
  readonly toolSpecs: ToolSpec[]
}

/** Mount this manager's coordination tools over `scope` and select exactly the granted tools. */
export async function openDriverToolSurface(
  opts: DriverAgentOptions,
  scope: Scope<unknown>,
): Promise<DriverToolSurface> {
  // The manager's own environment serves a by-path spawn resource when no host directory does.
  // Every scope registers a retained owner, so the reader is derivable for root and nested managers
  // alike, resolving its environment lazily (admitted during the first turn, after these tools exist).
  // Precedence: a caller-supplied reader; a host directory (a loopback bridge root has one and no
  // provider environment, so its owner reader would refuse every read); the scope's environment.
  const ownerReader =
    opts.spawnResourceReader ??
    (opts.spawnResourceRoot === undefined ? scopeRetainedOwnerResourceReader(scope) : undefined)
  let probeableByName: ReadonlyMap<string, McpToolDescriptor> | undefined
  const coord = createCoordinationTools({
    scope,
    blobs: opts.blobs,
    makeWorkerAgent: opts.makeWorkerAgent,
    ...(opts.graphs ? { graphs: opts.graphs } : {}),
    ...(opts.authorizeDownMessage ? { authorizeDownMessage: opts.authorizeDownMessage } : {}),
    perWorker: opts.perWorker,
    ...(opts.deliverable ? { deliverable: opts.deliverable } : {}),
    ...(opts.analysts ? { analysts: opts.analysts } : {}),
    ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
    ...(opts.mapOnSettle ? { mapOnSettle: opts.mapOnSettle } : {}),
    ...(opts.routeFlow ? { routeFlow: opts.routeFlow } : {}),
    ...(opts.decideGate ? { decideGate: opts.decideGate } : {}),
    ...(opts.sourceEvidenceRefs ? { sourceEvidenceRefs: opts.sourceEvidenceRefs } : {}),
    ...(opts.peerAudit ? { peerAudit: opts.peerAudit } : {}),
    ...(opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {}),
    ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
    ...(opts.continuityByProfile ? { continuityByProfile: opts.continuityByProfile } : {}),
    ...(opts.preflightSpawn ? { preflightSpawn: opts.preflightSpawn } : {}),
    ...(opts.resolveSpawnProfile ? { resolveSpawnProfile: opts.resolveSpawnProfile } : {}),
    ...(opts.composeSpawnProfile ? { composeSpawnProfile: opts.composeSpawnProfile } : {}),
    ...(opts.profiles ? { profiles: opts.profiles } : {}),
    ...(opts.spawnResourceRoot ? { spawnResourceRoot: opts.spawnResourceRoot } : {}),
    ...(ownerReader ? { spawnResourceReader: ownerReader } : {}),
    ...(opts.escalateQuestion ? { escalateQuestion: opts.escalateQuestion } : {}),
    ...(opts.onChildQuestionInbox ? { onChildQuestionInbox: opts.onChildQuestionInbox } : {}),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.replaySettlements ? { replaySettlements: true } : {}),
    ...(opts.priorCoordination?.questions.length
      ? { priorQuestions: opts.priorCoordination.questions }
      : {}),
    ...(opts.priorCoordination?.escalations?.length
      ? { priorEscalations: opts.priorCoordination.escalations }
      : {}),
    ...(opts.priorCoordination?.records.length
      ? { priorJournal: opts.priorCoordination.records }
      : {}),
    ...(opts.priorCoordination?.analystDefinitions?.length
      ? { priorAnalystDefinitions: opts.priorCoordination.analystDefinitions }
      : {}),
    // `report_blocked` probes only what this manager was granted, under its own identity.
    resolveProbeTool: (name) => probeableByName?.get(name),
  })
  await coord.ready()
  const availableTools = [...coord.tools, ...(opts.nodeTools ?? [])]
  const availableByName = new Map(availableTools.map((tool) => [tool.name, tool]))
  const extraByName = new Map((opts.extraTools ?? []).map((tool) => [tool.name, tool]))
  const selectedTools = opts.toolNames.map((name) => {
    const descriptor = availableByName.get(name)
    if (descriptor !== undefined) return { kind: 'descriptor' as const, descriptor }
    const extra = extraByName.get(name)
    if (extra === undefined) {
      throw new ValidationError(
        `driverAgent: requested tool ${JSON.stringify(name)} is unavailable`,
      )
    }
    return { kind: 'extra' as const, extra }
  })
  const modelTools = selectedTools.flatMap((selected) =>
    selected.kind === 'descriptor' ? [selected.descriptor] : [],
  )
  probeableByName = new Map(modelTools.map((tool) => [tool.name, tool]))
  const extraNames = new Set(
    selectedTools.flatMap((selected) => (selected.kind === 'extra' ? [selected.extra.name] : [])),
  )
  // Before the first brain turn: a node tool invoked on turn one must already be able to call
  // these verbs.
  opts.onCoordinationTools?.(modelTools, coord)
  return {
    coord,
    toolNames: selectedTools.map((selected) =>
      selected.kind === 'descriptor' ? selected.descriptor.name : selected.extra.name,
    ),
    extraNames,
    byName: new Map<string, McpToolDescriptor>(modelTools.map((tool) => [tool.name, tool])),
    toolSpecs: selectedTools.map((selected) => {
      const tool =
        selected.kind === 'descriptor'
          ? {
              name: selected.descriptor.name,
              description: selected.descriptor.description,
              parameters: selected.descriptor.inputSchema,
            }
          : {
              name: selected.extra.name,
              description: selected.extra.description,
              parameters: selected.extra.parameters,
            }
      return { type: 'function' as const, function: tool }
    }),
  }
}
