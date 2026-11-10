/**
 * Durable checkpoints of a retained owner's workspace, and the marker that proves a restore.
 * A replacement environment is created from the latest checkpoint. The marker is the evidence
 * the provider restored that workspace.
 */

import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import type { WorkspaceCheckpointMarker } from './types'

/** Workspace-relative path of the marker Runtime writes before every checkpoint. */
export const WORKSPACE_CHECKPOINT_MARKER_PATH = '.agent-runtime-checkpoint'

/** Least time between two checkpoints of one owner. Each checkpoint stores the whole workspace. */
export const WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS = 60_000

/** Bound on one checkpoint: environment lookup, marker write, and the provider operation. */
export const WORKSPACE_CHECKPOINT_TIMEOUT_MS = 120_000

/** After this long, a checkpoint request the provider answers `not_found` for was never created:
 *  ten times the bound on the request itself, so nothing it started can still be in flight. */
export const WORKSPACE_CHECKPOINT_ABSENT_AFTER_MS = 10 * WORKSPACE_CHECKPOINT_TIMEOUT_MS

/** Checkpoints kept per source environment; older ones are deleted once a newer one is journaled. */
export const WORKSPACE_CHECKPOINTS_KEPT = 2

/** Bound on the deletes one checkpoint rotation runs. A turn capture cuts them short; the release deletes the rest. */
export const WORKSPACE_CHECKPOINT_ROTATION_CAPTURES_MS = 2 * 60_000

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
