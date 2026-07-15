import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  AgentCandidateGitPatch,
  AgentCandidateWorkspaceManifestMaterial,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'

import {
  readVerifiedArtifact,
  verifyMaterializedWorkspace,
  verifyWorkspaceSnapshotArtifacts,
} from '../src/candidate-execution/artifacts'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  embeddedCandidateArtifact,
} from '../src/candidate-execution/digest'
import { verifyCandidateCode } from '../src/candidate-execution/git-materialize'

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

function repositoryFixture(): {
  root: string
  baseCommit: string
  baseTree: string
  candidateTree: string
  patch: Uint8Array
} {
  const root = temporaryRoot('candidate-git-')
  git(root, ['init', '-b', 'main'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['config', 'core.hooksPath', '/dev/null'])
  git(root, ['remote', 'add', 'origin', 'git@github.com:owner/repo.git'])
  writeFileSync(join(root, 'index.ts'), 'export const value = 1\n')
  git(root, ['add', 'index.ts'])
  git(root, ['commit', '-m', 'base'])
  const baseCommit = git(root, ['rev-parse', 'HEAD'])
  const baseTree = git(root, ['rev-parse', 'HEAD^{tree}'])
  writeFileSync(join(root, 'index.ts'), 'export const value = 2\n')
  const patch = Buffer.from(execFileSync('git', ['diff', '--binary'], { cwd: root }))
  git(root, ['add', 'index.ts'])
  const candidateTree = git(root, ['write-tree'])
  git(root, ['reset', '--hard', baseCommit])
  return { root, baseCommit, baseTree, candidateTree, patch }
}

function codeFixture(fixture: ReturnType<typeof repositoryFixture>): AgentCandidateGitPatch {
  return {
    kind: 'git-patch',
    repository: { kind: 'github', owner: 'owner', repo: 'repo' },
    baseCommit: fixture.baseCommit,
    baseTree: fixture.baseTree,
    candidateTree: fixture.candidateTree,
    patch: { format: 'git-diff-binary', artifact: embeddedCandidateArtifact(fixture.patch) },
  }
}

describe('candidate canonical bytes and artifacts', () => {
  it('uses the existing stable content address for exact canonical bytes', () => {
    const first = { z: [3, { b: true, a: 'x' }], a: -0 }
    const second = { a: 0, z: [3, { a: 'x', b: true }] }
    expect(canonicalCandidateBytes(first)).toEqual(canonicalCandidateBytes(second))
    expect(canonicalCandidateDigest(first)).toBe(canonicalCandidateDigest(second))
  })

  it('rejects an artifact whose claimed hash does not match its bytes', async () => {
    const artifact = embeddedCandidateArtifact(Buffer.from('actual'))
    await expect(
      readVerifiedArtifact(
        { ...artifact, content: Buffer.from('forged').toString('base64') },
        { read: async () => new Uint8Array() },
      ),
    ).rejects.toThrow(/digest|byte length/)
  })

  it('requires workspace manifest bytes to equal canonical material, not only a locator', async () => {
    const material: AgentCandidateWorkspaceManifestMaterial = {
      kind: 'agent-candidate-workspace-manifest',
      files: [],
    }
    const manifest = embeddedCandidateArtifact(canonicalCandidateBytes(material))
    const archive = embeddedCandidateArtifact(Buffer.from('archive'))
    await expect(
      verifyWorkspaceSnapshotArtifacts(
        {
          kind: 'agent-candidate-workspace-snapshot',
          digest: manifest.sha256,
          material,
          manifest,
          archive,
        },
        { read: async () => new Uint8Array() },
      ),
    ).resolves.toMatchObject({ archive: expect.any(Uint8Array) })
    await expect(
      verifyWorkspaceSnapshotArtifacts(
        {
          kind: 'agent-candidate-workspace-snapshot',
          digest: manifest.sha256,
          material,
          manifest: embeddedCandidateArtifact(Buffer.from('{}')),
          archive,
        },
        { read: async () => new Uint8Array() },
      ),
    ).rejects.toThrow(/canonical manifest/)
  })
})

describe('candidate Git identity', () => {
  it('replays a binary-safe patch against the exact base tree', async () => {
    const fixture = repositoryFixture()
    await expect(
      verifyCandidateCode(
        codeFixture(fixture),
        { resolve: async () => fixture.root },
        fixture.patch,
      ),
    ).resolves.toBe(fixture.candidateTree)
  })

  it('rejects candidate-tree drift and the wrong declared repository', async () => {
    const fixture = repositoryFixture()
    const code = codeFixture(fixture)
    await expect(
      verifyCandidateCode(
        { ...code, candidateTree: fixture.baseTree },
        { resolve: async () => fixture.root },
        fixture.patch,
      ),
    ).rejects.toThrow(/does not match/)
    await expect(
      verifyCandidateCode(
        { ...code, repository: { kind: 'github', owner: 'other', repo: 'repo' } },
        { resolve: async () => fixture.root },
        fixture.patch,
      ),
    ).rejects.toThrow(/does not match github/)
  })

  it('rejects a candidate Git tree containing symlinks', async () => {
    const fixture = repositoryFixture()
    symlinkSync('index.ts', join(fixture.root, 'linked.ts'))
    git(fixture.root, ['add', 'linked.ts'])
    const candidateTree = git(fixture.root, ['write-tree'])
    const patch = Buffer.from(
      execFileSync('git', ['diff', '--cached', '--binary', fixture.baseCommit], {
        cwd: fixture.root,
      }),
    )
    const code = {
      ...codeFixture(fixture),
      candidateTree,
      patch: { format: 'git-diff-binary' as const, artifact: embeddedCandidateArtifact(patch) },
    }
    await expect(
      verifyCandidateCode(code, { resolve: async () => fixture.root }, patch),
    ).rejects.toThrow(/symlink|non-blob/)
  })
})

describe('materialized workspace identity', () => {
  it('accepts only the exact regular files, modes, and bytes in the manifest', async () => {
    const root = temporaryRoot('candidate-workspace-')
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'ignored'), 'Git internals are not uploaded')
    writeFileSync(join(root, 'run.js'), 'ok\n', { mode: 0o755 })
    const bytes = Buffer.from('ok\n')
    const material: AgentCandidateWorkspaceManifestMaterial = {
      kind: 'agent-candidate-workspace-manifest',
      files: [
        {
          path: 'run.js',
          mode: 0o755,
          sha256: embeddedCandidateArtifact(bytes).sha256,
          byteLength: bytes.byteLength,
        },
      ],
    }
    await expect(
      verifyMaterializedWorkspace(root, material, { ignoredProtectedRootEntries: ['.git'] }),
    ).resolves.toBeUndefined()
    await expect(verifyMaterializedWorkspace(root, material)).rejects.toThrow(
      /do not match|unsupported mode/,
    )
    rmSync(join(root, '.git'), { recursive: true })
    mkdirSync(join(root, '.sidecar'))
    writeFileSync(join(root, '.sidecar', 'unsigned'), 'hidden executable bytes')
    await expect(verifyMaterializedWorkspace(root, material)).rejects.toThrow(
      /do not match|unsupported mode/,
    )
    rmSync(join(root, '.sidecar'), { recursive: true })
    writeFileSync(join(root, 'extra.txt'), 'extra')
    chmodSync(join(root, 'extra.txt'), 0o644)
    await expect(verifyMaterializedWorkspace(root, material)).rejects.toThrow(/do not match/)
  })

  it('rejects symlink and hard-link ambiguity', async () => {
    const root = temporaryRoot('candidate-workspace-links-')
    writeFileSync(join(root, 'source'), 'x')
    chmodSync(join(root, 'source'), 0o644)
    symlinkSync('source', join(root, 'symlink'))
    const material: AgentCandidateWorkspaceManifestMaterial = {
      kind: 'agent-candidate-workspace-manifest',
      files: [],
    }
    await expect(verifyMaterializedWorkspace(root, material)).rejects.toThrow(/symlink/)
    rmSync(join(root, 'symlink'))
    linkSync(join(root, 'source'), join(root, 'hardlink'))
    await expect(verifyMaterializedWorkspace(root, material)).rejects.toThrow(/hard-linked/)
  })
})
