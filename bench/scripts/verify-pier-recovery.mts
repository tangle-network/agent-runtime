import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AgentCandidateExecutorRequest } from '@tangle-network/agent-runtime'
import { InMemoryTraceStore } from '@tangle-network/agent-eval'

import { createStagedPierCandidateExecutionFixture } from '../src/pier-agent.test-fixtures.mts'
import { FilePierCandidateTrialController } from '../src/pier-trial-controller'

const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = mkdtempSync(path.join(tmpdir(), 'pier-fresh-recovery-'))
const controlRoot = path.join(root, 'control')
const jobsDirectory = path.join(root, 'jobs')
const jobName = 'fresh-recovery'
const trialName = 'fresh-recovery-trial'
const executionId = 'pier-fresh-process-recovery'
const executionPlanDigest = `sha256:${'e'.repeat(64)}` as const
const image = 'ghcr.io/tangle-network/devcontainers/universal:latest'
let containerId: string | undefined
let handle: ReturnType<FilePierCandidateTrialController['start']> | undefined
let resultSettled: Promise<unknown> | undefined

try {
  containerId = execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--label',
      `com.docker.compose.project=${trialName}`,
      image,
      'sleep',
      'infinity',
    ],
    { encoding: 'utf8', timeout: 120_000 },
  ).trim()
  if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
    throw new Error(`Docker returned an invalid recovery container id: ${containerId}`)
  }

  const controller = new FilePierCandidateTrialController({
    directory: controlRoot,
    launch: () => ({
      command: process.execPath,
      args: [
        '-e',
        `require('node:fs').mkdirSync(${JSON.stringify(path.join(jobsDirectory, jobName, trialName))}, { recursive: true }); setInterval(() => undefined, 1_000)`,
      ],
      cwd: root,
      env: { ...process.env },
      jobsDirectory,
      jobName,
      readResult: async () => {
        throw new Error('recovery probe must not complete normally')
      },
    }),
  })
  handle = controller.start(
    createStagedPierCandidateExecutionFixture(executionId),
    {
      request: {
        executionId,
        executionPlan: { value: { digest: executionPlanDigest } },
      } as AgentCandidateExecutorRequest,
      traceStore: new InMemoryTraceStore(),
      signal: new AbortController().signal,
      deadlineAtMs: Date.now() + 30_000,
    },
  )
  resultSettled = handle.result.catch(() => undefined)

  const [slot] = readdirSync(controlRoot)
  if (!slot) throw new Error('Pier controller omitted durable state')
  const identityPath = path.join(controlRoot, slot, 'identity.json')
  let pierPid: number | undefined
  for (let attempt = 0; attempt < 200; attempt++) {
    const identity = JSON.parse(readFileSync(identityPath, 'utf8'))
    if (identity.state === 'running' && Number.isSafeInteger(identity.pier?.pid)) {
      pierPid = identity.pier.pid
      break
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  if (!pierPid) throw new Error('Pier controller never persisted the child process identity')
  const trialDirectory = path.join(jobsDirectory, jobName, trialName)
  for (let attempt = 0; attempt < 200 && !existsSync(trialDirectory); attempt++) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  if (!existsSync(trialDirectory)) {
    throw new Error('recovery probe never created its evaluator-owned trial directory')
  }

  const recovery = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(benchDir, 'scripts', 'terminate-pier-trial.mts'),
        controlRoot,
        executionId,
        executionPlanDigest,
      ],
      { cwd: benchDir, encoding: 'utf8', timeout: 20_000 },
    ),
  )
  if (recovery.processExited !== true || recovery.containersRemoved !== true) {
    throw new Error(`fresh recovery returned an incomplete acknowledgement: ${JSON.stringify(recovery)}`)
  }
  try {
    process.kill(pierPid, 0)
    throw new Error(`recovered Pier process ${pierPid} is still alive`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
  let containerPresent = true
  try {
    execFileSync('docker', ['inspect', containerId], { stdio: 'ignore', timeout: 30_000 })
  } catch {
    containerPresent = false
  }
  if (containerPresent) throw new Error(`recovered Pier container ${containerId} is still present`)
  await resultSettled
  process.stdout.write(
    `${JSON.stringify({ freshProcess: true, processExited: true, containersRemoved: true })}\n`,
  )
} finally {
  if (handle) await handle.terminateAndWait().catch(() => undefined)
  if (resultSettled) await resultSettled
  if (containerId) {
    try {
      execFileSync('docker', ['rm', '-f', containerId], { stdio: 'ignore', timeout: 30_000 })
    } catch {}
  }
  rmSync(root, { recursive: true, force: true })
}
