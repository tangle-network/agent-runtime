#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readReleaseNotes } from './release-notes.mjs'

const directory = process.argv[2]
const archives = readdirSync(directory).filter((name) => name.endsWith('.tgz'))
if (archives.length !== 1) throw new Error('expected exactly one release archive')
if (readReleaseNotes().length) throw new Error('pending release notes must be consumed with release:prepare before qualification')
const archive = join(directory, archives[0])
const read = (path) => execFileSync('tar', ['-xOzf', archive, `package/${path}`], { encoding: 'utf8' })
const { version } = JSON.parse(read('package.json'))
const changelog = read('CHANGELOG.md')
const heading = /^## ([^\n]+)\n\n([\s\S]*?)(?=\n## |$)/.exec(changelog)
if (!heading || heading[1] !== version || !heading[2].trim())
  throw new Error(`archive needs a nonempty leading CHANGELOG entry for ${version}`)
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
let base = process.env.PACKAGE_VERSION_BUMP_BASE
if (!base) { git('fetch', '--quiet', '--no-tags', 'origin', 'main'); base = 'FETCH_HEAD' }
const ancestor = git('merge-base', base, 'HEAD')
const changed = git('diff', '--name-only', ancestor, 'HEAD').split('\n')
if (changed.some((path) => path.startsWith('src/') || ['package.json', 'pnpm-workspace.yaml'].includes(path))) {
  const previous = git('show', `${ancestor}:CHANGELOG.md`)
  const previousEntry = /^## ([^\n]+)\n\n([\s\S]*?)(?=\n## |$)/.exec(previous)
  if (previousEntry?.[1] === version && previousEntry[2].trim() === heading[2].trim())
    throw new Error('consumer-visible source changes need updated release prose before merge')
}
console.log(`release notes admitted for the exact ${version} archive`)
