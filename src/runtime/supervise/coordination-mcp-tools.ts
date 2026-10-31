/**
 * Which tools one coordination server serves: the options its coordination tools are built from,
 * and the granted subset of coordination verbs and node tools, fenced and single-flight.
 */

import { ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import type { CoordinationTools } from '../../mcp/tools/coordination-contracts'
import type { createCoordinationToolsForManager } from '../../mcp/tools/coordination-manager'
import type { SpawnResourceReader } from '../../mcp/tools/spawn-resource-paths'
import type { serveCoordinationMcp } from './coordination-mcp'
import { singleFlightTools } from './single-flight-tools'

type ServeOpts = Parameters<typeof serveCoordinationMcp>[0]

/** `submit_result` runs an injected deliverable's check inside its request (src/mcp/tools/coordination.ts
 *  builds it exactly then) and `spawn_worker` reads by-path resources out of the manager's workspace
 *  first, so either can outlast one request and both are served like `nodeTools`. */
const DELIVERABLE_VERB = 'submit_result'
const FENCED_VERBS = new Set([DELIVERABLE_VERB, 'spawn_worker'])

/** The options the coordination tools are built from; `resolveProbeTool` binds `report_blocked` to
 *  what this manager was granted. */
export function coordinationToolOptions(
  opts: ServeOpts,
  ownerReader: SpawnResourceReader | undefined,
  resolveProbeTool: (name: string) => McpToolDescriptor | undefined,
): Parameters<typeof createCoordinationToolsForManager>[0] {
  return {
    resolveProbeTool,
    scope: opts.scope,
    blobs: opts.blobs,
    makeWorkerAgent: opts.makeWorkerAgent,
    ...(opts.graphs ? { graphs: opts.graphs } : {}),
    ...(opts.authorizeDownMessage ? { authorizeDownMessage: opts.authorizeDownMessage } : {}),
    perWorker: opts.perWorker,
    ...(opts.deliverable ? { deliverable: opts.deliverable } : {}),
    ...(opts.readContinuation ? { readContinuation: opts.readContinuation } : {}),
    ...(opts.onStop ? { onStop: opts.onStop } : {}),
    ...(opts.analysts ? { analysts: opts.analysts } : {}),
    ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
    ...(opts.mapOnSettle ? { mapOnSettle: opts.mapOnSettle } : {}),
    ...(opts.sourceEvidenceRefs ? { sourceEvidenceRefs: opts.sourceEvidenceRefs } : {}),
    ...(opts.peerAudit ? { peerAudit: opts.peerAudit } : {}),
    ...(opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {}),
    ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
    ...(opts.continuityByProfile ? { continuityByProfile: opts.continuityByProfile } : {}),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.replaySettlements ? { replaySettlements: true } : {}),
    ...(opts.questionPolicy ? { questionPolicy: opts.questionPolicy } : {}),
    ...(opts.escalateQuestion ? { escalateQuestion: opts.escalateQuestion } : {}),
    ...(opts.onChildQuestionInbox ? { onChildQuestionInbox: opts.onChildQuestionInbox } : {}),
    ...(opts.priorEscalations?.length ? { priorEscalations: opts.priorEscalations } : {}),
    ...(opts.priorQuestions?.length ? { priorQuestions: opts.priorQuestions } : {}),
    ...(opts.priorJournal?.length ? { priorJournal: opts.priorJournal } : {}),
    ...(opts.priorAnalystDefinitions?.length
      ? { priorAnalystDefinitions: opts.priorAnalystDefinitions }
      : {}),
    ...(opts.preflightSpawn ? { preflightSpawn: opts.preflightSpawn } : {}),
    ...(opts.resolveSpawnProfile ? { resolveSpawnProfile: opts.resolveSpawnProfile } : {}),
    ...(opts.composeSpawnProfile ? { composeSpawnProfile: opts.composeSpawnProfile } : {}),
    ...(opts.profiles ? { profiles: opts.profiles } : {}),
    ...(opts.spawnResourceRoot ? { spawnResourceRoot: opts.spawnResourceRoot } : {}),
    ...(ownerReader ? { spawnResourceReader: ownerReader } : {}),
    ...(opts.peerMail
      ? {
          peerMail:
            typeof opts.peerMail === 'object' && opts.peerMail.limits
              ? { limits: opts.peerMail.limits }
              : {},
        }
      : {}),
  }
}

/**
 * The granted tools in the order `opts.toolNames` names them, and the count of calls still running
 * behind a fence. An unknown, duplicated or shadowing name fails before the listener opens.
 */
export function bindServedTools(
  opts: ServeOpts,
  coord: CoordinationTools,
  fenceMs: number,
): { servedTools: McpToolDescriptor[]; background: () => number } {
  const reservedNames = new Set<string>(coord.tools.map((tool) => tool.name))
  for (const tool of opts.nodeTools ?? []) {
    if (reservedNames.has(tool.name)) {
      throw new ValidationError(
        `serveCoordinationMcp: node tool ${JSON.stringify(tool.name)} shadows a coordination verb or another node tool`,
      )
    }
    reservedNames.add(tool.name)
  }
  const nodeTools = singleFlightTools(opts.nodeTools ?? [], { fenceMs, receipts: coord })
  // `submit_result` runs the completion check inside its request, which can take minutes. Unfenced,
  // the transport answered 504 while the check kept running and the manager never saw the verdict
  // (25 of 25 submits in one 2026-09-22 run); fenced, it answers with a receipt and the verdict
  // reaches the manager in its next wake. On magnetar-rust-sandbox-20261031b five spawns answered 504
  // while their sandbox reads ran on for up to 5 min, and each manager re-read its worker's id.
  const fencedVerbs = singleFlightTools(
    coord.tools.filter((tool) => FENCED_VERBS.has(tool.name)),
    { fenceMs, receipts: coord },
  )
  // A rename in src/mcp/tools/coordination.ts must fail here, not leave the check unfenced.
  if (opts.deliverable && !fencedVerbs.tools.some((tool) => tool.name === DELIVERABLE_VERB)) {
    throw new ValidationError(
      `serveCoordinationMcp: a deliverable is injected but the coordination verbs lack ${DELIVERABLE_VERB}, so its check would run unfenced`,
    )
  }
  const fencedByName = new Map(fencedVerbs.tools.map((tool) => [tool.name, tool]))
  const availableByName = new Map(
    [...coord.tools.map((tool) => fencedByName.get(tool.name) ?? tool), ...nodeTools.tools].map(
      (tool) => [tool.name, tool],
    ),
  )
  if (!Array.isArray(opts.toolNames)) {
    throw new ValidationError(
      'serveCoordinationMcp: toolNames must name every granted tool explicitly',
    )
  }
  const selectedNames = opts.toolNames
  if (new Set(selectedNames).size !== selectedNames.length) {
    throw new ValidationError('serveCoordinationMcp: toolNames contains a duplicate name')
  }
  const servedTools = selectedNames.map((name) => {
    const tool = availableByName.get(name)
    if (tool === undefined) {
      throw new ValidationError(
        `serveCoordinationMcp: requested tool ${JSON.stringify(name)} is unavailable`,
      )
    }
    return tool
  })
  return { servedTools, background: () => nodeTools.background() + fencedVerbs.background() }
}
