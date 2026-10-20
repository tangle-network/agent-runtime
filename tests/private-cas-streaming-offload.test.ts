import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { scanMaterializedWorkspaceManifest } from '../src/candidate-execution/artifacts'
import { captureAgentCandidateWorkspaceFiles } from '../src/candidate-execution/workspace-archive'
import {
  captureAgentCandidateWorkspaceToArtifacts,
  captureAgentCandidateWorkspaceTreeToArtifacts,
  materializeAgentCandidateWorkspaceFromArtifacts,
  verifyAgentCandidateWorkspaceTree,
} from '../src/candidate-execution/workspace-streams'
import type { PrivateCasDurableStore } from '../src/runtime/private-cas'
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
    // With a budget of 0 the local copy is evicted, so the read comes back from the store.
    expect(Buffer.from(await artifacts.read(ref))).toEqual(bytes)
    expect(await artifacts.offload()).toMatchObject({
      durable: 1,
      localObjects: localBudgetBytes === 0 ? 0 : 1,
      pending: [],
    })
  },
)

it('a pass waiting for a copy in flight stops at its own cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-wait-abort-'))
  roots.push(root)
  const objects = new Map<string, Uint8Array>()
  let started!: () => void
  let complete!: () => void
  const uploading = new Promise<void>((resolve) => {
    started = resolve
  })
  const release = new Promise<void>((resolve) => {
    complete = resolve
  })
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
    durable: {
      location: 'fixture:stalled-upload',
      async put({ digest, bytes }) {
        started()
        await release
        objects.set(digest, Uint8Array.from(bytes))
      },
      get: async ({ digest }) => objects.get(digest),
    },
  })
  const bytes = Buffer.from('evidence behind a stalled upload')
  const buffered = artifacts.put({ executionId: 'stalled', purpose: 'trace', bytes })
  await uploading
  const controller = new AbortController()
  const pass = artifacts.offload(controller.signal)
  controller.abort('the caller stopped')
  await expect(pass).rejects.toThrow('the caller stopped')
  complete()
  await buffered
  expect(await artifacts.offload()).toMatchObject({ durable: 1, pending: [] })
})

// test-acceptance-canary-20261019j: every put of a checkpoint capture queued its own pass, and a
// final capture on the same store waited 26.6 minutes behind them. Callers that arrive while a
// pass waits to start share it.
it('offload calls made while a pass waits to start share one pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-shared-pass-'))
  roots.push(root)
  const objects = new Map<string, Uint8Array>()
  let started!: () => void
  let complete!: () => void
  const uploading = new Promise<void>((resolve) => {
    started = resolve
  })
  const release = new Promise<void>((resolve) => {
    complete = resolve
  })
  let held = true
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
    durable: {
      location: 'fixture:held-then-free',
      async put({ digest, bytes }) {
        if (held) {
          held = false
          started()
          await release
        }
        objects.set(digest, Uint8Array.from(bytes))
      },
      get: async ({ digest }) => objects.get(digest),
    },
  })
  // A first put holds its copy, so the first pass, which waits for it, stays running.
  const first = artifacts.put({ executionId: 'first', purpose: 'trace', bytes: Buffer.from('a') })
  await uploading
  const running = artifacts.offload()
  // Objects written while that pass runs, then many offload calls behind it.
  const later = ['b', 'c', 'd'].map((text) =>
    artifacts.put({ executionId: text, purpose: 'trace', bytes: Buffer.from(text) }),
  )
  const queued = Array.from({ length: 25 }, () => artifacts.offload())
  const cancelled = new AbortController()
  const leaving = artifacts.offload(cancelled.signal)
  cancelled.abort('the caller stopped')
  await expect(leaving).rejects.toThrow('the caller stopped')
  complete()
  await first
  await running
  const reports = await Promise.all(queued)
  expect(new Set(reports).size).toBe(1)
  expect(reports[0]).toMatchObject({ pending: [] })
  for (const ref of await Promise.all(later)) expect(objects.has(ref.sha256)).toBe(true)
})

// test-acceptance-canary-20261019q: every offload listed every object of the store and read its
// receipt, twice per capture, 60.1-63.2 s on each native copy. After a process's first full pass a
// pass reads only the objects that process wrote without a receipt, so a restart is what finds an
// earlier process's leftovers, never an in-memory set alone.
function mapDurable() {
  const objects = new Map<string, Uint8Array>()
  const store: PrivateCasDurableStore = {
    location: 'fixture:map',
    async put({ digest, bytes }) {
      objects.set(digest, Uint8Array.from(bytes))
    },
    get: async ({ digest }) => objects.get(digest),
  }
  return { store, objects }
}

it('a restarted process uploads the objects an earlier process left on disk without a receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-restart-offload-'))
  roots.push(root)
  const local = join(root, 'local')
  // What a process that stopped before its uploads leaves: objects, and no receipts.
  const digests: string[] = []
  for (const text of ['first', 'second', 'third']) {
    const bytes = Buffer.from(text)
    const hex = createHash('sha256').update(bytes).digest('hex')
    await mkdir(join(local, 'sha256', hex.slice(0, 2)), { recursive: true, mode: 0o700 })
    await writeFile(join(local, 'sha256', hex.slice(0, 2), hex), bytes, { mode: 0o600 })
    digests.push(`sha256:${hex}`)
  }
  const durable = mapDurable()
  const restarted = createPrivateCasArtifactPort(local, 'test', { durable: durable.store })
  const report = await restarted.offload()
  expect(report.pending).toEqual([])
  expect(report.durable).toBe(3)
  for (const digest of digests) expect(durable.objects.has(digest)).toBe(true)
})

it('a pass after the first reads only what this process wrote, and a restart finds the rest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-incremental-offload-'))
  roots.push(root)
  const local = join(root, 'local')
  const durable = mapDurable()
  const cas = createPrivateCasArtifactPort(local, 'test', { durable: durable.store })
  await cas.put({ executionId: 'a', purpose: 'trace', bytes: Buffer.from('written by a put') })
  expect((await cas.offload()).pending).toEqual([])
  // An object placed straight into the store, as an earlier process would have left it.
  const bytes = Buffer.from('left by an earlier process')
  const hex = createHash('sha256').update(bytes).digest('hex')
  await mkdir(join(local, 'sha256', hex.slice(0, 2)), { recursive: true, mode: 0o700 })
  await writeFile(join(local, 'sha256', hex.slice(0, 2), hex), bytes, { mode: 0o600 })
  // This process's next pass does not walk the store, so it does not see the object.
  await cas.offload()
  expect(durable.objects.has(`sha256:${hex}`)).toBe(false)
  // A new process's first pass is full, and uploads it.
  const restarted = createPrivateCasArtifactPort(local, 'test', { durable: durable.store })
  expect((await restarted.offload()).pending).toEqual([])
  expect(durable.objects.has(`sha256:${hex}`)).toBe(true)
})

// A store that hangs without failing, and ignores its signal, held every put and pass sharing the
// digest, and a caller with no signal of its own could never leave. The stall ends the hung copy;
// the next try lands and both puts return.
it('a durable copy that hangs is abandoned after its stall and retried, so puts without a signal return', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-hung-copy-'))
  roots.push(root)
  const objects = new Map<string, Uint8Array>()
  let copies = 0
  let hanging!: () => void
  const hung = new Promise<void>((resolve) => {
    hanging = resolve
  })
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
    durableStallMs: 200,
    durable: {
      location: 'fixture:hung-copy',
      async put() {
        throw new Error('streamed objects use putStream')
      },
      get: async ({ digest }) => objects.get(digest),
      async putStream({ digest, chunks }) {
        copies++
        if (copies === 1) {
          hanging()
          // Never settles, never pulls a chunk and ignores its signal.
          return new Promise<void>(() => undefined)
        }
        const parts: Uint8Array[] = []
        for await (const chunk of chunks) parts.push(chunk)
        objects.set(digest, Buffer.concat(parts))
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
  const bytes = Buffer.from('evidence behind a hung copy')
  const put = () =>
    artifacts.putStream!({
      executionId: 'node',
      purpose: 'trace',
      chunks: (async function* () {
        yield bytes
      })(),
    })
  const first = put()
  await hung
  const [ref] = await Promise.all([first, put()])
  expect(copies).toBe(2)
  expect(Buffer.from(await artifacts.read(ref))).toEqual(bytes)
  expect(await artifacts.offload()).toMatchObject({ durable: 1, pending: [] })
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

// Each file's put waits for its own durable copy, so a tree captured one file at a time paid a
// store round trip per file: drew-gtr-pro's retire stored one 2 KB file per 1.8 s (2026-10-18).
it('captures a workspace tree with several durable copies in flight, each distinct file copied once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-tree-concurrent-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  await Promise.all(
    Array.from({ length: 32 }, (_, index) => writeFile(join(source, `f${index}`), `file ${index}`)),
  )
  await writeFile(join(source, 'same-as-f0'), 'file 0')
  const durable = await diskS3StreamStore(join(root, 'remote'))
  let inFlight = 0
  let most = 0
  let overlapped!: () => void
  const overlap = new Promise<void>((resolve) => {
    overlapped = resolve
  })
  // A slow store: each upload waits until four overlap. The bound only lets a capture that copies
  // one file at a time finish, so the assertion below fails instead of the test timing out.
  const slow: PrivateCasDurableStore = {
    ...durable.store,
    async putStream(object) {
      most = Math.max(most, ++inFlight)
      if (inFlight >= 4) overlapped()
      try {
        await Promise.race([overlap, new Promise((settle) => setTimeout(settle, 100))])
        await durable.store.putStream!(object)
      } finally {
        inFlight--
      }
    },
  }
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', { durable: slow })
  const tree = await captureAgentCandidateWorkspaceTreeToArtifacts(source, {
    artifactPersistence: { executionId: 'node', outputArtifacts: artifacts },
  })
  expect(most).toBeGreaterThanOrEqual(4)
  expect(tree).toMatchObject({ files: 33, storedBytes: tree.bytes - 'file 0'.length })
  // 32 distinct files and the manifest; the file with f0's content is f0's object.
  expect(durable.counts().uploads).toBe(33)
  const material = await verifyAgentCandidateWorkspaceTree(tree, artifacts)
  expect(material.files.map((file) => file.path).sort()).toEqual(
    [...Array.from({ length: 32 }, (_, index) => `f${index}`), 'same-as-f0'].sort(),
  )
})

it('leaves named paths out of a tree capture, so a recapture stores only changed work', async () => {
  // The shape of Discovery canary 20b: a provider's retained native session tree, its final
  // session record and provenance (kept: no native capture holds their last versions), and a
  // virtualenv, beside the work.
  const root = await mkdtemp(join(tmpdir(), 'cas-tree-excluded-'))
  roots.push(root)
  const source = join(root, 'source')
  const sessionTree = join(source, '__retention__', 'sessions', 's1')
  await mkdir(sessionTree, { recursive: true })
  await mkdir(join(source, '.venv', 'lib'), { recursive: true })
  await mkdir(join(source, 'work', '.venv'), { recursive: true })
  await writeFile(join(sessionTree, 'raw-manifest.json'), 'x'.repeat(4096))
  await writeFile(join(source, '__retention__', 'sessions', 's1.json'), 'record 1')
  await writeFile(join(source, '__retention__', 'provenance.json'), 'provenance 1')
  await writeFile(join(source, '.venv', 'lib', 'numpy.so'), 'y'.repeat(4096))
  await writeFile(join(source, 'work', '.venv', 'kept.md'), 'only the named path is left out')
  await writeFile(join(source, 'work', 'result.md'), 'first')
  const durable = await diskS3StreamStore(join(root, 'remote'))
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
    durable: durable.store,
  })
  const capture = () =>
    captureAgentCandidateWorkspaceTreeToArtifacts(source, {
      excludedPaths: ['__retention__/sessions/s1', '.venv'],
      artifactPersistence: { executionId: 'node', outputArtifacts: artifacts },
    })

  const first = await capture()
  const material = await verifyAgentCandidateWorkspaceTree(first, artifacts)
  expect(material.files.map((file) => file.path).sort()).toEqual([
    '__retention__/provenance.json',
    '__retention__/sessions/s1.json',
    'work/.venv/kept.md',
    'work/result.md',
  ])
  await writeFile(join(sessionTree, 'raw-manifest.json'), 'z'.repeat(8192))
  await writeFile(join(source, 'work', 'result.md'), 'second')
  const second = await capture()
  expect(second).toMatchObject({ files: 4, storedBytes: 'second'.length })

  await expect(
    captureAgentCandidateWorkspaceTreeToArtifacts(source, {
      excludedPaths: ['work/../.venv'],
      artifactPersistence: { executionId: 'node', outputArtifacts: artifacts },
    }),
  ).rejects.toThrow(/safe relative path/)
})

// A pass copied one object at a time, each a store round trip plus a receipt with two fsyncs:
// 2 objects/s on drew-gtr-pro, so one archived run of 3,563 objects held a retire pass 30 min.
it('a pass copies host-only objects with several durable copies in flight', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-pass-concurrent-'))
  roots.push(root)
  // Objects another writer left host-only, as an archived run's evidence is.
  for (let index = 0; index < 32; index++) {
    const text = `host-only object ${index}`
    const hex = createHash('sha256').update(text).digest('hex')
    await mkdir(join(root, 'local', 'sha256', hex.slice(0, 2)), { recursive: true })
    await writeFile(join(root, 'local', 'sha256', hex.slice(0, 2), hex), text)
  }
  const durable = await diskS3StreamStore(join(root, 'remote'))
  let inFlight = 0
  let most = 0
  let overlapped!: () => void
  const overlap = new Promise<void>((resolve) => {
    overlapped = resolve
  })
  // A slow store: each copy waits until four overlap. The bound only lets a pass that copies one
  // object at a time finish, so the assertion below fails instead of the test timing out.
  const slow: PrivateCasDurableStore = {
    ...durable.store,
    async putStream(object) {
      most = Math.max(most, ++inFlight)
      if (inFlight >= 4) overlapped()
      try {
        await Promise.race([overlap, new Promise((settle) => setTimeout(settle, 100))])
        await durable.store.putStream!(object)
      } finally {
        inFlight--
      }
    },
  }
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', { durable: slow })
  expect(await artifacts.offload()).toMatchObject({ durable: 32, uploaded: 32, pending: [] })
  expect(most).toBeGreaterThanOrEqual(4)
  expect(durable.counts().uploads).toBe(32)
  expect(await artifacts.offload()).toMatchObject({ durable: 32, uploaded: 0, pending: [] })
})

it('a pass copies one object at a time to a buffered store, which holds each object in memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cas-pass-buffered-'))
  roots.push(root)
  for (let index = 0; index < 8; index++) {
    const text = `buffered host-only object ${index}`
    const hex = createHash('sha256').update(text).digest('hex')
    await mkdir(join(root, 'local', 'sha256', hex.slice(0, 2)), { recursive: true })
    await writeFile(join(root, 'local', 'sha256', hex.slice(0, 2), hex), text)
  }
  const objects = new Map<string, Uint8Array>()
  let inFlight = 0
  let most = 0
  const artifacts = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
    durable: {
      location: 'fixture:buffered-one-at-a-time',
      async put({ digest, bytes }) {
        most = Math.max(most, ++inFlight)
        // Yield so that a second copy, if the pass started one, would overlap this one.
        await new Promise((settle) => setImmediate(settle))
        objects.set(digest, Uint8Array.from(bytes))
        inFlight--
      },
      get: async ({ digest }) => objects.get(digest),
    },
  })
  expect(await artifacts.offload()).toMatchObject({ durable: 8, uploaded: 8, pending: [] })
  expect(most).toBe(1)
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
  // An object another writer left host-only. This process's passes read only what it wrote; the
  // next process's first pass, as at the run's settle-time offload, is full and uploads it.
  const foreign = createHash('sha256').update('left by another writer').digest('hex')
  await mkdir(join(root, 'local', 'sha256', foreign.slice(0, 2)), { recursive: true })
  await writeFile(
    join(root, 'local', 'sha256', foreign.slice(0, 2), foreign),
    'left by another writer',
  )
  await put('second object')
  expect(durable.counts().uploads).toBe(3)
  expect(await artifacts.offload()).toMatchObject({ durable: 3, pending: [] })
  expect(durable.counts().uploads).toBe(3)
  const settling = createPrivateCasArtifactPort(join(root, 'local'), 'test', {
    durable: durable.store,
    localBudgetBytes: 1024 * 1024,
  })
  expect(await settling.offload()).toMatchObject({ durable: 4, localObjects: 4, pending: [] })
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
