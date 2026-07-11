import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import type { AgentCandidateExecutorRequest } from '@tangle-network/agent-runtime'
import { InMemoryTraceStore } from '@tangle-network/agent-eval'

import type { StagedPierCandidateExecution } from './pier-agent'
import { FilePierCandidateTrialController } from './pier-trial-controller'

const execFileAsync = promisify(execFile)

function testRequest(executionId: string, executionPlanDigest: `sha256:${string}`) {
  return {
    staged: { executionId, evaluatorEnv: {} } as StagedPierCandidateExecution,
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

test('a fresh evaluator process terminates the persisted process and container identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pier-controller-recovery-'))
  const controlRoot = path.join(root, 'control')
  const jobsDirectory = path.join(root, 'jobs')
  const jobName = 'recovery-job'
  const trialName = 'trial-recovery'
  const fakeContainerState = path.join(root, 'fake-container-live')
  const fakeDocker = path.join(root, 'docker')
  const childPidPath = path.join(root, 'child.pid')
  const executionId = 'pier-fresh-process-recovery'
  const executionPlanDigest = `sha256:${'d'.repeat(64)}` as const
  let handle: ReturnType<FilePierCandidateTrialController['start']> | undefined
  let resultSettled: Promise<unknown> | undefined

  try {
    await writeFile(fakeContainerState, 'live\n')
    await writeFile(
      fakeDocker,
      `#!/bin/sh
set -eu
state=${JSON.stringify(fakeContainerState)}
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
      launch: () => ({
        command: process.execPath,
        args: [
          '-e',
          `const { spawn } = require('node:child_process'); const { mkdirSync, writeFileSync } = require('node:fs'); mkdirSync(${JSON.stringify(path.join(jobsDirectory, jobName, trialName))}, { recursive: true }); const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1_000)'], { stdio: 'ignore' }); writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid)); setInterval(() => undefined, 1_000)`,
        ],
        cwd: root,
        env: { ...process.env },
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
    const recovered = await Promise.all([
      execFileAsync(process.execPath, recoveryArgs, { cwd: path.resolve('.'), timeout: 20_000 }),
      execFileAsync(process.execPath, recoveryArgs, { cwd: path.resolve('.'), timeout: 20_000 }),
    ])
    for (const worker of recovered) {
      assert.deepEqual(JSON.parse(worker.stdout), {
        processExited: true,
        containersRemoved: true,
      })
    }
    await assert.rejects(readFile(fakeContainerState), /ENOENT/)
    assert.throws(() => process.kill(persisted.pier!.pid, 0), /ESRCH/)
    assert.throws(() => process.kill(childPid!, 0), /ESRCH/)
    await resultSettled
  } finally {
    if (handle) await handle.terminateAndWait().catch(() => undefined)
    if (resultSettled) await resultSettled
    await rm(root, { recursive: true, force: true })
  }
})
