import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import {
  createFileSupervisorControlClient,
  startSupervisorControlRoute,
  supervisorControlFiles,
} from '../../src/runtime/supervise/control'

const [
  mode,
  runDir,
  runIdOrResult,
  readyFile,
  startFile,
  releaseFile,
  resultFile,
  capabilityToken,
] = process.argv.slice(2)

if (mode === 'unauthorized') {
  const resultPath = runIdOrResult
  if (!resultPath) throw new Error('unauthorized child requires a result path')
  try {
    const descriptor = JSON.parse(
      readFileSync(supervisorControlFiles(runDir ?? '').capability, 'utf8'),
    ) as { capabilityDigest?: string }
    const client = createFileSupervisorControlClient(runDir ?? '', {
      pollMs: 1,
      timeoutMs: 20,
      ...(descriptor.capabilityDigest ? { capabilityToken: descriptor.capabilityDigest } : {}),
    })
    const acknowledgement = await client.steer({
      operationId: 'same-uid-unauthorized-child',
      workerId: 'worker-1',
      message: 'same-uid child must not control the run',
    })
    writeFileSync(resultPath, `${JSON.stringify(acknowledgement)}\n`, { mode: 0o600 })
  } catch (error) {
    writeFileSync(
      resultPath,
      `${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}\n`,
      { mode: 0o600 },
    )
  }
  process.exit(0)
}

if (mode === 'crash-owner') {
  if (!runDir || !runIdOrResult || !readyFile || !capabilityToken) {
    throw new Error(
      'usage: supervisor-control-child crash-owner <run-dir> <run-id> <ready-file> <capability-token>',
    )
  }
  const route = startSupervisorControlRoute({
    runDir,
    runId: runIdOrResult,
    capabilityToken,
    snapshot: () => ({ root: runIdOrResult, nodes: [], inFlight: 1, waiting: 0 }),
    effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
    pollMs: 2,
  })
  writeFileSync(readyFile, `${process.pid}\n`, { mode: 0o600 })
  await delay(60_000)
  route.close('completed')
  process.exit(0)
}

if (
  mode !== 'owner-race' ||
  !runDir ||
  !runIdOrResult ||
  !readyFile ||
  !startFile ||
  !releaseFile ||
  !resultFile ||
  !capabilityToken
) {
  throw new Error(
    'usage: supervisor-control-child unauthorized <run-dir> <result-file> | owner-race <run-dir> <run-id> <ready-file> <start-file> <release-file> <result-file> <capability-token>',
  )
}

writeFileSync(readyFile, `${process.pid}\n`, { mode: 0o600 })
while (!existsSync(startFile)) await delay(2)

try {
  const route = startSupervisorControlRoute({
    runDir,
    runId: runIdOrResult,
    capabilityToken,
    snapshot: () => ({ root: runIdOrResult, nodes: [], inFlight: 0, waiting: 0 }),
    effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
    pollMs: 2,
  })
  writeFileSync(resultFile, `${JSON.stringify({ status: 'started' })}\n`, { mode: 0o600 })
  while (!existsSync(releaseFile)) await delay(2)
  route.close('completed')
} catch (error) {
  writeFileSync(
    resultFile,
    `${JSON.stringify({ status: 'failed', message: error instanceof Error ? error.message : String(error) })}\n`,
    { mode: 0o600 },
  )
}
