import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { isNodeError } from '../durable/atomic-record'
import {
  type FilesystemSnapshotEntry,
  type FilesystemSnapshotLimits,
  scanFilesystemTree,
} from '../filesystem-snapshot'

const snapshotKind = 'local-private-workspace-snapshot' as const

const sensitiveRootEntryNames = new Set([
  '.agent',
  '.agent-home',
  '.aws',
  '.azure',
  '.claude',
  '.codex',
  '.docker',
  '.gcloud',
  '.git-credentials',
  '.kube',
  '.mcp.json',
  '.netrc',
  '.npmrc',
  '.opencode',
  '.pi',
  '.pypirc',
  '.runs',
  '.ssh',
  'credentials',
  'credentials.json',
])

export type LocalPrivateWorkspaceRootEntryDisposition = 'include' | 'exclude'

/** Explicit decisions for tool state and credential-prone source-root entries. */
export interface LocalPrivateWorkspaceSourcePolicyInput {
  readonly rootEntries?: Readonly<Record<string, LocalPrivateWorkspaceRootEntryDisposition>>
}

export interface LocalPrivateWorkspaceSourcePolicyMaterial {
  readonly kind: 'agent-runtime/local-private-workspace-source-policy'
  readonly schemaVersion: 1
  readonly defaultRootEntryDisposition: 'include'
  readonly rootEntryDecisions: readonly {
    readonly name: string
    readonly disposition: LocalPrivateWorkspaceRootEntryDisposition
  }[]
  readonly trackedExclusions: 'reject'
  readonly worktreeHardlinks: 'dealias'
  readonly preparedWorkspaceSensitiveRootEntries: 'include'
  readonly gitMetadata: {
    readonly included: readonly string[]
    readonly sanitized: readonly string[]
    readonly omitted: readonly string[]
    readonly rejected: readonly string[]
  }
}

const gitMetadataPolicy = Object.freeze({
  included: Object.freeze([
    'HEAD',
    'index',
    'info/attributes',
    'info/exclude',
    'objects/**',
    'packed-refs',
    'refs/**',
    'shallow',
  ]),
  sanitized: Object.freeze([
    'config: repository format, filesystem semantics, branch upstreams, and fetch refspecs',
  ]),
  omitted: Object.freeze([
    'ai-agent-hooks/**',
    'branches/**',
    'description',
    'hooks/**',
    'logs/**',
    'lfs/**',
    'worktrees/**',
    'config: hooks, credentials, identities, remote URLs, and non-workspace behavior',
    'rr-cache/**',
    'transient command outputs',
  ]),
  rejected: Object.freeze([
    '*.lock',
    'alternates and grafts',
    'linked worktrees and submodules',
    'in-progress Git operations',
    'partial, sparse, split-index, and filesystem-monitor repositories',
    'unknown Git metadata',
  ]),
}) satisfies LocalPrivateWorkspaceSourcePolicyMaterial['gitMetadata']

export interface LocalPrivateWorkspaceGitConfigMaterial {
  readonly repositoryFormatVersion: 0 | 1
  readonly objectFormat: 'sha1' | 'sha256'
  readonly fileMode: boolean
  readonly ignoreCase?: boolean
  readonly symlinks?: boolean
  readonly precomposeUnicode?: boolean
  readonly branches: readonly {
    readonly name: string
    readonly remote?: string
    readonly merge: readonly string[]
  }[]
  readonly remotes: readonly {
    readonly name: string
    readonly fetch: readonly string[]
  }[]
}

export interface LocalPrivateWorkspaceSnapshotMaterial {
  readonly kind: typeof snapshotKind
  readonly schemaVersion: 1
  readonly policy: LocalPrivateWorkspaceSourcePolicyMaterial
  readonly worktree: readonly FilesystemSnapshotEntry[]
  readonly git?: {
    readonly config: LocalPrivateWorkspaceGitConfigMaterial
    readonly entries: readonly FilesystemSnapshotEntry[]
  }
}

export interface CapturedLocalPrivateWorkspaceSource {
  readonly root: string
  readonly digest: `sha256:${string}`
  readonly material: LocalPrivateWorkspaceSnapshotMaterial
  readonly fileCount: number
  readonly totalFileBytes: number
}

export interface CaptureStableLocalPrivateWorkspaceSourceOptions {
  readonly limits: FilesystemSnapshotLimits
  readonly sourcePolicy?: LocalPrivateWorkspaceSourcePolicyInput
  /** Require Git metadata to already match the provider's sanitized physical form. */
  readonly requireSanitizedGitMetadata?: boolean
  /** Test seam invoked between complete filesystem capture passes. */
  readonly afterCapturePass?: (pass: 1 | 2) => void | Promise<void>
}

/** The source did not remain identical across two complete capture passes. */
export class LocalPrivateWorkspaceSourceChangedError extends Error {
  readonly code = 'source_changed' as const

  constructor(
    message = 'local private workspace source changed during capture',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LocalPrivateWorkspaceSourceChangedError'
  }
}

/** Capture the same complete logical state twice before attesting it. */
export async function captureStableLocalPrivateWorkspaceSource(
  rootInput: string,
  options: CaptureStableLocalPrivateWorkspaceSourceOptions,
): Promise<CapturedLocalPrivateWorkspaceSource> {
  let firstDigest: `sha256:${string}`
  let second: CapturedLocalPrivateWorkspaceSource
  try {
    firstDigest = (
      await captureLocalPrivateWorkspaceSource(
        rootInput,
        options.limits,
        options.sourcePolicy,
        options.requireSanitizedGitMetadata,
      )
    ).digest
    await options.afterCapturePass?.(1)
    second = await captureLocalPrivateWorkspaceSource(
      rootInput,
      options.limits,
      options.sourcePolicy,
      options.requireSanitizedGitMetadata,
    )
    await options.afterCapturePass?.(2)
  } catch (error) {
    if (error instanceof LocalPrivateWorkspaceSourceChangedError) throw error
    if (error instanceof Error && error.message.includes('changed while being captured')) {
      throw new LocalPrivateWorkspaceSourceChangedError(undefined, { cause: error })
    }
    throw error
  }
  if (firstDigest !== second.digest) {
    throw new LocalPrivateWorkspaceSourceChangedError()
  }
  return second
}

/** Reflink/copy a captured source while constructing independent, sanitized Git metadata. */
export async function copyLocalPrivateWorkspaceSource(
  snapshot: CapturedLocalPrivateWorkspaceSource,
  destinationInput: string,
): Promise<void> {
  const destination = resolve(destinationInput)
  const destinationStats = await lstat(destination)
  if (
    !destinationStats.isDirectory() ||
    destinationStats.isSymbolicLink() ||
    (await realpath(destination)) !== destination ||
    (await readdir(destination)).length > 0
  ) {
    throw new Error('local private workspace copy destination must be an empty real directory')
  }
  const children = await readdir(snapshot.root, { withFileTypes: true })
  const excludedRootEntries = new Set(
    snapshot.material.policy.rootEntryDecisions
      .filter((decision) => decision.disposition === 'exclude')
      .map((decision) => decision.name),
  )
  const admittedChildren = children.filter(
    (child) => child.name !== '.git' && !excludedRootEntries.has(child.name),
  )
  await mapConcurrent(admittedChildren, 16, async (child) => {
    await cp(join(snapshot.root, child.name), join(destination, child.name), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      preserveTimestamps: true,
      force: false,
      errorOnExist: true,
      mode: fsConstants.COPYFILE_FICLONE,
    })
  })
  if (!snapshot.material.git) return
  const gitRoot = join(destination, '.git')
  await mkdir(gitRoot, { mode: 0o700 })
  const sourceGitRoot = join(snapshot.root, '.git')
  const directories = snapshot.material.git.entries.filter((entry) => entry.kind === 'directory')
  for (const directory of directories) {
    if (
      directory.path === 'objects' ||
      directory.path.startsWith('objects/') ||
      directory.path === 'refs' ||
      directory.path.startsWith('refs/')
    ) {
      continue
    }
    await mkdir(join(gitRoot, directory.path), { recursive: true, mode: 0o700 })
  }
  for (const rootDirectory of ['objects', 'refs']) {
    if (!snapshot.material.git.entries.some((entry) => entry.path === rootDirectory)) continue
    await cp(join(sourceGitRoot, rootDirectory), join(gitRoot, rootDirectory), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      preserveTimestamps: true,
      force: false,
      errorOnExist: true,
      mode: fsConstants.COPYFILE_FICLONE,
    })
  }
  for (const entry of snapshot.material.git.entries) {
    if (
      entry.kind !== 'file' ||
      entry.path === 'config' ||
      entry.path.startsWith('objects/') ||
      entry.path.startsWith('refs/')
    ) {
      continue
    }
    const destinationPath = join(gitRoot, entry.path)
    await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 })
    await copyFile(join(sourceGitRoot, entry.path), destinationPath, fsConstants.COPYFILE_FICLONE)
    await chmod(destinationPath, entry.mode)
  }
  await writeFile(join(gitRoot, 'config'), renderSafeGitConfig(snapshot.material.git.config), {
    flag: 'wx',
    mode: 0o600,
  })
  directories.sort((left, right) => right.path.split('/').length - left.path.split('/').length)
  for (const directory of directories) {
    await chmod(join(gitRoot, directory.path), directory.mode)
  }
}

/** Recompute the canonical logical state of an already materialized workspace. */
export async function digestLocalPrivateWorkspace(
  root: string,
  limits: FilesystemSnapshotLimits,
  sourcePolicy: LocalPrivateWorkspaceSourcePolicyInput,
): Promise<`sha256:${string}`> {
  return (
    await captureStableLocalPrivateWorkspaceSource(root, {
      limits,
      sourcePolicy,
      requireSanitizedGitMetadata: true,
    })
  ).digest
}

/** Digest an isolated prepared workspace, explicitly including every sensitive root entry. */
export async function digestPreparedLocalPrivateWorkspace(
  root: string,
  limits: FilesystemSnapshotLimits,
  governingPolicy: LocalPrivateWorkspaceSourcePolicyMaterial,
): Promise<`sha256:${string}`> {
  const rootEntries: Record<string, LocalPrivateWorkspaceRootEntryDisposition> = {}
  for (const entry of await readdir(resolve(root), { withFileTypes: true })) {
    if (isSensitiveRootEntry(entry.name)) rootEntries[entry.name] = 'include'
  }
  const captured = await captureStableLocalPrivateWorkspaceSource(root, {
    limits,
    sourcePolicy: { rootEntries },
    requireSanitizedGitMetadata: true,
  })
  return canonicalCandidateDigest({
    kind: 'agent-runtime/local-private-prepared-workspace-snapshot',
    schemaVersion: 1,
    sourcePolicyDigest: localPrivateWorkspaceSourcePolicyDigest(governingPolicy),
    capturedWorkspace: captured.material,
  })
}

export function sourcePolicyInputFromMaterial(
  material: LocalPrivateWorkspaceSourcePolicyMaterial,
): LocalPrivateWorkspaceSourcePolicyInput {
  return Object.freeze({
    rootEntries: Object.freeze(
      Object.fromEntries(
        material.rootEntryDecisions.map((decision) => [decision.name, decision.disposition]),
      ),
    ),
  })
}

export function localPrivateWorkspaceSnapshotDigest(
  material: LocalPrivateWorkspaceSnapshotMaterial,
): `sha256:${string}` {
  return canonicalCandidateDigest(material)
}

export function localPrivateWorkspaceSourcePolicyDigest(
  material: LocalPrivateWorkspaceSourcePolicyMaterial,
): `sha256:${string}` {
  assertLocalPrivateWorkspaceSourcePolicyMaterial(material)
  return canonicalCandidateDigest(material)
}

export function assertLocalPrivateWorkspaceSourcePolicyMaterial(
  value: unknown,
): asserts value is LocalPrivateWorkspaceSourcePolicyMaterial {
  if (!isRecord(value)) throw new Error('local private workspace source policy is not an object')
  assertExactKeys(
    value,
    [
      'defaultRootEntryDisposition',
      'gitMetadata',
      'kind',
      'preparedWorkspaceSensitiveRootEntries',
      'rootEntryDecisions',
      'schemaVersion',
      'trackedExclusions',
      'worktreeHardlinks',
    ],
    'source policy',
  )
  if (
    value.kind !== 'agent-runtime/local-private-workspace-source-policy' ||
    value.schemaVersion !== 1 ||
    value.defaultRootEntryDisposition !== 'include' ||
    value.preparedWorkspaceSensitiveRootEntries !== 'include' ||
    value.trackedExclusions !== 'reject' ||
    value.worktreeHardlinks !== 'dealias' ||
    !Array.isArray(value.rootEntryDecisions)
  ) {
    throw new Error('local private workspace source policy header is invalid')
  }
  let previous = ''
  for (const decision of value.rootEntryDecisions) {
    if (!isRecord(decision)) {
      throw new Error('local private workspace source policy decision is invalid')
    }
    assertExactKeys(decision, ['disposition', 'name'], 'source policy decision')
    if (typeof decision.name !== 'string') {
      throw new Error('local private workspace source policy decision name is invalid')
    }
    assertRootEntryName(decision.name)
    if (
      (decision.disposition !== 'include' && decision.disposition !== 'exclude') ||
      decision.name <= previous
    ) {
      throw new Error('local private workspace source policy decisions are invalid or unsorted')
    }
    previous = decision.name
  }
  if (canonicalCandidateDigest(value.gitMetadata) !== canonicalCandidateDigest(gitMetadataPolicy)) {
    throw new Error('local private workspace Git metadata policy is invalid')
  }
}

async function captureLocalPrivateWorkspaceSource(
  rootInput: string,
  limits: FilesystemSnapshotLimits,
  sourcePolicyInput: LocalPrivateWorkspaceSourcePolicyInput | undefined,
  requireSanitizedGitMetadata = false,
): Promise<CapturedLocalPrivateWorkspaceSource> {
  const root = resolve(rootInput)
  const rootStats = await lstat(root)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || (await realpath(root)) !== root) {
    throw new Error('local private workspace source must be a real directory')
  }

  const ambiguousGitEntry = (await readdir(root)).find(
    (name) => portableRootEntryName(name) === '.git' && name !== '.git',
  )
  if (ambiguousGitEntry) {
    throw new Error(
      `local private workspace source contains ambiguous Git metadata: ${ambiguousGitEntry}`,
    )
  }

  const gitPath = join(root, '.git')
  const gitStats = await optionalLstat(gitPath)
  if (gitStats && !gitStats.isDirectory()) {
    throw new Error(
      'local private workspace source uses linked-worktree or submodule Git metadata; this provider refuses Git indirection',
    )
  }

  const policy = await resolveSourcePolicy(root, gitStats !== undefined, sourcePolicyInput)
  const excludedRootEntries = new Set(
    policy.rootEntryDecisions
      .filter((decision) => decision.disposition === 'exclude')
      .map((decision) => decision.name),
  )

  const worktree = await scanFilesystemTree(root, {
    label: 'local private workspace source',
    excludedRootEntries: new Set(['.git', ...excludedRootEntries]),
    includeDirectories: true,
    countAllEntriesAgainstMaxFiles: true,
    symlinks: 'internal',
    hardlinks: 'copy',
    rejectNestedGitMetadata: true,
    entryPolicy: (path) => {
      if (
        !path.includes('/') &&
        isSensitiveRootEntry(path) &&
        !policy.rootEntryDecisions.some((decision) => decision.name === path)
      ) {
        throw new Error(
          `local private workspace source policy must explicitly include or exclude sensitive root entry: ${path}`,
        )
      }
      return 'include'
    },
    forbiddenSymlinkPrefixes: [
      ...(gitStats ? [gitPath] : []),
      ...[...excludedRootEntries].map((name) => join(root, name)),
    ],
    limits,
  })
  const worktreeEntryCount = worktree.manifest.length
  const worktreeFileCount = worktree.manifest.filter((entry) => entry.kind === 'file').length
  const git = gitStats
    ? await captureGitMetadata(
        gitPath,
        {
          ...limits,
          maxFiles: limits.maxFiles - worktreeEntryCount,
          maxTotalFileBytes: limits.maxTotalFileBytes - worktree.totalFileBytes,
        },
        requireSanitizedGitMetadata,
      )
    : undefined
  const material: LocalPrivateWorkspaceSnapshotMaterial = Object.freeze({
    kind: snapshotKind,
    schemaVersion: 1,
    policy,
    worktree: worktree.manifest,
    ...(git
      ? {
          git: Object.freeze({
            config: git.config,
            entries: git.manifest,
          }),
        }
      : {}),
  })
  return Object.freeze({
    root,
    digest: localPrivateWorkspaceSnapshotDigest(material),
    material,
    fileCount:
      worktreeFileCount + (git?.manifest.filter((entry) => entry.kind === 'file').length ?? 0),
    totalFileBytes: worktree.totalFileBytes + (git?.totalFileBytes ?? 0),
  })
}

async function captureGitMetadata(
  gitRoot: string,
  limits: FilesystemSnapshotLimits,
  requireSanitized: boolean,
): Promise<{
  config: LocalPrivateWorkspaceGitConfigMaterial
  manifest: readonly FilesystemSnapshotEntry[]
  totalFileBytes: number
}> {
  if (limits.maxFiles <= 1 || limits.maxTotalFileBytes <= 1) {
    throw new Error('local private workspace source exceeds its combined filesystem limits')
  }
  const config = await readSafeGitConfig(join(gitRoot, 'config'))
  const renderedConfig = renderSafeGitConfig(config)
  if (requireSanitized) {
    const configPath = join(gitRoot, 'config')
    const details = await lstat(configPath)
    const physicalConfig = await readFile(configPath)
    if (
      !details.isFile() ||
      details.isSymbolicLink() ||
      details.nlink !== 1 ||
      (details.mode & 0o777) !== 0o600 ||
      !physicalConfig.equals(Buffer.from(renderedConfig, 'utf8'))
    ) {
      throw new Error(
        'local private prepared workspace Git config is not the canonical sanitized config',
      )
    }
  }
  const renderedConfigBytes = Buffer.byteLength(renderedConfig, 'utf8')
  if (renderedConfigBytes >= limits.maxTotalFileBytes) {
    throw new Error('local private workspace source exceeds maxTotalFileBytes')
  }
  const captured = await scanFilesystemTree(gitRoot, {
    label: 'local private workspace Git metadata',
    includeDirectories: true,
    countAllEntriesAgainstMaxFiles: true,
    symlinks: 'reject',
    hardlinks: 'copy',
    entryPolicy: (path, kind) => {
      const classification = classifyGitMetadataPath(path, kind)
      if (classification === 'reject') {
        throw new Error(`local private workspace source has unsupported Git state: ${path}`)
      }
      if (requireSanitized && classification === 'ignore' && path !== 'config') {
        throw new Error(`local private prepared workspace contains omitted Git metadata: ${path}`)
      }
      return classification === 'include' ? 'include' : 'skip'
    },
    limits: {
      ...limits,
      maxFiles: limits.maxFiles - 1,
      maxTotalFileBytes: limits.maxTotalFileBytes - renderedConfigBytes,
    },
  })
  const selected: FilesystemSnapshotEntry[] = [...captured.manifest]
  selected.push(manifestFile('config', 0o600, Buffer.from(renderedConfig, 'utf8')))
  selected.sort((left, right) => comparePath(left.path, right.path))
  return Object.freeze({
    config,
    manifest: Object.freeze(selected),
    totalFileBytes: captured.totalFileBytes + renderedConfigBytes,
  })
}

async function resolveSourcePolicy(
  root: string,
  hasGit: boolean,
  input: LocalPrivateWorkspaceSourcePolicyInput | undefined,
): Promise<LocalPrivateWorkspaceSourcePolicyMaterial> {
  const decisions = Object.entries(input?.rootEntries ?? {})
    .map(([name, disposition]) => {
      assertRootEntryName(name)
      if (portableRootEntryName(name) === '.git') {
        throw new Error(
          'local private workspace source policy cannot override protected .git handling',
        )
      }
      if (disposition !== 'include' && disposition !== 'exclude') {
        throw new Error(`local private workspace source policy has invalid disposition: ${name}`)
      }
      return Object.freeze({ name, disposition })
    })
    .sort((left, right) => comparePath(left.name, right.name))
  const decisionByName = new Map(decisions.map((decision) => [decision.name, decision.disposition]))
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (isSensitiveRootEntry(entry.name) && !decisionByName.has(entry.name)) {
      throw new Error(
        `local private workspace source policy must explicitly include or exclude sensitive root entry: ${entry.name}`,
      )
    }
  }
  const excluded = decisions
    .filter((decision) => decision.disposition === 'exclude')
    .map((decision) => decision.name)
  if (hasGit && excluded.length > 0) {
    await readSafeGitConfig(join(root, '.git', 'config'))
    const tracked = await listTrackedPaths(root)
    for (const rootEntry of excluded) {
      const trackedPath = tracked.find(
        (path) => path === rootEntry || path.startsWith(`${rootEntry}/`),
      )
      if (trackedPath) {
        throw new Error(
          `local private workspace source policy cannot exclude Git-tracked path: ${trackedPath}`,
        )
      }
    }
  }
  return Object.freeze({
    kind: 'agent-runtime/local-private-workspace-source-policy',
    schemaVersion: 1,
    defaultRootEntryDisposition: 'include',
    rootEntryDecisions: Object.freeze(decisions),
    trackedExclusions: 'reject',
    worktreeHardlinks: 'dealias',
    preparedWorkspaceSensitiveRootEntries: 'include',
    gitMetadata: gitMetadataPolicy,
  })
}

function isSensitiveRootEntry(name: string): boolean {
  const portableName = portableRootEntryName(name)
  return (
    sensitiveRootEntryNames.has(portableName) ||
    portableName === '.env' ||
    portableName.startsWith('.env.')
  )
}

function portableRootEntryName(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[ .]+$/u, '')
    .toLowerCase()
}

function assertRootEntryName(name: string): void {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    Buffer.byteLength(name, 'utf8') > 1_024
  ) {
    throw new Error(`local private workspace source policy has invalid root entry: ${name}`)
  }
}

function listTrackedPaths(root: string): Promise<readonly string[]> {
  return new Promise((resolveResult, rejectResult) => {
    execFile(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-C', root, 'ls-files', '-z', '--cached'],
      {
        encoding: 'buffer',
        maxBuffer: 128 * 1024 * 1024,
        env: safeGitEnvironment(),
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectResult(
            new Error(
              `local private workspace could not inspect tracked paths: ${String(stderr)}`,
              {
                cause: error,
              },
            ),
          )
          return
        }
        resolveResult(
          Object.freeze(
            Buffer.from(stdout).toString('utf8').split('\0').filter(Boolean).sort(comparePath),
          ),
        )
      },
    )
  })
}

function classifyGitMetadataPath(
  path: string,
  kind: 'directory' | 'file' | 'symlink' | 'other',
): 'include' | 'ignore' | 'reject' {
  const segments = path.split('/')
  const root = segments[0] ?? ''
  if (segments.some((segment) => segment.endsWith('.lock'))) return 'reject'
  if (
    path === 'objects/info/alternates' ||
    path === 'objects/info/http-alternates' ||
    path === 'info/grafts'
  ) {
    return 'reject'
  }
  if (
    [
      'commondir',
      'gitdir',
      'modules',
      'config.worktree',
      'rebase-merge',
      'rebase-apply',
      'sequencer',
    ].includes(root) ||
    root.startsWith('sharedindex.') ||
    /^(?:MERGE|CHERRY_PICK|REVERT|REBASE|BISECT|SQUASH)_/.test(root) ||
    root === 'AUTO_MERGE'
  ) {
    return 'reject'
  }
  if (root === 'objects' || root === 'refs') return 'include'
  if (path === 'info' && kind === 'directory') return 'include'
  if (['HEAD', 'index', 'packed-refs', 'shallow'].includes(path)) return 'include'
  if (['info/exclude', 'info/attributes'].includes(path)) return 'include'
  if (path === 'config') return 'ignore'
  if (
    [
      'ai-agent-hooks',
      'branches',
      'description',
      'hooks',
      'logs',
      'rr-cache',
      'lfs',
      'worktrees',
    ].includes(root) ||
    ['COMMIT_EDITMSG', 'FETCH_HEAD', 'ORIG_HEAD', 'gc.log'].includes(path) ||
    path === 'info/refs'
  ) {
    return 'ignore'
  }
  return 'reject'
}

async function readSafeGitConfig(path: string): Promise<LocalPrivateWorkspaceGitConfigMaterial> {
  const details = await lstat(path)
  if (!details.isFile() || details.isSymbolicLink() || details.size > 16 * 1024 * 1024) {
    throw new Error('local private workspace source Git config must be a bounded regular file')
  }
  const entries = parseGitConfigEntries(await gitConfigList(path))
  const records = groupGitConfigRecords(entries)
  rejectUnsafeGitFeatures(records)
  const repositoryFormatVersion = integerConfig(records, 'core.repositoryformatversion', 0)
  if (repositoryFormatVersion !== 0 && repositoryFormatVersion !== 1) {
    throw new Error('local private workspace source has unsupported Git repository format')
  }
  const objectFormat = singleConfig(records, 'extensions.objectformat') ?? 'sha1'
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
    throw new Error('local private workspace source has unsupported Git object format')
  }
  return Object.freeze({
    repositoryFormatVersion,
    objectFormat,
    fileMode: booleanConfig(records, 'core.filemode', true),
    ...optionalBooleanConfig(records, 'core.ignorecase', 'ignoreCase'),
    ...optionalBooleanConfig(records, 'core.symlinks', 'symlinks'),
    ...optionalBooleanConfig(records, 'core.precomposeunicode', 'precomposeUnicode'),
    branches: captureBranchConfig(entries),
    remotes: captureRemoteConfig(entries),
  })
}

function rejectUnsafeGitFeatures(records: ReadonlyMap<string, readonly string[]>): void {
  if (booleanConfig(records, 'core.bare', false)) {
    throw new Error('local private workspace source must not be a bare Git repository')
  }
  for (const key of [
    'core.worktree',
    'extensions.worktreeconfig',
    'extensions.partialclone',
    'core.sparsecheckout',
    'core.sparsecheckoutcone',
    'core.splitindex',
    'core.fsmonitor',
  ]) {
    const value = singleConfig(records, key)
    if (value !== undefined && value.toLowerCase() !== 'false') {
      throw new Error(`local private workspace source uses unsupported Git config: ${key}`)
    }
  }
  for (const key of records.keys()) {
    if (key.startsWith('extensions.') && key !== 'extensions.objectformat') {
      throw new Error(`local private workspace source uses unsupported Git extension: ${key}`)
    }
    if (
      ![
        'core.bare',
        'core.filemode',
        'core.hookspath',
        'core.ignorecase',
        'core.logallrefupdates',
        'core.precomposeunicode',
        'core.repositoryformatversion',
        'core.symlinks',
        'extensions.objectformat',
      ].includes(key) &&
      !['branch.', 'credential.', 'remote.', 'user.'].some((prefix) => key.startsWith(prefix))
    ) {
      throw new Error(`local private workspace source uses unsupported Git config key: ${key}`)
    }
  }
}

function renderSafeGitConfig(config: LocalPrivateWorkspaceGitConfigMaterial): string {
  const core = [
    `[core]`,
    `\trepositoryformatversion = ${config.repositoryFormatVersion}`,
    `\tfilemode = ${String(config.fileMode)}`,
    '\tbare = false',
    '\tlogallrefupdates = true',
    '\thooksPath = /dev/null',
    ...(config.ignoreCase === undefined ? [] : [`\tignorecase = ${String(config.ignoreCase)}`]),
    ...(config.symlinks === undefined ? [] : [`\tsymlinks = ${String(config.symlinks)}`]),
    ...(config.precomposeUnicode === undefined
      ? []
      : [`\tprecomposeunicode = ${String(config.precomposeUnicode)}`]),
  ]
  const extensions =
    config.objectFormat === 'sha256' ? ['[extensions]', '\tobjectFormat = sha256'] : []
  const remotes = config.remotes.flatMap((remote) => [
    `[remote ${quoteGitConfig(remote.name)}]`,
    ...remote.fetch.map((fetch) => `\tfetch = ${quoteGitConfig(fetch)}`),
  ])
  const branches = config.branches.flatMap((branch) => [
    `[branch ${quoteGitConfig(branch.name)}]`,
    ...(branch.remote === undefined ? [] : [`\tremote = ${quoteGitConfig(branch.remote)}`]),
    ...branch.merge.map((merge) => `\tmerge = ${quoteGitConfig(merge)}`),
  ])
  return `${[...core, ...extensions, ...remotes, ...branches].join('\n')}\n`
}

function gitConfigList(path: string): Promise<Buffer> {
  return new Promise((resolveResult, rejectResult) => {
    execFile(
      'git',
      ['config', '--file', path, '--null', '--no-includes', '--list'],
      {
        encoding: 'buffer',
        maxBuffer: 16 * 1024 * 1024,
        env: safeGitEnvironment(),
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectResult(
            new Error(`local private workspace could not read Git config: ${String(stderr)}`, {
              cause: error,
            }),
          )
          return
        }
        resolveResult(Buffer.from(stdout))
      },
    )
  })
}

function safeGitEnvironment(): NodeJS.ProcessEnv {
  const ambient = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
  )
  return {
    ...ambient,
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  }
}

interface GitConfigEntry {
  readonly key: string
  readonly normalizedKey: string
  readonly value: string
}

function parseGitConfigEntries(bytes: Buffer): readonly GitConfigEntry[] {
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new Error('local private workspace Git config is not valid UTF-8', { cause: error })
  }
  const entries: GitConfigEntry[] = []
  for (const encoded of decoded.split('\0')) {
    if (!encoded) continue
    const separator = encoded.indexOf('\n')
    if (separator < 1) throw new Error('local private workspace Git config output is invalid')
    const key = encoded.slice(0, separator)
    entries.push(
      Object.freeze({
        key,
        normalizedKey: key.toLowerCase(),
        value: encoded.slice(separator + 1),
      }),
    )
  }
  return Object.freeze(entries)
}

function groupGitConfigRecords(
  entries: readonly GitConfigEntry[],
): ReadonlyMap<string, readonly string[]> {
  const records = new Map<string, string[]>()
  for (const entry of entries) {
    const values = records.get(entry.normalizedKey) ?? []
    values.push(entry.value)
    records.set(entry.normalizedKey, values)
  }
  return records
}

function captureBranchConfig(
  entries: readonly GitConfigEntry[],
): LocalPrivateWorkspaceGitConfigMaterial['branches'] {
  const branches = new Map<string, { remote: string[]; merge: string[] }>()
  for (const entry of entries) {
    const match = /^branch\.(.+)\.(remote|merge)$/i.exec(entry.key)
    if (!match) continue
    const name = checkedGitConfigString(match[1] as string, 'branch name', 1_024)
    const field = (match[2] as string).toLowerCase() as 'remote' | 'merge'
    const branch = branches.get(name) ?? { remote: [], merge: [] }
    branch[field].push(checkedGitConfigString(entry.value, `branch ${field}`, 4_096))
    branches.set(name, branch)
  }
  return Object.freeze(
    [...branches.entries()]
      .sort(([left], [right]) => comparePath(left, right))
      .map(([name, branch]) => {
        if (branch.remote.length > 1) {
          throw new Error(`local private workspace Git config repeats branch remote: ${name}`)
        }
        return Object.freeze({
          name,
          ...(branch.remote[0] === undefined ? {} : { remote: branch.remote[0] }),
          merge: Object.freeze([...branch.merge]),
        })
      }),
  )
}

function captureRemoteConfig(
  entries: readonly GitConfigEntry[],
): LocalPrivateWorkspaceGitConfigMaterial['remotes'] {
  const remotes = new Map<string, string[]>()
  for (const entry of entries) {
    const match = /^remote\.(.+)\.fetch$/i.exec(entry.key)
    if (!match) continue
    const name = checkedGitConfigString(match[1] as string, 'remote name', 1_024)
    const fetch = remotes.get(name) ?? []
    fetch.push(checkedGitConfigString(entry.value, 'remote fetch refspec', 4_096))
    remotes.set(name, fetch)
  }
  return Object.freeze(
    [...remotes.entries()]
      .sort(([left], [right]) => comparePath(left, right))
      .map(([name, fetch]) =>
        Object.freeze({
          name,
          fetch: Object.freeze([...fetch]),
        }),
      ),
  )
}

function checkedGitConfigString(value: string, label: string, maxBytes: number): string {
  if (
    !value ||
    Buffer.byteLength(value, 'utf8') > maxBytes ||
    value.includes('\0') ||
    [...value].some((character) => {
      const code = character.codePointAt(0) as number
      return code < 0x20 || code === 0x7f
    })
  ) {
    throw new Error(`local private workspace Git config has unsafe ${label}`)
  }
  return value
}

function quoteGitConfig(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function singleConfig(
  records: ReadonlyMap<string, readonly string[]>,
  key: string,
): string | undefined {
  const values = records.get(key)
  if (!values) return undefined
  if (values.length !== 1) {
    throw new Error(`local private workspace Git config repeats protected key: ${key}`)
  }
  return values[0]
}

function integerConfig(
  records: ReadonlyMap<string, readonly string[]>,
  key: string,
  fallback: number,
): number {
  const value = singleConfig(records, key)
  if (value === undefined) return fallback
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`local private workspace Git config has invalid integer: ${key}`)
  }
  return Number(value)
}

function booleanConfig(
  records: ReadonlyMap<string, readonly string[]>,
  key: string,
  fallback: boolean,
): boolean {
  const value = singleConfig(records, key)
  if (value === undefined) return fallback
  if (['true', 'yes', 'on', '1'].includes(value.toLowerCase())) return true
  if (['false', 'no', 'off', '0', ''].includes(value.toLowerCase())) return false
  throw new Error(`local private workspace Git config has invalid boolean: ${key}`)
}

function optionalBooleanConfig<K extends string>(
  records: ReadonlyMap<string, readonly string[]>,
  key: string,
  outputKey: K,
): { [P in K]?: boolean } {
  if (!records.has(key)) return {}
  return { [outputKey]: booleanConfig(records, key, false) } as { [P in K]?: boolean }
}

function manifestFile(path: string, mode: number, bytes: Uint8Array): FilesystemSnapshotEntry {
  return Object.freeze({
    kind: 'file',
    path,
    mode,
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
  })
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

async function optionalLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return undefined
    throw error
  }
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

async function mapConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++
        await operation(values[index] as T)
      }
    }),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(comparePath)
  const required = [...expected].sort(comparePath)
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`local private workspace ${label} fields are invalid`)
  }
}

export function assertDisjointPrivateWorkspaceRoots(sourceRoot: string, managerRoot: string): void {
  const source = resolve(sourceRoot)
  const manager = resolve(managerRoot)
  if (
    source === manager ||
    source.startsWith(`${manager}${sep}`) ||
    manager.startsWith(`${source}${sep}`)
  ) {
    throw new Error('local private workspace source and manager roots must be disjoint')
  }
}
