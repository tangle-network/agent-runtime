/**
 * A `raw` transport event carries the harness's own event.
 *
 * The fixture is one real codex session recorded off the Sandbox SDK stream (a box on an OAuth
 * seat): 13 events, three of them `raw`, whose payloads name codex's own event types
 * (`thread.started`, `turn.started`, `turn.completed`). Reading such a payload as a canonical
 * type ended the stream on the first one and killed every codex worker seconds after its box
 * started, so these tests drive the fixture through the parser AND through the steerable sandbox
 * session that consumes it.
 *
 * The mismatch guard is still required for every other type: it is what catches a producer that
 * labels a canonical event one thing on the envelope and another in the payload.
 *
 * One of those payloads is codex's only token receipt: `turn.completed` carries the turn's usage,
 * and codex emits no canonical usage event at all. So the same fixture also pins the harness-usage
 * registry that reads it and the once-per-turn accounting the kernel does with it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/errors'
import { runAgentRounds } from '../../src/runtime'
import { decodeHarnessUsage } from '../../src/runtime/harness-usage'
import {
  canonicalStreamEventFromSandboxEvent,
  createSandboxUsageLedger,
  extractLlmCallEvent,
  sumSandboxUsage,
} from '../../src/runtime/sandbox-events'
import { createInbox } from '../../src/runtime/supervise/inbox'
import {
  createSteerableSandboxSession,
  type SteerableSandboxSession,
} from '../../src/runtime/supervise/sandbox-session'
import type { AgentRunSpec, OutputAdapter, SandboxClient } from '../../src/runtime/types'
import { type ScriptedPlanner, scriptedDriver } from '../kernel/refine-driver'
import { testAgentProfile } from '../kernel/test-agent-profile'

const codexSession: SandboxEvent[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'codex-session-events.json'), 'utf8'),
)

const transportTypes = [
  'start',
  'execution.started',
  'status',
  'status',
  'session.updated',
  'raw',
  'raw',
  'token',
  'message.part.updated',
  'raw',
  'status',
  'result',
  'done',
]

const rawPayloadTypes = ['thread.started', 'turn.started', 'turn.completed']

const payloadType = (event: SandboxEvent): unknown =>
  (event.data as { type?: unknown } | undefined)?.type

describe('the recorded codex session — every event survives the canonical parser', () => {
  it('is the 13-event stream the sandbox actually emitted', () => {
    expect(codexSession.map((event) => event.type)).toEqual(transportTypes)
    expect(codexSession.filter((event) => event.type === 'raw').map(payloadType)).toEqual(
      rawPayloadTypes,
    )
  })

  it('parses every event without throwing, and reads no raw payload as a canonical type', () => {
    for (const event of codexSession) {
      expect(() => canonicalStreamEventFromSandboxEvent(event)).not.toThrow()
    }
    // A harness-native payload is not a canonical event: it decodes to nothing and the consumer
    // reads it off the transport event, which still carries it verbatim.
    for (const event of codexSession.filter((item) => item.type === 'raw')) {
      expect(canonicalStreamEventFromSandboxEvent(event)).toBeUndefined()
    }
    expect(codexSession.map((event) => event.type)).toEqual(transportTypes)
    expect(codexSession.filter((event) => event.type === 'raw').map(payloadType)).toEqual(
      rawPayloadTypes,
    )
  })

  it('still decodes a raw payload that carries the canonical raw shape', () => {
    const canonical = canonicalStreamEventFromSandboxEvent({
      type: 'raw',
      data: { backend: 'codex', event: { type: 'turn.started' } },
    } as unknown as SandboxEvent)
    expect(canonical).toEqual({
      type: 'raw',
      backend: 'codex',
      event: { type: 'turn.started' },
    })
  })

  it('counts the codex usage block inside turn.completed exactly once for the turn', () => {
    const completed = codexSession.find((event) => payloadType(event) === 'turn.completed')
    expect(completed).toBeDefined()
    // The canonical reader sees no usage on a harness-native payload, which is why the harness
    // registry exists; the turn's tokens are read there and credited once by the ledger.
    expect(extractLlmCallEvent(completed as SandboxEvent, 'codex-worker')).toBeUndefined()
    expect(sumSandboxUsage(codexSession, 'codex-worker')).toEqual({
      input: 15575,
      output: 5,
      costUsd: 0,
      usdKnown: false,
    })
  })
})

/** Wrap a codex usage payload in the transport event codex actually emits. */
const codexTurn = (usage: unknown): SandboxEvent =>
  ({ type: 'raw', data: { type: 'turn.completed', usage } }) as unknown as SandboxEvent

/**
 * A second real codex turn, captured off `codex exec --json` and already checked in at
 * `tests/mcp/local-harness.test.ts`. It reports FOUR counters (no `cache_write_input_tokens`) and
 * a non-zero reasoning count that is a subset of the output count: 191 of 273.
 */
const capturedCodexTurn = {
  input_tokens: 41935,
  cached_input_tokens: 19200,
  output_tokens: 273,
  reasoning_output_tokens: 191,
}

describe('the codex usage decoder — the harness registry reads turn.completed', () => {
  const completed = codexSession.find(
    (event) => payloadType(event) === 'turn.completed',
  ) as SandboxEvent

  it('reads the recorded turn exactly, cache counters included', () => {
    expect(decodeHarnessUsage(completed, 'codex')).toEqual({
      harness: 'codex',
      input: 15575,
      output: 5,
      cachedInput: 11008,
      cacheWriteInput: 0,
      reasoningOutput: 0,
    })
  })

  it('reads the same numbers with no harness named, through the composite', () => {
    expect(decodeHarnessUsage(completed)).toEqual({
      harness: 'codex',
      input: 15575,
      output: 5,
      cachedInput: 11008,
      cacheWriteInput: 0,
      reasoningOutput: 0,
    })
  })

  it('reports nothing for the codex raw events that carry no usage', () => {
    for (const event of codexSession.filter(
      (item) => item.type === 'raw' && payloadType(item) !== 'turn.completed',
    )) {
      expect(decodeHarnessUsage(event, 'codex')).toBeUndefined()
    }
    expect(decodeHarnessUsage(codexSession[0] as SandboxEvent, 'codex')).toBeUndefined()
  })

  it('reports nothing for a turn.completed that carries no usage member at all', () => {
    expect(
      decodeHarnessUsage(
        { type: 'raw', data: { type: 'turn.completed' } } as unknown as SandboxEvent,
        'codex',
      ),
    ).toBeUndefined()
  })

  it('reads the four-counter record a provider-normalized capture reports', () => {
    // `cache_write_input_tokens` is the optional fifth counter: the codex CLI emits it and a
    // normalized capture omits it. An absent counter stays absent, never a zero.
    expect(decodeHarnessUsage(codexTurn(capturedCodexTurn), 'codex')).toEqual({
      harness: 'codex',
      input: 41935,
      output: 273,
      cachedInput: 19200,
      reasoningOutput: 191,
    })
  })

  it('counts reasoning tokens INSIDE the output total, never added to it', () => {
    // Codex bills reasoning inside `output_tokens`; `parseCodexUsageRecord` holds
    // `reasoning_output_tokens <= output_tokens` as an invariant. 273 is the whole output.
    const usage = sumSandboxUsage([codexTurn(capturedCodexTurn)], 'codex-worker')
    expect(usage.output).toBe(273)
    expect(usage.input).toBe(41935)
  })

  it('reads a turn whose output is almost all reasoning without inflating it', () => {
    // Measured on the codex CLI at reasoning high: 1516 of 1523 output tokens were reasoning and
    // the answer was about seven tokens of text. Adding them would report 3039.
    const usage = sumSandboxUsage(
      [
        codexTurn({
          input_tokens: 12,
          cached_input_tokens: 0,
          output_tokens: 1523,
          reasoning_output_tokens: 1516,
        }),
      ],
      'codex-worker',
    )
    expect(usage.output).toBe(1523)
  })

  it('refuses a record whose classified counter exceeds the total it classifies', () => {
    expect(() =>
      decodeHarnessUsage(
        codexTurn({
          input_tokens: 2,
          cached_input_tokens: 3,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        }),
        'codex',
      ),
    ).toThrow(/cached_input_tokens exceeds input_tokens/)
    expect(() =>
      decodeHarnessUsage(
        codexTurn({
          input_tokens: 2,
          cached_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 4,
        }),
        'codex',
      ),
    ).toThrow(/reasoning_output_tokens exceeds output_tokens/)
  })

  it('throws a ValidationError naming the field when a reported counter is unreadable', () => {
    expect(() => decodeHarnessUsage(codexTurn({ output_tokens: 5 }), 'codex')).toThrow(
      /codex turn\.completed: usage\.input_tokens must be a non-negative safe integer, received undefined/,
    )
    expect(() =>
      decodeHarnessUsage(
        codexTurn({ input_tokens: 10, cached_input_tokens: 0, output_tokens: '5' }),
        'codex',
      ),
    ).toThrow(/usage\.output_tokens must be a non-negative safe integer, received "5"/)
    expect(() =>
      decodeHarnessUsage(codexTurn({ input_tokens: 10, cached_input_tokens: -1 }), 'codex'),
    ).toThrow(/usage\.cached_input_tokens must be a non-negative safe integer, received -1/)
    expect(() => decodeHarnessUsage(codexTurn(7), 'codex')).toThrow(
      /usage must be an object, received 7/,
    )
    expect(() => decodeHarnessUsage(codexTurn({ output_tokens: 5 }), 'codex')).toThrow(
      ValidationError,
    )
  })

  it('reports nothing for a NAMED harness that has no decoder, never another harness adapter', () => {
    // A different harness's `turn.completed` read by codex's adapter would answer about the wrong
    // harness: it drops the counters codex does not name, or fails on a field codex requires.
    const kimiShaped = codexTurn({ input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 6 })
    expect(decodeHarnessUsage(kimiShaped, 'opencode')).toBeUndefined()
    expect(decodeHarnessUsage(kimiShaped, 'pi')).toBeUndefined()
    expect(decodeHarnessUsage(completed, 'claude-code')).toBeUndefined()
    // The same event under no harness at all still reaches the composite.
    expect(decodeHarnessUsage(completed)).toBeDefined()
  })
})

describe('the post-hoc reader stays pure — an unreadable receipt never throws', () => {
  it('sumSandboxUsage degrades to tokensKnown false and carries the decode message', () => {
    const events = [...codexSession.slice(0, 9), codexTurn({ output_tokens: 5 })]
    const usage = sumSandboxUsage(events, 'codex-worker')
    expect(usage.tokensKnown).toBe(false)
    expect(usage.tokensUnknownReason).toMatch(
      /codex turn\.completed: usage\.input_tokens must be a non-negative safe integer/,
    )
    expect(usage.input).toBe(0)
    expect(usage.output).toBe(0)
  })

  it('still meters the canonical usage of a turn whose harness receipt is unreadable', () => {
    const events = [
      { type: 'llm_call', data: { tokensIn: 30, tokensOut: 9 } } as unknown as SandboxEvent,
      codexTurn({ output_tokens: 5 }),
    ]
    const usage = sumSandboxUsage(events, 'codex-worker')
    expect(usage.input).toBe(30)
    expect(usage.output).toBe(9)
    expect(usage.tokensKnown).toBe(false)
  })
})

describe('the ledger boundary — an unreadable receipt is an unknown spend, never a throw', () => {
  it('returns a receipt marked unknown with the decode message, and still credits a readable one', () => {
    // Whether the work SUCCEEDED and whether its spend was MEASURED are different facts, so the
    // ledger answers a receipt it cannot read the way it answers one it can: as a receipt. Every
    // consumer then marks the spend unknown through the fold it already applies, and none of them
    // decides on its own whether an unreadable counter fails the turn (agent-runtime#1027).
    const ledger = createSandboxUsageLedger('codex')
    expect(ledger.observe(codexTurn({ output_tokens: 5 }), 'codex-worker')).toEqual({
      type: 'llm_call',
      model: 'codex-worker',
      tokensKnown: false,
      usdKnown: false,
      tokensUnknownReason: expect.stringMatching(
        /codex turn\.completed: usage\.input_tokens must be a non-negative safe integer/,
      ),
    })
    // A receipt the ledger CAN read in the same turn is still a floor the turn spent.
    const readable = {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 4,
      reasoning_output_tokens: 0,
    }
    expect(ledger.observe(codexTurn(readable), 'codex-worker')).toBeUndefined()
    expect(ledger.settleTurn('codex-worker')).toMatchObject({ tokensIn: 10, tokensOut: 4 })
  })
})

describe('once per turn — a canonical usage event wins over the harness receipt', () => {
  const canonicalUsage = {
    type: 'usage',
    data: { inputTokens: 120, outputTokens: 30 },
  } as unknown as SandboxEvent

  it('credits only the canonical numbers when a turn reports both', () => {
    const both = [...codexSession.slice(0, 12), canonicalUsage, ...codexSession.slice(12)]
    expect(sumSandboxUsage(both, 'codex-worker')).toEqual({
      input: 120,
      output: 30,
      costUsd: 0,
      usdKnown: false,
    })
  })

  it('credits the harness receipt for a turn that reports it alone', () => {
    expect(sumSandboxUsage(codexSession, 'codex-worker').input).toBe(15575)
  })
})

describe('the canonical mismatch guard — kept for every non-raw type', () => {
  it('throws when the payload type disagrees with the transport type', () => {
    expect(() =>
      canonicalStreamEventFromSandboxEvent({
        type: 'status',
        data: { type: 'warning', status: 'complete' },
      } as unknown as SandboxEvent),
    ).toThrow(/canonical event type "warning" does not match transport type "status"/)
  })

  it('throws when a normalized event disagrees with the transport type', () => {
    expect(() =>
      canonicalStreamEventFromSandboxEvent({
        type: 'status',
        data: { normalized: { type: 'warning', code: 'x', message: 'y' } },
      } as unknown as SandboxEvent),
    ).toThrow(/canonical event type "warning" does not match transport type "status"/)
  })

  it('throws when a non-raw normalized event is not a canonical event at all', () => {
    expect(() =>
      canonicalStreamEventFromSandboxEvent({
        type: 'status',
        data: { normalized: { type: 'status' } },
      } as unknown as SandboxEvent),
    ).toThrow(/invalid normalized canonical event/)
  })
})

/** A box that replays the recorded codex session for its first turn. */
function replayingClient(events: SandboxEvent[], observed: string[]): SandboxClient {
  return {
    async create(): Promise<SandboxInstance> {
      return {
        id: 'codex-box',
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          for (const event of events) {
            observed.push(String(event.type))
            yield event
          }
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
}

/** A codex worker over `sandboxClient`, inert until its stream is drained. */
function codexWorker(sandboxClient: SandboxClient, inbox = createInbox()): SteerableSandboxSession {
  return createSteerableSandboxSession({
    controller: new AbortController(),
    // The recorded stream reports this exact served backend, so the worker's requested
    // instrument must be the same one — a mismatch is a different failure.
    profile: testAgentProfile('codex-worker', {
      harness: 'codex',
      model: { provider: 'openai', default: 'gpt-5.6-sol' },
    }),
    harness: 'codex',
    sandboxClient,
    inbox,
    taskToPrompt: (task) => String(task),
    contentRef: (prefix) => `${prefix}:ref`,
  })
}

/** Drive the steerable worker over `events` and report what it observed and settled. */
async function replayCodexSession(
  events: SandboxEvent[],
): Promise<{ observed: string[]; artifact: ReturnType<SteerableSandboxSession['artifact']> }> {
  const observed: string[] = []
  const session = codexWorker(replayingClient(events, observed))
  for await (const _event of session.stream('say OK', new AbortController().signal)) {
    // The assertions read the settled artifact, which already folds the usage stream.
  }
  return { observed, artifact: session.artifact() }
}

describe('the steerable sandbox worker — a codex session runs to settlement', () => {
  it('consumes all 13 events and settles on the session text', async () => {
    const { observed, artifact } = await replayCodexSession(codexSession)

    expect(observed).toEqual(transportTypes)
    expect((artifact?.out as { content?: string } | undefined)?.content).toBe('OK')
    expect(artifact?.verdict?.valid).toBe(true)
    expect(artifact?.spent.iterations).toBe(1)
  })

  it('settles with the turn.completed tokens known, classified against the prompt total', async () => {
    const { artifact } = await replayCodexSession(codexSession)

    // `input` is codex's whole prompt count and the cache counters partition it:
    // 4567 fresh + 11008 read + 0 written = 15575. `output` is codex's whole completion count,
    // the reasoning tokens included rather than added.
    expect(artifact?.spent.tokens).toEqual({
      input: 15575,
      output: 5,
      freshInput: 4567,
      cacheRead: 11008,
      cacheWrite: 0,
    })
    expect(artifact?.spent.tokensKnown).toBeUndefined()
  })

  it('credits the reported tokens of a turn whose stream fails after turn.completed', async () => {
    const failing: SandboxClient = {
      async create(): Promise<SandboxInstance> {
        return {
          id: 'codex-box',
          async *streamPrompt(): AsyncGenerator<SandboxEvent> {
            for (const event of codexSession.slice(0, 10)) yield event
            throw new Error('stream dropped')
          },
          async delete() {},
        } as unknown as SandboxInstance
      },
    }
    const session = codexWorker(failing)

    const usage: unknown[] = []
    await expect(async () => {
      for await (const event of session.stream('say OK', new AbortController().signal)) {
        if ((event as { kind?: string }).kind === 'tokens') usage.push(event)
      }
    }).rejects.toThrow(/stream dropped/)

    expect(usage).toEqual([
      {
        kind: 'tokens',
        input: 15575,
        output: 5,
        freshInput: 4567,
        cacheRead: 11008,
        cacheWrite: 0,
      },
    ])
  })

  it('credits one turn once when the stream also carries a canonical usage event', async () => {
    const both = [
      ...codexSession.slice(0, 12),
      { type: 'usage', data: { inputTokens: 120, outputTokens: 30 } } as unknown as SandboxEvent,
      ...codexSession.slice(12),
    ]
    const { artifact } = await replayCodexSession(both)

    // Only the canonical numbers, and its own cache split stays unknown because it reports none.
    expect(artifact?.spent.tokens).toEqual({
      input: 120,
      output: 30,
      cacheBreakdownKnown: false,
    })
    expect(artifact?.spent.tokensKnown).toBeUndefined()
  })

  it('accounts each turn on its own: a later turn with no receipt credits nothing again', async () => {
    // The ledger resets when a turn settles. Without that reset, turn 1's held receipt would be
    // credited a second time at the end of turn 2 and the session would report 31150 tokens.
    const turns: SandboxEvent[][] = [
      codexSession,
      [
        { type: 'token', data: { value: 'again' } } as unknown as SandboxEvent,
        { type: 'result', data: { finalText: 'again', outcome: { type: 'completed' } } },
        { type: 'done', data: { outcome: { type: 'completed' } } },
      ] as SandboxEvent[],
    ]
    let turn = 0
    const inbox = createInbox()
    const client: SandboxClient = {
      async create(): Promise<SandboxInstance> {
        return {
          id: 'codex-box',
          async *streamPrompt(): AsyncGenerator<SandboxEvent> {
            const events = turns[Math.min(turn, turns.length - 1)] ?? []
            turn += 1
            // The steer lands during turn 0, so the worker may not settle until it has folded it.
            if (turn === 1) inbox.deliver({ steer: 'now say it again' })
            for (const event of events) yield event
          },
          async delete() {},
        } as unknown as SandboxInstance
      },
    }
    const session = codexWorker(client, inbox)
    for await (const _event of session.stream('say OK', new AbortController().signal)) {
      // The assertions read the settled artifact.
    }

    const artifact = session.artifact()
    expect(artifact?.spent.iterations).toBe(2)
    // Turn 1's numbers, exactly once, plus turn 2 which reported no usage at all.
    expect(artifact?.spent.tokens).toMatchObject({ input: 15575, output: 5, cacheRead: 11008 })
    expect(artifact?.spent.tokensKnown).toBe(false)
  })

  it('settles a worker whose usage receipt is unreadable instead of aborting its session', async () => {
    // Whether the work SUCCEEDED and whether its spend was MEASURED are different facts. A decode
    // problem must never abort a live codex session, and it must never fail a correct worker
    // either: an invalid verdict here would drop it from every valid-winner selection. The worker
    // settles on its own outcome, and the unknown spend rides the channel built for it.
    const broken = [
      ...codexSession.slice(0, 9),
      codexTurn({ output_tokens: 5 }),
      ...codexSession.slice(10),
    ]
    const observed: string[] = []
    const session = codexWorker(replayingClient(broken, observed))
    for await (const _event of session.stream('say OK', new AbortController().signal)) {
      // Draining must complete: an unreadable receipt is a spend fact, not a stream error.
    }

    expect(observed).toEqual(transportTypes)
    const artifact = session.artifact()
    const out = artifact?.out as { content?: string; tokensUnknownReason?: string } | undefined
    expect(out?.content).toBe('OK')
    // The verdict is the box's own completed outcome, exactly as a readable turn would settle.
    expect(artifact?.verdict).toEqual({ valid: true, score: 1 })
    expect(artifact?.spent.tokensKnown).toBe(false)
    expect(out?.tokensUnknownReason).toMatch(
      /codex turn\.completed: usage\.input_tokens must be a non-negative safe integer/,
    )
  })
})

describe('the leaf kernel — one runAgentRounds iteration over a codex box', () => {
  const output: OutputAdapter<string> = { parse: () => 'done' }
  const agentRuns: AgentRunSpec<string>[] = [
    {
      // The recorded stream reports this served backend, so the iteration must ask for it.
      profile: testAgentProfile('codex-leaf', {
        harness: 'codex',
        model: { provider: 'openai', default: 'gpt-5.6-sol' },
      }),
      name: 'codex-leaf',
      taskToPrompt: (task) => task,
    },
  ]
  const oneRound: ScriptedPlanner<string, string> = () => ({ kind: 'refine', task: 'go' })
  const codexBox = (events: SandboxEvent[], thenThrow?: Error): SandboxClient =>
    ({
      async create(): Promise<SandboxInstance> {
        return {
          async *streamPrompt(): AsyncGenerator<SandboxEvent> {
            for (const event of events) yield event
            if (thenThrow) throw thenThrow
          },
        } as unknown as SandboxInstance
      },
    }) as unknown as SandboxClient

  it('credits the turn.completed tokens onto the run record, classified against the total', async () => {
    const result = await runAgentRounds<string, string, 'continue' | 'done'>({
      driver: scriptedDriver<string, string>({ planner: oneRound, maxIterations: 1 }),
      agentRuns,
      output,
      task: 'start',
      ctx: { sandboxClient: codexBox([...codexSession]) },
      maxIterations: 1,
    })

    expect(result.tokenUsage).toMatchObject({
      input: 15575,
      output: 5,
      freshInput: 4567,
      cacheRead: 11008,
      cacheWrite: 0,
    })
    expect(result.tokenUsage.tokensKnown).toBeUndefined()
    expect(result.promptCache).toEqual({ readTokens: 11008, writeTokens: 0 })
  })

  it('credits the receipt of an iteration whose stream failed after it', async () => {
    const result = await runAgentRounds<string, string, 'continue' | 'done'>({
      driver: scriptedDriver<string, string>({ planner: oneRound, maxIterations: 1 }),
      agentRuns,
      output,
      task: 'start',
      ctx: {
        sandboxClient: codexBox(codexSession.slice(0, 10), new Error('stream dropped')),
      },
      maxIterations: 1,
    })

    expect(result.iterations[0]?.error?.message).toMatch(/stream dropped/)
    expect(result.tokenUsage).toMatchObject({ input: 15575, output: 5, cacheRead: 11008 })
  })

  it('settles an iteration whose usage receipt is unreadable instead of failing the batch', async () => {
    // A counter the ledger cannot read is a measurement fact, not an outcome fact. The iteration
    // keeps the outcome the box reported and its tokens read as unknown. Before the ledger owned
    // this policy the decode error failed the iteration and, as a ValidationError, aborted the
    // whole batch: a correct answer became a failed run (agent-runtime#1027).
    const broken = [
      ...codexSession.slice(0, 9),
      codexTurn({ output_tokens: 5 }),
      ...codexSession.slice(10),
    ]
    const result = await runAgentRounds<string, string, 'continue' | 'done'>({
      driver: scriptedDriver<string, string>({ planner: oneRound, maxIterations: 1 }),
      agentRuns,
      output,
      task: 'start',
      ctx: { sandboxClient: codexBox(broken) },
      maxIterations: 1,
    })

    const iteration = result.iterations[0]
    expect(iteration?.error).toBeUndefined()
    expect(iteration?.output).toBe('done')
    expect(iteration?.sandboxOutcome?.status).toBe('success')
    expect(result.tokenUsage).toMatchObject({ input: 0, output: 0, tokensKnown: false })
  })
})
