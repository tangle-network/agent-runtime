import { El as supervisorAgentWithTestBrain, Lc as SuperviseTestOptions, Tn as driverAgent, Zt as RunGraphTestOptions, _l as SupervisorAgentTestDeps, tn as runGraphWithTestBrain, wn as DriverAgentOptions, zc as superviseWithTestBrain } from "./index-Dm8SHDGW.js";
import { Hn as ToolLoopChat, Vn as ToolLoopCallContext } from "./stream-agent-turn-Bk79CnTw.js";
import { AgentImprovementProposal, AgentProfile, AgentProfileImprovementMeasuredComparison, SandboxSizePreset } from "@tangle-network/agent-interface";
//#region src/testing/index.d.ts
/** A proposal produced by Runtime's opaque profile-improvement path. */
type AgentProfileImprovementProposalFixture = Omit<AgentImprovementProposal, 'evaluation'> & {
  evaluation: AgentProfileImprovementMeasuredComparison;
};
/** Complete private state for exercising profile activation and restore in consumer tests. */
interface AgentProfileImprovementFixture {
  proposal: AgentProfileImprovementProposalFixture;
  baselineProfile: AgentProfile;
  candidateProfile: AgentProfile;
  recommendedSize: SandboxSizePreset;
}
/** Load an isolated, production-validated Runtime proposal for consumer tests. */
declare function loadAgentImprovementProposalFixture(): AgentImprovementProposal;
/** Load an isolated profile proposal and its private activation state for consumer tests. */
declare function loadAgentProfileImprovementFixture(): AgentProfileImprovementFixture;
//#endregion
export { AgentProfileImprovementFixture, AgentProfileImprovementProposalFixture, type DriverAgentOptions, type RunGraphTestOptions, type SuperviseTestOptions, type SupervisorAgentTestDeps, type ToolLoopCallContext, type ToolLoopChat, driverAgent, loadAgentImprovementProposalFixture, loadAgentProfileImprovementFixture, runGraphWithTestBrain, superviseWithTestBrain, supervisorAgentWithTestBrain };
//# sourceMappingURL=testing.d.ts.map