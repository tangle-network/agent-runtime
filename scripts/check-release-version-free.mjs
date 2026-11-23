#!/usr/bin/env node
// A release version is this release's own when origin's tag for it names this tree; otherwise it
// is free only when origin has no such tag and the registry definitely does not serve it. On
// 2026-11-23 v10.0.14 was tagged at 07701822 and published at 04:21Z while the release PR
// carrying two more changes was still gating; its release:check passed at 05:26Z, and the merge
// released nothing. A registry that cannot be read refuses as "could not read", never as free.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readRegistryVersion } from './lib/npm-registry.mjs'

const [manifest = 'package.json', remote = 'origin'] = process.argv.slice(2)
const refuse = (reason) => {
  console.error(`release version refused: ${reason}`)
  process.exit(1)
}
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const failure = (error) => (error?.stderr?.toString().trim() || error?.message || String(error)).split('\n')[0]

const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'))
if (typeof name !== 'string' || typeof version !== 'string') refuse(`${manifest} names no package version`)
const tag = `v${version}`

let listed
try {
  listed = git('ls-remote', '--tags', remote, `refs/tags/${tag}`)
} catch (error) {
  refuse(`could not read ${remote}'s tags for ${tag}: ${failure(error)}`)
}
if (listed !== '') {
  let tagged
  let tree
  try {
    git('fetch', '--quiet', '--no-tags', remote, `refs/tags/${tag}`)
    tagged = git('rev-parse', 'FETCH_HEAD^{commit}')
    tree = git('rev-parse', 'FETCH_HEAD^{tree}')
  } catch (error) {
    refuse(`could not read ${tag} from ${remote}: ${failure(error)}`)
  }
  // A tag naming this exact tree is this release's own: the hosted qualifier and publication
  // retries check the tagged tree itself.
  if (tree === git('rev-parse', 'HEAD^{tree}')) {
    console.log(`${tag} on ${remote} names this tree; ${name}@${version} is this release's own`)
    process.exit(0)
  }
  refuse(`${tag} already exists on ${remote} at ${tagged}, another tree; ${name}@${version} is taken`)
}
let record
try {
  record = await readRegistryVersion(name, version)
} catch (error) {
  refuse(error.message)
}
if (record.status === 'present') refuse(`${name}@${version} is already on the npm registry`)
console.log(`${name}@${version} is free: ${remote} has no ${tag} and the npm registry answers 404`)
