import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

import { run, type RunResult } from './proc'

const WORKSPACE_PATH = '/workspace'
const STATE_PATH = '/factory-state'
const IMAGE_DIGEST_RE = /^.+@sha256:[0-9a-f]{64}$/
const CONTAINER_PATH =
  `${STATE_PATH}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
const CONTROL_TIMEOUT_MS = 30_000

export type FactoryCommandNetwork = 'enabled' | 'none'

export interface RunFactoryCommandOptions {
  image: string
  network: FactoryCommandNetwork
  timeoutMs: number
  signal?: AbortSignal
  maxBuffer?: number
}

function hostPath(baseEnv: NodeJS.ProcessEnv): string {
  const path = (baseEnv.PATH ?? '')
    .split(delimiter)
    .filter((entry) => entry.length > 0 && isAbsolute(entry))
    .join(delimiter)
  if (!path) throw new Error('factory container control process requires an absolute PATH')
  return path
}

async function createControlEnvironment(): Promise<{
  env: NodeJS.ProcessEnv
  dispose: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'factory-container-control-'))
  const home = join(root, 'home')
  const dockerConfig = join(root, 'docker')
  const xdgConfig = join(root, 'xdg')
  const temp = join(root, 'tmp')
  try {
    await Promise.all(
      [home, dockerConfig, xdgConfig, temp].map((dir) =>
        mkdir(dir, { recursive: true, mode: 0o700 }),
      ),
    )
    let disposal: Promise<void> | undefined
    return {
      env: {
        PATH: hostPath(process.env),
        HOME: home,
        DOCKER_CONFIG: dockerConfig,
        XDG_CONFIG_HOME: xdgConfig,
        TMPDIR: temp,
        TMP: temp,
        TEMP: temp,
        LANG: 'C',
        LC_ALL: 'C',
        TZ: 'UTC',
      },
      dispose: () => (disposal ??= rm(root, { recursive: true, force: true })),
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

function currentUser(): { uid: number; gid: number } {
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  if (
    typeof uid !== 'number' ||
    typeof gid !== 'number' ||
    !Number.isSafeInteger(uid) ||
    !Number.isSafeInteger(gid)
  ) {
    throw new Error('factory command containers require a POSIX uid and gid')
  }
  if (uid === 0) {
    throw new Error('factory command containers refuse to run candidate commands as root')
  }
  return { uid, gid }
}

function containerEnvironment(): string[] {
  return [
    `PATH=${CONTAINER_PATH}`,
    `HOME=${STATE_PATH}/home`,
    `XDG_CONFIG_HOME=${STATE_PATH}/xdg/config`,
    `XDG_DATA_HOME=${STATE_PATH}/xdg/data`,
    `XDG_CACHE_HOME=${STATE_PATH}/xdg/cache`,
    `XDG_STATE_HOME=${STATE_PATH}/xdg/state`,
    `XDG_RUNTIME_DIR=${STATE_PATH}/xdg/runtime`,
    'TMPDIR=/tmp',
    'TMP=/tmp',
    'TEMP=/tmp',
    'LANG=C',
    'LC_ALL=C',
    'TZ=UTC',
    'CI=false',
    `COREPACK_HOME=${STATE_PATH}/corepack`,
    'COREPACK_DEFAULT_TO_LATEST=0',
    'COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
    `PNPM_HOME=${STATE_PATH}/pnpm-home`,
    `npm_config_store_dir=${STATE_PATH}/pnpm-store`,
    `NPM_CONFIG_CACHE=${STATE_PATH}/npm-cache`,
    `NPM_CONFIG_USERCONFIG=${STATE_PATH}/npm/user.npmrc`,
    `NPM_CONFIG_GLOBALCONFIG=${STATE_PATH}/npm/global.npmrc`,
    'GIT_CONFIG_NOSYSTEM=1',
    `GIT_CONFIG_GLOBAL=${STATE_PATH}/git/global.config`,
    `GIT_CONFIG_SYSTEM=${STATE_PATH}/git/system.config`,
    'GIT_TERMINAL_PROMPT=0',
    'GCM_INTERACTIVE=Never',
  ]
}

const COMMAND_WRAPPER = `
set -eu
mkdir -p \
  "$HOME" \
  "$XDG_CONFIG_HOME" \
  "$XDG_DATA_HOME" \
  "$XDG_CACHE_HOME" \
  "$XDG_STATE_HOME" \
  "$XDG_RUNTIME_DIR" \
  "$COREPACK_HOME" \
  "$PNPM_HOME" \
  "$npm_config_store_dir" \
  "$NPM_CONFIG_CACHE" \
  "${STATE_PATH}/npm" \
  "${STATE_PATH}/git" \
  "${STATE_PATH}/bin"
touch \
  "$NPM_CONFIG_USERCONFIG" \
  "$NPM_CONFIG_GLOBALCONFIG" \
  "$GIT_CONFIG_GLOBAL" \
  "$GIT_CONFIG_SYSTEM"
corepack enable --install-directory "${STATE_PATH}/bin" >/dev/null
exec /bin/bash --noprofile --norc -c "$1"
`

function dockerArgs(input: {
  name: string
  workspace: string
  command: string
  image: string
  network: FactoryCommandNetwork
  uid: number
  gid: number
}): string[] {
  const user = `${input.uid}:${input.gid}`
  return [
    'run',
    '--rm',
    '--name',
    input.name,
    '--hostname',
    'factory-command',
    '--pull=missing',
    '--read-only',
    '--init',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit=512',
    '--memory=4g',
    '--memory-swap=4g',
    '--cpus=2',
    '--ulimit',
    'nofile=4096:4096',
    '--ipc=private',
    '--network',
    input.network === 'none' ? 'none' : 'bridge',
    '--user',
    user,
    '--workdir',
    WORKSPACE_PATH,
    '--mount',
    `type=bind,src=${input.workspace},dst=${WORKSPACE_PATH},bind-propagation=rprivate`,
    '--tmpfs',
    `/tmp:rw,nosuid,nodev,mode=1777,size=512m,uid=${input.uid},gid=${input.gid}`,
    '--tmpfs',
    `${STATE_PATH}:rw,nosuid,nodev,mode=700,size=2048m,uid=${input.uid},gid=${input.gid}`,
    '--entrypoint=/usr/bin/env',
    input.image,
    '-i',
    ...containerEnvironment(),
    '/bin/bash',
    '--noprofile',
    '--norc',
    '-c',
    COMMAND_WRAPPER,
    'factory-command',
    input.command,
  ]
}

function isAlreadyRemoved(result: RunResult): boolean {
  return /no such container/iu.test(result.stderr || result.stdout)
}

/**
 * Run one repository-controlled command in a fresh container.
 *
 * The candidate sees one writable bind mount: its disposable workspace.
 * Process ids, root files, HOME, XDG state, Corepack, npm, and pnpm caches are
 * private to this invocation and disappear when the container exits.
 */
export async function runFactoryCommand(
  workspace: string,
  command: string,
  options: RunFactoryCommandOptions,
): Promise<RunResult> {
  if (!command.trim()) throw new Error('factory command must not be empty')
  if (!IMAGE_DIGEST_RE.test(options.image)) {
    throw new Error(`factory command image must be pinned by sha256 digest: ${options.image}`)
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`factory command timeout must be a positive integer: ${options.timeoutMs}`)
  }
  const workspacePath = await realpath(workspace)
  if (!(await stat(workspacePath)).isDirectory()) {
    throw new Error(`factory command workspace is not a directory: ${workspacePath}`)
  }
  if (workspacePath.includes(',')) {
    throw new Error(`factory command workspace path contains an unsupported comma: ${workspacePath}`)
  }
  const { uid, gid } = currentUser()
  const name = `factory-command-${process.pid}-${randomUUID()}`
  const control = await createControlEnvironment()
  let commandResult: RunResult | undefined
  let commandError: unknown
  try {
    commandResult = await run(
      'docker',
      dockerArgs({
        name,
        workspace: workspacePath,
        command,
        image: options.image,
        network: options.network,
        uid,
        gid,
      }),
      {
        env: control.env,
        timeoutMs: options.timeoutMs,
        killGraceMs: 2_000,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
      },
    )
  } catch (error) {
    commandError = error
  }

  let cleanupError: unknown
  try {
    const cleanup = await run('docker', ['rm', '-f', name], {
      env: control.env,
      timeoutMs: CONTROL_TIMEOUT_MS,
    })
    if (cleanup.code !== 0 && !isAlreadyRemoved(cleanup)) {
      cleanupError = new Error(
        `factory command container cleanup failed (${cleanup.code}): ${(cleanup.stderr || cleanup.stdout).slice(-1000)}`,
      )
    }
  } catch (error) {
    cleanupError = error
  }
  await control.dispose()

  if (commandError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [commandError, cleanupError],
      'factory command and container cleanup both failed',
    )
  }
  if (commandError !== undefined) throw commandError
  if (cleanupError !== undefined) throw cleanupError
  return commandResult!
}
