#!/usr/bin/env node
/**
 * Tag a merged release, defaulting to main. An explicit qualified commit remains
 * frozen when later source changes land. Refuse unmerged commits, mismatched versions
 * and existing tags before writing anything; never move or replace a release tag.
 *
 * Usage: pnpm run release:tag <version> [--commit <full-sha>]
 */
import { execFileSync } from 'node:child_process'

const [version, option, requested, ...extra] = process.argv.slice(2)
if (!/^\d+\.\d+\.\d+$/u.test(version ?? '') || extra.length ||
    (option !== undefined && (option !== '--commit' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(requested ?? '')))) {
  console.error('usage: pnpm run release:tag <major.minor.patch> [--commit <full-sha>]')
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
git('tag', '--annotate', tag, '--message', tag, commit)
git('push', '--quiet', 'origin', `refs/tags/${tag}`)
console.log(`tagged ${tag} at ${commit}`)
