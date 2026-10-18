import { createHash } from 'node:crypto'
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

// A capture refuses when its pass reports anything pending, so a second capture's put and pass
// that meet the first capture's copy in flight must wait for it, not report it or copy it again.
it.each([0, 1024])(
  'waits for a buffered upload in flight when a streamed put and a pass reuse its digest, local budget=%s',
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
    await uploading
    const streamed = artifacts.putStream!({
      executionId: 'streamed',
      purpose: 'trace',
      chunks: (async function* () {
        yield bytes
      })(),
    })
    const pass = artifacts.offload()
    // Before the fix both settled at once, the pass reporting 'durable upload in progress'. The
    // bound only gives that bug time to show; a correct port waits however long the copy takes.
    const early = await Promise.race([
      Promise.any([streamed, pass]).then(() => 'settled'),
      new Promise((settle) => setTimeout(settle, 500, 'waiting')),
    ])
    expect(early).toBe('waiting')
    expect(objects.size).toBe(0)
    complete()
    const [ref] = await Promise.all([streamed, buffered])
    expect(await pass).toMatchObject({ durable: 1, uploaded: 0, pending: [] })
    expect(objects.size).toBe(1)
    expect(await artifacts.read(ref)).toEqual(bytes)
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

it('uploads a streamed put by itself after a clean pass, leaving other objects to offload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-put-no-pass-'))
  roots.push(root)
  const durable = await diskS3StreamStore(join(root, 'remote'))
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
    durable: durable.store,
    localBudgetBytes: 1024 * 1024,
  })
  const put = (text: string) =>
    artifacts.putStream!({
      executionId: 'node',
      purpose: 'trace',
      chunks: (async function* () {
        yield Buffer.from(text)
      })(),
    })
  // Two puts of one new object upload it once: the second waits for the first's copy.
  await Promise.all([put('same object'), put('same object')])
  expect(durable.counts().uploads).toBe(1)
  // The pair's pass left nothing pending, so this put copies only its own object.
  await put('first object')
  expect(durable.counts().uploads).toBe(2)
  // An object another writer left host-only: a full pass would upload it.
  const foreign = createHash('sha256').update('left by another writer').digest('hex')
  await mkdir(join(root, 'local', 'sha256', foreign.slice(0, 2)), { recursive: true })
  await writeFile(
    join(root, 'local', 'sha256', foreign.slice(0, 2), foreign),
    'left by another writer',
  )
  await put('second object')
  expect(durable.counts().uploads).toBe(3)
  expect(await artifacts.offload()).toMatchObject({ durable: 4, localObjects: 4, pending: [] })
  expect(durable.counts().uploads).toBe(4)
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
