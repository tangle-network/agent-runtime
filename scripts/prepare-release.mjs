#!/usr/bin/env node
/**
 * Bump the package version and regenerate every artifact that embeds it.
 *
 * Three checked-in artifacts carry the runtime version, and every one is
 * verified in CI, so a hand-written bump commit fails and the release does not
 * publish:
 *   - src/testing/fixtures/agent-improvement-proposal.json (tests/testing-fixture.test.ts)
 *   - docs/api/primitive-catalog.md                        (pnpm run docs:check)
 *   - docs/canonical-api.md                                (pnpm run docs:freshness)
 *
 * The first two are generated; the third is hand-written prose, so it is
 * rewritten here directly.
 *
 * 0.106.1 was tagged with both stale; the Publish run and main's CI both failed
 * and the parallel-tool-call fix sat unpublished. Bump through this script so
 * the version and its generated artifacts move in one commit.
 *
 * Usage: pnpm run release:prepare <version>
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = resolve(repoRoot, 'package.json')

const version = process.argv[2]
if (!version) {
  throw new Error('usage: pnpm run release:prepare <version>')
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`not a release version: ${version}`)
}

const raw = readFileSync(packagePath, 'utf8')
const current = JSON.parse(raw).version
if (current === version) {
  throw new Error(`package.json is already ${version}`)
}

// Rewrite the single top-level "version" field textually so formatting,
// key order, and trailing newline survive untouched.
const updated = raw.replace(
  /^(\s*"version":\s*)"[^"]+"/m,
  (_match, prefix) => `${prefix}"${version}"`,
)
if (updated === raw) throw new Error('could not locate the version field in package.json')
writeFileSync(packagePath, updated)
console.log(`package.json: ${current} -> ${version}`)

// Hand-written prose the freshness gate pins to package.json.
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
console.log(`docs/canonical-api.md: version banner -> ${version}`)

const run = (script) => {
  console.log(`\n$ pnpm run ${script}`)
  execFileSync('pnpm', ['run', script], { cwd: repoRoot, stdio: 'inherit' })
}

run('generate:testing-fixture')
run('docs:api')

console.log(
  [
    '',
    `Prepared ${version}. Next:`,
    '  git add -A && git commit -m "chore(release): <version>"',
    '  open a PR, merge it, then tag the tip of main:',
    `  git tag v${version} <merged-main-sha> && git push origin v${version}`,
    '',
    'Publish rejects a tag that is not the tip of main (or of release/<major>.<minor>.x).',
  ].join('\n'),
)
