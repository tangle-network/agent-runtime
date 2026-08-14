/**
 * The provider's own prompt-cache accounting, on the bridge path.
 *
 * A cli-bridge turn reaches the kernel as a sandbox event carrying an OpenAI-compatible usage
 * object. The bridge normalizes every backend to `cache_read_input_tokens` /
 * `cache_write_input_tokens` (`cli-bridge/src/streaming/sse.ts`), but the backends underneath do
 * not all report both counters, and one reports neither. These tests pin what each shape must
 * surface — and that an unreported counter stays absent rather than becoming a zero.
 */

import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  type OutputAdapter,
  runAgentRounds,
  type Validator,
} from '../../src/runtime'
import { extractLlmCallEvent } from '../../src/runtime/sandbox-events'
import { createInbox } from '../../src/runtime/supervise/inbox'
import { createSteerableSandboxSession } from '../../src/runtime/supervise/sandbox-session'
import type { UsageEvent } from '../../src/runtime/supervise/types'
import type { LoopTokenUsage, SandboxClient } from '../../src/runtime/types'
import {
  addTokenUsage,
  chargedTokens,
  hasCompleteCacheBreakdown,
  promptCacheTokenClasses,
  zeroTokenUsage,
} from '../../src/runtime/util'
import { type ScriptedPlanner, scriptedDriver } from './refine-driver'
import { testAgentProfile } from './test-agent-profile'

/** One cli-bridge turn as it reaches the kernel: an OpenAI-compatible usage object on `result`. */
const bridgeTurn = (usage: Record<string, unknown>): SandboxEvent =>
  ({
    type: 'result',
    data: { model: 'bridge/claude-code', usage },
  }) as SandboxEvent

describe('extractLlmCallEvent — provider prompt-cache accounting on the bridge wire', () => {
  it('surfaces an Anthropic-shaped split as a complete partition of the prompt total', () => {
    const call = extractLlmCallEvent(
      bridgeTurn({
        prompt_tokens: 10_000,
        completion_tokens: 300,
        cache_read_input_tokens: 8_000,
        cache_write_input_tokens: 1_500,
      }),
      'agent',
    )
    expect(call?.promptCache).toEqual({
      readTokens: 8_000,
      writeTokens: 1_500,
    })
    expect(promptCacheTokenClasses(call?.tokensIn, call?.promptCache)).toEqual({
      freshInput: 500,
      cacheRead: 8_000,
      cacheWrite: 1_500,
    })
  })

  it('reads Anthropic verbatim naming, where the write counter is cache_creation_input_tokens', () => {
    const call = extractLlmCallEvent(
      bridgeTurn({
        prompt_tokens: 4_000,
        completion_tokens: 100,
        cache_read_input_tokens: 3_000,
        cache_creation_input_tokens: 600,
      }),
      'agent',
    )
    expect(call?.promptCache).toEqual({ readTokens: 3_000, writeTokens: 600 })
  })

  it('surfaces an OpenAI-shaped read with the write counter ABSENT, not zero', () => {
    const call = extractLlmCallEvent(
      bridgeTurn({
        prompt_tokens: 5_000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 4_096 },
      }),
      'agent',
    )
    expect(call?.promptCache).toEqual({ readTokens: 4_096 })
    expect(call?.promptCache?.writeTokens).toBeUndefined()
    // The read is measured, so it is credited; the rest of the prompt is unclassified, so the
    // split is declared incomplete rather than completed with an invented zero write.
    expect(promptCacheTokenClasses(call?.tokensIn, call?.promptCache)).toEqual({
      cacheRead: 4_096,
      cacheBreakdownKnown: false,
    })
  })

  it('reads a DeepSeek-shaped hit/miss pair', () => {
    const call = extractLlmCallEvent(
      bridgeTurn({
        prompt_tokens: 2_000,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 1_800,
        prompt_cache_miss_tokens: 200,
      }),
      'agent',
    )
    expect(call?.promptCache).toEqual({ readTokens: 1_800, missTokens: 200 })
  })

  it('leaves promptCache undefined when the provider reported no cache at all', () => {
    const call = extractLlmCallEvent(
      bridgeTurn({ prompt_tokens: 900, completion_tokens: 40 }),
      'agent',
    )
    expect(call?.tokensIn).toBe(900)
    expect(call?.promptCache).toBeUndefined()
    expect(promptCacheTokenClasses(call?.tokensIn, call?.promptCache)).toEqual({})
  })

  it('reads the sandbox terminal `done` record, whose counters live under tokenUsage', () => {
    const call = extractLlmCallEvent(
      {
        type: 'done',
        data: {
          tokenUsage: {
            inputTokens: 7_000,
            outputTokens: 250,
            cacheReadInputTokens: 6_000,
            cacheCreationInputTokens: 400,
          },
        },
      } as SandboxEvent,
      'agent',
    )
    expect(call?.promptCache).toEqual({ readTokens: 6_000, writeTokens: 400 })
    expect(promptCacheTokenClasses(call?.tokensIn, call?.promptCache)).toEqual({
      freshInput: 600,
      cacheRead: 6_000,
      cacheWrite: 400,
    })
  })

  it('keeps an unrecognized provider field visible alongside the canonical names', () => {
    const call = extractLlmCallEvent(
      bridgeTurn({
        prompt_tokens: 100,
        completion_tokens: 10,
        promptCache: { readTokens: 60, status: 'hit', tier: 'ephemeral-1h' },
      }),
      'agent',
    )
    expect(call?.promptCache).toEqual({
      readTokens: 60,
      status: 'hit',
      tier: 'ephemeral-1h',
    })
  })

  it('refuses a claim that overflows the prompt total it says it partitions', () => {
    const call = extractLlmCallEvent(
      bridgeTurn({
        prompt_tokens: 1_000,
        completion_tokens: 10,
        cache_read_input_tokens: 900,
        cache_write_input_tokens: 400,
      }),
      'agent',
    )
    expect(call?.promptCache).toEqual({ readTokens: 900, writeTokens: 400 })
    expect(promptCacheTokenClasses(call?.tokensIn, call?.promptCache)).toEqual({
      cacheBreakdownKnown: false,
    })
  })
})

describe('the budget charge over a populated bridge turn', () => {
  const fold = (usage: Record<string, unknown>): LoopTokenUsage => {
    const call = extractLlmCallEvent(bridgeTurn(usage), 'agent')
    const acc = zeroTokenUsage()
    addTokenUsage(acc, {
      input: call?.tokensIn,
      output: call?.tokensOut,
      ...promptCacheTokenClasses(call?.tokensIn, call?.promptCache),
    })
    return acc
  }

  it('charges input − cacheRead + output on a complete Anthropic-shaped split', () => {
    const acc = fold({
      prompt_tokens: 10_000,
      completion_tokens: 300,
      cache_read_input_tokens: 8_000,
      cache_write_input_tokens: 1_500,
    })
    expect(chargedTokens(acc)).toBe(10_000 - 8_000 + 300)
    expect(hasCompleteCacheBreakdown(acc)).toBe(true)
  })

  it('credits an OpenAI-shaped read while declaring the split incomplete', () => {
    const acc = fold({
      prompt_tokens: 5_000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 4_096 },
    })
    expect(chargedTokens(acc)).toBe(5_000 - 4_096 + 200)
    expect(hasCompleteCacheBreakdown(acc)).toBe(false)
  })

  it('charges the full prompt when the provider reported no cache', () => {
    const acc = fold({ prompt_tokens: 5_000, completion_tokens: 200 })
    expect(chargedTokens(acc)).toBe(5_200)
    expect(acc.cacheRead).toBeUndefined()
    expect(hasCompleteCacheBreakdown(acc)).toBe(false)
  })
})

// ── The two loops that write the run journal ─────────────────────────────────

const output: OutputAdapter<string> = { parse: () => 'done' }
const validator: Validator<string> = {
  async validate() {
    return { valid: true, score: 1 }
  },
}
const agentRuns: AgentRunSpec<string>[] = [
  { profile: testAgentProfile('a'), name: 'a', taskToPrompt: (t) => t },
]
/** One dispatched iteration, then the driver's own maxIterations stops the loop. */
const oneRound: ScriptedPlanner<string, string> = () => ({
  kind: 'refine',
  task: 'go',
})

function cacheReportingClient(usage: Record<string, unknown>): SandboxClient {
  return {
    async create(_o?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        async *streamPrompt(_message: string) {
          yield bridgeTurn(usage)
        },
      } as unknown as SandboxInstance
    },
  } as unknown as SandboxClient
}

describe('runAgentRounds — the cache report reaches the run record', () => {
  it('records the provider split on the iteration and classifies the spend', async () => {
    const result = await runAgentRounds<string, string, 'continue' | 'done'>({
      driver: scriptedDriver<string, string>({
        planner: oneRound,
        maxIterations: 1,
      }),
      agentRuns,
      output,
      validator,
      task: 'start',
      ctx: {
        sandboxClient: cacheReportingClient({
          prompt_tokens: 10_000,
          completion_tokens: 300,
          cache_read_input_tokens: 8_000,
          cache_write_input_tokens: 1_500,
        }),
      },
      maxIterations: 1,
    })
    expect(result.promptCache).toEqual({
      readTokens: 8_000,
      writeTokens: 1_500,
    })
    expect(result.tokenUsage.freshInput).toBe(500)
    expect(result.tokenUsage.cacheRead).toBe(8_000)
    expect(result.tokenUsage.cacheWrite).toBe(1_500)
    expect(chargedTokens(result.tokenUsage)).toBe(2_300)
  })

  it('leaves the split unknown when the provider reports only a read', async () => {
    const result = await runAgentRounds<string, string, 'continue' | 'done'>({
      driver: scriptedDriver<string, string>({
        planner: oneRound,
        maxIterations: 1,
      }),
      agentRuns,
      output,
      validator,
      task: 'start',
      ctx: {
        sandboxClient: cacheReportingClient({
          prompt_tokens: 5_000,
          completion_tokens: 200,
          prompt_tokens_details: { cached_tokens: 4_096 },
        }),
      },
      maxIterations: 1,
    })
    expect(result.promptCache).toEqual({ readTokens: 4_096 })
    expect(result.tokenUsage.cacheRead).toBe(4_096)
    expect(result.tokenUsage.cacheWrite).toBeUndefined()
    expect(result.tokenUsage.cacheBreakdownKnown).toBe(false)
  })
})

describe('the steerable sandbox worker — cache classes on the usage stream', () => {
  const drain = async (usage: Record<string, unknown>): Promise<UsageEvent[]> => {
    const session = createSteerableSandboxSession({
      controller: new AbortController(),
      profile: testAgentProfile('worker'),
      harness: 'opencode',
      sandboxClient: cacheReportingClient(usage),
      inbox: createInbox(),
      taskToPrompt: (t) => String(t),
      contentRef: (prefix) => `${prefix}:ref`,
    })
    const events: UsageEvent[] = []
    for await (const ev of session.stream('task', new AbortController().signal)) events.push(ev)
    return events
  }

  it('yields the complete split a provider reported', async () => {
    const events = await drain({
      prompt_tokens: 10_000,
      completion_tokens: 300,
      cache_read_input_tokens: 8_000,
      cache_write_input_tokens: 1_500,
    })
    expect(events.find((e) => e.kind === 'tokens')).toEqual({
      kind: 'tokens',
      input: 10_000,
      output: 300,
      freshInput: 500,
      cacheRead: 8_000,
      cacheWrite: 1_500,
    })
  })

  it('yields a read-only report with the write absent and the split declared incomplete', async () => {
    const events = await drain({
      prompt_tokens: 5_000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 4_096 },
    })
    expect(events.find((e) => e.kind === 'tokens')).toEqual({
      kind: 'tokens',
      input: 5_000,
      output: 200,
      cacheRead: 4_096,
      cacheBreakdownKnown: false,
    })
  })

  it('yields no cache classes when the provider reported none', async () => {
    const events = await drain({ prompt_tokens: 900, completion_tokens: 40 })
    expect(events.find((e) => e.kind === 'tokens')).toEqual({
      kind: 'tokens',
      input: 900,
      output: 40,
    })
  })
})
