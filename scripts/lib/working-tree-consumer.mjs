import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Prove working-tree handoff through the installed package, with no source imports. */
export async function verifyWorkingTreeConsumer(candidates, kernel) {
  const root = mkdtempSync(join(tmpdir(), 'runtime-packed-working-tree-'))
  const source = join(root, 'source')
  const destination = join(root, 'destination')
  mkdirSync(source)
  // Keep the disposable fixture independent of the caller's Git identity.
  const git = (args, cwd = source) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Runtime packed consumer',
      GIT_AUTHOR_EMAIL: 'runtime-packed-consumer@example.invalid',
      GIT_COMMITTER_NAME: 'Runtime packed consumer',
      GIT_COMMITTER_EMAIL: 'runtime-packed-consumer@example.invalid',
    },
  }).trim()
  try {
    git(['init', '--quiet', '--initial-branch=main'])
    writeFileSync(join(source, 'file.txt'), 'committed\n')
    writeFileSync(join(source, 'deleted.txt'), 'committed deletion target\n')
    git(['add', '.'])
    git(['commit', '-qm', 'fixture'])
    writeFileSync(join(source, 'file.txt'), 'staged\n')
    git(['add', 'file.txt'])
    writeFileSync(join(source, 'file.txt'), 'working\n')
    unlinkSync(join(source, 'deleted.txt'))
    writeFileSync(join(source, 'untracked.bin'), Uint8Array.from([255, 0, 128, 1]))
    const status = git(['status', '--porcelain=v1', '--untracked-files=all'])
    const captured = await candidates.captureAgentCandidateWorkspace(source, {
      includeRepository: true,
      repositoryContents: 'working-tree',
    })
    await candidates.createAgentCandidateWorkspacePort().materialize({
      role: 'task', snapshot: captured.snapshot, archive: captured.archive, destination,
    })
    assert.equal(readFileSync(join(destination, 'file.txt'), 'utf8'), 'working\n')
    assert.equal(git(['show', ':file.txt'], destination), 'staged')
    assert.deepEqual([...readFileSync(join(destination, 'untracked.bin'))], [255, 0, 128, 1])
    assert.equal(existsSync(join(destination, 'deleted.txt')), false)
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all'], destination), status)
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), status)
    assert.equal(readFileSync(join(source, 'file.txt'), 'utf8'), 'working\n')
    console.log('Packed working-tree consumer preserves staged, dirty, deleted and untracked files')

    const artifacts = kernel.createPrivateCasArtifactPort(join(root, 'artifacts'), 'packed-transfer')
    const snapshot = await candidates.captureAgentWorkspaceSnapshot(source, {
      includeRepository: true,
      repositoryContents: 'working-tree',
      artifactPersistence: { executionId: 'packed-source', outputArtifacts: artifacts },
    })
    assert.deepEqual(Object.keys(snapshot).sort(), ['archive', 'digest', 'kind', 'manifest'])
    const remote = join(root, 'remote')
    await candidates.materializeAgentWorkspaceSnapshot({ snapshot, artifacts, destination: remote })
    assert.equal(readFileSync(join(remote, 'file.txt'), 'utf8'), 'working\n')
    assert.equal(git(['show', ':file.txt'], remote), 'staged')
    assert.deepEqual([...readFileSync(join(remote, 'untracked.bin'))], [255, 0, 128, 1])
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all'], remote), status)

    writeFileSync(join(remote, 'file.txt'), 'staged return\n')
    git(['add', 'file.txt'], remote)
    writeFileSync(join(remote, 'file.txt'), 'working return\n')
    const returned = await candidates.captureAgentWorkspaceSnapshot(remote, {
      includeRepository: true,
      repositoryContents: 'working-tree',
      artifactPersistence: { executionId: 'packed-return', outputArtifacts: artifacts },
    })
    const restartedArtifacts = kernel.createPrivateCasArtifactPort(join(root, 'artifacts'), 'packed-transfer')
    const localReturn = join(root, 'local-return')
    await candidates.materializeAgentWorkspaceSnapshot({
      snapshot: JSON.parse(JSON.stringify(returned)), artifacts: restartedArtifacts, destination: localReturn,
    })
    assert.equal(readFileSync(join(localReturn, 'file.txt'), 'utf8'), 'working return\n')
    assert.equal(git(['show', ':file.txt'], localReturn), 'staged return')
    assert.equal(
      git(['status', '--porcelain=v1', '--untracked-files=all'], localReturn),
      git(['status', '--porcelain=v1', '--untracked-files=all'], remote),
    )
    await assert.rejects(
      candidates.materializeAgentWorkspaceSnapshot({ snapshot, artifacts, destination: localReturn }),
      /already exists/,
    )
    assert.equal(readFileSync(join(localReturn, 'file.txt'), 'utf8'), 'working return\n')
    assert.equal(readFileSync(join(source, 'file.txt'), 'utf8'), 'working\n')
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), status)
    console.log('Packed workspace references restore exact state, changed return and conflict refusal')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
