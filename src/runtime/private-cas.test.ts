import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { durableSyncCount } from './durable-sync'
import { createPrivateCasArtifactPort } from './private-cas'
import { diskS3StreamStore } from '../../tests/fixtures/disk-s3-stream-store'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('publishes and reopens hashed private bytes under one run identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'private-cas-'))
  roots.push(root)
  const port = createPrivateCasArtifactPort(join(root, 'evidence'), 'run-1')
  const bytes = Buffer.from('exact workspace bytes')
  const ref = await port.put({
    executionId: 'node-1',
    purpose: 'candidate-workspace-archive',
    bytes,
  })
  expect(ref.locator).toMatchObject({ kind: 'private-cas', namespace: 'run-1', digest: ref.sha256 })
  expect(Buffer.from(await port.read(ref)).equals(bytes)).toBe(true)
  await expect(
    createPrivateCasArtifactPort(join(root, 'evidence'), 'run-2').read(ref),
  ).rejects.toThrow('namespace')
  const hash = ref.sha256.slice(7)
  const path = join(root, 'evidence', 'sha256', hash.slice(0, 2), hash)
  expect((await readFile(path)).equals(bytes)).toBe(true)
  expect(await port.offload()).toMatchObject({ pending: [], durable: 0, localObjects: 1 })
  await writeFile(path, 'altered')
  await expect(port.read(ref)).rejects.toThrow('digest or length')
})

it('refuses a symlink in the private artifact path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'private-cas-'))
  roots.push(root)
  await mkdir(join(root, 'actual'))
  await symlink(join(root, 'actual'), join(root, 'evidence'))
  const port = createPrivateCasArtifactPort(join(root, 'evidence'), 'run-1')
  await expect(
    port.put({ executionId: 'node-1', purpose: 'trace', bytes: Buffer.from('trace') }),
  ).rejects.toThrow('real directory')
})

it('an ephemeral store streams, publishes and copies its objects off the host without one fsync; a store read after a restart fsyncs each', async () => {
  const root = await mkdtemp(join(tmpdir(), 'private-cas-ephemeral-'))
  roots.push(root)
  const capture = async (name: string, ephemeral: boolean) => {
    const bucket = await diskS3StreamStore(join(root, `${name}-bucket`))
    const port = createPrivateCasArtifactPort(join(root, name), 'run-1', { durable: bucket.store, ephemeral })
    const before = durableSyncCount()
    const refs = []
    // The streaming write path, as a workspace capture stores its files (workspace-streams.ts).
    for (const index of [1, 2, 3]) {
      const bytes = Buffer.from(`file ${index}\n`)
      refs.push(await port.putStream!({ executionId: 'node-1', purpose: 'candidate-workspace-file', byteLength: bytes.byteLength, chunks: (async function* () { yield bytes })() }))
    }
    const report = await port.offload()
    return { port, refs, report, syncs: durableSyncCount() - before, uploads: bucket.counts().uploads }
  }
  const staged = await capture('staging', true)
  expect(staged.syncs).toBe(0)
  expect(staged.report).toMatchObject({ pending: [], durable: 3 })
  // Each object went to the bucket as a stream: the fixture refuses a buffered put.
  expect(staged.uploads).toBe(3)
  // Every object is published, readable and has its durable receipt: only the fsyncs are gone.
  for (const ref of staged.refs) {
    expect(Buffer.from(await staged.port.read(ref)).toString()).toMatch(/^file \d\n$/)
    expect(JSON.parse(await readFile(join(root, 'staging', 'durable', 'sha256', ref.sha256.slice(7)), 'utf8'))).toMatchObject({ digest: ref.sha256, namespace: 'run-1' })
  }
  // The same capture into a store read after a restart: each object and each receipt is fsynced, with its directory.
  const kept = await capture('run', false)
  expect(kept.syncs).toBeGreaterThanOrEqual(12)
})

it('ephemeral is a boolean and needs a durable store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'private-cas-ephemeral-'))
  roots.push(root)
  expect(() => createPrivateCasArtifactPort(join(root, 'a'), 'run-1', { ephemeral: 'false' as unknown as boolean })).toThrow('ephemeral must be a boolean')
  expect(() => createPrivateCasArtifactPort(join(root, 'b'), 'run-1', { ephemeral: true })).toThrow('ephemeral needs a durable store')
})
