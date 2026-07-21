/**
 * Workspace materialization from SWE-bench instance images — the typed port of
 * the experiment's `setup-ws.sh`, stage for stage:
 *
 *   docker create <image> → docker cp <container>:/testbed <dest> → docker rm
 *   → git reset --hard <base_commit> → git clean -fd → work branch checkout
 *
 * IMAGE materialization is the DEFAULT and must stay so. A plain `git clone`
 * at `base_commit` is insufficient: the instance's runnable environment (conda
 * env, compiled C extensions, version pins) is built by the official harness at
 * `environment_setup_commit` and lives only in the image's /testbed. Round-2 of
 * the supervisor evolution proved this live — clone-materialized worker
 * sandboxes dropped those build artifacts and every verify run died on imports
 * (astropy/matplotlib), which is exactly the failure mode the image path
 * removes. Clone materialization may only ever be an explicit opt-in for
 * pure-python instances, never the default.
 */

import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { run, runOk } from './proc'

export interface MaterializeOptions {
  instanceId: string
  /** Instance image, e.g. swebench/sweb.eval.x86_64.pallets_1776_flask-5014:latest. */
  image: string
  baseCommit: string
  /** Destination directory; removed and recreated (setup-ws.sh `rm -rf`). */
  dest: string
  /** Work branch forced to base_commit and checked out. Default matches the bash. */
  workBranch?: string
}

export interface MaterializedWorkspace {
  head: string
  /** `git status --porcelain` empty after materialization. */
  clean: boolean
}

/** setup-ws.sh container-name sanitization: `tr '_/' '--'` + unique suffix. */
export function containerName(instanceId: string): string {
  const sanitized = instanceId.replace(/[_/]/g, '-')
  return `ext-${sanitized}-${process.pid}-${Math.floor(Math.random() * 32768)}`
}

/**
 * Materialize a pristine workspace for `instanceId` at `dest`. Throws with the
 * setup-ws.sh stage label (create-fail / cp-fail / no-git / reset-fail) so
 * failures stay greppable against the bash experiment's logs.
 */
export async function materializeWorkspace(opts: MaterializeOptions): Promise<MaterializedWorkspace> {
  const { instanceId, image, baseCommit, dest } = opts
  const workBranch = opts.workBranch ?? 'hh-work'
  const container = containerName(instanceId)

  await rm(dest, { recursive: true, force: true })
  await mkdir(dirname(dest), { recursive: true })

  const create = await run('docker', ['create', '--name', container, image])
  if (create.code !== 0) {
    throw new Error(`materialize ${instanceId}: create-fail (${image}): ${create.stderr.slice(0, 500)}`)
  }
  try {
    const cp = await run('docker', ['cp', `${container}:/testbed`, dest])
    if (cp.code !== 0) {
      throw new Error(`materialize ${instanceId}: cp-fail: ${cp.stderr.slice(0, 500)}`)
    }
  } finally {
    await run('docker', ['rm', '-f', container])
  }

  const gitDir = await stat(`${dest}/.git`).catch(() => null)
  if (!gitDir?.isDirectory()) {
    throw new Error(`materialize ${instanceId}: no-git (image ${image} has no /testbed git repo)`)
  }

  const reset = await run('git', ['-C', dest, 'reset', '-q', '--hard', baseCommit])
  if (reset.code !== 0) {
    throw new Error(`materialize ${instanceId}: reset-fail base=${baseCommit}: ${reset.stderr.slice(0, 500)}`)
  }
  // Tolerated failure in the bash (`|| true`): a clean error must not kill setup.
  await run('git', ['-C', dest, 'clean', '-qfd'])

  await runOk('git', ['-C', dest, 'branch', '-f', workBranch, baseCommit])
  await runOk('git', ['-C', dest, 'checkout', '-q', workBranch])

  const head = (await runOk('git', ['-C', dest, 'rev-parse', 'HEAD'])).stdout.trim()
  const status = (await runOk('git', ['-C', dest, 'status', '--porcelain'])).stdout.trim()
  return { head, clean: status.length === 0 }
}
