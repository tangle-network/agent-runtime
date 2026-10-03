import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pack } from 'tar-stream'
import { afterEach, expect, it } from 'vitest'
import {
  type AgentCandidateArtifactPort,
  captureAgentCandidateWorkspace,
  captureAgentCandidateWorkspaceToArtifacts,
  materializeAgentCandidateWorkspaceFromArtifacts,
  scanMaterializedWorkspaceManifest,
  verifyAgentCandidateWorkspaceArtifacts,
} from '../src/candidate-execution'
import { createPrivateCasArtifactPort } from '../src/runtime/private-cas'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workspace-streams-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  const artifacts = createPrivateCasArtifactPort(join(root, 'cas'), 'run-1')
  const options = { artifactPersistence: { executionId: 'node-1', outputArtifacts: artifacts } }
  return { root, source, artifacts, options }
}

it('preserves canonical tar bytes, Unicode paths, exact modes, manifests and restore digests', async () => {
  const f = await fixture()
  await writeFile(join(f.source, 'empty'), '')
  await writeFile(join(f.source, 'executable'), '#!/bin/sh\ntrue\n')
  await chmod(join(f.source, 'executable'), 0o751)
  const nested = `nested-${'x'.repeat(120)}`
  await mkdir(join(f.source, nested))
  await writeFile(join(f.source, nested, 'λ.txt'), Buffer.from([0, 1, 128, 255]))
  const legacy = await captureAgentCandidateWorkspace(f.source)
  const { snapshot } = await captureAgentCandidateWorkspaceToArtifacts(f.source, f.options)
  expect(snapshot.material).toEqual(legacy.snapshot.material)
  expect(snapshot.digest).toBe(legacy.snapshot.digest)
  expect(snapshot.archive.sha256).toBe(legacy.snapshot.archive.sha256)
  if (!('locator' in snapshot.archive)) throw new Error('expected durable archive')
  expect(await f.artifacts.read(snapshot.archive)).toEqual(Buffer.from(legacy.archive))
  const streamOnly: AgentCandidateArtifactPort = {
    read: async () => {
      throw new Error('buffered read is forbidden')
    },
    readStream: f.artifacts.readStream,
  }
  await verifyAgentCandidateWorkspaceArtifacts({
    role: 'candidate',
    snapshot,
    artifacts: streamOnly,
  })
  await materializeAgentCandidateWorkspaceFromArtifacts({
    role: 'candidate',
    snapshot,
    artifacts: streamOnly,
    destination: join(f.root, 'restored'),
  })
  expect(await scanMaterializedWorkspaceManifest(join(f.root, 'restored'))).toEqual(
    snapshot.material,
  )
})

it('fails before reading a source when the store cannot stream', async () => {
  await expect(
    captureAgentCandidateWorkspaceToArtifacts('/source-must-not-be-read', {
      artifactPersistence: {
        executionId: 'node',
        outputArtifacts: {
          put: async () => {
            throw new Error('unexpected')
          },
          read: async () => {
            throw new Error('unexpected')
          },
        },
      },
    }),
  ).rejects.toThrow('putStream and readStream')
})

it.each(['truncated', 'corrupt'] as const)(
  'refuses %s durable readback without publishing a restore',
  async (kind) => {
    const f = await fixture()
    await writeFile(join(f.source, 'a'), 'original contents')
    const { snapshot } = await captureAgentCandidateWorkspaceToArtifacts(f.source, f.options)
    const artifacts: AgentCandidateArtifactPort = {
      ...f.artifacts,
      async *readStream(ref) {
        for await (const chunk of f.artifacts.readStream!(ref)) {
          if (ref.sha256 !== snapshot.archive.sha256) {
            yield chunk
            continue
          }
          if (kind === 'truncated') {
            yield chunk.subarray(0, 600)
            return
          }
          const altered = Buffer.from(chunk)
          altered[520] = altered[520]! ^ 1
          yield altered
        }
      },
    }
    const destination = join(f.root, 'restored')
    await expect(
      materializeAgentCandidateWorkspaceFromArtifacts({
        role: 'candidate',
        snapshot,
        artifacts,
        destination,
      }),
    ).rejects.toThrow()
    expect(await readdir(destination)).toEqual([])
    expect((await readdir(f.root)).some((name) => name.includes('.materializing-'))).toBe(false)
  },
)

it('rejects a correctly hashed archive with noncanonical tar headers', async () => {
  const f = await fixture()
  await writeFile(join(f.source, 'a'), 'contents')
  const { snapshot } = await captureAgentCandidateWorkspaceToArtifacts(f.source, f.options)
  const tar = pack()
  tar.entry(
    { name: 'workspace/a', mode: snapshot.material.files[0]!.mode, mtime: new Date(1000) },
    'contents',
  )
  tar.finalize()
  const archive = await f.artifacts.putStream!({
    executionId: 'node-1',
    purpose: 'candidate-workspace-archive',
    chunks: (async function* () {
      for await (const chunk of tar) {
        if (!(chunk instanceof Uint8Array)) throw new Error('expected bytes')
        yield chunk
      }
    })(),
  })
  await expect(
    verifyAgentCandidateWorkspaceArtifacts({
      role: 'candidate',
      snapshot: { ...snapshot, archive },
      artifacts: f.artifacts,
    }),
  ).rejects.toThrow('not canonical')
})

it('refuses a file changed between manifest scanning and tar capture', async () => {
  const f = await fixture()
  await writeFile(join(f.source, 'a'), 'before')
  const artifacts = {
    ...f.artifacts,
    putStream: async (input: Parameters<NonNullable<typeof f.artifacts.putStream>>[0]) => {
      const ref = await f.artifacts.putStream!(input)
      if (input.purpose === 'candidate-workspace-manifest')
        await writeFile(join(f.source, 'a'), 'after!')
      return ref
    },
  }
  await expect(
    captureAgentCandidateWorkspaceToArtifacts(f.source, {
      artifactPersistence: { executionId: 'node-1', outputArtifacts: artifacts },
    }),
  ).rejects.toThrow('changed during capture')
})

it('removes temporary data and publishes no artifact when aborted before publication', async () => {
  const f = await fixture()
  const controller = new AbortController()
  await expect(
    f.artifacts.putStream!({
      executionId: 'node-1',
      purpose: 'candidate-workspace-archive',
      signal: controller.signal,
      chunks: (async function* () {
        yield Buffer.alloc(128 * 1024, 42)
        controller.abort(new Error('capture cancelled'))
        yield Buffer.alloc(128 * 1024, 43)
      })(),
    }),
  ).rejects.toThrow('capture cancelled')
  expect(await readdir(join(f.root, 'cas', 'sha256'), { recursive: true })).toEqual([])
})

it('rejects a store that corrupts the archive after publication', async () => {
  const f = await fixture()
  await writeFile(join(f.source, 'a'), 'contents')
  const artifacts = {
    ...f.artifacts,
    putStream: async (input: Parameters<NonNullable<typeof f.artifacts.putStream>>[0]) => {
      const ref = await f.artifacts.putStream!(input)
      if (input.purpose === 'candidate-workspace-archive') {
        const digest = ref.sha256.slice(7)
        await writeFile(join(f.root, 'cas', 'sha256', digest.slice(0, 2), digest), 'lost')
      }
      return ref
    },
  }
  await expect(
    captureAgentCandidateWorkspaceToArtifacts(f.source, {
      artifactPersistence: { executionId: 'node-1', outputArtifacts: artifacts },
    }),
  ).rejects.toThrow('digest or length')
})
