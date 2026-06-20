import type {
  DispatchContext,
  ImprovementDriver,
  JudgeConfig,
  MutableSurface,
  Scenario,
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
  ctx.cost.observe(0.0001, 'test')
  ctx.cost.observeTokens({ input: 1, output: 1 })
  return String(surface)
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

/** A scripted `ImprovementDriver` that always proposes the winning surface —
 *  the hand-written stand-in for `gepaDriver`, no router call. */
const scriptedWinner: ImprovementDriver = {
  kind: 'scripted-winner',
  async propose() {
    return [{ surface: 'PROMOTED', label: 'win', rationale: 'scripted' }]
  },
}

function profileWith(systemPrompt: string): AgentProfile {
  return { name: 'demo', prompt: { systemPrompt } }
}

describe('improve() — facade over selfImprove', () => {
  it('gate:none is a baseline-only run that leaves the profile unchanged', async () => {
    const profile = profileWith('BASELINE')
    const out = await improve(profile, [], {
      surface: 'prompt',
      gate: 'none',
      generator: scriptedWinner,
      scenarios,
      judge,
      agent,
    })

    expect(out.shipped).toBe(false)
    expect(out.gateDecision).not.toBe('ship')
    // No generation ran, so the winner is the baseline surface and the profile
    // field is untouched. The returned profile is the same reference.
    expect(out.profile).toBe(profile)
    expect(out.profile.prompt?.systemPrompt).toBe('BASELINE')
  })

  it('applies the promoted prompt back into the profile on a ship verdict', async () => {
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

    expect(out.shipped).toBe(true)
    expect(out.gateDecision).toBe('ship')
    expect(out.lift).toBeGreaterThan(0)
    // The promoted winner surface is written into the prompt field; the input
    // profile is NOT mutated (the facade returns a copy).
    expect(out.profile.prompt?.systemPrompt).toBe('PROMOTED')
    expect(out.profile).not.toBe(profile)
    expect(profile.prompt?.systemPrompt).toBe('BASELINE')
  })

  it('throws ConfigError for a surface with no default generator and no generator passed', async () => {
    const profile = profileWith('BASELINE')
    await expect(
      improve(profile, [], { surface: 'tools', scenarios, judge, agent }),
    ).rejects.toBeInstanceOf(ConfigError)
  })
})
