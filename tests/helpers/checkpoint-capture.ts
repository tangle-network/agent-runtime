import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AgentWorkspaceBranching,
  WorkspaceCheckpointRef,
} from '@tangle-network/agent-interface'
import { captureAgentCandidateWorkspaceTreeToArtifacts } from '../../src/candidate-execution/workspace-streams'
import { createPrivateCasArtifactPort } from '../../src/runtime/private-cas'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { makeTempRoot } from './temp-root'

/** Historical checkpoint receipts with real archive bytes; this supplies no Runtime writer. */
export function checkpointCaptureFixture(options: {
  readonly provider: string
  readonly snapshotFiles: (checkpointId: string) => ReadonlyMap<string, string> | undefined
}) {
  const root = makeTempRoot('historical-checkpoint-')
  const cas = createPrivateCasArtifactPort(join(root, 'cas'), 'historical-checkpoint')
  const forbidden = async (): Promise<never> => {
    throw new Error('retired client writer must not fork a checkpoint')
  }
  const branching: Pick<AgentWorkspaceBranching, 'fork' | 'lookupFork' | 'destroyFork'> = {
    fork: forbidden,
    lookupFork: forbidden,
    destroyFork: forbidden,
  }
  return {
    branching,
    forkEnvironment: () => null,
    async record(
      checkpoint: WorkspaceCheckpointRef,
      id: string,
      seq: number,
    ): Promise<Extract<SpawnEvent, { kind: 'workspace-checkpoint-capture' }>> {
      const files = options.snapshotFiles(checkpoint.checkpointId)
      if (!files) throw new Error('historical checkpoint has no files')
      const directory = join(root, checkpoint.checkpointId)
      mkdirSync(directory, { recursive: true })
      for (const [path, content] of files) {
        mkdirSync(dirname(join(directory, path)), { recursive: true })
        writeFileSync(join(directory, path), content, { mode: 0o644 })
      }
      const tree = await captureAgentCandidateWorkspaceTreeToArtifacts(directory, {
        artifactPersistence: { outputArtifacts: cas, executionId: id },
      })
      return {
        kind: 'workspace-checkpoint-capture',
        id,
        provider: options.provider,
        environmentId: checkpoint.source.environmentId,
        checkpointId: checkpoint.checkpointId,
        fork: {
          idempotencyKey: `${checkpoint.idempotencyKey}:historical-fork`,
          environmentId: 'historical-destroyed-fork',
        },
        tree,
        seq,
        at: new Date(0).toISOString(),
      }
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
