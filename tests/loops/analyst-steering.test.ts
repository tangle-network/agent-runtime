import {
  type AnalystContext,
  type AnalystFinding,
  type ChatResponse,
  createChatClient,
  makeFinding,
} from '@tangle-network/agent-eval'
import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  createAnalystSteering,
  createDynamicDriver,
  createSteeringPlanner,
  type Iteration,
  type OutputAdapter,
  runLoop,
  type Validator,
} from '../../src/loops'

// ── Iteration factory ────────────────────────────────────────────────────────
function iter<T = unknown, O = unknown>(over: Partial<Iteration<T, O>>): Iteration<T, O> {
  return {
    index: 0,
    task: {} as T,
    agentRunName: 'worker',
    events: [],
    startedAt: 0,
    endedAt: 1,
    costUsd: 0,
    tokenUsage: { input: 0, output: 0 },
    ...over,
  } as Iteration<T, O>
}

// A real, schema-valid AnalystFinding (built via the substrate's makeFinding).
function finding(over: Partial<AnalystFinding> & { claim: string }): AnalystFinding {
  return makeFinding({
    analyst_id: 'test-analyst',
    severity: 'high',
    area: 'tool-use',
    evidence_refs: [],
    confidence: 0.9,
    ...over,
  })
}

// Minimal Analyst contract impl — stands in for an agent-eval kind (the KIND
// lives in the substrate; we test the runtime ADAPTER that consumes it).
type AnalyzeFn = (input: unknown, ctx: AnalystContext) => Promise<AnalystFinding[]>
function analyst(
  id: string,
  kind: 'deterministic' | 'llm',
  analyze: AnalyzeFn,
): import('@tangle-network/agent-eval').Analyst {
  return {
    id,
    description: `${id} (${kind})`,
    inputKind: 'custom',
    cost: { kind },
    version: '1.0.0',
    analyze,
  }
}

describe('createAnalystSteering — adapter behavior', () => {
  it('maps a deterministic analyst’s findings to steering signals', async () => {
    const a = analyst('det', 'deterministic', async () => [
      finding({
        subject: 'tool-monoculture',
        claim: '7 calls to grep, 0 to the calculator',
        recommended_action: 'call calc_qbi on line 13',
        severity: 'high',
      }),
    ])
    const analyze = createAnalystSteering({ analysts: [a], toInput: (l) => l })
    const signals = await analyze(iter({ verdict: { valid: false, score: 0.3 } }), [])
    expect(signals).toEqual([
      {
        label: 'tool-monoculture',
        detail: '7 calls to grep, 0 to the calculator → call calc_qbi on line 13',
        severity: 'high',
      },
    ])
  })

  it('runs an LLM-kind analyst through a real (mock-transport) ChatClient', async () => {
    // The analyst actually calls ctx.chat — exercising agent-eval's real
    // ChatClient seam — and turns the model's answer into a finding. The mock
    // transport returns a deterministic completion, so this proves the wiring
    // end-to-end with NO router/platform dependency.
    const chat = createChatClient({
      transport: 'mock',
      defaultModel: 'mock',
      handler: async (): Promise<ChatResponse> => ({
        content: 'switch to parallel-tools',
        usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
        costUsd: 0,
        model: 'mock',
        durationMs: 0,
        raw: {},
      }),
    })
    let sawChat = false
    const llm = analyst('llm', 'llm', async (_input, ctx) => {
      const res = await ctx.chat!.chat({ messages: [{ role: 'user', content: 'how to fix?' }] })
      sawChat = true
      return [
        finding({ subject: 'fix', claim: 'the worker stalled', recommended_action: res.content }),
      ]
    })
    const analyze = createAnalystSteering({ analysts: [llm], toInput: (l) => l, chat })
    const signals = await analyze(iter({ verdict: { valid: false, score: 0.3 } }), [])
    expect(sawChat).toBe(true)
    expect(signals).toEqual([
      { label: 'fix', detail: 'the worker stalled → switch to parallel-tools', severity: 'high' },
    ])
  })

  it('skips an LLM analyst when no chat client is provided (platform-down path)', async () => {
    let ran = false
    const llm = analyst('llm', 'llm', async () => {
      ran = true
      return [finding({ claim: 'should not run' })]
    })
    const analyze = createAnalystSteering({ analysts: [llm], toInput: (l) => l })
    const signals = await analyze(iter({ verdict: { valid: false, score: 0.3 } }), [])
    expect(ran).toBe(false) // never invoked — no transport
    expect(signals).toHaveLength(1)
    expect(signals[0]?.label).toBe('analyst-skipped')
    expect(signals[0]?.severity).toBe('info')
    expect(signals[0]?.detail).toMatch(/needs an LLM chat client/)
  })

  it('isolates a failing analyst — the rest still produce signals', async () => {
    const boom = analyst('boom', 'deterministic', async () => {
      throw new Error('analyst kernel panic')
    })
    const ok = analyst('ok', 'deterministic', async () => [
      finding({ subject: 'real', claim: 'a genuine finding' }),
    ])
    const analyze = createAnalystSteering({ analysts: [boom, ok], toInput: (l) => l })
    const signals = await analyze(iter({ verdict: { valid: false, score: 0.3 } }), [])
    expect(signals.map((s) => s.label)).toEqual(['analyst-error', 'real'])
    expect(signals[0]?.detail).toMatch(/boom.*analyst kernel panic/)
  })

  it('threads the prior round’s findings into the next round’s AnalystContext', async () => {
    const seenPrior: Array<ReadonlyArray<AnalystFinding> | undefined> = []
    const a = analyst('mem', 'deterministic', async (_input, ctx) => {
      seenPrior.push(ctx.priorFindings)
      return [finding({ subject: 'recurring', claim: 'still broken' })]
    })
    const analyze = createAnalystSteering({ analysts: [a], toInput: (l) => l })
    await analyze(iter({ index: 0, verdict: { valid: false, score: 0.3 } }), [])
    await analyze(iter({ index: 1, verdict: { valid: false, score: 0.3 } }), [])
    expect(seenPrior[0]).toBeUndefined() // round 1: no prior findings
    expect(seenPrior[1]?.map((f) => f.subject)).toEqual(['recurring']) // round 2 sees round 1
  })

  it('degrades to an info signal when toInput throws (loop must not abort)', async () => {
    const a = analyst('det', 'deterministic', async () => [finding({ claim: 'never reached' })])
    const analyze = createAnalystSteering({
      analysts: [a],
      toInput: () => {
        throw new Error('trace store unavailable')
      },
    })
    const signals = await analyze(iter({ verdict: { valid: false, score: 0.3 } }), [])
    expect(signals).toHaveLength(1)
    expect(signals[0]?.label).toBe('analyst-input-error')
    expect(signals[0]?.detail).toMatch(/trace store unavailable/)
  })
})

// ── Full-loop proof: an analyst finding steers a real loop off the plateau ────
// Same kernel + steering planner as Gen 1, but the steering signal now comes
// from a REAL Analyst.analyze() via createAnalystSteering — not defaultAnalyze.
interface Task {
  goal: string
  strategy: string
}
interface Out {
  strategy: string
  score: number
}
const GOAL = 'produce the correct return'
const FIX = 'parallel-tools'
const scoreFor = (s: string) => (s.startsWith('parallel') ? 0.9 : 0.3)

const output: OutputAdapter<Out> = {
  parse(events) {
    const d = events.at(-1)?.data as Partial<Out> | undefined
    return { strategy: d?.strategy ?? '', score: typeof d?.score === 'number' ? d.score : 0 }
  },
}
const validator: Validator<Out> = {
  async validate(o) {
    return { valid: o.score >= 0.7, score: o.score }
  },
}

function workerClient() {
  const dispatched: string[] = []
  return {
    dispatched,
    client: {
      async create(): Promise<SandboxInstance> {
        return {
          async *streamPrompt(message: string) {
            const t = JSON.parse(message) as Task
            dispatched.push(t.strategy)
            yield {
              type: 'result',
              data: { strategy: t.strategy, score: scoreFor(t.strategy) },
            } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    },
  }
}

// Driver steers to whatever strategy the analyst's recommended_action names —
// proving the analyst's recommendation reaches the driver through the prompt.
function driverClient() {
  const prompts: string[] = []
  return {
    prompts,
    client: {
      async create(_o?: CreateSandboxOptions): Promise<SandboxInstance> {
        return {
          async *streamPrompt(message: string) {
            prompts.push(message)
            const move = /"valid":\s*true/.test(message)
              ? { kind: 'stop', rationale: 'valid' }
              : message.includes(FIX)
                ? {
                    kind: 'refine',
                    tasks: [{ goal: GOAL, strategy: FIX }],
                    rationale: 'steer to the analyst-recommended strategy',
                  }
                : {
                    kind: 'refine',
                    tasks: [{ goal: GOAL, strategy: 'naive' }],
                    rationale: 'replay',
                  }
            yield { type: 'result', data: { result: move } } satisfies SandboxEvent
          },
        } as unknown as SandboxInstance
      },
    },
  }
}

describe('createAnalystSteering — drives a real loop off the plateau', () => {
  it('an analyst finding (not defaultAnalyze) steers naive → fix → valid', async () => {
    const worker = workerClient()
    const driver = driverClient()

    // Deterministic analyst: when the latest attempt is invalid, recommend the
    // fix strategy. Empty history (round 1) → no finding → driver replays naive.
    const qbiAnalyst = analyst('weak-strategy', 'deterministic', async (input) => {
      const it = input as Iteration<Task, Out>
      if (it?.verdict && !it.verdict.valid) {
        return [
          finding({
            subject: 'weak-strategy',
            claim: `attempt used a weak strategy (score ${it.verdict.score})`,
            recommended_action: `rewrite the task to use the ${FIX} strategy`,
            severity: 'high',
          }),
        ]
      }
      return []
    })

    const result = await runLoop<Task, Out>({
      driver: createDynamicDriver<Task, Out>({
        planner: createSteeringPlanner<Task, Out>({
          client: driver.client,
          profile: { name: 'driver' } as AgentProfile,
          decodeTask: (raw) => raw as Task,
          analyze: createAnalystSteering<Iteration<Task, Out>, Task, Out>({
            analysts: [qbiAnalyst],
            toInput: (latest) => latest,
          }),
        }),
        maxIterations: 6,
      }),
      agentRuns: [
        {
          profile: { name: 'worker' } as AgentProfile,
          name: 'worker',
          taskToPrompt: (t) => JSON.stringify(t),
        },
      ] satisfies AgentRunSpec<Task>[],
      output,
      validator,
      task: { goal: GOAL, strategy: 'naive' },
      ctx: { sandboxClient: worker.client },
      maxIterations: 6,
    })

    expect(result.decision).toBe('done')
    expect(result.winner?.verdict?.valid).toBe(true)
    expect(result.winner?.verdict?.score).toBeCloseTo(0.9, 6)
    expect(worker.dispatched).toEqual(['naive', FIX]) // steered, not a degenerate replay
    // The steering prompt that flipped the loop carried the analyst's recommendation.
    const steer = driver.prompts.find((p) => p.includes(FIX)) ?? ''
    expect(steer).toMatch(/weak-strategy/)
    expect(steer).toMatch(/rewrite the task to use the parallel-tools strategy/)
  })
})
