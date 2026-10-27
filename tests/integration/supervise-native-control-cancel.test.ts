import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { supervisePursuit } from '../../src/durable'
import {
  cancelWorker,
  createFileRunContext,
  createSupervisor,
  readWorkerCancellation,
  readWorkerSteerAcknowledgement,
  writeWorkerSteer,
} from '../../src/runtime'
import type { Agent, AgentSpec, Executor } from '../../src/runtime/supervise/types'
import {
  observe,
  physicalState,
  withInPlaceProcess,
  within,
} from '../helpers/in-place-process-fixture'

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

it.skipIf(process.platform === 'win32').each(['waiting', 'cleanup-failure'] as const)(
  'joins real in-place process/profile cleanup without a false positive (%s)',
  async (mode) => {
    await withInPlaceProcess(mode, async (fixture) => {
      const running = fixture.start()
      const ready = await fixture.ready()
      expect(ready.child).toBeTypeOf('number')
      expect(ready.inputBytes).toBe('MATERIALIZED_PROCESS_INPUT')
      expect(physicalState(ready)).toMatchObject({
        leaderPresent: true,
        childPresent: true,
        groupPresent: true,
        inputPresent: true,
      })
      // Execution still rejects; teardown names its immutable failure only after the actual
      // process/profile join. OLD supplies a false positive instead of permanent UNKNOWN.
      const answer = await within(observe(fixture.executor.teardown('infinity')))
      const atAnswer = physicalState(ready)
      fixture.record('teardown', { answer, atAnswer })
      const execution = await within(running)
      fixture.record('execution', execution)
      expect(
        answer.status,
        'teardown must not claim destroyed before its owned operation joins',
      ).toBe('fulfilled')
      if (answer.status !== 'fulfilled') throw answer.error
      expect(answer.value).toMatchObject({
        destroyed: false,
        permanent: true,
        detail: expect.any(String),
      })
      expect(execution.status).toBe('rejected')
      expect(atAnswer).toMatchObject({
        leaderPresent: false,
        childPresent: false,
        groupPresent: false,
      })
      expect(readFileSync(join(fixture.directory, 'descendant-flushed'), 'utf8')).toBe('clean')
      expect(readFileSync(join(fixture.directory, 'authored.txt'), 'utf8')).toBe(
        'caller-visible edit',
      )
      expect(readFileSync(join(fixture.directory, 'caller-owned.txt'), 'utf8')).toBe(
        'preserve caller bytes',
      )
      if (execution.status !== 'rejected' || !(execution.error instanceof Error))
        throw new Error('actual execution rejection was not retained')
      // Keep the original error/cause separately; the public receipt carries bounded diagnostic text.
      expect(answer.value.detail).toContain(execution.error.message)
      if (mode === 'cleanup-failure') {
        expect(execution.error).toHaveProperty('code', 'ERR_FS_EISDIR')
        expect(readFileSync(join(ready.inputPath, 'keep'), 'utf8')).toBe('real nonempty directory')
      } else {
        expect(atAnswer.inputPresent).toBe(false)
      }
    })
  },
)

it.skipIf(process.platform === 'win32')(
  'keeps public Scope cancellation unconfirmed while joining its real in-place cleanup',
  async () => {
    await withInPlaceProcess('waiting', async (fixture) => {
      const context = createFileRunContext(join(fixture.directory, 'run'))
      let exercise: Promise<void> | undefined
      let ownerDetail: string | undefined
      const worker: Agent<unknown, unknown> & { executorSpec: AgentSpec } = {
        name: fixture.profile.name,
        act: async () => {
          throw new Error('the public in-place executor owns the child')
        },
        executorSpec: { profile: fixture.profile, harness: null, executor: fixture.executor },
      }
      const root: Agent<unknown, unknown> = {
        name: 'in-place-process-owner',
        async act(_task, scope) {
          exercise = (async () => {
            const spawned = scope.spawn(worker, 'wait for caller cancellation', {
              label: 'in-place-process',
              budget: { maxTokens: 100, maxIterations: 1 },
            })
            if (!spawned.ok) throw new Error(`actual Scope refused process: ${spawned.reason}`)
            const ready = await fixture.ready()
            spawned.handle.abort('owned in-place process proof')
            const settled = await within(scope.next())
            const atSettlement = physicalState(ready)
            fixture.record('scope-settlement', { settled, atSettlement })
            expect(settled).toMatchObject({ kind: 'down' })
            // The crash path bounds Scope's acknowledgement wait. Its settlement is not a
            // physical-close receipt: join the SAME public executor before measuring closure.
            const answer = await within(observe(fixture.executor.teardown('infinity')))
            const afterJoin = physicalState(ready)
            fixture.record('scope-owner-join', { answer, afterJoin })
            expect(answer.status).toBe('fulfilled')
            if (answer.status !== 'fulfilled') throw answer.error
            expect(answer.value).toMatchObject({
              destroyed: false,
              permanent: true,
              detail: expect.any(String),
            })
            ownerDetail = answer.value.detail
            expect(ownerDetail?.length).toBeGreaterThan(0)
            expect(afterJoin).toEqual({
              leaderPresent: false,
              childPresent: false,
              groupPresent: false,
              inputPresent: false,
            })
            expect(readFileSync(join(fixture.directory, 'descendant-flushed'), 'utf8')).toBe(
              'clean',
            )
          })()
          await exercise
          return 'process cancellation observed'
        },
      }
      const run = createSupervisor().run(
        root,
        {},
        {
          ...context,
          runId: 'in-place-owned-cancellation',
          budget: { maxTokens: 1000, maxIterations: 10 },
          signal: fixture.controller.signal,
        },
      )
      const outcome = await observe(within(run, 5000))
      if (exercise) await exercise
      fixture.record('scope-result', outcome)
      if (outcome.status === 'rejected') throw outcome.error
      // The default confirmation policy must complete within the same 5s guard. The immutable
      // failure stays UNKNOWN; neither Scope settlement nor that status proves physical closure.
      const unconfirmed = outcome.value.teardownUnconfirmed?.find(
        (entry) => entry.label === 'in-place-process',
      )
      expect(unconfirmed).toBeDefined()
      if (ownerDetail === undefined) throw new Error('actual owner diagnostic missing')
      expect(unconfirmed?.detail).toContain(ownerDetail)
    })
  },
)

it.skipIf(process.platform === 'win32')(
  'preserves normal completion, never-started teardown and pre-aborted no-process refusal',
  async () => {
    await withInPlaceProcess('normal', async (fixture) => {
      expect(await fixture.executor.teardown('infinity')).toEqual({ destroyed: true })
      // Pure task validation can reject before a harness promise exists; no work was launched.
      const invalid = fixture.executor.execute(undefined, fixture.controller.signal)
      if (!('then' in invalid)) throw new Error('in-place execution unexpectedly streamed')
      expect((await within(observe(invalid))).status).toBe('rejected')
      expect(await fixture.executor.teardown('infinity')).toEqual({ destroyed: true })
      expect(existsSync(join(fixture.directory, 'ready.json'))).toBe(false)
    })
    await withInPlaceProcess('normal', async (fixture) => {
      const result = await within(fixture.start())
      expect(result.status).toBe('fulfilled')
      if (result.status !== 'fulfilled') throw result.error
      const ready = await fixture.ready()
      expect(result.value.spent.tokensKnown).toBe(false)
      expect(result.value.spent.tokens).toEqual({ input: 0, output: 0 })
      expect(result.value.out.harness.exitCode).toBe(0)
      for (const input of result.value.out.profileMaterialization?.writtenPaths ?? []) {
        expect(existsSync(join(fixture.directory, input))).toBe(false)
      }
      expect(physicalState(ready)).toEqual({
        leaderPresent: false,
        childPresent: false,
        groupPresent: false,
        inputPresent: false,
      })
      expect(await fixture.executor.teardown('infinity')).toEqual({ destroyed: true })
      expect(readFileSync(join(fixture.directory, 'authored.txt'), 'utf8')).toBe(
        'caller-visible edit',
      )
    })
    await withInPlaceProcess('normal', async (fixture) => {
      const preAborted = new AbortController()
      const cause = new Error('original pre-abort fixture cause')
      const reason = new Error('already aborted before owned invocation', { cause })
      preAborted.abort(reason)
      const result = await within(fixture.start(preAborted.signal))
      expect(result.status).toBe('rejected')
      if (result.status !== 'rejected')
        throw new Error('pre-aborted invocation unexpectedly completed')
      expect(result.error).toBe(reason)
      expect(result.error).toHaveProperty('cause', cause)
      const answer = await within(observe(fixture.executor.teardown('infinity')))
      expect(answer.status).toBe('fulfilled')
      if (answer.status !== 'fulfilled') throw answer.error
      expect(answer.value).toMatchObject({
        destroyed: false,
        permanent: true,
        detail: expect.any(String),
      })
      expect(answer.value.detail).toContain(reason.message)
      expect(answer.value.detail).toContain(cause.message)
      expect(existsSync(join(fixture.directory, 'ready.json'))).toBe(false)
      expect(existsSync(join(fixture.directory, 'authored.txt'))).toBe(false)
    })
  },
)
