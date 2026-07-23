import { describe, expect, it } from 'vitest'
import { toRftItems, toSftExamples, toSftJsonl, toVerifiersRolloutOutput, toVerifiersRolloutOutputs } from './exporters.mts'
import { fixtureRolloutLine } from './fixtures.mts'

describe('SFT exporter', () => {
  it('keeps only reward==1 train lines with messages, emitting {messages} alone', () => {
    const keep = fixtureRolloutLine()
    const holdout = fixtureRolloutLine({ task: { ...keep.task, split: 'holdout' } })
    const failed = fixtureRolloutLine({ outcome: { ...keep.outcome, reward: 0 } })
    const partial = fixtureRolloutLine({ outcome: { ...keep.outcome, reward: 0.5 } })
    const gap = fixtureRolloutLine({
      messages: [],
      provenance: { captured_at: '2026-07-23T00:00:00.000Z', capture: 'backfill', gap: 'store unavailable' },
    })
    const examples = toSftExamples([keep, holdout, failed, partial, gap])
    expect(examples).toHaveLength(1)
    expect(Object.keys(examples[0])).toEqual(['messages'])
    expect(examples[0].messages).toEqual(keep.messages)
  })

  it('never leaks a holdout line even at reward 1 (fail-closed JSONL filter)', () => {
    const holdout = fixtureRolloutLine({ task: { ...fixtureRolloutLine().task, split: 'holdout' } })
    expect(toSftJsonl([holdout])).toBe('')
  })

  it('emits one JSON object per line', () => {
    const jsonl = toSftJsonl([fixtureRolloutLine(), fixtureRolloutLine()])
    const rows = jsonl.trim().split('\n')
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(() => JSON.parse(row)).not.toThrow()
  })
})

describe('verifiers RolloutOutput exporter', () => {
  it('splits prompt/completion at the first assistant turn', () => {
    const line = fixtureRolloutLine()
    const out = toVerifiersRolloutOutput(line)
    expect(out.prompt.map((m) => m.role)).toEqual(['system', 'user'])
    expect(out.completion.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(out.reward).toBe(1)
    expect(out.metrics).toEqual(line.outcome.metrics)
    expect(out.tool_defs).toEqual(line.tool_defs)
    expect(out.token_usage).toEqual({
      input_tokens: 79554,
      output_tokens: 19784,
      reasoning_tokens: 1200,
      cache_read_tokens: 6784,
      cache_write_tokens: 0,
    })
    expect(out.info.task).toEqual(line.task)
    expect(out.info.policy).toEqual(line.policy)
    expect(out.info.rollout_id).toBe(line.rollout_id)
  })

  it('drops gap lines (no transcript, nothing to verify)', () => {
    const gap = fixtureRolloutLine({
      messages: [],
      provenance: { captured_at: '2026-07-23T00:00:00.000Z', capture: 'backfill', gap: 'store unavailable' },
    })
    expect(toVerifiersRolloutOutputs([gap, fixtureRolloutLine()])).toHaveLength(1)
  })
})

describe('OpenAI RFT items exporter', () => {
  it('emits prompt turns plus verdict reference fields', () => {
    const line = fixtureRolloutLine()
    const [item] = toRftItems([line])
    expect(item.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(item.reference).toEqual({
      reward: 1,
      reward_source: 'swe-arena-official-judge/inherited',
      verdict: { iid: 'astropy__astropy-13033', resolved: true },
      instance_id: 'astropy__astropy-13033',
      suite: 'swe-bench-verified',
      split: 'train',
      rollout_id: line.rollout_id,
    })
  })

  it('skips lines whose transcript opens with an assistant turn (no prompt to grade)', () => {
    const line = fixtureRolloutLine()
    const assistantFirst = fixtureRolloutLine({ messages: line.messages.slice(2) })
    expect(toRftItems([assistantFirst])).toHaveLength(0)
  })
})
