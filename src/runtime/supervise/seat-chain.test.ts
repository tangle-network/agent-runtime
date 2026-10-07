import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../durable/spawn-journal'
import type { ExecutorConfig } from './runtime'
import {
  SeatChain,
  SeatChainExhaustedError,
  type SeatSelection,
  type SeatSelectionInput,
  seatExecutionProfile,
  subscriptionUsageLimitSignal,
} from './seat-chain'

const backend = { backend: 'provider' } as Extract<ExecutorConfig, { backend: 'provider' }>

function profile(seats: NonNullable<AgentProfile['seats']>): AgentProfile {
  return {
    harness: 'claude-code',
    model: { provider: 'anthropic', default: 'claude-opus-4-1' },
    tools: { Bash: true },
    seats,
  }
}

describe('authored subscription seat chain', () => {
  it('advances only after a typed limit, journals each segment, and projects the new controls', async () => {
    const authored = profile([
      {
        harness: 'claude-code',
        provider: 'anthropic',
        model: 'claude-opus-4-1',
        selector: { kind: 'all-eligible' },
      },
      {
        harness: 'codex',
        provider: 'openai',
        model: 'gpt-6-sol',
        selector: { kind: 'all-eligible' },
        tools: {},
      },
    ])
    const journal = new InMemorySpawnJournal()
    await journal.beginTree('run', new Date(0).toISOString())
    const requests: SeatSelectionInput[] = []
    const select = async (request: SeatSelectionInput): Promise<SeatSelection> => {
      requests.push(request)
      return request.stageIndex === 0
        ? request.excludedSeatIds.length === 0
          ? { seat: 'claude-a', backend }
          : { resumeAt: '2026-10-08T00:00:00.000Z' }
        : { seat: 'codex-a', backend }
    }
    const chain = new SeatChain(authored, 'run', 'run', journal, select, () => 1_000)
    expect((await chain.next()).seat).toBe('claude-a')
    const second = await chain.next(true)
    expect(second.seat).toBe('codex-a')
    expect(requests.map((request) => [request.stageIndex, request.excludedSeatIds])).toEqual([
      [0, []],
      [0, ['claude-a']],
      [1, []],
    ])
    const effective = seatExecutionProfile(authored, second.stage)
    expect(effective).toMatchObject({
      harness: 'codex',
      model: { provider: 'openai', default: 'gpt-6-sol' },
      tools: {},
    })
    expect(effective).not.toHaveProperty('seats')
    expect(authored).toHaveProperty('seats')
    const segments = (await journal.loadTree('run'))?.filter(
      (event) => event.kind === 'seat-segment',
    )
    expect(segments?.map((event) => [event.phase, event.seat, event.reason])).toEqual([
      ['started', 'claude-a', undefined],
      ['ended', 'claude-a', 'usage-limit'],
      ['started', 'codex-a', undefined],
    ])
  })

  it('never switches provider when the authored profile contains no other provider', async () => {
    const authored = profile([
      {
        harness: 'claude-code',
        provider: 'anthropic',
        model: 'claude-opus-4-1',
        selector: { kind: 'all-eligible' },
      },
    ])
    const journal = new InMemorySpawnJournal()
    await journal.beginTree('run', new Date(0).toISOString())
    const requestedProviders: string[] = []
    const chain = new SeatChain(
      authored,
      'run',
      'run',
      journal,
      async (request) => {
        requestedProviders.push(request.stage.provider)
        return request.excludedSeatIds.length === 0
          ? { seat: 'claude-a', backend }
          : { resumeAt: '2026-10-08T00:00:00.000Z' }
      },
      () => 1_000,
    )
    await chain.next()
    await expect(chain.next(true)).rejects.toMatchObject({
      name: SeatChainExhaustedError.name,
      resumeAt: '2026-10-08T00:00:00.000Z',
    })
    expect(requestedProviders).toEqual(['anthropic', 'anthropic'])
  })

  it('rebinds the exact committed seat after restart', async () => {
    const authored = profile([
      {
        harness: 'claude-code',
        provider: 'anthropic',
        model: 'claude-opus-4-1',
        selector: { kind: 'all-eligible' },
      },
    ])
    const journal = new InMemorySpawnJournal()
    await journal.beginTree('run', new Date(0).toISOString())
    await new SeatChain(
      authored,
      'run',
      'run',
      journal,
      async () => ({ seat: 'claude-a', backend }),
      () => 1_000,
    ).next()
    let resumeSeatId: string | undefined
    const resumed = new SeatChain(
      authored,
      'run',
      'run',
      journal,
      async (request) => {
        resumeSeatId = request.resumeSeatId
        return { seat: 'claude-a', backend }
      },
      () => 2_000,
    )
    expect((await resumed.next()).segmentIndex).toBe(0)
    expect(resumeSeatId).toBe('claude-a')
    expect(
      (await journal.loadTree('run'))?.filter((event) => event.kind === 'seat-segment'),
    ).toHaveLength(1)
  })

  it('reuses a committed same-provider segment after a crash before dispatch', async () => {
    const authored = profile([
      {
        harness: 'claude-code',
        provider: 'anthropic',
        model: 'claude-opus-4-1',
        selector: { kind: 'all-eligible' },
      },
    ])
    const journal = new InMemorySpawnJournal()
    await journal.beginTree('run', new Date(0).toISOString())
    const select = async (request: SeatSelectionInput): Promise<SeatSelection> => ({
      seat: request.excludedSeatIds.length === 0 ? 'claude-a' : 'claude-b',
      backend,
      ...(request.excludedSeatIds.length === 0 ? {} : { nativeTurnGrant: true }),
    })
    let preparations = 0
    const first = new SeatChain(
      authored,
      'run',
      'run',
      journal,
      select,
      () => 1_000,
      undefined,
      async (selection) => {
        if (selection.seat === 'claude-b') preparations++
      },
    )
    await first.next()
    expect((await first.next(true)).seat).toBe('claude-b')
    const resumed = new SeatChain(authored, 'run', 'run', journal, select, () => 2_000)
    expect((await resumed.next()).seat).toBe('claude-b')
    expect(preparations).toBe(1)
  })

  it('replays an observer boundary lost after the committed journal append', async () => {
    const authored = profile([
      {
        harness: 'claude-code',
        provider: 'anthropic',
        model: 'claude-opus-4-1',
        selector: { kind: 'all-eligible' },
      },
    ])
    const journal = new InMemorySpawnJournal()
    await journal.beginTree('run', new Date(0).toISOString())
    const select = async (): Promise<SeatSelection> => ({ seat: 'claude-a', backend })
    const interrupted = new SeatChain(
      authored,
      'run',
      'run',
      journal,
      select,
      () => 1_000,
      async () => {
        throw new Error('observer interrupted')
      },
    )
    await expect(interrupted.next()).rejects.toThrow('observer interrupted')
    const delivered: string[] = []
    const resumed = new SeatChain(
      authored,
      'run',
      'run',
      journal,
      select,
      () => 2_000,
      async (segment, phase) => {
        delivered.push(`${phase}:${segment.seat}`)
      },
    )
    expect((await resumed.next()).segmentIndex).toBe(0)
    expect(delivered).toEqual(['started:claude-a'])
    expect(
      (await journal.loadTree('run'))?.filter((event) => event.kind === 'seat-segment'),
    ).toHaveLength(1)
  })

  it('does not mistake a generic HTTP 429 for a subscription limit', () => {
    expect(
      subscriptionUsageLimitSignal({
        error: 'HTTP 429 rate limit',
        errorCode: 'rate_limit_exceeded',
      }),
    ).toBeUndefined()
    expect(subscriptionUsageLimitSignal({ error: "Claude: You've hit your weekly limit" })).toBe(
      'subscription-usage-limit',
    )
  })
})
