import { describe, expect, it } from 'vitest'
import {
  createSupervisedKnowledgeUpdater,
  formatSupervisedKnowledgeTask,
  knowledgeReadinessDeliverable,
  runSupervisedKnowledgeUpdate,
} from '../src/knowledge'
import type { SuperviseOptions } from '../src/runtime/supervise/supervise'
import type { SupervisorProfile } from '../src/runtime/supervise/supervisor-agent'
import type { SupervisedResult } from '../src/runtime/supervise/types'

function winner(): SupervisedResult<unknown> {
  return {
    kind: 'winner',
    out: { ok: true },
    outRef: 'out:1',
    tree: { nodes: [] },
    spentTotal: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
  } as unknown as SupervisedResult<unknown>
}

describe('knowledge supervisor integration', () => {
  it('turns a knowledge readiness check into the supervisor deliverable', async () => {
    const calls: unknown[] = []
    const deliverable = knowledgeReadinessDeliverable({
      root: '/kb/candidate',
      goal: 'fill billing policy gaps',
      readinessSpecs: [{ id: 'refunds' }],
      readiness: (input) => {
        calls.push(input)
        return { ready: input.root === '/kb/candidate' }
      },
    })

    await expect(deliverable.check({})).resolves.toBe(true)
    expect(calls).toEqual([
      {
        root: '/kb/candidate',
        goal: 'fill billing policy gaps',
        readinessSpecs: [{ id: 'refunds' }],
        readiness: undefined,
        readinessTaskId: undefined,
      },
    ])
  })

  it('runs supervised knowledge updates against the candidate KB root', async () => {
    let captured:
      | {
          profile: SupervisorProfile
          task: unknown
          opts: SuperviseOptions
        }
      | undefined

    const updater = createSupervisedKnowledgeUpdater({
      root: '/kb/base',
      goal: 'base goal',
      readiness: ({ root }) => root === '/kb/candidate',
      budget: { maxIterations: 2, maxTokens: 1000 },
      runSupervised: async (profile, task, opts) => {
        captured = { profile, task, opts }
        await expect(opts.deliverable?.check({})).resolves.toBe(true)
        return winner()
      },
    })

    const result = await updater({
      candidateRoot: '/kb/candidate',
      goal: 'candidate goal',
    })

    expect(result.applied).toBe(true)
    expect(result.metadata.root).toBe('/kb/candidate')
    expect(captured?.task).toContain('Goal: candidate goal')
    expect(captured?.task).toContain('Knowledge base root: /kb/candidate')
    expect(captured?.profile.name).toBe('knowledge-research-supervisor')
    expect(captured?.profile.systemPrompt).toContain(
      'Each researcher worker you spawn follows this contract',
    )
  })

  it('formats supervisor tasks with the KB root, findings, and metadata', () => {
    const task = formatSupervisedKnowledgeTask({
      root: '/kb/candidate',
      goal: 'fill support gaps',
      readinessTaskId: 'support-agent',
      readinessSpecs: [{ id: 'refunds' }],
      findings: [{ id: 'gap-1', message: 'missing refunds page' }],
      metadata: { runId: 'run-1' },
    })

    expect(task).toContain('Knowledge base root: /kb/candidate')
    expect(task).toContain('missing refunds page')
    expect(task).toContain('"runId": "run-1"')
    expect(task).toContain('Update files under the knowledge base root only')
  })

  it('reports a stopped supervisor as an unapplied KB update', async () => {
    const result = await runSupervisedKnowledgeUpdate({
      root: '/kb/base',
      goal: 'blocked goal',
      readiness: () => false,
      budget: { maxIterations: 2, maxTokens: 1000 },
      runSupervised: async () =>
        ({
          kind: 'no-winner',
          reason: 'budget-exhausted',
          tree: { nodes: [] },
          downCount: 0,
          spentTotal: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
        }) as unknown as SupervisedResult<unknown>,
    })

    expect(result.applied).toBe(false)
    expect(result.summary).toContain('budget-exhausted')
  })
})
