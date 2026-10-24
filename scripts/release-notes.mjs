#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const notesDir = resolve(root, '.release-notes')
const allowed = new Set(['patch', 'minor', 'major'])

export function readReleaseNotes() {
  if (!existsSync(notesDir)) return []
  return readdirSync(notesDir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => {
      const raw = readFileSync(resolve(notesDir, name), 'utf8')
      const match = /^type:\s*(patch|minor|major)\s*\n---\s*\n([\s\S]+?)\s*$/u.exec(raw)
      if (!match || !allowed.has(match[1])) {
        throw new Error(`.release-notes/${name} must be "type: patch|minor|major", then "---", then release prose`)
      }
      return { name, type: match[1], text: match[2].trim() }
    })
}

function git(args, allowFailure = false) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (allowFailure) return null
    throw error
  }
}

function baseRef() {
  const configured = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null
  for (const ref of [configured, 'origin/main', 'main'].filter(Boolean)) {
    const sha = git(['rev-parse', '--verify', `${ref}^{commit}`], true)
    if (sha) return sha.trim()
  }
  return null
}

/** Runtime's selected cohort owns its supported floors; the updater owns the upper bounds. */
function adoptionPeerFloors() {
  const path = resolve(root, 'package.json')
  const text = readFileSync(path, 'utf8')
  const pkg = JSON.parse(text)
  const cohort = JSON.parse(readFileSync(resolve(root, 'release/cohort.json'), 'utf8'))
  const peers = { ...pkg.peerDependencies }
  const order = new Intl.Collator('en', { numeric: true }).compare
  for (const key of ['agentEval', 'agentInterface']) {
    const selected = cohort.packages?.[key]
    const name = key === 'agentEval' ? '@tangle-network/agent-eval' : '@tangle-network/agent-interface'
    const version = pkg.devDependencies?.[name]
    const window = /^>=(\d+\.\d+\.\d+)\s+<(\d+\.\d+\.\d+)$/.exec(peers[name] ?? '')
    if (selected?.name !== name || selected.version !== version || !/^\d+\.\d+\.\d+$/.test(version ?? '') || !window) {
      throw new Error(`adoption requires matching exact development/cohort pins and a stable peer window for ${name}`)
    }
    if (order(version, window[1]) < 0 || order(version, window[2]) >= 0) {
      throw new Error(`adoption pin ${name}@${version} is outside its declared peer window ${peers[name]}`)
    }
    peers[name] = `>=${version} <${window[2]}`
  }
  if (JSON.stringify(peers) !== JSON.stringify(pkg.peerDependencies)) {
    pkg.peerDependencies = peers
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  '
    writeFileSync(path, `${JSON.stringify(pkg, null, indent)}\n`)
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  if (process.argv.includes('--adoption')) {
    adoptionPeerFloors()
    const { parse } = await import('yaml')
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const workspace = parse(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8'))
    // Release versions, scripts, formatting and unrelated workspace policy do not change
    // the adopted dependency selection. Canonical keys keep reordered inputs idempotent.
    const inputs = {
      dependencies: pkg.dependencies,
      devDependencies: pkg.devDependencies,
      optionalDependencies: pkg.optionalDependencies,
      peerDependencies: pkg.peerDependencies,
      catalog: workspace.catalog,
      catalogs: workspace.catalogs,
      overrides: workspace.overrides,
    }
    const selection = createHash('sha256').update(JSON.stringify(inputs, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value
    )).digest('hex').slice(0, 16)
    const file = resolve(notesDir, `adopt-stack-${selection}.md`)
    mkdirSync(notesDir, { recursive: true })
    writeFileSync(file, 'type: patch\n---\nAdopt updated Tangle dependency selections and peer ranges across the Runtime and benchmark workspaces.\n')
    process.stdout.write(`release notes: adopted selection recorded in ${file}\n`)
    process.exit(0)
  }
  const notes = readReleaseNotes()
  const base = baseRef()
  if (!base) {
    process.stdout.write(`release notes: ${notes.length} pending; no base ref available, skipped diff requirement\n`)
    process.exit(0)
  }
  const changed = git(['diff', '--name-only', `${base}...HEAD`]).trim().split('\n').filter(Boolean)
  const consumerChange = changed.some((path) =>
    path === 'package.json' ||
    path === 'pnpm-workspace.yaml' ||
    path.startsWith('src/')
  )
  // Count only notes this change adds or edits. A note another PR left pending on
  // main must not satisfy this gate, and a release PR deletes notes rather than
  // adding them (it is gated by check:version-bump instead).
  const ownNotes = git(['diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`, '--', '.release-notes/'])
    .trim().split('\n').filter((path) => path.endsWith('.md') && path !== '.release-notes/README.md')
  if (consumerChange && ownNotes.length === 0) {
    throw new Error('consumer-visible changes need one .release-notes/*.md entry; version and CHANGELOG move only in the release PR')
  }
  process.stdout.write(`release notes: ${notes.length} pending\n`)
}
