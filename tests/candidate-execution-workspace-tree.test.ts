import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureAgentCandidateWorkspace,
  describeWorkspaceTree,
  seedWorkspaceTree,
} from '../src/candidate-execution'

/**
 * The tree digest answers "is this workspace the same workspace" over a tree a live run wrote, and
 * the seed fills one entry by entry. Both paths stream: no test here builds an archive, and the
 * archive path is exercised only to show the ceiling it has and this one does not.
 */

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workspace-tree-'))
  roots.push(root)
  return root
}

async function write(root: string, path: string, content: string, mode?: number): Promise<void> {
  const absolute = join(root, path)
  await mkdir(join(absolute, '..'), { recursive: true })
  await writeFile(absolute, content)
  if (mode !== undefined) await chmod(absolute, mode)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('describeWorkspaceTree', () => {
  it('gives one tree one digest, and moves it for any byte, path, or mode change', async () => {
    const first = await makeRoot()
    await write(first, 'src/a.ts', 'export const a = 1\n')
    await write(first, 'src/b.ts', 'export const b = 2\n')
    await write(first, 'run.sh', '#!/bin/sh\necho hi\n', 0o755)

    const second = await makeRoot()
    await write(second, 'src/a.ts', 'export const a = 1\n')
    await write(second, 'src/b.ts', 'export const b = 2\n')
    await write(second, 'run.sh', '#!/bin/sh\necho hi\n', 0o755)

    const a = await describeWorkspaceTree(first)
    const b = await describeWorkspaceTree(second)
    expect(a.digest).toBe(b.digest)
    expect(a).toMatchObject({ algorithm: 'tree-v1', files: 3, directories: 2, symlinks: 0 })
    expect(a.excluded).toEqual([])
    expect(a.bytes).toBe(19 + 19 + 18)

    await write(second, 'src/b.ts', 'export const b = 3\n')
    expect((await describeWorkspaceTree(second)).digest).not.toBe(a.digest)

    const renamed = await makeRoot()
    await write(renamed, 'src/a.ts', 'export const a = 1\n')
    await write(renamed, 'src/c.ts', 'export const b = 2\n')
    await write(renamed, 'run.sh', '#!/bin/sh\necho hi\n', 0o755)
    expect((await describeWorkspaceTree(renamed)).digest).not.toBe(a.digest)

    await chmod(join(first, 'run.sh'), 0o644)
    expect((await describeWorkspaceTree(first)).digest).not.toBe(a.digest)
  })

  it('separates the two algorithms, and normalizes a checkout umask only in the portable one', async () => {
    const root = await makeRoot()
    await write(root, 'a.txt', 'one\n', 0o644)
    await write(root, 'run.sh', 'two\n', 0o755)

    const exact = await describeWorkspaceTree(root)
    const portable = await describeWorkspaceTree(root, { algorithm: 'portable-tree-v1' })
    // The modes already ARE 644/755, so only the stamped algorithm separates these two digests.
    expect(portable.digest).not.toBe(exact.digest)
    expect(portable.algorithm).toBe('portable-tree-v1')

    await chmod(join(root, 'a.txt'), 0o600)
    await chmod(join(root, 'run.sh'), 0o700)
    expect((await describeWorkspaceTree(root)).digest).not.toBe(exact.digest)
    expect((await describeWorkspaceTree(root, { algorithm: 'portable-tree-v1' })).digest).toBe(
      portable.digest,
    )
  })

  it('describes a link that stays inside the tree and refuses one that leaves it', async () => {
    const root = await makeRoot()
    await write(root, 'pkg/index.ts', 'export {}\n')
    await symlink(join('pkg', 'index.ts'), join(root, 'link.ts'))
    const inside = await describeWorkspaceTree(root)
    expect(inside.symlinks).toBe(1)
    expect(inside.excluded).toEqual([])

    // A python venv writes exactly this link, and it is why the close-time policy exists.
    await symlink('/usr/bin/python3', join(root, 'python'))
    await expect(describeWorkspaceTree(root)).rejects.toThrow(/link that is absolute/)

    const excluded = await describeWorkspaceTree(root, { onEscapingLink: 'exclude' })
    expect(excluded.symlinks).toBe(1)
    expect(excluded.excluded).toEqual([
      { path: 'python', reason: 'absolute-symlink', target: '/usr/bin/python3' },
    ])
    // The exclusion is hashed, so a tree WITH the refused link is not the tree without it.
    await unlink(join(root, 'python'))
    expect((await describeWorkspaceTree(root, { onEscapingLink: 'exclude' })).digest).not.toBe(
      excluded.digest,
    )
  })

  it('hashes the reason an entry was excluded, so two refusals are not one digest', async () => {
    const absolute = await makeRoot()
    await symlink('/usr/bin/python3', join(absolute, 'x'))
    const dangling = await makeRoot()
    await symlink('missing-sibling', join(dangling, 'x'))

    const a = await describeWorkspaceTree(absolute, { onEscapingLink: 'exclude' })
    const b = await describeWorkspaceTree(dangling, { onEscapingLink: 'exclude' })
    expect(a.excluded[0]?.reason).toBe('absolute-symlink')
    expect(b.excluded[0]?.reason).toBe('unresolved-symlink')
    expect(a.digest).not.toBe(b.digest)
  })

  it('refuses an entry that vanishes mid-walk by default and records it under the exclude policy', async () => {
    // The window this reproduces is the real one: an entry that the parent directory read NAMED and
    // that is gone by the time the walk reaches it. `big.bin` holds the walk open for the whole
    // window — the root read names both entries after three filesystem calls, then thirty-two
    // sequential one-mebibyte reads run before `zz.txt` is stat-ed — so one unlink issued a few
    // milliseconds in lands inside it every time.
    const bigBytes = 32 * 1024 * 1024
    const vanish = async (options?: Parameters<typeof describeWorkspaceTree>[1]) => {
      const root = await makeRoot()
      await write(root, 'big.bin', 'x'.repeat(bigBytes))
      await write(root, 'zz.txt', 'about to disappear\n')
      const walking = describeWorkspaceTree(root, options ?? {})
      await new Promise((resolve) => setTimeout(resolve, 5))
      await unlink(join(root, 'zz.txt'))
      return walking
    }

    await expect(vanish()).rejects.toThrow(/disappeared during the walk/)

    const described = await vanish({ onMissingEntry: 'exclude' })
    expect(described.excluded).toEqual([{ path: 'zz.txt', reason: 'entry-disappeared' }])
    expect(described.files).toBe(1)
    expect(described.bytes).toBe(bigBytes)
  })

  it('refuses an unknown algorithm or entry policy before it walks anything', async () => {
    const root = await makeRoot()
    await expect(describeWorkspaceTree(root, { algorithm: 'tree-v2' as never })).rejects.toThrow(
      /unsupported workspace tree algorithm/,
    )
    await expect(
      describeWorkspaceTree(root, { onMissingEntry: 'ignore' as never }),
    ).rejects.toThrow(/unsupported workspace tree onMissingEntry policy/)
    await expect(describeWorkspaceTree(join(root, 'missing'))).rejects.toThrow(
      /must be a real directory/,
    )
  })
})

describe('seedWorkspaceTree', () => {
  it('seeds a multi-file workspace the archive path cannot hold, and both trees agree', async () => {
    const source = await makeRoot()
    await write(source, 'README.md', '# seed\n')
    await write(source, 'src/index.ts', 'export const seeded = true\n')
    await write(source, 'bin/run.sh', '#!/bin/sh\necho seeded\n', 0o755)
    // One file larger than the archive path's per-file ceiling. The seed never holds it.
    await write(source, 'data/corpus.bin', 'x'.repeat(4 * 1024 * 1024))

    // The exported archive capture materializes the whole tree in memory and is bounded by a byte
    // ceiling; this tree is over it.
    await expect(
      captureAgentCandidateWorkspace(source, { limits: { maxFileBytes: 1_000_000 } }),
    ).rejects.toThrow(/maxFileBytes/)

    const destination = await makeRoot()
    const seeded = await seedWorkspaceTree({ source, destination })
    expect(seeded.files).toBe(4)
    expect(seeded.bytes).toBe(4 * 1024 * 1024 + 7 + 27 + 22)
    // The seeded workspace IS the seed: the digest is what makes a run branchable from it.
    expect((await describeWorkspaceTree(destination)).digest).toBe(seeded.digest)
    expect((await describeWorkspaceTree(destination)).digest).toBe(
      (await describeWorkspaceTree(source)).digest,
    )
  })

  it('copies a link verbatim rather than the bytes it points at', async () => {
    const source = await makeRoot()
    await write(source, 'pkg/index.ts', 'export {}\n')
    await symlink(join('pkg', 'index.ts'), join(source, 'link.ts'))
    const destination = await makeRoot()
    const seeded = await seedWorkspaceTree({ source, destination, algorithm: 'portable-tree-v1' })
    expect(seeded.symlinks).toBe(1)
    expect(
      (await describeWorkspaceTree(destination, { algorithm: 'portable-tree-v1' })).digest,
    ).toBe(seeded.digest)
  })

  it('refuses to overwrite an entry the workspace already holds', async () => {
    const source = await makeRoot()
    await write(source, 'src/index.ts', 'export const seeded = true\n')
    const destination = await makeRoot()
    await write(destination, 'src/other.ts', 'export const existing = true\n')
    await expect(seedWorkspaceTree({ source, destination })).rejects.toThrow(
      /would overwrite an existing entry: src/,
    )
  })

  it('refuses a destination inside its own seed, and a destination that is not a directory', async () => {
    const source = await makeRoot()
    await write(source, 'a.txt', 'one\n')
    await expect(
      seedWorkspaceTree({ source, destination: join(source, 'nested') }),
    ).rejects.toThrow(/must not contain its destination/)
    await expect(
      seedWorkspaceTree({ source, destination: join(source, '..', 'not-a-directory') }),
    ).rejects.toThrow(/must be an existing directory/)
  })
})
