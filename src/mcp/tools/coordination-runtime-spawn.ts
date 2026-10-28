import { errMessage } from '../../runtime/supervise/error-message'
import type { SpawnAdmission } from './coordination-contracts'

/** What a keyed runtime spawn (a flow's entry or route, a map's item or join) became. */
export type RuntimeSpawnOutcome =
  /** `committed`: the key's done settlement is already on disk, so nothing ran and the caller
   *  settles that result itself; no settlement drain will ever carry it. */
  | { readonly workerId: string; readonly committed: boolean }
  /** The key and its one replacement both have a prior worker started without a terminal receipt. */
  | { readonly inDoubt: true }
  | { readonly refused: string; readonly code?: string }

/**
 * Admit one keyed runtime spawn. A key whose prior worker is in doubt (started in a dead process
 * with no terminal receipt) is re-admitted once under `<key>#2`, the replacement key the
 * `spawn_worker` contract names; a replacement that is in doubt too is reported, never retried.
 */
export async function admitRuntimeSpawn(
  admitSpawn: (input: SpawnAdmission) => Promise<unknown>,
  input: SpawnAdmission & { readonly key: string },
): Promise<RuntimeSpawnOutcome> {
  for (const key of [input.key, `${input.key}#2`]) {
    let response: unknown
    try {
      response = await admitSpawn({ ...input, key })
    } catch (error) {
      return { refused: errMessage(error) }
    }
    const started = response as Partial<
      Record<'workerId' | 'resumed' | 'error' | 'reason', unknown>
    >
    if (typeof started.workerId === 'string') {
      return { workerId: started.workerId, committed: started.resumed === 'completed' }
    }
    if (started.error !== 'in-doubt') {
      return {
        refused: typeof started.reason === 'string' ? started.reason : 'spawn refused',
        ...(typeof started.error === 'string' ? { code: started.error } : {}),
      }
    }
  }
  return { inDoubt: true }
}
