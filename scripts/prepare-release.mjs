#!/usr/bin/env node
/**
 * Prepare one release from the feature notes already merged on main.
 *
 * Feature PRs do not choose a version and do not edit CHANGELOG.md. They add a
 * .release-notes/*.md file. This command chooses the next version from the
 * highest pending note, consumes the notes, and regenerates every versioned or
 * derived artifact in one release-only change.
 *
 * Usage: pnpm run release:prepare [--amend-unpublished]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readReleaseNotes } from './release-notes.mjs'

const amend = process.argv[2] === '--amend-unpublished'
if (process.argv.length > (amend ? 3 : 2)) throw new Error('usage: release:prepare [--amend-unpublished]')
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
const bump = (from, level) => {
  let [major, minor, patch] = from.split('.').map(Number)
  if (level === 'major') { major += 1; minor = 0; patch = 0 }
  else if (level === 'minor') { minor += 1; patch = 0 }
  else patch += 1
  return `${major}.${minor}.${patch}`
}
const { name } = JSON.parse(raw)
const registry = 'https://registry.npmjs.org'
const metadata = await fetch(`${registry}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(15_000) })
if (!metadata.ok) throw new Error(`cannot read ${name} release history: HTTP ${metadata.status}`)
const order = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}
const published = Object.keys((await metadata.json()).versions ?? {})
const stable = published.filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(order)
const previous = stable.at(-1)
if (!previous) throw new Error(`cannot determine the published predecessor of ${name}`)
const remoteTags = execFileSync('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v*'], { cwd: repoRoot, encoding: 'utf8' })
const localTags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: repoRoot, encoding: 'utf8' })
const occupied = new Set([...published,
  ...[...remoteTags.matchAll(/refs\/tags\/v(\d+\.\d+\.\d+)(?:\^\{\})?$/gm)].map((m) => m[1]),
  ...localTags.trim().split('\n').map((tag) => tag.slice(1))])
const required = bump(previous, level)
let version = order(current, required) >= 0 ? current : required
if (amend) version = current
else while (occupied.has(version)) version = bump(version, 'patch')
const absorbing = version === current
const changelogPath = resolve(repoRoot, 'CHANGELOG.md')
const changelog = readFileSync(changelogPath, 'utf8')
if (absorbing) {
  const response = await fetch(`${registry}/${encodeURIComponent(name)}/${version}`, { signal: AbortSignal.timeout(15_000) })
  if (response.status !== 404 || occupied.has(version) || order(version, required) < 0 ||
      !changelog.startsWith(`## ${version}\n\n`) || !changelog.includes(`\n## ${previous}\n`))
    throw new Error('current preparation must be unpublished, untagged, documented and pay for the pending notes')
}

const run = (script) => {
  console.log(`\n$ pnpm run ${script}`)
  execFileSync('pnpm', ['run', script], { cwd: repoRoot, stdio: 'inherit' })
}

// The cohort archives the clean source commit; qualify it before generating release files.
run('release:cohort')

const updated = raw.replace(
  /^(\s*"version":\s*)"[^"]+"/m,
  (_match, prefix) => `${prefix}"${version}"`,
)
if (!/^\s*"version":/m.test(raw)) throw new Error('could not locate the version field in package.json')
writeFileSync(packagePath, updated)
console.log(`package.json: ${current} -> ${version} (${level})`)

const body = notes.map((note) => note.text).join('\n\n')
writeFileSync(changelogPath, absorbing
  ? changelog.replace(`## ${version}\n\n`, `## ${version}\n\n${body}\n\n`)
  : `## ${version}\n\n${body}\n\n${changelog}`)
console.log(`CHANGELOG.md: consumed ${notes.length} release note(s)`)

const canonicalPath = resolve(repoRoot, 'docs/canonical-api.md')
const canonicalRaw = readFileSync(canonicalPath, 'utf8')
const canonicalUpdated = canonicalRaw.replace(
  /^> \*\*Version \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.\*\*$/m,
  `> **Version ${version}.**`,
)
if (!/^> \*\*Version \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.\*\*$/m.test(canonicalRaw)) {
  throw new Error(`could not locate the version banner in ${canonicalPath}`)
}
writeFileSync(canonicalPath, canonicalUpdated)

for (const note of notes) rmSync(resolve(repoRoot, '.release-notes', note.name))

run('generate:testing-fixture')
run('docs:api')
run('api:surface')

console.log(
  [
    '',
    `Prepared ${version}. Next:`,
    '  git add -A && git commit -m "chore(release): prepare <version>"',
    '  open the release PR, gate it with `pnpm run release:check`, merge it, then tag the main tip:',
    `  pnpm run release:tag ${version} --commit <merged-sha> --gate <gated-sha>`,
  ].join('\n'),
)
