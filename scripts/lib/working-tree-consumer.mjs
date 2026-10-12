import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Prove working-tree handoff through the installed package, with no source imports. */
export async function verifyWorkingTreeConsumer(candidates) {
  const root = mkdtempSync(join(tmpdir(), 'runtime-packed-working-tree-'))
  const source = join(root, 'source')
  const destination = join(root, 'destination')
  mkdirSync(source)
  const git = (args, cwd = source) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
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
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
