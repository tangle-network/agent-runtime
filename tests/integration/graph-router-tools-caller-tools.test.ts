import { runGraph } from '@tangle-network/agent-runtime/kernel'
import { expect, it } from 'vitest'

// A graph worker on the router-tools backend runs a caller tool its node profile grants (#1587):
// the node declares `tools: { submit: true }`, the backend supplies `submit`, and the worker's
// second turn sees the tool result. Before the fix, spawn refused the `tools` axis.
it('a router-tools graph worker uses the caller tool its node profile grants', async () => {
  const executed: Array<{ name: string; args: unknown }> = []
  const requests: Array<{ messages: Array<{ role: string }> }> = []
  const res = await runGraph(
    {
      nodes: [
        {
          id: 'reader',
          profile: {
            name: 'reader',
            harness: 'cli-base',
            model: { provider: 'router', default: 'router-tools-model' },
            prompt: { systemPrompt: 'Submit the answer with the submit tool.' },
            tools: { submit: true },
          },
        },
      ],
      entry: [{ node: 'reader', task: 'answer' }],
      edges: [],
      deliverable: { describe: 'any settled result', check: (out) => out !== undefined },
      budget: { maxIterations: 10, maxTokens: 10_000 },
    },
    {
      runId: 'router-tools-grant',
      backend: {
        backend: 'router-tools',
        routerBaseUrl: 'http://offline.invalid/v1',
        routerKey: 'offline',
        tools: [
          {
            type: 'function',
            function: {
              name: 'submit',
              parameters: { type: 'object', properties: { answer: { type: 'string' } } },
            },
          },
        ],
        executeToolCall: async (name, args) => {
          executed.push({ name, args })
          return 'accepted'
        },
        complete: async (body) => {
          requests.push(body as (typeof requests)[number])
          const message =
            requests.length === 1
              ? {
                  content: null,
                  tool_calls: [
                    {
                      id: 'submit-1',
                      type: 'function',
                      function: { name: 'submit', arguments: '{"answer":"42"}' },
                    },
                  ],
                }
              : { content: 'submitted' }
          return {
            model: 'router-tools-model',
            choices: [{ message }],
            usage: { prompt_tokens: 5, completion_tokens: 2, cost_usd: 0.01 },
          }
        },
      },
    },
  )
  expect(res.result.kind).toBe('winner')
  expect(executed).toEqual([{ name: 'submit', args: { answer: '42' } }])
  expect(requests[1]?.messages.at(-1)).toMatchObject({ role: 'tool', content: 'accepted' })
})
