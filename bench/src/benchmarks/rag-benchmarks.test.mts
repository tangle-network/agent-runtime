import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveAdapter } from '../adapters'
import { createCragAdapter } from './crag'
import { createNoMiraclAdapter } from './nomiracl'
import { createOpenRagBenchAdapter } from './open-rag-bench'
import { createRagBenchAdapter } from './ragbench'
import { FINAL_ANSWER_SENTINEL, readJsonRows } from './rag-shared'
import { createT2RagBenchAdapter } from './t2-ragbench'

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

test('RAG benchmark adapters are registered', () => {
  for (const key of ['ragbench', 'crag', 'nomiracl', 'open-rag-bench', 't2-ragbench']) {
    assert.equal(resolveAdapter(key).name, key)
  }
})

test('RAG JSON reader accepts object-starting JSONL exports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rag-jsonl-'))
  try {
    const file = join(dir, 'rows.jsonl')
    await writeFile(file, '{"id":"a","question":"q1"}\n{"id":"b","question":"q2"}\n')
    assert.deepEqual(await readJsonRows(file), [
      { id: 'a', question: 'q1' },
      { id: 'b', question: 'q2' },
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('RAGBench fixture mode loads rows and scores final answers', async () => {
  await withEnv({ RAGBENCH_FIXTURES: '1', RAGBENCH_DATA_FILE: undefined }, async () => {
    const adapter = createRagBenchAdapter()
    await adapter.preflight()
    const [task] = await adapter.loadTasks({ limit: 1 })
    assert.equal(task.id, 'ragbench-fixture-0')
    const gold = await adapter.goldArtifact(task)
    assert.equal((await adapter.judge(task, gold ?? '')).resolved, true)
    assert.equal((await adapter.judge(task, `${FINAL_ANSWER_SENTINEL} 90 days`)).resolved, false)
  })

  await withEnv({ RAGBENCH_FIXTURES: undefined, RAGBENCH_DATA_FILE: undefined }, async () => {
    await assert.rejects(() => createRagBenchAdapter().preflight(), /RAGBENCH_DATA_FILE is required/)
  })
})

test('CRAG fixture mode exposes domain slices and answer judging', async () => {
  await withEnv({ CRAG_FIXTURES: '1', CRAG_DATA_FILE: undefined }, async () => {
    const adapter = createCragAdapter()
    await adapter.preflight()
    const [task] = await adapter.loadTasks({ limit: 1 })
    assert.equal(task.split, 'finance')
    assert.equal((await adapter.judge(task, `${FINAL_ANSWER_SENTINEL} 12.4 billion dollars`)).score, 1)
    assert.equal((await adapter.judge(task, `${FINAL_ANSWER_SENTINEL} 9 billion dollars`)).resolved, false)
  })

  await withEnv({ CRAG_FIXTURES: undefined, CRAG_DATA_FILE: undefined }, async () => {
    await assert.rejects(() => createCragAdapter().preflight(), /CRAG_DATA_FILE is required/)
  })
})

test('NoMIRACL fixture mode scores answerable and unanswerable classifications', async () => {
  await withEnv({ NOMIRACL_FIXTURES: '1', NOMIRACL_DATA_FILE: undefined }, async () => {
    const adapter = createNoMiraclAdapter()
    await adapter.preflight()
    const tasks = await adapter.loadTasks({})
    const relevant = tasks.find((task) => task.id === 'nomiracl-fixture-relevant')
    const nonRelevant = tasks.find((task) => task.id === 'nomiracl-fixture-non-relevant')
    assert.ok(relevant)
    assert.ok(nonRelevant)
    assert.equal((await adapter.judge(relevant, 'ANSWERABLE')).score, 1)
    assert.equal((await adapter.judge(nonRelevant, 'UNANSWERABLE')).score, 1)
    assert.equal((await adapter.judge(nonRelevant, 'ANSWERABLE')).score, 0)
  })

  await withEnv({ NOMIRACL_FIXTURES: undefined, NOMIRACL_DATA_FILE: undefined }, async () => {
    await assert.rejects(() => createNoMiraclAdapter().preflight(), /NOMIRACL_DATA_FILE is required/)
  })
})

test('Open RAG Bench fixture mode keeps PDF modality metadata and scores answers', async () => {
  await withEnv(
    { OPEN_RAG_BENCH_FIXTURES: '1', OPEN_RAG_BENCH_DATA_FILE: undefined },
    async () => {
      const adapter = createOpenRagBenchAdapter()
      await adapter.preflight()
      const [task] = await adapter.loadTasks({ limit: 1 })
      assert.equal(task.split, 'table')
      assert.equal((await adapter.judge(task, `${FINAL_ANSWER_SENTINEL} Hybrid BM25`)).resolved, true)
      assert.equal((await adapter.judge(task, `${FINAL_ANSWER_SENTINEL} Dense`)).resolved, false)
    },
  )

  await withEnv(
    { OPEN_RAG_BENCH_FIXTURES: undefined, OPEN_RAG_BENCH_DATA_FILE: undefined },
    async () => {
      await assert.rejects(
        () => createOpenRagBenchAdapter().preflight(),
        /OPEN_RAG_BENCH_DATA_FILE is required/,
      )
    },
  )
})

test('T2-RAGBench fixture mode scores numeric text-table answers', async () => {
  await withEnv({ T2_RAGBENCH_FIXTURES: '1', T2_RAGBENCH_DATA_FILE: undefined }, async () => {
    const adapter = createT2RagBenchAdapter()
    await adapter.preflight()
    const [task] = await adapter.loadTasks({ limit: 1 })
    assert.equal(task.split, 'finqa')
    assert.equal((await adapter.judge(task, `${FINAL_ANSWER_SENTINEL} 12.0 percent`)).resolved, true)
    assert.equal((await adapter.judge(task, `${FINAL_ANSWER_SENTINEL} 8 percent`)).resolved, false)
  })

  await withEnv({ T2_RAGBENCH_FIXTURES: undefined, T2_RAGBENCH_DATA_FILE: undefined }, async () => {
    await assert.rejects(() => createT2RagBenchAdapter().preflight(), /T2_RAGBENCH_DATA_FILE is required/)
  })
})
