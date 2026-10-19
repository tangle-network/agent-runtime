#!/usr/bin/env node
/**
 * Tag one release on the main tip that carries its version, and push the tag.
 *
 * It refuses unless origin/main's package.json names exactly the requested version and no tag of
 * that name exists, so a release PR that did not merge cannot be tagged. On 2026-10-19 v0.330.0 and
 * v0.330.1 were each pushed on a main tip that still carried the previous version, after a merge
 * the guard had refused; publish.yml refused both, but each tag still had to be deleted by hand.
 *
 * Usage: pnpm run release:tag <version>
 */
import { execFileSync } from 'node:child_process'

const version = process.argv[2]
if (version === undefined || !/^\d+\.\d+\.\d+$/u.test(version)) {
  console.error('usage: pnpm run release:tag <major.minor.patch>')
  process.exit(2)
}
const tag = `v${version}`
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

git('fetch', '--quiet', 'origin', 'main')
const main = git('rev-parse', 'FETCH_HEAD')
const onMain = JSON.parse(git('show', `${main}:package.json`)).version
if (onMain !== version) {
  console.error(`refused: origin/main ${main} carries ${onMain}, not ${version}; merge the release PR first`)
  process.exit(1)
}
if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) !== '') {
  console.error(`refused: ${tag} already exists on origin`)
  process.exit(1)
}
git('tag', '--annotate', tag, '--message', tag, main)
git('push', '--quiet', 'origin', `refs/tags/${tag}`)
console.log(`tagged ${tag} at ${main}`)
