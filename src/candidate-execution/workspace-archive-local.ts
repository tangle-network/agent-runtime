import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import type { AgentCandidateWorkspaceSnapshotEvidence } from '@tangle-network/agent-interface'
import {
  candidateWorkspaceManifest,
  captureMaterializedWorkspace,
  verifyMaterializedWorkspace,
} from './artifacts'
import { canonicalCandidateBytes, sha256Bytes } from './digest'
import {
  assertNoGitIndirection,
  readCandidateGitTreeFiles,
  runCandidateGit,
} from './git-materialize'
import type { AgentCandidateOutputArtifactPort, AgentCandidateWorkspacePort } from './types'
import {
  type AgentCandidateWorkspaceArchiveLimits,
  assertGitObjectId,
  assertWorkspaceFilesWithinLimits,
  type CapturedAgentCandidateWorkspace,
  captureWorkspaceFiles,
  decodeVerifiedWorkspaceArchive,
  safeArchivePath,
  type WorkspaceArchiveRepository,
  workspaceLimits,
} from './workspace-archive'

export interface CaptureAgentCandidateWorkspaceOptions {
  /** Include Git HEAD so task preparation can prove its exact commit and tree. */
  includeRepository?: boolean
  /**
   * `working-tree` preserves tracked and unignored untracked regular files, deletions, exact modes,
   * and the complete bounded Git index. Git-ignored files stay excluded. Requires includeRepository.
   * The caller must hold the workspace lease against writers; observed drift fails capture.
   * The manifest digest covers files, while the archive digest also binds HEAD and the index.
   */
  repositoryContents?: 'head' | 'working-tree'
  limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
  /** Use the evaluator-owned artifact store when manifest or archive bytes should not be embedded. */
  artifactPersistence?: {
    executionId: string
    outputArtifacts: AgentCandidateOutputArtifactPort
    signal?: AbortSignal
  }
}

export interface CreateAgentCandidateWorkspacePortOptions {
  limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
}

/** Capture one exact regular-file workspace for immutable candidate execution. */
export async function captureAgentCandidateWorkspace(
  rootInput: string,
  options: CaptureAgentCandidateWorkspaceOptions = {},
): Promise<CapturedAgentCandidateWorkspace> {
  const root = resolve(rootInput)
  const limits = workspaceLimits(options.limits)
  if (
    options.repositoryContents !== undefined &&
    options.repositoryContents !== 'head' &&
    options.repositoryContents !== 'working-tree'
  ) {
    throw new Error('candidate repositoryContents is invalid')
  }
  if (options.repositoryContents !== undefined && !options.includeRepository) {
    throw new Error('candidate repositoryContents requires includeRepository')
  }
  const captured = options.includeRepository
    ? await captureRepository(root, limits, options.repositoryContents === 'working-tree')
    : await captureMaterializedWorkspace(root, {
        limits: {
          maxFiles: limits.maxFiles,
          maxFileBytes: limits.maxFileBytes,
          maxTotalFileBytes: limits.maxTotalFileBytes,
        },
      })
  assertWorkspaceFilesWithinLimits(captured.files, limits)
  const repository = 'repository' in captured ? captured.repository : undefined
  return captureWorkspaceFiles(captured.files, repository, limits, options.artifactPersistence)
}

/** Create the standard bounded materializer for candidate execution ports. */
export function createAgentCandidateWorkspacePort(
  options: CreateAgentCandidateWorkspacePortOptions = {},
): AgentCandidateWorkspacePort {
  const limits = workspaceLimits(options.limits)
  const port: AgentCandidateWorkspacePort = {
    materialize: async ({ role, snapshot, archive, destination, signal }) => {
      await materializeAgentCandidateWorkspace({
        role,
        snapshot,
        archive,
        destination,
        limits,
        signal,
      })
    },
  }
  return Object.freeze(port)
}

async function materializeAgentCandidateWorkspace(input: {
  role: 'task' | 'candidate' | 'knowledge' | 'memory'
  snapshot: AgentCandidateWorkspaceSnapshotEvidence
  archive: Uint8Array
  destination: string
  limits: AgentCandidateWorkspaceArchiveLimits
  signal?: AbortSignal
}): Promise<void> {
  input.signal?.throwIfAborted()
  const decoded = await decodeVerifiedWorkspaceArchive(input)
  input.signal?.throwIfAborted()
  const destination = resolve(input.destination)
  await prepareEmptyDestination(destination, { createDestination: false })
  input.signal?.throwIfAborted()
  const staging = await mkdtemp(`${destination}.materializing-`)
  try {
    input.signal?.throwIfAborted()
    await writeWorkspaceFiles(staging, decoded.files, input.signal)
    if (decoded.repository) {
      await materializeRepository(decoded.repository, staging, input.limits, input.signal)
    }
    input.signal?.throwIfAborted()
    await verifyMaterializedWorkspace(staging, input.snapshot.material, {
      ignoredProtectedRootEntries: decoded.repository ? ['.git'] : [],
    })
    input.signal?.throwIfAborted()
    await rename(staging, destination)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

async function captureRepository(
  requestedRoot: string,
  limits: AgentCandidateWorkspaceArchiveLimits,
  workingTree: boolean,
): Promise<{
  files: Array<{ path: string; mode: number; bytes: Uint8Array }>
  repository: WorkspaceArchiveRepository
}> {
  const requestedStats = await lstat(requestedRoot)
  if (!requestedStats.isDirectory() || requestedStats.isSymbolicLink()) {
    throw new Error('candidate repository root must be a real directory')
  }
  // Capture the RESOLVED root. The property this guards is that capture starts at one real
  // worktree root with no aliasing, which resolving satisfies directly — rejecting a symlinked
  // prefix outright does not, and makes capture impossible on macOS, where the OS itself hands
  // out temp paths under /var, a symlink to /private/var. Git reports a resolved path, so the
  // worktree-root comparison below needs the resolved form on both sides.
  const root = await realpath(requestedRoot)
  const resolvedStats = await lstat(root)
  if (!resolvedStats.isDirectory() || resolvedStats.isSymbolicLink()) {
    throw new Error('candidate repository root must resolve to a real directory')
  }
  const topLevel = (await runCandidateGit(root, ['rev-parse', '--show-toplevel'])).stdout
    .toString('utf8')
    .trim()
  if ((await realpath(resolve(topLevel))) !== root) {
    throw new Error('candidate repository capture must start at the Git worktree root')
  }
  const gitDir = resolve(
    (await runCandidateGit(root, ['rev-parse', '--absolute-git-dir'])).stdout
      .toString('utf8')
      .trim(),
  )
  if ((await realpath(gitDir)) !== gitDir || gitDir.includes(':')) {
    throw new Error('candidate repository Git object store has an unsupported path')
  }
  await assertNoGitIndirection(root, gitDir, 'candidate repository')
  const headCommit = (await runCandidateGit(root, ['rev-parse', 'HEAD'])).stdout
    .toString('utf8')
    .trim()
  const headTree = (await runCandidateGit(root, ['rev-parse', 'HEAD^{tree}'])).stdout
    .toString('utf8')
    .trim()
  assertGitObjectId(headCommit, 'HEAD')
  assertGitObjectId(headTree, 'HEAD tree')
  if (headCommit.length !== headTree.length) {
    throw new Error('candidate repository HEAD and tree use different object formats')
  }
  const working = workingTree ? await captureRepositoryWorkingTree(root, limits) : undefined
  const files = working?.files ?? (await readCandidateGitTreeFiles(root, headTree, {}, limits))
  assertWorkspaceFilesWithinLimits(files, limits)
  const reachableBytesText = (
    await runCandidateGit(root, ['rev-list', '--disk-usage', '--objects', 'HEAD'])
  ).stdout
    .toString('utf8')
    .trim()
  const reachableBytes = Number(reachableBytesText)
  if (!Number.isSafeInteger(reachableBytes) || reachableBytes < 0) {
    throw new Error('candidate repository reachable size is invalid')
  }
  if (reachableBytes > limits.maxRepositoryBundleBytes) {
    throw new Error('candidate repository exceeds maxRepositoryBundleBytes')
  }
  const temporary = await mkdtemp(join(tmpdir(), 'agent-candidate-workspace-bundle-'))
  const bundlePath = join(temporary, `${randomUUID()}.bundle`)
  try {
    await runCandidateGit(root, ['bundle', 'create', bundlePath, 'HEAD'])
    const bundle = Uint8Array.from(await readFile(bundlePath))
    if (bundle.byteLength > limits.maxRepositoryBundleBytes) {
      throw new Error('candidate repository bundle exceeds maxRepositoryBundleBytes')
    }
    if (working) {
      const after = await readRepositoryWorkingState(root, limits)
      if (
        after.paths !== working.state.paths ||
        after.index !== working.state.index ||
        (await runCandidateGit(root, ['rev-parse', 'HEAD'])).stdout.toString('utf8').trim() !==
          headCommit
      ) {
        throw new Error('candidate repository changed during working-tree capture')
      }
      const presentPaths = await existingRepositoryPaths(root, after.paths, limits)
      if (presentPaths.join('\0') !== files.map((file) => file.path).join('\0')) {
        throw new Error('candidate repository files changed during working-tree capture')
      }
      await verifyMaterializedWorkspace(root, candidateWorkspaceManifest(files), {
        ignoredProtectedRootEntries: ['.git'],
        selectedPaths: files.map((file) => file.path),
      })
    }
    return {
      files,
      repository: {
        headCommit,
        headTree,
        bundle: {
          sha256: sha256Bytes(bundle),
          byteLength: bundle.byteLength,
          bytes: bundle,
        },
        ...(working
          ? {
              workingTree: { files: working.state.files },
            }
          : {}),
      },
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function readRepositoryWorkingState(
  root: string,
  limits: AgentCandidateWorkspaceArchiveLimits,
): Promise<{
  paths: string
  index: string
  files: Array<{ path: string; mode: number; bytes: Uint8Array }>
}> {
  const env = { GIT_OPTIONAL_LOCKS: '0' }
  const listingLimit = Math.min(
    limits.maxArchiveBytes,
    limits.maxFiles * (limits.maxPathBytes + 256),
  )
  const index = new TextDecoder('utf-8', { fatal: true }).decode(
    (
      await runCandidateGit(root, ['ls-files', '--stage', '-z'], undefined, env, {
        maxOutputBytes: listingLimit,
      })
    ).stdout,
  )
  const entries = index
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = /^(100644|100755) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t(.+)$/u.exec(entry)
      if (!match)
        throw new Error('candidate working-tree capture requires a resolved regular-file Git index')
      const [, mode, object, path] = match
      if (!object || !path) throw new Error('candidate Git index is invalid')
      return {
        path: safeArchivePath(path, limits.maxPathBytes),
        mode: mode === '100755' ? 0o755 : 0o644,
        object,
      }
    })
  if (entries.length > limits.maxFiles) throw new Error('candidate Git index exceeds maxFiles')
  const debugIndex = (
    await runCandidateGit(root, ['ls-files', '--debug', '-z'], undefined, env, {
      maxOutputBytes: listingLimit,
    })
  ).stdout.toString('utf8')
  if ([...debugIndex.matchAll(/\tflags: ([a-f0-9]+)\n/gu)].some((match) => match[1] !== '0')) {
    throw new Error('candidate working-tree capture does not support special Git index flags')
  }
  // Inspect every staged blob's size before reading any blob. A deleted or shortened working file
  // must not conceal an oversized staged version, including highly compressible binary content.
  const sizes = entries.length
    ? (
        await runCandidateGit(
          root,
          ['cat-file', '--batch-check'],
          Buffer.from(entries.map((entry) => entry.object).join('\n') + '\n'),
          env,
          { maxOutputBytes: listingLimit },
        )
      ).stdout
        .toString('utf8')
        .trimEnd()
        .split('\n')
    : []
  if (sizes.length !== entries.length)
    throw new Error('candidate Git index blob metadata is incomplete')
  let totalBytes = 0
  const byteLengths = entries.map((entry, index) => {
    const match = /^([a-f0-9]{40}|[a-f0-9]{64}) blob (\d+)$/u.exec(sizes[index] ?? '')
    const size = Number(match?.[2])
    if (!match || match[1] !== entry.object || !Number.isSafeInteger(size) || size < 0) {
      throw new Error('candidate Git index blob metadata is invalid')
    }
    if (size > limits.maxFileBytes)
      throw new Error(`candidate Git index file exceeds maxFileBytes: ${entry.path}`)
    if (size > limits.maxTotalFileBytes - totalBytes)
      throw new Error('candidate Git index exceeds maxTotalFileBytes')
    totalBytes += size
    return size
  })
  const files: Array<{ path: string; mode: number; bytes: Uint8Array }> = []
  for (const [index, entry] of entries.entries()) {
    const bytes = (
      await runCandidateGit(root, ['cat-file', 'blob', entry.object], undefined, env, {
        maxOutputBytes: limits.maxFileBytes,
      })
    ).stdout
    if (bytes.byteLength !== byteLengths[index])
      throw new Error('candidate Git index blob size changed')
    files.push({ path: entry.path, mode: entry.mode, bytes: Uint8Array.from(bytes) })
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  assertWorkspaceFilesWithinLimits(files, limits)
  const defaultExcludes = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'git',
    'ignore',
  )
  const excludes = new TextDecoder('utf-8', { fatal: true })
    .decode(
      (
        await runCandidateGit(
          root,
          [
            'config',
            '--includes',
            '--path',
            '--default',
            defaultExcludes,
            '--get',
            'core.excludesFile',
          ],
          undefined,
          {},
          { maxOutputBytes: limits.maxPathBytes, readUserExclusions: true },
        )
      ).stdout,
    )
    .replace(/\n$/u, '')
  const paths = new TextDecoder('utf-8', { fatal: true }).decode(
    (
      await runCandidateGit(
        root,
        [
          '-c',
          `core.excludesFile=${excludes}`,
          'ls-files',
          '--cached',
          '--others',
          '--exclude-standard',
          '-z',
        ],
        undefined,
        env,
        { maxOutputBytes: listingLimit },
      )
    ).stdout,
  )
  for (const path of paths.split('\0').filter(Boolean)) safeArchivePath(path, limits.maxPathBytes)
  return { paths, index, files }
}

async function captureRepositoryWorkingTree(
  root: string,
  limits: AgentCandidateWorkspaceArchiveLimits,
) {
  const state = await readRepositoryWorkingState(root, limits)
  const selectedPaths = await existingRepositoryPaths(root, state.paths, limits)
  const captured = await captureMaterializedWorkspace(root, {
    ignoredProtectedRootEntries: ['.git'],
    selectedPaths,
    limits,
  })
  const files = [...captured.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { state, files }
}

async function existingRepositoryPaths(
  root: string,
  listing: string,
  limits: AgentCandidateWorkspaceArchiveLimits,
): Promise<string[]> {
  const paths = [...new Set(listing.split('\0').filter(Boolean))].sort()
  if (paths.length > limits.maxFiles) throw new Error('candidate workspace exceeds maxFiles')
  const selectedPaths: string[] = []
  for (const path of paths) {
    const safe = safeArchivePath(path, limits.maxPathBytes)
    try {
      await lstat(workspacePath(root, safe))
      selectedPaths.push(safe)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
  return selectedPaths
}

export async function prepareEmptyDestination(
  destination: string,
  options: { createDestination?: boolean } = {},
): Promise<void> {
  await mkdir(options.createDestination === false ? dirname(destination) : destination, {
    recursive: true,
    mode: 0o700,
  })
  let stats
  try {
    stats = await lstat(destination)
  } catch (error) {
    if (options.createDestination === false && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return
    throw error
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('candidate workspace destination must be a real directory')
  }
  // A symlinked PREFIX is the OS's own doing on macOS, where temp paths live under /var, a
  // symlink to /private/var. What must hold is that the destination itself is a real
  // directory, which both this check and the lstat above require.
  const resolvedDestination = await realpath(destination)
  const resolvedStats = await lstat(resolvedDestination)
  if (!resolvedStats.isDirectory() || resolvedStats.isSymbolicLink()) {
    throw new Error('candidate workspace destination must resolve to a real directory')
  }
  if ((await readdir(destination)).length > 0) {
    throw new Error('candidate workspace destination must be empty')
  }
}

async function writeWorkspaceFiles(
  destination: string,
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>,
  signal?: AbortSignal,
): Promise<void> {
  for (const file of files) {
    signal?.throwIfAborted()
    const path = workspacePath(destination, file.path)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const descriptor = await open(
      path,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0),
      0o600,
    )
    try {
      signal?.throwIfAborted()
      await descriptor.writeFile(file.bytes, { signal })
      const stats = await descriptor.stat()
      if (!stats.isFile() || stats.nlink !== 1) {
        throw new Error(`candidate workspace file identity changed while writing: ${file.path}`)
      }
      await descriptor.chmod(file.mode)
      signal?.throwIfAborted()
    } finally {
      await descriptor.close()
    }
  }
}

async function materializeRepository(
  repository: WorkspaceArchiveRepository,
  destination: string,
  limits: AgentCandidateWorkspaceArchiveLimits,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const git = async (
    args: string[],
    bytes?: Uint8Array,
    options: { maxOutputBytes?: number } = {},
  ) => {
    signal?.throwIfAborted()
    const result = await runCandidateGit(destination, args, bytes, {}, options)
    signal?.throwIfAborted()
    return result
  }
  const temporary = await mkdtemp(join(tmpdir(), 'agent-candidate-workspace-bundle-'))
  const bundlePath = join(temporary, `${randomUUID()}.bundle`)
  try {
    signal?.throwIfAborted()
    await writeFile(bundlePath, repository.bundle.bytes, { flag: 'wx', mode: 0o600, signal })
    await git([
      'init',
      '--quiet',
      '--initial-branch=candidate',
      `--object-format=${repository.headCommit.length === 64 ? 'sha256' : 'sha1'}`,
    ])
    await git(['bundle', 'verify', bundlePath])
    await git(['bundle', 'unbundle', bundlePath])
    const objectType = (await git(['cat-file', '-t', repository.headCommit])).stdout
      .toString('utf8')
      .trim()
    if (objectType !== 'commit') throw new Error('candidate repository HEAD is not a commit')
    const observedTree = (await git(['rev-parse', `${repository.headCommit}^{tree}`])).stdout
      .toString('utf8')
      .trim()
    if (observedTree !== repository.headTree) {
      throw new Error('candidate repository bundle HEAD tree changed')
    }
    await git(['update-ref', '--no-deref', 'HEAD', repository.headCommit])
    await git(['read-tree', repository.headTree])
    if (repository.workingTree) {
      // All staged content has passed archive limits and manifest verification before Git sees it.
      // Rebuilding an index from explicit blobs avoids binary-patch expansion and diff configuration.
      await git(['read-tree', '--empty'])
      const entries: string[] = []
      for (const file of repository.workingTree.files) {
        const object = (
          await git(['hash-object', '-w', '--stdin'], file.bytes, { maxOutputBytes: 256 })
        ).stdout
          .toString('utf8')
          .trim()
        assertGitObjectId(object, 'staged blob')
        entries.push(`${file.mode === 0o755 ? '100755' : '100644'} ${object}\t${file.path}\0`)
      }
      if (entries.length)
        await git(['update-index', '-z', '--index-info'], Buffer.from(entries.join('')))
      const indexTree = (await git(['write-tree'])).stdout.toString('utf8').trim()
      const observed = await readCandidateGitTreeFiles(destination, indexTree, {}, limits)
      signal?.throwIfAborted()
      if (
        !Buffer.from(canonicalCandidateBytes(candidateWorkspaceManifest(observed))).equals(
          Buffer.from(
            canonicalCandidateBytes(candidateWorkspaceManifest(repository.workingTree.files)),
          ),
        )
      )
        throw new Error('candidate repository staged files do not match the captured index')
      return
    }

    const status = (await git(['status', '--porcelain=v1', '--untracked-files=all'])).stdout
      .toString('utf8')
      .trim()
    if (status) throw new Error('candidate repository files do not exactly match HEAD')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export function workspacePath(root: string, relativePath: string): string {
  const path = resolve(root, relativePath)
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error(`candidate workspace archive path escapes its destination: ${relativePath}`)
  }
  return path
}
