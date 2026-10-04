import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { leafSeam, offlineProfile, scriptedBrain } from '../../examples/graphs/shared'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { type CoordinationEvent, createCoordinationTools } from '../../src/mcp/tools/coordination'
import { driverAgent } from '../../src/runtime/supervise/coordination-driver'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { supervisorAgent } from '../../src/runtime/supervise/supervisor-agent'
import type { Agent } from '../../src/runtime/supervise/types'

import { testContinuation } from '../helpers/continuation'

const identity = {
  profileDigest: canonicalCandidateDigest('root'),
  taskDigest: canonicalCandidateDigest('task'),
}
const perWorker = { maxIterations: 3, maxTokens: 3000 }
const route = {
  kind: 'scientific-review',
  at: 'manager-end' as const,
  agent: offlineProfile('reviewer', 'Assess source evidence.'),
}

describe('terminal native analysis', () => {
  it('automatically retains a final review through the driver without making it the winner', async () => {
    const blobs = new InMemoryResultBlobStore(),
      received: AgentProfile[] = [],
      tasks: string[] = []
    const events: CoordinationEvent[] = []
    const root = driverAgent({
      name: 'root',
      blobs,
      perWorker,
      toolNames: ['submit_result'],
      maxTurns: 1,
      deliverable: { check: () => true },
      brain: scriptedBrain([
        { toolCalls: [{ name: 'submit_result', arguments: { result: { answer: 42 } } }] },
      ]),
      makeWorkerAgent: leafSeam(
        received,
        { reviewer: { shots: [{ out: { verdict: 'inconclusive' }, valid: true, score: 100 }] } },
        { onSpawnContext: (_name, context) => tasks.push(String(context?.task)) },
      ),
      analyzeOnSettle: [route],
      onEvent: (event) => {
        events.push(event)
      },
    })
    const result = await createSupervisor().run(root, 'task', {
      runId: 'final-review',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      budget: { maxIterations: 20, maxTokens: 50000 },
      maxDepth: 2,
      rootIdentity: identity,
    })
    expect(result).toMatchObject({ kind: 'winner', out: { answer: 42 } })
    expect(received.map((p) => p.name)).toEqual(['reviewer'])
    expect(tasks[0]).toContain('"answer":42')
    expect(events.filter((event) => event.type === 'analyst-assignment')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'finding')).toMatchObject([
      {
        finding: {
          fromWorker: 'final-review',
          analyst: 'scientific-review',
          findings: { verdict: 'inconclusive' },
        },
      },
    ])
    expect(events.filter((event) => event.type === 'settled')).toHaveLength(0)
  })

  it('assesses a failed worker without tool spans, preserving its failure evidence', async () => {
    const blobs = new InMemoryResultBlobStore(),
      received: AgentProfile[] = [],
      tasks: string[] = []
    const events: CoordinationEvent[] = []
    const reviewer = leafSeam(
      received,
      {},
      { onSpawnContext: (_name, context) => tasks.push(String(context?.task)) },
    )
    const root: Agent<unknown, unknown> = {
      name: 'root',
      act: async (_task, scope) => {
        const coord = createCoordinationTools({
          scope,
          blobs,
          perWorker,
          makeWorkerAgent: (profile, context) =>
            profile.name === 'failure'
              ? {
                  name: 'failure',
                  act: async () => undefined,
                  executorSpec: {
                    profile,
                    harness: null,
                    executor: {
                      runtime: 'router',
                      execute: async () => {
                        throw new Error('measurement failed')
                      },
                      teardown: async () => ({ destroyed: true }),
                      resultArtifact: () => {
                        throw new Error('no output')
                      },
                    },
                  },
                }
              : reviewer(profile, context),
          analyzeOnSettle: [{ ...route, at: 'worker', statuses: ['down'] }],
          onEvent: (event) => {
            events.push(event)
          },
        })
        const call = (name: string, args = {}) =>
          coord.tools.find((tool) => tool.name === name)?.handler(args)
        expect(
          await call('spawn_worker', {
            profile: offlineProfile('failure', 'Measure.'),
            task: 'measure',
          }),
        ).toMatchObject({ workerId: expect.any(String) })
        await call('await_event')
        await call('await_event')
        expect(coord.settled()).toHaveLength(1)
        return { complete: true }
      },
    }
    const outcome = await createSupervisor().run(root, 'task', {
      runId: 'failed-review',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      budget: { maxIterations: 20, maxTokens: 50000 },
      maxDepth: 2,
      rootIdentity: identity,
    })
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: 'winner' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toContain('measurement failed')
    expect(tasks[0]).toContain('no tool spans available')
    expect(events.some((event) => event.type === 'finding')).toBe(true)
  })

  it('records a terminal review refusal when the original scope cannot reserve it', async () => {
    const blobs = new InMemoryResultBlobStore(),
      events: CoordinationEvent[] = [],
      received: AgentProfile[] = []
    const root: Agent<unknown, unknown> = {
      name: 'root',
      act: async (_task, scope) => {
        const coord = createCoordinationTools({
          scope,
          blobs,
          perWorker,
          makeWorkerAgent: leafSeam(received),
          analyzeOnSettle: [route],
          onEvent: (event) => {
            events.push(event)
          },
        })
        await coord.finishAnalysis({ status: 'down', reason: 'unresolved evidence' })
        await coord.finishAnalysis({ status: 'down', reason: 'unresolved evidence' })
        return undefined
      },
    }
    await createSupervisor().run(root, 'task', {
      runId: 'refused-review',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      budget: { maxIterations: 1, maxTokens: 1 },
      maxDepth: 2,
      rootIdentity: identity,
    })
    expect(received).toHaveLength(0)
    expect(events.filter((event) => event.type === 'analyst-assignment')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'finding')).toMatchObject([
      { finding: { findings: { analystSpawnRefused: expect.any(String) } } },
    ])
  })
  it('reuses a finished manager review after controller failure without another analyst spend', async () => {
    const blobs = new InMemoryResultBlobStore(),
      journal = new InMemorySpawnJournal()
    const received: AgentProfile[] = []
    let records: ReturnType<ReturnType<typeof createCoordinationTools>['history']> = []
    const makeWorkerAgent = leafSeam(received)
    const options = {
      runId: 'resume-final-review',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      budget: { maxIterations: 20, maxTokens: 50000 },
      maxDepth: 2,
      rootIdentity: identity,
    }
    const first: Agent<unknown, unknown> = {
      name: 'root',
      act: async (_task, scope) => {
        const coord = createCoordinationTools({
          scope,
          blobs,
          perWorker,
          makeWorkerAgent,
          analyzeOnSettle: [route],
        })
        await coord.finishAnalysis({ status: 'done', output: { answer: 42 } })
        records = coord.history()
        throw new Error('controller failed before root settlement')
      },
    }
    await createSupervisor().run(first, 'task', options)
    const resumed: Agent<unknown, unknown> = {
      name: 'root',
      act: async (_task, scope) => {
        const coord = createCoordinationTools({
          scope,
          blobs,
          perWorker,
          makeWorkerAgent,
          analyzeOnSettle: [route],
          priorJournal: records,
          replaySettlements: true,
        })
        await coord.ready()
        await coord.finishAnalysis({ status: 'done', output: { answer: 42 } })
        expect(coord.settled()).toHaveLength(0)
        return { answer: 42 }
      },
    }
    const result = await createSupervisor().run(resumed, 'task', { ...options, resume: true })
    expect(result).toMatchObject({ kind: 'winner', out: { answer: 42 } })
    expect(received).toHaveLength(1)
  })

  it('runs terminal assessment before the harness coordination endpoint closes', async () => {
    const blobs = new InMemoryResultBlobStore(),
      received: AgentProfile[] = [],
      events: CoordinationEvent[] = []
    const root = supervisorAgent(
      {
        ...offlineProfile('root', 'Produce result.'),
        harness: 'opencode',
        tools: { agent_runtime_coordination_submit_result: true },
      },
      {
        blobs,
        perWorker,
        makeWorkerAgent: leafSeam(received),
        analyzeOnSettle: [route],
        deliverable: { check: () => true },
        continuation: testContinuation(),
        onEvent: (event) => {
          events.push(event)
        },
        driveHarness: async ({ coordinationMcpUrl }) => {
          const response = await fetch(coordinationMcpUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'submit_result', arguments: { result: { answer: 7 } } },
            }),
          })
          expect(response.ok).toBe(true)
        },
      },
    )
    const result = await createSupervisor().run(root, 'task', {
      runId: 'harness-final-review',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      budget: { maxIterations: 20, maxTokens: 50000 },
      maxDepth: 2,
      rootIdentity: identity,
    })
    expect(result).toMatchObject({ kind: 'winner', out: { answer: 7 } })
    expect(received).toHaveLength(1)
    expect(events.filter((event) => event.type === 'finding')).toHaveLength(1)
  })
})
