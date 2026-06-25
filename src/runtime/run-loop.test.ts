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

describe('runLoop onSandboxEvent tee', () => {
  type Observer = (
    event: SandboxEvent,
    meta: { iterationIndex: number; agentRunName: string },
  ) => void | PromiseLike<void>

  const STREAM: SandboxEvent[] = [
    { type: 'token', data: { text: 'hi' } } as SandboxEvent,
    { type: 'token', data: { text: 'there' } } as SandboxEvent,
    { type: 'result', data: { finalText: 'done' } } as SandboxEvent,
  ]

  function runWithObserver(onSandboxEvent: Observer, stream: SandboxEvent[] = STREAM) {
    const box = {
      id: 'box-1',
      name: 'box-1',
      status: 'running',
      async *streamPrompt(_prompt: string): AsyncIterable<SandboxEvent> {
        for (const event of stream) yield event
      },
    } as SandboxInstance
    const client: SandboxClient = {
      async create() {
        return box
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
    const agentRun: AgentRunSpec<string> = {
      profile: { name: 'tee-agent' },
      taskToPrompt: (task) => task,
    }
    const output: OutputAdapter<string> = {
      parse(events) {
        return String(events.at(-1)?.data?.finalText ?? '')
      },
    }
    return runLoop({
      driver,
      agentRun,
      output,
      validator: {
        async validate() {
          return { valid: true, score: 1 }
        },
      },
      task: 'hello',
      maxIterations: 1,
      ctx: {
        sandboxClient: client,
        signal: new AbortController().signal,
        onSandboxEvent,
      },
    })
  }

  it('forwards every streamed event with iterationIndex + agentRunName', async () => {
    const seen: Array<{
      type: string
      iterationIndex: number
      agentRunName: string
    }> = []
    await runWithObserver((event, meta) => {
      seen.push({ type: event.type, ...meta })
    })
    expect(seen.map((s) => s.type)).toEqual(STREAM.map((e) => e.type))
    for (const s of seen) {
      expect(s.iterationIndex).toBe(0)
      expect(s.agentRunName).toBe('tee-agent')
    }
  })

  it('isolates a synchronously throwing observer — the run still completes', async () => {
    const result = await runWithObserver(() => {
      throw new Error('observer boom')
    })
    expect(result.iterations[0]?.output).toBe('done')
  })

  it('isolates a rejecting async observer — no unhandled rejection, run completes', async () => {
    const result = await runWithObserver(async () => {
      throw new Error('async observer boom')
    })
    expect(result.iterations[0]?.output).toBe('done')
  })

  it('isolates observer mutation — the run consumes its own uncorrupted events', async () => {
    // A buggy/hostile observer mutates the event it receives. Because it gets a
    // defensive copy, the run's own buffered event (read by output.parse) is
    // untouched: output stays 'done', not the observer's 'corrupted'.
    const result = await runWithObserver((event) => {
      const mutable = event as unknown as { type: string; data: Record<string, unknown> }
      mutable.type = 'mutated'
      mutable.data.finalText = 'corrupted'
    })
    expect(result.iterations[0]?.output).toBe('done')
  })

  it('does not await the observer — a never-settling observer cannot stall the stream', async () => {
    // The observer returns a promise that never resolves. The run must not await
    // it; if a future refactor adds an `await`, this test hangs and fails.
    const result = await runWithObserver(() => new Promise<void>(() => {}))
    expect(result.iterations[0]?.output).toBe('done')
  })

  it('forwards a non-cloneable event via a shallow-copy fallback (never drops it)', async () => {
    // event.data is Record<string, unknown>, so an event can carry a value that
    // makes structuredClone throw (here, a function). The tee must fall back to
    // a shallow copy and still forward the event rather than silently dropping
    // it — upholding the "forwards EVERY raw event" contract.
    const nonCloneable = {
      type: 'tool',
      data: { fn: () => 'nope' },
    } as unknown as SandboxEvent
    const seen: string[] = []
    const result = await runWithObserver(
      (event) => {
        seen.push(event.type)
      },
      [nonCloneable, { type: 'result', data: { finalText: 'done' } } as SandboxEvent],
    )
    expect(seen).toEqual(['tool', 'result'])
    expect(result.iterations[0]?.output).toBe('done')
  })
})
