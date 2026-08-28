/**
 * Cross-process steer admission and delivery-claim probe.
 *
 * Usage:
 * `node --import tsx worker-steer-child.ts write <root> <runId> <workerId> <operationId> <message> <startAtMs>`
 * `node --import tsx worker-steer-child.ts claim <eventDir> <operationId> <startAtMs>`
 */

import {
  claimWorkerSteerDelivery,
  readWorkerSteerRequests,
  writeWorkerSteer,
} from '../../src/runtime/supervise/run-layout'

const [mode, ...args] = process.argv.slice(2)

if (mode === 'write') {
  const [root, runId, workerId, operationId, message, startAtText] = args
  await waitUntil(Number(startAtText))
  const result = writeWorkerSteer(required(root), required(runId), required(workerId), {
    operationId: required(operationId),
    message: required(message),
  })
  process.stdout.write(`${JSON.stringify({ replayed: result.replayed })}\n`)
} else if (mode === 'claim') {
  const [eventDir, operationId, startAtText] = args
  await waitUntil(Number(startAtText))
  const request = readWorkerSteerRequests(required(eventDir)).find(
    (candidate) => candidate.operationId === operationId,
  )
  if (request === undefined) throw new Error('admitted steer request not found')
  const won = claimWorkerSteerDelivery(required(eventDir), {
    schemaVersion: 1,
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    worker: request.worker,
    effect: 'unknown',
    requestedAt: request.at,
    observedAt: new Date().toISOString(),
    detail: 'delivery admitted; outcome not yet known',
  })
  process.stdout.write(`${JSON.stringify({ won })}\n`)
} else {
  throw new Error(`unknown worker steer child mode: ${String(mode)}`)
}

function required(value: string | undefined): string {
  if (value === undefined || value.length === 0) throw new Error('required argument is missing')
  return value
}

async function waitUntil(at: number): Promise<void> {
  if (!Number.isFinite(at)) throw new Error('start time is invalid')
  const delay = Math.max(0, at - Date.now())
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
}
