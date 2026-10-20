import type { SupervisorAgentDeps } from './supervisor-agent-contracts'

/** Forward the same declared observer routes to router and external manager coordination. */
export function supervisorCoordinationObservers(
  deps: Pick<
    SupervisorAgentDeps,
    | 'analysts'
    | 'analyzeOnSettle'
    | 'mapOnSettle'
    | 'sourceEvidenceRefs'
    | 'peerAudit'
    | 'escalateQuestion'
    | 'onChildQuestionInbox'
    | 'watchWorkers'
    | 'stallAfterMs'
  >,
) {
  return {
    ...(deps.analysts ? { analysts: deps.analysts } : {}),
    ...(deps.analyzeOnSettle ? { analyzeOnSettle: deps.analyzeOnSettle } : {}),
    ...(deps.mapOnSettle ? { mapOnSettle: deps.mapOnSettle } : {}),
    ...(deps.sourceEvidenceRefs ? { sourceEvidenceRefs: deps.sourceEvidenceRefs } : {}),
    ...(deps.peerAudit ? { peerAudit: deps.peerAudit } : {}),
    ...(deps.escalateQuestion ? { escalateQuestion: deps.escalateQuestion } : {}),
    ...(deps.onChildQuestionInbox ? { onChildQuestionInbox: deps.onChildQuestionInbox } : {}),
    ...(deps.watchWorkers ? { watchWorkers: deps.watchWorkers } : {}),
    ...(deps.stallAfterMs !== undefined ? { stallAfterMs: deps.stallAfterMs } : {}),
  }
}
