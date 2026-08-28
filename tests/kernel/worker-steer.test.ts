/** Durable external steer delivery through the owning coordination manager. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { FileSpawnJournal, InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import {
  type DriverAgentOptions,
  driverAgent,
} from '../../src/runtime/supervise/coordination-driver'
import {
  readWorkerSteerAcknowledgement,
  supervisorRunDir,
  writeWorkerSteer,
} from '../../src/runtime/supervise/run-layout'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { type ScriptedTurn, scriptedBrain } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

const cleanups: string[] = []

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'worker-steer-manager-'))
  cleanups.push(root)
  return root
}

function steerableLeaf(onSteer: (message: unknown) => void): Agent<unknown, unknown> {
  let release!: () => void
  const steered = new Promise<void>((resolve) => {
    release = resolve
  })
  const artifact: ExecutorResult<unknown> = {
    outRef: 'steered-worker',
    out: { status: 'steered' },
    verdict: { valid: true, score: 1 },
    spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
  }
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute: async () => {
      await steered
      return artifact
    },
    deliver: (message) => {
      onSteer(message)
      release()
      return true
    },
    teardown: async () => ({ destroyed: true }),
    resultArtifact: () => artifact,
  }
  const spec: AgentSpec = { profile: testAgentProfile('worker'), harness: null, executor }
  return { name: 'worker', act: async () => artifact.out, executorSpec: spec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

function options(
  brain: ToolLoopChat,
  makeWorkerAgent: (profile: AgentProfile) => Agent<unknown, unknown>,
  blobs: InMemoryResultBlobStore,
  controlDir: string,
): DriverAgentOptions {
  return {
    name: 'root',
    brain,
    blobs,
    makeWorkerAgent,
    perWorker: { maxIterations: 2, maxTokens: 100 },
    systemPrompt: 'drive',
    maxTurns: 8,
    controlDir,
  }
}

describe('durable external worker steer', () => {
  it('admits one operation, delivers it once, and records the manager acknowledgement', async () => {
    const rootDir = tempRoot()
    const runId = 'run-steer'
    const controlDir = supervisorRunDir(rootDir, runId)
    const journal = new FileSpawnJournal(join(controlDir, 'spawn-journal.jsonl'))
    const blobs = new InMemoryResultBlobStore()
    const delivered: unknown[] = []
    const script = scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: { profile: { metadata: {} }, task: 'wait for a steer', label: 'worker' },
          },
        ],
      },
      { toolCalls: [{ name: 'list_questions', arguments: {} }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ] satisfies ScriptedTurn[])
    let turn = 0
    const brain: ToolLoopChat = async (messages, tools, context) => {
      if (turn === 1) {
        const first = writeWorkerSteer(rootDir, runId, `${runId}:s0`, {
          operationId: 'external-steer-1',
          message: 'inspect the failing test first',
          source: 'operator',
          interrupt: true,
        })
        const retry = writeWorkerSteer(rootDir, runId, `${runId}:s0`, {
          operationId: 'external-steer-1',
          message: 'inspect the failing test first',
          source: 'operator',
          interrupt: true,
        })
        expect(first.replayed).toBe(false)
        expect(retry.replayed).toBe(true)
      }
      turn += 1
      return script(messages, tools, context)
    }
    const root = driverAgent(
      options(brain, () => steerableLeaf((message) => delivered.push(message)), blobs, controlDir),
    )

    await createSupervisor<unknown, unknown>().run(root, 'task', {
      budget: { maxIterations: 20, maxTokens: 10_000 },
      runId,
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
    })

    expect(delivered).toEqual([{ steer: 'inspect the failing test first', interrupt: true }])
    expect(readWorkerSteerAcknowledgement(controlDir, 'external-steer-1')).toMatchObject({
      worker: `${runId}:s0`,
      effect: 'delivered',
      detail: 'the owning manager delivered the steer to the exact live worker',
    })
  })
})
