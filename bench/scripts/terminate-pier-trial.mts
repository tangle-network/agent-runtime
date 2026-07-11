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

const controller = new FilePierCandidateTrialController({
  directory: path.resolve(directoryArg),
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
