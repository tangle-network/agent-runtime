import type { AgentProfile, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import type { AgentRunSpec, OutputAdapter, Validator } from '../../src/runtime'
import { runLoop } from '../../src/runtime'

interface Task {
  prompt: string
}

interface Output {
  ok: boolean
}

const profile: AgentProfile = { name: 'box-hook-agent' }
const output: OutputAdapter<Output> = {
  parse(events) {
    return { ok: events.some((event) => event.type === 'result') }
  },
}

describe('runLoop box hooks', () => {
  it('prepares a sandbox before prompting and passes that box to the validator', async () => {
    const calls: string[] = []
    const box = {
      id: 'box-hook',
      prepared: false,
      async *streamPrompt(prompt: string) {
        calls.push(`prompt:${prompt}:${this.prepared}`)
        yield { type: 'result', data: { ok: true } } satisfies SandboxEvent
      },
    } as unknown as SandboxInstance & { prepared: boolean }
    const spec: AgentRunSpec<Task> = {
      profile,
      taskToPrompt: (task) => task.prompt,
      prepareBox(preparedBox, ctx) {
        expect(ctx.signal.aborted).toBe(false)
        expect(preparedBox).toBe(box)
        calls.push('prepare')
        box.prepared = true
      },
    }
    const validator: Validator<Output> = {
      async validate(value, ctx) {
        calls.push(`validate:${value.ok}:${ctx.box === box}`)
        return { valid: Boolean(value.ok && ctx.box === box), score: 1 }
      },
    }

    const result = await runLoop<Task, Output, 'pick-winner' | 'fail'>({
      driver: {
        async plan(task, history) {
          return history.length === 0 ? [task] : []
        },
        decide(history) {
          return history.length > 0 ? 'pick-winner' : 'fail'
        },
      },
      agentRun: spec,
      output,
      validator,
      task: { prompt: 'hello' },
      maxIterations: 1,
      ctx: {
        sandboxClient: {
          async create() {
            return box
          },
        },
      },
    })

    expect(result.winner?.output.ok).toBe(true)
    expect(calls).toEqual(['prepare', 'prompt:hello:true', 'validate:true:true'])
  })
})
