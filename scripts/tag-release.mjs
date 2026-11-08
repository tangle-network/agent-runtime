#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'

import { attestReleaseGate } from './release-gate.mjs'

const [spec, ...options] = process.argv.slice(2)
const [pkg, version] = spec?.includes('@') ? spec.split('@') : ['agent-runtime', spec]
let requested, gated
for (let i = 0; i < options.length; i += 2) {
  const [flag, value] = options.slice(i, i + 2)
  if (!['--commit', '--gate'].includes(flag) || !/^[a-f0-9]{40}$/.test(value ?? '') ||
      (flag === '--commit' ? requested : gated)) throw new Error('expected distinct --commit/--gate <full-sha> options')
  if (flag === '--commit') requested = value
  else gated = value
}
if (!['agent-runtime', 'agent-bench'].includes(pkg) || !/^\d+\.\d+\.\d+$/u.test(version ?? '')) {
  console.error('usage: node scripts/tag-release.mjs [agent-bench@]<major.minor.patch> [--commit <full-sha>] [--gate <gated-sha>]')
  process.exit(2)
}
const [tag, manifest] = pkg === 'agent-bench' ? [`agent-bench-v${version}`, 'bench/package.json'] : [`v${version}`, 'package.json']
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const refuse = (reason) => {
  console.error(`refused: ${reason}`)
  process.exit(1)
}
// A runtime tag without proof sends qualification to the full hosted release:check (v8.0.3, five reds).
if (pkg === 'agent-runtime' && !gated) refuse('--gate <gated-sha> is required: run `beelink-gate auto <repo> <sha> -- pnpm run release:check`, then pass that sha')
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
const selected = JSON.parse(git('show', `${commit}:${manifest}`)).version
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
// Admit before pushing, at the tag and the commit (a workflow_call resolves at the commit): the 7.0.2 job queued unadmitted.
const refs = [`refs/tags/${tag}`, commit].map((at) => `${repository}/${qualifier}@${at}`).filter((ref) => !before.selected_workflows.includes(ref))
const expected = { ...before, selected_workflows: [...before.selected_workflows, ...refs] }
if (!isDeepStrictEqual(policy(api(endpoint)), policy(before))) refuse('runner-group policy changed during the checks; nothing tagged')
// The API has no conditional PATCH: the organization owner serializes policy writes.
if (refs.length > 0) api(endpoint, { selected_workflows: expected.selected_workflows })
if (!isDeepStrictEqual(policy(api(endpoint)), policy(expected))) refuse('runner-group admission readback differs; nothing tagged')
console.log(`qualifier admitted at refs/tags/${tag} and ${commit} in ${before.name}`)
git('tag', '--annotate', tag, '--message', tag, commit)
git('-c', 'credential.helper=', '-c', 'credential.helper=!gh-drew auth git-credential', 'push', '--quiet', 'origin', `refs/tags/${tag}`)
if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}^{}`) !== `${commit}\trefs/tags/${tag}^{}`)
  refuse(`${tag} on origin does not match ${commit}; reconcile the tag with the release owner`)
console.log(`tagged ${tag} at ${commit}`)
