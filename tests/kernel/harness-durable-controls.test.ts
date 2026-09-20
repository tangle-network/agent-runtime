import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileSpawnJournal, InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import type { MakeWorkerAgent } from '../../src/mcp/tools/coordination'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import {
  cancelWorker,
  readWorkerCancellation,
  readWorkerSteerAcknowledgement,
  supervisorRunDir,
  writeWorkerSteer,
} from '../../src/runtime/supervise/run-layout'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import {
  type DriveHarness,
  type SupervisorAgentDeps,
  supervisorAgent,
} from '../../src/runtime/supervise/supervisor-agent'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const dirs: string[] = []
const runId = 'harness-controls'
const exec = promisify(execFile)

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function deferred() {
  let resolve!: () => void
  let resolved = false
  const promise = new Promise<void>((done) => {
    resolve = () => {
      resolved = true
      done()
    }
  })
  return {
    promise,
    resolve,
    get resolved() {
      return resolved
    },
  }
}

function layout() {
  const root = mkdtempSync(join(tmpdir(), 'harness-controls-'))
  dirs.push(root)
  return { root, dir: supervisorRunDir(root, runId) }
}

function controlledLeaf(name: string, steerable = true) {
  const started = deferred()
  const completed = deferred()
  const aborted = vi.fn()
  const delivered = vi.fn()
  const artifact: ExecutorResult<unknown> = {
    outRef: `worker:${name}`,
    out: name,
    verdict: { valid: true, score: 1 },
    spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
  }
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute(_task, signal) {
      started.resolve()
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          aborted()
          reject(new Error('worker aborted'))
        }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
        void completed.promise.then(() => {
          signal.removeEventListener('abort', onAbort)
          resolve(artifact)
        })
      })
    },
    ...(steerable
      ? {
          deliver(message: unknown) {
            delivered(message)
            return true
          },
        }
      : {}),
    teardown: async () => ({ destroyed: true }),
    resultArtifact: () => artifact,
  }
  const agent: Agent<unknown, unknown> & { executorSpec: AgentSpec } = {
    name,
    act: async () => artifact.out,
    executorSpec: { profile: testAgentProfile(name), harness: null, executor },
  }
  return { agent, started, completed, aborted, delivered }
}

async function call(url: string, name: string, args: unknown = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = await response.json()
  expect(body.error).toBeUndefined()
  const result = JSON.parse(body.result.content[0].text)
  expect(result.error).toBeUndefined()
  return result
}

async function runHarness(
  dir: string,
  drive: DriveHarness,
  makeWorkerAgent: MakeWorkerAgent,
  options: Partial<SupervisorAgentDeps> & { journal?: FileSpawnJournal } = {},
) {
  const { journal: sharedJournal, ...deps } = options
  const blobs = deps.blobs ?? new InMemoryResultBlobStore()
  const journal = sharedJournal ?? new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
  let failure: { error: unknown } | undefined
  const driveHarness: DriveHarness = async (input) => {
    try {
      await drive(input)
    } catch (error) {
      failure = { error }
      throw error
    }
  }
  if (drive.deliver) driveHarness.deliver = drive.deliver.bind(drive)
  const root = supervisorAgent(
    testAgentProfile('root', {
      harness: 'opencode',
      tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
    }),
    {
      blobs,
      makeWorkerAgent,
      perWorker: { maxIterations: 10, maxTokens: 1000 },
      driveHarness,
      driverRetry: { enabled: false },
      controlDir: dir,
      ...deps,
    },
  )
  const result = await createSupervisor<unknown, unknown>().run(root, 'work', {
    budget: { maxIterations: 100, maxTokens: 100_000 },
    runId,
    journal,
    blobs,
    executors: withDriverExecutor(createExecutorRegistry()),
    maxDepth: 4,
  })
  if (failure) throw failure.error
  return result
}

describe('durable worker controls during a native harness invocation', () => {
  it.each([true, false])(
    'acknowledges root steering with native inbox support=%s',
    async (supported) => {
      const { root, dir } = layout()
      const deliver = vi.fn(() => true)
      const drive: DriveHarness = async () => {
        await exec(process.execPath, [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `const { writeWorkerSteer } = await import(process.argv[1]);
         for (let i = 0; i < 2; i++) writeWorkerSteer(process.argv[2], process.argv[3], process.argv[3], {
           operationId: 'native-root-steer', message: 'Inspect the latest evidence.', interrupt: true,
         });`,
          fileURLToPath(new URL('../../src/runtime/supervise/run-layout.ts', import.meta.url)),
          root,
          runId,
        ])
        await expect
          .poll(() => readWorkerSteerAcknowledgement(dir, 'native-root-steer'), { timeout: 2000 })
          .toMatchObject({ effect: supported ? 'delivered' : 'unsupported', worker: runId })
      }
      if (supported) drive.deliver = deliver
      await runHarness(dir, drive, () => {
        throw new Error('no child expected')
      })
      if (supported)
        expect(deliver).toHaveBeenCalledExactlyOnceWith({
          steer: 'Inspect the latest evidence.',
          interrupt: true,
        })
      else expect(deliver).not.toHaveBeenCalled()
    },
  )

  it('delivers a steer written by another process once before the harness returns', async () => {
    const { root, dir } = layout()
    const worker = controlledLeaf('worker')
    const drive = vi.fn<DriveHarness>(async ({ coordinationMcpUrl }) => {
      const spawned = await call(coordinationMcpUrl, 'spawn_worker', {
        profile: testAgentProfile('worker'),
        task: 'wait for an operator steer',
      })
      await worker.started.promise
      await exec(process.execPath, [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `const { writeWorkerSteer } = await import(process.argv[1]);
         for (let i = 0; i < 2; i++) writeWorkerSteer(process.argv[2], process.argv[3], process.argv[4], {
           operationId: 'external-steer', message: 'inspect the evidence', interrupt: true,
         });`,
        fileURLToPath(new URL('../../src/runtime/supervise/run-layout.ts', import.meta.url)),
        root,
        runId,
        spawned.workerId,
      ])
      await expect
        .poll(() => readWorkerSteerAcknowledgement(dir, 'external-steer'), { timeout: 2000 })
        .toMatchObject({ worker: spawned.workerId, effect: 'delivered' })
      expect(worker.delivered).toHaveBeenCalledExactlyOnceWith({
        steer: 'inspect the evidence',
        interrupt: true,
      })
      worker.completed.resolve()
      await call(coordinationMcpUrl, 'await_event')
    })
    const result = await runHarness(dir, drive, () => worker.agent)
    expect(result.kind).toBe('winner')
    expect(drive).toHaveBeenCalledTimes(1)
  })

  it('cancels one worker while a sibling remains live, then acknowledges the terminal result', async () => {
    const { dir } = layout()
    const worker = controlledLeaf('cancelled')
    const sibling = controlledLeaf('sibling')
    await runHarness(
      dir,
      async ({ coordinationMcpUrl }) => {
        const spawned = await call(coordinationMcpUrl, 'spawn_worker', {
          profile: testAgentProfile('cancelled'),
          task: 'wait',
        })
        await call(coordinationMcpUrl, 'spawn_worker', {
          profile: testAgentProfile('sibling'),
          task: 'wait',
        })
        await Promise.all([worker.started.promise, sibling.started.promise])
        cancelWorker(dir, spawned.workerId, 'external-cancel')
        cancelWorker(dir, spawned.workerId, 'external-cancel')
        await expect
          .poll(() => readWorkerCancellation(dir, 'external-cancel'), { timeout: 2000 })
          .toMatchObject({ effect: 'cancel_requested', terminated: [] })
        expect(worker.aborted).toHaveBeenCalledTimes(1)
        expect(sibling.aborted).not.toHaveBeenCalled()
        await call(coordinationMcpUrl, 'await_event')
        await expect
          .poll(() => readWorkerCancellation(dir, 'external-cancel'), { timeout: 2000 })
          .toMatchObject({ effect: 'cancelled', terminated: [spawned.workerId] })
        sibling.completed.resolve()
        await call(coordinationMcpUrl, 'await_event')
      },
      (profile: AgentProfile) => (profile.name === 'cancelled' ? worker.agent : sibling.agent),
    )
    expect(sibling.aborted).not.toHaveBeenCalled()
  })

  it('reports a worker without an inbox as unsupported', async () => {
    const { root, dir } = layout()
    const worker = controlledLeaf('worker', false)
    await runHarness(
      dir,
      async ({ coordinationMcpUrl }) => {
        const spawned = await call(coordinationMcpUrl, 'spawn_worker', {
          profile: testAgentProfile('worker'),
          task: 'wait',
        })
        await worker.started.promise
        writeWorkerSteer(root, runId, spawned.workerId, {
          operationId: 'unsupported',
          message: 'new requirement',
        })
        await expect
          .poll(() => readWorkerSteerAcknowledgement(dir, 'unsupported'), { timeout: 2000 })
          .toMatchObject({ effect: 'unsupported' })
        worker.completed.resolve()
        await call(coordinationMcpUrl, 'await_event')
      },
      () => worker.agent,
    )
    expect(worker.delivered).not.toHaveBeenCalled()
  })

  it('cancels during a blocked steer and closes without waiting for its event callback', async () => {
    const { root, dir } = layout()
    const worker = controlledLeaf('worker')
    const instructionStarted = deferred()
    const releaseInstruction = deferred()
    try {
      await runHarness(
        dir,
        async ({ coordinationMcpUrl }) => {
          const spawned = await call(coordinationMcpUrl, 'spawn_worker', {
            profile: testAgentProfile('worker'),
            task: 'wait',
          })
          await worker.started.promise
          writeWorkerSteer(root, runId, spawned.workerId, {
            operationId: 'blocked-steer',
            message: 'wait for durable event capture',
          })
          await instructionStarted.promise
          cancelWorker(dir, spawned.workerId, 'cancel-after-steer')
          await expect
            .poll(() => readWorkerCancellation(dir, 'cancel-after-steer'), { timeout: 2000 })
            .toMatchObject({ effect: 'cancel_requested', terminated: [] })
          await call(coordinationMcpUrl, 'await_event')
        },
        () => worker.agent,
        {
          onEvent: async (event) => {
            if (event.type === 'instruction') {
              instructionStarted.resolve()
              await releaseInstruction.promise
            }
          },
        },
      )
      expect(readWorkerCancellation(dir, 'cancel-after-steer')).toMatchObject({
        effect: 'cancelled',
      })
      expect(readWorkerSteerAcknowledgement(dir, 'blocked-steer')).toMatchObject({
        effect: 'unknown',
      })
      expect(worker.delivered).not.toHaveBeenCalled()
    } finally {
      releaseInstruction.resolve()
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(worker.delivered).not.toHaveBeenCalled()
  })

  it('routes descendant IDs to their manager and label cancellations only to the root', async () => {
    const { root, dir } = layout()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    const nestedWorker = controlledLeaf('nested-worker')
    const rootWorker = controlledLeaf('root-worker')
    const nestedReady = deferred()
    let nestedId = ''
    const makeWorker: MakeWorkerAgent = (profile) => {
      if (profile.name === 'root-worker') return rootWorker.agent
      if (profile.name === 'nested-worker') return nestedWorker.agent
      return driverChild(
        profile,
        supervisorAgent(profile, {
          blobs,
          makeWorkerAgent: makeWorker,
          perWorker: { maxIterations: 4, maxTokens: 500 },
          controlDir: dir,
          controlScope: 'subtree',
          driverRetry: { enabled: false },
          driveHarness: async ({ coordinationMcpUrl }) => {
            const spawned = await call(coordinationMcpUrl, 'spawn_worker', {
              profile: testAgentProfile('nested-worker'),
              task: 'wait',
              label: 'duplicate',
            })
            nestedId = spawned.workerId
            await nestedWorker.started.promise
            nestedReady.resolve()
            await call(coordinationMcpUrl, 'await_event')
          },
        }),
        journal,
      )
    }
    await runHarness(
      dir,
      async ({ coordinationMcpUrl }) => {
        await call(coordinationMcpUrl, 'spawn_worker', {
          profile: testAgentProfile('lead', {
            harness: 'opencode',
            tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
          }),
          task: 'manage a child',
        })
        const peer = await call(coordinationMcpUrl, 'spawn_worker', {
          profile: testAgentProfile('root-worker'),
          task: 'wait',
          label: 'duplicate',
        })
        await expect
          .poll(
            () => ({
              nestedReady: nestedReady.resolved,
              rootReady: rootWorker.started.resolved,
            }),
            { timeout: 2000 },
          )
          .toEqual({ nestedReady: true, rootReady: true })
        cancelWorker(dir, 'duplicate', 'root-label')
        await expect
          .poll(() => readWorkerCancellation(dir, 'root-label'), { timeout: 2000 })
          .toMatchObject({ effect: 'cancel_requested', workerId: peer.workerId })
        expect(nestedWorker.aborted).not.toHaveBeenCalled()
        writeWorkerSteer(root, runId, nestedId, {
          operationId: 'nested-steer',
          message: 'check the result',
        })
        await expect
          .poll(() => readWorkerSteerAcknowledgement(dir, 'nested-steer'), { timeout: 2000 })
          .toMatchObject({ effect: 'delivered', worker: nestedId })
        expect(nestedWorker.delivered).toHaveBeenCalledExactlyOnceWith({
          steer: 'check the result',
          interrupt: false,
        })
        cancelWorker(dir, nestedId, 'nested-cancel')
        await expect
          .poll(() => readWorkerCancellation(dir, 'nested-cancel'), { timeout: 2000 })
          .toMatchObject({ effect: 'cancelled', workerId: nestedId, terminated: [nestedId] })
        await call(coordinationMcpUrl, 'await_event')
        await call(coordinationMcpUrl, 'await_event')
      },
      makeWorker,
      { blobs, journal },
    )
    expect(rootWorker.aborted).toHaveBeenCalledTimes(1)
    expect(nestedWorker.aborted).toHaveBeenCalledTimes(1)
  })

  it('expires late controls and stops observing after the harness ends', async () => {
    const { root, dir } = layout()
    const worker = controlledLeaf('worker')
    let workerId = ''
    await runHarness(
      dir,
      async ({ coordinationMcpUrl }) => {
        const spawned = await call(coordinationMcpUrl, 'spawn_worker', {
          profile: testAgentProfile('worker'),
          task: 'wait',
        })
        workerId = spawned.workerId
        await worker.started.promise
        cancelWorker(dir, workerId, 'late-cancel')
        writeWorkerSteer(root, runId, workerId, { operationId: 'late-steer', message: 'too late' })
      },
      () => worker.agent,
    )
    expect(readWorkerCancellation(dir, 'late-cancel')).toMatchObject({
      effect: 'not_live',
      terminated: [],
    })
    expect(readWorkerSteerAcknowledgement(dir, 'late-steer')).toMatchObject({ effect: 'not_live' })
    expect(worker.delivered).not.toHaveBeenCalled()
    writeWorkerSteer(root, runId, workerId, {
      operationId: 'after-close',
      message: 'already closed',
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 150))
    expect(readWorkerSteerAcknowledgement(dir, 'after-close')).toBeUndefined()
  })
})
