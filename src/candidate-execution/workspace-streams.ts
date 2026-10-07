import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, mkdtemp, open, realpath, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  AgentCandidateArtifactRef,
  AgentCandidateWorkspaceManifestMaterial,
  AgentCandidateWorkspaceSnapshotEvidence,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import { extract, type Pack, pack } from 'tar-stream'
import { persistCandidateOutputArtifactStream, verifiedArtifactChunks } from './artifact-streams'
import { scanMaterializedWorkspaceManifest, verifyBytes } from './artifacts'
import { canonicalCandidateBytes, canonicalCandidateDigest, deepFreezeCandidate } from './digest'
import type { AgentCandidateArtifactPort } from './types'
import {
  type AgentCandidateWorkspaceArchiveLimits,
  assertWorkspacePathOrder,
  type CaptureAgentCandidateWorkspaceOptions,
  prepareEmptyDestination,
  safeArchivePath,
  workspaceLimits,
  workspacePath,
  workspaceTarHeader,
} from './workspace-archive'

type WorkspaceFile = AgentCandidateWorkspaceManifestMaterial['files'][number]

export interface CaptureAgentCandidateWorkspaceToArtifactsOptions {
  limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
  artifactPersistence: NonNullable<CaptureAgentCandidateWorkspaceOptions['artifactPersistence']>
}

/** Capture regular files to durable artifacts with memory bounded by the manifest and stream buffers. */
export async function captureAgentCandidateWorkspaceToArtifacts(
  rootInput: string,
  options: CaptureAgentCandidateWorkspaceToArtifactsOptions,
): Promise<{ readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence }> {
  const { outputArtifacts, executionId, signal } = options.artifactPersistence
  if (!outputArtifacts.putStream || !outputArtifacts.readStream) {
    throw new Error('streaming workspace persistence requires putStream and readStream')
  }
  if (!executionId.trim())
    throw new Error('candidate workspace artifact persistence requires an executionId')
  signal?.throwIfAborted()
  const limits = workspaceLimits(options.limits)
  const material = await scanMaterializedWorkspaceManifest(rootInput, { limits, signal })
  validateManifest(material, limits)
  const root = await realpath(resolve(rootInput))
  const manifest = canonicalCandidateBytes(material)
  const manifestArtifact = await persistCandidateOutputArtifactStream(outputArtifacts, {
    executionId,
    purpose: 'candidate-workspace-manifest',
    chunks: oneChunk(manifest),
    maxBytes: manifest.byteLength,
    signal,
  })
  const archiveArtifact = await persistCandidateOutputArtifactStream(outputArtifacts, {
    executionId,
    purpose: 'candidate-workspace-archive',
    chunks: workspaceArchiveChunks(root, material, signal),
    maxBytes: limits.maxArchiveBytes,
    signal,
  })
  return Object.freeze({
    snapshot: deepFreezeCandidate({
      kind: 'agent-candidate-workspace-snapshot' as const,
      digest: canonicalCandidateDigest(material),
      material,
      manifest: manifestArtifact,
      archive: archiveArtifact,
    }),
  })
}

/**
 * A workspace stored as one content-addressed object per file plus the manifest that names them.
 *
 * Its digest is the manifest's, the same identity an archived capture of the same files has. Two
 * trees share every file they have in common, so storing one costs only the files no earlier
 * capture in the store holds: on Discovery Lab run terraform-dc-tokens-20261006d, the files a
 * director changed between two captures one to two minutes apart were 5.5 to 8.2 MB of a
 * 60 to 70 MB workspace.
 */
export interface AgentCandidateWorkspaceTree {
  readonly kind: 'agent-candidate-workspace-tree'
  /** The manifest's digest; the manifest is the object of this digest. */
  readonly digest: Sha256Digest
  readonly manifest: AgentCandidateArtifactRef
  readonly files: number
  /** The bytes of every file in the workspace. */
  readonly bytes: number
  /** The bytes this capture added to the store; every other file was already there. */
  readonly storedBytes: number
}

/**
 * Store a workspace as a tree: each regular file the store does not already hold, then the
 * manifest. The store must find objects by content (`locate`) and stream them.
 */
export async function captureAgentCandidateWorkspaceTreeToArtifacts(
  rootInput: string,
  options: CaptureAgentCandidateWorkspaceToArtifactsOptions,
): Promise<AgentCandidateWorkspaceTree> {
  const { outputArtifacts, executionId, signal } = options.artifactPersistence
  if (!outputArtifacts.putStream || !outputArtifacts.readStream || !outputArtifacts.locate) {
    throw new Error('workspace tree persistence requires putStream, readStream and locate')
  }
  if (!executionId.trim())
    throw new Error('candidate workspace artifact persistence requires an executionId')
  signal?.throwIfAborted()
  const limits = workspaceLimits(options.limits)
  const material = await scanMaterializedWorkspaceManifest(rootInput, { limits, signal })
  validateManifest(material, limits)
  const root = await realpath(resolve(rootInput))
  let bytes = 0
  let storedBytes = 0
  for (const file of material.files) {
    signal?.throwIfAborted()
    bytes += file.byteLength
    const held = await outputArtifacts.locate(
      { sha256: file.sha256, byteLength: file.byteLength },
      signal === undefined ? undefined : { signal },
    )
    if (held !== undefined) continue
    const stored = await persistCandidateOutputArtifactStream(outputArtifacts, {
      executionId,
      purpose: 'candidate-workspace-file',
      chunks: workspaceFileChunks(root, file, signal),
      maxBytes: file.byteLength,
      signal,
    })
    if (stored.sha256 !== file.sha256 || stored.byteLength !== file.byteLength)
      throw new Error(`workspace file changed during capture: ${file.path}`)
    storedBytes += file.byteLength
  }
  const manifestBytes = canonicalCandidateBytes(material)
  const manifest = await persistCandidateOutputArtifactStream(outputArtifacts, {
    executionId,
    purpose: 'candidate-workspace-manifest',
    chunks: oneChunk(manifestBytes),
    maxBytes: manifestBytes.byteLength,
    signal,
  })
  const digest = canonicalCandidateDigest(material)
  if (manifest.sha256 !== digest)
    throw new Error('candidate workspace manifest digest does not name its stored bytes')
  return deepFreezeCandidate({
    kind: 'agent-candidate-workspace-tree' as const,
    digest,
    manifest,
    files: material.files.length,
    bytes,
    storedBytes,
  })
}

/**
 * Read a tree back by its digest and confirm the store holds every file it names. Returns the
 * manifest; reading a file is `artifacts.read` of what `locate` returns for its digest.
 */
export async function verifyAgentCandidateWorkspaceTree(
  tree: Pick<AgentCandidateWorkspaceTree, 'digest' | 'manifest'>,
  artifacts: AgentCandidateArtifactPort,
  options: { limits?: Partial<AgentCandidateWorkspaceArchiveLimits>; signal?: AbortSignal } = {},
): Promise<AgentCandidateWorkspaceManifestMaterial> {
  const { signal } = options
  if (!artifacts.locate) throw new Error('workspace tree verification requires locate')
  if (tree.manifest.sha256 !== tree.digest)
    throw new Error('workspace tree digest does not name its manifest')
  signal?.throwIfAborted()
  const bytes = await artifacts.read(tree.manifest)
  verifyBytes(bytes, tree.manifest.sha256, tree.manifest.byteLength, 'workspace tree manifest')
  const material = JSON.parse(
    Buffer.from(bytes).toString('utf8'),
  ) as AgentCandidateWorkspaceManifestMaterial
  validateManifest(material, workspaceLimits(options.limits))
  if (canonicalCandidateDigest(material) !== tree.digest)
    throw new Error('workspace tree manifest is not canonical')
  for (const file of material.files) {
    signal?.throwIfAborted()
    const held = await artifacts.locate(
      { sha256: file.sha256, byteLength: file.byteLength },
      signal === undefined ? undefined : { signal },
    )
    if (held === undefined) throw new Error(`workspace tree file is not in the store: ${file.path}`)
  }
  return material
}

export interface AgentCandidateWorkspaceArtifactsOptions {
  role: 'task' | 'candidate' | 'knowledge' | 'memory'
  snapshot: AgentCandidateWorkspaceSnapshotEvidence
  artifacts: AgentCandidateArtifactPort
  limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
  signal?: AbortSignal
}

/** Verify durable regular-file workspace evidence without retaining archive or file contents. */
export async function verifyAgentCandidateWorkspaceArtifacts(
  input: AgentCandidateWorkspaceArtifactsOptions,
): Promise<void> {
  await consumeWorkspaceArtifacts(input)
}

/** Read selected files only after the existing verifier has accepted the entire archive. */
export async function readAgentCandidateWorkspaceArtifactFiles(
  input: AgentCandidateWorkspaceArtifactsOptions & {
    readonly paths: readonly string[]
    readonly maxReadBytes: number
  },
): Promise<ReadonlyMap<string, Uint8Array>> {
  if (!Number.isSafeInteger(input.maxReadBytes) || input.maxReadBytes < 0)
    throw new Error('workspace selective read requires a non-negative safe maxReadBytes')
  const selected = new Map<string, Uint8Array[]>()
  const files = new Map(input.snapshot.material.files.map((file) => [file.path, file]))
  let bytes = 0
  for (const path of input.paths) {
    if (selected.has(path)) throw new Error('workspace selective read repeats a path')
    const file = files.get(path)
    if (!file) throw new Error(`workspace selective read names a missing file: ${path}`)
    bytes += file.byteLength
    if (!Number.isSafeInteger(bytes) || bytes > input.maxReadBytes)
      throw new Error('workspace selective read exceeds maxReadBytes')
    selected.set(path, [])
  }
  await consumeWorkspaceArtifacts(input, undefined, selected)
  return new Map([...selected].map(([path, chunks]) => [path, Buffer.concat(chunks)]))
}

/** Restore regular-file artifacts into an empty destination, publishing only after complete verification. */
export async function materializeAgentCandidateWorkspaceFromArtifacts(
  input: AgentCandidateWorkspaceArtifactsOptions & { destination: string },
): Promise<void> {
  input.signal?.throwIfAborted()
  if (!input.artifacts.readStream)
    throw new Error('streaming workspace artifacts require readStream')
  const destination = resolve(input.destination)
  await prepareEmptyDestination(destination)
  const staging = await mkdtemp(`${destination}.materializing-`)
  try {
    await consumeWorkspaceArtifacts(input, staging)
    input.signal?.throwIfAborted()
    await rename(staging, destination)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

async function consumeWorkspaceArtifacts(
  input: AgentCandidateWorkspaceArtifactsOptions,
  destination?: string,
  selected?: Map<string, Uint8Array[]>,
): Promise<void> {
  const { artifacts, signal } = input
  const snapshot = deepFreezeCandidate(structuredClone(input.snapshot))
  signal?.throwIfAborted()
  if (!artifacts.readStream) throw new Error('streaming workspace artifacts require readStream')
  const limits = workspaceLimits(input.limits)
  validateManifest(snapshot.material, limits)
  if (snapshot.archive.byteLength > limits.maxArchiveBytes)
    throw new Error('candidate workspace archive exceeds maxArchiveBytes')
  const manifest = canonicalCandidateBytes(snapshot.material)
  verifyBytes(
    manifest,
    snapshot.manifest.sha256,
    snapshot.manifest.byteLength,
    'candidate workspace manifest',
  )
  if (canonicalCandidateDigest(snapshot.material) !== snapshot.digest)
    throw new Error('workspace snapshot digest does not match its canonical manifest material')
  let offset = 0
  for await (const chunk of verifiedArtifactChunks(snapshot.manifest, artifacts, signal)) {
    if (
      !Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).equals(
        manifest.subarray(offset, offset + chunk.byteLength),
      )
    ) {
      throw new Error('workspace manifest artifact is not the exact canonical manifest material')
    }
    offset += chunk.byteLength
  }

  const parser = extract()
  const canonical = pack()
  const canonicalResult = digestChunks(canonical, limits.maxArchiveBytes, signal)
  // Both drains start before writing, so tar-stream's backpressure bounds every queue.
  const reading = pipeline(
    Readable.from(verifiedArtifactChunks(snapshot.archive, artifacts, signal)),
    parser as unknown as NodeJS.WritableStream,
    { signal },
  )
  reading.catch(() => undefined)
  canonicalResult.catch(() => undefined)
  try {
    let index = 0
    for await (const entry of parser) {
      signal?.throwIfAborted()
      const expected = snapshot.material.files[index++]
      if (
        !expected ||
        entry.header.type !== 'file' ||
        entry.header.name !== `workspace/${expected.path}` ||
        entry.header.mode !== expected.mode ||
        entry.header.size !== expected.byteLength
      ) {
        throw new Error('candidate workspace archive does not match its snapshot manifest')
      }
      const file = destination ? await openDestination(destination, expected.path) : undefined
      try {
        async function* checked(): AsyncGenerator<Uint8Array> {
          const hash = createHash('sha256')
          let byteLength = 0
          for await (const chunk of entry) {
            if (!(chunk instanceof Uint8Array))
              throw new Error('workspace entry emitted a non-byte chunk')
            signal?.throwIfAborted()
            byteLength += chunk.byteLength
            if (byteLength > expected!.byteLength)
              throw new Error('workspace entry exceeds its manifest length')
            hash.update(chunk)
            if (file) await file.writeFile(chunk)
            selected?.get(expected!.path)?.push(Uint8Array.from(chunk))
            yield chunk
          }
          if (
            byteLength !== expected!.byteLength ||
            `sha256:${hash.digest('hex')}` !== expected!.sha256
          ) {
            throw new Error('candidate workspace archive does not match its snapshot manifest')
          }
        }
        await appendTarFile(canonical, expected, checked(), signal)
        if (file) await file.chmod(expected.mode)
      } finally {
        await file?.close()
      }
    }
    if (index !== snapshot.material.files.length)
      throw new Error('candidate workspace archive does not match its snapshot manifest')
    await reading
    canonical.finalize()
    const observed = await canonicalResult
    if (
      observed.byteLength !== snapshot.archive.byteLength ||
      observed.sha256 !== snapshot.archive.sha256
    ) {
      throw new Error('candidate workspace tar is not canonical')
    }
  } catch (error) {
    parser.destroy(asError(error))
    canonical.destroy(asError(error))
    await Promise.allSettled([reading, canonicalResult])
    throw error
  }
}

async function openDestination(destination: string, relativePath: string) {
  const path = workspacePath(destination, relativePath)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
}

async function* workspaceArchiveChunks(
  root: string,
  material: AgentCandidateWorkspaceManifestMaterial,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const archive = pack()
  const writing = (async () => {
    try {
      for (const file of material.files) {
        signal?.throwIfAborted()
        await appendTarFile(archive, file, workspaceFileChunks(root, file, signal), signal)
      }
      archive.finalize()
    } catch (error) {
      archive.destroy(asError(error))
      throw error
    }
  })()
  writing.catch(() => undefined)
  try {
    for await (const chunk of archive) {
      if (!(chunk instanceof Uint8Array))
        throw new Error('workspace archive emitted a non-byte chunk')
      signal?.throwIfAborted()
      yield chunk
    }
    await writing
  } finally {
    archive.destroy()
    await writing.catch(() => undefined)
  }
}

async function* workspaceFileChunks(
  root: string,
  expected: WorkspaceFile,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const path = workspacePath(root, expected.path)
  if ((await realpath(path)) !== path)
    throw new Error(`workspace file path changed during capture: ${expected.path}`)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stats = await file.stat()
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.size !== expected.byteLength ||
      (stats.mode & 0o777) !== expected.mode
    ) {
      throw new Error(`workspace file changed during capture: ${expected.path}`)
    }
    const hash = createHash('sha256')
    let byteLength = 0
    for await (const chunk of file.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
    })) {
      signal?.throwIfAborted()
      byteLength += chunk.byteLength
      if (byteLength > expected.byteLength)
        throw new Error(`workspace file changed during capture: ${expected.path}`)
      hash.update(chunk)
      yield chunk
    }
    if (byteLength !== expected.byteLength || `sha256:${hash.digest('hex')}` !== expected.sha256) {
      throw new Error(`workspace file changed during capture: ${expected.path}`)
    }
  } finally {
    await file.close()
  }
}

async function appendTarFile(
  archive: Pack,
  file: WorkspaceFile,
  chunks: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): Promise<void> {
  const entry = archive.entry(
    workspaceTarHeader(`workspace/${file.path}`, file.mode, file.byteLength),
  )
  await pipeline(Readable.from(chunks), entry as unknown as NodeJS.WritableStream, { signal })
}

async function digestChunks(
  chunks: AsyncIterable<unknown>,
  maxBytes: number,
  signal?: AbortSignal,
) {
  const hash = createHash('sha256')
  let byteLength = 0
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array))
      throw new Error('workspace archive emitted a non-byte chunk')
    signal?.throwIfAborted()
    byteLength += chunk.byteLength
    if (byteLength > maxBytes)
      throw new Error('candidate workspace archive exceeds maxArchiveBytes')
    hash.update(chunk)
  }
  return { sha256: `sha256:${hash.digest('hex')}`, byteLength }
}

function validateManifest(
  material: AgentCandidateWorkspaceManifestMaterial,
  limits: AgentCandidateWorkspaceArchiveLimits,
): void {
  if (
    material.kind !== 'agent-candidate-workspace-manifest' ||
    material.files.length > limits.maxFiles
  )
    throw new Error('candidate workspace exceeds maxFiles')
  let total = 0
  let previous: string | undefined
  const paths = new Set<string>()
  for (const file of material.files) {
    safeArchivePath(file.path, limits.maxPathBytes)
    assertWorkspacePathOrder(
      file.path,
      previous,
      paths,
      'candidate workspace paths must be unique and sorted',
    )
    previous = file.path
    if (!Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o777)
      throw new Error('candidate workspace file has unsupported mode')
    if (
      !Number.isSafeInteger(file.byteLength) ||
      file.byteLength < 0 ||
      file.byteLength > limits.maxFileBytes
    )
      throw new Error('candidate workspace file exceeds maxFileBytes')
    total += file.byteLength
    if (total > limits.maxTotalFileBytes)
      throw new Error('candidate workspace exceeds maxTotalFileBytes')
  }
}

async function* oneChunk(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes
}
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
