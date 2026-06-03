/**
 * @experimental
 *
 * Driven-loop substrate. `runLoop` orchestrates around the sandbox SDK; it
 * does not invent its own notion of "what an agent is". Each iteration is
 * a `sandboxClient.create({ backend: { profile } })` + `box.streamPrompt`
 * call. The driver owns topology; the validator owns scoring; the output
 * adapter owns event-stream decode; the kernel owns iteration accounting,
 * concurrency, abort, cost aggregation, and trace emission.
 */

// One-stop import: sandbox-SDK types consumers need to spell out an
// `AgentRunSpec` without importing `@tangle-network/sandbox` separately.
export type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
export {
  type CompletionAnalyst,
  type CompletionEvidence,
  type CompletionPolicy,
  type CompletionVerdict,
  completionAuthorizes,
  deterministicCompletion,
  sentinelCompletion,
  stopSentinel,
} from './completion'
export type {
  AnalyzeInput,
  CreateDynamicDriverOptions,
  DynamicDecision,
  HistorySummaryRow,
  PlannerContext,
  TopologyMove,
  TopologyPlanner,
} from './drivers/dynamic'
export { createDynamicDriver, renderAnalyses, summarizeHistory } from './drivers/dynamic'
export type {
  CreateFanoutVoteDriverOptions,
  FanoutVoteDecision,
  FanoutVoteScored,
} from './drivers/fanout-vote'
export { createFanoutVoteDriver, scoreFanoutVoteIterations } from './drivers/fanout-vote'
export type { PromptPlanner } from './drivers/planners'
export { blind, PROMPT_PLANNERS, resolvePlanner } from './drivers/planners'
export type { CreateRefineDriverOptions, RefineDecision } from './drivers/refine'
export { createRefineDriver, refineWinnerIndex } from './drivers/refine'
export type {
  CreateSandboxPlannerOptions,
  TopologyMoveEnvelope,
} from './drivers/sandbox-planner'
export { createSandboxPlanner } from './drivers/sandbox-planner'
export {
  type LoopDispatchOptions,
  type LoopOptionsForDispatch,
  loopDispatch,
} from './loop-dispatch'
export type { Agent, Program, ProgramResult, RunProgramOptions } from './program'
export {
  agentProgramPlanner,
  compileProgram,
  flattenProgram,
  isStraightLine,
  runAgent,
  runProgram,
} from './program'
export { reportLoopUsage, type UsageSink } from './report-usage'
export type { RunLoopOptions } from './run-loop'
export { createSandboxForSpec, runLoop } from './run-loop'
export { type AcquireOptions, acquireSandbox } from './sandbox-acquire'
export { extractLlmCallEvent, mapSandboxEvent } from './sandbox-events'
export type {
  AgentRunSpec,
  DefaultVerdict,
  Driver,
  ExecCtx,
  Iteration,
  LoopDecisionPayload,
  LoopEndedPayload,
  LoopIterationDispatchPayload,
  LoopIterationEndedPayload,
  LoopIterationStartedPayload,
  LoopPlanDescription,
  LoopPlanPayload,
  LoopResult,
  LoopSandboxClient,
  LoopSandboxPlacement,
  LoopStartedPayload,
  LoopTeardownFailedPayload,
  LoopTokenUsage,
  LoopTraceEmitter,
  LoopTraceEvent,
  LoopWinner,
  OutputAdapter,
  ValidationCtx,
  Validator,
} from './types'
