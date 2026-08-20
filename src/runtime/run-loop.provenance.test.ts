import { createHash } from 'node:crypto'
import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { runAgentRounds } from './run-loop'
import type { AgentRunSpec, Driver, LoopWinner, OutputAdapter, SandboxClient } from './types'

function makeBox(id: string, finalText: string): SandboxInstance {
  return {
    id,
    name: id,
    status: 'running',
    async *streamPrompt(_prompt: string): AsyncIterable<SandboxEvent> {
      yield { type: 'result', data: { finalText } } as SandboxEvent
      yield { type: 'done', data: { outcome: { type: 'completed' } } } as SandboxEvent
    },
  } as SandboxInstance
}

const output: OutputAdapter<string> = {
  parse(events) {
    const result = [...events].reverse().find((event) => event.type === 'result')
    return String(result?.data?.finalText ?? '')
  },
}

function exactProfile(name: string) {
  return {
    name,
    harness: 'opencode' as const,
    model: { provider: 'offline', default: 'offline-test-model' },
  }
}

describe('runAgentRounds provenance', () => {
  it('surfaces a mount manifest recorded during prepareBox', async () => {
    const bytes = Buffer.from('fixture-contents')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const client: SandboxClient = {
      async create() {
        return makeBox('box-1', 'done')
      },
    }
    const agentRun: AgentRunSpec<string> = {
      profile: exactProfile('mounting-agent'),
      taskToPrompt: (task) => task,
      // The caller owns the bytes it writes; it declares each mount via the
      // recorder. The kernel never reads the box, so this is the only path the
      // manifest is populated from.
      prepareBox(_box, ctx) {
        ctx.recordMount({
          path: '/work/fixture.txt',
          sha256,
          bytes: bytes.byteLength,
          source: 'corpus://fixtures/fixture.txt',
        })
      },
    }
    const driver: Driver<string, string, 'done'> = {
      async plan(_task, history) {
        return history.length === 0 ? ['hello'] : []
      },
      decide: () => 'done',
    }

    const result = await runAgentRounds({
      driver,
      agentRun,
      output,
      task: 'hello',
      maxIterations: 1,
      ctx: { sandboxClient: client, signal: new AbortController().signal },
    })

    expect(result.provenance.mounts).toEqual([
      {
        path: '/work/fixture.txt',
        sha256,
        bytes: bytes.byteLength,
        source: 'corpus://fixtures/fixture.txt',
      },
    ])
  })

  it('emits the empty manifest when nothing is mounted', async () => {
    const client: SandboxClient = {
      async create() {
        return makeBox('box-1', 'done')
      },
    }
    const driver: Driver<string, string, 'done'> = {
      async plan(_task, history) {
        return history.length === 0 ? ['hello'] : []
      },
      decide: () => 'done',
    }

    const result = await runAgentRounds({
      driver,
      agentRun: { profile: exactProfile('plain-agent'), taskToPrompt: (t) => t },
      output,
      task: 'hello',
      maxIterations: 1,
      ctx: { sandboxClient: client, signal: new AbortController().signal },
    })

    expect(result.provenance.mounts).toEqual([])
  })

  it('records a default-selector receipt per candidate with scores and winner flag', async () => {
    // Two-wide fanout, distinct scores → the higher score wins under the default
    // argmax. Each non-errored candidate gets exactly one receipt.
    const created: string[] = []
    const client: SandboxClient = {
      async create() {
        const id = `box-${created.length}`
        created.push(id)
        return makeBox(id, id)
      },
    }
    const driver: Driver<string, string, 'done'> = {
      async plan(_task, history) {
        return history.length === 0 ? ['a', 'b'] : []
      },
      decide: () => 'done',
    }

    const result = await runAgentRounds({
      driver,
      agentRun: { profile: exactProfile('fanout-agent'), taskToPrompt: (t) => t },
      output,
      validator: {
        async validate(_out, ctx) {
          // iteration 0 scores lower than iteration 1 → iteration 1 wins.
          return { valid: true, score: ctx.iteration === 1 ? 0.9 : 0.3 }
        },
      },
      task: 'go',
      maxIterations: 2,
      ctx: { sandboxClient: client, signal: new AbortController().signal },
    })

    expect(result.winner?.iterationIndex).toBe(1)
    expect(result.provenance.selectionReceipts).toEqual([
      {
        candidateIndex: 0,
        selected: false,
        score: 0.3,
        selector: 'default',
        reason: 'valid but not top score',
      },
      {
        candidateIndex: 1,
        selected: true,
        score: 0.9,
        selector: 'default',
        reason: 'best valid score',
      },
    ])
  })

  it('omits a receipt for an errored iteration and attributes a caller selector without inventing a reason', async () => {
    let calls = 0
    const client: SandboxClient = {
      async create() {
        calls += 1
        // Second box fails to acquire → that iteration errors and is never a
        // candidate, so it gets no selection receipt.
        if (calls === 2) throw new Error('box acquire blew up')
        return makeBox(`box-${calls}`, 'ok')
      },
    }
    const driver: Driver<string, string, 'done'> = {
      async plan(_task, history) {
        return history.length === 0 ? ['a', 'b'] : []
      },
      decide: () => 'done',
    }
    const selectWinner = (
      iterations: { index: number; task: string; output?: string; agentRunName: string }[],
    ): LoopWinner<string, string> | undefined => {
      const first = iterations.find((it) => it.output !== undefined)
      if (!first || first.output === undefined) return undefined
      return {
        task: first.task,
        output: first.output,
        iterationIndex: first.index,
        agentRunName: first.agentRunName,
      }
    }

    const result = await runAgentRounds({
      driver,
      agentRun: { profile: exactProfile('caller-select-agent'), taskToPrompt: (t) => t },
      output,
      task: 'go',
      maxIterations: 2,
      selectWinner,
      ctx: { sandboxClient: client, signal: new AbortController().signal },
    })

    // Only the non-errored iteration (index 0) is a candidate; the errored one is omitted.
    expect(result.provenance.selectionReceipts).toEqual([
      { candidateIndex: 0, selected: true, selector: 'caller' },
    ])
  })
})
