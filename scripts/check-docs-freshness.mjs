#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function filesUnder(relative, predicate, output = []) {
  const absolute = join(root, relative)
  if (!existsSync(absolute)) return output
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'api') continue
    const child = join(relative, entry.name)
    if (entry.isDirectory()) filesUnder(child, predicate, output)
    else if (predicate(child)) output.push(child)
  }
  return output
}

const markdownFiles = [
  'README.md',
  'CLAUDE.md',
  ...filesUnder('docs', (file) => extname(file) === '.md'),
  ...filesUnder('examples', (file) => file.endsWith('README.md')),
  'bench/HARNESS.md',
  ...filesUnder('bench', (file) => file.endsWith('README.md')),
  ...filesUnder('skills', (file) => file.endsWith('.md')),
]

const retired = [
  ['runConversation', /\brunConversation\b/],
  ['runPersonaConversation', /\brunPersonaConversation\b/],
  ['runPersonaDispatch', /\brunPersonaDispatch\b/],
  ['runPersonified', /\brunPersonified\b/],
  ['runAgentic', /\brunAgentic\b/],
  ['runAgentTask', /\brunAgentTask(?:Stream)?\b/],
  ['AgentExecutionBackend', /\bAgentExecutionBackend\b/],
  ['createOpenAICompatibleBackend', /\bcreateOpenAICompatibleBackend\b/],
  ['AgentSurfaces', /\bAgentSurfaces\b/],
  ['conversation export', /@tangle-network\/agent-runtime\/conversation\b/],
  ['old stream event', /\bbackend_(?:start|error)\b/],
]

for (const file of markdownFiles) {
  const text = readFileSync(join(root, file), 'utf8')
  const lines = text.split('\n')

  if (text.includes('\u2014')) {
    failures.push(`${file}: contains an em dash`)
  }

  for (const [name, pattern] of retired) {
    for (let index = 0; index < lines.length; index++) {
      if (pattern.test(lines[index])) {
        failures.push(`${file}:${index + 1}: retired API ${name}`)
      }
      pattern.lastIndex = 0
    }
  }

  for (let index = 0; index < lines.length; index++) {
    for (const match of lines[index].matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim().replace(/^<|>$/g, '')
      if (!target || target.startsWith('#') || /^[a-z]+:/i.test(target)) continue
      target = decodeURIComponent(target.split('#')[0].split('?')[0])
      if (!target) continue
      const absolute = target.startsWith('/') ? target : resolve(root, dirname(file), target)
      if (!existsSync(absolute)) {
        failures.push(`${file}:${index + 1}: missing local link ${match[1]}`)
      }
    }
  }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const typedoc = JSON.parse(readFileSync(join(root, 'typedoc.json'), 'utf8'))
const entryPoints = new Set(typedoc.entryPoints ?? [])
const sourceOverrides = new Map([
  ['./loops', 'src/runtime/index.ts'],
  ['./environment-provider', 'src/runtime/environment-provider.ts'],
])

for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
  const configured = sourceOverrides.get(subpath)
  const distTarget = typeof target === 'string' ? target : target.import ?? target.types
  const base = distTarget
    ?.replace(/^\.\/dist\//, '')
    .replace(/\.d\.ts$/, '')
    .replace(/\.js$/, '')
  const candidates = configured
    ? [configured]
    : subpath === '.'
      ? ['src/index.ts']
      : [`src/${base}.ts`, `src/${base}/index.ts`, `src/${base?.replace(/\/index$/, '')}/index.ts`]
  const source = candidates.find((candidate) => existsSync(join(root, candidate)))
  if (!source) {
    failures.push(`package.json: export ${subpath} has no source file`)
  } else if (!entryPoints.has(source)) {
    failures.push(`typedoc.json: export ${subpath} is missing entry point ${source}`)
  }
}

for (const entryPoint of entryPoints) {
  if (!existsSync(join(root, entryPoint))) {
    failures.push(`typedoc.json: entry point does not exist: ${entryPoint}`)
  }
}

if (!existsSync(join(root, 'docs/api/primitive-catalog.md'))) {
  failures.push('docs/api/primitive-catalog.md is missing; run pnpm run docs:api')
}

if (failures.length > 0) {
  console.error(`docs check failed with ${failures.length} issue(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `docs check passed: ${markdownFiles.length} hand-written files and ${entryPoints.size} API entry points`,
)
