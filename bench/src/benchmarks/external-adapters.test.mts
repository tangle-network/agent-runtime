import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentBenchAdapter } from './agentbench'
import { createBfclAdapter } from './bfcl'
import { createFinResearchBenchAdapter, scoreOfficialJudgeTurn } from './finresearchbench'
import { createTau2BenchAdapter } from './tau2-bench'
import { createTau3BankingAdapter } from './tau3-banking'
import { createToolLlmAdapter } from './toollm'
import { createWebArenaVerifiedAdapter } from './webarena-verified'

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(patch)) {
    old[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('WebArena-Verified fixture mode loads tasks and live mode fails loud without checkout', async () => {
  await withEnv({ WEBARENA_VERIFIED_FIXTURES: '1', WEBARENA_VERIFIED_DIR: undefined }, async () => {
    const adapter = createWebArenaVerifiedAdapter()
    await adapter.preflight()
    const tasks = await adapter.loadTasks({ limit: 1 })
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].id, '0')
    assert.match(tasks[0].prompt, /WebArena-Verified/)
  })

  await withEnv({ WEBARENA_VERIFIED_FIXTURES: undefined, WEBARENA_VERIFIED_DIR: undefined }, async () => {
    await assert.rejects(() => createWebArenaVerifiedAdapter().preflight(), /WEBARENA_VERIFIED_DIR is required/)
  })
})

test('tau2-bench fixture mode loads tasks and live mode fails loud without checkout', async () => {
  await withEnv({ TAU2_FIXTURES: '1', TAU2_BENCH_DIR: undefined }, async () => {
    const adapter = createTau2BenchAdapter()
    await adapter.preflight()
    const tasks = await adapter.loadTasks({ limit: 1 })
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].id, 'retail-fixture-0')
    assert.match(tasks[0].prompt, /tau2 task/)
  })

  await withEnv({ TAU2_FIXTURES: undefined, TAU2_BENCH_DIR: undefined }, async () => {
    await assert.rejects(() => createTau2BenchAdapter().preflight(), /TAU2_BENCH_DIR is required/)
  })
})

test('tau3-banking fixture mode loads tasks and live mode fails loud without checkout', async () => {
  await withEnv({ TAU3_FIXTURES: '1', TAU3_BENCH_DIR: undefined }, async () => {
    const adapter = createTau3BankingAdapter()
    await adapter.preflight()
    const tasks = await adapter.loadTasks({ limit: 1 })
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].id, 'banking-knowledge-fixture-0')
    assert.match(tasks[0].prompt, /tau3 banking task/)
  })

  await withEnv({ TAU3_FIXTURES: undefined, TAU3_BENCH_DIR: undefined }, async () => {
    await assert.rejects(() => createTau3BankingAdapter().preflight(), /TAU3_BENCH_DIR is required/)
  })
})

test('AgentBench DBBench fixture mode loads and exact-label judge scores deterministically', async () => {
  await withEnv({ AGENTBENCH_FIXTURES: '1', AGENTBENCH_DIR: undefined }, async () => {
    const adapter = createAgentBenchAdapter()
    await adapter.preflight()
    const [task] = await adapter.loadTasks({ limit: 1 })
    assert.equal(await adapter.goldArtifact(task), 'Women +60kg Bronze')
    assert.equal((await adapter.judge(task, 'women +60kg bronze')).score, 1)
    assert.equal((await adapter.judge(task, 'wrong')).score, 0)
  })

  await withEnv({ AGENTBENCH_FIXTURES: undefined, AGENTBENCH_DIR: undefined }, async () => {
    await assert.rejects(() => createAgentBenchAdapter().preflight(), /AGENTBENCH_DIR is required/)
  })
})

test('BFCL fixture mode loads official-shaped rows and scores function calls', async () => {
  await withEnv({ BFCL_FIXTURES: '1', BFCL_DIR: undefined }, async () => {
    const adapter = createBfclAdapter()
    await adapter.preflight()
    const [task] = await adapter.loadTasks({ limit: 1 })
    assert.equal(task.id, 'simple_python_fixture_0')
    const gold = await adapter.goldArtifact(task)
    assert.match(gold ?? '', /calculate_triangle_area/)
    assert.equal((await adapter.judge(task, gold ?? '')).score, 1)
    assert.equal((await adapter.judge(task, '{"function_calls":[{"name":"wrong","arguments":{}}]}')).score, 0)
  })

  await withEnv({ BFCL_FIXTURES: undefined, BFCL_DIR: undefined }, async () => {
    await assert.rejects(() => createBfclAdapter().preflight(), /BFCL_DIR is required/)
  })
})

test('ToolLLM scores only deterministic API-selection labels and rejects unlabeled rows', async () => {
  await withEnv({ TOOLLM_FIXTURES: '1', TOOLBENCH_DIR: undefined }, async () => {
    const adapter = createToolLlmAdapter()
    await adapter.preflight()
    const [task] = await adapter.loadTasks({ limit: 1 })
    assert.equal(task.id, '1')
    const gold = await adapter.goldArtifact(task)
    assert.match(gold ?? '', /Checkhealth/)
    assert.equal((await adapter.judge(task, '')).score, 0)
    assert.equal((await adapter.judge(task, gold ?? '')).score, 1)
    assert.equal((await adapter.judge(task, '{"api_calls":[{"tool_name":"SQUAKE","api_name":"Checkhealth"}]}')).score, 0.5)
    const freeText = await adapter.judge(task, 'Use SQUAKE Checkhealth, then call SQUAKE Projects.')
    assert.equal(freeText.score, 1)
    assert.equal(freeText.resolved, false)
  })

  const dir = await mkdtemp(join(tmpdir(), 'toollm-'))
  try {
    const query = join(dir, 'queries.json')
    await writeFile(query, JSON.stringify([{ query_id: 1, query: 'Call a tool.', api_list: [] }]))
    await withEnv({ TOOLLM_FIXTURES: undefined, TOOLBENCH_DIR: dir, TOOLLM_QUERY_FILE: query }, async () => {
      await assert.rejects(() => createToolLlmAdapter().preflight(), /deterministic API-selection labels missing/)
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('FinResearchBench fixture mode is explicit and live mode requires exported judge rows', async () => {
  await withEnv({ FINRESEARCHBENCH_FIXTURES: '1', FINRESEARCHBENCH_DATA_FILE: undefined }, async () => {
    const adapter = createFinResearchBenchAdapter()
    await adapter.preflight()
    const [task] = await adapter.loadTasks({ limit: 1 })
    const gold = await adapter.goldArtifact(task)
    assert.match(gold ?? '', /Margin expansion/)
    assert.equal((await adapter.judge(task, gold ?? '')).score, 1)
    assert.equal((await adapter.judge(task, 'unrelated answer')).score, 0)
  })

  await withEnv({ FINRESEARCHBENCH_FIXTURES: undefined, FINRESEARCHBENCH_DATA_FILE: undefined }, async () => {
    await assert.rejects(() => createFinResearchBenchAdapter().preflight(), /FINRESEARCHBENCH_DATA_FILE is required/)
  })
})

const officialFinResearchTask = {
  id: 'row-1',
  prompt: 'unused',
  split: 'macro',
  metadata: {
    id: 'row-1',
    category: 'macro',
    question: 'Assess margin trajectory.',
    referenceAnswer: 'Margin expansion',
    referenceReport: 'Margin expansion',
    logicTree: null,
    rubric: null,
    scoring: 'official-logic-tree-judge',
  },
}

test('FinResearchBench official judge score carries the judge turn usage verbatim', () => {
  const usage = {
    input: 1200,
    output: 44,
    costUsd: 0.0123,
    model: 'deepseek-v4-flash',
  }
  const score = scoreOfficialJudgeTurn(
    officialFinResearchTask,
    { finalText: '```json\n{"score": 8}\n```', usage },
    'deepseek-v4-flash',
  )
  assert.equal(score.score, 0.8)
  assert.equal(score.resolved, true)
  assert.deepEqual(score.judgeUsage, usage)
  const detail = JSON.parse(score.detail ?? '{}') as Record<string, unknown>
  assert.equal(detail.judgeModel, 'deepseek-v4-flash')
  assert.equal(detail.scoring, 'official-logic-tree-judge')
})

test('FinResearchBench keeps unknown judge cost unknown instead of reporting zero spend', () => {
  const usage = {
    input: 0,
    output: 0,
    tokensKnown: false as const,
    usdKnown: false as const,
    estimatedCostUsd: 0.002,
  }
  const score = scoreOfficialJudgeTurn(officialFinResearchTask, { finalText: '{"score": 3}', usage }, 'deepseek-v4-flash')
  assert.equal(score.score, 0.3)
  assert.equal(score.resolved, false)
  assert.equal(score.judgeUsage?.usdKnown, false)
  assert.equal(score.judgeUsage?.tokensKnown, false)
  assert.equal(score.judgeUsage?.costUsd, undefined)
  assert.equal(score.judgeUsage?.estimatedCostUsd, 0.002)
})

test('FinResearchBench official judge fails loud on an empty judge message', () => {
  assert.throws(
    () => scoreOfficialJudgeTurn(officialFinResearchTask, { usage: { input: 1, output: 0 } }, 'deepseek-v4-flash'),
    /judge returned no message content/,
  )
})
