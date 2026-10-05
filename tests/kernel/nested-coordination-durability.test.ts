import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fullProfileMaterialization } from '../../src/agent/profile-materialization'
import type { CoordinationEvent, QuestionRecord } from '../../src/mcp/tools/coordination'
import type {
  DriveHarness,
  DriveHarnessOwnerContext,
} from '../../src/runtime/supervise/supervisor-agent'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const rootTools = runtimeToolDeclarations('spawn_worker', 'steer_agent')
const managerTools = runtimeToolDeclarations('list_questions', 'ask_parent')

async function callTool(
  url: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${name}-${Math.random()}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const envelope = (await response.json()) as {
    result?: {
      structuredContent?: Record<string, unknown>
      content?: Array<{ type: string; text?: string }>
    }
    error?: unknown
  }
  if (!envelope.result) throw new Error(`tool ${name} failed: ${JSON.stringify(envelope.error)}`)
  if (envelope.result.structuredContent) return envelope.result.structuredContent
  const text = envelope.result.content?.find((entry) => entry.type === 'text')?.text
  return text ? (JSON.parse(text) as Record<string, unknown>) : {}
}

/** A leaf that does nothing until `gate` opens, so its manager has work open until then. */
function gatedLeaf(gate: Promise<void>): Agent<unknown, unknown> {
  const artifact: ExecutorResult<unknown> = {
    outRef: 'w:held',
    out: { held: true },
    verdict: { valid: true, score: 1 },
    spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
  }
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute: () => gate.then(() => artifact),
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => artifact,
  }
  const spec: AgentSpec = { profile: testAgentProfile('held-worker'), harness: null, executor }
  return { name: 'held-worker', act: async () => artifact.out, executorSpec: spec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

function rootBrain() {
  const manager = testAgentProfile('identical-manager', {
    harness: 'codex',
    tools: managerTools,
  })
  return scriptedBrain([
    {
      toolCalls: [
        {
          name: 'spawn_worker',
          arguments: { profile: manager, task: 'same task', key: 'manager-a' },
        },
        {
          name: 'spawn_worker',
          arguments: { profile: manager, task: 'same task', key: 'manager-b' },
        },
      ],
    },
    { content: 'waiting for the managers' },
    { content: 'finished' },
  ])
}

describe('nested supervisor coordination durability', () => {
  let runDir: string

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'nested-coordination-'))
  })

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true })
  })

  it('isolates identical keyed siblings and restores each owner evidence on restart', async () => {
    const seenBeforeCurrentQuestion: QuestionRecord[][] = []
    let invocation = 0
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      const call = invocation++
      const listed = await callTool(coordinationMcpUrl, 'list_questions', {})
      seenBeforeCurrentQuestion.push((listed.questions ?? []) as QuestionRecord[])
      await callTool(coordinationMcpUrl, 'ask_parent', {
        from: 'identical-manager',
        level: 'driver',
        question: `question from invocation ${call}`,
        reason: 'durable owner-isolation proof',
        urgency: 'continue-without',
      })
      // Restart failed managers explicitly; completed unassessed managers are replayable.
      if (call < 2) throw new Error('interrupt manager after recording its question')
    }
    const options = {
      backend: {
        backend: 'router',
        routerBaseUrl: 'http://unused.invalid',
        routerKey: 'unused',
        model: 'unused/model',
      } as const,
      budget: { maxIterations: 16, maxTokens: 10_000 },
      perWorker: { maxIterations: 4, maxTokens: 1_000 },
      runDir,
      runId: 'nested-owner-run',
      driveHarness,
      driveHarnessMaterialization: fullProfileMaterialization,
      maxTurns: 8,
    }
    const profile = testAgentProfile('root', {
      harness: 'cli-base',
      tools: rootTools,
      prompt: { systemPrompt: 'Run both managers.' },
    })

    await supervise(profile, 'root task', { ...options, brain: rootBrain() })
    await supervise(profile, 'root task', { ...options, brain: rootBrain() })

    expect(seenBeforeCurrentQuestion).toHaveLength(4)
    expect(seenBeforeCurrentQuestion.slice(0, 2)).toEqual([[], []])
    for (const prior of seenBeforeCurrentQuestion.slice(2)) {
      expect(prior).toHaveLength(1)
      expect(prior[0]?.question).toMatch(/^question from invocation [01]$/)
    }

    const records = (await readFile(join(runDir, 'coordination-log.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            ownerId?: string
            event: CoordinationEvent
          },
      )
      .filter((record) => record.event.type === 'question')
    const counts = new Map<string, number>()
    for (const record of records) {
      if (!record.ownerId) throw new Error('nested coordination record has no owner')
      counts.set(record.ownerId, (counts.get(record.ownerId) ?? 0) + 1)
    }
    expect([...counts.values()].sort()).toEqual([2, 2])
  })

  it('routes concurrent manager steers through distinct owner-scoped harness sessions', async () => {
    const contexts: DriveHarnessOwnerContext[] = []
    const delivered = new Map<string, unknown>()
    let startedCount = 0
    let bothStarted!: () => void
    const bothManagersStarted = new Promise<void>((resolve) => {
      bothStarted = resolve
    })
    const resolveDriveHarness = (context: DriveHarnessOwnerContext): DriveHarness => {
      contexts.push(context)
      let release!: () => void
      const steered = new Promise<void>((resolve) => {
        release = resolve
      })
      const harness: DriveHarness = async () => {
        startedCount += 1
        if (startedCount === 2) bothStarted()
        await steered
      }
      harness.deliver = (message): boolean => {
        delivered.set(context.assignmentId ?? 'root', message)
        release()
        return true
      }
      return harness
    }
    let turn = 0
    const brain: ToolLoopChat = async () => {
      turn += 1
      if (turn === 1) {
        const manager = testAgentProfile('identical-manager', {
          harness: 'codex',
          tools: managerTools,
        })
        return {
          toolCalls: [
            {
              id: 'spawn-a',
              name: 'spawn_worker',
              arguments: JSON.stringify({ profile: manager, task: 'same task', key: 'manager-a' }),
            },
            {
              id: 'spawn-b',
              name: 'spawn_worker',
              arguments: JSON.stringify({ profile: manager, task: 'same task', key: 'manager-b' }),
            },
          ],
        }
      }
      if (turn === 2) {
        await bothManagersStarted
        return {
          toolCalls: [
            {
              id: 'steer-a',
              name: 'steer_agent',
              arguments: JSON.stringify({
                workerId: 'owner-routed:s0',
                instruction: 'instruction for manager A',
              }),
            },
            {
              id: 'steer-b',
              name: 'steer_agent',
              arguments: JSON.stringify({
                workerId: 'owner-routed:s1',
                instruction: 'instruction for manager B',
              }),
            },
          ],
        }
      }
      if (turn === 3) return { content: 'waiting for the managers', toolCalls: [] }
      return { content: 'finished', toolCalls: [] }
    }

    await supervise(
      testAgentProfile('root', {
        harness: 'cli-base',
        tools: rootTools,
        prompt: { systemPrompt: 'Run both managers.' },
      }),
      'root task',
      {
        backend: {
          backend: 'router',
          routerBaseUrl: 'http://unused.invalid',
          routerKey: 'unused',
          model: 'unused/model',
        },
        budget: { maxIterations: 16, maxTokens: 10_000 },
        perWorker: { maxIterations: 4, maxTokens: 1_000 },
        runId: 'owner-routed',
        resolveDriveHarness,
        driveHarnessMaterialization: fullProfileMaterialization,
        brain,
        maxTurns: 8,
      },
    )

    expect(contexts).toHaveLength(2)
    expect(new Set(contexts.map((context) => context.ownerId)).size).toBe(2)
    expect(contexts.map((context) => context.assignmentId).sort()).toEqual([
      'key:manager-a',
      'key:manager-b',
    ])
    for (const context of contexts) {
      expect(Object.isFrozen(context)).toBe(true)
      expect(Object.isFrozen(context.profile)).toBe(true)
      expect(Object.isFrozen(context.identity)).toBe(true)
    }
    expect(delivered).toEqual(
      new Map([
        ['key:manager-a', { steer: 'instruction for manager A', interrupt: false }],
        ['key:manager-b', { steer: 'instruction for manager B', interrupt: false }],
      ]),
    )
  })

  it('queues a steer for a child manager whose harness has no live inbox and delivers it with its next wake', async () => {
    const instruction = 'prefer the fresher evidence'
    const directorTasks: string[] = []
    let directorWaiting!: () => void
    const waiting = new Promise<void>((resolve) => {
      directorWaiting = resolve
    })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    // No `deliver` on this harness: the director has no inbox to take a message into.
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, task }) => {
      directorTasks.push(String(task))
      if (directorTasks.length > 1) {
        // Woken by the steer; the worker may finish now.
        release()
        return
      }
      await callTool(coordinationMcpUrl, 'spawn_worker', {
        profile: testAgentProfile('held-worker'),
        task: 'hold until released',
      })
      directorWaiting()
    }
    let turn = 0
    let steerReply: Record<string, unknown> | undefined
    const brain: ToolLoopChat = async (messages) => {
      turn += 1
      const lastTool = [...messages]
        .reverse()
        .find((message) => (message as { role?: string }).role === 'tool') as
        | { content?: string }
        | undefined
      const parsed = lastTool?.content
        ? (JSON.parse(lastTool.content) as Record<string, unknown>)
        : undefined
      if (turn === 1) {
        return {
          toolCalls: [
            {
              id: 'spawn',
              name: 'spawn_worker',
              arguments: JSON.stringify({
                profile: testAgentProfile('director', {
                  harness: 'codex',
                  tools: runtimeToolDeclarations('spawn_worker'),
                }),
                task: 'lead the worker',
                key: 'director',
              }),
            },
          ],
        }
      }
      if (turn === 2) {
        await waiting
        return {
          toolCalls: [
            {
              id: 'steer',
              name: 'steer_agent',
              arguments: JSON.stringify({ workerId: String(parsed?.workerId), instruction }),
            },
          ],
        }
      }
      if (turn === 3) steerReply = parsed
      return { content: 'waiting for the director', toolCalls: [] }
    }

    try {
      await supervise(
        testAgentProfile('root', {
          harness: 'cli-base',
          tools: rootTools,
          prompt: { systemPrompt: 'Lead the director.' },
        }),
        'root task',
        {
          budget: { maxIterations: 16, maxTokens: 10_000 },
          perWorker: { maxIterations: 4, maxTokens: 1_000 },
          runDir,
          runId: 'lead-message',
          driveHarness,
          makeLeafAgent: () => gatedLeaf(held),
          wake: { debounceMs: 0 },
          brain,
        },
      )
    } finally {
      release()
    }

    // The manager accepts the steer for its next turn; a missing inbox does not refuse it.
    expect(steerReply).toMatchObject({ delivered: true })
    expect(JSON.stringify(steerReply)).not.toContain('runtime-has-no-inbox')
    // Its harness was driven twice: the spawn turn, then the wake the steer started.
    expect(directorTasks).toHaveLength(3)
    expect(directorTasks[1]).toContain('"type":"lead-message"')
    expect(directorTasks[1]).toContain(instruction)
    const messages = (await readFile(join(runDir, 'coordination-log.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: CoordinationEvent })
      .filter((record) => record.event.type === 'lead-message')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.event).toMatchObject({
      type: 'lead-message',
      message: { kind: 'steer', text: instruction },
    })
  })

  it('refuses one steerable harness instance reused across manager owners', async () => {
    const sharedHarness: DriveHarness = async () => {}
    sharedHarness.deliver = (): boolean => true
    const seen: Array<ReadonlyArray<Record<string, unknown>>> = []

    await supervise(
      testAgentProfile('root', {
        harness: 'cli-base',
        tools: rootTools,
        prompt: { systemPrompt: 'Run both managers.' },
      }),
      'root task',
      {
        backend: {
          backend: 'router',
          routerBaseUrl: 'http://unused.invalid',
          routerKey: 'unused',
          model: 'unused/model',
        },
        budget: { maxIterations: 16, maxTokens: 10_000 },
        perWorker: { maxIterations: 4, maxTokens: 1_000 },
        runId: 'owner-reuse-refused',
        resolveDriveHarness: () => sharedHarness,
        driveHarnessMaterialization: fullProfileMaterialization,
        brain: scriptedBrain(
          [
            {
              toolCalls: [
                {
                  name: 'spawn_worker',
                  arguments: {
                    profile: testAgentProfile('identical-manager', {
                      harness: 'codex',
                      tools: managerTools,
                    }),
                    task: 'same task',
                    key: 'manager-a',
                  },
                },
                {
                  name: 'spawn_worker',
                  arguments: {
                    profile: testAgentProfile('identical-manager', {
                      harness: 'codex',
                      tools: managerTools,
                    }),
                    task: 'same task',
                    key: 'manager-b',
                  },
                },
              ],
            },
            { content: 'stop after reading the spawn results' },
          ],
          seen,
        ),
      },
    )

    expect(JSON.stringify(seen[1])).toContain(
      'steerable driveHarness is already bound to manager owner',
    )
    expect(JSON.stringify(seen[1])).toContain(
      'resolveDriveHarness must return a distinct steerable instance',
    )
  })
})
