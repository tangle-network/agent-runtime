import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fullProfileMaterialization } from '../../src/agent/profile-materialization'
import type { CoordinationEvent, QuestionRecord } from '../../src/mcp/tools/coordination'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
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
})
