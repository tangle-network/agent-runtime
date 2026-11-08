import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scripts = dirname(fileURLToPath(import.meta.url))
const fixtureEnv = { ...process.env, GIT_ALLOW_TEST_IDENTITY: '1', GIT_AUTHOR_NAME: 'Release fixture', GIT_AUTHOR_EMAIL: 'release-fixture@example.invalid', GIT_COMMITTER_NAME: 'Release fixture', GIT_COMMITTER_EMAIL: 'release-fixture@example.invalid', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' }
const run = (command, args, cwd) => execFileSync(command, args, { cwd, env: fixtureEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-publication-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('real npm archives require matching release prose and fully consumed notes', (t) => {
  const root = fixture(t)
  for (const directory of ['scripts', 'package', 'archives', '.release-notes']) mkdirSync(join(root, directory))
  for (const script of ['check-release-archive.mjs', 'release-notes.mjs']) cpSync(join(scripts, script), join(root, 'scripts', script))
  writeFileSync(join(root, 'package/package.json'), JSON.stringify({ name: 'runtime-release-fixture', version: '4.0.0', files: ['CHANGELOG.md'] }))
  run('git', ['init', '--initial-branch=main'], root)
  writeFileSync(join(root, 'CHANGELOG.md'), '## 4.0.0\n\nConsumers must handle the changed contract.\n')
  run('git', ['add', 'CHANGELOG.md'], root)
  run('git', ['commit', '-m', 'published source fixture'], root)
  const base = run('git', ['rev-parse', 'HEAD'], root)
  const check = (changelog, expected) => {
    rmSync(join(root, 'archives'), { recursive: true }); mkdirSync(join(root, 'archives'))
    if (changelog === null) rmSync(join(root, 'package/CHANGELOG.md'), { force: true })
    else writeFileSync(join(root, 'package/CHANGELOG.md'), changelog)
    run('npm', ['pack', '--ignore-scripts', '--pack-destination', join(root, 'archives')], join(root, 'package'))
    const result = spawnSync(process.execPath, ['scripts/check-release-archive.mjs', 'archives'], { cwd: root, encoding: 'utf8', env: { ...fixtureEnv, PACKAGE_VERSION_BUMP_BASE: base } })
    assert.equal(result.status === 0, expected, result.stderr)
  }
  check(null, false)
  check('## 3.0.46\n\nOld notes.\n', false)
  check('## 4.0.0\n\n\n## 3.0.46\n\nOld notes.\n', false)
  check('## 4.0.0\n\nConsumers must handle the changed contract.\n', true)
  writeFileSync(join(root, '.release-notes/pending.md'), 'type: major\n---\nPending break.\n')
  check('## 4.0.0\n\nConsumers must handle the changed contract.\n', false)
  rmSync(join(root, '.release-notes/pending.md'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/runtime.ts'), 'export const changed = true\n')
  run('git', ['add', 'src/runtime.ts'], root)
  run('git', ['commit', '-m', 'consumer-visible fixture'], root)
  check('## 4.0.0\n\nConsumers must handle the changed contract.\n', false)
  check('## 4.0.0\n\nConsumers must adopt the new runtime behavior.\n', true)
})

test('offline tag CLI preserves immutable Git releases and exact runner admission over HTTP', async (t) => {
  const root = fixture(t)
  const repo = join(root, 'source'), remote = join(root, 'origin.git'), bin = join(root, 'bin')
  const canonical = 'https://github.com/tangle-network/agent-runtime.git'
  run('git', ['init', '--bare', remote], root)
  run('git', ['init', '--initial-branch=main', repo], root)
  mkdirSync(join(repo, '.github/workflows'), { recursive: true }); mkdirSync(bin)
  writeFileSync(join(repo, '.github/workflows/qualify-release.yml'), 'jobs:\n  release-source:\n    runs-on: {group: release-fixture}\n')
  writeFileSync(join(repo, 'package.json'), '{"version":"4.0.0"}\n')
  run('git', ['add', '.'], repo)
  run('git', ['commit', '-m', 'release fixture'], repo)
  run('git', ['config', `url.${remote}.insteadOf`, canonical], repo)
  run('git', ['remote', 'add', 'origin', canonical], repo)
  run('git', ['push', '-u', 'origin', 'main'], repo)
  const merged = run('git', ['rev-parse', 'HEAD'], repo)
  let group = { id: 14, name: 'release-fixture', visibility: 'selected', inherited: false, allows_public_repositories: true,
    restricted_to_workflows: true, workflow_restrictions_read_only: false, selected_workflows: ['another/repository/.github/workflows/deploy.yml@refs/heads/main', `tangle-network/agent-runtime/.github/workflows/qualify-release.yml@${merged}`], extra: 'preserved' }
  let scenario = 'normal', reads = 0, writes = 0
  const ref = 'tangle-network/agent-runtime/.github/workflows/qualify-release.yml@refs/tags/v4.0.0'
  const server = createServer(async (request, response) => { try {
    response.setHeader('content-type', 'application/json')
    if (request.url.startsWith('/orgs/tangle-network/actions/runner-groups?')) {
      assert.match(request.url, /visible_to_repository=agent-runtime/)
      response.end(JSON.stringify({ runner_groups: [group] })); return
    }
    assert.equal(request.url, '/orgs/tangle-network/actions/runner-groups/14')
    if (request.method === 'PATCH') {
      assert.equal(run('git', ['tag', '--list'], remote), '', 'admission precedes the immutable push')
      let body = ''; for await (const chunk of request) body += chunk
      const update = JSON.parse(body); assert.deepEqual(Object.keys(update), ['selected_workflows'])
      const added = update.selected_workflows.filter((entry) => !group.selected_workflows.includes(entry)); assert.ok(added.length > 0 && added.every((entry) => entry === ref || /qualify-release\.yml@[0-9a-f]{40}$/.test(entry)) && group.selected_workflows.every((entry) => update.selected_workflows.includes(entry)))
      writes += 1
      if (scenario === 'denied') { response.writeHead(403).end('{"message":"fixture denied"}'); return }
      group = { ...group, ...update, selected_workflows: update.selected_workflows.toReversed() }
      if (scenario === 'readback') group.extra = 'unexpected change'
    } else if (++reads === 2 && scenario === 'drift') group.extra = 'concurrent owner change'
    response.end(JSON.stringify(group))
  } catch (error) { response.writeHead(500).end(JSON.stringify({ message: error.message })) } }) // an assertion answers, never hangs gh
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  // Real gh performs HTTP and JSON transport; only its endpoint is local to this fixture.
  writeFileSync(join(bin, 'gh-drew'), '#!/bin/sh\nendpoint="$2"\nshift 2\nexec gh api "$FIXTURE_API/$endpoint" "$@"\n', { mode: 0o755 })
  const env = { ...fixtureEnv, PATH: `${bin}:${fixtureEnv.PATH}`, FIXTURE_API: `http://127.0.0.1:${server.address().port}`,
    GH_TOKEN: 'offline-fixture', GH_ENTERPRISE_TOKEN: 'offline-fixture', GH_CONFIG_DIR: join(root, 'gh-config'), GH_NO_UPDATE_NOTIFIER: '1' }
  const tag = async (...args) => {
    try { await promisify(execFile)(process.execPath, [join(scripts, 'tag-release.mjs'), '4.0.0', ...args], { cwd: repo, env }); return 0 }
    catch (error) { return error.code }
  }
  run('git', ['switch', '-c', 'unmerged'], repo)
  writeFileSync(join(repo, 'change'), 'unmerged bytes\n')
  run('git', ['add', 'change'], repo)
  run('git', ['commit', '-m', 'unmerged fixture'], repo)
  const unmerged = run('git', ['rev-parse', 'HEAD'], repo)
  for (const args of [['--commit', unmerged], ['--commit', merged, '--gate', unmerged], ['--commit', 'main'], ['--commit', merged, 'extra']])
    assert.notEqual(await tag(...args), 0)
  assert.equal(run('git', ['tag', '--list'], remote), '')
  assert.equal(reads, 0, 'invalid releases never reach organization admission')
  run('git', ['switch', 'main'], repo)
  writeFileSync(join(repo, 'package.json'), '{"version":"4.0.1"}\n')
  const reviewedWorkflow = 'jobs:\n  release-source:\n    runs-on: {group: release-fixture, labels: [self-hosted]}\n'
  writeFileSync(join(repo, '.github/workflows/qualify-release.yml'), reviewedWorkflow)
  run('git', ['add', '.'], repo); run('git', ['commit', '-m', 'advance main'], repo); run('git', ['push', 'origin', 'main'], repo)
  const advanced = run('git', ['rev-parse', 'HEAD'], repo)
  writeFileSync(join(repo, 'operator-note'), 'preserve uncommitted work\n')
  assert.notEqual(await tag(), 0, 'default main version must match')
  assert.equal(await tag('--commit', merged), 0)
  assert.equal(run('git', ['rev-parse', 'v4.0.0^{}'], repo), merged)
  assert.equal(run('git', ['rev-parse', 'refs/heads/main'], remote), advanced)
  assert.equal(run('git', ['cat-file', '-t', 'refs/tags/v4.0.0'], repo), 'tag')
  assert.notEqual(await tag('--commit', merged), 0)
  assert.equal(writes, 1)
  const installed = structuredClone(group)
  const resetTag = () => { if (run('git', ['tag', '--list'], remote)) run('git', ['update-ref', '-d', 'refs/tags/v4.0.0'], remote); if (run('git', ['tag', '--list'], repo)) run('git', ['tag', '-d', 'v4.0.0'], repo); reads = 0 }
  resetTag()
  assert.equal(await tag('--commit', merged), 0, 'pre-existing exact admission makes no policy write')
  assert.equal(writes, 1); assert.deepEqual(group, installed)
  for (scenario of ['drift', 'denied', 'readback']) {
    resetTag(); group = { ...installed, selected_workflows: installed.selected_workflows.filter((entry) => entry !== ref) }
    const previousWrites = writes
    assert.notEqual(await tag('--commit', merged), 0)
    assert.equal(run('git', ['tag', '--list'], remote), '', 'failed admission publishes no tag')
    assert.equal(writes - previousWrites, scenario === 'drift' ? 0 : 1)
  }
  resetTag(); group = installed; scenario = 'normal'
  writeFileSync(join(repo, 'package.json'), '{"version":"4.0.0"}\n')
  writeFileSync(join(repo, '.github/workflows/qualify-release.yml'), reviewedWorkflow.replace('release-fixture', 'unreviewed-group'))
  run('git', ['add', 'package.json', '.github'], repo); run('git', ['commit', '-m', 'unenrolled divergent qualifier'], repo)
  const divergent = run('git', ['rev-parse', 'HEAD'], repo)
  writeFileSync(join(repo, '.github/workflows/qualify-release.yml'), reviewedWorkflow)
  run('git', ['add', '.github'], repo); run('git', ['commit', '-m', 'reviewed main qualifier'], repo); run('git', ['push', 'origin', 'main'], repo)
  assert.notEqual(await tag('--commit', divergent), 0)
  assert.equal(run('git', ['tag', '--list'], remote), '', 'unenrolled divergent qualifier fails before publication')
  assert.equal(await tag(), 0)
  assert.equal(run('git', ['rev-parse', 'refs/tags/v4.0.0^{}'], remote), run('git', ['rev-parse', 'HEAD'], repo))
  assert.equal(readFileSync(join(repo, 'operator-note'), 'utf8'), 'preserve uncommitted work\n')
  assert.equal(run('git', ['show', 'unmerged:change'], repo), 'unmerged bytes')
})
