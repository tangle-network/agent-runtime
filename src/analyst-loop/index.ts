/**
 * `@tangle-network/agent-runtime/analyst-loop` — the closed loop
 * orchestrator that ties agent-eval's analyst registry to consumer-
 * supplied knowledge and agent-surface proposal sources.
 *
 * The runtime stays decoupled from any specific knowledge or prompt
 * store: consumers wire `agent-knowledge`'s `proposeFromFindings`
 * (or a custom equivalent) into the adapter slots once at app init.
 */

export { iterationsToTraceStore } from './iterations-to-trace-store'
export { runAnalystLoop } from './run-analyst-loop'
export type {
  AnalystLoopEvent,
  AnalystRegistryLike,
  AnalystRegistryStreamingLike,
  FindingsStoreLike,
  ImprovementEditBatch,
  ImprovementProposalSource,
  ImprovementReport,
  KnowledgeProposalBatch,
  KnowledgeProposalSource,
  KnowledgeReport,
  RunAnalystLoopOpts,
  RunAnalystLoopResult,
} from './types'
