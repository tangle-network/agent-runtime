/**
 * What a workspace manifest costs to produce, and what it binds.
 *
 * Two properties are pinned here. The digest of a workspace must not depend on the size of its
 * largest file — `FileHandle.readFile` refuses anything above 2 GiB with `ERR_FS_FILE_TOO_LARGE`,
 * so a buffered walk could not describe such a workspace at all. And the digest must not move for
 * a workspace that did not change: the streamed walk reproduces, byte for byte, the manifest the
 * buffered walk produced.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  candidateWorkspaceManifest,
  captureMaterializedWorkspace,
  scanMaterializedWorkspaceManifest,
  verifyMaterializedWorkspace,
} from '../src/candidate-execution/artifacts'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
} from '../src/candidate-execution/digest'
import { readCandidateGitTreeFiles } from '../src/candidate-execution/git-materialize'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** The fixture the pinned digests below were taken from. */
async function pinnedFixture(): Promise<string> {
  const root = await temporaryRoot('candidate-workspace-digest-')
  await mkdir(join(root, 'nested'), { recursive: true })
  await writeFile(join(root, 'nested', 'one.txt'), 'hello world\n')
  await chmod(join(root, 'nested', 'one.txt'), 0o644)
  // 3 MiB crosses the walk's 1 MiB read chunk, so a multi-chunk file is covered by the pin.
  await writeFile(join(root, 'two.bin'), Buffer.alloc(3 * 1024 * 1024, 7))
  await chmod(join(root, 'two.bin'), 0o644)
  await writeFile(join(root, 'empty'), '')
  await chmod(join(root, 'empty'), 0o644)
  await writeFile(join(root, 'run.sh'), '#!/bin/sh\n')
  await chmod(join(root, 'run.sh'), 0o755)
  return root
}

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

describe('workspace manifest — the streamed digest', () => {
  it('reproduces the manifest the buffered walk produced, byte for byte', async () => {
    // Both values below were produced by the buffered `FileHandle.readFile` implementation this
    // change replaces. They are pinned, not recomputed, so any change to the walk order, the mode
    // policy, or the chunking breaks this test instead of silently re-keying every workspace
    // digest already recorded as evidence.
    const root = await pinnedFixture()
    const manifest = await scanMaterializedWorkspaceManifest(root)
    expect(manifest.files).toEqual([
      {
        path: 'empty',
        mode: 0o644,
        sha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        byteLength: 0,
      },
      {
        path: 'nested/one.txt',
        mode: 0o644,
        sha256: 'sha256:a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447',
        byteLength: 12,
      },
      {
        path: 'run.sh',
        mode: 0o755,
        sha256: 'sha256:a8076d3d28d21e02012b20eaf7dbf75409a6277134439025f282e368e3305abf',
        byteLength: 10,
      },
      {
        path: 'two.bin',
        mode: 0o644,
        sha256: 'sha256:fadc8b76fb9e2447c118e8b612cb1280904241214f6b9b5b7010f445bcc3d10b',
        byteLength: 3 * 1024 * 1024,
      },
    ])
    expect(sha256(canonicalCandidateBytes(manifest))).toBe(
      'sha256:de66962c56867a8298029f439535714bff6e73763fe446f570145ad272e82099',
    )
  })

  it('agrees with the byte-capturing walk it shares a fixture with', async () => {
    const root = await pinnedFixture()
    const streamed = await scanMaterializedWorkspaceManifest(root)
    const captured = await captureMaterializedWorkspace(root)
    expect(canonicalCandidateDigest(streamed)).toBe(canonicalCandidateDigest(captured.manifest))
    for (const file of captured.files) {
      const expected = streamed.files.find((entry) => entry.path === file.path)
      expect(expected?.sha256).toBe(sha256(file.bytes))
      expect(expected?.byteLength).toBe(file.bytes.byteLength)
    }
    await expect(verifyMaterializedWorkspace(root, streamed)).resolves.toBeUndefined()
  })

  it('digests a file larger than 2 GiB, which a buffered read refuses outright', {
    timeout: 300_000,
  }, async () => {
    const root = await temporaryRoot('candidate-workspace-huge-')
    const huge = join(root, 'huge.bin')
    // Sparse: 3 GiB of addressable zeros that occupy no blocks, so the test costs time, not
    // disk. `fs.truncate` is the same syscall `truncate -s 3G` makes.
    await writeFile(huge, '')
    await chmod(huge, 0o644)
    await truncate(huge, 3 * 1024 ** 3)

    // The ceiling this defends must still be real, or the test proves nothing.
    await expect(readFile(huge)).rejects.toMatchObject({ code: 'ERR_FS_FILE_TOO_LARGE' })

    const manifest = await scanMaterializedWorkspaceManifest(root)
    expect(manifest.files).toEqual([
      {
        path: 'huge.bin',
        mode: 0o644,
        sha256: 'sha256:305b66a59d15b252092fbda9d09711230c429f351897cbd430e7b55a35fd3b97',
        byteLength: 3 * 1024 ** 3,
      },
    ])
    await expect(verifyMaterializedWorkspace(root, manifest)).resolves.toBeUndefined()
  })
})

describe('workspace manifest — the portable tree', () => {
  it('ignores a checkout umask and binds the executable bit', async () => {
    const root = await temporaryRoot('candidate-workspace-portable-')
    const file = join(root, 'proof.txt')
    await writeFile(file, 'seeded\n')

    await chmod(file, 0o644)
    const portableAt644 = await scanMaterializedWorkspaceManifest(root, { portableTree: true })
    const exactAt644 = await scanMaterializedWorkspaceManifest(root)

    // A group-writable checkout of the same content is the same portable tree...
    await chmod(file, 0o664)
    const portableAt664 = await scanMaterializedWorkspaceManifest(root, { portableTree: true })
    const exactAt664 = await scanMaterializedWorkspaceManifest(root)
    expect(canonicalCandidateDigest(portableAt664)).toBe(canonicalCandidateDigest(portableAt644))
    // ...and a different exact tree, which is why the flag is opt-in.
    expect(canonicalCandidateDigest(exactAt664)).not.toBe(canonicalCandidateDigest(exactAt644))

    // An executable bit is a real change to the tree, and the portable policy still sees it.
    await chmod(file, 0o775)
    const portableExecutable = await scanMaterializedWorkspaceManifest(root, {
      portableTree: true,
    })
    expect(canonicalCandidateDigest(portableExecutable)).not.toBe(
      canonicalCandidateDigest(portableAt644),
    )
    expect(portableAt644.files[0]?.mode).toBe(0o644)
    expect(portableExecutable.files[0]?.mode).toBe(0o755)
  })

  it('names a capture and a verify that disagree about the flag', async () => {
    // The one mismatch the flag can cause on its own. A generic 'files, modes, or bytes do not
    // match' would send a reader looking for a file that never changed.
    const root = await temporaryRoot('candidate-workspace-policy-mismatch-')
    await writeFile(join(root, 'proof.txt'), 'seeded\n')
    await chmod(join(root, 'proof.txt'), 0o664)
    const portable = await scanMaterializedWorkspaceManifest(root, { portableTree: true })
    await expect(verifyMaterializedWorkspace(root, portable)).rejects.toThrow(
      /only the file modes differ, so the capture and this verify disagree about portableTree/,
    )
    await expect(
      verifyMaterializedWorkspace(root, portable, { portableTree: true }),
    ).resolves.toBeUndefined()

    // A changed file is still the general refusal, not the policy one.
    await writeFile(join(root, 'proof.txt'), 'changed\n')
    await chmod(join(root, 'proof.txt'), 0o664)
    await expect(
      verifyMaterializedWorkspace(root, portable, { portableTree: true }),
    ).rejects.toThrow(/files, modes, or bytes do not match/)
  })

  it('normalizes a manifest built from already-read files the same way', async () => {
    const bytes = Uint8Array.from(Buffer.from('x'))
    const exact = candidateWorkspaceManifest([{ path: 'a', mode: 0o664, bytes }])
    const portable = candidateWorkspaceManifest([{ path: 'a', mode: 0o664, bytes }], {
      portableTree: true,
    })
    expect(exact.files[0]?.mode).toBe(0o664)
    expect(portable.files[0]?.mode).toBe(0o644)
    expect(
      candidateWorkspaceManifest([{ path: 'a', mode: 0o775, bytes }], { portableTree: true })
        .files[0]?.mode,
    ).toBe(0o755)
  })

  it('produces the manifest Git produces for the same tree', async () => {
    // Git's tree records exactly two file modes, 100644 and 100755, and
    // `readCandidateGitTreeFiles` already lowers them to 0o644 / 0o755. A portable-tree scan of
    // the working tree must land on the same manifest, or a workspace read from disk and the same
    // workspace read out of Git would disagree about what it is.
    const root = await temporaryRoot('candidate-workspace-git-parity-')
    await mkdir(join(root, 'nested'), { recursive: true })
    await writeFile(join(root, 'nested', 'one.txt'), 'hello world\n')
    await chmod(join(root, 'nested', 'one.txt'), 0o664)
    await writeFile(join(root, 'run.sh'), '#!/bin/sh\n')
    await chmod(join(root, 'run.sh'), 0o775)

    // A temporary index keeps the repository's own index untouched; `add` and `write-tree` need
    // no committer identity, so nothing here configures one.
    const indexFile = join(await temporaryRoot('candidate-workspace-git-index-'), 'index')
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['add', '-A', '--force', '.'], {
      cwd: root,
      env: { ...process.env, GIT_INDEX_FILE: indexFile },
    })
    const tree = execFileSync('git', ['write-tree'], {
      cwd: root,
      env: { ...process.env, GIT_INDEX_FILE: indexFile },
    })
      .toString('utf8')
      .trim()

    const fromGit = candidateWorkspaceManifest(await readCandidateGitTreeFiles(root, tree))
    const fromDisk = await scanMaterializedWorkspaceManifest(root, {
      portableTree: true,
      ignoredProtectedRootEntries: ['.git'],
    })
    expect(canonicalCandidateDigest(fromDisk)).toBe(canonicalCandidateDigest(fromGit))
    expect(fromDisk.files.map((file) => [file.path, file.mode])).toEqual([
      ['nested/one.txt', 0o644],
      ['run.sh', 0o755],
    ])
  })
})

describe('workspace manifest — symbolic links', () => {
  it('names which kind of link it refused', async () => {
    const outer = await temporaryRoot('candidate-workspace-links-')
    const root = join(outer, 'tree')
    await mkdir(root)
    await writeFile(join(root, 'proof.txt'), 'seeded\n')
    await writeFile(join(outer, 'outside.txt'), 'not part of the tree\n')

    await symlink('proof.txt', join(root, 'in-tree.txt'))
    await expect(scanMaterializedWorkspaceManifest(root)).rejects.toThrow(
      /workspace contains a symlink: in-tree\.txt -> proof\.txt/,
    )
    await rm(join(root, 'in-tree.txt'))

    await symlink('../outside.txt', join(root, 'escaping.txt'))
    await expect(scanMaterializedWorkspaceManifest(root)).rejects.toThrow(
      /symlink that escapes its tree: escaping\.txt/,
    )
    await rm(join(root, 'escaping.txt'))

    await symlink(join(outer, 'outside.txt'), join(root, 'absolute.txt'))
    await expect(scanMaterializedWorkspaceManifest(root)).rejects.toThrow(
      /absolute symlink: absolute\.txt/,
    )
    await rm(join(root, 'absolute.txt'))

    await symlink('gone.txt', join(root, 'dangling.txt'))
    await expect(scanMaterializedWorkspaceManifest(root)).rejects.toThrow(
      /unresolved symlink: dangling\.txt/,
    )
  })

  it('refuses a link in the portable tree too, because a manifest cannot describe one', async () => {
    const root = await temporaryRoot('candidate-workspace-links-portable-')
    await writeFile(join(root, 'proof.txt'), 'seeded\n')
    await symlink('proof.txt', join(root, 'link.txt'))
    await expect(scanMaterializedWorkspaceManifest(root, { portableTree: true })).rejects.toThrow(
      /symlink/,
    )
  })
})
