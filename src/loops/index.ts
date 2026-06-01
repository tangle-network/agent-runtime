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
export type { CreateAnalystSteeringOptions } from './drivers/analyst-steering'
export { createAnalystSteering } from './drivers/analyst-steering'
export type {
  CreateDynamicDriverOptions,
  DynamicDecision,
  PlannerContext,
  TopologyMove,
  TopologyPlanner,
} from './drivers/dynamic'
export { createDynamicDriver, summarizeHistory } from './drivers/dynamic'
export type {
  CreateFanoutVoteDriverOptions,
  FanoutVoteDecision,
  FanoutVoteScored,
} from './drivers/fanout-vote'
export { createFanoutVoteDriver, scoreFanoutVoteIterations } from './drivers/fanout-vote'
export type { CreateRefineDriverOptions, RefineDecision } from './drivers/refine'
export { createRefineDriver, refineWinnerIndex } from './drivers/refine'
export type {
  CreateSandboxPlannerOptions,
  TopologyMoveEnvelope,
} from './drivers/sandbox-planner'
export { createSandboxPlanner } from './drivers/sandbox-planner'
export type {
  AttributeSteerOptions,
  CreateAttributionAnalyzeOptions,
  SteerAttribution,
  SteerAttributionVerdict,
} from './drivers/steer-attribution'
export {
  attributeSteer,
  createAttributionAnalyze,
  steerAttributionSignal,
} from './drivers/steer-attribution'
export type {
  CreateSteeringPlannerOptions,
  SteeringFindingLike,
  SteeringSignal,
} from './drivers/steering-planner'
export {
  createSteeringPlanner,
  defaultAnalyze,
  steeringSignalsFromFindings,
} from './drivers/steering-planner'
export {
  type LoopDispatchOptions,
  type LoopOptionsForDispatch,
  loopCampaignDispatch,
  loopDispatch,
} from './loop-dispatch'
export { reportLoopUsage, type UsageSink } from './report-usage'
export type { RunLoopOptions } from './run-loop'
export { createSandboxForSpec, runLoop } from './run-loop'
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
  LoopTokenUsage,
  LoopTraceEmitter,
  LoopTraceEvent,
  LoopWinner,
  OutputAdapter,
  ValidationCtx,
  Validator,
} from './types'
