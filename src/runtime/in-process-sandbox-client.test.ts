import { existsSync } from 'node:fs'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { inProcessSandboxClient } from './in-process-sandbox-client'
import { runAgentRounds } from './run-loop'
import type { Driver, OutputAdapter } from './types'

describe('inProcessSandboxClient', () => {
  it('drives runAgentRounds end-to-end from an onPrompt callback (no SandboxInstance cast at the call site)', async () => {
    const client = inProcessSandboxClient({
      onPrompt: (prompt): SandboxEvent[] => [
        { type: 'llm_call', data: { tokensIn: 10, tokensOut: 5, costUsd: 0.001 } },
        { type: 'result', data: { finalText: `echo:${prompt}` } },
      ],
    })
    const driver: Driver<string, string, 'done'> = {
      name: 'single-shot',
      async plan(_t, history) {
        return history.length === 0 ? ['hello'] : []
      },
      decide() {
        return 'done'
      },
    }
    const output: OutputAdapter<string> = {
      parse: (events) => String(events.at(-1)?.data?.finalText ?? ''),
    }

    const result = await runAgentRounds({
      driver,
      agentRun: { profile: { name: 'echo' }, taskToPrompt: (t) => t },
      output,
      validator: {
        async validate() {
          return { valid: true, score: 1 }
        },
      },
      task: 'hello',
      maxIterations: 1,
      ctx: { sandboxClient: client },
    })

    expect(result.iterations[0]?.output).toBe('echo:hello')
    // The llm_call event the callback emitted is metered by the kernel.
    expect(result.tokenUsage).toEqual({ input: 10, output: 5 })
    expect(result.costUsd).toBeCloseTo(0.001, 6)
  })

  it('increments the round counter per streamPrompt on the same box', async () => {
    const seen: number[] = []
    const client = inProcessSandboxClient({
      onPrompt: (_prompt, ctx): SandboxEvent[] => {
        seen.push(ctx.round)
        return [{ type: 'result', data: { finalText: `r${ctx.round}` } }]
      },
    })
    const box = await client.create()
    const drain = async (msg: string): Promise<void> => {
      for await (const _ of box.streamPrompt(msg)) {
        // consume
      }
    }
    await drain('a')
    await drain('b')
    expect(seen).toEqual([0, 1])
  })

  it('mints a real workdir and exposes fs/exec; delete() removes it', async () => {
    const client = inProcessSandboxClient({
      workdir: 'in-process-test',
      onPrompt: async (_prompt, ctx): Promise<SandboxEvent[]> => {
        // The callback writes into the real workspace; fs.read/exec see it.
        const fs = await import('node:fs/promises')
        const { join } = await import('node:path')
        if (ctx.workdir) await fs.writeFile(join(ctx.workdir, 'out.txt'), 'hi', 'utf8')
        return [{ type: 'done', data: { totalCostUsd: 0 } }]
      },
    })
    const box = (await client.create()) as unknown as {
      id: string
      streamPrompt(m: string): AsyncIterable<SandboxEvent>
      fs: { read(p: string): Promise<string> }
      exec(cmd: string): Promise<{ exitCode: number; stdout: string }>
      delete(): Promise<void>
    }
    for await (const _ of box.streamPrompt('go')) {
      // consume
    }
    expect(await box.fs.read('out.txt')).toBe('hi')
    const echoed = await box.exec('echo hello')
    expect(echoed.exitCode).toBe(0)
    expect(echoed.stdout.trim()).toBe('hello')

    // The workdir exists until delete() tears it down.
    const cat = await box.exec('pwd')
    const dir = cat.stdout.trim()
    expect(existsSync(dir)).toBe(true)
    await box.delete()
    expect(existsSync(dir)).toBe(false)
  })

  it('honors an id override (string and function)', async () => {
    const fixed = await inProcessSandboxClient({ id: 'fixed-id', onPrompt: () => [] }).create()
    expect((fixed as unknown as { id: string }).id).toBe('fixed-id')

    const client = inProcessSandboxClient({ id: (seq) => `box-${seq}`, onPrompt: () => [] })
    const a = (await client.create()) as unknown as { id: string }
    const b = (await client.create()) as unknown as { id: string }
    expect(a.id).toBe('box-0')
    expect(b.id).toBe('box-1')
  })

  it('accepts an async-iterable event stream from the callback', async () => {
    async function* stream(): AsyncIterable<SandboxEvent> {
      yield { type: 'result', data: { finalText: 'streamed' } }
    }
    const box = await inProcessSandboxClient({ onPrompt: () => stream() }).create()
    const collected: SandboxEvent[] = []
    for await (const ev of box.streamPrompt('x')) collected.push(ev)
    expect(collected.at(-1)?.data?.finalText).toBe('streamed')
  })
})
