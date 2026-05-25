/**
 * `@tangle-network/agent-runtime/analyst-loop` — the closed loop
 * orchestrator that ties agent-eval's analyst registry to consumer-
 * supplied knowledge + improvement adapters.
 *
 * The runtime stays decoupled from any specific knowledge or prompt
 * store: consumers wire `agent-knowledge`'s `proposeFromFindings`
 * (or a custom equivalent) into the adapter slots once at app init.
 */

export { runAnalystLoop } from './run-analyst-loop'
export type {
  AnalystLoopEvent,
  AnalystRegistryLike,
  AnalystRegistryStreamingLike,
  AutoApplyPolicy,
  FindingsStoreLike,
  ImprovementAdapter,
  ImprovementEditBatch,
  ImprovementReport,
  KnowledgeAdapter,
  KnowledgeProposalBatch,
  KnowledgeReport,
  RunAnalystLoopOpts,
  RunAnalystLoopResult,
} from './types'
