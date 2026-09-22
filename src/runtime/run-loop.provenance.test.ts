import { createHash } from 'node:crypto'
import type {
  AgentEnvironmentProvider,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { inProcessEnvironmentProvider } from './in-process-environment-provider'
import { runAgentRounds } from './run-loop'
import type { AgentRunSpec, Driver, LoopWinner, OutputAdapter } from './types'

function makeProvider(finalText: string): AgentEnvironmentProvider {
  return inProcessEnvironmentProvider({
    onTurn: () => [{ type: 'result', data: { finalText } }],
  })
}

const output: OutputAdapter<string> = {
  parse(events) {
    return String(events.at(-1)?.data?.finalText ?? '')
  },
}

describe('runAgentRounds provenance', () => {
  it('surfaces a mount manifest recorded during prepareEnvironment', async () => {
    const bytes = Buffer.from('fixture-contents')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const provider = makeProvider('done')
    const agentRun: AgentRunSpec<string> = {
      profile: { name: 'mounting-agent' },
      taskToPrompt: (task) => task,
      prepareEnvironment(_environment, ctx) {
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
      ctx: { environmentProvider: provider, signal: new AbortController().signal },
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
    const provider = makeProvider('done')
    const driver: Driver<string, string, 'done'> = {
      async plan(_task, history) {
        return history.length === 0 ? ['hello'] : []
      },
      decide: () => 'done',
    }

    const result = await runAgentRounds({
      driver,
      agentRun: { profile: { name: 'plain-agent' }, taskToPrompt: (t) => t },
      output,
      task: 'hello',
      maxIterations: 1,
      ctx: { environmentProvider: provider, signal: new AbortController().signal },
    })

    expect(result.provenance.mounts).toEqual([])
  })

  it('records a default-selector receipt per candidate with scores and winner flag', async () => {
    // Two-wide fanout, distinct scores → the higher score wins under the default
    // argmax. Each non-errored candidate gets exactly one receipt.
    const created: string[] = []
    const provider = inProcessEnvironmentProvider({
      id: (sequence) => {
        const id = `environment-${sequence}`
        created.push(id)
        return id
      },
      onTurn: (prompt) => [{ type: 'result', data: { finalText: prompt } }],
    })
    const driver: Driver<string, string, 'done'> = {
      async plan(_task, history) {
        return history.length === 0 ? ['a', 'b'] : []
      },
      decide: () => 'done',
    }

    const result = await runAgentRounds({
      driver,
      agentRun: { profile: { name: 'fanout-agent' }, taskToPrompt: (t) => t },
      output,
      validator: {
        async validate(_out, ctx) {
          // iteration 0 scores lower than iteration 1 → iteration 1 wins.
          return { valid: true, score: ctx.iteration === 1 ? 0.9 : 0.3 }
        },
      },
      task: 'go',
      maxIterations: 2,
      ctx: { environmentProvider: provider, signal: new AbortController().signal },
    })

    expect(result.winner?.iterationIndex).toBe(1)
    expect(created).toEqual(['environment-0', 'environment-1'])
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
    const baseProvider = makeProvider('ok')
    const provider: AgentEnvironmentProvider = {
      ...baseProvider,
      async create(input: CreateAgentEnvironmentInput) {
        calls += 1
        if (calls === 2) throw new Error('environment creation failed')
        return baseProvider.create(input)
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
      agentRun: { profile: { name: 'caller-select-agent' }, taskToPrompt: (t) => t },
      output,
      task: 'go',
      maxIterations: 2,
      selectWinner,
      ctx: { environmentProvider: provider, signal: new AbortController().signal },
    })

    // Only the non-errored iteration (index 0) is a candidate; the errored one is omitted.
    expect(result.provenance.selectionReceipts).toEqual([
      { candidateIndex: 0, selected: true, selector: 'caller' },
    ])
  })
})
