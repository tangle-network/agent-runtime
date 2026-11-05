#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'

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
const repository = 'tangle-network/agent-runtime'
const qualifier = '.github/workflows/qualify-release.yml'
const workflowAt = (sha) => execFileSync('git', ['show', `${sha}:${qualifier}`], { encoding: 'utf8' })
const api = (path, payload) => JSON.parse(execFileSync('gh-drew', ['api', path,
  ...(payload ? ['--method', 'PATCH', '--input', '-'] : [])], {
  encoding: 'utf8', ...(payload ? { input: JSON.stringify(payload) } : {}),
}))
const policy = (group) => ({ ...group, selected_workflows: [...group.selected_workflows].sort() })

if (![`https://github.com/${repository}.git`, `git@github.com:${repository}.git`]
  .includes(git('config', '--get', 'remote.origin.url'))) refuse('origin must be the maintained Runtime repository')
git('fetch', '--quiet', 'origin', 'main')
const main = git('rev-parse', 'FETCH_HEAD')
const commit = requested ? git('rev-parse', '--verify', `${requested}^{commit}`) : main
if (git('merge-base', commit, main) !== commit) refuse(`${commit} is not merged into origin/main ${main}`)
const selected = JSON.parse(git('show', `${commit}:package.json`)).version
if (selected !== version) refuse(`${commit} carries ${selected}, not ${version}; merge the release PR first`)
if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) !== '') refuse(`${tag} already exists on origin`)
if (git('tag', '--list', tag)) refuse(`${tag} already exists locally`)
if (gated) attestReleaseGate(commit, git('rev-parse', '--verify', `${gated}^{commit}`))
const groups = []
for (let page = 1; ; page += 1) {
  const result = api(`orgs/tangle-network/actions/runner-groups?visible_to_repository=agent-runtime&per_page=100&page=${page}`)
  groups.push(...result.runner_groups.filter((group) => group.selected_workflows?.some((ref) => ref.startsWith(`${repository}/${qualifier}@`))))
  if (result.runner_groups.length < 100) break
  if (page === 10) refuse('runner-group lookup exceeded its bound')
}
if (groups.length !== 1) refuse('reviewed qualifier requires one repository-eligible runner group')
const endpoint = `orgs/tangle-network/actions/runner-groups/${groups[0].id}`
const before = api(endpoint)
if (before.name !== groups[0].name || before.visibility !== 'selected' || before.inherited ||
  before.allows_public_repositories !== true || before.restricted_to_workflows !== true ||
  before.workflow_restrictions_read_only !== false || !Array.isArray(before.selected_workflows) ||
  !before.selected_workflows.every((ref) => typeof ref === 'string') ||
  !before.selected_workflows.some((ref) => ref.startsWith(`${repository}/${qualifier}@`))) refuse('runner-group restrictions require owner reconciliation')
const frozen = workflowAt(commit)
let reviewed = frozen === workflowAt(main)
for (const ref of before.selected_workflows) {
  if (reviewed) break
  const source = ref.startsWith(`${repository}/${qualifier}@`) ? ref.split('@').at(-1) : ''
  if (!/^[a-f0-9]{40}$/.test(source)) continue
  git('fetch', '--quiet', '--no-tags', 'origin', source)
  reviewed = frozen === workflowAt(source)
}
if (!reviewed) refuse('frozen qualifier matches neither reviewed main nor an admitted immutable workflow; reconcile its runner policy first')
git('tag', '--annotate', tag, '--message', tag, commit)
git('-c', 'credential.helper=', '-c', 'credential.helper=!gh-drew auth git-credential', 'push', '--quiet', 'origin', `refs/tags/${tag}`)
console.log(`tagged ${tag} at ${commit}`)
try {
  if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}^{}`) !== `${commit}\trefs/tags/${tag}^{}`)
    throw new Error('remote immutable tag does not match the selected commit')
  const ref = `${repository}/${qualifier}@refs/tags/${tag}`
  if (!isDeepStrictEqual(policy(api(endpoint)), policy(before))) throw new Error('runner-group policy changed during tagging')
  const expected = { ...before, selected_workflows: [...before.selected_workflows, ...(before.selected_workflows.includes(ref) ? [] : [ref])] }
  // The API has no conditional PATCH: the organization owner serializes policy writes.
  if (!before.selected_workflows.includes(ref)) api(endpoint, { selected_workflows: expected.selected_workflows })
  if (!isDeepStrictEqual(policy(api(endpoint)), policy(expected))) throw new Error('runner-group admission readback differs')
  console.log(`qualifier admitted: ${ref} in ${before.name}`)
} catch (error) {
  refuse(`${tag} remains published at ${commit}; reconcile its exact qualifier tag reference with the runner-group owner: ${error.message}`)
}
