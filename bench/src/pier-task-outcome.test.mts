import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  type AgentCandidateOutputArtifactPort,
  captureAgentCandidateWorkspaceFiles,
  createAgentCandidateWorkspacePort,
} from '@tangle-network/agent-runtime/candidate-execution'

import { capturePierTaskOutcome } from './pier-task-outcome'

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
    const expected = await captureAgentCandidateWorkspaceFiles([
      { path: 'src/status.txt', mode: 0o644, bytes: Buffer.from('ready\n') },
    ])
    assert.deepEqual(captured.afterState, expected.snapshot.material)
    assert.deepEqual(Buffer.from(captured.archive), Buffer.from(expected.archive))
    const destination = join(root, 'materialized')
    await createAgentCandidateWorkspacePort().materialize({
      role: 'candidate',
      archive: captured.archive,
      snapshot: expected.snapshot,
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

test('Pier task outcome externalizes workspace evidence above the embedded limit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pier-task-outcome-test-'))
  try {
    const payload = Buffer.alloc(1024 * 1024 + 1, 7)
    writeFileSync(join(root, 'large.bin'), payload)
    git(root, ['init', '-b', 'main'])
    git(root, ['config', 'user.email', 'fixture@example.com'])
    git(root, ['config', 'user.name', 'Fixture'])
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'base'])
    const baseCommit = git(root, ['rev-parse', 'HEAD'])
    const baseTree = git(root, ['rev-parse', 'HEAD^{tree}'])
    const stored = new Map<string, Uint8Array>()
    const outputArtifacts: AgentCandidateOutputArtifactPort = {
      put: async ({ bytes, purpose }) => {
        const detached = Uint8Array.from(bytes)
        const digest = sha256(detached)
        stored.set(digest, detached)
        return {
          locator: {
            kind: 's3',
            bucket: 'pier-test-artifacts',
            key: `${purpose}/${digest}`,
          },
          sha256: digest,
          byteLength: detached.byteLength,
        }
      },
      read: async (ref) => Uint8Array.from(stored.get(ref.sha256) ?? []),
    }

    const captured = await capturePierTaskOutcome({
      repositoryRoot: root,
      baseCommit,
      baseTree,
      patch: Buffer.alloc(0),
      artifactPersistence: { executionId: 'pier-large-1', outputArtifacts },
    })

    assert.ok(captured.archive.byteLength > 1024 * 1024)
    assert.equal(captured.afterState.files[0]?.byteLength, payload.byteLength)
    assert.deepEqual(Buffer.from(stored.get(sha256(captured.archive)) ?? []), captured.archive)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

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
