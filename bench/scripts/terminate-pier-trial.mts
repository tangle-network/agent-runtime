import path from 'node:path'

import { InMemoryTraceStore } from '@tangle-network/agent-eval'

import { createPierCandidateRecoveryExecutor } from '../src/pier-agent'
import { FilePierCandidateTrialController } from '../src/pier-trial-controller'

const [directoryArg, executionId, executionPlanDigest, ...extra] = process.argv.slice(2)
if (!directoryArg || !executionId || !executionPlanDigest || extra.length > 0) {
  throw new Error(
    'usage: terminate-pier-trial.mts <control-directory> <execution-id> <execution-plan-digest>',
  )
}
if (!/^sha256:[a-f0-9]{64}$/.test(executionPlanDigest)) {
  throw new Error('execution-plan-digest must be a SHA-256 digest')
}

const dockerConnectionId = process.env.PIER_DOCKER_CONNECTION_ID
const dockerEnvironmentNames = process.env.PIER_DOCKER_ENV_NAMES
if ((dockerConnectionId === undefined) !== (dockerEnvironmentNames === undefined)) {
  throw new Error(
    'PIER_DOCKER_CONNECTION_ID and PIER_DOCKER_ENV_NAMES must be set together',
  )
}
const dockerConnection = (() => {
  if (dockerConnectionId === undefined || dockerEnvironmentNames === undefined) return undefined
  const names = dockerEnvironmentNames
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (new Set(names).size !== names.length) {
    throw new Error('PIER_DOCKER_ENV_NAMES must not contain duplicates')
  }
  const env: Record<string, string> = {}
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error('PIER_DOCKER_ENV_NAMES contains an invalid environment name')
    }
    const value = process.env[name]
    if (value === undefined) throw new Error(`required Docker environment variable ${name} is unset`)
    env[name] = value
  }
  return { id: dockerConnectionId, env }
})()

const controller = new FilePierCandidateTrialController({
  directory: path.resolve(directoryArg),
  ...(dockerConnection ? { dockerConnection } : {}),
})
const executor = createPierCandidateRecoveryExecutor(controller)
const recovered = await executor.stopAndCapture(
  {
    executionId,
    executionPlanDigest: executionPlanDigest as `sha256:${string}`,
  },
  {
    traceStore: new InMemoryTraceStore(),
    reason: 'failed',
    signal: new AbortController().signal,
    deadlineAtMs: Date.now() + 30_000,
  },
)
if (recovered.stopped !== true) throw new Error('Pier recovery executor did not stop the trial')
process.stdout.write(
  `${JSON.stringify({ processExited: true, containersRemoved: true })}\n`,
)
