import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  AgentCandidateBundle,
  AgentCandidateExecution,
  AgentCandidateWorkspaceSnapshotEvidence,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'

import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  embeddedCandidateArtifact,
} from '../src/candidate-execution/digest'
import { prepareAgentCandidateExecution } from '../src/candidate-execution/prepare'
import type {
  AgentCandidateExecutionPorts,
  AgentCandidateTaskExecution,
  ResolvedAgentCandidateContainer,
} from '../src/candidate-execution/types'
import { verifyAgentCandidateBundle } from '../src/candidate-execution/verify'

const roots: string[] = []
const sha = (character: string): Sha256Digest => `sha256:${character.repeat(64)}`

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

function taskRepository(): { root: string; commit: string; tree: string } {
  const root = temporaryRoot('candidate-task-')
  git(root, ['init', '-b', 'main'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['config', 'core.hooksPath', '/dev/null'])
  git(root, ['remote', 'add', 'origin', 'git@github.com:owner/repo.git'])
  writeFileSync(join(root, 'source.ts'), 'export const value = 1\n')
  chmodSync(join(root, 'source.ts'), 0o644)
  git(root, ['add', 'source.ts'])
  git(root, ['commit', '-m', 'base'])
  return {
    root,
    commit: git(root, ['rev-parse', 'HEAD']),
    tree: git(root, ['rev-parse', 'HEAD^{tree}']),
  }
}

function snapshot(
  root: string,
  files: Array<{ path: string; mode: 0o644 | 0o755 }>,
): AgentCandidateWorkspaceSnapshotEvidence {
  const material = {
    schemaVersion: 1 as const,
    kind: 'agent-candidate-workspace-manifest' as const,
    files: files
      .map((file) => {
        const bytes = execFileSync('node', [
          '-e',
          `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(root, file.path))}))`,
        ])
        return {
          path: file.path,
          mode: file.mode,
          sha256: embeddedCandidateArtifact(bytes).sha256,
          byteLength: bytes.byteLength,
        }
      })
      .sort((a, b) => a.path.localeCompare(b.path)),
  }
  const manifest = embeddedCandidateArtifact(canonicalCandidateBytes(material))
  return {
    schemaVersion: 1,
    kind: 'agent-candidate-workspace-snapshot',
    digest: manifest.sha256,
    material,
    manifest,
    archive: embeddedCandidateArtifact(Buffer.from(`archive:${manifest.sha256}`)),
  }
}

function bundle(
  execution: Partial<AgentCandidateExecution> = {},
  active?: { commit: string; tree: string; workspace: AgentCandidateWorkspaceSnapshotEvidence },
): AgentCandidateBundle {
  const value = {
    schemaVersion: 1 as const,
    kind: 'agent-candidate-bundle' as const,
    digestAlgorithm: 'rfc8785-sha256' as const,
    profile: {
      name: 'candidate',
      prompt: { instructions: ['Inspect the repository, implement the fix, and run tests.'] },
      model: { default: 'provider/model', reasoningEffort: 'high' as const },
      harness: 'codex' as const,
      resources: { failOnError: true as const },
    },
    code: active
      ? {
          kind: 'no-op' as const,
          reason: 'proposer-no-change' as const,
          repository: { kind: 'github' as const, owner: 'owner', repo: 'repo' },
          baseCommit: active.commit,
          baseTree: active.tree,
        }
      : { kind: 'disabled' as const, reason: 'control' as const },
    execution: {
      harness: 'codex' as const,
      harnessVersion: '1.2.3',
      launch: active
        ? {
            kind: 'candidate-entrypoint' as const,
            entrypoint: 'run.js',
            interpreter: 'node' as const,
          }
        : { kind: 'container-command' as const, executable: 'codex' },
      instructionDelivery: { kind: 'stdin-utf8' as const },
      cwd: { workspace: 'task' as const, path: '.' },
      environment: { kind: 'evaluator-task-container' as const },
      ...(active ? { workspace: active.workspace } : {}),
      isolation: {
        network: 'disabled' as const,
        remoteIntegrations: 'disabled' as const,
        candidateSecrets: 'disabled' as const,
      },
      ...execution,
    },
    memory: { mode: 'disabled' as const },
    lineage: active
      ? {
          source: 'optimizer' as const,
          parentDigests: [sha('e')],
          runIds: ['optimizer-run-1'],
          benchmark: { name: 'development', version: '1', splitDigest: sha('f') },
          spend: {
            proposal: { costUsd: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0 },
            evaluation: { costUsd: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0 },
          },
        }
      : { source: 'human' as const },
  }
  return { ...value, digest: canonicalCandidateDigest(value) }
}

function redigestBundle(
  source: AgentCandidateBundle,
  overrides: Partial<Omit<AgentCandidateBundle, 'digest'>>,
): AgentCandidateBundle {
  const { digest: _digest, ...withoutDigest } = source
  const value = { ...withoutDigest, ...overrides }
  return { ...value, digest: canonicalCandidateDigest(value) }
}

function emptySnapshot(label: string): AgentCandidateWorkspaceSnapshotEvidence {
  const material = {
    schemaVersion: 1 as const,
    kind: 'agent-candidate-workspace-manifest' as const,
    files: [],
  }
  const manifest = embeddedCandidateArtifact(canonicalCandidateBytes(material))
  return {
    schemaVersion: 1,
    kind: 'agent-candidate-workspace-snapshot',
    digest: manifest.sha256,
    material,
    manifest,
    archive: embeddedCandidateArtifact(Buffer.from(`empty:${label}`)),
  }
}

function fixture(active = false): {
  bundle: AgentCandidateBundle
  task: AgentCandidateTaskExecution
  ports: AgentCandidateExecutionPorts
  candidateRoot?: string
} {
  const repository = taskRepository()
  const taskWorkspace = snapshot(repository.root, [{ path: 'source.ts', mode: 0o644 }])
  let candidateRoot: string | undefined
  let candidateWorkspace: AgentCandidateWorkspaceSnapshotEvidence | undefined
  if (active) {
    candidateRoot = temporaryRoot('candidate-built-')
    writeFileSync(join(candidateRoot, 'run.js'), '#!/usr/bin/env node\n')
    chmodSync(join(candidateRoot, 'run.js'), 0o755)
    candidateWorkspace = snapshot(candidateRoot, [{ path: 'run.js', mode: 0o755 }])
  }
  const profileRoot = temporaryRoot('candidate-profile-')
  const selectedContainer: ResolvedAgentCandidateContainer = {
    source: 'evaluator-task-container',
    image: 'ghcr.io/example/task',
    indexDigest: sha('a'),
    manifestDigest: sha('b'),
    platform: { os: 'linux', architecture: 'amd64' },
  }
  const ports: AgentCandidateExecutionPorts = {
    artifacts: {
      read: async () => {
        throw new Error('all fixture artifacts are embedded')
      },
    },
    repositories: { resolve: async () => repository.root },
    workspaces: { materialize: async () => undefined },
    containers: { resolve: async () => selectedContainer },
    models: {
      resolve: async ({ requested, reasoningEffort }) => ({
        requested,
        provider: 'provider',
        model: 'model-snapshot',
        snapshot: 'model-snapshot-2026-07-01',
        reasoningEffort,
      }),
      grant: async () => ({ digest: sha('c'), env: { MODEL_GATEWAY_TOKEN: 'protected' } }),
    },
    memory: {
      reset: async () => {
        throw new Error('disabled memory must not reset')
      },
    },
  }
  const task: AgentCandidateTaskExecution = {
    executionId: 'execution-1',
    benchmark: 'repository-disjoint-smoke',
    benchmarkVersion: '1',
    taskId: 'owner-repo-1',
    splitDigest: sha('d'),
    instruction: 'Fix the failing behavior without changing the public API.',
    repository: {
      identity: 'github.com/owner/repo',
      rootIdentity: 'owner/repo',
      baseCommit: repository.commit,
      baseTree: repository.tree,
    },
    attempt: { number: 1, maxAttempts: 1, retryPolicy: 'none' },
    model: { requested: 'provider/model', reasoningEffort: 'high' },
    executionRoots: {
      taskRoot: '/workspace/task',
      ...(active ? { candidateRoot: '/opt/candidate' } : {}),
    },
    stagingRoots: {
      taskRoot: repository.root,
      ...(candidateRoot ? { candidateRoot } : {}),
      profileRoot,
    },
    workspace: taskWorkspace,
    evaluatorTaskContainer: selectedContainer,
    limits: {
      timeoutMs: 60_000,
      maxSteps: 100,
      maxModelCalls: 50,
      maxInputTokens: 100_000,
      maxOutputTokens: 50_000,
      maxCostUsd: 5,
    },
  }
  return {
    bundle: bundle(
      {},
      active && candidateWorkspace
        ? { commit: repository.commit, tree: repository.tree, workspace: candidateWorkspace }
        : undefined,
    ),
    task,
    ports,
    ...(candidateRoot ? { candidateRoot } : {}),
  }
}

describe('candidate execution preparation', () => {
  it('binds exact instruction, repository, profile, model, image, roots, and limits', async () => {
    const value = fixture()
    value.bundle = bundle({
      instructionDelivery: {
        kind: 'utf8-file',
        env: 'TANGLE_CANDIDATE_TASK_PATH',
        path: '/tangle/input/task.txt',
      },
    })
    const verified = await verifyAgentCandidateBundle(value.bundle, value.ports)
    const prepared = await prepareAgentCandidateExecution(verified, value.task, value.ports)
    const plan = prepared.executionPlan.value.material
    expect(plan.task.instruction).toEqual({
      encoding: 'utf8',
      sha256: embeddedCandidateArtifact(Buffer.from(value.task.instruction)).sha256,
      byteLength: Buffer.byteLength(value.task.instruction),
      delivery: value.bundle.execution.instructionDelivery,
    })
    expect(plan.task.repository).toEqual(value.task.repository)
    expect(plan.profile).toEqual({
      planDigest: prepared.profilePlan.value.digest,
      targetWorkspace: 'task',
      mountPaths: ['AGENTS.md'],
    })
    expect(plan.launch.env.TANGLE_CANDIDATE_TASK_PATH?.value).toBe('/tangle/input/task.txt')
    expect(Buffer.from(prepared.instruction.bytes)).toEqual(Buffer.from(value.task.instruction))
    expect(Buffer.from(prepared.executionPlan.bytes)).toEqual(
      Buffer.from(prepared.executionPlan.value.artifact.content, 'base64'),
    )
    expect(prepared.materializationReceipt.bytes.byteLength).toBeGreaterThan(0)
    expect(JSON.stringify(plan)).not.toContain(value.task.instruction)
    expect(prepared.protectedModelAccess.env).toEqual({ MODEL_GATEWAY_TOKEN: 'protected' })
  })

  it('keeps argv task bytes out of fixed args and exposes deterministic delivery separately', async () => {
    const value = fixture()
    value.bundle = bundle({ instructionDelivery: { kind: 'argv-append' } })
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(value.bundle, value.ports),
      value.task,
      value.ports,
    )
    expect(prepared.launch.args).not.toContain(value.task.instruction)
    expect(prepared.instruction).toMatchObject({ delivery: { kind: 'argv-append' } })
  })

  it('materializes and binds an active candidate entrypoint without task-root overlap', async () => {
    const value = fixture(true)
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(value.bundle, value.ports),
      value.task,
      value.ports,
    )
    expect(prepared.launch).toMatchObject({
      executable: 'node',
      args: ['/opt/candidate/run.js'],
      cwd: '/workspace/task',
    })
    expect(prepared.materializationReceipt.value.entrypoint).toMatchObject({ path: 'run.js' })
    expect(prepared.executionPlan.value.material.candidateWorkspace?.digest).toBe(
      value.bundle.execution.workspace?.digest,
    )
  })

  it('rejects task Git drift, dirty profile staging, and protected env collisions', async () => {
    const gitDrift = fixture()
    gitDrift.task.repository.baseTree = '0'.repeat(40)
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(gitDrift.bundle, gitDrift.ports),
        gitDrift.task,
        gitDrift.ports,
      ),
    ).rejects.toThrow(/base tree/)

    const profileDrift = fixture()
    writeFileSync(join(profileDrift.task.stagingRoots.profileRoot, 'stale'), 'stale')
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(profileDrift.bundle, profileDrift.ports),
        profileDrift.task,
        profileDrift.ports,
      ),
    ).rejects.toThrow(/must be empty/)

    const collision = fixture()
    collision.bundle = bundle({ env: { PUBLIC_ROUTE: { kind: 'public', value: 'public' } } })
    collision.ports.models.grant = async () => ({
      digest: sha('c'),
      env: { PUBLIC_ROUTE: 'protected' },
    })
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(collision.bundle, collision.ports),
        collision.task,
        collision.ports,
      ),
    ).rejects.toThrow(/collides/)
  })

  it('rejects unsigned hidden bytes in an active candidate workspace', async () => {
    const value = fixture(true)
    if (!value.candidateRoot) throw new Error('fixture missing candidate root')
    mkdirSync(join(value.candidateRoot, '.sidecar'))
    writeFileSync(join(value.candidateRoot, '.sidecar', 'hidden.js'), 'malicious')
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/do not match|unsupported mode/)
  })

  it('resets task memory into an execution-scoped namespace and carries verified knowledge', async () => {
    const value = fixture()
    const seedBytes = Buffer.from('seed-memory')
    const knowledgeBytes = Buffer.from('{"documents":[]}')
    const seed = {
      locator: { kind: 's3' as const, bucket: 'test-artifacts', key: 'memory/seed.bin' },
      sha256: embeddedCandidateArtifact(seedBytes).sha256,
      byteLength: seedBytes.byteLength,
    }
    const knowledge = {
      locator: { kind: 's3' as const, bucket: 'test-artifacts', key: 'knowledge/manifest.json' },
      sha256: embeddedCandidateArtifact(knowledgeBytes).sha256,
      byteLength: knowledgeBytes.byteLength,
    }
    value.bundle = redigestBundle(value.bundle, {
      memory: { mode: 'isolated', scope: 'task', seed },
      knowledge: { snapshotId: 'knowledge-1', manifest: knowledge },
    })
    value.ports.artifacts.read = async (ref) => {
      if (ref.sha256 === seed.sha256) return seedBytes
      if (ref.sha256 === knowledge.sha256) return knowledgeBytes
      throw new Error(`unexpected artifact ${ref.sha256}`)
    }
    let resetInput: Parameters<AgentCandidateExecutionPorts['memory']['reset']>[0] | undefined
    value.ports.memory.reset = async (input) => {
      resetInput = input
      return {
        evidence: embeddedCandidateArtifact(Buffer.from('fresh-reset')),
        emptyStateDigest: sha('7'),
        beforeState: emptySnapshot('before'),
        env: { TANGLE_MEMORY_NAMESPACE: input.effectiveNamespace },
      }
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(value.bundle, value.ports),
      value.task,
      value.ports,
    )
    expect(Buffer.from(resetInput?.seed ?? [])).toEqual(seedBytes)
    expect(resetInput?.effectiveNamespace).toContain('execution-1')
    expect(prepared.memory).toMatchObject({
      mode: 'isolated',
      seedDigest: seed.sha256,
    })
    expect(prepared.protectedMemoryAccess).toEqual({
      TANGLE_MEMORY_NAMESPACE: resetInput?.effectiveNamespace,
    })
    expect(prepared.knowledge).toMatchObject({
      snapshotId: 'knowledge-1',
      manifestDigest: knowledge.sha256,
    })
    expect(Buffer.from(prepared.knowledge?.manifest ?? [])).toEqual(knowledgeBytes)
  })
})
