import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as workspaceArtifacts from '../src/candidate-execution/artifacts'
import type { AgentCandidateArtifactPort } from '../src/candidate-execution/types'
import {
  captureAgentWorkspaceSnapshot,
  materializeAgentWorkspaceSnapshot,
} from '../src/candidate-execution/workspace-transfer'
import { createPrivateCasArtifactPort } from '../src/runtime/private-cas'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'portable-workspace-transfer-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  const git = (args: string[]) => execFileSync('git', args, { cwd: source }).toString('utf8')
  git(['init', '--initial-branch=main'])
  writeFileSync(join(source, '.gitignore'), 'ignored-cache\n')
  writeFileSync(join(source, 'tracked.txt'), 'original\n')
  writeFileSync(join(source, 'deleted.txt'), 'original deletion\n')
  writeFileSync(join(source, 'executable'), 'original executable\n')
  chmodSync(join(source, 'executable'), 0o755)
  git(['add', '.'])
  git(['commit', '-m', 'test fixture'])
  writeFileSync(join(source, 'tracked.txt'), 'staged source\n')
  git(['add', 'tracked.txt'])
  writeFileSync(join(source, 'tracked.txt'), 'dirty source\n')
  writeFileSync(join(source, 'index-only.bin'), Buffer.from([255, 128, 0, 10]))
  git(['add', 'index-only.bin'])
  unlinkSync(join(source, 'index-only.bin'))
  git(['rm', 'deleted.txt'])
  writeFileSync(join(source, 'untracked.bin'), Buffer.from([255, 0, 128, 1]))
  writeFileSync(join(source, 'ignored-cache'), 'excluded by source policy\n')
  chmodSync(join(source, 'executable'), 0o711)
  const artifacts = createPrivateCasArtifactPort(join(root, 'artifacts'), 'transfer-owner')
  const snapshot = await captureAgentWorkspaceSnapshot(source, {
    includeRepository: true,
    repositoryContents: 'working-tree',
    artifactPersistence: { executionId: 'source-capture', outputArtifacts: artifacts },
  })
  return { root, source, snapshot, artifacts, git }
}

describe('portable workspace composition', () => {
  it('preserves exact Git and regular-file state through transfer, changed return and restart', async () => {
    const { root, source, snapshot, artifacts, git } = await fixture()
    expect(Object.keys(snapshot).sort()).toEqual(['archive', 'digest', 'kind', 'manifest'])
    expect(JSON.stringify(snapshot)).not.toContain('dirty source')
    const sourceStatus = git(['status', '--porcelain=v1', '--untracked-files=all'])
    const sourceIndex = execFileSync('git', ['show', ':index-only.bin'], { cwd: source })
    const destination = join(root, 'remote')
    await materializeAgentWorkspaceSnapshot({ snapshot, artifacts, destination })
    const remoteGit = (args: string[]) =>
      execFileSync('git', args, { cwd: destination }).toString('utf8')
    expect(remoteGit(['status', '--porcelain=v1', '--untracked-files=all'])).toBe(sourceStatus)
    expect(remoteGit(['show', ':tracked.txt'])).toBe('staged source\n')
    expect(execFileSync('git', ['show', ':index-only.bin'], { cwd: destination })).toEqual(
      sourceIndex,
    )
    expect(readFileSync(join(destination, 'tracked.txt'), 'utf8')).toBe('dirty source\n')
    expect(readFileSync(join(destination, 'untracked.bin'))).toEqual(Buffer.from([255, 0, 128, 1]))
    expect(statSync(join(destination, 'executable')).mode & 0o777).toBe(0o711)
    expect(existsSync(join(destination, 'deleted.txt'))).toBe(false)
    expect(existsSync(join(destination, 'index-only.bin'))).toBe(false)
    expect(existsSync(join(destination, 'ignored-cache'))).toBe(false)

    writeFileSync(join(destination, 'tracked.txt'), 'staged return\n')
    remoteGit(['add', 'tracked.txt'])
    writeFileSync(join(destination, 'tracked.txt'), 'dirty return\n')
    const returned = await captureAgentWorkspaceSnapshot(destination, {
      includeRepository: true,
      repositoryContents: 'working-tree',
      artifactPersistence: { executionId: 'return-capture', outputArtifacts: artifacts },
    })
    expect(returned.archive.sha256).not.toBe(snapshot.archive.sha256)
    const localReturn = join(root, 'local-return')
    const restartedArtifacts = createPrivateCasArtifactPort(
      join(root, 'artifacts'),
      'transfer-owner',
    )
    await materializeAgentWorkspaceSnapshot({
      snapshot: JSON.parse(JSON.stringify(returned)),
      artifacts: restartedArtifacts,
      destination: localReturn,
    })
    expect(readFileSync(join(localReturn, 'tracked.txt'), 'utf8')).toBe('dirty return\n')
    expect(
      execFileSync('git', ['show', ':tracked.txt'], { cwd: localReturn }).toString('utf8'),
    ).toBe('staged return\n')
    expect(
      execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
        cwd: localReturn,
      }).toString('utf8'),
    ).toBe(remoteGit(['status', '--porcelain=v1', '--untracked-files=all']))
    expect(git(['status', '--porcelain=v1', '--untracked-files=all'])).toBe(sourceStatus)
    expect(readFileSync(join(source, 'tracked.txt'), 'utf8')).toBe('dirty source\n')
  })

  it.each([false, true])(
    'refuses a pre-existing destination, populated=%s, before artifact reads',
    async (populated) => {
      const { root, snapshot, artifacts } = await fixture()
      const destination = join(root, 'occupied')
      await mkdir(destination)
      if (populated) writeFileSync(join(destination, 'keep'), 'concurrent owner data')
      const inode = statSync(destination).ino
      const readStream = vi.fn(artifacts.readStream!.bind(artifacts))
      await expect(
        materializeAgentWorkspaceSnapshot({
          snapshot,
          destination,
          artifacts: { read: artifacts.read, readStream },
        }),
      ).rejects.toThrow('already exists')
      expect(readStream).not.toHaveBeenCalled()
      expect(statSync(destination).ino).toBe(inode)
      if (populated)
        expect(readFileSync(join(destination, 'keep'), 'utf8')).toBe('concurrent owner data')
    },
  )

  it.each([false, true])(
    'preserves a destination created during remote artifact reads, populated=%s',
    async (populated) => {
      const { root, snapshot, artifacts } = await fixture()
      const destination = join(root, 'competing')
      let inode: number | undefined
      const competing: AgentCandidateArtifactPort = {
        read: artifacts.read,
        async *readStream(ref, options) {
          if (inode === undefined) {
            await mkdir(destination)
            if (populated) writeFileSync(join(destination, 'keep'), 'competing owner data')
            inode = statSync(destination).ino
          }
          yield* artifacts.readStream!(ref, options)
        },
      }
      await expect(
        materializeAgentWorkspaceSnapshot({ snapshot, destination, artifacts: competing }),
      ).rejects.toThrow('already exists')
      expect(statSync(destination).ino).toBe(inode)
      if (populated)
        expect(readFileSync(join(destination, 'keep'), 'utf8')).toBe('competing owner data')
      expect((await readdir(root)).filter((entry) => entry.includes('.materializing-'))).toEqual([])
    },
  )

  it('refuses another owner namespace and never falls back to a buffered read', async () => {
    const { root, snapshot, artifacts } = await fixture()
    const destination = join(root, 'unauthorized')
    const wrongOwner = createPrivateCasArtifactPort(join(root, 'artifacts'), 'other-owner')
    await expect(
      materializeAgentWorkspaceSnapshot({ snapshot, destination, artifacts: wrongOwner }),
    ).rejects.toThrow('digest and namespace')
    expect(existsSync(destination)).toBe(false)
    const read = vi.fn(artifacts.read)
    await expect(
      materializeAgentWorkspaceSnapshot({ snapshot, destination, artifacts: { read } }),
    ).rejects.toThrow('authorized readStream')
    expect(read).not.toHaveBeenCalled()
  })

  it('bounds declared and streamed artifact bytes before creating a workspace', async () => {
    const { root, snapshot, artifacts } = await fixture()
    const destination = join(root, 'oversized')
    const readStream = vi.fn(artifacts.readStream!.bind(artifacts))
    await expect(
      materializeAgentWorkspaceSnapshot({
        snapshot,
        destination,
        artifacts: { read: artifacts.read, readStream },
        limits: { maxArchiveBytes: snapshot.archive.byteLength - 1 },
      }),
    ).rejects.toThrow('maxArchiveBytes')
    expect(readStream).not.toHaveBeenCalled()
    const oversized: AgentCandidateArtifactPort = {
      read: artifacts.read,
      async *readStream(ref) {
        yield new Uint8Array(ref.byteLength + 1)
      },
    }
    await expect(
      materializeAgentWorkspaceSnapshot({ snapshot, destination, artifacts: oversized }),
    ).rejects.toThrow('exceeds its declared length')
    expect(existsSync(destination)).toBe(false)
  })

  it('refuses noncanonical manifests and corrupt archives before restoration', async () => {
    const { root, snapshot, artifacts } = await fixture()
    const material = JSON.parse(
      Buffer.from(await artifacts.read(snapshot.manifest)).toString('utf8'),
    )
    const noncanonical = await artifacts.put({
      executionId: 'noncanonical-fixture',
      purpose: 'candidate-workspace-manifest',
      bytes: Buffer.from(JSON.stringify(material, null, 2)),
    })
    const destination = join(root, 'corrupt')
    await expect(
      materializeAgentWorkspaceSnapshot({
        snapshot: { ...snapshot, digest: noncanonical.sha256, manifest: noncanonical },
        destination,
        artifacts,
      }),
    ).rejects.toThrow('exact canonical manifest')
    const corrupt: AgentCandidateArtifactPort = {
      read: artifacts.read,
      async *readStream(ref, options) {
        for await (const chunk of artifacts.readStream!(ref, options)) {
          const bytes = Uint8Array.from(chunk)
          if (ref.sha256 === snapshot.archive.sha256 && bytes.length > 0) bytes[0] = bytes[0]! ^ 1
          yield bytes
        }
      },
    }
    await expect(
      materializeAgentWorkspaceSnapshot({ snapshot, destination, artifacts: corrupt }),
    ).rejects.toThrow('digest or length verification')
    expect(existsSync(destination)).toBe(false)
  })

  it('honors cancellation before and during artifact reads without destination writes', async () => {
    const { root, snapshot, artifacts } = await fixture()
    const signal = AbortSignal.abort(new Error('restore cancelled'))
    const destination = join(root, 'cancelled')
    const readStream = vi.fn(artifacts.readStream!.bind(artifacts))
    await expect(
      materializeAgentWorkspaceSnapshot({
        snapshot,
        destination,
        signal,
        artifacts: { read: artifacts.read, readStream },
      }),
    ).rejects.toThrow('restore cancelled')
    expect(readStream).not.toHaveBeenCalled()
    expect(existsSync(destination)).toBe(false)

    const controller = new AbortController()
    const interrupted: AgentCandidateArtifactPort = {
      read: artifacts.read,
      async *readStream(ref, options) {
        for await (const chunk of artifacts.readStream!(ref, options)) {
          controller.abort(new Error('artifact read cancelled'))
          yield chunk
        }
      },
    }
    await expect(
      materializeAgentWorkspaceSnapshot({
        snapshot,
        destination,
        signal: controller.signal,
        artifacts: interrupted,
      }),
    ).rejects.toThrow('artifact read cancelled')
    expect(existsSync(destination)).toBe(false)
  })

  it('refuses publication when cancelled after staged files and Git have been restored', async () => {
    const { root, snapshot, artifacts } = await fixture()
    const destination = join(root, 'cancelled-staging')
    const controller = new AbortController()
    const verify = workspaceArtifacts.verifyMaterializedWorkspace
    const verification = vi
      .spyOn(workspaceArtifacts, 'verifyMaterializedWorkspace')
      .mockImplementation(async (...args) => {
        await verify(...args)
        expect(args[0]).toContain(`${destination}.materializing-`)
        expect(readFileSync(join(args[0], 'tracked.txt'), 'utf8')).toBe('dirty source\n')
        expect(existsSync(join(args[0], '.git'))).toBe(true)
        controller.abort(new Error('staged restore cancelled'))
      })
    try {
      await expect(
        materializeAgentWorkspaceSnapshot({
          snapshot,
          destination,
          artifacts,
          signal: controller.signal,
        }),
      ).rejects.toThrow('staged restore cancelled')
      expect(verification).toHaveBeenCalledOnce()
      expect(existsSync(destination)).toBe(false)
      expect((await readdir(root)).filter((entry) => entry.includes('.materializing-'))).toEqual([])
    } finally {
      verification.mockRestore()
    }
  })
})
