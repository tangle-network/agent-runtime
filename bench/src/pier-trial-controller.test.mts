import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import type { AgentCandidateExecutorRequest } from '@tangle-network/agent-runtime'
import { InMemoryTraceStore } from '@tangle-network/agent-eval'

import { createStagedPierCandidateExecutionFixture } from './pier-agent.test-fixtures.mts'
import { FilePierCandidateTrialController } from './pier-trial-controller'

const execFileAsync = promisify(execFile)

function testRequest(executionId: string, executionPlanDigest: `sha256:${string}`) {
  return {
    staged: createStagedPierCandidateExecutionFixture(executionId),
    context: {
      request: {
        executionId,
        executionPlan: { value: { digest: executionPlanDigest } },
      } as AgentCandidateExecutorRequest,
      traceStore: new InMemoryTraceStore(),
      signal: new AbortController().signal,
      deadlineAtMs: Date.now() + 30_000,
    },
  }
}

test('an existing Pier job is rejected without deleting or starting it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pier-controller-scope-'))
  const controlRoot = path.join(root, 'control')
  const jobsDirectory = path.join(root, 'jobs')
  const jobName = 'already-owned'
  const marker = path.join(jobsDirectory, jobName, 'keep')
  const fakeDocker = path.join(root, 'docker')
  try {
    await mkdir(path.dirname(marker), { recursive: true })
    await writeFile(marker, 'do not delete\n')
    await writeFile(fakeDocker, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    await chmod(fakeDocker, 0o700)
    const controller = new FilePierCandidateTrialController({
      directory: controlRoot,
      launch: () => ({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: root,
        env: { ...process.env },
        jobsDirectory,
        jobName,
        dockerCommand: fakeDocker,
        readResult: async () => {
          throw new Error('existing job must never launch')
        },
      }),
    })
    const { staged, context } = testRequest(
      'pier-job-scope',
      `sha256:${'c'.repeat(64)}`,
    )
    assert.throws(
      () => controller.start(staged, context),
      /job name must be unique/,
    )
    assert.equal(await readFile(marker, 'utf8'), 'do not delete\n')
    assert.deepEqual(await readdir(controlRoot), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the Pier result wait does not add time beyond an expired deadline', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pier-controller-deadline-'))
  const controlRoot = path.join(root, 'control')
  const jobsDirectory = path.join(root, 'jobs')
  const fakeDocker = path.join(root, 'docker')
  const readyPath = path.join(root, 'supervisor-ready')
  const supervisorPath = path.join(root, 'supervisor.mjs')
  let handle: ReturnType<FilePierCandidateTrialController['start']> | undefined
  let resultSettled: Promise<unknown> | undefined
  try {
    await writeFile(fakeDocker, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    await chmod(fakeDocker, 0o700)
    await writeFile(
      supervisorPath,
      `import { createReadStream } from 'node:fs'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
const directory = process.argv[2]
process.on('SIGTERM', () => {
  writeFileSync(path.join(directory, 'terminal.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'pier-trial-terminal',
    status: 'stopped',
    processExited: true,
    containersRemoved: true,
  }))
  process.exit(0)
})
for await (const _chunk of createReadStream('', { fd: 3 })) {}
writeFileSync(${JSON.stringify(readyPath)}, 'ready')
setInterval(() => undefined, 1_000)
`,
    )
    const controller = new FilePierCandidateTrialController({
      directory: controlRoot,
      supervisorPath,
      pollIntervalMs: 5,
      launch: () => ({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: root,
        env: {},
        jobsDirectory,
        jobName: 'expired-deadline',
        dockerCommand: fakeDocker,
        readResult: async () => {
          throw new Error('an expired trial must not read a result')
        },
      }),
    })
    const { staged, context } = testRequest(
      'pier-expired-deadline',
      `sha256:${'e'.repeat(64)}`,
    )
    context.deadlineAtMs = Date.now()
    handle = controller.start(staged, context)
    resultSettled = handle.result.catch((error) => error)

    const outcome = await Promise.race([
      resultSettled,
      new Promise<'pending'>((resolvePending) => setTimeout(() => resolvePending('pending'), 500)),
    ])
    assert.notEqual(outcome, 'pending')
    assert.match(String(outcome), /no terminal acknowledgement/)
  } finally {
    if (handle) await handle.terminateAndWait().catch(() => undefined)
    if (resultSettled) await resultSettled
    await rm(root, { recursive: true, force: true })
  }
})

test('the supervisor receives only launch data and no inherited evaluator environment', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pier-controller-supervisor-env-'))
  const controlRoot = path.join(root, 'control')
  const jobsDirectory = path.join(root, 'jobs')
  const fakeDocker = path.join(root, 'docker')
  const supervisorPath = path.join(root, 'supervisor.mjs')
  const previousSecret = process.env.PIER_PARENT_SECRET
  let handle: ReturnType<FilePierCandidateTrialController['start']> | undefined
  try {
    process.env.PIER_PARENT_SECRET = 'must-not-be-inherited'
    await writeFile(fakeDocker, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    await chmod(fakeDocker, 0o700)
    await writeFile(
      supervisorPath,
      `import { createReadStream, writeFileSync } from 'node:fs'
import path from 'node:path'
const chunks = []
for await (const chunk of createReadStream('', { fd: 3 })) chunks.push(Buffer.from(chunk))
const launch = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const isolated = process.env.PIER_SUPERVISOR_MODE === 'explicit' &&
  process.env.PIER_PARENT_SECRET === undefined &&
  launch.env.PIER_PARENT_SECRET === undefined &&
  launch.env.PIER_CHILD_SECRET === 'child-only'
writeFileSync(path.join(process.argv[2], 'terminal.json'), JSON.stringify({
  schemaVersion: 1,
  kind: 'pier-trial-terminal',
  status: isolated ? 'completed' : 'failed',
  processExited: true,
  containersRemoved: true,
  ...(isolated ? {} : { error: 'supervisor inherited evaluator environment' }),
}))
`,
    )
    const controller = new FilePierCandidateTrialController({
      directory: controlRoot,
      supervisorPath,
      pollIntervalMs: 5,
      dockerConnection: {
        id: 'explicit-supervisor-test',
        env: { PIER_SUPERVISOR_MODE: 'explicit' },
      },
      launch: () => ({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: root,
        env: { PIER_CHILD_SECRET: 'child-only' },
        jobsDirectory,
        jobName: 'isolated-supervisor',
        dockerCommand: fakeDocker,
        readResult: async () => ({
          value: { output: 'isolated' },
          resultBytes: Uint8Array.from(Buffer.from('{}')),
          taskPatch: new Uint8Array(),
        }),
      }),
    })
    const { staged, context } = testRequest(
      'pier-isolated-supervisor',
      `sha256:${'f'.repeat(64)}`,
    )
    handle = controller.start(staged, context)
    assert.deepEqual((await handle.result).value, { output: 'isolated' })
  } finally {
    if (previousSecret === undefined) delete process.env.PIER_PARENT_SECRET
    else process.env.PIER_PARENT_SECRET = previousSecret
    if (handle) await handle.terminateAndWait().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('terminal acknowledgements reject unknown fields', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pier-controller-terminal-schema-'))
  const controlRoot = path.join(root, 'control')
  const jobsDirectory = path.join(root, 'jobs')
  const fakeDocker = path.join(root, 'docker')
  const supervisorPath = path.join(root, 'supervisor.mjs')
  let handle: ReturnType<FilePierCandidateTrialController['start']> | undefined
  try {
    await writeFile(fakeDocker, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    await chmod(fakeDocker, 0o700)
    await writeFile(
      supervisorPath,
      `import { createReadStream, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
for await (const _chunk of createReadStream('', { fd: 3 })) {}
const target = path.join(process.argv[2], 'terminal.json')
const temporary = path.join(process.argv[2], '.terminal.json.tmp')
writeFileSync(temporary, JSON.stringify({
  schemaVersion: 1,
  kind: 'pier-trial-terminal',
  status: 'completed',
  processExited: true,
  containersRemoved: true,
  containerRemoved: true,
}))
renameSync(temporary, target)
`,
    )
    const controller = new FilePierCandidateTrialController({
      directory: controlRoot,
      supervisorPath,
      pollIntervalMs: 5,
      launch: () => ({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: root,
        env: {},
        jobsDirectory,
        jobName: 'strict-terminal',
        dockerCommand: fakeDocker,
        readResult: async () => {
          throw new Error('a malformed terminal must not read a result')
        },
      }),
    })
    const { staged, context } = testRequest(
      'pier-strict-terminal',
      `sha256:${'0'.repeat(64)}`,
    )
    handle = controller.start(staged, context)
    await assert.rejects(handle.result, /terminal is malformed/)
  } finally {
    if (handle) await handle.terminateAndWait().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('a fresh evaluator process terminates the persisted process and container identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pier-controller-recovery-'))
  const controlRoot = path.join(root, 'control')
  const jobsDirectory = path.join(root, 'jobs')
  const jobName = 'recovery-job'
  const trialName = 'trial-recovery'
  const primaryContainerState = path.join(root, 'primary-container-live')
  const otherContainerState = path.join(root, 'other-container-live')
  const fakeDocker = path.join(root, 'docker')
  const childPidPath = path.join(root, 'child.pid')
  const executionId = 'pier-fresh-process-recovery'
  const executionPlanDigest = `sha256:${'d'.repeat(64)}` as const
  let handle: ReturnType<FilePierCandidateTrialController['start']> | undefined
  let resultSettled: Promise<unknown> | undefined

  try {
    await writeFile(primaryContainerState, 'live\n')
    await writeFile(otherContainerState, 'live\n')
    await writeFile(
      fakeDocker,
      `#!/bin/sh
set -eu
state="\${FAKE_DOCKER_STATE:?missing FAKE_DOCKER_STATE}"
if test "\${1:-}" = ps; then
  test -f "$state" && printf 'fake-container\\t${trialName}\\n'
  exit 0
fi
if test "\${1:-}" = rm; then
  rm -f -- "$state"
  exit 0
fi
printf 'unexpected fake docker invocation: %s\\n' "$*" >&2
exit 2
`,
      { mode: 0o700 },
    )
    await chmod(fakeDocker, 0o700)

    const controller = new FilePierCandidateTrialController({
      directory: controlRoot,
      dockerConnection: {
        id: 'fake-primary',
        env: { FAKE_DOCKER_STATE: primaryContainerState },
      },
      launch: () => ({
        command: process.execPath,
        args: [
          '-e',
          `const { spawn } = require('node:child_process'); const { mkdirSync, writeFileSync } = require('node:fs'); mkdirSync(${JSON.stringify(path.join(jobsDirectory, jobName, trialName))}, { recursive: true }); const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1_000)'], { stdio: 'ignore' }); writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid)); setInterval(() => undefined, 1_000)`,
        ],
        cwd: root,
        env: {},
        jobsDirectory,
        jobName,
        dockerCommand: fakeDocker,
        readResult: async () => {
          throw new Error('recovery trial must not complete normally')
        },
      }),
    })
    const { staged, context } = testRequest(executionId, executionPlanDigest)
    handle = controller.start(staged, context)
    resultSettled = handle.result.catch(() => undefined)

    const [slot] = await readdir(controlRoot)
    assert.ok(slot)
    const identityPath = path.join(controlRoot, slot, 'identity.json')
    let persisted: { state?: string; pier?: { pid: number } } = {}
    for (let attempt = 0; attempt < 200; attempt++) {
      persisted = JSON.parse(await readFile(identityPath, 'utf8'))
      if (persisted.state === 'running' && persisted.pier) break
      await new Promise((resolveWait) => setTimeout(resolveWait, 10))
    }
    assert.equal(persisted.state, 'running')
    assert.ok(persisted.pier)
    let childPid: number | undefined
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        childPid = Number(await readFile(childPidPath, 'utf8'))
        if (Number.isSafeInteger(childPid)) break
      } catch {}
      await new Promise((resolveWait) => setTimeout(resolveWait, 10))
    }
    assert.ok(childPid)

    const recoveryScript = path.resolve('scripts/terminate-pier-trial.mts')
    const recoveryArgs = [
      '--import',
      'tsx',
      recoveryScript,
      controlRoot,
      executionId,
      executionPlanDigest,
    ]
    const recoveryEnvironment = {
      ...process.env,
      PIER_DOCKER_CONNECTION_ID: 'fake-primary',
      PIER_DOCKER_ENV_NAMES: 'FAKE_DOCKER_STATE',
      FAKE_DOCKER_STATE: primaryContainerState,
    }
    await assert.rejects(
      execFileAsync(process.execPath, recoveryArgs, {
        cwd: path.resolve('.'),
        env: {
          ...recoveryEnvironment,
          PIER_DOCKER_CONNECTION_ID: 'fake-other',
          FAKE_DOCKER_STATE: otherContainerState,
        },
        timeout: 20_000,
      }),
      (error: unknown) =>
        String((error as { stderr?: string }).stderr).includes(
          'requires Docker connection fake-primary',
        ),
    )
    const recovered = await Promise.all([
      execFileAsync(process.execPath, recoveryArgs, {
        cwd: path.resolve('.'),
        env: recoveryEnvironment,
        timeout: 20_000,
      }),
      execFileAsync(process.execPath, recoveryArgs, {
        cwd: path.resolve('.'),
        env: recoveryEnvironment,
        timeout: 20_000,
      }),
    ])
    for (const worker of recovered) {
      assert.deepEqual(JSON.parse(worker.stdout), {
        processExited: true,
        containersRemoved: true,
      })
    }
    await assert.rejects(readFile(primaryContainerState), /ENOENT/)
    assert.equal(await readFile(otherContainerState, 'utf8'), 'live\n')
    assert.throws(() => process.kill(persisted.pier!.pid, 0), /ESRCH/)
    assert.throws(() => process.kill(childPid!, 0), /ESRCH/)
    await resultSettled
  } finally {
    if (handle) await handle.terminateAndWait().catch(() => undefined)
    if (resultSettled) await resultSettled
    await rm(root, { recursive: true, force: true })
  }
})
