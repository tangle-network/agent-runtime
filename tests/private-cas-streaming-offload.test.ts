import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { scanMaterializedWorkspaceManifest } from '../src/candidate-execution/artifacts'
import {
  captureAgentCandidateWorkspaceToArtifacts,
  materializeAgentCandidateWorkspaceFromArtifacts,
} from '../src/candidate-execution/workspace-streams'
import { createPrivateCasArtifactPort } from '../src/runtime/private-cas'
import { diskS3StreamStore } from './fixtures/disk-s3-stream-store'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('streams to S3, evicts local copies, and restores the exact archive through remote streams', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-stream-offload-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'a'), 'executable retained evidence')
  const durable = await diskS3StreamStore(join(root, 'remote'))
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
    durable: durable.store,
    localBudgetBytes: 0,
  })
  const { snapshot } = await captureAgentCandidateWorkspaceToArtifacts(source, {
    artifactPersistence: { executionId: 'node', outputArtifacts: artifacts },
  })
  expect(await artifacts.offload()).toMatchObject({
    durable: 2,
    localBytes: 0,
    localObjects: 0,
    pending: [],
  })
  await materializeAgentCandidateWorkspaceFromArtifacts({
    role: 'candidate',
    snapshot,
    artifacts,
    destination: join(root, 'restore'),
  })
  expect(await scanMaterializedWorkspaceManifest(join(root, 'restore'))).toEqual(snapshot.material)
  expect(durable.counts().uploads).toBe(2)
  expect(durable.counts().reads).toBeGreaterThanOrEqual(4)
})

it('refuses streaming capture before source reads with a buffered-only durable store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-legacy-store-'))
  roots.push(root)
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
    durable: {
      location: 'legacy:test',
      put: async () => {},
      get: async () => undefined,
    },
  })
  await expect(
    captureAgentCandidateWorkspaceToArtifacts(join(root, 'nonexistent'), {
      artifactPersistence: { executionId: 'node', outputArtifacts: artifacts },
    }),
  ).rejects.toThrow('putStream and readStream')
  expect(await readdir(root)).toEqual([])
})
