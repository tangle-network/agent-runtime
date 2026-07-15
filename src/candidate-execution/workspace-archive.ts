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
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep, win32 } from 'node:path'
import { isAnyArrayBuffer, isSharedArrayBuffer } from 'node:util/types'

import type {
  AgentCandidateCapturedArtifact,
  AgentCandidateWorkspaceSnapshotEvidence,
} from '@tangle-network/agent-interface'
import { type Entry, extract, type Pack, pack } from 'tar-stream'

import {
  candidateWorkspaceManifest,
  captureMaterializedWorkspace,
  verifyBytes,
  verifyMaterializedWorkspace,
} from './artifacts'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  deepFreezeCandidate,
  embeddedCandidateArtifact,
  sha256Bytes,
} from './digest'
import {
  assertNoGitIndirection,
  readCandidateGitTreeFiles,
  runCandidateGit,
} from './git-materialize'
import { persistCandidateOutputArtifact } from './output-artifacts'
import type {
  AgentCandidateExecutorWorkspaceFile,
  AgentCandidateOutputArtifactPort,
  AgentCandidateWorkspacePort,
} from './types'

const archiveKind = 'agent-candidate-workspace-archive' as const
const workspaceEntryPrefix = 'workspace/'
const repositoryMetadataEntry = 'metadata/repository.json'
const repositoryBundleEntry = 'metadata/repository.bundle'
const fixedTarTime = new Date(0)

export interface AgentCandidateWorkspaceArchiveLimits {
  maxArchiveBytes: number
  maxEmbeddedArtifactBytes: number
  maxFiles: number
  maxFileBytes: number
  maxTotalFileBytes: number
  maxPathBytes: number
  maxRepositoryBundleBytes: number
}

const defaultLimits: AgentCandidateWorkspaceArchiveLimits = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEmbeddedArtifactBytes: 1024 * 1024,
  maxFiles: 50_000,
  maxFileBytes: 128 * 1024 * 1024,
  maxTotalFileBytes: 256 * 1024 * 1024,
  maxPathBytes: 4_096,
  maxRepositoryBundleBytes: 128 * 1024 * 1024,
})

interface WorkspaceArchiveRepository {
  headCommit: string
  headTree: string
  bundle: {
    sha256: `sha256:${string}`
    byteLength: number
    bytes: Uint8Array
  }
}

interface WorkspaceArchiveRepositoryMetadata {
  kind: typeof archiveKind
  headCommit: string
  headTree: string
  bundle: {
    sha256: `sha256:${string}`
    byteLength: number
  }
}

interface DecodedWorkspaceArchive {
  files: Array<{ path: string; mode: number; bytes: Uint8Array }>
  repository?: WorkspaceArchiveRepository
}

export interface CaptureAgentCandidateWorkspaceOptions {
  /** Include Git HEAD so task preparation can prove its exact commit and tree. */
  includeRepository?: boolean
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

export interface CapturedAgentCandidateWorkspace {
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  /** Caller-owned bytes accepted by createAgentCandidateWorkspacePort. */
  readonly archive: Uint8Array
}

/** Capture one exact regular-file workspace for immutable candidate execution. */
export async function captureAgentCandidateWorkspace(
  rootInput: string,
  options: CaptureAgentCandidateWorkspaceOptions = {},
): Promise<CapturedAgentCandidateWorkspace> {
  const root = resolve(rootInput)
  const limits = workspaceLimits(options.limits)
  const captured = options.includeRepository
    ? await captureRepository(root, limits)
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

/** Capture detached files returned by a remote executor into the standard archive. */
export async function captureAgentCandidateWorkspaceFiles(
  input: readonly AgentCandidateExecutorWorkspaceFile[],
  options: Omit<CaptureAgentCandidateWorkspaceOptions, 'includeRepository'> = {},
): Promise<CapturedAgentCandidateWorkspace> {
  const limits = workspaceLimits(options.limits)
  return captureWorkspaceFiles(
    normalizeWorkspaceFiles(input, limits),
    undefined,
    limits,
    options.artifactPersistence,
  )
}

async function captureWorkspaceFiles(
  files: readonly AgentCandidateExecutorWorkspaceFile[],
  repository: WorkspaceArchiveRepository | undefined,
  limits: AgentCandidateWorkspaceArchiveLimits,
  artifactPersistence: CaptureAgentCandidateWorkspaceOptions['artifactPersistence'],
): Promise<CapturedAgentCandidateWorkspace> {
  const material = candidateWorkspaceManifest(files)
  const manifest = canonicalCandidateBytes(material)
  const archive = await encodeWorkspaceArchive(files, repository, limits.maxArchiveBytes)
  if (
    !artifactPersistence &&
    (manifest.byteLength > limits.maxEmbeddedArtifactBytes ||
      archive.byteLength > limits.maxEmbeddedArtifactBytes)
  ) {
    throw new Error(
      'candidate workspace artifacts exceed maxEmbeddedArtifactBytes; artifactPersistence is required',
    )
  }
  const manifestArtifact = await captureWorkspaceArtifact('manifest', manifest, artifactPersistence)
  const archiveArtifact = await captureWorkspaceArtifact('archive', archive, artifactPersistence)
  const snapshot = deepFreezeCandidate({
    kind: 'agent-candidate-workspace-snapshot',
    digest: canonicalCandidateDigest(material),
    material,
    manifest: manifestArtifact,
    archive: archiveArtifact,
  } satisfies AgentCandidateWorkspaceSnapshotEvidence)
  return Object.freeze({ snapshot, archive })
}

async function captureWorkspaceArtifact(
  kind: 'manifest' | 'archive',
  bytes: Uint8Array,
  persistence: CaptureAgentCandidateWorkspaceOptions['artifactPersistence'],
): Promise<AgentCandidateCapturedArtifact> {
  if (!persistence) return embeddedCandidateArtifact(bytes)
  if (!persistence.executionId.trim()) {
    throw new Error('candidate workspace artifact persistence requires an executionId')
  }
  return persistCandidateOutputArtifact(persistence.outputArtifacts, {
    executionId: persistence.executionId,
    purpose: kind === 'manifest' ? 'candidate-workspace-manifest' : 'candidate-workspace-archive',
    bytes,
    ...(persistence.signal ? { signal: persistence.signal } : {}),
  })
}

/** Create the standard bounded materializer for candidate execution ports. */
export function createAgentCandidateWorkspacePort(
  options: CreateAgentCandidateWorkspacePortOptions = {},
): AgentCandidateWorkspacePort {
  const limits = workspaceLimits(options.limits)
  const port: AgentCandidateWorkspacePort = {
    materialize: async ({ role, snapshot, archive, destination }) => {
      await materializeAgentCandidateWorkspace({
        role,
        snapshot,
        archive,
        destination,
        limits,
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
}): Promise<void> {
  verifyBytes(
    input.archive,
    input.snapshot.archive.sha256,
    input.snapshot.archive.byteLength,
    'candidate workspace archive',
  )
  const decoded = await parseWorkspaceArchive(input.archive, input.limits)
  if (decoded.repository && input.role !== 'task') {
    throw new Error('only task workspaces may carry a Git repository')
  }
  assertArchiveMatchesSnapshot(decoded.files, input.snapshot)
  const destination = resolve(input.destination)
  await prepareEmptyDestination(destination)
  const staging = await mkdtemp(`${destination}.materializing-`)
  try {
    await writeWorkspaceFiles(staging, decoded.files)
    if (decoded.repository) {
      await materializeRepository(decoded.repository, staging)
    }
    await verifyMaterializedWorkspace(staging, input.snapshot.material, {
      ignoredProtectedRootEntries: decoded.repository ? ['.git'] : [],
    })
    await rename(staging, destination)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

async function captureRepository(
  root: string,
  limits: AgentCandidateWorkspaceArchiveLimits,
): Promise<{
  files: Array<{ path: string; mode: number; bytes: Uint8Array }>
  repository: WorkspaceArchiveRepository
}> {
  const stats = await lstat(root)
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await realpath(root)) !== root) {
    throw new Error('candidate repository root must be a real directory')
  }
  const topLevel = (await runCandidateGit(root, ['rev-parse', '--show-toplevel'])).stdout
    .toString('utf8')
    .trim()
  if (resolve(topLevel) !== root) {
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
  const files = await readCandidateGitTreeFiles(root, headTree, {}, limits)
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
      },
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function encodeWorkspaceArchive(
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>,
  repository: WorkspaceArchiveRepository | undefined,
  maxArchiveBytes: number,
): Promise<Uint8Array> {
  const archive = pack()
  const output = collectStream(archive, maxArchiveBytes, 'candidate workspace archive')
  try {
    await writeWorkspaceArchiveEntries(archive, files, repository)
    archive.finalize()
    return await output
  } catch (error) {
    archive.destroy(error instanceof Error ? error : new Error(String(error)))
    await output.catch(() => undefined)
    throw error
  }
}

async function verifyCanonicalWorkspaceArchive(
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>,
  repository: WorkspaceArchiveRepository | undefined,
  expected: Uint8Array,
  maxArchiveBytes: number,
): Promise<void> {
  const archive = pack()
  const comparison = streamEqualsBytes(
    archive,
    expected,
    maxArchiveBytes,
    'candidate workspace archive',
  )
  try {
    await writeWorkspaceArchiveEntries(archive, files, repository)
    archive.finalize()
    if (!(await comparison)) throw new Error('candidate workspace tar is not canonical')
  } catch (error) {
    archive.destroy(error instanceof Error ? error : new Error(String(error)))
    await comparison.catch(() => undefined)
    throw error
  }
}

async function writeWorkspaceArchiveEntries(
  archive: Pack,
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>,
  repository: WorkspaceArchiveRepository | undefined,
): Promise<void> {
  for (const file of files) {
    await writeTarEntry(archive, `${workspaceEntryPrefix}${file.path}`, file.mode, file.bytes)
  }
  if (!repository) return
  const metadata = canonicalCandidateBytes({
    kind: archiveKind,
    headCommit: repository.headCommit,
    headTree: repository.headTree,
    bundle: {
      sha256: repository.bundle.sha256,
      byteLength: repository.bundle.byteLength,
    },
  } satisfies WorkspaceArchiveRepositoryMetadata)
  await writeTarEntry(archive, repositoryMetadataEntry, 0o600, metadata)
  await writeTarEntry(archive, repositoryBundleEntry, 0o600, repository.bundle.bytes)
}

async function parseWorkspaceArchive(
  bytes: Uint8Array,
  limits: AgentCandidateWorkspaceArchiveLimits,
): Promise<DecodedWorkspaceArchive> {
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new Error('candidate workspace archive exceeds maxArchiveBytes')
  }
  const parser = extract()
  const files: DecodedWorkspaceArchive['files'] = []
  const observedEntryNames = new Set<string>()
  const observedPaths = new Set<string>()
  let totalBytes = 0
  let retainedEntryBytes = 0
  let previousPath: string | undefined
  let repositoryMetadata: WorkspaceArchiveRepositoryMetadata | undefined
  let repositoryBundle: Uint8Array | undefined
  const decoded = (async () => {
    for await (const entry of parser) {
      const name = entry.header.name
      if (
        entry.header.type !== 'file' ||
        typeof name !== 'string' ||
        observedEntryNames.has(name)
      ) {
        throw new Error('candidate workspace tar contains an invalid entry')
      }
      observedEntryNames.add(name)
      if (name.startsWith(workspaceEntryPrefix)) {
        if (files.length >= limits.maxFiles) {
          throw new Error('candidate workspace archive has an invalid file count')
        }
        const path = safeArchivePath(name.slice(workspaceEntryPrefix.length), limits.maxPathBytes)
        if (!isWorkspaceFileMode(entry.header.mode)) {
          throw new Error(`candidate workspace archive has an unsupported mode: ${path}`)
        }
        assertRetainedArchiveSize(bytes.byteLength, retainedEntryBytes, entry.header.size, limits)
        const fileBytes = await readTarEntry(entry, limits.maxFileBytes, `workspace file ${path}`)
        retainedEntryBytes += fileBytes.byteLength
        assertWorkspacePathOrder(
          path,
          previousPath,
          observedPaths,
          'candidate workspace archive paths must be unique and sorted',
        )
        previousPath = path
        if (fileBytes.byteLength > limits.maxTotalFileBytes - totalBytes) {
          throw new Error('candidate workspace archive exceeds maxTotalFileBytes')
        }
        totalBytes += fileBytes.byteLength
        files.push({ path, mode: entry.header.mode, bytes: fileBytes })
      } else if (name === repositoryMetadataEntry) {
        if (entry.header.mode !== 0o600 || repositoryMetadata) {
          throw new Error('candidate workspace archive repository metadata is invalid')
        }
        assertRetainedArchiveSize(bytes.byteLength, retainedEntryBytes, entry.header.size, limits)
        const metadataBytes = await readTarEntry(
          entry,
          limits.maxPathBytes,
          'candidate repository metadata',
        )
        retainedEntryBytes += metadataBytes.byteLength
        repositoryMetadata = parseRepositoryMetadata(metadataBytes, limits.maxRepositoryBundleBytes)
      } else if (name === repositoryBundleEntry) {
        if (entry.header.mode !== 0o600 || repositoryBundle) {
          throw new Error('candidate workspace archive repository bundle is invalid')
        }
        assertRetainedArchiveSize(bytes.byteLength, retainedEntryBytes, entry.header.size, limits)
        repositoryBundle = await readTarEntry(
          entry,
          limits.maxRepositoryBundleBytes,
          'candidate Git bundle',
        )
        retainedEntryBytes += repositoryBundle.byteLength
      } else {
        throw new Error(`candidate workspace tar contains an unsupported entry: ${name}`)
      }
    }
    if (Boolean(repositoryMetadata) !== Boolean(repositoryBundle)) {
      throw new Error('candidate workspace archive repository evidence is incomplete')
    }
    const repository =
      repositoryMetadata && repositoryBundle
        ? repositoryFromTar(repositoryMetadata, repositoryBundle)
        : undefined
    return { files, ...(repository ? { repository } : {}) }
  })()
  parser.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  const result = await decoded
  await verifyCanonicalWorkspaceArchive(
    result.files,
    result.repository,
    bytes,
    limits.maxArchiveBytes,
  )
  return result
}

function assertRetainedArchiveSize(
  archiveBytes: number,
  retainedEntryBytes: number,
  entryBytes: number | undefined,
  limits: AgentCandidateWorkspaceArchiveLimits,
): void {
  if (
    !Number.isSafeInteger(entryBytes) ||
    entryBytes === undefined ||
    entryBytes < 0 ||
    entryBytes > limits.maxArchiveBytes - archiveBytes - retainedEntryBytes
  ) {
    throw new Error('candidate workspace archive exceeds maxArchiveBytes while decoding')
  }
}

function parseRepositoryMetadata(
  bytes: Uint8Array,
  maxBundleBytes: number,
): WorkspaceArchiveRepositoryMetadata {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    throw new Error('candidate workspace archive repository metadata is invalid', { cause: error })
  }
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !== 'bundle,headCommit,headTree,kind' ||
    value.kind !== archiveKind ||
    typeof value.headCommit !== 'string' ||
    typeof value.headTree !== 'string' ||
    !isRecord(value.bundle) ||
    Object.keys(value.bundle).sort().join(',') !== 'byteLength,sha256' ||
    typeof value.bundle.sha256 !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.bundle.sha256) ||
    !Number.isSafeInteger(value.bundle.byteLength) ||
    (value.bundle.byteLength as number) <= 0 ||
    (value.bundle.byteLength as number) > maxBundleBytes
  ) {
    throw new Error('candidate workspace archive repository is invalid')
  }
  if (!Buffer.from(canonicalCandidateBytes(value)).equals(Buffer.from(bytes))) {
    throw new Error('candidate workspace archive repository metadata is not canonical')
  }
  assertGitObjectId(value.headCommit, 'repository HEAD')
  assertGitObjectId(value.headTree, 'repository HEAD tree')
  if (value.headCommit.length !== value.headTree.length) {
    throw new Error('candidate repository HEAD and tree use different object formats')
  }
  return {
    kind: archiveKind,
    headCommit: value.headCommit,
    headTree: value.headTree,
    bundle: {
      sha256: value.bundle.sha256 as `sha256:${string}`,
      byteLength: value.bundle.byteLength as number,
    },
  }
}

function repositoryFromTar(
  metadata: WorkspaceArchiveRepositoryMetadata,
  bundle: Uint8Array,
): WorkspaceArchiveRepository {
  verifyBytes(bundle, metadata.bundle.sha256, metadata.bundle.byteLength, 'candidate Git bundle')
  return {
    headCommit: metadata.headCommit,
    headTree: metadata.headTree,
    bundle: { ...metadata.bundle, bytes: bundle },
  }
}

async function writeTarEntry(
  archive: Pack,
  name: string,
  mode: number,
  bytes: Uint8Array,
): Promise<void> {
  await new Promise<void>((resolveEntry, rejectEntry) => {
    archive.entry(
      {
        name,
        mode,
        uid: 0,
        gid: 0,
        size: bytes.byteLength,
        mtime: fixedTarTime,
        type: 'file',
        uname: '',
        gname: '',
      },
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      (error) => (error ? rejectEntry(error) : resolveEntry()),
    )
  })
}

async function readTarEntry(entry: Entry, maxBytes: number, label: string): Promise<Uint8Array> {
  const size = entry.header.size
  if (!Number.isSafeInteger(size) || size === undefined || size < 0 || size > maxBytes) {
    throw new Error(`${label} has an invalid tar size`)
  }
  const bytes = await collectStream(entry, maxBytes, label)
  if (bytes.byteLength !== size) throw new Error(`${label} differs from its tar size`)
  return bytes
}

async function collectStream(
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of stream) {
    if (chunk.byteLength > maxBytes - totalBytes) {
      const error = new Error(`${label} exceeds its size limit`)
      if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy(error)
      throw error
    }
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    chunks.push(bytes)
    totalBytes += bytes.byteLength
  }
  return Buffer.concat(chunks, totalBytes)
}

async function streamEqualsBytes(
  stream: AsyncIterable<Uint8Array>,
  expected: Uint8Array,
  maxBytes: number,
  label: string,
): Promise<boolean> {
  const expectedBuffer = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength)
  let equal = true
  let offset = 0
  for await (const chunk of stream) {
    if (chunk.byteLength > maxBytes - offset) {
      const error = new Error(`${label} exceeds its size limit`)
      if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy(error)
      throw error
    }
    const observed = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    if (
      offset + observed.byteLength > expectedBuffer.byteLength ||
      !observed.equals(expectedBuffer.subarray(offset, offset + observed.byteLength))
    ) {
      equal = false
    }
    offset += observed.byteLength
  }
  return equal && offset === expectedBuffer.byteLength
}

async function prepareEmptyDestination(destination: string): Promise<void> {
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const stats = await lstat(destination)
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    (await realpath(destination)) !== destination
  ) {
    throw new Error('candidate workspace destination must be a real directory')
  }
  if ((await readdir(destination)).length > 0) {
    throw new Error('candidate workspace destination must be empty')
  }
}

async function writeWorkspaceFiles(
  destination: string,
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>,
): Promise<void> {
  for (const file of files) {
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
      await descriptor.writeFile(file.bytes)
      const stats = await descriptor.stat()
      if (!stats.isFile() || stats.nlink !== 1) {
        throw new Error(`candidate workspace file identity changed while writing: ${file.path}`)
      }
      await descriptor.chmod(file.mode)
    } finally {
      await descriptor.close()
    }
  }
}

async function materializeRepository(
  repository: WorkspaceArchiveRepository,
  destination: string,
): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-candidate-workspace-bundle-'))
  const bundlePath = join(temporary, `${randomUUID()}.bundle`)
  try {
    await writeFile(bundlePath, repository.bundle.bytes, { flag: 'wx', mode: 0o600 })
    await runCandidateGit(destination, [
      'init',
      '--quiet',
      '--initial-branch=candidate',
      `--object-format=${repository.headCommit.length === 64 ? 'sha256' : 'sha1'}`,
    ])
    await runCandidateGit(destination, ['bundle', 'verify', bundlePath])
    await runCandidateGit(destination, ['bundle', 'unbundle', bundlePath])
    const objectType = (
      await runCandidateGit(destination, ['cat-file', '-t', repository.headCommit])
    ).stdout
      .toString('utf8')
      .trim()
    if (objectType !== 'commit') throw new Error('candidate repository HEAD is not a commit')
    const observedTree = (
      await runCandidateGit(destination, ['rev-parse', `${repository.headCommit}^{tree}`])
    ).stdout
      .toString('utf8')
      .trim()
    if (observedTree !== repository.headTree) {
      throw new Error('candidate repository bundle HEAD tree changed')
    }
    await runCandidateGit(destination, ['update-ref', '--no-deref', 'HEAD', repository.headCommit])
    await runCandidateGit(destination, ['read-tree', repository.headTree])
    const status = (
      await runCandidateGit(destination, ['status', '--porcelain=v1', '--untracked-files=all'])
    ).stdout
      .toString('utf8')
      .trim()
    if (status) throw new Error('candidate repository files do not exactly match HEAD')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function assertArchiveMatchesSnapshot(
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>,
  snapshot: AgentCandidateWorkspaceSnapshotEvidence,
): void {
  const material = candidateWorkspaceManifest(files)
  const materialBytes = canonicalCandidateBytes(material)
  verifyBytes(
    materialBytes,
    snapshot.manifest.sha256,
    snapshot.manifest.byteLength,
    'candidate workspace manifest',
  )
  if (
    canonicalCandidateDigest(material) !== snapshot.digest ||
    !Buffer.from(materialBytes).equals(Buffer.from(canonicalCandidateBytes(snapshot.material)))
  ) {
    throw new Error('candidate workspace archive does not match its snapshot manifest')
  }
}

function assertWorkspaceFilesWithinLimits(
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>,
  limits: AgentCandidateWorkspaceArchiveLimits,
): void {
  if (files.length > limits.maxFiles) {
    throw new Error('candidate workspace exceeds maxFiles')
  }
  let totalBytes = 0
  let previousPath: string | undefined
  const observedPaths = new Set<string>()
  for (const file of files) {
    const path = safeArchivePath(file.path, limits.maxPathBytes)
    assertWorkspacePathOrder(
      path,
      previousPath,
      observedPaths,
      'candidate workspace paths must be unique and sorted',
    )
    previousPath = path
    if (!isWorkspaceFileMode(file.mode)) {
      throw new Error(`candidate workspace file has unsupported mode: ${path}`)
    }
    if (file.bytes.byteLength > limits.maxFileBytes) {
      throw new Error(`candidate workspace file exceeds maxFileBytes: ${path}`)
    }
    totalBytes += file.bytes.byteLength
    if (totalBytes > limits.maxTotalFileBytes) {
      throw new Error('candidate workspace exceeds maxTotalFileBytes')
    }
  }
}

function normalizeWorkspaceFiles(
  input: readonly AgentCandidateExecutorWorkspaceFile[],
  limits: AgentCandidateWorkspaceArchiveLimits,
): AgentCandidateExecutorWorkspaceFile[] {
  if (!Array.isArray(input)) {
    throw new Error('candidate workspace files must be an array')
  }
  const fileCount = input.length
  if (fileCount > limits.maxFiles) {
    throw new Error('candidate workspace exceeds maxFiles')
  }
  let totalBytes = 0
  const files: AgentCandidateExecutorWorkspaceFile[] = []
  for (let index = 0; index < fileCount; index++) {
    const inputFile = input[index]
    if (!isRecord(inputFile) || Object.keys(inputFile).sort().join(',') !== 'bytes,mode,path') {
      throw new Error(`candidate workspace file ${index} is invalid`)
    }
    const descriptors = Object.getOwnPropertyDescriptors(inputFile)
    if (
      !('value' in (descriptors.path ?? {})) ||
      !('value' in (descriptors.mode ?? {})) ||
      !('value' in (descriptors.bytes ?? {}))
    ) {
      throw new Error(`candidate workspace file ${index} must use fixed values`)
    }
    const path = safeArchivePath(descriptors.path?.value, limits.maxPathBytes)
    const mode = descriptors.mode?.value
    const inputBytes = descriptors.bytes?.value
    if (!isWorkspaceFileMode(mode)) {
      throw new Error(`candidate workspace file has unsupported mode: ${path}`)
    }
    const view = inspectWorkspaceBytes(inputBytes, path)
    if (view.byteLength > limits.maxFileBytes) {
      throw new Error(`candidate workspace file exceeds maxFileBytes: ${path}`)
    }
    if (view.byteLength > limits.maxTotalFileBytes - totalBytes) {
      throw new Error('candidate workspace exceeds maxTotalFileBytes')
    }
    if (view.byteLength > Math.max(0, limits.maxArchiveBytes - 1024)) {
      throw new Error('candidate workspace archive exceeds maxArchiveBytes')
    }
    totalBytes += view.byteLength
    files.push({ path, mode, bytes: detachWorkspaceBytes(view) })
  }
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  assertWorkspaceFilesWithinLimits(files, limits)
  return files
}

function isWorkspaceFileMode(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 0o777
}

function workspaceLimits(
  overrides: Partial<AgentCandidateWorkspaceArchiveLimits> | undefined,
): AgentCandidateWorkspaceArchiveLimits {
  const limits = { ...defaultLimits, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`candidate workspace ${name} must be a positive safe integer`)
    }
  }
  return Object.freeze(limits)
}

function safeArchivePath(value: unknown, maxPathBytes: number): string {
  if (
    typeof value !== 'string' ||
    !value ||
    !isWellFormedUnicode(value) ||
    Buffer.byteLength(value, 'utf8') > maxPathBytes ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    value.includes('\\') ||
    value.includes('\0') ||
    hasControlCharacter(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..') ||
    ['.git', '.sidecar'].includes(value.split('/')[0]?.toLowerCase() ?? '')
  ) {
    throw new Error(`candidate workspace archive contains an unsafe path: ${String(value)}`)
  }
  return value
}

function assertWorkspacePathOrder(
  path: string,
  previousPath: string | undefined,
  observedPaths: Set<string>,
  errorMessage: string,
): void {
  if (previousPath !== undefined && previousPath >= path) throw new Error(errorMessage)
  for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
    if (observedPaths.has(path.slice(0, slash))) throw new Error(errorMessage)
  }
  observedPaths.add(path)
}

function inspectWorkspaceBytes(
  input: unknown,
  path: string,
): { buffer: ArrayBuffer; byteOffset: number; byteLength: number } {
  let buffer: ArrayBufferLike
  let byteOffset: number
  let byteLength: number
  try {
    buffer = typedArrayBufferGetter.call(input as Uint8Array) as ArrayBufferLike
    byteOffset = typedArrayByteOffsetGetter.call(input as Uint8Array) as number
    byteLength = typedArrayByteLengthGetter.call(input as Uint8Array) as number
  } catch {
    throw new Error(`candidate workspace file bytes are invalid: ${path}`)
  }
  if (isSharedArrayBuffer(buffer)) {
    throw new Error(`candidate workspace file uses shared bytes: ${path}`)
  }
  if (!isAnyArrayBuffer(buffer)) {
    throw new Error(`candidate workspace file bytes are invalid: ${path}`)
  }
  return { buffer, byteOffset, byteLength }
}

function detachWorkspaceBytes(input: {
  buffer: ArrayBuffer
  byteOffset: number
  byteLength: number
}): Uint8Array {
  const { buffer, byteOffset, byteLength } = input
  const copy = new Uint8Array(byteLength)
  Uint8Array.prototype.set.call(copy, new Uint8Array(buffer, byteOffset, byteLength))
  return copy
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

function workspacePath(root: string, relativePath: string): string {
  const path = resolve(root, relativePath)
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error(`candidate workspace archive path escapes its destination: ${relativePath}`)
  }
  return path
}

function assertGitObjectId(value: string, label: string): void {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    throw new Error(`candidate repository ${label} is not a Git object id`)
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type TypedArrayGetter = (this: Uint8Array) => unknown

function requireTypedArrayGetter(name: 'buffer' | 'byteOffset' | 'byteLength'): TypedArrayGetter {
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object
  const getter = Object.getOwnPropertyDescriptor(typedArrayPrototype, name)?.get
  if (!getter) throw new Error(`typed array intrinsic ${name} accessor is unavailable`)
  return getter
}

const typedArrayBufferGetter = requireTypedArrayGetter('buffer')
const typedArrayByteOffsetGetter = requireTypedArrayGetter('byteOffset')
const typedArrayByteLengthGetter = requireTypedArrayGetter('byteLength')
