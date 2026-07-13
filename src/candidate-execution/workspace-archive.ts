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
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep, win32 } from 'node:path'

import type {
  AgentCandidateWorkspaceManifestMaterialV1,
  AgentCandidateWorkspaceSnapshotEvidence,
} from '@tangle-network/agent-interface'

import { captureMaterializedWorkspace, verifyBytes, verifyMaterializedWorkspace } from './artifacts'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  embeddedCandidateArtifact,
  sha256Bytes,
} from './digest'
import { readCandidateGitTreeFiles, runCandidateGit } from './git-materialize'
import type { AgentCandidateWorkspacePort } from './types'

const archiveKind = 'agent-candidate-workspace-archive' as const

export interface AgentCandidateWorkspaceArchiveLimits {
  maxArchiveBytes: number
  maxFiles: number
  maxFileBytes: number
  maxTotalFileBytes: number
  maxPathBytes: number
  maxRepositoryBundleBytes: number
}

const defaultLimits: AgentCandidateWorkspaceArchiveLimits = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxFiles: 50_000,
  maxFileBytes: 128 * 1024 * 1024,
  maxTotalFileBytes: 256 * 1024 * 1024,
  maxPathBytes: 4_096,
  maxRepositoryBundleBytes: 128 * 1024 * 1024,
})

interface WorkspaceArchiveFileV1 {
  path: string
  mode: 0o644 | 0o755
  encoding: 'base64'
  content: string
  sha256: `sha256:${string}`
  byteLength: number
}

interface WorkspaceArchiveRepositoryV1 {
  headCommit: string
  headTree: string
  bundle: {
    encoding: 'base64'
    content: string
    sha256: `sha256:${string}`
    byteLength: number
  }
}

interface WorkspaceArchiveV1 {
  schemaVersion: 1
  kind: typeof archiveKind
  files: WorkspaceArchiveFileV1[]
  repository?: WorkspaceArchiveRepositoryV1
}

interface DecodedWorkspaceArchive {
  files: Array<{ path: string; mode: 0o644 | 0o755; bytes: Uint8Array }>
  repository?: WorkspaceArchiveRepositoryV1 & { bundleBytes: Uint8Array }
}

export interface CaptureAgentCandidateWorkspaceOptions {
  /** Include Git HEAD so task preparation can prove its exact commit and tree. */
  includeRepository?: boolean
  limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
}

export interface CreateAgentCandidateWorkspacePortOptions {
  limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
}

export interface CapturedAgentCandidateWorkspace {
  snapshot: AgentCandidateWorkspaceSnapshotEvidence
  /** Detached bytes accepted by createAgentCandidateWorkspacePort. */
  archive: Uint8Array
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
  const archive = encodeWorkspaceArchive(captured.files, repository)
  if (archive.byteLength > limits.maxArchiveBytes) {
    throw new Error('candidate workspace archive exceeds maxArchiveBytes')
  }
  const material = workspaceManifest(captured.files)
  const manifest = canonicalCandidateBytes(material)
  return {
    snapshot: {
      schemaVersion: 1,
      kind: 'agent-candidate-workspace-snapshot',
      digest: canonicalCandidateDigest(material),
      material,
      manifest: embeddedCandidateArtifact(manifest),
      archive: embeddedCandidateArtifact(archive),
    },
    archive: Uint8Array.from(archive),
  }
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
  role: 'task' | 'candidate' | 'memory'
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
  const decoded = parseWorkspaceArchive(input.archive, input.limits)
  if (decoded.repository && input.role !== 'task') {
    throw new Error('only task workspaces may carry a Git repository')
  }
  assertArchiveMatchesSnapshot(decoded.files, input.snapshot)
  const destination = resolve(input.destination)
  await prepareEmptyDestination(destination)
  try {
    await writeWorkspaceFiles(destination, decoded.files)
    if (decoded.repository) {
      await materializeRepository(decoded.repository, destination)
    }
    await verifyMaterializedWorkspace(destination, input.snapshot.material, {
      ignoredProtectedRootEntries: decoded.repository ? ['.git'] : [],
    })
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

async function captureRepository(
  root: string,
  limits: AgentCandidateWorkspaceArchiveLimits,
): Promise<{
  files: Array<{ path: string; mode: 0o644 | 0o755; bytes: Uint8Array }>
  repository: WorkspaceArchiveRepositoryV1
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
          encoding: 'base64',
          content: Buffer.from(bundle).toString('base64'),
          sha256: sha256Bytes(bundle),
          byteLength: bundle.byteLength,
        },
      },
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function encodeWorkspaceArchive(
  files: ReadonlyArray<{ path: string; mode: 0o644 | 0o755; bytes: Uint8Array }>,
  repository?: WorkspaceArchiveRepositoryV1,
): Uint8Array {
  const archive: WorkspaceArchiveV1 = {
    schemaVersion: 1,
    kind: archiveKind,
    files: files.map((file) => ({
      path: file.path,
      mode: file.mode,
      encoding: 'base64',
      content: Buffer.from(file.bytes).toString('base64'),
      sha256: sha256Bytes(file.bytes),
      byteLength: file.bytes.byteLength,
    })),
    ...(repository ? { repository } : {}),
  }
  return canonicalCandidateBytes(archive)
}

function parseWorkspaceArchive(
  bytes: Uint8Array,
  limits: AgentCandidateWorkspaceArchiveLimits,
): DecodedWorkspaceArchive {
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new Error('candidate workspace archive exceeds maxArchiveBytes')
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    throw new Error('candidate workspace archive is not UTF-8 JSON', { cause: error })
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== archiveKind) {
    throw new Error('candidate workspace archive has an invalid envelope')
  }
  if (!Buffer.from(canonicalCandidateBytes(value)).equals(Buffer.from(bytes))) {
    throw new Error('candidate workspace archive is not canonical')
  }
  const allowedKeys =
    value.repository === undefined
      ? ['files', 'kind', 'schemaVersion']
      : ['files', 'kind', 'repository', 'schemaVersion']
  if (Object.keys(value).sort().join(',') !== allowedKeys.join(',')) {
    throw new Error('candidate workspace archive contains unsupported fields')
  }
  if (!Array.isArray(value.files) || value.files.length > limits.maxFiles) {
    throw new Error('candidate workspace archive has an invalid file count')
  }
  const files: DecodedWorkspaceArchive['files'] = []
  let totalBytes = 0
  let previousPath: string | undefined
  for (const item of value.files) {
    const parsed = parseArchiveFile(item, limits)
    if (previousPath !== undefined && previousPath >= parsed.path) {
      throw new Error('candidate workspace archive paths must be unique and sorted')
    }
    previousPath = parsed.path
    totalBytes += parsed.bytes.byteLength
    if (totalBytes > limits.maxTotalFileBytes) {
      throw new Error('candidate workspace archive exceeds maxTotalFileBytes')
    }
    files.push(parsed)
  }
  const repository =
    value.repository === undefined
      ? undefined
      : parseArchiveRepository(value.repository, limits.maxRepositoryBundleBytes)
  return { files, ...(repository ? { repository } : {}) }
}

function parseArchiveFile(
  value: unknown,
  limits: AgentCandidateWorkspaceArchiveLimits,
): { path: string; mode: 0o644 | 0o755; bytes: Uint8Array } {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !== 'byteLength,content,encoding,mode,path,sha256' ||
    (value.mode !== 0o644 && value.mode !== 0o755) ||
    value.encoding !== 'base64' ||
    typeof value.content !== 'string' ||
    typeof value.sha256 !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < 0 ||
    (value.byteLength as number) > limits.maxFileBytes
  ) {
    throw new Error('candidate workspace archive file is invalid')
  }
  const path = safeArchivePath(value.path, limits.maxPathBytes)
  assertBase64CouldFit(value.content, limits.maxFileBytes, `workspace file ${path}`)
  const bytes = decodeBase64(value.content, `workspace file ${path}`)
  verifyBytes(bytes, value.sha256, value.byteLength as number, `workspace file ${path}`)
  return { path, mode: value.mode, bytes }
}

function parseArchiveRepository(
  value: unknown,
  maxBundleBytes: number,
): WorkspaceArchiveRepositoryV1 & { bundleBytes: Uint8Array } {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !== 'bundle,headCommit,headTree' ||
    typeof value.headCommit !== 'string' ||
    typeof value.headTree !== 'string' ||
    !isRecord(value.bundle) ||
    Object.keys(value.bundle).sort().join(',') !== 'byteLength,content,encoding,sha256' ||
    value.bundle.encoding !== 'base64' ||
    typeof value.bundle.content !== 'string' ||
    typeof value.bundle.sha256 !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.bundle.sha256) ||
    !Number.isSafeInteger(value.bundle.byteLength) ||
    (value.bundle.byteLength as number) <= 0 ||
    (value.bundle.byteLength as number) > maxBundleBytes
  ) {
    throw new Error('candidate workspace archive repository is invalid')
  }
  assertGitObjectId(value.headCommit, 'repository HEAD')
  assertGitObjectId(value.headTree, 'repository HEAD tree')
  if (value.headCommit.length !== value.headTree.length) {
    throw new Error('candidate repository HEAD and tree use different object formats')
  }
  assertBase64CouldFit(value.bundle.content, maxBundleBytes, 'candidate Git bundle')
  const bundleBytes = decodeBase64(value.bundle.content, 'candidate Git bundle')
  verifyBytes(
    bundleBytes,
    value.bundle.sha256,
    value.bundle.byteLength as number,
    'candidate Git bundle',
  )
  return {
    headCommit: value.headCommit,
    headTree: value.headTree,
    bundle: {
      encoding: 'base64',
      content: value.bundle.content,
      sha256: value.bundle.sha256 as `sha256:${string}`,
      byteLength: value.bundle.byteLength as number,
    },
    bundleBytes,
  }
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
  files: ReadonlyArray<{ path: string; mode: 0o644 | 0o755; bytes: Uint8Array }>,
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
  repository: WorkspaceArchiveRepositoryV1 & { bundleBytes: Uint8Array },
  destination: string,
): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-candidate-workspace-bundle-'))
  const bundlePath = join(temporary, `${randomUUID()}.bundle`)
  try {
    await writeFile(bundlePath, repository.bundleBytes, { flag: 'wx', mode: 0o600 })
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

function workspaceManifest(
  files: ReadonlyArray<{ path: string; mode: 0o644 | 0o755; bytes: Uint8Array }>,
): AgentCandidateWorkspaceManifestMaterialV1 {
  return {
    schemaVersion: 1,
    kind: 'agent-candidate-workspace-manifest',
    files: files.map((file) => ({
      path: file.path,
      mode: file.mode,
      sha256: sha256Bytes(file.bytes),
      byteLength: file.bytes.byteLength,
    })),
  }
}

function assertArchiveMatchesSnapshot(
  files: ReadonlyArray<{ path: string; mode: 0o644 | 0o755; bytes: Uint8Array }>,
  snapshot: AgentCandidateWorkspaceSnapshotEvidence,
): void {
  const material = workspaceManifest(files)
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
  files: ReadonlyArray<{ path: string; mode: 0o644 | 0o755; bytes: Uint8Array }>,
  limits: AgentCandidateWorkspaceArchiveLimits,
): void {
  if (files.length > limits.maxFiles) {
    throw new Error('candidate workspace exceeds maxFiles')
  }
  let totalBytes = 0
  let previousPath: string | undefined
  for (const file of files) {
    const path = safeArchivePath(file.path, limits.maxPathBytes)
    if (previousPath !== undefined && previousPath >= path) {
      throw new Error('candidate workspace paths must be unique and sorted')
    }
    previousPath = path
    if (file.mode !== 0o644 && file.mode !== 0o755) {
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

function workspacePath(root: string, relativePath: string): string {
  const path = resolve(root, relativePath)
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error(`candidate workspace archive path escapes its destination: ${relativePath}`)
  }
  return path
}

function assertBase64CouldFit(content: string, maxBytes: number, label: string): void {
  if (content.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new Error(`${label} exceeds its encoded size limit`)
  }
}

function decodeBase64(content: string, label: string): Uint8Array {
  const bytes = Buffer.from(content, 'base64')
  if (bytes.toString('base64') !== content) throw new Error(`${label} is not canonical base64`)
  return Uint8Array.from(bytes)
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
