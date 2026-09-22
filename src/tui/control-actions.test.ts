import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startSupervisorControlRoute } from '../runtime/supervise/control'
import { startSupervisorCancel, startSupervisorSteer } from './control-actions'

describe('TUI supervisor control actions', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agent-runtime-tui-control-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('reuses one steer operation across an unknown acknowledgement and recomputes its digest', async () => {
    const steers: unknown[] = []
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'tui-steer-run',
      snapshot: () => ({ root: 'tui-steer-run', nodes: [], inFlight: 1, waiting: 0 }),
      effectReceiver: (request) => {
        steers.push(request)
        return { status: 'accepted', effect: 'delivered' }
      },
      pollMs: 1,
    })
    const pending = {
      operationId: 'tui-steer-operation',
      commandDigest: 'stale-digest-from-a-previous-message',
      runId: 'tui-steer-run',
      workerId: 'worker-1',
      message: 'inspect the parser',
    } as const

    const first = startSupervisorSteer({
      stateDir: directory,
      runId: pending.runId,
      workerId: pending.workerId,
      message: pending.message,
      capabilityToken: route.capabilityToken,
      pending,
    })
    expect(first.pending.operationId).toBe(pending.operationId)
    expect(first.pending.commandDigest).not.toBe(pending.commandDigest)
    await expect(first.acknowledgement).resolves.toMatchObject({
      status: 'accepted',
      effect: 'delivered',
    })

    const retry = startSupervisorSteer({
      stateDir: directory,
      runId: pending.runId,
      workerId: pending.workerId,
      message: pending.message,
      capabilityToken: route.capabilityToken,
      pending: first.pending,
    })
    await expect(retry.acknowledgement).resolves.toMatchObject({ status: 'accepted' })
    expect(steers).toHaveLength(1)
    route.close('completed')
  })

  it('reuses one cancel operation so repeated TUI input cancels exactly once', async () => {
    let cancellations = 0
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'tui-cancel-run',
      snapshot: () => ({ root: 'tui-cancel-run', nodes: [], inFlight: 1, waiting: 0 }),
      effectReceiver: (request) => {
        if (request.kind === 'cancel') cancellations += 1
        return { status: 'accepted', effect: 'cancel_requested' }
      },
      pollMs: 1,
    })
    const first = await startSupervisorCancel({
      stateDir: directory,
      runId: 'tui-cancel-run',
      operationId: 'tui-cancel-operation',
      capabilityToken: route.capabilityToken,
    })
    const replay = await startSupervisorCancel({
      stateDir: directory,
      runId: 'tui-cancel-run',
      operationId: 'tui-cancel-operation',
      capabilityToken: route.capabilityToken,
    })
    expect(first).toMatchObject({ status: 'accepted', effect: 'cancel_requested' })
    expect(replay).toEqual(first)
    expect(cancellations).toBe(1)
    route.close('cancelled')
  })
})
