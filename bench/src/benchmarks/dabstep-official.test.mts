/**
 * Official DABStep path tests against a real Python interpreter. The staged
 * checkout carries the exact official layout (splits/, files/, grade.py) while
 * the released dataset.csv lives apart and is reached through the
 * DABSTEP_DATASET_CSV override. grade.py is a deterministic stub here; the
 * judge bridge, CSV parsing, split filtering, and override plumbing are the
 * production paths. AGENT_BENCH_PYTHON is fixed before the adapter modules
 * load because the harness resolves its interpreter at import time.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim()
process.env.AGENT_BENCH_PYTHON = python

const { createDabstepAdapter } = await import('./dabstep')

const datasetCsv = [
  'task_id,question,guidelines,all_golds_by_task',
  `7,What is the calibration answer?,Answer with the exact integer.,"[{'kind': 'number', 'value': 42.0}]"`,
  `8,Which scheme?,Answer with the scheme name.,"[{'kind': 'scheme', 'value': 'nexpay'}]"`,
  '',
].join('\n')

const gradeStub = [
  'def grade(pred, golds):',
  '    text = str(pred).strip()',
  '    for gold in golds:',
  '        value = gold["value"]',
  '        if text == str(value):',
  '            return True',
  '        try:',
  '            if float(text) == float(value):',
  '                return True',
  '        except (TypeError, ValueError):',
  '            pass',
  '    return False',
  '',
].join('\n')

async function makeCheckout(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dabstep-official-'))
  await mkdir(join(dir, 'splits'), { recursive: true })
  await mkdir(join(dir, 'files'), { recursive: true })
  await writeFile(join(dir, 'splits', 'easy.txt'), '7\n8\n')
  await writeFile(join(dir, 'files', 'payments-readme.md'), 'synthetic payment files')
  await writeFile(join(dir, 'grade.py'), gradeStub)
  return dir
}

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

test('DABSTEP_DATASET_CSV lets the checkout and the released rows live apart, end to end through grade.py', async () => {
  const dir = await makeCheckout()
  const dataDir = await mkdtemp(join(tmpdir(), 'dabstep-rows-'))
  const dataset = join(dataDir, 'released-dataset.csv')
  await writeFile(dataset, datasetCsv)
  try {
    await withEnv(
      { DABSTEP_FIXTURES: undefined, DABSTEP_DIR: dir, DABSTEP_DATASET_CSV: dataset },
      async () => {
        const adapter = createDabstepAdapter()
        await adapter.preflight()
        const tasks = await adapter.loadTasks({ split: 'easy' })
        assert.deepEqual(
          tasks.map((task) => task.id),
          ['7', '8'],
        )
        const meta = tasks[0].metadata as Record<string, unknown>
        assert.equal(meta.resourceRoot, join(dir, 'files'))
        assert.equal(await adapter.goldArtifact(tasks[0]), '42')
        const pass = await adapter.judge(tasks[0], '42')
        assert.equal(pass.resolved, true)
        assert.equal(pass.score, 1)
        const fail = await adapter.judge(tasks[0], 'dog')
        assert.equal(fail.resolved, false)
        assert.equal(fail.score, 0)
      },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('a relative DABSTEP_DATASET_CSV is refused before any load', async () => {
  const dir = await makeCheckout()
  try {
    await withEnv(
      { DABSTEP_FIXTURES: undefined, DABSTEP_DIR: dir, DABSTEP_DATASET_CSV: 'relative/dataset.csv' },
      async () => {
        await assert.rejects(() => createDabstepAdapter().preflight(), /DABSTEP_DATASET_CSV must be an absolute path/)
      },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
