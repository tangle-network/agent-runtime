import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  createOpenAICompatibleBackend,
  type KnowledgeRequirement,
  type RuntimeStreamEvent,
  runAgentTaskStream,
} from '../src/index'
import { spendFromUsageEvents } from '../src/runtime/supervise/budget'
import { bridgeExecutor } from '../src/runtime/supervise/runtime'
import type { Spend, UsageEvent } from '../src/runtime/supervise/types'

const readyRequirement: KnowledgeRequirement = {
  id: 'usage-contract',
  description: 'The usage receipt contract under test',
  requiredFor: ['test'],
  category: 'codebase_specific',
  acquisitionMode: 'inspect_repo',
  importance: 'blocking',
  freshness: 'weekly',
  sensitivity: 'public',
  confidenceNeeded: 0.8,
  currentConfidence: 0.9,
}

function cumulativeReceipt(input: number, output: number, finishReason: string): string {
  const chunk = {
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    usage: {
      prompt_tokens: input,
      completion_tokens: output,
      total_tokens: input + output,
    },
  }
  return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`
}

async function collectRuntimeEvents(
  iter: AsyncIterable<RuntimeStreamEvent>,
): Promise<RuntimeStreamEvent[]> {
  const events: RuntimeStreamEvent[] = []
  for await (const event of iter) events.push(event)
  return events
}

async function consumeAsOpenAI(body: string): Promise<{
  tokens: { input: number; output: number }
  finishReason: string | undefined
}> {
  const backend = createOpenAICompatibleBackend({
    apiKey: 'sk-test',
    baseUrl: 'https://router.tangle.tools/v1',
    model: 'zai-coding-paas/glm-5.2',
    fetchImpl: async () => new Response(body, { status: 200 }),
  })
  const events = await collectRuntimeEvents(
    runAgentTaskStream({
      task: {
        id: 'pi-cumulative-usage',
        intent: 'consume one cumulative Pi receipt',
        requiredKnowledge: [readyRequirement],
      },
      backend,
      input: { message: 'run' },
    }),
  )
  const calls = events.filter((event) => event.type === 'llm_call')
  expect(calls).toHaveLength(1)
  const call = calls[0]
  if (call.type !== 'llm_call') throw new Error('expected one llm_call')
  return {
    tokens: { input: call.tokensIn, output: call.tokensOut },
    finishReason: call.finishReason,
  }
}

async function consumeAsSupervisedBridge(body: string): Promise<{
  tokens: { input: number; output: number }
  artifactSpend: Spend
  normalized: Spend
  tokenReceipts: number
}> {
  const server = createServer((_req, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const { port } = server.address() as AddressInfo
    const profile: AgentProfile = { name: 'pi-usage-contract-worker' }
    const executor = bridgeExecutor(
      { profile, harness: null },
      {
        signal: new AbortController().signal,
        seams: {
          bridge: {
            bridgeUrl: `http://127.0.0.1:${port}`,
            bridgeBearer: 'test-bearer',
            model: 'pi/zai-coding-paas/glm-5.2',
          },
        },
      },
    )
    const events: UsageEvent[] = []
    for await (const event of executor.execute(
      'run',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      events.push(event)
    }
    const artifact = executor.resultArtifact()
    return {
      tokens: artifact.spent.tokens,
      artifactSpend: artifact.spent,
      normalized: spendFromUsageEvents(events),
      tokenReceipts: events.filter((event) => event.kind === 'tokens').length,
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

describe('Pi cumulative usage receipt compatibility', () => {
  it('reports identical totals for a tool-using run with two completed model calls', async () => {
    // The Pi adapter combines 1,050 and 2,025 native tokens into this one final receipt.
    const body = cumulativeReceipt(3_020, 55, 'stop')
    const [openAI, supervised] = await Promise.all([
      consumeAsOpenAI(body),
      consumeAsSupervisedBridge(body),
    ])

    expect(openAI.tokens).toEqual({ input: 3_020, output: 55 })
    expect(supervised.tokens).toEqual(openAI.tokens)
    expect(supervised.normalized.tokens).toEqual(openAI.tokens)
    expect(supervised.tokenReceipts).toBe(1)
    expect(supervised.artifactSpend).toMatchObject({ usd: 0, usdKnown: false })
    expect(supervised.normalized).toMatchObject({ usd: 0, usdKnown: false })
  })

  it('preserves identical completed-call totals in an abort-shaped terminal receipt', async () => {
    const body = cumulativeReceipt(408, 12, 'error')
    const [openAI, supervised] = await Promise.all([
      consumeAsOpenAI(body),
      consumeAsSupervisedBridge(body),
    ])

    expect(openAI.finishReason).toBe('error')
    expect(openAI.tokens).toEqual({ input: 408, output: 12 })
    expect(supervised.tokens).toEqual(openAI.tokens)
    expect(supervised.normalized.tokens).toEqual(openAI.tokens)
    expect(supervised.tokenReceipts).toBe(1)
    expect(supervised.artifactSpend).toMatchObject({ usd: 0, usdKnown: false })
    expect(supervised.normalized).toMatchObject({ usd: 0, usdKnown: false })
  })
})
