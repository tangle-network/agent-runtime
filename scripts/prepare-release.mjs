#!/usr/bin/env node
/**
 * Prepare one release from the feature notes already merged on main.
 *
 * Feature PRs do not choose a version and do not edit CHANGELOG.md. They add a
 * .release-notes/*.md file. This command chooses the next version from the
 * highest pending note, consumes the notes, and regenerates every versioned or
 * derived artifact in one release-only change.
 *
 * Usage: pnpm run release:prepare
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readReleaseNotes } from './release-notes.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = resolve(repoRoot, 'package.json')
const raw = readFileSync(packagePath, 'utf8')
const current = JSON.parse(raw).version
const notes = readReleaseNotes()
if (notes.length === 0) throw new Error('no pending .release-notes/*.md entries')

const rank = { patch: 0, minor: 1, major: 2 }
const level = notes.reduce((best, note) => rank[note.type] > rank[best] ? note.type : best, 'patch')
const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
if (!parsed) throw new Error(`cannot bump non-stable version ${current}`)
let [major, minor, patch] = parsed.slice(1).map(Number)
if (level === 'major') { major += 1; minor = 0; patch = 0 }
else if (level === 'minor') { minor += 1; patch = 0 }
else patch += 1
const version = `${major}.${minor}.${patch}`

const updated = raw.replace(
  /^(\s*"version":\s*)"[^"]+"/m,
  (_match, prefix) => `${prefix}"${version}"`,
)
if (updated === raw) throw new Error('could not locate the version field in package.json')
writeFileSync(packagePath, updated)
console.log(`package.json: ${current} -> ${version} (${level})`)

const changelogPath = resolve(repoRoot, 'CHANGELOG.md')
const changelog = readFileSync(changelogPath, 'utf8')
const body = notes.map((note) => note.text).join('\n\n')
writeFileSync(changelogPath, `## ${version}\n\n${body}\n\n${changelog}`)
console.log(`CHANGELOG.md: consumed ${notes.length} release note(s)`)

const canonicalPath = resolve(repoRoot, 'docs/canonical-api.md')
const canonicalRaw = readFileSync(canonicalPath, 'utf8')
const canonicalUpdated = canonicalRaw.replace(
  /^> \*\*Version \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.\*\*$/m,
  `> **Version ${version}.**`,
)
if (canonicalUpdated === canonicalRaw) {
  throw new Error(`could not locate the version banner in ${canonicalPath}`)
}
writeFileSync(canonicalPath, canonicalUpdated)

for (const note of notes) rmSync(resolve(repoRoot, '.release-notes', note.name))

const run = (script) => {
  console.log(`\n$ pnpm run ${script}`)
  execFileSync('pnpm', ['run', script], { cwd: repoRoot, stdio: 'inherit' })
}

run('generate:testing-fixture')
run('docs:api')
run('api:surface')

console.log(
  [
    '',
    `Prepared ${version}. Next:`,
    '  git add -A && git commit -m "chore(release): prepare <version>"',
    '  open the release PR, merge it, then tag the merged main tip:',
    `  git tag v${version} <merged-main-sha> && git push origin v${version}`,
  ].join('\n'),
)
