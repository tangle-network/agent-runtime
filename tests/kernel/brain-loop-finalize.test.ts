import { describe, expect, it } from 'vitest'
import { contentAddress, InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import { finalizeBestDelivered } from '../../src/runtime/supervise/coordination-driver'
import { runBrainLoop } from '../../src/runtime/tool-loop'
import { scriptedBrain } from './scripted-brain'

describe('finalizeBestDelivered', () => {
  it('returns the highest-scoring delivered blob, ignoring failed/invalid workers', async () => {
    const blobs = new InMemoryResultBlobStore()
    const refLow = contentAddress('low-output')
    const refHigh = contentAddress('high-output')
    await blobs.put(refLow, 'low-output')
    await blobs.put(refHigh, 'high-output')
    const settled = [
      { status: 'done', valid: true, score: 0.3, outRef: refLow },
      { status: 'done', valid: true, score: 0.9, outRef: refHigh },
      { status: 'error', valid: false, score: 1, outRef: 'ref-errored' },
      { status: 'done', valid: false, score: 1, outRef: 'ref-invalid' },
    ]
    expect(await finalizeBestDelivered(settled, blobs)).toBe('high-output')
  })

  it('returns undefined when nothing was delivered (none done+valid)', async () => {
    const blobs = new InMemoryResultBlobStore()
    expect(await finalizeBestDelivered([{ status: 'error', valid: false }], blobs)).toBeUndefined()
  })
})

describe('runBrainLoop', () => {
  it('runs a tool call, feeds its result back, then settles on the final text', async () => {
    const executed: Array<{ name: string; args: Record<string, unknown> }> = []
    const chat = scriptedBrain([
      { toolCalls: [{ name: 'echo', arguments: { v: 'hi' } }] },
      { content: 'all done' },
    ])
    const result = await runBrainLoop({
      chat,
      tools: [
        {
          type: 'function',
          function: { name: 'echo', description: 'echo a value', parameters: {} },
        },
      ],
      execute: async (name, args) => {
        executed.push({ name, args })
        return `echoed:${String(args.v)}`
      },
      initialMessages: [{ role: 'user', content: 'go' }],
      maxTurns: 5,
    })

    expect(executed).toEqual([{ name: 'echo', args: { v: 'hi' } }])
    expect(result.final).toBe('all done')
    expect(result.toolCalls).toBe(1)
    expect(result.toolTrace[0]?.result).toBe('echoed:hi')
  })
})
