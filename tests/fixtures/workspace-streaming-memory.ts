import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getHeapStatistics } from 'node:v8'
import { scanMaterializedWorkspaceManifest } from '../../src/candidate-execution/artifacts'
import {
  captureAgentCandidateWorkspaceToArtifacts,
  materializeAgentCandidateWorkspaceFromArtifacts,
  verifyAgentCandidateWorkspaceArtifacts,
} from '../../src/candidate-execution/workspace-streams'
import { createPrivateCasArtifactPort } from '../../src/runtime/private-cas'

const root = await mkdtemp(join(tmpdir(), 'workspace-streaming-memory-'))
let peakRss = 0
let peakHeap = 0
let peakExternal = 0
const sample = () => {
  const memory = process.memoryUsage()
  peakRss = Math.max(peakRss, memory.rss)
  peakHeap = Math.max(peakHeap, memory.heapUsed)
  peakExternal = Math.max(peakExternal, memory.external)
}
const sampler = setInterval(sample, 5)
const sizes = [2 * 1024 ** 3 + 65, 1024 ** 3 + 129]
try {
  const source = join(root, 'source')
  await mkdir(source)
  // Real sparse files contain nonzero sentinels; every logical byte is captured, hashed and restored.
  for (const [index, size] of sizes.entries()) {
    const file = await open(join(source, `large-${index}.bin`), 'wx', 0o600)
    try {
      await file.truncate(size)
      await file.write(Buffer.alloc(64 * 1024, index + 1), 0, 64 * 1024, 0)
      await file.write(Buffer.from(`end-${index}`), 0, 5, size - 5)
    } finally {
      await file.close()
    }
  }
  const store = createPrivateCasArtifactPort(join(root, 'artifacts'), 'memory-proof')
  let maxReadChunk = 0
  const artifacts = {
    ...store,
    read: async (): Promise<Uint8Array> => {
      throw new Error('whole-object read is forbidden')
    },
    put: async (): Promise<never> => {
      throw new Error('whole-object write is forbidden')
    },
    async *readStream(ref: Parameters<NonNullable<typeof store.readStream>>[0]) {
      for await (const chunk of store.readStream!(ref)) {
        maxReadChunk = Math.max(maxReadChunk, chunk.byteLength)
        yield chunk
      }
    },
  }
  const limits = {
    maxFileBytes: sizes[0]!,
    maxTotalFileBytes: 4 * 1024 ** 3,
    maxArchiveBytes: 4 * 1024 ** 3,
  }
  const { snapshot } = await captureAgentCandidateWorkspaceToArtifacts(source, {
    limits,
    artifactPersistence: { executionId: 'node-1', outputArtifacts: artifacts },
  })
  await verifyAgentCandidateWorkspaceArtifacts({ role: 'candidate', snapshot, artifacts, limits })
  const destination = join(root, 'restored')
  await materializeAgentCandidateWorkspaceFromArtifacts({
    role: 'candidate',
    snapshot,
    artifacts,
    limits,
    destination,
  })
  assert.deepEqual(await scanMaterializedWorkspaceManifest(destination), snapshot.material)
  sample()
  peakRss = Math.max(peakRss, process.resourceUsage().maxRSS * 1024)
  const receipt = {
    fileBytes: sizes,
    archiveBytes: snapshot.archive.byteLength,
    snapshotDigest: snapshot.digest,
    archiveDigest: snapshot.archive.sha256,
    heapLimit: getHeapStatistics().heap_size_limit,
    peakRss,
    peakHeap,
    peakExternal,
    maxReadChunk,
    restoredManifestMatches: true,
  }
  console.log(JSON.stringify(receipt))
  assert(snapshot.archive.byteLength > 3 * 1024 ** 3)
  assert(maxReadChunk <= 64 * 1024)
  assert(peakRss < 384 * 1024 ** 2, `peak RSS exceeded bound: ${peakRss}`)
  assert(peakExternal < 128 * 1024 ** 2, `external buffers exceeded bound: ${peakExternal}`)
} finally {
  clearInterval(sampler)
  await rm(root, { recursive: true, force: true })
}
