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

it.each([
  {
    title: 'closes a native turn after cancelling a real child whose steer capture is blocked',
    rootSteerAtBoundary: false,
  },
  {
    title: 'consumes one root steer at the boundary while a real child steer capture is blocked',
    rootSteerAtBoundary: true,
  },
])('$title', async ({ rootSteerAtBoundary }) => {
  const directory = mkdtempSync(join(tmpdir(), 'native-control-cancel-'))
  const delivered = join(directory, 'delivered')
  const model = { provider: 'offline', default: 'offline-process' }
  const profile = { name: 'process-worker', harness: 'opencode' as const, model }
  let ready!: () => void
  const started = new Promise<void>((resolve) => {
    ready = resolve
  })
  let entered!: () => void
  const executorEntered = new Promise<void>((resolve) => {
    entered = resolve
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
      entered()
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
  const rootOperationId = 'root-during-worker-capture'
  const rootMessage = 'Consume this root correction while the worker capture is still blocked.'
  const tasks: string[] = []
  let instructionCaptures = 0
  let rootPublications = 0
  let captureReleased = false
  let rootAdmitted = false
  let drives = 0
  let workerId = ''
  let guard: ReturnType<typeof setTimeout> | undefined
  let guardDeadline = Number.POSITIVE_INFINITY
  let guardExpired = false
  const stages: { phase: string; at: number }[] = []
  const mark = (phase: string) => stages.push({ phase, at: Date.now() })
  const controller = new AbortController()
  // Dispatch can fail before execute: abort releases that wait, and the driver checks the
  // same signal before writing a steer, so cleanup can unwind and join the existing run.
  controller.signal.addEventListener('abort', entered, { once: true })
  let failBoundary!: (error: unknown) => void
  const boundaryFailure = new Promise<never>((_resolve, reject) => {
    failBoundary = reject
  })
  let verified = false
  const run = supervisePursuit(
    {
      name: 'native-controller',
      harness: 'opencode',
      model,
      tools: {
        agent_runtime_coordination_spawn_worker: true,
        ...(rootSteerAtBoundary ? { agent_runtime_coordination_stop: true } : {}),
      },
    },
    'cancel the child before closing this native turn',
    {
      pursuitId: runId,
      runId,
      runDir: directory,
      steerDir: directory,
      signal: controller.signal,
      budget: { maxIterations: 10, maxTokens: 1000 },
      perWorker: { maxIterations: 2, maxTokens: 100 },
      driverRetry: { enabled: false },
      ...(rootSteerAtBoundary ? { wake: { heartbeatMs: 50, debounceMs: 0 } } : {}),
      onDriverAttempt: (record) => {
        mark(`attempt-${record.attempt}`)
        if (
          rootSteerAtBoundary &&
          record.attempt === 1 &&
          record.error === undefined &&
          rootAdmitted
        ) {
          const acknowledgement = readWorkerSteerAcknowledgement(directory, rootOperationId)
          if (!guardExpired && !controller.signal.aborted && Date.now() < guardDeadline) {
            try {
              expect(
                acknowledgement,
                'ROOT_BOUNDARY_ADMISSION_MISSING: first live attempt must queue the root steer',
              ).toMatchObject({ effect: 'unknown' })
            } catch (error) {
              // Surface the public observer's failure even if manager error teardown is waiting
              // for the intentionally held capture; cleanup still aborts and joins that lifetime.
              failBoundary(error)
              throw error
            }
          }
        }
      },
      makeWorkerAgent: () => worker,
      onCoordinationEvent: async (_context, _eventId, record) => {
        if (record.event.type === 'instruction') {
          mark('worker-capture')
          instructionCaptures += 1
          captured()
          await capture
        }
        if (
          record.event.type === 'lead-message' &&
          record.event.message.messageId === rootOperationId
        ) {
          rootPublications += 1
        }
      },
      driveHarness: async ({ coordinationMcpUrl, task }) => {
        mark(`drive-${drives + 1}`)
        tasks.push(String(task))
        if (drives++ > 0) {
          if (rootSteerAtBoundary && String(task).includes(rootMessage)) {
            expect(captureReleased).toBe(false)
            const stopped = await fetch(coordinationMcpUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: { name: 'stop', arguments: {} },
              }),
            })
            const stopBody = await stopped.json()
            if (!stopped.ok || stopBody.error || stopBody.result?.isError) {
              throw new Error(JSON.stringify(stopBody))
            }
          }
          return
        }
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
        await executorEntered
        controller.signal.throwIfAborted()
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
        if (rootSteerAtBoundary) {
          await closed
          // The observer's timer is still awaiting this worker's durable capture. A new root
          // request must be admitted at the boundary without joining or replaying that delivery.
          const options = {
            eventDir: directory,
            operationId: rootOperationId,
            message: rootMessage,
          }
          mark('root-admission-start')
          expect(writeWorkerSteer(directory, runId, runId, options).replayed).toBe(false)
          mark('root-admission-returned')
          rootAdmitted = true
          expect(writeWorkerSteer(directory, runId, runId, options).replayed).toBe(true)
          expect(readWorkerSteerAcknowledgement(directory, rootOperationId)).toBeUndefined()
        }
      },
    },
  )
  try {
    guardDeadline = Date.now() + 5000
    await Promise.race([
      run,
      boundaryFailure,
      new Promise<never>((_resolve, reject) => {
        guard = setTimeout(() => {
          guardExpired = true
          mark('guard-expired')
          reject(new Error('native turn blocked on steer capture'))
        }, 5000)
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
    expect(instructionCaptures).toBe(1)
    if (rootSteerAtBoundary) {
      expect(readWorkerSteerAcknowledgement(directory, rootOperationId)).toMatchObject({
        effect: 'delivered',
      })
      expect(tasks.slice(1).some((task) => task.includes(rootMessage))).toBe(true)
      expect(rootPublications).toBe(1)
      const replay = writeWorkerSteer(directory, runId, runId, {
        eventDir: directory,
        operationId: rootOperationId,
        message: rootMessage,
      })
      expect(replay.replayed).toBe(true)
      expect(replay.acknowledgement?.effect).toBe('delivered')
      writeWorkerSteer(directory, runId, runId, {
        eventDir: directory,
        operationId: 'root-after-close',
        message: 'the root observer has ended',
      })
    }
    writeWorkerSteer(directory, runId, workerId, {
      eventDir: directory,
      operationId: 'after-close',
      message: 'the observer has ended',
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(readWorkerSteerAcknowledgement(directory, 'after-close')).toBeUndefined()
    expect(readWorkerSteerAcknowledgement(directory, 'root-after-close')).toBeUndefined()
    verified = true
  } catch (cause) {
    throw new Error(
      `native control fixture failed; retained ${directory}; stages=${JSON.stringify(stages)}`,
      { cause },
    )
  } finally {
    mark('cleanup')
    clearTimeout(guard)
    controller.abort(new Error('native control fixture cleanup'))
    captured()
    captureReleased = true
    release()
    child.kill('SIGTERM')
    await closed
    await run.catch(() => undefined)
    if (verified) rmSync(directory, { recursive: true, force: true })
  }
})
