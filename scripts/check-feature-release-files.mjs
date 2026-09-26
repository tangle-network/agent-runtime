#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const baseVersion = JSON.parse(git('show', `${base}:package.json`)).version
const headVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean)
const forbidden = changed.filter((p) => p === 'CHANGELOG.md' || p.startsWith('.release-notes/'))
if (baseVersion !== headVersion || forbidden.length) {
  throw new Error(`feature PRs do not prepare releases; version ${baseVersion} -> ${headVersion}; release files: ${forbidden.join(', ') || 'none'}`)
}
console.log(`feature release files clean at ${headVersion}`)
