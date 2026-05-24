/**
 * @experimental
 *
 * Pre-built `AgentRunSpec` + output adapter + validator bundles for common
 * agent roles. Each preset bundles a sandbox-SDK `AgentProfile`, a
 * task-to-prompt formatter, an output adapter, and a per-task validator
 * constructor — all of the pieces `runLoop` needs to drive a topology.
 */

export type {
  CoderOutput,
  CoderProfileOptions,
  CoderTask,
  MultiHarnessCoderFanoutOptions,
} from './coder'
export { coderProfile, createCoderValidator, multiHarnessCoderFanout } from './coder'
