import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const command = fileURLToPath(new URL('./verify-release-line.mjs', import.meta.url))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'release-line-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  mkdirSync(home)
  const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' }
  const origin = join(root, 'origin.git')
  const source = join(root, 'source')
  function gitAt(dir, ...args) {
    return execFileSync('git', ['-C', dir, ...args], { env, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim()
  }
  gitAt(root, 'init', '--bare', '--initial-branch=main', origin)
  gitAt(root, 'clone', origin, source)
  const git = (...args) => gitAt(source, ...args)
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'release@example.invalid')
  function commit(name, version = '1.2.3') {
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'fixture', version }))
    writeFileSync(join(source, 'change.txt'), name)
    git('add', '.')
    git('commit', '-qm', name)
    return git('rev-parse', 'HEAD')
  }
  const initial = commit('initial')
  git('push', '-q', 'origin', 'main')
  function run(candidate, { cwd = source, main = 'refs/remotes/origin/main',
    line = 'refs/remotes/origin/release/1.2.x', extra = [] } = {}) {
    return spawnSync(process.execPath, [command, candidate, main, line, ...extra], {
      cwd, env, encoding: 'utf8', timeout: 15_000,
    })
  }
  return { root, source, origin, initial, git, gitAt, commit, run }
}
function passed(result) {
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
function refused(result) {
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Release-line admission failed/)
}

test('main tip is admitted with the exact candidate', t => {
  const f = fixture(t)
  assert.deepEqual(passed(f.run(f.initial)), { candidate: f.initial,
    line: 'refs/remotes/origin/main', observedTip: f.initial })
})
test('new source commits do not starve a frozen candidate', t => {
  const f = fixture(t)
  const tip = f.commit('newer source')
  f.git('push', '-q', 'origin', 'main')
  f.git('checkout', '-q', '--detach', f.initial)
  const result = passed(f.run(f.initial))
  assert.equal(result.candidate, f.initial)
  assert.equal(result.observedTip, tip)
  assert.equal(f.git('rev-parse', 'HEAD'), f.initial)
})
test('a newer package version on main does not retarget the candidate', t => {
  const f = fixture(t)
  f.commit('next release', '2.0.0')
  f.git('push', '-q', 'origin', 'main')
  f.git('checkout', '-q', '--detach', f.initial)
  assert.equal(passed(f.run(f.initial)).candidate, f.initial)
  assert.equal(JSON.parse(readFileSync(join(f.source, 'package.json'))).version, '1.2.3')
})
test('a matching diverged backport line admits its candidate', t => {
  const f = fixture(t)
  f.commit('main next', '2.0.0')
  f.git('push', '-q', 'origin', 'main')
  f.git('checkout', '-qb', 'release/1.2.x', f.initial)
  const candidate = f.commit('backport')
  f.git('push', '-q', 'origin', 'release/1.2.x')
  assert.equal(passed(f.run(candidate)).line, 'refs/remotes/origin/release/1.2.x')
})
test('a backport line may advance while the candidate remains frozen', t => {
  const f = fixture(t)
  f.git('checkout', '-qb', 'release/1.2.x')
  const candidate = f.commit('backport')
  const tip = f.commit('later backport', '1.2.4')
  f.git('push', '-q', 'origin', 'release/1.2.x')
  f.git('checkout', '-q', '--detach', candidate)
  assert.equal(passed(f.run(candidate)).observedTip, tip)
})
test('an unlanded feature commit is refused', t => {
  const f = fixture(t)
  f.git('checkout', '-qb', 'feature')
  refused(f.run(f.commit('unlanded')))
})
test('an unrelated backport history is refused', t => {
  const f = fixture(t)
  f.git('checkout', '-qb', 'release/1.2.x')
  f.commit('other backport')
  f.git('push', '-q', 'origin', 'release/1.2.x')
  f.git('checkout', '-qb', 'feature', f.initial)
  refused(f.run(f.commit('unlanded')))
})
test('a mismatched checkout is refused before a source fetch', t => {
  const f = fixture(t)
  f.commit('different checkout')
  refused(f.run(f.initial))
})
test('a removed remote line cannot be authorized by its stale tracking ref', t => {
  const f = fixture(t)
  f.git('checkout', '-qb', 'release/1.2.x')
  const candidate = f.commit('backport')
  f.git('push', '-q', 'origin', 'release/1.2.x')
  f.git('push', '-q', 'origin', '--delete', 'release/1.2.x')
  // Recreate a stale local tracking ref, not a remote branch.
  f.git('update-ref', 'refs/remotes/origin/release/1.2.x', candidate)
  refused(f.run(candidate))
})
test('an unreadable origin never reuses a cached positive result', t => {
  const f = fixture(t)
  f.git('remote', 'set-url', 'origin', join(f.root, 'missing-origin'))
  refused(f.run(f.initial))
})
test('a shallow candidate checkout obtains enough history to prove ancestry', t => {
  const f = fixture(t)
  f.git('tag', 'v1.2.3')
  f.commit('newer source')
  f.git('push', '-q', 'origin', 'main', 'v1.2.3')
  const checkout = join(f.root, 'shallow')
  f.gitAt(f.root, 'clone', '--depth=1', '--branch', 'v1.2.3', pathToFileURL(f.origin).href, checkout)
  assert.equal(f.gitAt(checkout, 'rev-parse', '--is-shallow-repository'), 'true')
  assert.equal(passed(f.run(f.initial, { cwd: checkout })).candidate, f.initial)
  assert.equal(f.gitAt(checkout, 'rev-parse', '--is-shallow-repository'), 'false')
})
test('malformed candidates and noncanonical line selectors are refused', t => {
  const f = fixture(t)
  refused(f.run('--help'))
  refused(f.run(f.initial, { main: 'refs/remotes/origin/feature' }))
  refused(f.run(f.initial, { line: 'refs/remotes/origin/release/2.0.x' }))
  refused(f.run(f.initial, { extra: ['unexpected'] }))
})
