import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { leafSeam, offlineProfile } from '../../examples/graphs/shared'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { type CoordinationEvent, createCoordinationTools } from '../../src/mcp/tools/coordination'
import { FileCoordinationLog } from '../../src/runtime/supervise/coordination-log'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, Scope } from '../../src/runtime/supervise/types'

function call(tools: ReturnType<typeof createCoordinationTools>, name: string, args = {}) {
  const tool = tools.tools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`missing tool ${name}`)
  return tool.handler(args)
}

describe('native analyst assignment recovery', () => {
  it('replays a review as a finding, with its original source and profile, never as research', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'analyst-recovery-'))
    try {
      const log = new FileCoordinationLog(join(dir, 'coordination.jsonl'))
      const journal = new InMemorySpawnJournal()
      const blobs = new InMemoryResultBlobStore()
      const received: AgentProfile[] = []
      const makeWorkerAgent = leafSeam(received, {
        research: { withTrace: true, shots: [{ out: { claim: 'candidate' }, valid: true }] },
        reviewer: {
          shots: [{ out: { critique: 'needs independent validation' }, valid: true, score: 100 }],
        },
      })
      const runId = 'analyst-recovery'
      const events: CoordinationEvent[] = []
      const opts = {
        budget: { maxIterations: 20, maxTokens: 50_000 },
        runId,
        journal,
        blobs,
        executors: createExecutorRegistry(),
        maxDepth: 2,
        rootIdentity: {
          profileDigest: canonicalCandidateDigest({ profile: 'root' }),
          taskDigest: canonicalCandidateDigest('research'),
        },
      }
      const common = {
        blobs,
        makeWorkerAgent,
        perWorker: { maxIterations: 3, maxTokens: 3_000 },
        onEvent: async (event: CoordinationEvent, record: Parameters<typeof log.append>[1]) => {
          events.push(event)
          await log.append(runId, record, 'root')
        },
      }
      const root: Agent<unknown, unknown> = {
        name: 'root',
        act: async (_task, scope) => {
          const tools = createCoordinationTools({
            ...common,
            scope,
            analyzeOnSettle: [
              {
                kind: 'research-critique',
                agent: offlineProfile('reviewer', 'Critique the evidence.'),
                directive: 'Assess evidence quality, not acceptance.',
              },
            ],
          })
          await call(tools, 'spawn_worker', {
            profile: offlineProfile('research', 'Produce a candidate.'),
            task: 'candidate',
          })
          expect(await call(tools, 'await_event')).toMatchObject({ type: 'settled' })
          expect(await call(tools, 'await_event')).toMatchObject({
            type: 'finding',
            analyst: 'research-critique',
            assignmentId: 'analyst:research-critique:o0',
          })
          expect(tools.settled()).toHaveLength(1)
          throw new Error('controller lost after review, before root settlement')
        },
      }
      await createSupervisor().run(root, 'research', opts)
      const prior = await log.load(runId, 'root')
      const assignment = prior.records.find(
        (record) => record.event.type === 'analyst-assignment',
      )?.event
      expect(assignment).toMatchObject({
        type: 'analyst-assignment',
        assignment: {
          kind: 'research-critique',
          assignmentId: 'analyst:research-critique:o0',
          sourceTrace: { status: 'available' },
          directive: 'Assess evidence quality, not acceptance.',
        },
      })
      const firstFinding = events.find((event) => event.type === 'finding')
      expect(firstFinding).toMatchObject({
        type: 'finding',
        finding: {
          analystWorkerId: expect.any(String),
          assignmentId: 'analyst:research-critique:o0',
        },
      })
      events.length = 0
      const resumed: Agent<unknown, unknown> = {
        name: 'root',
        act: async (_task, scope) => {
          const tools = createCoordinationTools({
            ...common,
            scope,
            priorJournal: prior.records,
            replaySettlements: true,
            // Current route configuration is deliberately absent. The recorded assignment owns
            // the identity of already executed work, not the operator's new configuration.
          })
          await tools.ready()
          expect(tools.settled()).toHaveLength(1)
          expect(events.filter((event) => event.type === 'finding')).toEqual([firstFinding])
          expect(events.filter((event) => event.type === 'settled')).toHaveLength(1)
          return { recovered: true }
        },
      }
      const recovered = await createSupervisor().run(resumed, 'research', { ...opts, resume: true })
      expect(recovered.kind).toBe('winner')
      expect(received.map((profile) => profile.name)).toEqual(['research', 'reviewer'])
      expect(events.filter((event) => event.type === 'finding')).toEqual([firstFinding])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a legacy analyst without a source record before treating it as a worker', () => {
    const scope = {
      view: {
        root: 'root',
        nodes: [{ id: 'review', parent: 'root', assignmentId: 'analyst:legacy:o0' }],
      },
    } as unknown as Scope<unknown>
    expect(() =>
      createCoordinationTools({
        scope,
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: leafSeam([]),
        perWorker: { maxIterations: 1, maxTokens: 1_000 },
      }),
    ).toThrow(/no durable source record/)
  })
})
