import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { runLoop } from './run-loop'
import type { AgentRunSpec, Driver, OutputAdapter, SandboxClient } from './types'

describe('runLoop sandbox preparation', () => {
  it('runs AgentRunSpec.prepareBox before the first prompt is streamed', async () => {
    const order: string[] = []
    const box = {
      id: 'box-1',
      name: 'box-1',
      status: 'running',
      async *streamPrompt(prompt: string): AsyncIterable<SandboxEvent> {
        order.push(`stream:${prompt}`)
        expect(order).toContain('prepare')
        yield { type: 'result', data: { finalText: 'done' } } as SandboxEvent
      },
    } as SandboxInstance
    const client: SandboxClient = {
      async create() {
        order.push('create')
        return box
      },
    }
    const agentRun: AgentRunSpec<string> = {
      profile: { name: 'prepared-agent' },
      taskToPrompt: (task) => task,
      async prepareBox() {
        order.push('prepare')
      },
    }
    const driver: Driver<string, string, 'done'> = {
      name: 'single-shot',
      async plan(_task, history) {
        return history.length === 0 ? ['hello'] : []
      },
      decide() {
        return 'done'
      },
    }
    const output: OutputAdapter<string> = {
      parse(events) {
        return String(events.at(-1)?.data?.finalText ?? '')
      },
    }

    let validatorBox: SandboxInstance | undefined
    const result = await runLoop({
      driver,
      agentRun,
      output,
      validator: {
        async validate(_output, ctx) {
          validatorBox = ctx.box
          return { valid: true, score: 1 }
        },
      },
      task: 'hello',
      maxIterations: 1,
      ctx: { sandboxClient: client, signal: new AbortController().signal },
    })

    expect(result.iterations[0]?.output).toBe('done')
    expect(validatorBox).toBe(box)
    expect(order).toEqual(['create', 'prepare', 'stream:hello'])
  })
})
