import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  agentWorkspaceLeaseRecordSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'

import { scanFilesystemTree } from '../src/filesystem-snapshot'
import {
  createLocalPrivateWorkspaceManager,
  createLocalPrivateWorkspaceOwnerToken,
  LocalPrivateWorkspaceCleanupError,
  LocalPrivateWorkspaceIdempotencyConflictError,
  LocalPrivateWorkspaceSourceChangedError,
} from '../src/runtime/private-workspace'

const roots: string[] = []
const limits = {
  maxFiles: 20_000,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalFileBytes: 128 * 1024 * 1024,
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

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }).trim()
}

function gitWrite(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function status(root: string): string {
  return execFileSync(
    'git',
    ['status', '--porcelain=v2', '--ignored=matching', '--untracked-files=all'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    },
  )
}

function repository(): string {
  const root = temporaryRoot('local-private-workspace-source-')
  gitWrite(root, ['init', '-b', 'main'])
  gitWrite(root, ['config', 'user.email', 'test@example.com'])
  gitWrite(root, ['config', 'user.name', 'Test'])
  gitWrite(root, ['config', 'core.hooksPath', '/dev/null'])
  gitWrite(root, ['config', 'remote.origin.url', 'https://example.invalid/repository.git'])
  gitWrite(root, ['config', 'credential.helper', 'cache'])
  writeFileSync(join(root, '.gitignore'), 'ignored-cache\n')
  writeFileSync(join(root, 'tracked.txt'), 'base\n')
  writeFileSync(join(root, 'other.txt'), 'other\n')
  writeFileSync(join(root, 'script.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  chmodSync(join(root, 'script.sh'), 0o755)
  gitWrite(root, ['add', '.'])
  gitWrite(root, ['commit', '-m', 'base'])
  gitWrite(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  gitWrite(root, ['config', 'branch.main.remote', 'origin'])
  gitWrite(root, ['config', 'branch.main.merge', 'refs/heads/main'])

  writeFileSync(join(root, 'tracked.txt'), 'staged\n')
  gitWrite(root, ['add', 'tracked.txt'])
  writeFileSync(join(root, 'tracked.txt'), 'unstaged\n')
  writeFileSync(join(root, 'untracked.txt'), 'untracked\n')
  writeFileSync(join(root, 'ignored-cache'), 'ignored\n')
  symlinkSync('tracked.txt', join(root, 'tracked-link'))
  writeFileSync(join(root, 'hardlink-source'), 'hardlinked bytes\n')
  linkSync(join(root, 'hardlink-source'), join(root, 'hardlink-alias'))
  return root
}

function managerRoot(): string {
  return join(temporaryRoot('local-private-workspace-manager-parent-'), 'manager')
}

function digest(label: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(label).digest('hex')}`
}

const tokens = new Map<string, string>()

function ownerToken(label: string): string {
  const existing = tokens.get(label)
  if (existing) return existing
  const token = createLocalPrivateWorkspaceOwnerToken()
  tokens.set(label, token)
  return token
}

async function fullFilesystemDigest(root: string): Promise<string> {
  const observed = await scanFilesystemTree(root, {
    label: 'test source fingerprint',
    includeDirectories: true,
    symlinks: 'internal',
    hardlinks: 'copy',
    limits,
  })
  return canonicalCandidateDigest(observed.manifest)
}

describe('local private workspace manager', () => {
  it('copies the full live Git-visible state twice without changing the source', async () => {
    const source = repository()
    const beforeStatus = status(source)
    const beforeFilesystem = await fullFilesystemDigest(source)
    const beforeHead = git(source, ['rev-parse', 'HEAD'])
    const beforeIndex = readFileSync(join(source, '.git', 'index'))
    let now = 1_000
    const manager = createLocalPrivateWorkspaceManager({
      root: managerRoot(),
      now: () => now,
      limits,
    })

    const [first, second] = await Promise.all([
      manager.prepare({
        sourceRoot: source,
        idempotencyKey: 'profile-a',
        ownerId: 'worker-a',
        ownerToken: ownerToken('owner-token-a'),
        expiresAtMs: 2_000,
      }),
      manager.prepare({
        sourceRoot: source,
        idempotencyKey: 'profile-b',
        ownerId: 'worker-b',
        ownerToken: ownerToken('owner-token-b'),
        expiresAtMs: 2_000,
      }),
    ])

    expect(first.leaseId).not.toBe(second.leaseId)
    expect(agentWorkspaceLeaseRecordSchema.parse(first)).toEqual(first)
    expect(first).toMatchObject({ kind: 'agent-workspace-lease', schemaVersion: 1 })
    expect(first).not.toHaveProperty('localSourceSnapshotPolicy')
    expect(first.workspace.root).not.toBe(second.workspace.root)
    expect(first.workspace.identityDigest).not.toBe(second.workspace.identityDigest)
    expect(first.sourceSnapshotDigest).toBe(second.sourceSnapshotDigest)
    expect(readFileSync(join(first.workspace.root, 'tracked.txt'), 'utf8')).toBe('unstaged\n')
    expect(readFileSync(join(first.workspace.root, 'ignored-cache'), 'utf8')).toBe('ignored\n')
    expect(readlinkSync(join(first.workspace.root, 'tracked-link'))).toBe('tracked.txt')
    expect(lstatSync(join(first.workspace.root, '.git')).isDirectory()).toBe(true)
    expect(lstatSync(join(first.workspace.root, 'script.sh')).mode & 0o777).toBe(0o755)
    expect(status(first.workspace.root)).toBe(beforeStatus)
    expect(git(first.workspace.root, ['rev-parse', 'HEAD'])).toBe(beforeHead)
    expect(git(first.workspace.root, ['config', '--get', 'core.hooksPath'])).toBe('/dev/null')
    expect(() => git(first.workspace.root, ['config', '--get', 'remote.origin.url'])).toThrow()
    expect(() => git(first.workspace.root, ['config', '--get', 'credential.helper'])).toThrow()
    expect(lstatSync(join(first.workspace.root, 'hardlink-source')).ino).not.toBe(
      lstatSync(join(first.workspace.root, 'hardlink-alias')).ino,
    )
    const localSourcePolicy = await manager.getLocalSourceSnapshotPolicy({
      leaseId: first.leaseId,
      ownerToken: ownerToken('owner-token-a'),
    })
    expect(localSourcePolicy?.worktreeHardlinks).toBe('dealias')
    expect(canonicalCandidateDigest(localSourcePolicy)).toBe(first.sourceSnapshotPolicy.digest)

    expect(status(source)).toBe(beforeStatus)
    expect(await fullFilesystemDigest(source)).toBe(beforeFilesystem)
    expect(readFileSync(join(source, '.git', 'index'))).toEqual(beforeIndex)
    expect(git(source, ['rev-parse', 'HEAD'])).toBe(beforeHead)

    const replay = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'profile-a',
      ownerId: 'worker-a',
      ownerToken: ownerToken('owner-token-a'),
      expiresAtMs: 2_000,
    })
    expect(replay).toEqual(first)

    writeFileSync(join(source, 'untracked.txt'), 'changed request\n')
    await expect(
      manager.prepare({
        sourceRoot: source,
        idempotencyKey: 'profile-a',
        ownerId: 'worker-a',
        ownerToken: ownerToken('owner-token-a'),
        expiresAtMs: 2_000,
      }),
    ).rejects.toBeInstanceOf(LocalPrivateWorkspaceIdempotencyConflictError)

    now = 1_100
    const renewed = await manager.renew({
      leaseId: second.leaseId,
      ownerToken: ownerToken('owner-token-b'),
      expiresAtMs: 3_000,
    })
    expect(renewed.expiresAtMs).toBe(3_000)
    await expect(
      manager.renew({
        leaseId: second.leaseId,
        ownerToken: ownerToken('owner-token-b'),
        expiresAtMs: 3_000,
      }),
    ).resolves.toEqual(renewed)
  })

  it('keeps allocation, source, prepared, and execution identities separate', async () => {
    const source = repository()
    const manager = createLocalPrivateWorkspaceManager({
      root: managerRoot(),
      now: () => 1_000,
      limits,
    })
    const first = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'first',
      ownerId: 'worker',
      ownerToken: ownerToken('token-first'),
      expiresAtMs: 2_000,
    })
    const second = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'second',
      ownerId: 'worker',
      ownerToken: ownerToken('token-second'),
      expiresAtMs: 2_000,
    })
    expect(first.sourceSnapshotDigest).toBe(second.sourceSnapshotDigest)
    expect(first.leaseId).not.toBe(second.leaseId)
    expect(first.workspace.identityDigest).not.toBe(second.workspace.identityDigest)

    for (const workspace of [first, second]) {
      mkdirSync(join(workspace.workspace.root, '.codex'))
      writeFileSync(join(workspace.workspace.root, '.codex', 'config.toml'), 'profile = "a"\n')
    }
    const profileActivationDigest = digest('profile-activation-a')
    const sealedFirst = await manager.sealWorkspace({
      leaseId: first.leaseId,
      ownerToken: ownerToken('token-first'),
      profileActivationDigest,
    })
    const sealedSecond = await manager.sealWorkspace({
      leaseId: second.leaseId,
      ownerToken: ownerToken('token-second'),
      profileActivationDigest,
    })
    expect(sealedFirst.phase).toBe('workspace-sealed')
    expect(sealedFirst.preparedWorkspaceDigest).not.toBe(first.sourceSnapshotDigest)
    expect(sealedFirst.preparedWorkspaceDigest).toBe(sealedSecond.preparedWorkspaceDigest)

    const exactSealReplay = await manager.sealWorkspace({
      leaseId: first.leaseId,
      ownerToken: ownerToken('token-first'),
      profileActivationDigest,
    })
    expect(exactSealReplay).toEqual(sealedFirst)

    const executionPreparationDigest = digest('interface-preparation-receipt')
    const bound = await manager.bindExecutionReceipt({
      leaseId: first.leaseId,
      ownerToken: ownerToken('token-first'),
      executionPreparationDigest,
    })
    expect(bound).toMatchObject({ phase: 'execution-bound', executionPreparationDigest })
    await expect(
      manager.requireExecutionBound({
        leaseId: first.leaseId,
        ownerToken: ownerToken('token-first'),
      }),
    ).resolves.toEqual(bound)

    writeFileSync(join(first.workspace.root, 'post-bind-change'), 'not sealed\n')
    await expect(
      manager.requireExecutionBound({
        leaseId: first.leaseId,
        ownerToken: ownerToken('token-first'),
      }),
    ).rejects.toThrow('changed after execution binding')
  })

  it('refuses Git credentials, hooks, and other omitted metadata added after copy', async () => {
    const source = repository()
    const manager = createLocalPrivateWorkspaceManager({
      root: managerRoot(),
      now: () => 1_000,
      limits,
    })
    const credentialMutation = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'credential-mutation',
      ownerId: 'worker',
      ownerToken: ownerToken('credential-mutation'),
      expiresAtMs: 2_000,
    })
    writeFileSync(
      join(credentialMutation.workspace.root, '.git', 'config'),
      `${readFileSync(join(credentialMutation.workspace.root, '.git', 'config'), 'utf8')}\n[credential]\n\thelper = store\n`,
    )
    await expect(
      manager.sealWorkspace({
        leaseId: credentialMutation.leaseId,
        ownerToken: ownerToken('credential-mutation'),
        profileActivationDigest: digest('credential-mutation'),
      }),
    ).rejects.toThrow('Git config is not the canonical sanitized config')

    const hookMutation = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'hook-mutation',
      ownerId: 'worker',
      ownerToken: ownerToken('hook-mutation'),
      expiresAtMs: 2_000,
    })
    mkdirSync(join(hookMutation.workspace.root, '.git', 'hooks'))
    writeFileSync(join(hookMutation.workspace.root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n')
    await expect(
      manager.sealWorkspace({
        leaseId: hookMutation.leaseId,
        ownerToken: ownerToken('hook-mutation'),
        profileActivationDigest: digest('hook-mutation'),
      }),
    ).rejects.toThrow('contains omitted Git metadata: hooks')
  })

  it('changes source identity for bytes, mode, symlink target, index-only state, and untracked state', async () => {
    const source = repository()
    const manager = createLocalPrivateWorkspaceManager({
      root: managerRoot(),
      now: () => 1_000,
      limits,
    })
    let sequence = 0
    const capture = async (): Promise<string> => {
      sequence++
      return (
        await manager.prepare({
          sourceRoot: source,
          idempotencyKey: `identity-${sequence}`,
          ownerId: 'identity-worker',
          ownerToken: ownerToken(`identity-token-${sequence}`),
          expiresAtMs: 2_000,
        })
      ).sourceSnapshotDigest
    }

    const observed = [await capture()]
    writeFileSync(join(source, 'untracked.txt'), 'different bytes\n')
    observed.push(await capture())
    chmodSync(join(source, 'script.sh'), 0o644)
    observed.push(await capture())
    rmSync(join(source, 'tracked-link'))
    symlinkSync('other.txt', join(source, 'tracked-link'))
    observed.push(await capture())
    writeFileSync(join(source, 'index-only.txt'), 'same worktree bytes\n')
    observed.push(await capture())
    gitWrite(source, ['add', 'index-only.txt'])
    observed.push(await capture())

    expect(new Set(observed).size).toBe(observed.length)
  })

  it('linearizes 50 different allocations and same-key contention', async () => {
    const source = repository()
    const root = managerRoot()
    const manager = createLocalPrivateWorkspaceManager({
      root,
      now: () => 1_000,
      limits,
    })
    const records = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        manager.prepare({
          sourceRoot: source,
          idempotencyKey: `parallel-${index}`,
          ownerId: `worker-${index}`,
          ownerToken: ownerToken(`token-${index}`),
          expiresAtMs: 2_000,
        }),
      ),
    )
    expect(new Set(records.map((record) => record.leaseId)).size).toBe(50)
    expect(new Set(records.map((record) => record.workspace.root)).size).toBe(50)
    expect(new Set(records.map((record) => record.sourceSnapshotDigest)).size).toBe(1)
    expect((await manager.list()).length).toBe(50)

    await Promise.all(
      records.map((record, index) =>
        manager.destroy({ leaseId: record.leaseId, ownerToken: ownerToken(`token-${index}`) }),
      ),
    )
    expect(readdirSync(join(root, 'workspaces'))).toEqual([])

    const contenders = await Promise.all(
      Array.from({ length: 20 }, () =>
        manager.prepare({
          sourceRoot: source,
          idempotencyKey: 'one-contended-key',
          ownerId: 'one-owner',
          ownerToken: ownerToken('one-token'),
          expiresAtMs: 2_000,
        }),
      ),
    )
    expect(new Set(contenders.map((record) => record.leaseId)).size).toBe(1)
    expect(new Set(contenders.map((record) => record.workspace.root)).size).toBe(1)
    expect(readdirSync(join(root, 'workspaces')).length).toBe(1)
  })

  it('rejects a source mutation between real capture passes without publishing a lease', async () => {
    const source = repository()
    const root = managerRoot()
    const manager = createLocalPrivateWorkspaceManager({
      root,
      now: () => 1_000,
      limits,
      afterSourceCapturePass: (pass) => {
        if (pass === 1) writeFileSync(join(source, 'untracked.txt'), 'mutated between passes\n')
      },
    })
    await expect(
      manager.prepare({
        sourceRoot: source,
        idempotencyKey: 'torn',
        ownerId: 'worker',
        ownerToken: ownerToken('token'),
        expiresAtMs: 2_000,
      }),
    ).rejects.toBeInstanceOf(LocalPrivateWorkspaceSourceChangedError)
    expect(await manager.list()).toEqual([])
    expect(readdirSync(join(root, 'workspaces'))).toEqual([])
  })

  it('recovers a key whose process died before publishing initial state', async () => {
    const source = repository()
    const root = managerRoot()
    const manager = createLocalPrivateWorkspaceManager({ root, now: () => 1_000, limits })
    await expect(manager.list()).resolves.toEqual([])

    const idempotencyKey = 'crashed-before-initial-state'
    const leaseDirectory = join(
      root,
      'leases',
      createHash('sha256').update(idempotencyKey).digest('hex'),
    )
    mkdirSync(leaseDirectory)
    writeFileSync(
      join(leaseDirectory, '.local-workspace-state-123-deadbeef-dead-4eef-8bad-deadbeefdead.tmp'),
      'incomplete\n',
    )
    await expect(manager.list()).resolves.toEqual([])

    const recovered = await manager.prepare({
      sourceRoot: source,
      idempotencyKey,
      ownerId: 'worker',
      ownerToken: ownerToken('crash-recovery'),
      expiresAtMs: 2_000,
    })
    expect(recovered.phase).toBe('copy-ready')
    await expect(manager.list()).resolves.toEqual([recovered])
  })

  it('does not publish or seal a lease that expires during filesystem work', async () => {
    const source = repository()
    const root = managerRoot()
    let clockReadings = [1_000, 2_000]
    const manager = createLocalPrivateWorkspaceManager({
      root,
      now: () => clockReadings.shift() ?? 2_000,
      limits,
    })
    await expect(
      manager.prepare({
        sourceRoot: source,
        idempotencyKey: 'expires-during-copy',
        ownerId: 'worker',
        ownerToken: ownerToken('expires-during-copy'),
        expiresAtMs: 1_500,
      }),
    ).rejects.toThrow('lease expired during preparation')
    expect(await manager.list()).toEqual([])
    expect(readdirSync(join(root, 'workspaces'))).toEqual([])

    clockReadings = [3_000, 3_000]
    const prepared = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'expires-during-seal',
      ownerId: 'worker',
      ownerToken: ownerToken('expires-during-seal'),
      expiresAtMs: 4_000,
    })
    clockReadings = [3_500, 4_000]
    await expect(
      manager.sealWorkspace({
        leaseId: prepared.leaseId,
        ownerToken: ownerToken('expires-during-seal'),
        profileActivationDigest: digest('expires-during-seal'),
      }),
    ).rejects.toThrow('lease has expired')
    await expect(manager.get(prepared.leaseId)).resolves.toMatchObject({ phase: 'copy-ready' })
  })

  it('recovers sealed work after restart and reaps expired unsealed work', async () => {
    const source = repository()
    const root = managerRoot()
    let now = 1_000
    const firstManager = createLocalPrivateWorkspaceManager({
      root,
      now: () => now,
      limits,
      cleanupClaimDurationMs: 10,
    })
    const unsealed = await firstManager.prepare({
      sourceRoot: source,
      idempotencyKey: 'unsealed-crash',
      ownerId: 'worker',
      ownerToken: ownerToken('unsealed-token'),
      expiresAtMs: 1_100,
    })
    const sealed = await firstManager.prepare({
      sourceRoot: source,
      idempotencyKey: 'sealed-crash',
      ownerId: 'worker',
      ownerToken: ownerToken('sealed-token'),
      expiresAtMs: 2_000,
    })
    writeFileSync(join(sealed.workspace.root, 'profile.json'), '{}\n')
    await firstManager.sealWorkspace({
      leaseId: sealed.leaseId,
      ownerToken: ownerToken('sealed-token'),
      profileActivationDigest: digest('sealed-profile'),
    })

    const restarted = createLocalPrivateWorkspaceManager({
      root,
      now: () => now,
      limits,
      cleanupClaimDurationMs: 10,
    })
    await expect(
      restarted.bindExecutionReceipt({
        leaseId: sealed.leaseId,
        ownerToken: ownerToken('sealed-token'),
        executionPreparationDigest: digest('resumed-receipt'),
      }),
    ).resolves.toMatchObject({ phase: 'execution-bound' })

    now = 1_100
    const reaped = await restarted.reapExpired()
    expect(reaped.destroyed.map((record) => record.leaseId)).toContain(unsealed.leaseId)
    expect(existsSync(unsealed.workspace.root)).toBe(false)
    expect(await restarted.get(unsealed.leaseId)).toMatchObject({ phase: 'destroyed' })
    expect(await restarted.get(sealed.leaseId)).toMatchObject({ phase: 'execution-bound' })
  })

  it('records cleanup failure, leaves the workspace recoverable, and retries truthfully', async () => {
    const source = repository()
    const root = managerRoot()
    let attempts = 0
    const manager = createLocalPrivateWorkspaceManager({
      root,
      now: () => 1_000,
      limits,
      removeWorkspace: async (workspaceRoot) => {
        attempts++
        if (attempts === 1) throw new Error('injected busy workspace')
        rmSync(workspaceRoot, { recursive: true, force: true })
      },
    })
    const prepared = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'cleanup-failure',
      ownerId: 'worker',
      ownerToken: ownerToken('cleanup-token'),
      expiresAtMs: 2_000,
    })

    await expect(
      manager.destroy({ leaseId: prepared.leaseId, ownerToken: ownerToken('cleanup-token') }),
    ).rejects.toBeInstanceOf(LocalPrivateWorkspaceCleanupError)
    expect(existsSync(prepared.workspace.root)).toBe(true)
    expect(await manager.get(prepared.leaseId)).toMatchObject({
      phase: 'cleanup-failed',
      cleanupAttempts: 1,
      cleanupError: 'workspace cleanup failed; inspect provider-private diagnostics',
    })
    const privateState = readFileSync(
      join(
        root,
        'leases',
        prepared.leaseId.slice('local-workspace.'.length),
        'state-00000002.json',
      ),
      'utf8',
    )
    expect(privateState).toContain('injected busy workspace')

    const retried = await manager.reapExpired()
    expect(retried.failed).toEqual([])
    expect(retried.destroyed.map((record) => record.leaseId)).toEqual([prepared.leaseId])
    expect(existsSync(prepared.workspace.root)).toBe(false)
    expect(attempts).toBe(2)
  })

  it('requires explicit policy for sensitive roots and refuses excluded tracked files', async () => {
    const source = repository()
    writeFileSync(join(source, '.env'), 'SECRET=source-only\n')
    const manager = createLocalPrivateWorkspaceManager({
      root: managerRoot(),
      now: () => 1_000,
      limits,
    })

    await expect(
      manager.prepare({
        sourceRoot: source,
        idempotencyKey: 'implicit-sensitive',
        ownerId: 'worker',
        ownerToken: ownerToken('implicit-sensitive'),
        expiresAtMs: 2_000,
      }),
    ).rejects.toThrow('explicitly include or exclude sensitive root entry: .env')

    const included = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'include-sensitive',
      ownerId: 'worker',
      ownerToken: ownerToken('include-sensitive'),
      expiresAtMs: 2_000,
      sourcePolicy: { rootEntries: { '.env': 'include' } },
    })
    expect(readFileSync(join(included.workspace.root, '.env'), 'utf8')).toBe('SECRET=source-only\n')
    expect(
      (
        await manager.getLocalSourceSnapshotPolicy({
          leaseId: included.leaseId,
          ownerToken: ownerToken('include-sensitive'),
        })
      )?.rootEntryDecisions,
    ).toEqual([{ name: '.env', disposition: 'include' }])

    const excluded = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'exclude-sensitive',
      ownerId: 'worker',
      ownerToken: ownerToken('exclude-sensitive'),
      expiresAtMs: 2_000,
      sourcePolicy: { rootEntries: { '.env': 'exclude' } },
    })
    expect(existsSync(join(excluded.workspace.root, '.env'))).toBe(false)
    expect(excluded.sourceSnapshotDigest).not.toBe(included.sourceSnapshotDigest)

    mkdirSync(join(source, '.runs'))
    writeFileSync(join(source, '.runs', 'trace.json'), '{}\n')
    gitWrite(source, ['add', '.runs/trace.json'])
    await expect(
      manager.prepare({
        sourceRoot: source,
        idempotencyKey: 'exclude-tracked',
        ownerId: 'worker',
        ownerToken: ownerToken('exclude-tracked'),
        expiresAtMs: 2_000,
        sourcePolicy: {
          rootEntries: { '.env': 'exclude', '.runs': 'exclude' },
        },
      }),
    ).rejects.toThrow('cannot exclude Git-tracked path: .runs/trace.json')
  })

  it('rejects weak owner tokens and never persists the capability plaintext', async () => {
    const source = repository()
    const root = managerRoot()
    const manager = createLocalPrivateWorkspaceManager({ root, now: () => 1_000, limits })
    await expect(
      manager.prepare({
        sourceRoot: source,
        idempotencyKey: 'weak-token',
        ownerId: 'worker',
        ownerToken: 'guessable',
        expiresAtMs: 2_000,
      }),
    ).rejects.toThrow('minted 256-bit capability')

    const token = ownerToken('not-persisted')
    await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'not-persisted',
      ownerId: 'worker',
      ownerToken: token,
      expiresAtMs: 2_000,
    })
    const durableBytes = readdirSync(join(root, 'leases'))
      .flatMap((lease) =>
        readdirSync(join(root, 'leases', lease)).map((file) =>
          readFileSync(join(root, 'leases', lease, file), 'utf8'),
        ),
      )
      .join('\n')
    expect(durableBytes).not.toContain(token)
  })

  it('rejects a different valid owner capability on every mutating or private operation', async () => {
    const source = repository()
    const manager = createLocalPrivateWorkspaceManager({
      root: managerRoot(),
      now: () => 1_000,
      limits,
    })
    const prepared = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'owner-boundary',
      ownerId: 'worker',
      ownerToken: ownerToken('right-owner'),
      expiresAtMs: 2_000,
    })
    const wrongAuthorization = {
      leaseId: prepared.leaseId,
      ownerToken: ownerToken('wrong-owner'),
    }
    for (const operation of [
      () => manager.getLocalSourceSnapshotPolicy(wrongAuthorization),
      () => manager.renew({ ...wrongAuthorization, expiresAtMs: 3_000 }),
      () =>
        manager.sealWorkspace({
          ...wrongAuthorization,
          profileActivationDigest: digest('wrong-owner'),
        }),
      () =>
        manager.bindExecutionReceipt({
          ...wrongAuthorization,
          executionPreparationDigest: digest('wrong-owner'),
        }),
      () => manager.requireExecutionBound(wrongAuthorization),
      () => manager.destroy(wrongAuthorization),
    ]) {
      await expect(operation()).rejects.toThrow('owner token is invalid')
    }
    expect(await manager.get(prepared.leaseId)).toMatchObject({ phase: 'copy-ready' })
    expect(existsSync(prepared.workspace.root)).toBe(true)
  })

  it('refuses self-hashed state that points cleanup outside the manager root', async () => {
    const source = repository()
    const root = managerRoot()
    const outside = temporaryRoot('local-private-workspace-outside-')
    writeFileSync(join(outside, 'keep'), 'do not remove\n')
    const token = ownerToken('hostile-state')
    const manager = createLocalPrivateWorkspaceManager({ root, now: () => 1_000, limits })
    const prepared = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'hostile-state',
      ownerId: 'worker',
      ownerToken: token,
      expiresAtMs: 2_000,
    })
    const statePath = join(
      root,
      'leases',
      prepared.leaseId.slice('local-workspace.'.length),
      'state-00000000.json',
    )
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
    state.workspaceRoot = outside
    state.workspaceIdentityDigest = canonicalCandidateDigest({
      kind: 'local-private-workspace-allocation',
      provider: 'agent-runtime/local-private-workspace',
      leaseId: prepared.leaseId,
      root: outside,
    })
    const { stateDigest: _stateDigest, ...unsigned } = state
    state.stateDigest = canonicalCandidateDigest(unsigned)
    writeFileSync(statePath, `${JSON.stringify(state)}\n`)

    await expect(manager.destroy({ leaseId: prepared.leaseId, ownerToken: token })).rejects.toThrow(
      'outside the manager allocation root',
    )
    expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('do not remove\n')
  })

  it('refuses a symlink substituted for a managed allocation before cleanup', async () => {
    const source = repository()
    const root = managerRoot()
    const outside = temporaryRoot('local-private-workspace-symlink-target-')
    writeFileSync(join(outside, 'keep'), 'do not remove\n')
    const token = ownerToken('symlink-cleanup')
    const manager = createLocalPrivateWorkspaceManager({ root, now: () => 1_000, limits })
    const prepared = await manager.prepare({
      sourceRoot: source,
      idempotencyKey: 'symlink-cleanup',
      ownerId: 'worker',
      ownerToken: token,
      expiresAtMs: 2_000,
    })
    rmSync(prepared.workspace.root, { recursive: true, force: true })
    symlinkSync(outside, prepared.workspace.root, 'dir')

    await expect(
      manager.destroy({ leaseId: prepared.leaseId, ownerToken: token }),
    ).rejects.toBeInstanceOf(LocalPrivateWorkspaceCleanupError)
    expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('do not remove\n')
  })
})
