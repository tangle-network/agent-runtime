/**
 * A ported adapter is agent-eval's `BenchmarkAdapter`: agent-eval's own runner takes it as is, and a real
 * HotpotQA validation item (hotpotqa/hotpot_qa distractor, committed in bench/fixtures) runs through its
 * runtime hooks and the published EM/F1 metric. No model, network or Docker.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { benchmarkScenarios } from '@tangle-network/agent-eval/benchmarks'
import { createHotpotqaAdapter } from './hotpotqa'

process.env.HOTPOTQA_FIXTURES = '1'

test('a real HotpotQA item runs through the agent-eval contract and the runtime hooks', async () => {
  const adapter = createHotpotqaAdapter()
  await adapter.runtime.preflight!()
  const all = await adapter.loadAll()
  assert.ok(all.length > 1, 'the committed validation rows load')

  // agent-eval's runner reads the same tasks through loadDataset, each once, in the split assignSplit names.
  const scenarios = await benchmarkScenarios(adapter)
  assert.deepEqual(scenarios.map((s) => s.item.id).sort(), all.map((t) => t.id).sort())
  for (const s of scenarios) assert.equal(s.splitTag, adapter.assignSplit(s.item.id))

  const id = 'hotpotqa-5a8c7595554299585d9e36b6'
  const [task] = await adapter.loadAll({ ids: [id] })
  assert.equal(task?.id, id)
  assert.match(adapter.runtime.prompt(task!), /Corliss Archer/)

  const gold = await adapter.runtime.goldArtifact!(task!)
  assert.ok(gold, 'the gold answer serializes through the worker contract')
  const right = await adapter.evaluate(task!, gold!)
  assert.equal(right.passed, true)
  assert.equal(right.score, 1)

  const wrong = await adapter.evaluate(task!, 'FINAL ANSWER: Secretary of State')
  assert.equal(wrong.passed, false)
  assert.ok(wrong.score < 1)
})
