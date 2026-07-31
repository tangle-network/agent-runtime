import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyUntrackedIntoClone,
  withUntrackedArtifacts,
} from '../src/runtime/supervise/untracked-clone'
import { gitWorkspace, runInWorkspace } from '../src/runtime/workspace'

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(dir)
  return dir
}

function git(dir: string, ...args: string[]): string {
  // hooksPath=/dev/null: fixture repos must not run the developer machine's global git hooks —
  // an identity-enforcing pre-commit would otherwise refuse the throwaway test identity.
  const res = spawnSync(
    'git',
    [
      '-C',
      dir,
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      ...args,
    ],
    { encoding: 'utf8' },
  )
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
  return res.stdout
}

/**
 * A source workspace shaped like the production failure: a tracked source file,
 * an UNTRACKED compiled artifact next to it, and a git-IGNORED build output —
 * the two classes `git clone` silently drops.
 */
function makeSourceWorkspace(): string {
  const src = tempDir('untracked-clone-src-')
  git(src, 'init', '-q', '-b', 'main')
  // Mirror ensureWorkspaceGit: accept a delivered worker's push back into this non-bare repo.
  git(src, 'config', 'receive.denyCurrentBranch', 'updateInstead')
  mkdirSync(join(src, 'pkg'), { recursive: true })
  writeFileSync(join(src, 'pkg', 'mod.py'), 'VALUE = 1\n')
  writeFileSync(join(src, '.gitignore'), 'build/\n')
  git(src, 'add', '-A')
  git(src, 'commit', '-qm', 'init')
  // Untracked-but-not-ignored compiled artifact (the astropy `_compiler` shape).
  writeFileSync(join(src, 'pkg', '_compiled.so'), 'ELF-ish bytes')
  // Ignored build output.
  mkdirSync(join(src, 'build'), { recursive: true })
  writeFileSync(join(src, 'build', 'lib.so'), 'built lib')
  return src
}

describe('copyUntrackedIntoClone', () => {
  it('copies untracked and ignored artifacts into a bare git clone', () => {
    const src = makeSourceWorkspace()
    const clone = tempDir('untracked-clone-dst-')
    git(src, 'clone', '-q', '--branch', 'main', src, join(clone, 'c'))
    const cloneDir = join(clone, 'c')
    // The bug: a fresh clone has the tracked file but neither artifact.
    expect(existsSync(join(cloneDir, 'pkg', 'mod.py'))).toBe(true)
    expect(existsSync(join(cloneDir, 'pkg', '_compiled.so'))).toBe(false)
    expect(existsSync(join(cloneDir, 'build', 'lib.so'))).toBe(false)

    const stats = copyUntrackedIntoClone(src, cloneDir)

    expect(stats.copied).toBe(2)
    expect(readFileSync(join(cloneDir, 'pkg', '_compiled.so'), 'utf8')).toBe('ELF-ish bytes')
    expect(readFileSync(join(cloneDir, 'build', 'lib.so'), 'utf8')).toBe('built lib')
  })

  it('preserves the executable bit and rewrites source-absolute symlinks into the clone', () => {
    const src = makeSourceWorkspace()
    chmodSync(join(src, 'pkg', '_compiled.so'), 0o755)
    symlinkSync(join(src, 'build', 'lib.so'), join(src, 'lib-link.so'))
    const cloneDir = join(tempDir('untracked-clone-dst-'), 'c')
    git(src, 'clone', '-q', '--branch', 'main', src, cloneDir)

    copyUntrackedIntoClone(src, cloneDir)

    expect(statSync(join(cloneDir, 'pkg', '_compiled.so')).mode & 0o111).not.toBe(0)
    // The symlink must not point back into the shared source tree.
    expect(readlinkSync(join(cloneDir, 'lib-link.so'))).toBe(join(cloneDir, 'build', 'lib.so'))
  })

  it('skips loop-infra dirs and nested git repos', () => {
    const src = makeSourceWorkspace()
    mkdirSync(join(src, '.loops', 'supervisor'), { recursive: true })
    writeFileSync(join(src, '.loops', 'supervisor', 'state.json'), '{}')
    mkdirSync(join(src, 'nested'), { recursive: true })
    git(join(src, 'nested'), 'init', '-q')
    writeFileSync(join(src, 'nested', 'inner.txt'), 'nested repo file')
    const cloneDir = join(tempDir('untracked-clone-dst-'), 'c')
    git(src, 'clone', '-q', '--branch', 'main', src, cloneDir)

    copyUntrackedIntoClone(src, cloneDir)

    expect(existsSync(join(cloneDir, 'pkg', '_compiled.so'))).toBe(true)
    expect(existsSync(join(cloneDir, '.loops'))).toBe(false)
    expect(existsSync(join(cloneDir, 'nested'))).toBe(false)
  })

  it('warns past the payload bound and copies anyway', () => {
    const src = makeSourceWorkspace()
    const cloneDir = join(tempDir('untracked-clone-dst-'), 'c')
    git(src, 'clone', '-q', '--branch', 'main', src, cloneDir)
    const warnings: string[] = []

    const stats = copyUntrackedIntoClone(src, cloneDir, {
      warnBytes: 1,
      log: (m) => warnings.push(m),
    })

    expect(warnings.some((w) => w.includes('copying anyway'))).toBe(true)
    expect(stats.copied).toBe(2)
    expect(existsSync(join(cloneDir, 'pkg', '_compiled.so'))).toBe(true)
  })
})

describe('withUntrackedArtifacts', () => {
  it('materializes a worker clone containing BOTH the tracked file and the untracked artifact', async () => {
    const src = makeSourceWorkspace()
    const ws = withUntrackedArtifacts(
      gitWorkspace({ ref: src, branch: 'main', noHooks: true }),
      src,
    )

    const seen = { tracked: false, untracked: false, ignored: false }
    await runInWorkspace(
      ws,
      async (cwd) => {
        seen.tracked = existsSync(join(cwd, 'pkg', 'mod.py'))
        seen.untracked = existsSync(join(cwd, 'pkg', '_compiled.so'))
        seen.ignored = existsSync(join(cwd, 'build', 'lib.so'))
        return { valid: false, value: null }
      },
      { tmpPrefix: 'untracked-clone-run-' },
    )

    expect(seen).toEqual({ tracked: true, untracked: true, ignored: true })
  })

  it('never commits the copied artifacts back to the shared ref on a valid delivery', async () => {
    const src = makeSourceWorkspace()
    const ws = withUntrackedArtifacts(
      gitWorkspace({ ref: src, branch: 'main', noHooks: true }),
      src,
    )

    const run = await runInWorkspace(
      ws,
      async (cwd) => {
        writeFileSync(join(cwd, 'pkg', 'mod.py'), 'VALUE = 2\n')
        return { valid: true, value: null, message: 'worker: real edit' }
      },
      { tmpPrefix: 'untracked-clone-run-' },
    )

    expect(run.commit?.ok).toBe(true)
    const tracked = git(src, 'ls-tree', '-r', '--name-only', 'HEAD')
    expect(tracked).toContain('pkg/mod.py')
    expect(tracked).not.toContain('_compiled.so')
    expect(tracked).not.toContain('build/lib.so')
    // The delivery landed in the shared working tree, and the artifact is still there untouched.
    expect(readFileSync(join(src, 'pkg', 'mod.py'), 'utf8')).toBe('VALUE = 2\n')
    expect(readFileSync(join(src, 'pkg', '_compiled.so'), 'utf8')).toBe('ELF-ish bytes')
  })
})
