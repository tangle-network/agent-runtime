/**
 * Official tau upstream-pin tests against a real git checkout and a real
 * Python interpreter. The fake checkout implements the exact loader contract
 * (`tau2.registry.registry.get_tasks_loader`) plus a `tau2` dist-info record,
 * so the pin resolution path is the production one; only the task content is
 * synthetic. AGENT_BENCH_PYTHON is fixed before the adapter modules load
 * because the harness resolves its interpreter at import time.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim()
process.env.AGENT_BENCH_PYTHON = python

const { createTau3BankingAdapter } = await import('./tau3-banking')
const { assertTauUpstreamPinUnchanged } = await import('./tau-bench-shared')

const registrySource = [
  'class _Task:',
  '    def __init__(self, task_id):',
  '        self.id = task_id',
  '',
  '    def model_dump(self, mode="json"):',
  '        return {',
  '            "id": self.id,',
  '            "user_scenario": {"instructions": "resolve the dispute policy"},',
  '            "description": "pin test task",',
  '            "evaluation_criteria": {},',
  '        }',
  '',
  '',
  'class _Registry:',
  '    def get_tasks_loader(self, domain):',
  '        def load(split=None):',
  '            return [_Task("task_001")]',
  '',
  '        return load',
  '',
  '',
  'registry = _Registry()',
  '',
].join('\n')

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
}

async function makeCheckout(opts: { distInfo?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tau-pin-'))
  await mkdir(join(dir, 'src', 'tau2'), { recursive: true })
  // The upstream checkout ignores Python bytecode; the fixture mirrors that.
  await writeFile(join(dir, '.gitignore'), '__pycache__/\n')
  await writeFile(join(dir, 'src', 'tau2', '__init__.py'), '')
  await writeFile(join(dir, 'src', 'tau2', 'registry.py'), registrySource)
  if (opts.distInfo !== false) {
    const distInfo = join(dir, 'src', 'tau2-9.9.9.dist-info')
    await mkdir(distInfo)
    await writeFile(join(distInfo, 'METADATA'), 'Metadata-Version: 2.1\nName: tau2\nVersion: 9.9.9\n')
  }
  git(dir, 'init', '--quiet')
  // Fixture repo: keep any machine-wide hooks out of the throwaway commit.
  git(dir, 'config', 'core.hooksPath', '/dev/null')
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.email=bench@test', '-c', 'user.name=bench', 'commit', '--quiet', '-m', 'pin fixture')
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

test('official load stamps the upstream commit and installed tau2 version on every task', async () => {
  const dir = await makeCheckout()
  try {
    await withEnv({ TAU3_FIXTURES: undefined, TAU3_BENCH_DIR: dir }, async () => {
      const adapter = createTau3BankingAdapter()
      await adapter.preflight()
      const tasks = await adapter.loadTasks({ limit: 1 })
      assert.equal(tasks.length, 1)
      const meta = tasks[0].metadata as Record<string, unknown>
      assert.equal(meta.upstreamCommit, git(dir, 'rev-parse', 'HEAD'))
      assert.equal(meta.upstreamVersion, '9.9.9')
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('official load fails loud when the checkout holds uncommitted changes', async () => {
  const dir = await makeCheckout()
  try {
    await writeFile(join(dir, 'scratch.txt'), 'local edit')
    await withEnv({ TAU3_FIXTURES: undefined, TAU3_BENCH_DIR: dir }, async () => {
      await assert.rejects(() => createTau3BankingAdapter().loadTasks({ limit: 1 }), /uncommitted changes/)
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('official load fails loud when the bench dir is not a git checkout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tau-pin-nogit-'))
  try {
    await mkdir(join(dir, 'src', 'tau2'), { recursive: true })
    await writeFile(join(dir, 'src', 'tau2', 'registry.py'), registrySource)
    await withEnv({ TAU3_FIXTURES: undefined, TAU3_BENCH_DIR: dir }, async () => {
      await assert.rejects(() => createTau3BankingAdapter().loadTasks({ limit: 1 }), /cannot resolve the upstream commit/)
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('official load fails loud when no tau2 distribution is installed', async () => {
  const dir = await makeCheckout({ distInfo: false })
  try {
    await withEnv({ TAU3_FIXTURES: undefined, TAU3_BENCH_DIR: dir }, async () => {
      await assert.rejects(
        () => createTau3BankingAdapter().loadTasks({ limit: 1 }),
        /installed tau2 distribution not found/,
      )
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fixture tasks carry no upstream pin because fixtures prove plumbing only', async () => {
  await withEnv({ TAU3_FIXTURES: '1', TAU3_BENCH_DIR: undefined }, async () => {
    const [task] = await createTau3BankingAdapter().loadTasks({ limit: 1 })
    const meta = task.metadata as Record<string, unknown>
    assert.equal(meta.upstreamCommit, undefined)
    assert.equal(meta.upstreamVersion, undefined)
  })
})

test('assertTauUpstreamPinUnchanged refuses a checkout or interpreter that moved after load', () => {
  const live = { upstreamCommit: 'abc', upstreamVersion: '1.0.1' }
  assertTauUpstreamPinUnchanged('tau3-banking', 'task_001', {}, live)
  assertTauUpstreamPinUnchanged('tau3-banking', 'task_001', live, live)
  assert.throws(
    () => assertTauUpstreamPinUnchanged('tau3-banking', 'task_001', { upstreamCommit: 'def' }, live),
    /loaded from upstream commit def/,
  )
  assert.throws(
    () => assertTauUpstreamPinUnchanged('tau3-banking', 'task_001', { upstreamVersion: '0.9.0' }, live),
    /loaded with tau2 0\.9\.0/,
  )
})
