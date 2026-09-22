import { appendFileSync, existsSync } from 'node:fs'
import { readWorkerCancellation } from '../../src/runtime/supervise/run-layout'
import type { Scope } from '../../src/runtime/supervise/types'
import { createWorkerControlAuthority } from '../../src/runtime/supervise/worker-control-context'
import { createWorkerControlDriver } from '../../src/runtime/supervise/worker-control-driver'

const [mode, dir, workerId, operationId, ownerId, effectFile, readyFile, startFile] =
  process.argv.slice(2)

if (
  (mode !== 'steer' && mode !== 'cancel') ||
  dir === undefined ||
  workerId === undefined ||
  operationId === undefined ||
  ownerId === undefined ||
  effectFile === undefined ||
  readyFile === undefined ||
  startFile === undefined
) {
  throw new Error('worker-control-race-child: invalid arguments')
}

appendFileSync(readyFile, `${ownerId}\n`, 'utf8')
await waitFor(startFile)

const scope = {
  view: { nodes: [{ id: workerId, status: 'running' }] },
} as unknown as Scope<unknown>
const coord = {
  settled: () => [],
  abortWorkerById: (id: string) => {
    const beforeAbort = readWorkerCancellation(dir, operationId)?.effect
    if (beforeAbort !== 'unknown') {
      throw new Error(
        `worker-control-race-child: expected unknown before abort, got ${beforeAbort}`,
      )
    }
    appendFileSync(effectFile, `${ownerId}:${beforeAbort}\n`, 'utf8')
    return { id, label: 'same-label' }
  },
}
const authority = createWorkerControlAuthority()
authority.register({
  scope,
  coord,
  deliverSteer: async () => {
    appendFileSync(effectFile, `${ownerId}\n`, 'utf8')
    await Promise.resolve()
    return { delivered: true }
  },
})
const driver = createWorkerControlDriver({
  dir,
  authority,
  now: () => 0,
  ownerId,
})

await driver.pass()

async function waitFor(file: string): Promise<void> {
  while (!existsSync(file)) await new Promise<void>((resolve) => setTimeout(resolve, 5))
}
