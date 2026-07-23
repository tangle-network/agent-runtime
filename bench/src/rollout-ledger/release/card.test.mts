import { describe, expect, it } from 'vitest'
import { fixtureRolloutLine } from '../fixtures.mts'
import { buildDatasetCard, type DatasetCardInputs } from './card.mts'
import { emptyScrubCounts } from './scrub.mts'

function cardInputs(overrides: Partial<DatasetCardInputs> = {}): DatasetCardInputs {
  const supervisorWin = fixtureRolloutLine({ role: 'supervisor', run_id: 'run-a', generation: 0 })
  const supervisorLoss = fixtureRolloutLine({
    role: 'supervisor',
    run_id: 'run-a',
    generation: -1,
    outcome: { ...fixtureRolloutLine().outcome, reward: 0, reward_source: 'swe-arena-official-judge' },
  })
  const worker = fixtureRolloutLine({ role: 'worker', run_id: 'run-b', generation: 0 })
  const proposer = fixtureRolloutLine({
    role: 'proposer',
    run_id: 'run-b',
    generation: 0,
    outcome: {
      ...fixtureRolloutLine().outcome,
      reward: 1 / 3,
      reward_source: 'swe-arena-official-judge/candidate-resolved-fraction',
    },
  })
  const scrubTotals = emptyScrubCounts()
  scrubTotals['home-path'] = 7
  return {
    lines: [supervisorWin, supervisorLoss, worker, proposer],
    formats: ['sft', 'raw'],
    includeProposers: true,
    sourceFiles: ['gen3-rollouts.jsonl'],
    scrubTotals,
    excluded: { proposers: 0, nonTrain: 2 },
    formatCounts: { sft: 2, raw: 4 },
    ...overrides,
  }
}

describe('dataset card', () => {
  it('emits frontmatter configs only for the selected formats', () => {
    const card = buildDatasetCard(cardInputs())
    expect(card.startsWith('---\nlicense: unknown\n')).toBe(true)
    expect(card).toContain('config_name: sft')
    expect(card).toContain('path: sft/train.jsonl')
    expect(card).toContain('config_name: raw')
    expect(card).not.toContain('config_name: verifiers')
    expect(card).not.toContain('config_name: rft')
  })

  it('counts table matches the input lines per role and reward', () => {
    const card = buildDatasetCard(cardInputs())
    expect(card).toContain('| supervisor | 1 | 1 |')
    expect(card).toContain('| supervisor | 0 | 1 |')
    expect(card).toContain('| worker | 1 | 1 |')
    expect(card).toContain('| proposer | 0.3333 | 1 |')
    expect(card).toContain('Total lines: 4')
  })

  it('documents provenance: run ids, generations, judge, reward sources', () => {
    const card = buildDatasetCard(cardInputs())
    expect(card).toContain('`run-a`, `run-b`')
    expect(card).toContain('Generations: -1, 0')
    expect(card).toContain('official SWE-bench docker evaluator')
    expect(card).toContain('`swe-arena-official-judge/candidate-resolved-fraction`')
    expect(card).toContain('`gen3-rollouts.jsonl`')
  })

  it('states the inherited-reward caveat and the train-only guarantee', () => {
    const card = buildDatasetCard(cardInputs())
    expect(card).toContain('INHERITED from the parent supervisor episode')
    expect(card).toContain("does not establish this worker's individual contribution")
    expect(card).toContain('train split only')
    expect(card).toContain('(2 dropped here)')
  })

  it('carries scrub totals, license placeholder, and citation stub', () => {
    const card = buildDatasetCard(cardInputs())
    expect(card).toContain('| home-path | 7 |')
    expect(card).toContain('must set the real SPDX license id')
    expect(card).toContain('@misc{tangle_rollout_ledger')
  })

  it('reflects the proposer-exclusion flag both ways', () => {
    const withProposers = buildDatasetCard(cardInputs())
    expect(withProposers).toContain('Proposer sessions are INCLUDED')
    const withoutProposers = buildDatasetCard(
      cardInputs({ includeProposers: false, excluded: { proposers: 3, nonTrain: 0 } }),
    )
    expect(withoutProposers).toContain('excluded by default (3 lines dropped)')
  })

  it('is deterministic for the same inputs', () => {
    expect(buildDatasetCard(cardInputs())).toBe(buildDatasetCard(cardInputs()))
  })
})
