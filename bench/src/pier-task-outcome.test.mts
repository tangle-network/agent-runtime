import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { capturePierTaskOutcome } from './pier-task-outcome'
import { materializePierWorkspaceArchive } from './pier-workspace-archive'

test('Pier task outcome reconstructs the exact tree and deterministic archive from a patch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pier-task-outcome-test-'))
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/status.txt'), 'not-ready\n')
    chmodSync(join(root, 'src/status.txt'), 0o644)
    git(root, ['init', '-b', 'main'])
    git(root, ['config', 'user.email', 'fixture@example.com'])
    git(root, ['config', 'user.name', 'Fixture'])
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'base'])
    const baseCommit = git(root, ['rev-parse', 'HEAD'])
    const baseTree = git(root, ['rev-parse', 'HEAD^{tree}'])
    writeFileSync(join(root, 'src/status.txt'), 'ready\n')
    const patch = execFileSync('git', ['-C', root, 'diff', '--binary'])
    git(root, ['restore', '.'])

    const captured = await capturePierTaskOutcome({ repositoryRoot: root, baseCommit, baseTree, patch })
    assert.notEqual(captured.resultTree, baseTree)
    assert.deepEqual(Buffer.from(captured.gitDiff), patch)
    const destination = join(root, 'materialized')
    await materializePierWorkspaceArchive({
      archive: captured.archive,
      expected: captured.afterState,
      destination,
    })
    assert.equal(readFileSync(join(destination, 'src/status.txt'), 'utf8'), 'ready\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Pier task outcome preserves the signed base for an empty patch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pier-task-outcome-test-'))
  try {
    writeFileSync(join(root, 'README.md'), 'base\n')
    git(root, ['init', '-b', 'main'])
    git(root, ['config', 'user.email', 'fixture@example.com'])
    git(root, ['config', 'user.name', 'Fixture'])
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'base'])
    const baseCommit = git(root, ['rev-parse', 'HEAD'])
    const baseTree = git(root, ['rev-parse', 'HEAD^{tree}'])

    const captured = await capturePierTaskOutcome({
      repositoryRoot: root,
      baseCommit,
      baseTree,
      patch: Buffer.alloc(0),
    })
    assert.equal(captured.resultTree, baseTree)
    assert.equal(captured.gitDiff.byteLength, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
      LC_ALL: 'C',
    },
  }).trim()
}
