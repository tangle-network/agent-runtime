import type { AgentWorkspaceBranching } from '@tangle-network/agent-interface'

/** Fork verbs a checkpoint owner must never call: Runtime deletes checkpoints, it never forks them. */
export const forbiddenCheckpointForks: Pick<
  AgentWorkspaceBranching,
  'fork' | 'lookupFork' | 'destroyFork'
> = {
  fork: async () => {
    throw new Error('Runtime must not fork a checkpoint')
  },
  lookupFork: async () => {
    throw new Error('Runtime must not fork a checkpoint')
  },
  destroyFork: async () => {
    throw new Error('Runtime must not fork a checkpoint')
  },
}
