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
import { MAX_CANDIDATE_TIMER_INTERVAL_MS } from '../src/candidate-execution/cleanup'
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
      reserveGrant: async ({ preparationId, expiresAtMs, limits }) => ({
        preparationId,
        digest: sha('c'),
        expiresAtMs,
        enforcedLimits: limits,
        network:
          limits.maxModelCalls === 0
            ? { mode: 'disabled' as const }
            : { mode: 'gateway-only' as const, domains: ['router.tangle.tools'] },
      }),
      activateGrant: async () => ({ env: { MODEL_GATEWAY_TOKEN: 'protected' } }),
      settleGrant: async ({ preparationId }) => ({
        preparationId,
        grantDigest: sha('c'),
        closed: true,
        calls: [],
      }),
    },
    memory: {
      reset: async () => {
        throw new Error('disabled memory must not reset')
      },
      activate: async () => {
        throw new Error('disabled memory must not activate')
      },
      close: async () => {
        throw new Error('disabled memory must not close')
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
    grader: {
      name: 'fixture-executable-grader',
      version: '1.0.0',
      artifact: {
        locator: { kind: 's3', bucket: 'candidate-test-artifacts', key: 'grader/fixture' },
        sha256: sha('a'),
        byteLength: 1,
      },
    },
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
    expect(JSON.stringify(prepared)).not.toContain('MODEL_GATEWAY_TOKEN')
    expect(JSON.stringify(prepared)).not.toContain('protected')
    expect(plan.model.access.network).toEqual({
      mode: 'gateway-only',
      domains: ['router.tangle.tools'],
    })
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

  it.each([
    { field: 'tools', profileValue: { shell: false } },
    { field: 'permissions', profileValue: { shell: 'deny' } },
    { field: 'modes', profileValue: { review: { model: 'provider/model' } } },
    { field: 'confidential', profileValue: { tee: 'tdx', sealed: true } },
  ] as const)('rejects non-empty $field before staging or reserving protected access', async ({
    field,
    profileValue,
  }) => {
    const value = fixture()
    value.bundle = redigestBundle(value.bundle, {
      profile: {
        ...value.bundle.profile,
        [field]: profileValue,
      } as AgentCandidateBundle['profile'],
    })
    const verified = await verifyAgentCandidateBundle(value.bundle, value.ports)
    let stagingCalls = 0
    let reservationCalls = 0
    value.ports.workspaces.materialize = async () => {
      stagingCalls++
    }
    value.ports.models.reserveGrant = async () => {
      reservationCalls++
      throw new Error('candidate must fail before reserving protected access')
    }

    await expect(prepareAgentCandidateExecution(verified, value.task, value.ports)).rejects.toThrow(
      new RegExp(`non-empty AgentProfile fields: ${field}`),
    )
    expect(stagingCalls).toBe(0)
    expect(reservationCalls).toBe(0)
  })

  it('accepts explicit empty unsupported fields', async () => {
    const value = fixture()
    value.bundle = redigestBundle(value.bundle, {
      profile: {
        ...value.bundle.profile,
        tools: {},
        permissions: {},
        modes: {},
        confidential: {},
      },
    })

    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(value.bundle, value.ports),
      value.task,
      value.ports,
    )
    expect(prepared.bundle.digest).toBe(value.bundle.digest)
  })

  it('rejects task Git drift, dirty profile staging, and unenforced model limits', async () => {
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

    const unenforced = fixture()
    let settledReservations = 0
    unenforced.ports.models.reserveGrant = async ({ preparationId, expiresAtMs, limits }) => ({
      preparationId,
      digest: sha('c'),
      expiresAtMs,
      enforcedLimits: { ...limits, maxCostUsd: limits.maxCostUsd + 1 },
      network: { mode: 'gateway-only', domains: ['router.tangle.tools'] },
    })
    unenforced.ports.models.settleGrant = async ({ preparationId }) => {
      settledReservations++
      return { preparationId, grantDigest: sha('c'), closed: true, calls: [] }
    }
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(unenforced.bundle, unenforced.ports),
        unenforced.task,
        unenforced.ports,
      ),
    ).rejects.toThrow(/does not enforce/)
    expect(settledReservations).toBe(1)
  })

  it('requires a frozen model gateway only when model calls are allowed', async () => {
    const invalid = fixture()
    let settledReservations = 0
    invalid.ports.models.reserveGrant = async ({ preparationId, expiresAtMs, limits }) => ({
      preparationId,
      digest: sha('c'),
      expiresAtMs,
      enforcedLimits: limits,
      network: { mode: 'disabled' },
    })
    invalid.ports.models.settleGrant = async ({ preparationId }) => {
      settledReservations++
      return { preparationId, grantDigest: sha('c'), closed: true, calls: [] }
    }
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(invalid.bundle, invalid.ports),
        invalid.task,
        invalid.ports,
      ),
    ).rejects.toThrow(/wrong network policy/)
    expect(settledReservations).toBe(1)

    const zeroCall = fixture()
    zeroCall.task.limits = {
      ...zeroCall.task.limits,
      maxModelCalls: 0,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxCostUsd: 0,
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(zeroCall.bundle, zeroCall.ports),
      zeroCall.task,
      zeroCall.ports,
    )
    expect(prepared.executionPlan.value.material.model.access.network).toEqual({
      mode: 'disabled',
    })
  })

  it('bounds failed-preparation cleanup and rejects another preparation settlement', async () => {
    const hanging = fixture()
    hanging.ports.models.reserveGrant = async ({ preparationId, expiresAtMs, limits }) => ({
      preparationId,
      digest: sha('c'),
      expiresAtMs,
      enforcedLimits: { ...limits, maxModelCalls: limits.maxModelCalls + 1 },
      network: { mode: 'gateway-only', domains: ['router.tangle.tools'] },
    })
    hanging.ports.models.settleGrant = async () => await new Promise<never>(() => undefined)
    const startedAt = Date.now()
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(hanging.bundle, hanging.ports),
        hanging.task,
        hanging.ports,
        { cleanupTimeoutMs: 20 },
      ),
    ).rejects.toThrow(/cleanup failed/)
    expect(Date.now() - startedAt).toBeLessThan(250)

    const mismatched = fixture()
    mismatched.ports.models.reserveGrant = async ({ preparationId, expiresAtMs, limits }) => ({
      preparationId,
      digest: sha('c'),
      expiresAtMs,
      enforcedLimits: { ...limits, maxModelCalls: limits.maxModelCalls + 1 },
      network: { mode: 'gateway-only', domains: ['router.tangle.tools'] },
    })
    mismatched.ports.models.settleGrant = async () => ({
      preparationId: `candidate-preparation-v1.${'A'.repeat(43)}`,
      grantDigest: sha('c'),
      closed: true,
      calls: [],
    })
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(mismatched.bundle, mismatched.ports),
        mismatched.task,
        mismatched.ports,
      ),
    ).rejects.toThrow(/cleanup failed/)
  })

  it('rejects a cost limit that cannot be represented by the protected integer ledger', async () => {
    const value = fixture()
    value.task.limits = { ...value.task.limits, maxCostUsd: 10 ** 20 }
    let reservations = 0
    value.ports.models.reserveGrant = async () => {
      reservations++
      throw new Error('must not reserve')
    }
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/fixed-point range/)
    expect(reservations).toBe(0)
  })

  it('rejects a wall-time limit that Node would clamp to an immediate timer', async () => {
    const value = fixture()
    value.task.limits = {
      ...value.task.limits,
      timeoutMs: MAX_CANDIDATE_TIMER_INTERVAL_MS + 1,
    }
    let reservations = 0
    value.ports.models.reserveGrant = async () => {
      reservations++
      throw new Error('must not reserve')
    }
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/limits are invalid/)
    expect(reservations).toBe(0)
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
    value.task.executionId = '..'
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
        preparationId: input.preparationId,
        accessDigest: sha('8'),
        expiresAtMs: input.expiresAtMs,
        evidence: embeddedCandidateArtifact(Buffer.from('fresh-reset')),
        emptyStateDigest: sha('7'),
        beforeState: emptySnapshot('before'),
      }
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(value.bundle, value.ports),
      value.task,
      value.ports,
    )
    expect(Buffer.from(resetInput?.seed ?? [])).toEqual(seedBytes)
    expect(resetInput?.effectiveNamespace).not.toContain('..')
    expect(resetInput?.effectiveNamespace.split('/')).toHaveLength(5)
    expect(prepared.memory).toMatchObject({
      mode: 'isolated',
      seedDigest: seed.sha256,
    })
    expect(JSON.stringify(prepared)).not.toContain('TANGLE_MEMORY_NAMESPACE')
    expect(prepared.knowledge).toMatchObject({
      snapshotId: 'knowledge-1',
      manifestDigest: knowledge.sha256,
    })
    expect(Buffer.from(prepared.knowledge?.manifest ?? [])).toEqual(knowledgeBytes)
  })

  it('closes memory immediately when reset evidence fails before preparation can retain it', async () => {
    const value = fixture()
    value.bundle = redigestBundle(value.bundle, {
      memory: { mode: 'isolated', scope: 'task' },
    })
    const before = emptySnapshot('malformed-reset')
    const closed: string[] = []
    value.ports.memory.reset = async ({ preparationId, expiresAtMs }) => ({
      preparationId,
      accessDigest: 'sha256:not-a-digest' as `sha256:${string}`,
      expiresAtMs,
      evidence: before.manifest,
      emptyStateDigest: before.digest,
      beforeState: before,
    })
    value.ports.memory.close = async ({ preparationId, reason }) => {
      closed.push(`${preparationId}:${reason}`)
      return { closed: true }
    }
    await expect(
      prepareAgentCandidateExecution(
        await verifyAgentCandidateBundle(value.bundle, value.ports),
        value.task,
        value.ports,
      ),
    ).rejects.toThrow(/not scoped/)
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatch(/candidate-preparation-v1\..+:preparation-failed/)
  })
})
