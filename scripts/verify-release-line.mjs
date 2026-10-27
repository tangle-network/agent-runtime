import { execFileSync, spawnSync } from 'node:child_process'

// Source admission only. The publisher still verifies and promotes the exact
// archive; advancing an integration branch does not invalidate this candidate.
const [candidate, mainRef, lineRef, ...extra] = process.argv.slice(2)
const timeout = 60_000
function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim()
}
function contains(ref) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', candidate, ref], {
    encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(`Unable to establish candidate ancestry for ${ref}`)
}

try {
  if (extra.length || !/^[0-9a-f]{40}$/.test(candidate ?? '') ||
      mainRef !== 'refs/remotes/origin/main') {
    throw new Error('Expected a full candidate SHA and the canonical main ref')
  }
  if (git('rev-parse', 'HEAD') !== candidate) {
    throw new Error('Checkout does not match the frozen release candidate')
  }
  const { version } = JSON.parse(git('show', `${candidate}:package.json`))
  const semver = typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version)
  if (!semver || semver[4]?.split('.').some(part => /^0\d+$/.test(part))) {
    throw new Error('Release-line admission requires a valid package version')
  }
  const releaseLine = `release/${semver[1]}.${semver[2]}.x`
  if (lineRef !== `refs/remotes/origin/${releaseLine}`) {
    throw new Error('Backport line does not match the candidate package version')
  }
  // A depth-limited negative ancestry result is inconclusive. Complete the
  // graph before deciding; a failed fetch is never permission to use stale refs.
  const shallow = git('rev-parse', '--is-shallow-repository') === 'true'
  git('fetch', '--no-tags', ...(shallow ? ['--unshallow'] : []), 'origin',
    `+refs/heads/main:${mainRef}`)
  let admitted = mainRef
  if (!contains(mainRef)) {
    git('fetch', '--no-tags', 'origin', `+refs/heads/${releaseLine}:${lineRef}`)
    if (!contains(lineRef)) {
      throw new Error('Candidate is on neither main nor its matching backport line')
    }
    admitted = lineRef
    // A line below main's (0.353.x under 2.x) ships only for a consumer its CHANGELOG names.
    const line = (v) => (v.startsWith('0.') ? Number(v.split('.')[1]) : Number(v.split('.')[0]) * 1e9)
    const mainVersion = JSON.parse(git('show', `${mainRef}:package.json`)).version
    const section = git('show', `${candidate}:CHANGELOG.md`).split(/^## /m).find((part) => part.startsWith(`${version}\n`))
    if (line(version) < line(mainVersion) && !/^Needed by: \S/m.test(section ?? '')) {
      throw new Error(`${version} is on a line superseded by main's ${mainVersion}; its CHANGELOG section needs a "Needed by: <owner/repo>" line`)
    }
  }
  if (git('rev-parse', 'HEAD') !== candidate) {
    throw new Error('Checkout moved while verifying the candidate')
  }
  console.log(JSON.stringify({ candidate, line: admitted, observedTip: git('rev-parse', admitted) }))
} catch (error) {
  // Git diagnostics can include remote URLs; do not copy them into a receipt.
  console.error(`Release-line admission failed: ${error?.status !== undefined ? 'Git could not read the required source history' : error.message}`)
  process.exitCode = 1
}
