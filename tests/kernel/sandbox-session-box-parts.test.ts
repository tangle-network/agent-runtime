import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { createInbox } from '../../src/runtime/supervise/inbox'
import { createSteerableSandboxSession } from '../../src/runtime/supervise/sandbox-session'
import type { SandboxClient } from '../../src/runtime/types'
import { testAgentProfile } from './test-agent-profile'

/** The canonical ToolPart a box publishes for any harness, as its `streamPrompt` frames it. */
const toolFrame = (callID: string, tool: string, status: 'completed' | 'failed'): SandboxEvent =>
  ({
    type: 'part',
    data: {
      part: {
        id: callID,
        type: 'tool',
        callID,
        tool,
        state: { status, input: { command: 'pwd' }, output: '/home/agent' },
      },
    },
  }) as unknown as SandboxEvent

const resultFrame = (text: string): SandboxEvent =>
  ({
    type: 'result',
    data: { finalText: text, usage: { inputTokens: 12, outputTokens: 4 } },
  }) as unknown as SandboxEvent

function boxClient(frames: ReadonlyArray<SandboxEvent>): SandboxClient {
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        id: 'box-1',
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          for (const frame of frames) yield frame
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
}

describe('a steerable sandbox session reads the tool calls a claude-code box streams', () => {
  it('records one span per canonical tool part under harness claude-code', async () => {
    const session = createSteerableSandboxSession({
      controller: new AbortController(),
      profile: testAgentProfile('worker', { harness: 'claude-code' }),
      harness: 'claude-code',
      sandboxClient: boxClient([
        toolFrame('toolu_01', 'Bash', 'completed'),
        toolFrame('toolu_01', 'Bash', 'completed'),
        toolFrame('toolu_02', 'Read', 'failed'),
        resultFrame('done'),
      ]),
      inbox: createInbox(),
      taskToPrompt: (task) => String(task),
      contentRef: (prefix) => `${prefix}:ref`,
    })
    for await (const _event of session.stream('do the work', new AbortController().signal)) {
    }
    const spans = await session.traceSource().collect()
    expect(spans.map((s) => s.toolName)).toEqual(['Bash', 'Read'])
    expect(spans.map((s) => s.status)).toEqual(['ok', 'error'])
  })
})
