import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { supervisePursuit } from '../../src/durable'
import {
  cancelWorker,
  readWorkerCancellation,
  readWorkerSteerAcknowledgement,
  writeWorkerSteer,
} from '../../src/runtime'
import type { Agent, AgentSpec, Executor } from '../../src/runtime/supervise/types'

it('closes a native turn after cancelling a real child whose steer capture is blocked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-control-cancel-'))
  const delivered = join(directory, 'delivered')
  const model = { provider: 'offline', default: 'offline-process' }
  const profile = { name: 'process-worker', harness: 'opencode' as const, model }
  let ready!: () => void
  const started = new Promise<void>((resolve) => {
    ready = resolve
  })
  let captured!: () => void
  const capturing = new Promise<void>((resolve) => {
    captured = resolve
  })
  let release!: () => void
  const capture = new Promise<void>((resolve) => {
    release = resolve
  })
  const child = spawn(
    process.execPath,
    [
      '-e',
      "const fs=require('node:fs');process.stdin.on('data',b=>fs.appendFileSync(process.argv[1],b));process.stdout.write('ready');setInterval(()=>{},1000)",
      delivered,
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  )
  child.stdout.once('data', ready)
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', () => resolve())
  })
  const executor: Executor<unknown> = {
    runtime: 'local-process',
    async execute(_task, signal) {
      const cancel = () => child.kill('SIGTERM')
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
      try {
        await closed
        throw new Error('native child cancelled')
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    },
    deliver(message) {
      return child.stdin.write(JSON.stringify(message))
    },
    async teardown() {
      child.kill('SIGTERM')
      await closed
      return { destroyed: true }
    },
  }
  const worker: Agent<unknown, unknown> & { executorSpec: AgentSpec } = {
    name: profile.name,
    act: async () => {
      throw new Error('the process executor owns execution')
    },
    executorSpec: { profile, harness: null, executor },
  }
  const runId = 'native-control-cancel'
  let drives = 0
  let workerId = ''
  let guard: ReturnType<typeof setTimeout> | undefined
  const run = supervisePursuit(
    {
      name: 'native-controller',
      harness: 'opencode',
      model,
      tools: { agent_runtime_coordination_spawn_worker: true },
    },
    'cancel the child before closing this native turn',
    {
      pursuitId: runId,
      runId,
      runDir: directory,
      steerDir: directory,
      budget: { maxIterations: 10, maxTokens: 1000 },
      perWorker: { maxIterations: 2, maxTokens: 100 },
      driverRetry: { enabled: false },
      makeWorkerAgent: () => worker,
      onCoordinationEvent: async (_context, _eventId, record) => {
        if (record.event.type === 'instruction') {
          captured()
          await capture
        }
      },
      driveHarness: async ({ coordinationMcpUrl }) => {
        if (drives++ > 0) return
        const response = await fetch(coordinationMcpUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'spawn_worker', arguments: { profile, task: 'wait' } },
          }),
        })
        const body = await response.json()
        if (!response.ok || body.error || body.result?.isError) {
          throw new Error(JSON.stringify(body))
        }
        workerId = JSON.parse(body.result.content[0].text).workerId
        await started
        writeWorkerSteer(directory, runId, workerId, {
          eventDir: directory,
          operationId: 'blocked-capture',
          message: 'persist before delivery',
        })
        await capturing
        cancelWorker(directory, workerId, 'cancel-blocked-capture')
        await expect
          .poll(() => readWorkerCancellation(directory, 'cancel-blocked-capture')?.effect)
          .toMatch(/^(cancel_requested|cancelled)$/)
      },
    },
  )
  try {
    await Promise.race([
      run,
      new Promise<never>((_resolve, reject) => {
        guard = setTimeout(() => reject(new Error('native turn blocked on steer capture')), 5000)
      }),
    ])
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(readWorkerCancellation(directory, 'cancel-blocked-capture')).toMatchObject({
      effect: 'cancelled',
    })
    expect(readWorkerSteerAcknowledgement(directory, 'blocked-capture')).toMatchObject({
      effect: 'unknown',
    })
    expect(existsSync(delivered)).toBe(false)
    writeWorkerSteer(directory, runId, workerId, {
      eventDir: directory,
      operationId: 'after-close',
      message: 'the observer has ended',
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(readWorkerSteerAcknowledgement(directory, 'after-close')).toBeUndefined()
  } finally {
    clearTimeout(guard)
    captured()
    release()
    child.kill('SIGTERM')
    await closed
    await run
    rmSync(directory, { recursive: true, force: true })
  }
})
