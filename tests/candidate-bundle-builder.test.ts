import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { canonicalJson } from '@tangle-network/agent-eval'
import { gitWorktreeAdapter } from '@tangle-network/agent-eval/campaign'
import type {
  AgentCandidateArtifactRef,
  AgentCandidateBundle,
  AgentProfile,
  AgentProfileDiff,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'

import {
  type BuildAgentCandidateBundleInput,
  buildAgentCandidateBundle,
  sealAgentCandidateBundle,
  verifyAgentCandidateBundle,
} from '../src/index'
import {
  candidateSha,
  cleanupCandidateFixtures,
  createCandidateExecutionFixture,
} from './helpers/candidate-execution-fixture'

const temporaryRoots: string[] = []

afterEach(() => {
  cleanupCandidateFixtures()
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('public agent candidate bundle builder', () => {
  it('binds profile diffs, verified CodeSurface bytes, knowledge, and memory into one executable candidate', async () => {
    const fixture = createCandidateExecutionFixture(true)
    const adapter = gitWorktreeAdapter({
      repoRoot: fixture.task.stagingRoots.taskRoot,
      worktreeDir: temporaryRoot('candidate-builder-worktrees-'),
      branchPrefix: 'candidate-builder-test',
    })
    const worktree = await adapter.create({ baseRef: 'HEAD', label: 'candidate' })
    writeFileSync(join(worktree.path, 'source.ts'), 'export const value = 2\n')
    const surface = await adapter.finalize(worktree, 'feat: candidate implementation')

    const base: AgentProfile = {
      name: 'candidate',
      prompt: { instructions: ['Inspect the repository, implement the fix, and run tests.'] },
      model: { default: 'provider/model', reasoningEffort: 'high' },
      harness: 'codex',
      resources: { failOnError: true },
    }
    const diff: AgentProfileDiff = {
      schemaVersion: 1,
      kind: 'agent-profile-diff',
      id: 'add-review-skill',
      source: { kind: 'optimizer', artifacts: ['trace:run-1'] },
      set: {
        resources: {
          failOnError: true,
          skills: [
            {
              kind: 'inline',
              name: 'review/SKILL.md',
              content: 'Read the failing test before editing.\n',
            },
          ],
        },
      },
    }
    const stored = new Map<Sha256Digest, Uint8Array>()
    const knowledgeManifest = storeArtifact(stored, 'knowledge/manifest.json', '{"version":1}\n')
    const memorySeed = storeArtifact(stored, 'memory/seed.json', '{"entries":[]}\n')
    const input: BuildAgentCandidateBundleInput = {
      profile: { kind: 'profile-diffs', base, diffs: [diff] },
      code: {
        kind: 'code-surface',
        surface,
        repository: { kind: 'github', owner: 'owner', repo: 'repo' },
      },
      execution: fixture.bundle.execution,
      knowledge: { snapshotId: 'knowledge-snapshot-1', manifest: knowledgeManifest },
      memory: { mode: 'isolated', scope: 'task', seed: memorySeed },
      lineage: {
        source: 'compound',
        parentDigests: [
          fixture.bundle.lineage.parentDigests?.[0] ?? candidateSha('e'),
          candidateSha('9'),
        ],
        runIds: ['optimizer-run-1'],
        benchmark: fixture.bundle.lineage.benchmark,
        spend: fixture.bundle.lineage.spend,
      },
    }

    try {
      const first = buildAgentCandidateBundle(input)
      const second = buildAgentCandidateBundle(input)
      expectTypeOf(first).toEqualTypeOf<AgentCandidateBundle>()
      expect(first.digest).toBe(second.digest)
      expect(Object.isFrozen(first)).toBe(true)
      expect(first.code).toMatchObject({
        kind: 'git-patch',
        baseCommit: surface.baseCommit,
        baseTree: surface.baseTree,
        candidateTree: surface.candidateTree,
        patch: {
          format: 'git-diff-binary',
          artifact: {
            sha256: surface.patch.sha256,
            byteLength: surface.patch.byteLength,
          },
        },
      })
      expect(first.profile.resources?.skills?.[0]).toMatchObject({
        kind: 'inline',
        name: 'review/SKILL.md',
        sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      })
      expect(first.lineage.profileDiffIds).toEqual([
        `sha256:${createHash('sha256').update(canonicalJson(diff)).digest('hex')}`,
      ])

      const verified = await verifyAgentCandidateBundle(first, {
        repositories: fixture.ports.repositories,
        artifacts: {
          read: async (ref) => {
            const bytes = stored.get(ref.sha256)
            if (!bytes) throw new Error(`missing test artifact ${ref.sha256}`)
            return Uint8Array.from(bytes)
          },
        },
      })
      expect(verified.bundle.digest).toBe(first.digest)
      expect(verified.materializedTree).toBe(surface.candidateTree)
    } finally {
      await adapter.discard(worktree)
    }
  })

  it('rejects CodeSurface drift before sealing and exports the low-level sealer', async () => {
    const fixture = createCandidateExecutionFixture(true)
    const adapter = gitWorktreeAdapter({
      repoRoot: fixture.task.stagingRoots.taskRoot,
      worktreeDir: temporaryRoot('candidate-builder-drift-'),
      branchPrefix: 'candidate-builder-drift',
    })
    const worktree = await adapter.create({ baseRef: 'HEAD', label: 'drift' })
    writeFileSync(join(worktree.path, 'source.ts'), 'export const value = 3\n')
    const surface = await adapter.finalize(worktree, 'feat: drift candidate')
    try {
      expect(() =>
        buildAgentCandidateBundle({
          profile: { kind: 'profile', profile: simpleProfile() },
          code: {
            kind: 'code-surface',
            surface: {
              ...surface,
              patch: { ...surface.patch, sha256: `sha256:${'0'.repeat(64)}` },
            },
            repository: { kind: 'github', owner: 'owner', repo: 'repo' },
          },
          execution: fixture.bundle.execution,
          memory: { mode: 'disabled' },
          lineage: { source: 'optimizer' },
        }),
      ).toThrow(/CodeSurface|patch/i)

      const { digest: _digest, ...withoutDigest } = fixture.bundle
      expect(sealAgentCandidateBundle(withoutDigest).digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    } finally {
      await adapter.discard(worktree)
    }
  })

  it('fails closed when a generic profile would lose behavior or byte identity', () => {
    const fixture = createCandidateExecutionFixture(false)
    const base = {
      code: { kind: 'disabled', reason: 'control' } as const,
      execution: fixture.bundle.execution,
      memory: { mode: 'disabled' } as const,
      lineage: { source: 'human' } as const,
    }
    expect(() =>
      buildAgentCandidateBundle({
        ...base,
        profile: {
          kind: 'profile',
          profile: { ...simpleProfile(), metadata: { silentlyDropped: true } },
        },
      }),
    ).toThrow(/metadata.*not representable/)
    expect(() =>
      buildAgentCandidateBundle({
        ...base,
        profile: {
          kind: 'profile',
          profile: {
            ...simpleProfile(),
            resources: {
              failOnError: true,
              skills: [
                {
                  kind: 'github',
                  repository: 'owner/repo',
                  ref: 'f'.repeat(40),
                  path: 'skills/review/SKILL.md',
                },
              ],
            },
          },
        },
      }),
    ).toThrow(/GitHub profile resources do not carry byte identity/)
    expect(() =>
      buildAgentCandidateBundle({
        ...base,
        profile: {
          kind: 'profile-diffs',
          base: simpleProfile(),
          diffs: [],
        },
      }),
    ).toThrow(/at least one AgentProfileDiff/)
    expect(() =>
      buildAgentCandidateBundle({
        ...base,
        profile: { kind: 'profile', profile: simpleProfile() },
        code: { kind: 'git-patch' } as unknown as BuildAgentCandidateBundleInput['code'],
      }),
    ).toThrow(/unsupported candidate code source/)
    expect(() =>
      buildAgentCandidateBundle({
        ...base,
        profile: { kind: 'profile', profile: simpleProfile() },
        lineage: {
          source: 'human',
          profileDiffIds: ['caller-controlled'],
        } as unknown as BuildAgentCandidateBundleInput['lineage'],
      }),
    ).toThrow(/profileDiffIds.*derived/)
  })

  it('accepts an already closed candidate profile for behavior generic profiles cannot encode', () => {
    const fixture = createCandidateExecutionFixture(false)
    const bundle = buildAgentCandidateBundle({
      profile: {
        kind: 'candidate-profile',
        profile: {
          name: 'hooked-candidate',
          harness: 'codex',
          hooks: {
            Stop: [
              {
                executable: 'node',
                args: [{ kind: 'public', value: 'scripts/check.mjs' }],
                blocking: true,
              },
            ],
          },
        },
      },
      code: { kind: 'disabled', reason: 'control' },
      execution: fixture.bundle.execution,
      memory: { mode: 'disabled' },
      lineage: { source: 'human' },
    })
    expect(bundle.profile.hooks?.Stop?.[0]).toEqual({
      executable: 'node',
      args: [{ kind: 'public', value: 'scripts/check.mjs' }],
      blocking: true,
    })
  })
})

function simpleProfile(): AgentProfile {
  return {
    name: 'candidate',
    prompt: { instructions: ['Solve the task and run its tests.'] },
    model: { default: 'provider/model', reasoningEffort: 'high' },
    harness: 'codex',
  }
}

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

function storeArtifact(
  store: Map<Sha256Digest, Uint8Array>,
  key: string,
  value: string,
): AgentCandidateArtifactRef {
  const bytes = Buffer.from(value, 'utf8')
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as Sha256Digest
  store.set(sha256, Uint8Array.from(bytes))
  return {
    locator: { kind: 's3', bucket: 'candidate-test-artifacts', key },
    sha256,
    byteLength: bytes.byteLength,
  }
}
