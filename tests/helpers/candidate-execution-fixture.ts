import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  sealCandidateBenchmarkSuite,
  sealCandidateBenchmarkTask,
} from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateArtifactRef,
  AgentCandidateBenchmarkTask,
  AgentCandidateBundle,
  AgentCandidateExecution,
  AgentCandidateWorkspaceSnapshotEvidence,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  embeddedCandidateArtifact,
  sha256Bytes,
} from '../../src/candidate-execution/digest'
import type {
  AgentCandidateBenchmarkGraderPort,
  AgentCandidateExecutionPorts,
  AgentCandidateExecutorTaskOutcomeCapture,
  AgentCandidateOutputArtifactPort,
  AgentCandidateTaskExecution,
  ResolvedAgentCandidateContainer,
} from '../../src/candidate-execution/types'

const roots: string[] = []

export const candidateSha = (character: string): Sha256Digest => `sha256:${character.repeat(64)}`

const fixtureGraderBytes = Buffer.from('fixture executable grader', 'utf8')

export function cleanupCandidateFixtures(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

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
  files: Array<{ path: string; mode: number }>,
): AgentCandidateWorkspaceSnapshotEvidence {
  const material = {
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
    kind: 'agent-candidate-workspace-snapshot',
    digest: manifest.sha256,
    material,
    manifest,
    archive: embeddedCandidateArtifact(Buffer.from(`archive:${manifest.sha256}`)),
  }
}

export function candidateBundle(
  execution: Partial<AgentCandidateExecution> = {},
  active?: {
    commit: string
    tree: string
    workspace: AgentCandidateWorkspaceSnapshotEvidence
  },
): AgentCandidateBundle {
  const value = {
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
      : { kind: 'disabled' as const },
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
      env: { PATH: { kind: 'public' as const, value: '/usr/local/bin:/usr/bin:/bin' } },
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
  }
  return { ...value, digest: canonicalCandidateDigest(value) }
}

export function redigestCandidateBundle(
  source: AgentCandidateBundle,
  overrides: Partial<Omit<AgentCandidateBundle, 'digest'>>,
): AgentCandidateBundle {
  const { digest: _digest, ...withoutDigest } = source
  const value = { ...withoutDigest, ...overrides }
  return { ...value, digest: canonicalCandidateDigest(value) }
}

export function bindCandidateFixtureBundle(
  fixture: CandidateExecutionFixture,
  bundle: AgentCandidateBundle = fixture.bundle,
): void {
  const { digest: _digest, ...cell } = fixture.task.runCell
  fixture.bundle = bundle
  fixture.task = {
    ...fixture.task,
    runCell: canonicalCandidateDocument({ ...cell, bundleDigest: bundle.digest }).value,
  }
}

export function replaceCandidateFixtureTask(
  fixture: CandidateExecutionFixture,
  overrides: Partial<Omit<AgentCandidateBenchmarkTask, 'digest'>>,
): void {
  const material = { ...omitTaskDigest(fixture.task.task), ...overrides }
  const task = sealCandidateBenchmarkTask(material)
  const benchmark = sealCandidateBenchmarkSuite({
    tasks: [task],
    reps: fixture.task.benchmarkSuite.reps,
    seeds: fixture.task.benchmarkSuite.seeds,
  })
  const { digest: _digest, ...cell } = fixture.task.runCell
  fixture.task = {
    ...fixture.task,
    task,
    benchmarkSuite: benchmark.suite,
    runCell: canonicalCandidateDocument({
      ...cell,
      suiteDigest: benchmark.suite.digest,
      taskDigest: task.digest,
    }).value,
  }
}

export function replaceCandidateFixtureAttempt(
  fixture: CandidateExecutionFixture,
  attempt: {
    number: number
    maxAttempts: number
    retryPolicy: 'none' | 'pre-model-infrastructure-only'
  },
): void {
  replaceCandidateFixtureTask(fixture, {
    attempt: {
      maxAttempts: attempt.maxAttempts,
      retryPolicy: attempt.retryPolicy,
    },
  })
  const { digest: _digest, ...cell } = fixture.task.runCell
  fixture.task = {
    ...fixture.task,
    runCell: canonicalCandidateDocument({ ...cell, attempt: attempt.number }).value,
  }
}

export function emptyCandidateSnapshot(label: string): AgentCandidateWorkspaceSnapshotEvidence {
  const material = {
    kind: 'agent-candidate-workspace-manifest' as const,
    files: [],
  }
  const manifest = embeddedCandidateArtifact(canonicalCandidateBytes(material))
  return {
    kind: 'agent-candidate-workspace-snapshot',
    digest: manifest.sha256,
    material,
    manifest,
    archive: embeddedCandidateArtifact(Buffer.from(`empty:${label}`)),
  }
}

export interface CandidateExecutionFixture {
  bundle: AgentCandidateBundle
  task: AgentCandidateTaskExecution
  ports: AgentCandidateExecutionPorts
  candidateRoot?: string
}

export function unchangedTaskOutcomeCapture(
  fixture: CandidateExecutionFixture,
): AgentCandidateExecutorTaskOutcomeCapture {
  if (fixture.task.task.outcome.kind !== 'workspace') {
    throw new Error('unchanged workspace capture requires a workspace outcome')
  }
  if (!fixture.task.task.repository) {
    throw new Error('workspace task is missing repository identity')
  }
  return {
    kind: 'workspace',
    resultTree: fixture.task.task.repository.baseTree,
    afterState: fixture.task.task.workspace.material,
    archive: Buffer.from(`task-archive:${fixture.task.task.workspace.digest}`, 'utf8'),
    gitDiff: Buffer.alloc(0),
  }
}

export function createCandidateOutputFixture(): {
  outputArtifacts: AgentCandidateOutputArtifactPort
  grader: AgentCandidateBenchmarkGraderPort
} {
  const stored = new Map<string, Uint8Array>()
  const put = (bytes: Uint8Array, purpose: string): AgentCandidateArtifactRef => {
    const detached = Uint8Array.from(bytes)
    const sha256 = sha256Bytes(detached)
    const ref: AgentCandidateArtifactRef = {
      locator: {
        kind: 's3',
        bucket: 'candidate-test-artifacts',
        key: `${purpose}/${sha256.slice('sha256:'.length)}`,
      },
      sha256,
      byteLength: detached.byteLength,
    }
    stored.set(sha256, detached)
    return ref
  }
  const graderArtifact = put(fixtureGraderBytes, 'grader')
  return {
    outputArtifacts: {
      put: async ({ bytes, purpose }) => put(bytes, purpose),
      read: async (ref) => {
        const bytes = stored.get(ref.sha256)
        if (!bytes) throw new Error(`missing candidate test artifact ${ref.sha256}`)
        return Uint8Array.from(bytes)
      },
    },
    grader: {
      name: 'fixture-executable-grader',
      version: '1.0.0',
      artifact: graderArtifact,
      run: async ({ implementation, outcome }) => {
        const evidence = Buffer.from('{"reward":1}\n', 'utf8')
        return {
          evaluation: { score: 1, passed: true, dimensions: { tests: 1 }, raw: {} },
          evidence,
          binding: {
            implementationDigest: sha256Bytes(implementation.bytes),
            taskOutcomeDigest: outcome.evidence.digest,
            outputDigest: sha256Bytes(evidence),
          },
        }
      },
    },
  }
}

export function createCandidateExecutionFixture(active = false): CandidateExecutionFixture {
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
    indexDigest: candidateSha('a'),
    manifestDigest: candidateSha('b'),
    platform: { os: 'linux', architecture: 'amd64' },
  }
  const ports: AgentCandidateExecutionPorts = {
    artifacts: {
      read: async () => {
        throw new Error('all fixture artifacts are embedded')
      },
    },
    repositories: { resolve: async () => repository.root },
    workspaces: {
      materialize: async ({ role, snapshot: workspace, destination }) => {
        if (role === 'memory') {
          if (workspace.material.files.length !== 0) {
            throw new Error('fixture memory materializer supports only an empty state')
          }
          return
        }
        if (role === 'knowledge' && workspace.material.files.length === 0) return
        const source = role === 'task' ? repository.root : candidateRoot
        if (!source) throw new Error(`fixture ${role} workspace source is missing`)
        if (source === destination) return
        for (const file of workspace.material.files) {
          const output = join(destination, file.path)
          mkdirSync(dirname(output), { recursive: true })
          writeFileSync(output, readFileSync(join(source, file.path)))
          chmodSync(output, file.mode)
        }
      },
    },
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
        digest: candidateSha('c'),
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
        grantDigest: candidateSha('c'),
        closed: true,
        usageWithinLimits: true,
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
  const bundle = candidateBundle(
    {},
    active && candidateWorkspace
      ? { commit: repository.commit, tree: repository.tree, workspace: candidateWorkspace }
      : undefined,
  )
  const benchmarkTask = sealCandidateBenchmarkTask({
    kind: 'agent-candidate-benchmark-task',
    digestAlgorithm: 'rfc8785-sha256',
    benchmark: {
      name: 'repository-disjoint-smoke',
      version: '1',
      splitDigest: candidateSha('d'),
    },
    scenario: {
      id: 'owner-repo-1',
      kind: 'coding',
      scenarioDigest: candidateSha('8'),
    },
    instruction: 'Fix the failing behavior without changing the public API.',
    repository: {
      identity: 'github.com/owner/repo',
      rootIdentity: 'owner/repo',
      baseCommit: repository.commit,
      baseTree: repository.tree,
    },
    outcome: { kind: 'workspace' },
    attempt: { maxAttempts: 1, retryPolicy: 'none' },
    model: {
      requested: 'provider/model',
      provider: 'provider',
      model: 'model-snapshot',
      snapshot: 'model-snapshot-2026-07-01',
      reasoningEffort: 'high',
    },
    grader: {
      name: 'fixture-executable-grader',
      version: '1.0.0',
      format: 'tangle-grader',
      artifact: {
        locator: {
          kind: 's3',
          bucket: 'candidate-test-artifacts',
          key: `grader/${sha256Bytes(fixtureGraderBytes).slice('sha256:'.length)}`,
        },
        sha256: sha256Bytes(fixtureGraderBytes),
        byteLength: fixtureGraderBytes.byteLength,
      },
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
  })
  const benchmark = sealCandidateBenchmarkSuite({
    tasks: [benchmarkTask],
    reps: 1,
    seeds: [42],
  })
  const task: AgentCandidateTaskExecution = {
    executionId: 'execution-1',
    runCell: canonicalCandidateDocument({
      kind: 'agent-candidate-run-cell' as const,
      experimentDigest: candidateSha('9'),
      arm: 'candidate' as const,
      bundleDigest: bundle.digest,
      suiteDigest: benchmark.suite.digest,
      taskDigest: benchmarkTask.digest,
      taskIndex: 0,
      repetition: 0,
      seed: 42,
      attempt: 1,
    }).value,
    benchmarkSuite: benchmark.suite,
    task: benchmarkTask,
    executionRoots: {
      taskRoot: '/workspace/task',
      ...(active ? { candidateRoot: '/opt/candidate' } : {}),
    },
    stagingRoots: {
      taskRoot: repository.root,
      ...(candidateRoot ? { candidateRoot } : {}),
      profileRoot,
    },
  }
  return {
    bundle,
    task,
    ports,
    ...(candidateRoot ? { candidateRoot } : {}),
  }
}

export function createCandidateOutputExecutionFixture(
  mediaType = 'application/json',
  maxBytes = 1_048_576,
  withRepository = false,
): CandidateExecutionFixture {
  const fixture = createCandidateExecutionFixture()
  if (withRepository) {
    return withBenchmarkTask(fixture, {
      ...omitTaskDigest(fixture.task.task),
      outcome: { kind: 'output', mediaType, maxBytes },
    })
  }
  const taskRoot = temporaryRoot('candidate-output-task-')
  const { repository: _repository, ...taskWithoutRepository } = omitTaskDigest(fixture.task.task)
  return withBenchmarkTask(
    {
      ...fixture,
      task: {
        ...fixture.task,
        stagingRoots: { ...fixture.task.stagingRoots, taskRoot },
      },
    },
    {
      ...taskWithoutRepository,
      outcome: { kind: 'output', mediaType, maxBytes },
      workspace: emptyCandidateSnapshot('output-task'),
    },
  )
}

function omitTaskDigest(
  task: AgentCandidateBenchmarkTask,
): Omit<AgentCandidateBenchmarkTask, 'digest'> {
  const { digest: _digest, ...material } = task
  return material
}

function withBenchmarkTask(
  fixture: CandidateExecutionFixture,
  material: Omit<AgentCandidateBenchmarkTask, 'digest'>,
): CandidateExecutionFixture {
  const task = sealCandidateBenchmarkTask(material)
  const benchmark = sealCandidateBenchmarkSuite({
    tasks: [task],
    reps: fixture.task.benchmarkSuite.reps,
    seeds: fixture.task.benchmarkSuite.seeds,
  })
  const { digest: _cellDigest, ...cell } = fixture.task.runCell
  const runCell = canonicalCandidateDocument({
    ...cell,
    suiteDigest: benchmark.suite.digest,
    taskDigest: task.digest,
  }).value
  return {
    ...fixture,
    task: {
      ...fixture.task,
      runCell,
      benchmarkSuite: benchmark.suite,
      task,
    },
  }
}
