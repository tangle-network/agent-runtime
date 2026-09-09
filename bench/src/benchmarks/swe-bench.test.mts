import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSweBenchAdapter, scoreSweReport, sweEvaluationArgv } from './swe-bench'

const taskId = 'django__django-12345'

test('scoreSweReport preserves official resolved, unresolved, and empty-patch outcomes', () => {
  assert.equal(
    scoreSweReport(taskId, { submitted_ids: [taskId], completed_ids: [taskId], resolved_ids: [taskId] }).score,
    1,
  )
  assert.equal(
    scoreSweReport(taskId, { submitted_ids: [taskId], completed_ids: [taskId], unresolved_ids: [taskId] }).score,
    0,
  )
  assert.equal(scoreSweReport(taskId, { submitted_ids: [taskId], empty_patch_ids: [taskId] }).score, 0)
})

test('scoreSweReport rejects evaluator failures instead of scoring them as agent failures', () => {
  assert.throws(() => scoreSweReport(taskId, { submitted_ids: [taskId], error_ids: [taskId] }), /evaluator failed/)
  assert.throws(() => scoreSweReport(taskId, { submitted_ids: [taskId], incomplete_ids: [taskId] }), /evaluator failed/)
})

test('scoreSweReport rejects missing, ambiguous, malformed, and mismatched outcomes', () => {
  assert.throws(() => scoreSweReport(taskId, { submitted_ids: [taskId] }), /no unique outcome/)
  assert.throws(
    () => scoreSweReport(taskId, { resolved_ids: [taskId], unresolved_ids: [taskId] }),
    /no unique outcome/,
  )
  assert.throws(() => scoreSweReport(taskId, { resolved_ids: taskId }), /malformed resolved_ids/)
  assert.throws(() => scoreSweReport(taskId, { resolved_ids: ['other__repo-1'] }), /identity mismatch/)
  assert.throws(() => scoreSweReport(taskId, { resolved_ids: [taskId] }), /lacks a completed evaluation/)
  assert.throws(
    () => scoreSweReport(taskId, { submitted_ids: [taskId, 'other__repo-1'], empty_patch_ids: [taskId] }),
    /identity mismatch/,
  )
})

test('createSweBenchAdapter accepts only positive integer evaluation timeouts', () => {
  assert.doesNotThrow(() => createSweBenchAdapter({ timeoutMs: 1_200_000 }))
  assert.throws(() => createSweBenchAdapter({ timeoutMs: 0 }), /positive integer/)
  assert.throws(() => createSweBenchAdapter({ timeoutMs: 1.5 }), /positive integer/)
})

test('SWE evaluation command preserves the requested instance image', () => {
  const argv = sweEvaluationArgv({
    predictionsPath: '/tmp/preds.json',
    runId: 'r364',
    instanceId: taskId,
    cacheLevel: 'instance',
    namespace: 'none',
  })
  const cacheIndex = argv.indexOf('--cache_level')
  const namespaceIndex = argv.indexOf('--namespace')
  assert.equal(argv[cacheIndex + 1], 'instance')
  assert.equal(argv[namespaceIndex + 1], 'none')
  assert.throws(
    () => createSweBenchAdapter({ cacheLevel: 'invalid' as 'instance' }),
    /invalid cacheLevel/,
  )
})

test('SWE setup and extraction stay in the session workspace and exclude test edits', () => {
  const root = mkdtempSync(join(tmpdir(), 'swe-workspace-'))
  try {
    const origin = join(root, 'origin')
    const workspace = join(root, 'session')
    mkdirSync(origin)
    mkdirSync(workspace)
    const git = (args: string[], input?: string) => execFileSync('git', args, { cwd: origin, input, encoding: 'utf8' }).trim()
    git(['init', '--quiet'])
    const blob = git(['hash-object', '-w', '--stdin'], 'before\n')
    const tree = git(['mktree'], `100644 blob ${blob}\tsource.py\n`)
    // Construct fixture history without changing the developer's Git identity or configuration.
    const base = git(['hash-object', '-t', 'commit', '-w', '--stdin'],
      `tree ${tree}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n`)
    git(['update-ref', 'HEAD', base])
    const task = { id: taskId, prompt: 'fix', metadata: { repo: 'fixture/repo', base_commit: base } }
    const adapter = createSweBenchAdapter()
    const setup = adapter.boxSetup!(task)
    const extract = adapter.boxExtract!(task)
    assert.match(setup.command, /^rm -rf '\.\//)
    assert.equal(setup.cwd, undefined)
    assert.equal(extract.cwd, undefined)
    const env = {
      ...process.env,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: `url.file://${origin}.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://github.com/fixture/repo',
      GIT_CONFIG_KEY_1: 'protocol.file.allow',
      GIT_CONFIG_VALUE_1: 'always',
    }
    execFileSync('sh', ['-c', setup.command], { cwd: workspace, env })
    const repo = join(workspace, 'swe-bench-repo')
    assert.ok(existsSync(join(repo, '.git')))
    writeFileSync(join(repo, 'source.py'), 'after\n')
    mkdirSync(join(repo, 'tests'))
    writeFileSync(join(repo, 'tests', 'test_fix.py'), 'hidden-test-edit\n')
    const patch = execFileSync('sh', ['-c', extract.command], { cwd: workspace, env, encoding: 'utf8' })
    assert.match(patch, /diff --git a\/source.py b\/source.py/)
    assert.match(patch, /\+after/)
    assert.doesNotMatch(patch, /hidden-test-edit|test_fix/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
