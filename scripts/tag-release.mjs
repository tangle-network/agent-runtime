#!/usr/bin/env node
/**
 * Tag a merged release, defaulting to main. An explicit qualified commit remains
 * frozen when later source changes land. Refuse unmerged commits, mismatched versions
 * and existing tags before writing anything; never move or replace a release tag.
 *
 * Usage: pnpm run release:tag <version> [--commit <full-sha>] [--gate <gated-sha>]
 */
import { execFileSync } from 'node:child_process'

import { attestReleaseGate } from './release-gate.mjs'

const [version, ...options] = process.argv.slice(2)
let requested, gated
for (let i = 0; i < options.length; i += 2) {
  const [flag, value] = options.slice(i, i + 2)
  if (!['--commit', '--gate'].includes(flag) || !/^[a-f0-9]{40}$/.test(value ?? '') ||
      (flag === '--commit' ? requested : gated)) throw new Error('expected distinct --commit/--gate <full-sha> options')
  if (flag === '--commit') requested = value
  else gated = value
}
if (!/^\d+\.\d+\.\d+$/u.test(version ?? '')) {
  console.error('usage: pnpm run release:tag <major.minor.patch> [--commit <full-sha>] [--gate <gated-sha>]')
  process.exit(2)
}
const tag = `v${version}`
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const refuse = (reason) => {
  console.error(`refused: ${reason}`)
  process.exit(1)
}

git('fetch', '--quiet', 'origin', 'main')
const main = git('rev-parse', 'FETCH_HEAD')
const commit = requested ? git('rev-parse', '--verify', `${requested}^{commit}`) : main
if (git('merge-base', commit, main) !== commit) refuse(`${commit} is not merged into origin/main ${main}`)
const selected = JSON.parse(git('show', `${commit}:package.json`)).version
if (selected !== version) refuse(`${commit} carries ${selected}, not ${version}; merge the release PR first`)
if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) !== '') refuse(`${tag} already exists on origin`)
if (git('tag', '--list', tag)) refuse(`${tag} already exists locally`)
if (gated) attestReleaseGate(commit, git('rev-parse', '--verify', `${gated}^{commit}`))
git('tag', '--annotate', tag, '--message', tag, commit)
git('push', '--quiet', 'origin', `refs/tags/${tag}`)
console.log(`tagged ${tag} at ${commit}`)
