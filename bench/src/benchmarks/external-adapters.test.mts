import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentBenchAdapter } from './agentbench'
import { createTau2BenchAdapter } from './tau2-bench'
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
