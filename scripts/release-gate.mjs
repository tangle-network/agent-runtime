#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = 'tangle-network/agent-runtime'
const repoUrl = `https://github.com/${repository}.git`
const context = 'gate/release-check'
const gateId = 'beelink[12]-[a-f0-9]{32}'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const description = (tree, gate) => `release-check-v1 tree=${tree} gate=${gate}`

// Only the maintained gate reads receipts; callers cannot supply a receipt file or status payload.
export function attestReleaseGate(commit, gated) {
  if (git('rev-parse', `${commit}^{tree}`) !== git('rev-parse', `${gated}^{tree}`))
    throw new Error('tagged and gated trees differ; qualify the merged tree before transferring proof')
  const lookup = spawnSync('beelink-gate', ['--receipt', repoUrl, gated], { encoding: 'utf8', timeout: 120_000 })
  if (lookup.status !== 0 || lookup.stderr.trim()) throw new Error('cannot read complete authoritative gate receipt history')
  const rows = lookup.stdout.trim().split('\n').filter(Boolean).map((row) => JSON.parse(row))
  const applicable = rows.filter((row) => row.repo === `github.com/${repository}` && row.sha === gated &&
    row.mode === 'install' && row.class === 'normal' && row.command === 'pnpm run release:check')
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const receipt = applicable[0]
  if (!receipt || receipt.exit !== 0 || receipt.timed_out !== false || receipt.watchdog !== false ||
    receipt.checkout !== 'detached' || typeof receipt.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.at) ||
    !Number.isFinite(Date.parse(receipt.at)) ||
    applicable.some((row) => row.at === receipt.at && row.gate_id !== receipt.gate_id) ||
    !/^beelink[12]$/.test(receipt.host ?? '') ||
    !new RegExp(`^${receipt.host}-[a-f0-9]{32}$`).test(receipt.gate_id ?? '')) throw new Error('no successful detached normal/install release:check receipt for the gated commit')
  const tree = git('rev-parse', `${commit}^{tree}`)
  for (const sha of new Set([gated, commit])) {
    const status = JSON.parse(execFileSync('gh-drew', ['api', `repos/${repository}/statuses/${sha}`, '--method', 'POST',
      '-f', 'state=success', '-f', `context=${context}`, '-f', `description=${description(tree, receipt.gate_id)}`,
      '-f', `target_url=https://github.com/${repository}/commit/${gated}`], { encoding: 'utf8' }))
    if (status.creator?.login !== 'drewstone' || status.state !== 'success' || status.context !== context)
      throw new Error('release proof was not issued by the trusted release identity')
  }
  console.log(`release:check receipt ${receipt.gate_id} bound to ${commit} tree ${tree}`)
}

export async function hasReleaseGate() {
  const sha = git('rev-parse', 'HEAD')
  const tree = git('rev-parse', 'HEAD^{tree}')
  // GitHub orders newest first. A later failure/pending status revokes an older success.
  for (let page = 1; ; page += 1) {
    const response = await fetch(`https://api.github.com/repos/${repository}/commits/${sha}/statuses?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN ?? ''}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`cannot read release proof: GitHub HTTP ${response.status}`)
    const statuses = await response.json()
    const status = statuses.find((entry) => entry.context === context)
    if (status) return status.state === 'success' && status.creator?.login === 'drewstone' &&
      new RegExp(`^release-check-v1 tree=${tree} gate=${gateId}$`).test(status.description ?? '') &&
      new RegExp(`^https://github.com/${repository}/commit/[a-f0-9]{40}$`).test(status.target_url ?? '')
    if (statuses.length < 100) return false
    if (page >= 10) throw new Error('release proof status history exceeded bounded lookup')
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  if (process.argv.length !== 4 || process.argv[2] !== '--github-output') throw new Error('expected --github-output <path>')
  const qualified = await hasReleaseGate()
  appendFileSync(process.argv[3], `qualified=${qualified}\n`)
  console.log(qualified ? 'Reusing trusted release:check for the exact tagged tree; no source suite runs.' :
    'No trusted tree-equal release:check proof; full qualification is required.')
}
