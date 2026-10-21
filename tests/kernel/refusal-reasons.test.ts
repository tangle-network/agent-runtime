import { describe, expect, it } from 'vitest'
import type { Agent, ResultBlobStore, Scope, Spend } from '../../src/runtime'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'

const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })
const blobs: ResultBlobStore = { get: async () => undefined, put: async () => {} }
const makeWorkerAgent = (): Agent<unknown, unknown> => ({ name: 'w', act: async () => 0 })
const perWorker = { maxIterations: 1, maxTokens: 10 }

/** `children: false` gives a manager with no running worker, so closure has no open work. */
function mockScope(options: { admit?: boolean; children?: boolean } = {}) {
  const nodes =
    options.children === false
      ? []
      : [
          {
            id: 'w0',
            label: 'worker',
            status: 'running' as const,
            runtime: 'router',
            budget: { maxIterations: 1, maxTokens: 10 },
            spent: zeroSpend(),
          },
        ]
  return {
    spawn: (_agent: unknown, _task: unknown, opts: { label: string }) =>
      options.admit === false
        ? { ok: false as const, reason: 'budget-exhausted' as const }
        : {
            ok: true as const,
            handle: { id: 'w0', label: opts.label, status: 'running' as const, abort() {} },
          },
    next: async () => null,
    nextResolved: async () => null,
    send: (id: string) => id === 'w0',
    get view() {
      return { root: 'root', nodes, inFlight: 1 }
    },
    budget: { tokensLeft: 10, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
    signal: new AbortController().signal,
  } as unknown as Scope<unknown>
}

/** A refusal a manager can act on states the unmet condition in words, not only a code. */
function expectReason(result: unknown, contains?: RegExp): string {
  const reason = (result as { reason?: unknown }).reason
  expect(typeof reason).toBe('string')
  expect((reason as string).length).toBeGreaterThan(20)
  if (contains) expect(reason as string).toMatch(contains)
  return reason as string
}

describe('ask_parent at the top of the chain', () => {
  it('the seam reaches a manager through the coordination MCP mount, not only the direct toolbox', async () => {
    // A seam nothing forwards is a seam that does not exist. `serveCoordinationMcp` is the harness
    // arm's mount; if it drops the option, `queued-for-parent` is unreachable in every real run.
    const received: string[] = []
    const mcp = await serveCoordinationMcp({
      scope: mockScope(),
      blobs,
      makeWorkerAgent,
      perWorker,
      toolNames: ['ask_parent'],
      host: '127.0.0.1',
      escalateQuestion: (question: { question: string }) => {
        received.push(question.question)
        return { delivered: true as const, to: 'the run operator' }
      },
    })
    try {
      const response = await fetch(mcp.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'ask_parent',
            arguments: {
              from: 'w0',
              level: 'driver',
              question: 'Which API version should this migration target?',
              reason: 'two supported versions',
              urgency: 'blocks-run',
            },
          },
        }),
      })
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const asked = JSON.parse(body.result.content[0]?.text ?? '{}') as Record<string, unknown>
      expect(asked).toMatchObject({ escalated: true, outcome: 'queued-for-parent' })
      expectReason(asked, /the run operator/)
      expect(received).toEqual(['Which API version should this migration target?'])
      expect(mcp.history().filter((record) => record.event.type === 'escalation')).toHaveLength(1)
    } finally {
      await mcp.close()
    }
  })
})
