import type { ToolLoopChat } from '../tool-loop'
import type { Agent } from './types'

const flowOwners = new WeakSet<object>()

/** Runtime schedules this model-free brain under graph edge caps, pool, deadline and abort. */
export function runtimeFlowBrain(): ToolLoopChat {
  const brain: ToolLoopChat = async () => ({ content: null, toolCalls: [] })
  flowOwners.add(brain)
  return brain
}

/** True only for a brain `runtimeFlowBrain` minted. */
export function isRuntimeFlowBrain(brain: ToolLoopChat): boolean {
  return flowOwners.has(brain)
}

/** Carry the same unforgeable ownership through the built code driver and its spec copies. */
export function runtimeFlowAgent(
  agent: Agent<unknown, unknown>,
  brain: ToolLoopChat | undefined,
): Agent<unknown, unknown> {
  if (brain && isRuntimeFlowBrain(brain)) flowOwners.add(agent)
  return agent
}

export function isRuntimeFlowAgent(agent: unknown): boolean {
  return typeof agent === 'object' && agent !== null && flowOwners.has(agent)
}
