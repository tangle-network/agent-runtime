import { promptHandle, type runGraph } from '@tangle-network/agent-runtime/kernel'
import { runGraphWithTestBrain } from '@tangle-network/agent-runtime/testing'
import { expect, it } from 'vitest'
import { driverNode, scriptedBrain, seen } from '../../examples/graphs/shared'

// On a real backend the graph's deliverable is the worker's settle check. An analyst node attacks
// the worker's output, so that check must never grade the analyst (#1775): here the analyst's
// verdict would fail the worker's check, and its finding still reaches the driver.
it("an analyst node is not graded by the worker's deliverable check", async () => {
  const model = 'analyst-check-model'
  const node = (id: string, systemPrompt: string) => ({
    id,
    profile: {
      name: id,
      harness: 'cli-base',
      model: { provider: 'router', default: model },
      prompt: { systemPrompt },
    },
  })
  const settled: unknown[] = []
  const res = await runGraphWithTestBrain(
    {
      nodes: [
        driverNode('lead', 'Run the worker, then finish.'),
        node('worker', 'WORKER: answer.'),
        node('skeptic', 'SKEPTIC: attack the answer.'),
      ],
      edges: [
        {
          kind: 'delegates',
          from: 'lead',
          to: 'worker',
          directive: promptHandle('delegates/worker-brief/v1'),
        },
        {
          kind: 'analyzes',
          analyst: 'skeptic',
          over: ['worker'],
          to: 'lead',
          directive: promptHandle('analyzes/findings-report/v1'),
        },
      ],
      deliverable: {
        describe: 'an answer',
        check: (out) => JSON.stringify(out ?? null).includes('ANSWER 42'),
      },
      budget: { maxIterations: 30, maxTokens: 50_000 },
    } as Parameters<typeof runGraph>[0],
    {
      runId: 'analyst-check',
      hooks: {
        onEvent(event) {
          if (event.target === 'agent.child' && event.phase === 'after') settled.push(event.payload)
        },
      },
      wake: { debounceMs: 0 },
      backend: {
        backend: 'router',
        routerBaseUrl: 'http://offline.invalid/v1',
        routerKey: 'offline',
        complete: async (body) => {
          const system = JSON.stringify((body as { messages: unknown[] }).messages[0])
          return {
            model,
            choices: [
              { message: { content: system.includes('SKEPTIC') ? 'REFUTED: weak' : 'ANSWER 42' } },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 2, cost_usd: 0 },
          }
        },
      },
      brain: scriptedBrain([
        {
          toolCalls: [
            { name: 'spawn_worker', arguments: { profile: { name: 'worker' }, task: 'answer' } },
          ],
        },
        { content: 'waiting for the skeptic', until: seen('"type":"finding"') },
        { content: 'done' },
      ]),
    },
  )
  const analyzes = res.ledger.filter((row) => row.kind === 'analyzes')
  expect(analyzes.map((row) => [row.edge, row.outcome])).toEqual([
    ['analyzes:skeptic:worker->lead', 'delivered'],
  ])
  expect(res.result.kind).toBe('winner')
  // The worker passed the check (s0); the analyst (s1) was never put to it.
  const byId = new Map(settled.map((p) => [(p as { childId: string }).childId, p]))
  expect(byId.get('analyst-check:s0')).toMatchObject({ status: 'done', valid: true })
  expect(byId.get('analyst-check:s1')).toMatchObject({ status: 'done' })
  expect((byId.get('analyst-check:s1') as { valid?: boolean }).valid).toBeUndefined()
})
