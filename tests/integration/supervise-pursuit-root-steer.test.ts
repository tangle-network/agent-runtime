import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { supervisePursuit } from '../../src/durable'
import {
  type DriveHarness,
  readWorkerSteerAcknowledgement,
  supervisorRunDir,
  workerInboxFileFromEventDir,
  writeWorkerSteer,
} from '../../src/runtime'
import type { Agent, AgentSpec, ExecutorResult } from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function jsonRpc(url: string, method: string, params: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) throw new Error(`coordination MCP returned ${response.status}`)
  const body = await response.json()
  if (body.error || body.result?.isError) throw new Error(JSON.stringify(body))
}

/** A worker that settles once its gate opens, so the manager has work to wait for. */
function gatedWorker(gate: Promise<void>): Agent<unknown, unknown> {
  const result: ExecutorResult<unknown> = {
    outRef: 'root-steer:worker',
    out: { worker: 'done' },
    verdict: { valid: true, score: 1 },
    spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
  }
  const spec: AgentSpec = {
    profile: testAgentProfile('worker'),
    harness: null,
    executor: {
      runtime: 'root-steer-test-worker',
      execute: () => gate.then((): ExecutorResult<unknown> => result),
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: () => result,
    },
  }
  return { name: 'worker', act: async () => result.out, executorSpec: spec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

describe('supervisePursuit root steering', () => {
  it.each([false, true])(
    'consumes an admitted root steer with explicit event directory=%s',
    async (explicitEventDir) => {
      const root = mkdtempSync(join(tmpdir(), 'pursuit-root-steer-'))
      roots.push(root)
      const runId = 'public-root-steer'
      const operationId = 'public-root-steer-1'
      const eventDir = explicitEventDir ? join(root, 'flat-events') : supervisorRunDir(root, runId)
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })

      const steerOptions = {
        operationId,
        message: 'use the admitted root correction',
        interrupt: true,
        ...(explicitEventDir ? { eventDir } : {}),
      }
      const admitted = writeWorkerSteer(root, runId, runId, steerOptions)
      const retry = writeWorkerSteer(root, runId, runId, steerOptions)
      expect(admitted.replayed).toBe(false)
      expect(retry.replayed).toBe(true)

      // No harness inbox was live when the steer was admitted, so it waits as a lead-message
      // event. The first drive spawns a worker and ends its turn; the steer wakes the manager, and
      // the second drive's task carries it. The worker's settlement wakes the third drive.
      const tasks: string[] = []
      const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
        tasks.push(task)
        if (tasks.length === 1) {
          await jsonRpc(coordinationMcpUrl, 'tools/call', {
            name: 'spawn_worker',
            arguments: { profile: testAgentProfile('worker'), task: 'work', label: 'worker' },
          })
          return
        }
        if (tasks.length === 2) {
          release()
          return
        }
        await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'stop',
          arguments: {},
        })
      }

      await supervisePursuit(
        testAgentProfile('public-root-steer', {
          harness: 'codex',
          tools: runtimeToolDeclarations('spawn_worker', 'stop'),
        }),
        'drive the root',
        {
          pursuitId: 'pursuit:public-root-steer',
          runId,
          runDir: root,
          ...(explicitEventDir ? { steerDir: eventDir } : {}),
          budget: { maxIterations: 8, maxTokens: 10_000 },
          perWorker: { maxIterations: 1, maxTokens: 10 },
          driverRetry: { enabled: false },
          driveHarness,
          makeWorkerAgent: () => gatedWorker(gate),
        },
      )

      expect(tasks).toHaveLength(3)
      const leadMessages = tasks.flatMap((task) =>
        task
          .split('\n')
          .filter((line) => line.startsWith('- {'))
          .map((line) => JSON.parse(line.slice(2)))
          .filter((event) => event.type === 'lead-message'),
      )
      expect(leadMessages).toEqual([
        expect.objectContaining({ text: steerOptions.message, interrupt: true }),
      ])
      expect(tasks[1]).toContain('"type":"lead-message"')
      expect(readWorkerSteerAcknowledgement(root, operationId)).toBeUndefined()
      expect(readWorkerSteerAcknowledgement(eventDir, operationId)?.effect).toBe('delivered')
      const acknowledgedRetry = writeWorkerSteer(root, runId, runId, steerOptions)
      expect(acknowledgedRetry.replayed).toBe(true)
      expect(acknowledgedRetry.acknowledgement?.effect).toBe('delivered')
      const projected = readFileSync(workerInboxFileFromEventDir(eventDir, runId), 'utf8')
        .trim()
        .split('\n')
      expect(projected).toHaveLength(1)
      expect(JSON.parse(projected[0]!)).toMatchObject({
        operationId,
        message: steerOptions.message,
      })
      if (explicitEventDir)
        expect(existsSync(join(supervisorRunDir(root, runId), 'steers'))).toBe(false)
    },
  )
})
