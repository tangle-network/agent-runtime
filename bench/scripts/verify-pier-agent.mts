import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalJson, InMemoryTraceStore } from '@tangle-network/agent-eval'
import {
  sealCandidateBenchmarkSuite,
  sealCandidateBenchmarkTask,
} from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateArtifactRef,
  AgentCandidateBundle,
  AgentCandidateWorkspaceSnapshotEvidence,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  createAgentCandidateWorkspacePort,
  disposePreparedAgentCandidateExecution,
  FileAgentCandidateExecutionClaimStore,
  prepareAgentCandidateExecution,
  type AgentCandidateExecutionPorts,
  type AgentCandidateOutputArtifactPort,
  type AgentCandidateTaskExecution,
  type ResolvedAgentCandidateContainer,
  sealAgentCandidateBundle,
  verifyAgentCandidateBundle,
} from '@tangle-network/agent-runtime'

import { executePreparedPierCandidate } from '../src/pier-agent'
import { createPierResultGrader } from '../src/pier-result-grader'
import { FilePierCandidateTrialController } from '../src/pier-trial-controller'

const pinnedPierCommit = 'e69a20e4e0ac073ec71fde0274bab3d9f40bac87'
const pinnedPierVersion = '0.3.0'
const modelRequest = 'openai/gpt-5.4'
const fixtureImage = 'ghcr.io/tangle-network/devcontainers/universal:latest'
const prepareOnly = process.env.PIER_PREPARE_ONLY === '1'
const proofArm = process.env.PIER_PROOF_ARM
if (proofArm !== 'failure' && proofArm !== 'success') {
  throw new Error('PIER_PROOF_ARM must be explicitly set to failure or success')
}
const expectedReward = proofArm === 'success' ? 1 : 0
const expectedPatchApplied = proofArm === 'success' ? 1 : 0
const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pierRepo = path.resolve(process.env.PIER_REPO ?? path.join(benchDir, '..', '..', 'pier'))
const fixtureSource = path.join(benchDir, 'fixtures', 'pier-agent', 'no-model-task')
const scratch = mkdtempSync(path.join(tmpdir(), 'agent-bench-pier-runtime-'))
const taskDir = path.join(scratch, 'task')
const taskRoot = path.join(scratch, 'task-workspace')
const candidateRoot = path.join(scratch, 'candidate-workspace')
const profileRoot = path.join(scratch, 'profile-workspace')
const jobsDir = path.join(scratch, 'jobs')

function output(
  command: string,
  args: string[],
  cwd = benchDir,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10 * 60_000,
    maxBuffer: 20 * 1024 * 1024,
  }).trim()
}

function sha256(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), 'utf8')
}

function sealCanonical<T extends object>(material: T): T & { digest: Sha256Digest } {
  return { ...material, digest: sha256(canonicalBytes(material)) }
}

function embedded(bytes: Uint8Array) {
  return {
    encoding: 'base64' as const,
    content: Buffer.from(bytes).toString('base64'),
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
  }
}

function workspaceSnapshot(
  root: string,
  paths: readonly string[],
): AgentCandidateWorkspaceSnapshotEvidence {
  const files = paths
    .map((relative) => {
      const absolute = path.join(root, relative)
      const bytes = readFileSync(absolute)
      const mode = lstatSync(absolute).mode & 0o777
      if (mode !== 0o644 && mode !== 0o755) {
        throw new Error(`unsupported fixture mode ${mode.toString(8)}: ${relative}`)
      }
      return {
        path: relative,
        mode: mode as 0o644 | 0o755,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  const material = {
    kind: 'agent-candidate-workspace-manifest' as const,
    files,
  } satisfies AgentCandidateWorkspaceSnapshotEvidence['material']
  const manifest = canonicalBytes(material)
  return {
    kind: 'agent-candidate-workspace-snapshot',
    digest: sha256(manifest),
    material,
    manifest: embedded(manifest),
    archive: embedded(Buffer.from(`pre-materialized:${sha256(manifest)}`, 'utf8')),
  }
}

function deterministicRepository(root: string, seed: string): { commit: string; tree: string } {
  mkdirSync(path.join(root, 'src'), { recursive: true })
  cpSync(seed, path.join(root, 'src', 'status.txt'))
  chmodSync(path.join(root, 'src', 'status.txt'), 0o644)
  output('git', ['init', '-b', 'main', root])
  output('git', ['-C', root, 'config', 'user.email', 'fixture@tangle.tools'])
  output('git', ['-C', root, 'config', 'user.name', 'Tangle Fixture'])
  output('git', [
    '-C',
    root,
    'remote',
    'add',
    'origin',
    'git@github.com:tangle-network/agent-bench-pier-fixture.git',
  ])
  output('git', ['-c', 'core.hooksPath=/dev/null', '-C', root, 'add', '-A'])
  output(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-C', root, 'commit', '-m', 'baseline'],
    benchDir,
    {
      ...process.env,
      GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
    },
  )
  return {
    commit: output('git', ['-C', root, 'rev-parse', 'HEAD']),
    tree: output('git', ['-C', root, 'rev-parse', 'HEAD^{tree}']),
  }
}

function publicOciIdentity(
  image: string,
): { indexDigest: Sha256Digest; manifestDigest: Sha256Digest } {
  const material = JSON.parse(
    output('docker', ['buildx', 'imagetools', 'inspect', image, '--format', '{{json .Manifest}}']),
  ) as {
    digest?: string
    manifests?: Array<{
      digest?: string
      platform?: { os?: string; architecture?: string }
    }>
  }
  const topDigest = material.digest
  if (!topDigest?.match(/^sha256:[a-f0-9]{64}$/)) {
    throw new Error(`public image omitted a valid index digest: ${topDigest}`)
  }
  const selected = material.manifests?.find(
    (entry) => entry.platform?.os === 'linux' && entry.platform.architecture === 'amd64',
  )
  const manifestDigest = selected?.digest
  if (!manifestDigest) throw new Error('public image has no linux/amd64 manifest')
  if (!manifestDigest.match(/^sha256:[a-f0-9]{64}$/)) {
    throw new Error(`public image returned an invalid platform manifest: ${manifestDigest}`)
  }
  return {
    indexDigest: topDigest as Sha256Digest,
    manifestDigest: manifestDigest as Sha256Digest,
  }
}

function findTrialResult(root: string): { path: string; value: Record<string, any> } | undefined {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const child = path.join(root, entry.name)
    const candidate = path.join(child, 'result.json')
    try {
      const value = JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, any>
      if (typeof value.trial_name === 'string') return { path: candidate, value }
    } catch {}
    const nested = findTrialResult(child)
    if (nested) return nested
  }
  return undefined
}

function assertTreeOmits(root: string, forbidden: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) {
      assertTreeOmits(absolute, forbidden)
    } else if (entry.isFile() && readFileSync(absolute).includes(Buffer.from(forbidden))) {
      throw new Error(`protected value persisted in ${path.relative(root, absolute)}`)
    }
  }
}

function outputArtifactStore(graderBytes: Uint8Array): {
  outputArtifacts: AgentCandidateOutputArtifactPort
  graderArtifact: AgentCandidateArtifactRef
} {
  const stored = new Map<string, Uint8Array>()
  const put = (bytes: Uint8Array, purpose: string): AgentCandidateArtifactRef => {
    const detached = Uint8Array.from(bytes)
    const digest = sha256(detached)
    const artifact: AgentCandidateArtifactRef = {
      locator: {
        kind: 's3',
        bucket: 'agent-bench-pier-proof',
        key: `${purpose}/${digest.slice('sha256:'.length)}`,
      },
      sha256: digest,
      byteLength: detached.byteLength,
    }
    stored.set(digest, detached)
    return artifact
  }
  const graderArtifact = put(graderBytes, 'graders')
  return {
    graderArtifact,
    outputArtifacts: {
      put: async ({ bytes, purpose, signal }) => {
        signal?.throwIfAborted()
        return put(bytes, purpose)
      },
      read: async (artifact) => {
        const bytes = stored.get(artifact.sha256)
        if (!bytes) throw new Error(`missing Pier proof artifact ${artifact.sha256}`)
        return Uint8Array.from(bytes)
      },
    },
  }
}

try {
  if (!prepareOnly) {
    const pierHead = output('git', ['rev-parse', 'HEAD'], pierRepo)
    if (pierHead !== pinnedPierCommit) {
      throw new Error(`Pier checkout mismatch: expected ${pinnedPierCommit}, got ${pierHead}`)
    }
    const pierStatus = output('git', ['status', '--porcelain'], pierRepo)
    if (pierStatus !== '') throw new Error(`Pier checkout must be clean: ${pierStatus}`)
    const pierVersion = output('uv', ['run', 'pier', '--version'], pierRepo)
    if (pierVersion !== pinnedPierVersion) {
      throw new Error(`Pier version mismatch: expected ${pinnedPierVersion}, got ${pierVersion}`)
    }
  }

  cpSync(fixtureSource, taskDir, { recursive: true })
  for (const relative of ['environment/seed/src/status.txt', 'tests/seed/src/status.txt']) {
    chmodSync(path.join(taskDir, relative), 0o644)
  }
  for (const relative of ['pre_artifacts.sh', 'tests/test.sh']) {
    chmodSync(path.join(taskDir, relative), 0o755)
  }

  const contextDigest = sha256(
    Buffer.concat([
      readFileSync(path.join(taskDir, 'environment', 'Dockerfile')),
      readFileSync(path.join(taskDir, 'environment', 'seed', 'src', 'status.txt')),
    ]),
  ).slice(7, 23)
  const identity = prepareOnly
    ? {
        indexDigest: `sha256:${'1'.repeat(64)}` as Sha256Digest,
        manifestDigest: `sha256:${'2'.repeat(64)}` as Sha256Digest,
      }
    : publicOciIdentity(fixtureImage)
  const pinnedImage = `${fixtureImage}@${identity.indexDigest}`
  if (!prepareOnly) output('docker', ['pull', '--platform', 'linux/amd64', pinnedImage])
  const platform = prepareOnly
    ? 'linux/amd64'
    : output('docker', [
        'image',
        'inspect',
        '--format',
        '{{.Os}}/{{.Architecture}}',
        pinnedImage,
      ])
  if (platform !== 'linux/amd64') throw new Error(`fixture image platform drifted: ${platform}`)

  const configPath = path.join(taskDir, 'task.toml')
  const config = readFileSync(configPath, 'utf8')
  writeFileSync(
    configPath,
    config.replace(
      '[environment]\n',
      `[environment]\ndocker_image = "${pinnedImage}"\nos = "linux"\n`,
    ),
  )
  mkdirSync(candidateRoot)
  mkdirSync(profileRoot)
  const instruction = readFileSync(path.join(taskDir, 'instruction.md'), 'utf8')
  const runner = `import pathlib, sys
task = pathlib.Path.cwd()
profile = task / 'AGENTS.md'
assert profile.is_file() and profile.read_text().strip()
assert sys.argv[-1] == ${JSON.stringify(instruction)}
${proofArm === 'success' ? "(task / 'src/status.txt').write_text('ready\\nowner=tangle\\n')" : ''}
`
  writeFileSync(path.join(candidateRoot, 'runner.py'), runner)
  chmodSync(path.join(candidateRoot, 'runner.py'), 0o755)
  const repositoryState = deterministicRepository(
    taskRoot,
    path.join(taskDir, 'environment', 'seed', 'src', 'status.txt'),
  )

  const taskWorkspace = workspaceSnapshot(taskRoot, ['src/status.txt'])
  const candidateWorkspace = workspaceSnapshot(candidateRoot, ['runner.py'])
  const bundleWithoutDigest = {
    kind: 'agent-candidate-bundle' as const,
    digestAlgorithm: 'rfc8785-sha256' as const,
    profile: {
      name: `pier-no-model-runtime-${proofArm}`,
      prompt: {
        instructions: [
          'Edit only the task repository. Follow the exact user instruction and verify the result.',
        ],
      },
      model: { default: modelRequest, reasoningEffort: 'xhigh' as const },
      harness: 'codex' as const,
      resources: { failOnError: true as const },
    },
    code: {
      kind: 'no-op' as const,
      reason: 'proposer-no-change' as const,
      repository: {
        kind: 'github' as const,
        owner: 'tangle-network',
        repo: 'agent-bench-pier-fixture',
      },
      baseCommit: repositoryState.commit,
      baseTree: repositoryState.tree,
    },
    execution: {
      harness: 'codex' as const,
      harnessVersion: 'agent-bench-pier/2.0.0',
      launch: {
        kind: 'candidate-entrypoint' as const,
        entrypoint: 'runner.py',
        interpreter: 'python3' as const,
      },
      instructionDelivery: { kind: 'argv-append' as const },
      cwd: { workspace: 'task' as const, path: '.' },
      env: { PATH: { kind: 'public' as const, value: '/usr/local/bin:/usr/bin:/bin' } },
      environment: { kind: 'evaluator-task-container' as const },
      workspace: candidateWorkspace,
      isolation: {
        network: 'disabled' as const,
        remoteIntegrations: 'disabled' as const,
        candidateSecrets: 'disabled' as const,
      },
    },
    memory: { mode: 'disabled' as const },
  }
  const bundle: AgentCandidateBundle = sealAgentCandidateBundle(bundleWithoutDigest)
  const container: ResolvedAgentCandidateContainer = {
    source: 'evaluator-task-container',
    image: fixtureImage,
    indexDigest: identity.indexDigest,
    manifestDigest: identity.manifestDigest,
    platform: { os: 'linux', architecture: 'amd64' },
  }
  const graderBytes = readFileSync(new URL('../src/pier-result-grader.mjs', import.meta.url))
  const { outputArtifacts, graderArtifact } = outputArtifactStore(graderBytes)
  const grader = createPierResultGrader({
    name: 'pier-official-result',
    version: '1.0.0',
    artifact: graderArtifact,
  })
  const executionId = `pier-no-model-${proofArm}-${contextDigest}`
  const benchmarkTask = sealCandidateBenchmarkTask({
    kind: 'agent-candidate-benchmark-task',
    digestAlgorithm: 'rfc8785-sha256',
    benchmark: {
      name: 'pier-runtime-proof',
      version: '1',
      splitDigest: `sha256:${'b'.repeat(64)}`,
    },
    scenario: {
      id: `agent-bench/pier-candidate-no-model-${proofArm}`,
      kind: 'coding',
      scenarioDigest: sha256(Buffer.from(`pier-runtime-proof:${proofArm}`, 'utf8')),
    },
    instruction,
    repository: {
      identity: 'github.com/tangle-network/agent-bench-pier-fixture',
      rootIdentity: 'tangle-network/agent-bench-pier-fixture',
      baseCommit: repositoryState.commit,
      baseTree: repositoryState.tree,
    },
    outcome: { kind: 'workspace' },
    attempt: { maxAttempts: 1, retryPolicy: 'none' },
    model: {
      requested: modelRequest,
      provider: 'openai',
      model: 'gpt-5.4',
      snapshot: 'gpt-5.4-no-model-proof',
      reasoningEffort: 'xhigh',
    },
    grader: {
      name: grader.name,
      version: grader.version,
      format: 'tangle-grader',
      artifact: grader.artifact,
    },
    workspace: taskWorkspace,
    evaluatorTaskContainer: container,
    limits: {
      timeoutMs: 180_000,
      maxSteps: 8,
      maxModelCalls: 0,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxCostUsd: 0,
    },
  })
  const benchmark = sealCandidateBenchmarkSuite({
    tasks: [benchmarkTask],
    reps: 1,
    seeds: [42],
  })
  const task: AgentCandidateTaskExecution = {
    executionId,
    runCell: sealCanonical({
      kind: 'agent-candidate-run-cell' as const,
      experimentDigest: sha256(Buffer.from('pier-runtime-proof-experiment', 'utf8')),
      arm: 'candidate' as const,
      bundleDigest: bundle.digest,
      suiteDigest: benchmark.suite.digest,
      taskDigest: benchmarkTask.digest,
      taskIndex: 0,
      repetition: 0,
      seed: 42,
      attempt: 1,
    }),
    benchmarkSuite: benchmark.suite,
    task: benchmarkTask,
    executionRoots: { taskRoot: '/app', candidateRoot: '/opt/tangle-candidate' },
    stagingRoots: { taskRoot, candidateRoot, profileRoot },
  }
  const workspaces = createAgentCandidateWorkspacePort()
  const ports: AgentCandidateExecutionPorts = {
    artifacts: {
      read: async () => {
        throw new Error('the proof uses only embedded artifacts')
      },
    },
    repositories: { resolve: async () => taskRoot },
    workspaces: {
      materialize: async ({ role, snapshot, archive, destination }) => {
        if (destination === taskRoot || destination === candidateRoot) return
        await workspaces.materialize({
          role,
          snapshot,
          archive,
          destination,
        })
      },
    },
    containers: { resolve: async () => container },
    models: {
      resolve: async ({ requested, reasoningEffort }) => {
        if (!reasoningEffort) throw new Error('resolved model requires reasoning effort')
        return {
          requested,
          provider: 'openai',
          model: 'gpt-5.4',
          snapshot: 'gpt-5.4-no-model-proof',
          reasoningEffort,
        }
      },
      reserveGrant: async ({ limits, preparationId, expiresAtMs }) => ({
        preparationId,
        digest: `sha256:${'c'.repeat(64)}`,
        expiresAtMs,
        enforcedLimits: limits,
        network: { mode: 'disabled' },
      }),
      activateGrant: async () => ({
        env: { MODEL_GATEWAY_TOKEN: 'zero-model-proof' },
      }),
      settleGrant: async ({ preparationId }) => ({
        preparationId,
        grantDigest: `sha256:${'c'.repeat(64)}`,
        closed: true,
        calls: [],
      }),
    },
    memory: {
      reset: async () => {
        throw new Error('disabled memory must not be reset')
      },
      activate: async () => {
        throw new Error('disabled memory must not be activated')
      },
      close: async () => {
        throw new Error('disabled memory must not be closed')
      },
    },
  }

  const verified = await verifyAgentCandidateBundle(bundle, ports)
  const prepared = await prepareAgentCandidateExecution(verified, task, ports)
  if (prepareOnly) {
    const disposal = await disposePreparedAgentCandidateExecution(prepared)
    if (disposal.disposed !== true) throw new Error('prepared candidate was not disposed')
    process.stdout.write(
      `${JSON.stringify({
        prepared: true,
        disposed: true,
        executionPlanDigest: prepared.executionPlan.value.digest,
        graderDigest: benchmarkTask.grader.artifact.sha256,
      })}\n`,
    )
  } else {
  const traceStore = new InMemoryTraceStore()
  const claimStore = new FileAgentCandidateExecutionClaimStore({
    directory: path.join(scratch, 'claims'),
  })
  let acceptedRewards: { reward: number; patch_applied: number } | undefined
  let acceptedTrialPath: string | undefined
  const jobName = `tangle-runtime-candidate-no-model-${proofArm}`
  const controller = new FilePierCandidateTrialController({
    directory: path.join(scratch, 'trial-control'),
    readResult: async ({ jobsDirectory, jobName }) => {
      const trialResult = findTrialResult(path.join(jobsDirectory, jobName))
      if (!trialResult) return undefined
      return {
        value: trialResult.value,
        resultBytes: readFileSync(trialResult.path),
        taskPatch: readFileSync(
          path.join(path.dirname(trialResult.path), 'artifacts', 'model.patch'),
        ),
      }
    },
    launch: (staged, { request }) => {
      const evaluatorArgs = Object.keys(staged.evaluatorEnv).flatMap((name) => [
        '--agent-env',
        `${name}=\${${name}}`,
      ])
      return {
        command: 'uv',
        args: [
          'run',
          'pier',
          'run',
          '--path',
          taskDir,
          ...staged.agentArgs,
          ...staged.attemptArgs,
          ...evaluatorArgs,
          '--env',
          'docker',
          '--job-name',
          jobName,
          '--jobs-dir',
          jobsDir,
          '--n-concurrent',
          '1',
          '--agent-timeout-multiplier',
          '2',
          '--quiet',
        ],
        cwd: pierRepo,
        env: { ...process.env, PYTHONPATH: benchDir, ...staged.evaluatorEnv },
        jobsDirectory: jobsDir,
        jobName,
        readResult: async () => {
          const trialResult = findTrialResult(jobsDir)
          if (!trialResult) throw new Error(`Pier emitted no trial result under ${jobsDir}`)
          const result = trialResult.value
          if (result.exception_info !== null) {
            throw new Error(
              `Pier trial captured an exception: ${JSON.stringify(result.exception_info)}`,
            )
          }
          const rewards = result.verifier_result?.rewards
          if (
            rewards?.reward !== expectedReward ||
            rewards?.patch_applied !== expectedPatchApplied
          ) {
            throw new Error(
              `Pier ${proofArm} control returned unexpected rewards: ${JSON.stringify(rewards)}`,
            )
          }
          const agentResult = result.agent_result
          for (const name of ['n_input_tokens', 'n_cache_tokens', 'n_output_tokens', 'cost_usd']) {
            if (agentResult?.[name] !== null) {
              throw new Error(
                `Pier must not author protected usage ${name}: ${agentResult?.[name]}`,
              )
            }
          }
          const observedElapsedMs = agentResult?.metadata?.observedElapsedMs
          if (!Number.isInteger(observedElapsedMs) || observedElapsedMs < 0) {
            throw new Error(`Pier omitted protected elapsed time: ${observedElapsedMs}`)
          }
          const endedAt = Date.now()
          await traceStore.appendRun({
            runId: request.trace.runId,
            scenarioId: benchmarkTask.scenario.id,
            startedAt: endedAt - observedElapsedMs,
            endedAt,
            status: 'completed',
            tags: { ...request.trace.tags },
          })
          acceptedRewards = rewards
          acceptedTrialPath = path.relative(jobsDir, trialResult.path)
          return {
            value: result,
            resultBytes: readFileSync(trialResult.path),
            taskPatch: readFileSync(
              path.join(path.dirname(trialResult.path), 'artifacts', 'model.patch'),
            ),
          }
        },
      }
    },
  })
  const finalized = await executePreparedPierCandidate({
    prepared,
    directory: path.join(scratch, 'sealed'),
    pierVersion: pinnedPierVersion,
    traceStore,
    claimStore,
    outputArtifacts,
    grader,
    controller,
  })
  if (!finalized.succeeded) {
    throw new Error(`runtime rejected the protected Pier capture: ${finalized.reason}`)
  }
  if (!acceptedRewards || !acceptedTrialPath) {
    throw new Error('atomic Pier executor returned without accepted verifier evidence')
  }
  if (
    finalized.receipt.value.benchmarkResult.material.score !== expectedReward ||
    finalized.receipt.value.benchmarkResult.material.passed !== (expectedReward === 1)
  ) {
    throw new Error(
      `runtime receipt rejected the official Pier result: ${JSON.stringify(finalized.receipt.value.benchmarkResult.material)}`,
    )
  }
  assertTreeOmits(scratch, 'zero-model-proof')
  const usage = finalized.receipt.value.modelSettlement.material.usage
  if (
    usage.modelCalls !== 0 ||
    usage.inputTokens !== 0 ||
    usage.outputTokens !== 0 ||
    usage.cachedInputTokens !== 0 ||
    usage.reasoningTokens !== 0 ||
    usage.costUsdNanos !== 0 ||
    finalized.receipt.value.trace.modelCallCount !== 0
  ) {
    throw new Error(`runtime minted nonzero usage for a zero-model run: ${JSON.stringify(usage)}`)
  }

  console.log(
    JSON.stringify(
      {
        arm: proofArm,
        reward: acceptedRewards.reward,
        patchApplied: acceptedRewards.patch_applied,
        modelCalls: usage.modelCalls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsdNanos / 1_000_000_000,
        pierContextUsage: null,
        profileExcludedByVerifier: true,
        container: {
          image: fixtureImage,
          indexDigest: identity.indexDigest,
          manifestDigest: identity.manifestDigest,
          platform,
        },
        executionPlanDigest: prepared.executionPlan.value.digest,
        materializationReceiptDigest: prepared.materializationReceipt.digest,
        runReceiptDigest: finalized.receipt.digest,
        trial: acceptedTrialPath,
      },
      null,
      2,
    ),
  )
  }
} finally {
  if (process.env.KEEP_PIER_FIXTURE !== '1') rmSync(scratch, { recursive: true, force: true })
  else console.error(`Pier runtime fixture retained at ${scratch}`)
}
