import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { type Headers, pack } from 'tar-stream'
import { afterEach, describe, expect, it } from 'vitest'

import {
  captureAgentCandidateWorkspace,
  captureAgentCandidateWorkspaceFiles,
  createAgentCandidateWorkspacePort,
} from '../src/candidate-execution'
import { embeddedCandidateArtifact, sha256Bytes } from '../src/candidate-execution/digest'
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

async function rawTar(header: Headers, bytes = Buffer.alloc(0)): Promise<Uint8Array> {
  const archive = pack()
  const output = (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of archive) chunks.push(chunk)
    return Buffer.concat(chunks)
  })()
  await new Promise<void>((resolveEntry, rejectEntry) => {
    archive.entry(header, bytes, (error) => (error ? rejectEntry(error) : resolveEntry()))
  })
  archive.finalize()
  return output
}

function repository(
  objectFormat: 'sha1' | 'sha256' = 'sha1',
  root: string = temporaryRoot('candidate-workspace-source-'),
): string {
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
  it.each(['sha1', 'sha256'] as const)(
    'captures and restores exact Git HEAD files for %s repositories',
    async (objectFormat) => {
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
    },
  )

  it('captures and materializes through a symlinked path prefix', async () => {
    // macOS hands out every temp path under /var, a symlink to /private/var, so a caller there
    // always supplies a root whose PREFIX is a link. Build that shape explicitly, so the
    // property is checked on a platform whose temp root is real too.
    const realParent = temporaryRoot('candidate-workspace-real-parent-')
    const source = join(realParent, 'repo')
    mkdirSync(source)
    repository('sha1', source)
    const aliasParent = join(temporaryRoot('candidate-workspace-alias-'), 'alias')
    symlinkSync(realParent, aliasParent, 'dir')
    expect(realpathSync(join(aliasParent, 'repo'))).not.toBe(join(aliasParent, 'repo'))

    const expectedHead = git(source, ['rev-parse', 'HEAD'])
    const captured = await captureAgentCandidateWorkspace(join(aliasParent, 'repo'), {
      includeRepository: true,
    })
    const destination = join(aliasParent, 'restored')
    await createAgentCandidateWorkspacePort().materialize({
      role: 'task',
      snapshot: captured.snapshot,
      archive: captured.archive,
      destination,
    })

    expect(readFileSync(join(destination, 'README.md'), 'utf8')).toBe('workspace\n')
    expect(git(destination, ['rev-parse', 'HEAD'])).toBe(expectedHead)
    expect(captured.snapshot.material.files.map((file) => file.path)).toEqual([
      '.gitignore',
      'README.md',
      'bin/run',
    ])
  })

  it('still refuses a workspace root that is itself a symbolic link', async () => {
    const source = repository()
    const link = `${source}-link`
    symlinkSync(source, link, 'dir')
    await expect(captureAgentCandidateWorkspace(link, { includeRepository: true })).rejects.toThrow(
      'candidate repository root must be a real directory',
    )
  })

  it('restores a non-repository workspace and rejects archive drift', async () => {
    const source = temporaryRoot('candidate-workspace-files-')
    writeFileSync(join(source, 'input.txt'), 'exact bytes', { mode: 0o664 })
    chmodSync(join(source, 'input.txt'), 0o664)
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
    expect(statSync(join(destination, 'input.txt')).mode & 0o777).toBe(0o664)

    const tampered = Uint8Array.from(captured.archive)
    const contentOffset = Buffer.from(tampered).indexOf('exact bytes')
    if (contentOffset < 0) throw new Error('fixture tar does not contain the file payload')
    tampered[contentOffset] = 'E'.charCodeAt(0)
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

  it('captures detached remote files into the same sorted immutable archive', async () => {
    const mutable = Buffer.from('before')
    const captured = await captureAgentCandidateWorkspaceFiles([
      { path: 'z.txt', mode: 0o644, bytes: mutable },
      { path: 'bin/run', mode: 0o755, bytes: Buffer.from([0, 255]) },
    ])
    mutable.fill(0)
    const destination = join(temporaryRoot('candidate-workspace-parent-'), 'remote')

    await createAgentCandidateWorkspacePort().materialize({
      role: 'candidate',
      snapshot: captured.snapshot,
      archive: captured.archive,
      destination,
    })

    expect(captured.snapshot.material.files.map((file) => file.path)).toEqual(['bin/run', 'z.txt'])
    expect(Object.isFrozen(captured.snapshot)).toBe(true)
    expect(Object.isFrozen(captured.snapshot.material)).toBe(true)
    const changedArchive = Uint8Array.from(captured.archive)
    changedArchive[0] = changedArchive[0] === 0 ? 1 : 0
    expect(captured.archive[0]).not.toBe(changedArchive[0])
    expect(readFileSync(join(destination, 'z.txt'), 'utf8')).toBe('before')
    expect([...readFileSync(join(destination, 'bin', 'run'))]).toEqual([0, 255])
    await expect(
      captureAgentCandidateWorkspaceFiles([
        { path: 'same', mode: 0o644, bytes: Buffer.alloc(0) },
        { path: 'same', mode: 0o644, bytes: Buffer.alloc(0) },
      ]),
    ).rejects.toThrow('unique and sorted')
    await expect(
      captureAgentCandidateWorkspaceFiles([
        { path: 'parent', mode: 0o644, bytes: Buffer.alloc(0) },
        { path: 'parent/child', mode: 0o644, bytes: Buffer.alloc(0) },
      ]),
    ).rejects.toThrow('unique and sorted')
    await expect(
      captureAgentCandidateWorkspaceFiles([
        { path: 'a', mode: 0o644, bytes: Buffer.alloc(0) },
        { path: 'a-', mode: 0o644, bytes: Buffer.alloc(0) },
        { path: 'a/b', mode: 0o644, bytes: Buffer.alloc(0) },
      ]),
    ).rejects.toThrow('unique and sorted')

    const getterFile = {
      path: 'getter',
      mode: 0o644 as const,
      get bytes(): Uint8Array {
        return Buffer.alloc(0)
      },
    }
    await expect(captureAgentCandidateWorkspaceFiles([getterFile])).rejects.toThrow('fixed values')

    await expect(
      captureAgentCandidateWorkspaceFiles([
        {
          path: 'shared',
          mode: 0o644,
          bytes: new Uint8Array(new SharedArrayBuffer(1)),
        },
      ]),
    ).rejects.toThrow('shared bytes')
    const crossRealmShared = runInNewContext(
      'new Uint8Array(new SharedArrayBuffer(1))',
    ) as Uint8Array
    await expect(
      captureAgentCandidateWorkspaceFiles([
        { path: 'cross-realm-shared', mode: 0o644, bytes: crossRealmShared },
      ]),
    ).rejects.toThrow('shared bytes')
    const crossRealmBytes = runInNewContext('new Uint8Array([1, 2, 3])') as Uint8Array
    const crossRealmCapture = await captureAgentCandidateWorkspaceFiles([
      { path: 'cross-realm', mode: 0o644, bytes: crossRealmBytes },
    ])
    expect(crossRealmCapture.snapshot.material.files[0]?.byteLength).toBe(3)
    const overriddenMap = [{ path: 'map', mode: 0o644 as const, bytes: Buffer.from('checked') }]
    Object.defineProperty(overriddenMap, 'map', {
      value: () => [{ path: '../unchecked', mode: 0o644, bytes: Buffer.alloc(0) }],
    })
    const overriddenMapCapture = await captureAgentCandidateWorkspaceFiles(overriddenMap)
    expect(overriddenMapCapture.snapshot.material.files[0]?.path).toBe('map')
    let lengthReads = 0
    const proxiedFiles = new Proxy(
      [{ path: 'proxy', mode: 0o644 as const, bytes: Buffer.alloc(0) }],
      {
        get(target, property, receiver) {
          if (property === 'length') {
            lengthReads++
            return lengthReads === 1 ? 1 : 10_000
          }
          return Reflect.get(target, property, receiver)
        },
      },
    )
    const proxiedCapture = await captureAgentCandidateWorkspaceFiles(proxiedFiles, {
      limits: { maxFiles: 1 },
    })
    expect(proxiedCapture.snapshot.material.files[0]?.path).toBe('proxy')
    expect(lengthReads).toBe(1)
    const iterable = Buffer.alloc(0)
    iterable[Symbol.iterator] = function* () {
      yield* Buffer.alloc(1_024)
    }
    const iterableCapture = await captureAgentCandidateWorkspaceFiles([
      { path: 'iterable', mode: 0o644, bytes: iterable },
    ])
    expect(iterableCapture.snapshot.material.files[0]?.byteLength).toBe(0)
    await expect(
      captureAgentCandidateWorkspaceFiles([
        { path: '\ud800', mode: 0o644, bytes: Buffer.alloc(0) },
      ]),
    ).rejects.toThrow('unsafe path')
    await expect(
      captureAgentCandidateWorkspaceFiles(
        [{ path: 'large', mode: 0o644, bytes: Buffer.alloc(1_024) }],
        { limits: { maxArchiveBytes: 100 } },
      ),
    ).rejects.toThrow('exceeds maxArchiveBytes')
  })

  it('stores large workspace artifacts by exact external reference', async () => {
    const stored = new Map<string, Uint8Array>()
    const outputArtifacts = {
      put: async ({ bytes, purpose }: { bytes: Uint8Array; purpose: string }) => {
        const detached = Uint8Array.from(bytes)
        const sha256 = sha256Bytes(detached)
        stored.set(sha256, detached)
        return {
          locator: {
            kind: 's3' as const,
            bucket: 'candidate-test-artifacts',
            key: `${purpose}/${sha256}`,
          },
          sha256,
          byteLength: detached.byteLength,
        }
      },
      read: async (ref: { sha256: string }) => Uint8Array.from(stored.get(ref.sha256) ?? []),
    }
    const files = [{ path: 'large', mode: 0o644 as const, bytes: Buffer.alloc(1_024, 7) }]

    await expect(
      captureAgentCandidateWorkspaceFiles(files, {
        limits: { maxEmbeddedArtifactBytes: 100 },
      }),
    ).rejects.toThrow('artifactPersistence is required')
    const captured = await captureAgentCandidateWorkspaceFiles(files, {
      limits: { maxEmbeddedArtifactBytes: 100 },
      artifactPersistence: {
        executionId: 'workspace-capture-1',
        outputArtifacts,
      },
    })

    expect('locator' in captured.snapshot.manifest).toBe(true)
    expect('locator' in captured.snapshot.archive).toBe(true)
    expect(Buffer.from(stored.get(captured.snapshot.archive.sha256) ?? [])).toEqual(
      Buffer.from(captured.archive),
    )
    const destination = join(temporaryRoot('candidate-workspace-parent-'), 'external')
    await createAgentCandidateWorkspacePort().materialize({
      role: 'candidate',
      snapshot: captured.snapshot,
      archive: captured.archive,
      destination,
    })
    expect(readFileSync(join(destination, 'large'))).toEqual(Buffer.alloc(1_024, 7))

    await expect(
      captureAgentCandidateWorkspaceFiles(files, {
        artifactPersistence: {
          executionId: 'workspace-capture-2',
          outputArtifacts: {
            put: async ({ bytes }) => ({
              locator: { kind: 's3', bucket: 'candidate-test-artifacts', key: 'missing' },
              sha256: sha256Bytes(bytes),
              byteLength: bytes.byteLength,
            }),
            read: async () => Uint8Array.from([0]),
          },
        },
      }),
    ).rejects.toThrow(/persisted candidate output/)
  })

  it('bounds archive plus decoded bytes before retaining an entry', async () => {
    const captured = await captureAgentCandidateWorkspaceFiles([
      { path: 'payload', mode: 0o644, bytes: Buffer.alloc(1_024, 7) },
    ])
    const destination = join(temporaryRoot('candidate-workspace-parent-'), 'bounded')

    await expect(
      createAgentCandidateWorkspacePort({
        limits: { maxArchiveBytes: captured.archive.byteLength + 1_023 },
      }).materialize({
        role: 'candidate',
        snapshot: captured.snapshot,
        archive: captured.archive,
        destination,
      }),
    ).rejects.toThrow('exceeds maxArchiveBytes while decoding')
  })

  it('rejects unsafe, linked, and noncanonical tar entries', async () => {
    const baseline = await captureAgentCandidateWorkspaceFiles([])
    const port = createAgentCandidateWorkspacePort()
    const cases = [
      {
        label: 'traversal',
        archive: await rawTar({ name: 'workspace/../escape', mode: 0o644, type: 'file' }),
        error: /unsafe path/,
      },
      {
        label: 'symlink',
        archive: await rawTar({
          name: 'workspace/link',
          mode: 0o755,
          type: 'symlink',
          linkname: '/etc/passwd',
        }),
        error: /invalid entry/,
      },
      {
        label: 'noncanonical',
        archive: await rawTar(
          {
            name: 'workspace/input.txt',
            mode: 0o644,
            uid: 1,
            gid: 1,
            mtime: new Date(0),
            type: 'file',
          },
          Buffer.from('input'),
        ),
        error: /not canonical/,
      },
    ]

    for (const attack of cases) {
      await expect(
        port.materialize({
          role: 'candidate',
          snapshot: { ...baseline.snapshot, archive: embeddedCandidateArtifact(attack.archive) },
          archive: attack.archive,
          destination: join(temporaryRoot('candidate-workspace-parent-'), attack.label),
        }),
      ).rejects.toThrow(attack.error)
    }
  })

  it('round-trips long and non-ASCII paths through canonical tar headers', async () => {
    const longPath = `${Array.from({ length: 6 }, (_, index) => `${index}-${'x'.repeat(48)}`).join('/')}/caf\u00e9.txt`
    const captured = await captureAgentCandidateWorkspaceFiles([
      { path: longPath, mode: 0o644, bytes: Buffer.from('long path') },
    ])
    const destination = join(temporaryRoot('candidate-workspace-parent-'), 'long-path')

    await createAgentCandidateWorkspacePort().materialize({
      role: 'candidate',
      snapshot: captured.snapshot,
      archive: captured.archive,
      destination,
    })

    expect(readFileSync(join(destination, longPath), 'utf8')).toBe('long path')
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
    const configRoot = temporaryRoot('candidate-workspace-git-config-')
    const marker = join(configRoot, 'fsmonitor-ran')
    const fsmonitor = join(configRoot, 'fsmonitor.sh')
    writeFileSync(fsmonitor, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 })
    chmodSync(fsmonitor, 0o755)
    git(source, ['config', 'core.fsmonitor', fsmonitor])
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
    expect(existsSync(marker)).toBe(false)
  })

  it('rejects repository object-store indirection before capture', async () => {
    const source = repository()
    const alternateObjects = join(temporaryRoot('candidate-workspace-alternate-'), 'objects')
    mkdirSync(alternateObjects)
    mkdirSync(join(source, '.git', 'objects', 'info'), { recursive: true })
    writeFileSync(join(source, '.git', 'objects', 'info', 'alternates'), `${alternateObjects}\n`)

    await expect(
      captureAgentCandidateWorkspace(source, { includeRepository: true }),
    ).rejects.toThrow('forbidden Git alternates')
  })

  it('rejects object-store indirection inherited by a linked worktree', async () => {
    const source = repository()
    const linked = temporaryRoot('candidate-workspace-linked-')
    rmSync(linked, { recursive: true, force: true })
    git(source, ['worktree', 'add', '--detach', linked])
    const alternateObjects = join(temporaryRoot('candidate-workspace-alternate-'), 'objects')
    mkdirSync(alternateObjects)
    mkdirSync(join(source, '.git', 'objects', 'info'), { recursive: true })
    writeFileSync(join(source, '.git', 'objects', 'info', 'alternates'), `${alternateObjects}\n`)

    await expect(
      captureAgentCandidateWorkspace(linked, { includeRepository: true }),
    ).rejects.toThrow('forbidden Git alternates')
  })
})
