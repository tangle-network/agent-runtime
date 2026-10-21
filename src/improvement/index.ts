/**
 * `@tangle-network/agent-runtime` improvement.
 *
 * The public entry point is `improve()`. Complete agent-eval methods optimize
 * profile surfaces. Runtime owns isolated code candidates and trainer execution
 * that returns checkpoint receipts, not promotion decisions.
 */

export {
  type AgenticGeneratorExecutorForWorktree,
  type AgenticGeneratorShotDisposition,
  type AgenticGeneratorShotExecution,
  type AgenticGeneratorShotReceipt,
  agenticGenerator,
  commandVerifier,
} from './agentic-generator'
export type { ImproveMethodFactory } from './improve'
export type { ReadonlyAgentProfile } from './profile-types'
