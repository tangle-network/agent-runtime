import { a as ImprovementEditBatch, c as KnowledgeProposalBatch, d as RunAnalystLoopOpts, f as RunAnalystLoopResult, i as FindingsStoreLike, l as KnowledgeProposalSource, n as AnalystRegistryLike, o as ImprovementProposalSource, r as AnalystRegistryStreamingLike, s as ImprovementReport, t as AnalystLoopEvent, u as KnowledgeReport } from "./types-zWfqDjeL.js";
//#region src/analyst-loop/run-analyst-loop.d.ts
/** Analyze a run and apply accepted knowledge and agent-surface proposals. */
declare function runAnalystLoop<TProposal = unknown, TEdit = unknown>(opts: RunAnalystLoopOpts): Promise<RunAnalystLoopResult<TProposal, TEdit>>;
//#endregion
export { type AnalystLoopEvent, type AnalystRegistryLike, type AnalystRegistryStreamingLike, type FindingsStoreLike, type ImprovementEditBatch, type ImprovementProposalSource, type ImprovementReport, type KnowledgeProposalBatch, type KnowledgeProposalSource, type KnowledgeReport, type RunAnalystLoopOpts, type RunAnalystLoopResult, runAnalystLoop };
//# sourceMappingURL=analyst-loop.d.ts.map