import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, mkdtemp, open, realpath, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  AgentCandidateWorkspaceManifestMaterial,
  AgentCandidateWorkspaceSnapshotEvidence,
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
