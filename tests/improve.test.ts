import type {
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  Scenario,
  SurfaceProposer,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/errors'
import { improve } from '../src/improvement'

interface DemoScenario extends Scenario {
  kind: 'demo'
}

const scenarios: DemoScenario[] = Array.from({ length: 12 }, (_, i) => ({
  id: `s${i}`,
  kind: 'demo' as const,
}))

/** The agent returns the surface verbatim as the artifact AND reports token
 *  usage so agent-eval's backend-integrity guard (`expectUsage: 'assert'`, the
 *  default) sees a real backend rather than a stub-zero cell. No LLM. */
const agent = async (
  surface: MutableSurface,
  _scenario: DemoScenario,
  ctx: DispatchContext,
): Promise<string> => {
  const paid = await ctx.cost.runPaidCall({
    channel: 'agent',
    actor: 'test',
    model: 'deterministic-test',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => String(surface),
    receipt: () => ({
      model: 'deterministic-test',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

/** Deterministic judge: the literal string `PROMOTED` scores 1.0, anything else
 *  0.0 — no LLM, no opinion. */
const judge: JudgeConfig<string, DemoScenario> = {
  name: 'literal',
  dimensions: [{ key: 'q', description: 'q' }],
  score: ({ artifact }) => {
    const composite = artifact.includes('PROMOTED') ? 1 : 0
    return { dimensions: { q: composite }, composite, notes: '' }
  },
}

/** A scripted `SurfaceProposer` that always proposes the winning surface —
 *  the hand-written stand-in for `gepaProposer`, no router call. */
const scriptedWinner: SurfaceProposer = {
  kind: 'scripted-winner',
  async propose() {
    return [{ surface: 'PROMOTED', label: 'win', rationale: 'scripted' }]
  },
}

function profileWith(systemPrompt: string): AgentProfile {
  return { name: 'demo', prompt: { systemPrompt } }
}

describe('improve() — facade over selfImprove', () => {
  it('gate:none returns a detached baseline candidate', async () => {
    const profile = profileWith('BASELINE')
    const out = await improve(profile, [], {
      surface: 'prompt',
      gate: 'none',
      generator: scriptedWinner,
      scenarios,
      judge,
      agent,
    })

    expect(out.decision).not.toBe('ship')
    expect(out.candidate).toMatchObject({
      surface: 'prompt',
      value: 'BASELINE',
      profile: { prompt: { systemPrompt: 'BASELINE' } },
    })
    expect(profile.prompt?.systemPrompt).toBe('BASELINE')
  })

  it('forwards dispatchTimeoutMs through improve() to abort a stalled cell', async () => {
    let observedAbort = false
    const stalledAgent = (
      _surface: MutableSurface,
      _scenario: DemoScenario,
      ctx: DispatchContext,
    ): Promise<string> =>
      new Promise(() => {
        ctx.signal.addEventListener(
          'abort',
          () => {
            observedAbort = true
          },
          { once: true },
        )
      })

    await expect(
      improve(profileWith('BASELINE'), [], {
        surface: 'prompt',
        gate: 'none',
        generator: scriptedWinner,
        scenarios: scenarios.slice(0, 2),
        judge,
        agent: stalledAgent,
        budget: { holdoutFraction: 0.5 },
        dispatchTimeoutMs: 25,
        expectUsage: 'off',
        maxConcurrency: 1,
      }),
    ).rejects.toThrow(/dispatch exceeded 25ms/)

    expect(observedAbort).toBe(true)
  })

  it('returns a frozen prompt candidate on a ship decision without changing the profile', async () => {
    const profile = profileWith('BASELINE')
    const out = await improve(profile, [], {
      surface: 'prompt',
      generator: scriptedWinner,
      scenarios,
      judge,
      agent,
      // A perfect +1.0 lift at this n/reps clears the default held-out gate.
      budget: { generations: 1, populationSize: 2, reps: 3, holdoutFraction: 0.5 },
    })

    expect(out.decision).toBe('ship')
    expect(out.lift).toBeGreaterThan(0)
    expect(out.candidate.value).toBe('PROMOTED')
    expect(out.candidate.profile?.prompt?.systemPrompt).toBe('PROMOTED')
    expect(Object.isFrozen(out.candidate)).toBe(true)
    expect(Object.isFrozen(out.candidate.profile?.prompt)).toBe(true)
    expect(profile.prompt?.systemPrompt).toBe('BASELINE')
  })

  it('throws ConfigError for a surface with no default generator and no generator passed', async () => {
    const profile = profileWith('BASELINE')
    await expect(
      improve(profile, [], { surface: 'tools', scenarios, judge, agent }),
    ).rejects.toBeInstanceOf(ConfigError)
  })

  it('allowedModels throws ConfigError when the reflection model is outside the set', async () => {
    const profile = profileWith('BASELINE')
    await expect(
      improve(profile, [], {
        surface: 'prompt',
        gate: 'none',
        scenarios,
        judge,
        agent,
        llm: { model: 'gpt-4.1' },
        allowedModels: ['deepseek-v4-flash'],
      }),
    ).rejects.toBeInstanceOf(ConfigError)
  })

  it('allowedModels passes when the reflection model is in the set', async () => {
    const profile = profileWith('BASELINE')
    const out = await improve(profile, [], {
      surface: 'prompt',
      gate: 'none',
      scenarios,
      judge,
      agent,
      llm: { model: 'deepseek-v4-flash' },
      allowedModels: ['deepseek-v4-flash'],
    })
    expect(out.decision).not.toBe('ship')
  })

  it('throws ConfigError when a JSON-surface candidate is not valid JSON', async () => {
    const profile: AgentProfile = { name: 'demo', tools: {} }
    // Scores 1.0 but is not valid JSON for the `tools` surface. Candidate
    // materialization must fail with a typed error, not a raw SyntaxError.
    const malformedWinner: SurfaceProposer = {
      kind: 'malformed-json',
      async propose() {
        return [{ surface: 'PROMOTED not json {{{', label: 'win', rationale: 'x' }]
      },
    }
    await expect(
      improve(profile, [], {
        surface: 'tools',
        generator: malformedWinner,
        scenarios,
        judge,
        agent,
        budget: { generations: 1, populationSize: 2, reps: 3, holdoutFraction: 0.5 },
      }),
    ).rejects.toBeInstanceOf(ConfigError)
  })
})
