import { describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { QuestionRecord } from '../../src/mcp/tools/coordination'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import { testContinuation } from '../helpers/continuation'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const budget = { maxTokens: 20_000, maxIterations: 20 }
const question = (from: string) => ({
  from,
  level: 'driver',
  question: `Which source should ${from} use?`,
  reason: 'sources conflict',
  urgency: 'continue-without',
})

async function call(
  url: string,
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
  args: Record<string, unknown>,
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }
  expect(body.result.isError).not.toBe(true)
  return JSON.parse(body.result.content[0]!.text)
}

describe('supervise delivers parent questions, not just callback configuration', () => {
  it('forwards a router manager question to the configured inbox', async () => {
    const received: QuestionRecord[] = []
    const seen: Array<ReadonlyArray<Record<string, unknown>>> = []
    await supervise(
      testAgentProfile('root', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('ask_parent'),
      }),
      'research',
      {
        budget,
        makeWorkerAgent: () => ({ name: 'unused', act: async () => undefined }),
        brain: scriptedBrain(
          [
            { toolCalls: [{ name: 'ask_parent', arguments: question('root') }] },
            { content: 'Continue with the unblocked work.' },
          ],
          seen,
        ),
        escalateQuestion: (value) => {
          received.push(value)
          return { delivered: true, to: 'operator-inbox' }
        },
      },
    )
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ from: 'root', question: question('root').question })
    expect(JSON.stringify(seen)).toContain('queued-for-parent')
  })

  it.each([true, false])(
    'forwards both root and recursive native questions (inbox accepts: %s)',
    async (accepts) => {
      const received: QuestionRecord[] = []
      const outcomes: Array<{ from: string; outcome: string }> = []
      let childFinished!: () => void
      const childDone = new Promise<void>((resolve) => {
        childFinished = resolve
      })
      const child = testAgentProfile('specialist', {
        tools: runtimeToolDeclarations('ask_parent', 'submit_result'),
      })
      const driveHarness: DriveHarness = async ({
        profile,
        coordinationMcpUrl,
        coordinationMcpHeaders,
      }) => {
        const response = await call(
          coordinationMcpUrl,
          coordinationMcpHeaders,
          'ask_parent',
          question(profile.name),
        )
        outcomes.push({ from: profile.name, outcome: response.outcome })
        if (profile.name === 'root') {
          const spawned = await call(coordinationMcpUrl, coordinationMcpHeaders, 'spawn_worker', {
            profile: child,
            task: 'specialist work',
          })
          expect(spawned).not.toHaveProperty('error')
          await childDone
          await call(coordinationMcpUrl, coordinationMcpHeaders, 'await_event', {})
        } else {
          await call(coordinationMcpUrl, coordinationMcpHeaders, 'submit_result', {
            result: { answer: 'checked' },
          })
          childFinished()
        }
      }
      await supervise(
        testAgentProfile('root', {
          tools: runtimeToolDeclarations('ask_parent', 'spawn_worker', 'await_event'),
        }),
        'research',
        {
          budget,
          perWorker: { maxTokens: 1000, maxIterations: 4 },
          makeLeafAgent: () => ({ name: 'unused', act: async () => undefined }),
          driveHarness,
          coordination: { authentication: true },
          driverRetry: { enabled: false },
          journal: new InMemorySpawnJournal(),
          runId: 'question-tree',
          deliverable: { check: () => true },
          continuation: testContinuation({ deadline: 1 }),
          escalateQuestion: (value) => {
            received.push(value)
            return accepts
              ? { delivered: true, to: 'operator-inbox' }
              : { delivered: false, reason: 'inbox unavailable' }
          },
        },
      )
      expect(received.map((q) => q.from).sort()).toEqual(['root', 'specialist'])
      expect(outcomes).toEqual([
        { from: 'root', outcome: accepts ? 'queued-for-parent' : 'no-parent' },
        { from: 'specialist', outcome: accepts ? 'queued-for-parent' : 'no-parent' },
      ])
    },
  )
})
