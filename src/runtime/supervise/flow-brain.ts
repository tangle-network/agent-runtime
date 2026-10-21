import type { ToolLoopChat } from '../tool-loop'

const flowBrains = new WeakSet<ToolLoopChat>()

/**
 * The brain of a flow graph's runtime-owned root manager. It never calls a model: every turn
 * returns no tool call and reports no usage, so the manager only waits while the flow's runtime
 * spawns are open and ends when none is. The driver recognizes it by identity, places no provider
 * attempt for its turns, and bounds them by the flow's edge caps, the pool, the deadline and the
 * abort signal instead of the unmetered-turn bound.
 */
export function runtimeFlowBrain(): ToolLoopChat {
  const brain: ToolLoopChat = async () => ({ content: null, toolCalls: [] })
  flowBrains.add(brain)
  return brain
}

/** True only for a brain `runtimeFlowBrain` minted. */
export function isRuntimeFlowBrain(brain: ToolLoopChat): boolean {
  return flowBrains.has(brain)
}
