#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
      const match = /^type:\s*(patch|minor|major)\s*\n---\s*\n([\s\\S]+?)\s*$/u.exec(raw)
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

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
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
  const releaseOnly = changed.length > 0 && changed.every((path) =>
    path === 'package.json' ||
    path === 'CHANGELOG.md' ||
    path === 'api-surface.json' ||
    path === 'pnpm-lock.yaml' ||
    path === 'docs/canonical-api.md' ||
    path.startsWith('docs/api/') ||
    path.startsWith('src/testing/fixtures/') ||
    path.startsWith('.release-notes/')
  )
  if (consumerChange && !releaseOnly && notes.length === 0) {
    throw new Error('consumer-visible changes need one .release-notes/*.md entry; version and CHANGELOG move only in the release PR')
  }
  process.stdout.write(`release notes: ${notes.length} pending\n`)
}
