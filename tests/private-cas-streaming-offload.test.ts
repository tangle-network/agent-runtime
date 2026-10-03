import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { scanMaterializedWorkspaceManifest } from '../src/candidate-execution/artifacts'
import { captureAgentCandidateWorkspaceFiles } from '../src/candidate-execution/workspace-archive'
import {
  captureAgentCandidateWorkspaceToArtifacts,
  materializeAgentCandidateWorkspaceFromArtifacts,
} from '../src/candidate-execution/workspace-streams'
import { createPrivateCasArtifactPort } from '../src/runtime/private-cas'
import { captureProviderWorkspaceSnapshot } from '../src/runtime/provider-workspace-retention'
import { diskS3StreamStore } from './fixtures/disk-s3-stream-store'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it.each([0, 1024])(
  'reports a buffered upload as pending when a streamed put reuses its digest, local budget=%s',
  async (localBudgetBytes) => {
    const root = await mkdtemp(join(tmpdir(), 'cas-pending-upload-'))
    roots.push(root)
    const objects = new Map<string, Uint8Array>()
    const bytes = Buffer.from('retained evidence')
    let started!: () => void
    let complete!: () => void
    const uploading = new Promise<void>((resolve) => {
      started = resolve
    })
    const release = new Promise<void>((resolve) => {
      complete = resolve
    })
    const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
      localBudgetBytes,
      durable: {
        location: 'fixture:pending-upload',
        async put({ digest, bytes }) {
          started()
          await release
          objects.set(digest, Uint8Array.from(bytes))
        },
        get: async ({ digest }) => objects.get(digest),
        async putStream() {
          throw new Error('a concurrent offload must not duplicate the buffered upload')
        },
        async getStream({ digest }) {
          const value = objects.get(digest)
          return value === undefined
            ? undefined
            : (async function* () {
                yield value
              })()
        },
      },
    })
    const buffered = artifacts.put({ executionId: 'buffered', purpose: 'trace', bytes })
    try {
      await uploading
      const ref = await artifacts.putStream!({
        executionId: 'streamed',
        purpose: 'trace',
        chunks: (async function* () {
          yield bytes
        })(),
      })
      expect(objects.size).toBe(0)
      expect(await artifacts.read(ref)).toEqual(bytes)
      expect(await artifacts.offload()).toMatchObject({
        durable: 0,
        localObjects: 1,
        pending: [{ digest: ref.sha256, error: 'durable upload in progress' }],
      })
    } finally {
      complete()
      await buffered
    }
    expect(await artifacts.offload()).toMatchObject({
      durable: 1,
      localObjects: localBudgetBytes === 0 ? 0 : 1,
      pending: [],
    })
  },
)

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

it('keeps buffered provider verification after a legacy durable store evicts local objects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-buffered-retention-'))
  roots.push(root)
  const objects = new Map<string, Uint8Array>()
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
    localBudgetBytes: 0,
    durable: {
      location: 'fixture:buffered',
      put: async ({ digest, bytes }) => {
        objects.set(digest, Uint8Array.from(bytes))
      },
      get: async ({ digest }) => objects.get(digest),
    },
  })
  expect(artifacts.putStream).toBeUndefined()
  expect(artifacts.readStream).toBeUndefined()
  const { snapshot } = await captureAgentCandidateWorkspaceFiles(
    [{ path: 'a', mode: 0o600, bytes: Buffer.from('legacy durable evidence') }],
    { artifactPersistence: { executionId: 'node', outputArtifacts: artifacts } },
  )
  expect(await artifacts.offload()).toMatchObject({ localBytes: 0, localObjects: 0, durable: 2 })
  const result = await captureProviderWorkspaceSnapshot(
    {
      timeoutMs: 5_000,
      artifacts,
      capture: async () => snapshot,
    },
    {
      environment: {
        id: 'environment',
        provider: 'fixture',
        status: async () => 'running',
        stream: async function* () {},
        destroy: async () => {},
      },
      executionId: 'node',
      profile: { name: 'legacy-store' },
    },
  )
  expect(result.snapshot).toEqual(snapshot)
})
