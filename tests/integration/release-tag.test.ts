import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const script = resolve('scripts/tag-release.mjs')
const roots: string[] = []
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'runtime-release-tag-'))
  roots.push(root)
  const remote = join(root, 'origin.git')
  const work = join(root, 'work')
  git(root, 'init', '--bare', '--quiet', '--initial-branch=main', remote)
  git(root, 'clone', '--quiet', remote, work)
  const commit = (version: string, parent?: string) => {
    writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'release-fixture', version }))
    git(work, 'add', 'package.json')
    // Fixture commits use real Git objects and the operator's existing identity.
    const tree = git(work, 'write-tree')
    const sha = git(work, 'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', version)
    git(work, 'update-ref', 'refs/heads/main', sha)
    git(work, 'push', '--quiet', 'origin', 'refs/heads/main')
    return sha
  }
  const tag = (...args: string[]) =>
    execFileSync(process.execPath, [script, ...args], {
      cwd: work,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  return { root, work, remote, commit, tag }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('tags the qualified merged ancestor after main advances and refuses to replace its tag', () => {
  const { work, remote, commit, tag } = fixture()
  const release = commit('0.351.0')
  const advanced = commit('0.351.1', release)
  tag('0.351.0', '--commit', release)
  expect(git(remote, 'rev-parse', 'refs/tags/v0.351.0^{}')).toBe(release)
  expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(advanced)
  expect(() => tag('0.351.0', '--commit', release)).toThrow()
  expect(git(remote, 'rev-parse', 'refs/tags/v0.351.0^{}')).toBe(release)
  expect(git(work, 'cat-file', '-t', 'refs/tags/v0.351.0')).toBe('tag')
})

it('refuses unmerged and wrong-version commits without creating any tag', () => {
  const { work, remote, commit, tag } = fixture()
  const release = commit('0.351.0')
  const tree = git(work, 'rev-parse', `${release}^{tree}`)
  const unmerged = git(work, 'commit-tree', tree, '-p', release, '-m', 'unmerged')
  expect(() => tag('0.351.0', '--commit', unmerged)).toThrow()
  expect(() => tag('0.352.0', '--commit', release)).toThrow()
  expect(git(remote, 'tag', '--list')).toBe('')
  expect(git(work, 'tag', '--list')).toBe('')
})

it('keeps the main-tip default and refuses extra or malformed commit arguments', () => {
  const { remote, commit, tag } = fixture()
  const release = commit('0.351.0')
  expect(() => tag('0.351.0', '--commit', release, 'extra')).toThrow()
  expect(() => tag('0.351.0', '--commit', 'main')).toThrow()
  expect(git(remote, 'tag', '--list')).toBe('')
  tag('0.351.0')
  expect(git(remote, 'rev-parse', 'refs/tags/v0.351.0^{}')).toBe(release)
})
