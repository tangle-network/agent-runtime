import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scripts = dirname(fileURLToPath(import.meta.url))
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
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
    const result = spawnSync(process.execPath, ['scripts/check-release-archive.mjs', 'archives'], { cwd: root, encoding: 'utf8', env: { ...process.env, PACKAGE_VERSION_BUMP_BASE: base } })
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

test('tag CLI freezes a merged commit, refuses unmerged sources and never replaces a tag', (t) => {
  const root = fixture(t)
  const repo = join(root, 'source'), remote = join(root, 'origin.git')
  run('git', ['init', '--bare', remote], root)
  run('git', ['init', '--initial-branch=main', repo], root)
  writeFileSync(join(repo, 'package.json'), '{"version":"4.0.0"}\n')
  run('git', ['add', 'package.json'], repo)
  run('git', ['commit', '-m', 'release fixture'], repo)
  run('git', ['remote', 'add', 'origin', remote], repo)
  run('git', ['push', '-u', 'origin', 'main'], repo)
  const merged = run('git', ['rev-parse', 'HEAD'], repo)
  run('git', ['switch', '-c', 'unmerged'], repo)
  writeFileSync(join(repo, 'change'), 'unmerged bytes\n')
  run('git', ['add', 'change'], repo)
  run('git', ['commit', '-m', 'unmerged fixture'], repo)
  const unmerged = run('git', ['rev-parse', 'HEAD'], repo)
  const tag = (sha, ...extra) => spawnSync(process.execPath, [join(scripts, 'tag-release.mjs'), '4.0.0', '--commit', sha, ...extra], { cwd: repo, encoding: 'utf8' })
  assert.notEqual(tag(unmerged).status, 0)
  assert.notEqual(tag(merged, '--gate', unmerged).status, 0, 'changed tree must refuse before receipt lookup')
  assert.equal(tag(merged).status, 0)
  assert.equal(run('git', ['rev-parse', 'v4.0.0^{}'], repo), merged)
  assert.match(run('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v4.0.0^{}'], repo), new RegExp(`^${merged}`))
  assert.notEqual(tag(merged).status, 0)
  assert.equal(readFileSync(join(repo, 'change'), 'utf8'), 'unmerged bytes\n')
})
