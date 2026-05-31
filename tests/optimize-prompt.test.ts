import {
  type ImprovementDriver,
  inMemoryCampaignStorage,
  type JudgeConfig,
  type MutableSurface,
  type ProposedCandidate,
  type Scenario,
} from '@tangle-network/agent-eval/campaign'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/errors'
import { optimizePrompt } from '../src/improvement'

interface SumScenario extends Scenario {
  kind: 'sum'
}

interface SumArtifact {
  text: string
  quality: number
}

// Artifact quality is a pure function of the prompt: a prompt that says
// "PRECISE" produces a high-quality artifact, a vague one does not. This is the
// measurable signal the gate steers on — a candidate only wins if it lifts
// quality on the held-out scenarios.
const runWithPrompt = async (prompt: string): Promise<SumArtifact> => ({
  text: prompt,
  quality: /PRECISE/.test(prompt) ? 0.9 : 0.4,
})

const qualityJudge: JudgeConfig<SumArtifact, SumScenario> = {
  name: 'quality',
  dimensions: [{ key: 'quality', description: 'artifact quality 0..1' }],
  score({ artifact }) {
    return { dimensions: { quality: artifact.quality }, composite: artifact.quality, notes: '' }
  },
}

const scenarios: SumScenario[] = [
  { id: 't1', kind: 'sum' },
  { id: 't2', kind: 'sum' },
]
const holdoutScenarios: SumScenario[] = [
  { id: 'h1', kind: 'sum' },
  { id: 'h2', kind: 'sum' },
]

const BASELINE = 'Summarize the text.'

/** Deterministic driver — proposes exactly the candidate the test wants to
 *  measure, once. Stands in for `gepaDriver` so the loop runs with zero LLM. */
function fixedDriver(candidate: MutableSurface | ProposedCandidate): ImprovementDriver {
  return {
    kind: 'test-fixed',
    async propose() {
      return [candidate]
    },
  }
}

const baseOpts = {
  runWithPrompt,
  scenarios,
  holdoutScenarios,
  judges: [qualityJudge],
  baselinePrompt: BASELINE,
  populationSize: 1,
  maxGenerations: 1,
  promoteTopK: 1,
  deltaThreshold: 0.1,
  seed: 7,
}

describe('optimizePrompt — identity-gated prompt optimization', () => {
  it('keeps the baseline (identity) when no candidate beats it on holdout', async () => {
    // Candidate is just as vague as the baseline → no held-out lift.
    const result = await optimizePrompt<SumScenario, SumArtifact>({
      ...baseOpts,
      runDir: 'mem://optimize-identity',
      storage: inMemoryCampaignStorage(),
      driver: fixedDriver('Summarize the text concisely.'),
    })

    expect(result.improved).toBe(false)
    expect(result.decision).not.toBe('ship')
    expect(result.prompt).toBe(BASELINE)
    expect(result.baselineComposite).toBeCloseTo(0.4, 6)
    // No regression possible: the returned prompt is the untouched baseline.
    expect(result.delta).toBeLessThan(0.1)
  })

  it('promotes a candidate that wins on holdout, returning the improved prompt', async () => {
    const improvedPrompt = 'Summarize the text. Be PRECISE.'
    const result = await optimizePrompt<SumScenario, SumArtifact>({
      ...baseOpts,
      runDir: 'mem://optimize-promote',
      storage: inMemoryCampaignStorage(),
      driver: fixedDriver({
        surface: improvedPrompt,
        label: 'add precision',
        rationale: 'precision lifts quality',
      }),
    })

    expect(result.improved).toBe(true)
    expect(result.decision).toBe('ship')
    expect(result.prompt).toBe(improvedPrompt)
    expect(result.winnerComposite).toBeCloseTo(0.9, 6)
    expect(result.baselineComposite).toBeCloseTo(0.4, 6)
    expect(result.delta).toBeGreaterThanOrEqual(0.1)
    expect(result.rationale).toBe('precision lifts quality')
    expect(result.diff).not.toBe('')
  })

  it('fails loud when neither reflection nor a driver is supplied', async () => {
    await expect(
      optimizePrompt<SumScenario, SumArtifact>({
        ...baseOpts,
        runDir: 'mem://optimize-misconfig',
        storage: inMemoryCampaignStorage(),
      }),
    ).rejects.toThrow(ConfigError)
  })

  it('fails loud on an empty holdout set (the gate needs it)', async () => {
    await expect(
      optimizePrompt<SumScenario, SumArtifact>({
        ...baseOpts,
        holdoutScenarios: [],
        runDir: 'mem://optimize-noholdout',
        storage: inMemoryCampaignStorage(),
        driver: fixedDriver('whatever'),
      }),
    ).rejects.toThrow(/holdoutScenarios/)
  })
})
