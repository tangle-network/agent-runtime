#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('usage: pnpm release:prepare <x.y.z>')

const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const pkgPath = resolve(root, 'package.json')
const raw = readFileSync(pkgPath, 'utf8')
const current = JSON.parse(raw).version
if (current === version) throw new Error(`package.json is already ${version}`)
writeFileSync(pkgPath, raw.replace(/^(\s*"version":\s*)"[^"]+"/m, (_m, p) => `${p}"${version}"`))

const tag = git('describe', '--tags', '--abbrev=0', '--match', 'v*')
const subjects = git('log', '--no-merges', '--format=%s', `${tag}..HEAD`).split('\n').filter(Boolean)
if (subjects.length === 0) throw new Error(`no commits since ${tag}`)
const changelogPath = resolve(root, 'CHANGELOG.md')
const changelog = readFileSync(changelogPath, 'utf8')
writeFileSync(changelogPath, `## ${version}\n\n${subjects.map((s) => `- ${s}`).join('\n')}\n\n${changelog}`)

const canonicalPath = resolve(root, 'docs/canonical-api.md')
const canonical = readFileSync(canonicalPath, 'utf8')
const nextCanonical = canonical.replace(/^> \*\*Version \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.\*\*$/m, `> **Version ${version}.**`)
if (nextCanonical === canonical) throw new Error('canonical API version banner not found')
writeFileSync(canonicalPath, nextCanonical)

const run = (script) => execFileSync('pnpm', ['run', script], { cwd: root, stdio: 'inherit' })
run('generate:testing-fixture')
run('docs:api')
run('api:surface')
console.log(`Prepared ${version} from commits since ${tag}`)
