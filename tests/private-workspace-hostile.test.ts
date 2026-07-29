import { execFileSync } from 'node:child_process'
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createLocalPrivateWorkspaceManager,
  createLocalPrivateWorkspaceOwnerToken,
} from '../src/runtime/private-workspace'

const roots: string[] = []
const limits = {
  maxFiles: 10_000,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalFileBytes: 64 * 1024 * 1024,
  maxPathBytes: 8_192,
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function manager() {
  return createLocalPrivateWorkspaceManager({
    root: join(temporaryRoot('hostile-workspace-manager-'), 'manager'),
    now: () => 1_000,
    limits,
  })
}

async function prepare(sourceRoot: string): Promise<unknown> {
  return manager().prepare({
    sourceRoot,
    idempotencyKey: 'hostile',
    ownerId: 'worker',
    ownerToken: createLocalPrivateWorkspaceOwnerToken(),
    expiresAtMs: 2_000,
  })
}

function repository(): string {
  const root = temporaryRoot('hostile-workspace-source-')
  execFileSync('git', ['init', '-b', 'main'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root })
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: root })
  writeFileSync(join(root, 'tracked'), 'tracked\n')
  execFileSync('git', ['add', 'tracked'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'base'], { cwd: root })
  return root
}

describe('local private workspace hostile filesystem refusal', () => {
  it('refuses escaping and dangling symlinks', async () => {
    const outside = temporaryRoot('hostile-workspace-outside-')
    writeFileSync(join(outside, 'secret'), 'outside\n')
    const escaping = temporaryRoot('hostile-workspace-escaping-')
    symlinkSync(join(outside, 'secret'), join(escaping, 'link'))
    await expect(prepare(escaping)).rejects.toThrow('unsafe symlink target')

    const dangling = temporaryRoot('hostile-workspace-dangling-')
    symlinkSync('missing', join(dangling, 'link'))
    await expect(prepare(dangling)).rejects.toThrow('dangling symlink')
  })

  it('refuses special files and portable path collisions', async () => {
    const special = temporaryRoot('hostile-workspace-special-')
    execFileSync('mkfifo', [join(special, 'pipe')])
    await expect(prepare(special)).rejects.toThrow('non-regular entry')

    const collision = temporaryRoot('hostile-workspace-collision-')
    writeFileSync(join(collision, 'Case'), 'one\n')
    writeFileSync(join(collision, 'case'), 'two\n')
    await expect(prepare(collision)).rejects.toThrow('path collision')

    const ambiguousGit = temporaryRoot('hostile-workspace-ambiguous-git-')
    mkdirSync(join(ambiguousGit, '.GIT'))
    await expect(prepare(ambiguousGit)).rejects.toThrow('ambiguous Git metadata: .GIT')

    const ambiguousEnvironment = temporaryRoot('hostile-workspace-ambiguous-env-')
    writeFileSync(join(ambiguousEnvironment, '.ENV'), 'SECRET=not-implicit\n')
    await expect(prepare(ambiguousEnvironment)).rejects.toThrow(
      'explicitly include or exclude sensitive root entry: .ENV',
    )
  })

  it('bounds empty directories and symlinks as filesystem entries', async () => {
    const source = temporaryRoot('hostile-workspace-entry-storm-')
    for (const name of ['one', 'two', 'three']) mkdirSync(join(source, name))
    const workspaceManager = createLocalPrivateWorkspaceManager({
      root: join(temporaryRoot('hostile-workspace-entry-manager-'), 'manager'),
      now: () => 1_000,
      limits: { ...limits, maxFiles: 2 },
    })
    await expect(
      workspaceManager.prepare({
        sourceRoot: source,
        idempotencyKey: 'entry-storm',
        ownerId: 'worker',
        ownerToken: createLocalPrivateWorkspaceOwnerToken(),
        expiresAtMs: 2_000,
      }),
    ).rejects.toThrow('exceeds maxFiles')
  })

  it('dealiases hardlinks into private regular files', async () => {
    const source = temporaryRoot('hostile-workspace-hardlink-')
    writeFileSync(join(source, 'one'), 'same bytes\n')
    linkSync(join(source, 'one'), join(source, 'two'))
    const workspaceManager = manager()
    const ownerToken = createLocalPrivateWorkspaceOwnerToken()
    const prepared = await workspaceManager.prepare({
      sourceRoot: source,
      idempotencyKey: 'hardlinks',
      ownerId: 'worker',
      ownerToken,
      expiresAtMs: 2_000,
    })
    expect(
      (
        await workspaceManager.getLocalSourceSnapshotPolicy({
          leaseId: prepared.leaseId,
          ownerToken,
        })
      )?.worktreeHardlinks,
    ).toBe('dealias')
  })

  it('refuses linked worktrees, nested submodule metadata, and Git indirection', async () => {
    const source = repository()
    const linked = temporaryRoot('hostile-workspace-linked-')
    rmSync(linked, { recursive: true, force: true })
    execFileSync('git', ['worktree', 'add', '--detach', linked], { cwd: source })
    roots.push(linked)
    await expect(prepare(linked)).rejects.toThrow('refuses Git indirection')

    const nested = temporaryRoot('hostile-workspace-submodule-')
    mkdirSync(join(nested, 'submodule'))
    writeFileSync(join(nested, 'submodule', '.git'), 'gitdir: elsewhere\n')
    await expect(prepare(nested)).rejects.toThrow('nested Git metadata')

    const alternates = repository()
    mkdirSync(join(alternates, '.git', 'objects', 'info'), { recursive: true })
    writeFileSync(join(alternates, '.git', 'objects', 'info', 'alternates'), '/tmp/objects\n')
    await expect(prepare(alternates)).rejects.toThrow('unsupported Git state')
  })

  it('refuses in-progress Git state and active lock files', async () => {
    const merge = repository()
    writeFileSync(join(merge, '.git', 'MERGE_HEAD'), `${'a'.repeat(40)}\n`)
    await expect(prepare(merge)).rejects.toThrow('unsupported Git state')

    const locked = repository()
    writeFileSync(join(locked, '.git', 'index.lock'), 'locked\n')
    await expect(prepare(locked)).rejects.toThrow('unsupported Git state')
  })

  it('does not traverse omitted Git object stores, hooks, logs, or linked-worktree records', async () => {
    const source = repository()
    mkdirSync(join(source, '.git', 'lfs', 'objects'), { recursive: true })
    mkdirSync(join(source, '.git', 'logs', 'private'), { recursive: true })
    mkdirSync(join(source, '.git', 'hooks', 'private'), { recursive: true })
    mkdirSync(join(source, '.git', 'worktrees', 'private'), { recursive: true })
    for (const path of [
      join(source, '.git', 'lfs', 'objects', 'oversized'),
      join(source, '.git', 'logs', 'private', 'oversized'),
      join(source, '.git', 'hooks', 'private', 'oversized'),
      join(source, '.git', 'worktrees', 'private', 'oversized'),
    ]) {
      writeFileSync(path, '')
      truncateSync(path, limits.maxFileBytes + 1)
    }
    await expect(prepare(source)).resolves.toBeDefined()
  })

  it('refuses unknown Git metadata before publishing a workspace', async () => {
    const source = repository()
    writeFileSync(join(source, '.git', 'unknown-private-state'), 'unknown\n')
    await expect(prepare(source)).rejects.toThrow('unsupported Git state')
  })

  it('refuses unmodeled Git config that could change visible workspace state', async () => {
    const source = repository()
    execFileSync('git', ['config', 'core.excludesFile', '/tmp/private-global-ignore'], {
      cwd: source,
    })
    await expect(prepare(source)).rejects.toThrow('unsupported Git config key: core.excludesfile')
  })

  it('ignores ambient Git repository and index redirection', async () => {
    const source = repository()
    mkdirSync(join(source, '.runs'))
    writeFileSync(join(source, '.runs', 'tracked'), 'tracked only in the source index\n')
    execFileSync('git', ['add', '.runs/tracked'], { cwd: source })

    const alternateIndex = join(temporaryRoot('hostile-workspace-alternate-index-'), 'index')
    execFileSync('git', ['read-tree', '--empty'], {
      cwd: source,
      env: { ...process.env, GIT_INDEX_FILE: alternateIndex },
    })
    const previousIndex = process.env.GIT_INDEX_FILE
    process.env.GIT_INDEX_FILE = alternateIndex
    try {
      const workspaceManager = manager()
      await expect(
        workspaceManager.prepare({
          sourceRoot: source,
          idempotencyKey: 'ambient-git-index',
          ownerId: 'worker',
          ownerToken: createLocalPrivateWorkspaceOwnerToken(),
          expiresAtMs: 2_000,
          sourcePolicy: { rootEntries: { '.runs': 'exclude' } },
        }),
      ).rejects.toThrow('cannot exclude Git-tracked path: .runs/tracked')
    } finally {
      if (previousIndex === undefined) delete process.env.GIT_INDEX_FILE
      else process.env.GIT_INDEX_FILE = previousIndex
    }
  })
})
