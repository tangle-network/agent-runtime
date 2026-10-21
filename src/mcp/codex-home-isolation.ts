import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { sha256 } from '../content-digest'
import {
  codexSensitiveEnvironmentName,
  collectCodexDiagnosticRedactionValues,
  readCodexAuthRedactionText,
} from './codex-diagnostics'
import { CODEX_PERMISSION_PROFILE } from './codex-execution-policy'
import { isVendoredCodexExecutable, sha256File } from './codex-native-executable'

const CODEX_AUTH_ENV = ['CODEX_ACCESS_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY'] as const

export async function isolateCodexHome(opts: {
  baseEnv: NodeJS.ProcessEnv
  cwd: string
  command: string
  readDeniedPaths: ReadonlyArray<string>
  resolveExecutable: (command: string, env: NodeJS.ProcessEnv) => Promise<string>
}): Promise<{
  env: NodeJS.ProcessEnv
  command: string
  cleanup: () => Promise<void>
  controlledConfigSha256: string
  executableSha256: string
  readDeniedPaths: string[]
  readDeniedPathsSha256: string
  readDeniedPathCount: number
  diagnosticRedactionValues: string[]
  ambientAuth: string
  isolatedAuth: string
  writeProbe: string
  stagedWriteProbe: string
  deniedProbePaths: string[]
}> {
  const isolatedHome = await mkdtemp(join(tmpdir(), 'agent-runtime-codex-'))
  await chmod(isolatedHome, 0o700)
  let workspaceTemp = ''
  let stagedExecutableDir = ''
  let ownsStagedExecutableDir = false
  let writeProbe = ''
  const cleanup = async () => {
    if (ownsStagedExecutableDir) {
      await chmod(stagedExecutableDir, 0o700).catch(() => undefined)
    }
    await Promise.all([
      ...(writeProbe ? [rm(writeProbe, { force: true })] : []),
      ...(workspaceTemp ? [rm(workspaceTemp, { recursive: true, force: true })] : []),
      ...(ownsStagedExecutableDir
        ? [rm(stagedExecutableDir, { recursive: true, force: true })]
        : []),
      rm(isolatedHome, { recursive: true, force: true }),
    ])
  }
  try {
    const readDeniedPaths = await normalizeReadDeniedPaths(opts.readDeniedPaths)
    const candidateRoot = await realpath(opts.cwd)
    writeProbe = join(candidateRoot, `.agent-runtime-write-proof-${randomUUID()}`)
    const stagedPath = join(candidateRoot, '.agent-runtime-bin')
    if (
      readDeniedPaths.some(
        (path) =>
          isSameOrDescendant(candidateRoot, path) ||
          isSameOrDescendant(stagedPath, path) ||
          isSameOrDescendant(path, stagedPath),
      )
    ) {
      throw new Error(
        'runLocalHarness: codexReadDeniedPaths cannot contain the candidate root or staged executable',
      )
    }
    const nativeExecutable = await opts.resolveExecutable(opts.command, opts.baseEnv)
    if (!(await isVendoredCodexExecutable(nativeExecutable))) {
      throw new Error(
        'runLocalHarness: reproducible Codex mode requires the vendored native Codex build' +
          ' (a static musl ELF on linux, a Mach-O executable on darwin), not a PATH wrapper',
      )
    }
    const sourceExecutableSha256 = await sha256File(nativeExecutable)

    stagedExecutableDir = stagedPath
    try {
      await mkdir(stagedExecutableDir, { mode: 0o700 })
      ownsStagedExecutableDir = true
    } catch (err) {
      throw new Error(
        `runLocalHarness: candidate-private .agent-runtime-bin must not already exist: ${String((err as NodeJS.ErrnoException).code ?? err)}`,
      )
    }
    const stagedExecutable = join(stagedExecutableDir, 'codex')
    await copyFile(nativeExecutable, stagedExecutable, constants.COPYFILE_FICLONE)
    await chmod(stagedExecutable, 0o500)
    const executableSha256 = await sha256File(stagedExecutable)
    if (
      executableSha256 !== sourceExecutableSha256 ||
      !(await isVendoredCodexExecutable(stagedExecutable))
    ) {
      throw new Error('runLocalHarness: staged Codex executable digest mismatch')
    }
    await chmod(stagedExecutableDir, 0o500)

    workspaceTemp = await mkdtemp(join(candidateRoot, '.agent-runtime-tmp-'))
    await chmod(workspaceTemp, 0o700)
    const ambientHome = resolve(opts.baseEnv.CODEX_HOME?.trim() || join(homedir(), '.codex'))
    const ambientAuth = join(ambientHome, 'auth.json')
    const isolatedAuth = join(isolatedHome, 'auth.json')
    let authText = ''
    try {
      await access(ambientAuth, constants.R_OK)
      authText = await readCodexAuthRedactionText(ambientAuth)
      await symlink(ambientAuth, isolatedAuth)
    } catch (err) {
      throw new Error(
        `runLocalHarness: reproducible Codex mode requires readable auth.json: ${String((err as NodeJS.ErrnoException).code ?? err)}`,
      )
    }
    const deniedHostRoots = [homedir(), opts.baseEnv.HOME?.trim(), ambientHome]
      .filter((path): path is string => Boolean(path))
      .map((path) => resolve(path))
      .filter((path, index, paths) => paths.indexOf(path) === index)
    const controlledConfig = codexControlledConfig({
      ambientTmp: opts.baseEnv.TMPDIR?.trim() || tmpdir(),
      deniedHostRoots,
      workspaceTemp,
      stagedExecutableDir,
      readDeniedPaths,
    })
    await writeFile(join(isolatedHome, 'config.toml'), controlledConfig, { mode: 0o600 })
    const env = { ...opts.baseEnv }
    for (const name of Object.keys(env)) {
      if (
        codexSensitiveEnvironmentName.test(name) ||
        CODEX_AUTH_ENV.some((authName) => authName === name)
      ) {
        delete env[name]
      }
    }
    env.CODEX_HOME = isolatedHome
    const home = homedir()
    const deniedProbePaths = [
      ...deniedHostRoots,
      ambientAuth,
      isolatedAuth,
      join(home, '.claude', '.credentials.json'),
      join(home, '.claude.json'),
      join(home, '.local', 'share', 'opencode', 'auth.json'),
      join(home, '.agents'),
      join(home, 'Documents'),
      join(home, 'Downloads'),
      join(home, '.npm'),
      join(home, 'code'),
      ...readDeniedPaths,
    ].filter((path, index, paths) => paths.indexOf(path) === index)
    return {
      env,
      command: stagedExecutable,
      cleanup,
      controlledConfigSha256: sha256(controlledConfig),
      executableSha256,
      readDeniedPaths,
      readDeniedPathsSha256: sha256(JSON.stringify(readDeniedPaths)),
      readDeniedPathCount: readDeniedPaths.length,
      diagnosticRedactionValues: collectCodexDiagnosticRedactionValues(opts.baseEnv, authText),
      ambientAuth,
      isolatedAuth,
      writeProbe,
      stagedWriteProbe: join(stagedExecutableDir, 'write-proof'),
      deniedProbePaths,
    }
  } catch (err) {
    await cleanup()
    throw err
  }
}

function codexControlledConfig(opts: {
  ambientTmp: string
  deniedHostRoots: string[]
  workspaceTemp: string
  stagedExecutableDir: string
  readDeniedPaths: string[]
}): string {
  const rules = new Map<string, 'deny' | 'read' | 'write'>()
  const broadDeniedPaths = minimalPathRoots([
    ...opts.deniedHostRoots.map((path) => resolve(path)),
    tmpdir(),
    opts.ambientTmp,
    '/proc',
    '/run/docker',
    '/run/containerd',
  ])
  for (const path of broadDeniedPaths) {
    rules.set(path, 'deny')
  }
  const workspaceRoot = dirname(opts.workspaceTemp)
  for (const path of opts.readDeniedPaths) {
    const alreadyDenied = broadDeniedPaths.some((root) => isSameOrDescendant(path, root))
    if (!alreadyDenied || isSameOrDescendant(path, workspaceRoot)) rules.set(path, 'deny')
  }
  if (!rules.has(opts.workspaceTemp)) rules.set(opts.workspaceTemp, 'write')
  if (!rules.has(opts.stagedExecutableDir)) rules.set(opts.stagedExecutableDir, 'read')
  const filesystemRules = [...rules]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, access]) => `${JSON.stringify(path)} = ${JSON.stringify(access)}`)
    .join('\n')
  return `default_permissions = "${CODEX_PERMISSION_PROFILE}"
approval_policy = "never"
allow_login_shell = false
service_tier = "default"

[shell_environment_policy]
inherit = "core"
ignore_default_excludes = false
exclude = ["^CODEX_HOME$", "(?i).*TOKEN.*", "(?i).*KEY.*", "(?i).*SECRET.*", "(?i).*PASSWORD.*", "(?i).*CREDENTIAL.*", "(?i).*AUTH.*", "(?i).*COOKIE.*"]
set = { TMPDIR = ${JSON.stringify(opts.workspaceTemp)} }

[permissions.${CODEX_PERMISSION_PROFILE}.filesystem]
":minimal" = "read"
${filesystemRules}
":slash_tmp" = "deny"

[permissions.${CODEX_PERMISSION_PROFILE}.filesystem.":workspace_roots"]
"." = "write"
".git" = "deny"

[permissions.${CODEX_PERMISSION_PROFILE}.network]
enabled = false

[permissions.${CODEX_PERMISSION_PROFILE}.network.unix_sockets]
"/var/run/docker.sock" = "deny"
"/run/docker.sock" = "deny"
"/var/run/containerd/containerd.sock" = "deny"
"/run/containerd/containerd.sock" = "deny"
`
}

function isSameOrDescendant(path: string, root: string): boolean {
  const normalizedPath = resolve(path)
  const normalizedRoot = resolve(root)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`)
}

function minimalPathRoots(paths: ReadonlyArray<string>): string[] {
  const ordered = [...new Set(paths.map((path) => resolve(path)))].sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  )
  return ordered.filter(
    (path, index) => !ordered.slice(0, index).some((root) => isSameOrDescendant(path, root)),
  )
}

async function normalizeReadDeniedPaths(paths: ReadonlyArray<string>): Promise<string[]> {
  if (!Array.isArray(paths)) {
    throw new Error('runLocalHarness: codexReadDeniedPaths must be an array of absolute paths')
  }
  const normalized = new Set<string>()
  for (const path of paths) {
    if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || !isAbsolute(path)) {
      throw new Error('runLocalHarness: codexReadDeniedPaths must contain absolute paths')
    }
    const absolute = resolve(path)
    normalized.add(absolute)
    try {
      normalized.add(await realpath(absolute))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  return [...normalized].sort()
}
