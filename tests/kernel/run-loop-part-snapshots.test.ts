import {
  collectAgentFinalMessageText,
  collectAgentResponseText,
  type SandboxEvent,
  type SandboxInstance,
} from '@tangle-network/sandbox'
import { expect, it } from 'vitest'
import { type AgentRunSpec, type OutputAdapter, runAgentRounds } from '../../src/runtime'
import { type ScriptedPlanner, scriptedDriver } from './refine-driver'

interface Task {
  goal: string
}

const output: OutputAdapter<{ text: string }> = {
  parse: (events) => ({ text: collectAgentResponseText(events) ?? '' }),
}

const spec: AgentRunSpec<Task> = {
  profile: {
    name: 'w',
    harness: 'opencode',
    model: { provider: 'offline', default: 'offline-test-model' },
  },
  name: 'w',
  taskToPrompt: (task) => task.goal,
}

// opencode sends one frame per token, each with the part's whole text so far.
function frames(id: string, words: string[]): SandboxEvent[] {
  return words.map((_, i) => ({
    type: 'message.part.updated',
    data: {
      part: { id, type: 'text', text: words.slice(0, i + 1).join(' ') },
      delta: (i === 0 ? '' : ' ') + words[i],
    },
  }))
}

it('an iteration keeps one snapshot per streamed part, the text the SDK reads from the raw stream', async () => {
  const before = frames(
    'p1',
    Array.from({ length: 400 }, (_, i) => `narration${i}`),
  )
  const tool = {
    type: 'message.part.updated',
    data: { part: { id: 't1', type: 'tool', tool: 'bash', state: { status: 'completed' } } },
  } satisfies SandboxEvent
  const after = frames(
    'p2',
    Array.from({ length: 400 }, (_, i) => `answer${i}`),
  )
  const streamed: SandboxEvent[] = [...before, tool, ...after, { type: 'result', data: {} }]
  const client = {
    async create(): Promise<SandboxInstance> {
      return {
        async *streamPrompt() {
          yield* streamed
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
  let planned = 0
  const planner: ScriptedPlanner<Task, { text: string }> = async () =>
    planned++ === 0 ? { kind: 'refine', task: { goal: 'go' } } : { kind: 'stop' }

  const result = await runAgentRounds({
    driver: scriptedDriver<Task, { text: string }>({ planner }),
    agentRun: spec,
    output,
    task: { goal: 'go' },
    ctx: { sandboxClient: client, signal: new AbortController().signal },
  })

  const events = result.iterations[0]!.events
  expect(events.map((event) => (event.data as { part?: { id?: string } }).part?.id)).toEqual([
    'p1',
    't1',
    'p2',
    undefined,
  ])
  expect(result.iterations[0]!.output).toEqual({ text: collectAgentResponseText(streamed) })
  expect(collectAgentFinalMessageText(events)).toBe(collectAgentFinalMessageText(streamed))
  const bytes = (list: SandboxEvent[]) => JSON.stringify(list).length
  expect(bytes(events) * 100).toBeLessThan(bytes(streamed))
})
