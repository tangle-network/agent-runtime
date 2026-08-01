import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fullProfileMaterialization } from '../../src/agent/profile-materialization'
import type { CoordinationEvent, QuestionRecord } from '../../src/mcp/tools/coordination'
import { supervise } from '../../src/runtime/supervise/supervise'
import type {
  DriveHarness,
  DriveHarnessOwnerContext,
} from '../../src/runtime/supervise/supervisor-agent'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { scriptedBrain } from './scripted-brain'

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

function rootBrain() {
  const manager = {
    name: 'identical-manager',
    harness: 'codex',
    metadata: { role: 'driver' },
  }
  return scriptedBrain([
    {
      toolCalls: [
        {
          name: 'spawn_agent',
          arguments: { profile: manager, task: 'same task', key: 'manager-a' },
        },
        {
          name: 'spawn_agent',
          arguments: { profile: manager, task: 'same task', key: 'manager-b' },
        },
      ],
    },
    { toolCalls: [{ name: 'await_event', arguments: {} }] },
    { toolCalls: [{ name: 'await_event', arguments: {} }] },
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
    const profile = {
      name: 'root',
      harness: 'cli-base',
      prompt: { systemPrompt: 'Run both managers.' },
    } as const

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
        const manager = {
          name: 'identical-manager',
          harness: 'codex',
          metadata: { role: 'driver' },
        }
        return {
          toolCalls: [
            {
              id: 'spawn-a',
              name: 'spawn_agent',
              arguments: JSON.stringify({ profile: manager, task: 'same task', key: 'manager-a' }),
            },
            {
              id: 'spawn-b',
              name: 'spawn_agent',
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
      if (turn <= 4) {
        return {
          toolCalls: [{ id: `await-${turn}`, name: 'await_event', arguments: JSON.stringify({}) }],
        }
      }
      return { content: 'finished', toolCalls: [] }
    }

    await supervise(
      { name: 'root', harness: 'cli-base', prompt: { systemPrompt: 'Run both managers.' } },
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

  it('refuses one steerable harness instance reused across manager owners', async () => {
    const sharedHarness: DriveHarness = async () => {}
    sharedHarness.deliver = (): boolean => true
    const seen: Array<ReadonlyArray<Record<string, unknown>>> = []

    await supervise(
      { name: 'root', harness: 'cli-base', prompt: { systemPrompt: 'Run both managers.' } },
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
                  name: 'spawn_agent',
                  arguments: {
                    profile: {
                      name: 'identical-manager',
                      harness: 'codex',
                      metadata: { role: 'driver' },
                    },
                    task: 'same task',
                    key: 'manager-a',
                  },
                },
                {
                  name: 'spawn_agent',
                  arguments: {
                    profile: {
                      name: 'identical-manager',
                      harness: 'codex',
                      metadata: { role: 'driver' },
                    },
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
