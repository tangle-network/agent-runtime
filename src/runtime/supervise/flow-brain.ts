import type { AgentProfile } from '@tangle-network/agent-interface'
import type { ToolLoopChat } from '../tool-loop'
import { flowRootProfile } from './graph-flow'

const flowBrains = new WeakSet<ToolLoopChat>()

/** Runtime owns this nonmodel coordinator; edge caps, pool, deadline and abort bound its turns. */
export function runtimeFlowBrain(): ToolLoopChat {
  const brain: ToolLoopChat = async () => ({ content: null, toolCalls: [] })
  flowBrains.add(brain)
  return brain
}

/** True only for a brain `runtimeFlowBrain` minted. */
export function isRuntimeFlowBrain(brain: ToolLoopChat): boolean {
  return flowBrains.has(brain)
}

/** The owned flow coordinator has no model call; every other model-bearing field stays policy-bound. */
export function flowModelPolicyProfile(profile: AgentProfile, brain?: ToolLoopChat): AgentProfile {
  return brain &&
    isRuntimeFlowBrain(brain) &&
    profile.model?.default === flowRootProfile.model?.default
    ? { ...profile, model: { ...profile.model, default: undefined } }
    : profile
}
