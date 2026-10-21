import { isAbsolute, win32 } from 'node:path'
import { isAnyArrayBuffer, isSharedArrayBuffer } from 'node:util/types'
import type {
  AgentCandidateCapturedArtifact,
  AgentCandidateWorkspaceSnapshotEvidence,
} from '@tangle-network/agent-interface'
import { extract, type Pack, pack, type Extract as TarExtract } from 'tar-stream'
import { hasControlCharacter } from '../path-control-characters'
import { isRecord } from '../record-value'
import { candidateWorkspaceManifest, verifyBytes } from './artifacts'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  deepFreezeCandidate,
  embeddedCandidateArtifact,
  sha256Bytes,
} from './digest'
import { isWellFormedUnicode } from './exact-object'
import { persistCandidateOutputArtifact } from './output-artifacts'
import type { AgentCandidateExecutorWorkspaceFile } from './types'
import type { CaptureAgentCandidateWorkspaceOptions } from './workspace-archive-local'

const archiveKind = 'agent-candidate-workspace-archive' as const
const workspaceEntryPrefix = 'workspace/'
const repositoryMetadataEntry = 'metadata/repository.json'
const repositoryBundleEntry = 'metadata/repository.bundle'
const repositoryIndexEntry = 'metadata/repository.index.json'
const repositoryIndexPrefix = 'index/'
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

export interface WorkspaceArchiveRepository {
  headCommit: string
  headTree: string
  bundle: {
    sha256: `sha256:${string}`
    byteLength: number
    bytes: Uint8Array
  }
  workingTree?: { files: Array<{ path: string; mode: number; bytes: Uint8Array }> }
}

interface WorkspaceArchiveRepositoryMetadata {
  kind: typeof archiveKind
  headCommit: string
  headTree: string
  bundle: {
    sha256: `sha256:${string}`
    byteLength: number
  }
  workingTree?: { indexManifest: { sha256: `sha256:${string}`; byteLength: number } }
}

interface DecodedWorkspaceArchive {
  files: Array<{ path: string; mode: number; bytes: Uint8Array }>
  repository?: WorkspaceArchiveRepository
}

export interface CapturedAgentCandidateWorkspace {
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
  /** Caller-owned bytes accepted by createAgentCandidateWorkspacePort. */
  readonly archive: Uint8Array
}

/** Capture detached files returned by a remote executor into the standard archive. */
export async function captureAgentCandidateWorkspaceFiles(
  input: readonly AgentCandidateExecutorWorkspaceFile[],
  options: Omit<
    CaptureAgentCandidateWorkspaceOptions,
    'includeRepository' | 'repositoryContents'
  > = {},
): Promise<CapturedAgentCandidateWorkspace> {
  const limits = workspaceLimits(options.limits)
  return captureWorkspaceFiles(
    normalizeWorkspaceFiles(input, limits),
    undefined,
    limits,
    options.artifactPersistence,
  )
}

export async function captureWorkspaceFiles(
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

/** Verify a portable archive before its source environment may be discarded. */
export async function verifyAgentCandidateWorkspaceArchive(input: {
  role: 'task' | 'candidate' | 'knowledge' | 'memory'
  snapshot: AgentCandidateWorkspaceSnapshotEvidence
  archive: Uint8Array
  limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
}): Promise<void> {
  await decodeVerifiedWorkspaceArchive({ ...input, limits: workspaceLimits(input.limits) })
}

export async function decodeVerifiedWorkspaceArchive(input: {
  role: 'task' | 'candidate' | 'knowledge' | 'memory'
  snapshot: AgentCandidateWorkspaceSnapshotEvidence
  archive: Uint8Array
  limits: AgentCandidateWorkspaceArchiveLimits
}): Promise<DecodedWorkspaceArchive> {
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
  return decoded
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
  const indexManifest = repository.workingTree
    ? canonicalCandidateBytes(candidateWorkspaceManifest(repository.workingTree.files))
    : undefined
  const metadata = canonicalCandidateBytes({
    kind: archiveKind,
    headCommit: repository.headCommit,
    headTree: repository.headTree,
    bundle: {
      sha256: repository.bundle.sha256,
      byteLength: repository.bundle.byteLength,
    },
    ...(indexManifest
      ? {
          workingTree: {
            indexManifest: {
              sha256: sha256Bytes(indexManifest),
              byteLength: indexManifest.byteLength,
            },
          },
        }
      : {}),
  } satisfies WorkspaceArchiveRepositoryMetadata)
  await writeTarEntry(archive, repositoryMetadataEntry, 0o600, metadata)
  await writeTarEntry(archive, repositoryBundleEntry, 0o600, repository.bundle.bytes)
  if (repository.workingTree && indexManifest) {
    await writeTarEntry(archive, repositoryIndexEntry, 0o600, indexManifest)
    for (const file of repository.workingTree.files) {
      await writeTarEntry(archive, `${repositoryIndexPrefix}${file.path}`, file.mode, file.bytes)
    }
  }
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
  let repositoryIndex: Uint8Array | undefined
  const indexFiles: DecodedWorkspaceArchive['files'] = []
  const indexPaths = new Set<string>()
  let previousIndexPath: string | undefined
  let indexBytes = 0
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
        repositoryMetadata = parseRepositoryMetadata(metadataBytes, limits)
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
      } else if (name === repositoryIndexEntry) {
        if (entry.header.mode !== 0o600 || repositoryIndex) {
          throw new Error('candidate workspace archive repository index is invalid')
        }
        assertRetainedArchiveSize(bytes.byteLength, retainedEntryBytes, entry.header.size, limits)
        repositoryIndex = await readTarEntry(
          entry,
          limits.maxArchiveBytes,
          'candidate Git index manifest',
        )
        retainedEntryBytes += repositoryIndex.byteLength
      } else if (name.startsWith(repositoryIndexPrefix)) {
        if (
          !repositoryMetadata?.workingTree ||
          !repositoryIndex ||
          indexFiles.length >= limits.maxFiles
        ) {
          throw new Error('candidate Git index evidence is incomplete or exceeds maxFiles')
        }
        const path = safeArchivePath(name.slice(repositoryIndexPrefix.length), limits.maxPathBytes)
        if (entry.header.mode !== 0o644 && entry.header.mode !== 0o755) {
          throw new Error('candidate Git index contains an unsupported mode')
        }
        assertWorkspacePathOrder(
          path,
          previousIndexPath,
          indexPaths,
          'candidate Git index paths must be unique and sorted',
        )
        previousIndexPath = path
        assertRetainedArchiveSize(bytes.byteLength, retainedEntryBytes, entry.header.size, limits)
        if (
          entry.header.size === undefined ||
          entry.header.size > limits.maxTotalFileBytes - indexBytes
        ) {
          throw new Error('candidate Git index exceeds maxTotalFileBytes')
        }
        if (entry.header.size > limits.maxFileBytes)
          throw new Error('candidate Git index exceeds maxFileBytes')
        const fileBytes = await readTarEntry(entry, limits.maxFileBytes, `Git index file ${path}`)
        retainedEntryBytes += fileBytes.byteLength
        indexBytes += fileBytes.byteLength
        indexFiles.push({ path, mode: entry.header.mode, bytes: fileBytes })
      } else {
        throw new Error(`candidate workspace tar contains an unsupported entry: ${name}`)
      }
    }
    if (Boolean(repositoryMetadata) !== Boolean(repositoryBundle)) {
      throw new Error('candidate workspace archive repository evidence is incomplete')
    }
    if (Boolean(repositoryMetadata?.workingTree) !== Boolean(repositoryIndex)) {
      throw new Error('candidate workspace archive repository index evidence is incomplete')
    }
    const repository =
      repositoryMetadata && repositoryBundle
        ? repositoryFromTar(repositoryMetadata, repositoryBundle, repositoryIndex, indexFiles)
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
  limits: AgentCandidateWorkspaceArchiveLimits,
): WorkspaceArchiveRepositoryMetadata {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    throw new Error('candidate workspace archive repository metadata is invalid', { cause: error })
  }
  if (
    !isRecord(value) ||
    !['bundle,headCommit,headTree,kind', 'bundle,headCommit,headTree,kind,workingTree'].includes(
      Object.keys(value).sort().join(','),
    ) ||
    value.kind !== archiveKind ||
    typeof value.headCommit !== 'string' ||
    typeof value.headTree !== 'string' ||
    !isRecord(value.bundle) ||
    Object.keys(value.bundle).sort().join(',') !== 'byteLength,sha256' ||
    typeof value.bundle.sha256 !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.bundle.sha256) ||
    !Number.isSafeInteger(value.bundle.byteLength) ||
    (value.bundle.byteLength as number) <= 0 ||
    (value.bundle.byteLength as number) > limits.maxRepositoryBundleBytes
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
  let workingTree: WorkspaceArchiveRepositoryMetadata['workingTree']
  if ('workingTree' in value) {
    const working = value.workingTree
    if (
      !isRecord(working) ||
      Object.keys(working).join(',') !== 'indexManifest' ||
      !isRecord(working.indexManifest) ||
      Object.keys(working.indexManifest).sort().join(',') !== 'byteLength,sha256' ||
      typeof working.indexManifest.sha256 !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(working.indexManifest.sha256) ||
      !Number.isSafeInteger(working.indexManifest.byteLength) ||
      (working.indexManifest.byteLength as number) < 0 ||
      (working.indexManifest.byteLength as number) > limits.maxArchiveBytes
    ) {
      throw new Error('candidate workspace archive repository index is invalid')
    }
    workingTree = {
      indexManifest: {
        sha256: working.indexManifest.sha256 as `sha256:${string}`,
        byteLength: working.indexManifest.byteLength as number,
      },
    }
  }
  return {
    kind: archiveKind,
    headCommit: value.headCommit,
    headTree: value.headTree,
    bundle: {
      sha256: value.bundle.sha256 as `sha256:${string}`,
      byteLength: value.bundle.byteLength as number,
    },
    ...(workingTree ? { workingTree } : {}),
  }
}

function repositoryFromTar(
  metadata: WorkspaceArchiveRepositoryMetadata,
  bundle: Uint8Array,
  indexManifest: Uint8Array | undefined,
  indexFiles: DecodedWorkspaceArchive['files'],
): WorkspaceArchiveRepository {
  verifyBytes(bundle, metadata.bundle.sha256, metadata.bundle.byteLength, 'candidate Git bundle')
  if (metadata.workingTree && indexManifest) {
    verifyBytes(
      indexManifest,
      metadata.workingTree.indexManifest.sha256,
      metadata.workingTree.indexManifest.byteLength,
      'candidate Git index manifest',
    )
    if (
      !Buffer.from(indexManifest).equals(
        Buffer.from(canonicalCandidateBytes(candidateWorkspaceManifest(indexFiles))),
      )
    ) {
      throw new Error('candidate Git index files do not match the captured manifest')
    }
  }
  return {
    headCommit: metadata.headCommit,
    headTree: metadata.headTree,
    bundle: { ...metadata.bundle, bytes: bundle },
    ...(metadata.workingTree && indexManifest ? { workingTree: { files: indexFiles } } : {}),
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
      workspaceTarHeader(name, mode, bytes.byteLength),
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      (error) => (error ? rejectEntry(error) : resolveEntry()),
    )
  })
}

type TarEntry = TarExtract extends AsyncIterable<infer Entry> ? Entry : never

async function readTarEntry(entry: TarEntry, maxBytes: number, label: string): Promise<Uint8Array> {
  const size = entry.header.size
  if (!Number.isSafeInteger(size) || size === undefined || size < 0 || size > maxBytes) {
    throw new Error(`${label} has an invalid tar size`)
  }
  const bytes = await collectStream(entry, maxBytes, label)
  if (bytes.byteLength !== size) throw new Error(`${label} differs from its tar size`)
  return bytes
}

async function collectStream(
  stream: AsyncIterable<unknown>,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) {
      throw new Error(`${label} emitted a non-byte chunk`)
    }
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
  stream: AsyncIterable<unknown>,
  expected: Uint8Array,
  maxBytes: number,
  label: string,
): Promise<boolean> {
  const expectedBuffer = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength)
  let equal = true
  let offset = 0
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) {
      throw new Error(`${label} emitted a non-byte chunk`)
    }
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

export function assertWorkspaceFilesWithinLimits(
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

export function workspaceLimits(
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

export function safeArchivePath(value: unknown, maxPathBytes: number): string {
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

export function assertWorkspacePathOrder(
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

export function assertGitObjectId(value: string, label: string): void {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    throw new Error(`candidate repository ${label} is not a Git object id`)
  }
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

/** Shared canonical header for both archive encoders. */
export function workspaceTarHeader(name: string, mode: number, size: number) {
  return {
    name,
    mode,
    uid: 0,
    gid: 0,
    size,
    mtime: fixedTarTime,
    type: 'file' as const,
    uname: '',
    gname: '',
  }
}
