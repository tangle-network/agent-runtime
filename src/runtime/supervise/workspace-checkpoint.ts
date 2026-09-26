/**
 * Durable checkpoints of a retained owner's workspace, and the marker that proves a restore.
 *
 * A director placed on a provider sandbox keeps its working files in that sandbox. When the
 * provider loses the sandbox, Runtime re-enters the director in a new one with the coordinator's
 * run state (`reentry.ts`), but the files were gone: measured in discovery-lab Autopsy A
 * (`autopsy-a-after-20260924b`, 2026-09-24), the re-entered director found no `objective.md` and
 * wrote a new nonce. So while a manager coordinates, Runtime checkpoints its workspace through the
 * provider's durable branching surface, and a replacement environment is created from the latest
 * checkpoint. The checkpoint belongs to the provider: a Tangle checkpoint is a Sandbox snapshot,
 * which outlives its box (measured 2026-09-24: a snapshot took 4.0 to 5.0 s, and a box created
 * from it 19 s after its source box was deleted held every file byte-identical).
 *
 * Before each checkpoint Runtime writes a marker file into the workspace. A restored environment
 * is verified by reading that file back: the provider's create is contracted to restore or fail,
 * and the marker is the evidence that it did.
 */

import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import type { WorkspaceCheckpointMarker } from './types'

/** Workspace-relative path of the marker Runtime writes before every checkpoint. */
export const WORKSPACE_CHECKPOINT_MARKER_PATH = '.agent-runtime-checkpoint'

/** Least time between two checkpoints of one owner. Each checkpoint stores the whole workspace. */
export const WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS = 60_000

/** Bound on one checkpoint: environment lookup, marker write, and the provider operation. */
export const WORKSPACE_CHECKPOINT_TIMEOUT_MS = 120_000

/** Checkpoints kept per source environment; older ones are deleted once a newer one is journaled. */
export const WORKSPACE_CHECKPOINTS_KEPT = 2

/** Write the marker. False when the environment cannot take it, so no restore can be verified. */
export async function writeWorkspaceMarker(
  environment: AgentEnvironment,
  marker: WorkspaceCheckpointMarker,
  signal: AbortSignal,
): Promise<boolean> {
  if (typeof environment.write !== 'function') return false
  try {
    await environment.write(marker.path, marker.content, { signal })
    return true
  } catch {
    return false
  }
}

/** Read the marker back from a restored environment and compare it byte for byte. */
export async function verifyWorkspaceMarker(
  environment: AgentEnvironment,
  marker: WorkspaceCheckpointMarker | undefined,
  signal: AbortSignal,
): Promise<{ readonly verified: boolean; readonly detail?: string }> {
  if (marker === undefined) {
    return {
      verified: false,
      detail: 'the checkpoint has no marker: the source could not take one',
    }
  }
  if (typeof environment.read !== 'function') {
    return { verified: false, detail: 'the restored environment does not expose read' }
  }
  try {
    const content = await environment.read(marker.path, { signal })
    return content === marker.content
      ? { verified: true }
      : {
          verified: false,
          detail: 'the marker in the restored environment differs from the checkpoint',
        }
  } catch (error) {
    return {
      verified: false,
      detail:
        `the marker could not be read: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          500,
        ),
    }
  }
}
