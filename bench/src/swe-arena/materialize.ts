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

import { randomUUID } from 'node:crypto'
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
  /** Cancels Docker/Git setup before a cell begins model execution. */
  signal?: AbortSignal
}

export interface MaterializedWorkspace {
  head: string
  /** `git status --porcelain` empty after materialization. */
  clean: boolean
}

/** setup-ws.sh container-name sanitization: `tr '_/' '--'` + unique suffix. */
export function containerName(instanceId: string): string {
  const sanitized = instanceId.replace(/[_/]/g, '-')
  return `ext-${sanitized}-${process.pid}-${randomUUID()}`
}

const DOCKER_CREATE_TIMEOUT_MS = 5 * 60_000
const DOCKER_COPY_TIMEOUT_MS = 10 * 60_000
const DOCKER_CLEANUP_TIMEOUT_MS = 60_000
const GIT_COMMAND_TIMEOUT_MS = 2 * 60_000

/**
 * Materialize a pristine workspace for `instanceId` at `dest`. Throws with the
 * setup-ws.sh stage label (create-fail / cp-fail / no-git / reset-fail) so
 * failures stay greppable against the bash experiment's logs.
 */
export async function materializeWorkspace(opts: MaterializeOptions): Promise<MaterializedWorkspace> {
  const { instanceId, image, baseCommit, dest } = opts
  const workBranch = opts.workBranch ?? 'hh-work'
  const container = containerName(instanceId)

  opts.signal?.throwIfAborted()
  await rm(dest, { recursive: true, force: true })
  await mkdir(dirname(dest), { recursive: true })
  opts.signal?.throwIfAborted()

  const create = await run('docker', ['create', '--name', container, image], {
    signal: opts.signal,
    timeoutMs: DOCKER_CREATE_TIMEOUT_MS,
  })
  let stageError: unknown
  try {
    opts.signal?.throwIfAborted()
    if (create.code !== 0) {
      throw new Error(`materialize ${instanceId}: create-fail (${image}): ${create.stderr.slice(0, 500)}`)
    }
    const cp = await run('docker', ['cp', `${container}:/testbed`, dest], {
      signal: opts.signal,
      timeoutMs: DOCKER_COPY_TIMEOUT_MS,
    })
    opts.signal?.throwIfAborted()
    if (cp.code !== 0) {
      throw new Error(`materialize ${instanceId}: cp-fail: ${cp.stderr.slice(0, 500)}`)
    }
  } catch (cause) {
    stageError = cause
  }

  // Cleanup must still run after the caller signal fires, so it gets its own
  // short deadline instead of the already-aborted cell signal.
  let cleanupError: unknown
  try {
    const cleanup = await run('docker', ['rm', '-f', container], {
      timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS,
    })
    const detail = cleanup.stderr || cleanup.stdout
    const absent = /no such container/iu.test(detail)
    if (cleanup.code !== 0 && !absent) {
      cleanupError = new Error(
        `materialize ${instanceId}: cleanup-fail container=${container} exit=${cleanup.code}: ${detail.slice(0, 500)}`,
      )
    }
  } catch (cause) {
    cleanupError = cause
  }
  if (stageError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [stageError, cleanupError],
      `materialize ${instanceId}: workspace extraction and container cleanup both failed`,
    )
  }
  if (stageError !== undefined) throw stageError
  if (cleanupError !== undefined) throw cleanupError

  opts.signal?.throwIfAborted()
  const gitDir = await stat(`${dest}/.git`).catch(() => null)
  if (!gitDir?.isDirectory()) {
    throw new Error(`materialize ${instanceId}: no-git (image ${image} has no /testbed git repo)`)
  }

  const gitOpts = { signal: opts.signal, timeoutMs: GIT_COMMAND_TIMEOUT_MS }
  const reset = await run('git', ['-C', dest, 'reset', '-q', '--hard', baseCommit], gitOpts)
  opts.signal?.throwIfAborted()
  if (reset.code !== 0) {
    throw new Error(`materialize ${instanceId}: reset-fail base=${baseCommit}: ${reset.stderr.slice(0, 500)}`)
  }
  // Tolerated failure in the bash (`|| true`): a clean error must not kill setup.
  const clean = await run('git', ['-C', dest, 'clean', '-qfd'], gitOpts)
  opts.signal?.throwIfAborted()
  if (clean.timedOut) {
    throw new Error(`materialize ${instanceId}: clean-timeout: ${(clean.stderr || clean.stdout).slice(0, 500)}`)
  }

  await runOk('git', ['-C', dest, 'branch', '-f', workBranch, baseCommit], gitOpts)
  await runOk('git', ['-C', dest, 'checkout', '-q', workBranch], gitOpts)

  const head = (await runOk('git', ['-C', dest, 'rev-parse', 'HEAD'], gitOpts)).stdout.trim()
  const status = (await runOk('git', ['-C', dest, 'status', '--porcelain'], gitOpts)).stdout.trim()
  return { head, clean: status.length === 0 }
}
