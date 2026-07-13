import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  captureAgentCandidateWorkspace,
  createAgentCandidateWorkspacePort,
} from '../src/candidate-execution'
import {
  canonicalCandidateBytes,
  embeddedCandidateArtifact,
  sha256Bytes,
} from '../src/candidate-execution/digest'
import { runCandidateGit } from '../src/candidate-execution/git-materialize'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function repository(objectFormat: 'sha1' | 'sha256' = 'sha1'): string {
  const root = temporaryRoot('candidate-workspace-source-')
  git(root, [
    'init',
    '-b',
    'main',
    ...(objectFormat === 'sha256' ? ['--object-format=sha256'] : []),
  ])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['config', 'core.hooksPath', '/dev/null'])
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, '.gitignore'), 'ignored-cache\n', { mode: 0o644 })
  writeFileSync(join(root, 'README.md'), 'workspace\n', { mode: 0o644 })
  writeFileSync(join(root, 'bin', 'run'), Buffer.from([0, 1, 2, 255]), { mode: 0o755 })
  chmodSync(join(root, 'bin', 'run'), 0o755)
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'base'])
  writeFileSync(join(root, 'ignored-cache'), 'not part of the task tree', { mode: 0o644 })
  return root
}

describe('candidate workspace archive', () => {
  it.each([
    'sha1',
    'sha256',
  ] as const)('captures and restores exact Git HEAD files for %s repositories', async (objectFormat) => {
    const source = repository(objectFormat)
    writeFileSync(join(source, 'README.md'), 'uncommitted change\n', { mode: 0o644 })
    const expectedHead = git(source, ['rev-parse', 'HEAD'])
    const expectedTree = git(source, ['rev-parse', 'HEAD^{tree}'])
    const captured = await captureAgentCandidateWorkspace(source, {
      includeRepository: true,
    })
    const destination = join(temporaryRoot('candidate-workspace-parent-'), 'restored')

    await createAgentCandidateWorkspacePort().materialize({
      role: 'task',
      snapshot: captured.snapshot,
      archive: captured.archive,
      destination,
    })

    expect(readFileSync(join(destination, 'README.md'), 'utf8')).toBe('workspace\n')
    expect([...readFileSync(join(destination, 'bin', 'run'))]).toEqual([0, 1, 2, 255])
    expect(git(destination, ['rev-parse', 'HEAD'])).toBe(expectedHead)
    expect(git(destination, ['rev-parse', 'HEAD^{tree}'])).toBe(expectedTree)
    expect(git(destination, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe('')
    expect(captured.snapshot.material.files.map((file) => file.path)).toEqual([
      '.gitignore',
      'README.md',
      'bin/run',
    ])
  })

  it('restores a non-repository workspace and rejects archive drift', async () => {
    const source = temporaryRoot('candidate-workspace-files-')
    writeFileSync(join(source, 'input.txt'), 'exact bytes', { mode: 0o644 })
    const captured = await captureAgentCandidateWorkspace(source)
    const port = createAgentCandidateWorkspacePort()
    const destination = join(temporaryRoot('candidate-workspace-parent-'), 'restored')
    await port.materialize({
      role: 'candidate',
      snapshot: captured.snapshot,
      archive: captured.archive,
      destination,
    })
    expect(readFileSync(join(destination, 'input.txt'), 'utf8')).toBe('exact bytes')

    const parsed = JSON.parse(Buffer.from(captured.archive).toString('utf8')) as {
      files: Array<{ content: string; sha256: `sha256:${string}`; byteLength: number }>
    }
    const first = parsed.files[0]
    if (!first) throw new Error('fixture archive has no file')
    const different = Buffer.from('different')
    first.content = different.toString('base64')
    first.sha256 = sha256Bytes(different)
    first.byteLength = different.byteLength
    const tampered = canonicalCandidateBytes(parsed)
    await expect(
      port.materialize({
        role: 'candidate',
        snapshot: {
          ...captured.snapshot,
          archive: embeddedCandidateArtifact(tampered),
        },
        archive: tampered,
        destination: join(temporaryRoot('candidate-workspace-parent-'), 'tampered'),
      }),
    ).rejects.toThrow('manifest')
  })

  it('rejects symbolic and hard links instead of following them', async () => {
    const symlinkRoot = temporaryRoot('candidate-workspace-symlink-')
    writeFileSync(join(symlinkRoot, 'target'), 'secret', { mode: 0o644 })
    symlinkSync('target', join(symlinkRoot, 'link'))
    await expect(captureAgentCandidateWorkspace(symlinkRoot)).rejects.toThrow('symlink')

    const hardlinkRoot = temporaryRoot('candidate-workspace-hardlink-')
    writeFileSync(join(hardlinkRoot, 'target'), 'shared', { mode: 0o644 })
    linkSync(join(hardlinkRoot, 'target'), join(hardlinkRoot, 'link'))
    await expect(captureAgentCandidateWorkspace(hardlinkRoot)).rejects.toThrow('hard-linked')
  })

  it('enforces archive limits before parsing or writing', async () => {
    const source = temporaryRoot('candidate-workspace-limits-')
    writeFileSync(join(source, 'input.txt'), 'bounded', { mode: 0o644 })
    const captured = await captureAgentCandidateWorkspace(source)
    const port = createAgentCandidateWorkspacePort({
      limits: { maxArchiveBytes: captured.archive.byteLength - 1 },
    })
    await expect(
      port.materialize({
        role: 'candidate',
        snapshot: captured.snapshot,
        archive: captured.archive,
        destination: join(temporaryRoot('candidate-workspace-parent-'), 'limited'),
      }),
    ).rejects.toThrow('exceeds maxArchiveBytes')

    const sparse = join(source, 'sparse.bin')
    writeFileSync(sparse, '', { mode: 0o644 })
    chmodSync(sparse, 0o644)
    truncateSync(sparse, 1024 * 1024)
    await expect(
      captureAgentCandidateWorkspace(source, { limits: { maxFileBytes: 1_024 } }),
    ).rejects.toThrow('exceeds maxFileBytes')
  })

  it('does not run ambient Git commands while capturing or restoring a repository', async () => {
    const source = repository()
    writeFileSync(join(source, '.gitattributes'), 'README.md filter=owned\n', { mode: 0o644 })
    git(source, ['add', '.gitattributes'])
    git(source, ['commit', '-m', 'filter fixture'])
    const configRoot = temporaryRoot('candidate-workspace-git-config-')
    const globalConfig = join(configRoot, 'global.gitconfig')
    const marker = join(configRoot, 'filter-ran')
    const fsmonitor = join(configRoot, 'fsmonitor.sh')
    writeFileSync(fsmonitor, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 })
    chmodSync(fsmonitor, 0o755)
    git(source, ['config', 'core.fsmonitor', fsmonitor])
    git(source, ['config', '--file', globalConfig, 'filter.owned.smudge', `touch ${marker}`])
    const previous = process.env.GIT_CONFIG_GLOBAL
    process.env.GIT_CONFIG_GLOBAL = globalConfig
    try {
      await runCandidateGit(source, ['status', '--porcelain=v1', '--untracked-files=all'])
      const protectedCapture = await captureAgentCandidateWorkspace(source, {
        includeRepository: true,
      })
      await createAgentCandidateWorkspacePort().materialize({
        role: 'task',
        snapshot: protectedCapture.snapshot,
        archive: protectedCapture.archive,
        destination: join(temporaryRoot('candidate-workspace-parent-'), 'restored'),
      })
    } finally {
      if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = previous
    }
    expect(existsSync(marker)).toBe(false)
  })
})
