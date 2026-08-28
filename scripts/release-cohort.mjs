#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const packageKeys = ['agentInterface', 'agentEval', 'agentKnowledge']
const packageNames = {
  agentInterface: '@tangle-network/agent-interface',
  agentEval: '@tangle-network/agent-eval',
  agentKnowledge: '@tangle-network/agent-knowledge',
}

export const defaultReleaseCohortPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'release',
  'cohort.json',
)

export function readReleaseCohort(path = defaultReleaseCohortPath) {
  const value = JSON.parse(readFileSync(resolve(path), 'utf8'))
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.packages)) {
    throw new Error('release cohort must use schema version 1 and contain packages')
  }

  const keys = Object.keys(value.packages).sort()
  const expectedKeys = [...packageKeys].sort()
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`release cohort packages must be exactly ${expectedKeys.join(', ')}`)
  }

  const packages = {}
  for (const key of packageKeys) {
    const entry = value.packages[key]
    if (!isRecord(entry)) throw new Error(`release cohort ${key} must be an object`)
    if (entry.name !== packageNames[key]) {
      throw new Error(`release cohort ${key} must name ${packageNames[key]}`)
    }
    if (!/^tangle-network\/[a-z0-9-]+$/.test(entry.repository)) {
      throw new Error(`release cohort ${key} has an invalid repository`)
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(entry.version)) {
      throw new Error(`release cohort ${key} has an invalid version`)
    }
    if (!/^[a-f0-9]{40}$/.test(entry.ref)) {
      throw new Error(`release cohort ${key} must use a full commit ref`)
    }
    packages[key] = Object.freeze({
      name: entry.name,
      repository: entry.repository,
      version: entry.version,
      ref: entry.ref,
    })
  }

  return Object.freeze({ schemaVersion: 1, packages: Object.freeze(packages) })
}

export function releaseCohortOutputKey(key, field) {
  if (!packageKeys.includes(key)) throw new Error(`unknown release cohort key: ${key}`)
  if (field !== 'ref' && field !== 'version') {
    throw new Error(`unknown release cohort output field: ${field}`)
  }
  return `${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_${field}`
}

export function assertReleaseCohortArtifacts(artifacts, cohort) {
  const artifactsByName = new Map(artifacts.map((artifact) => [artifact.name, artifact]))
  for (const entry of Object.values(cohort.packages)) {
    const artifact = artifactsByName.get(entry.name)
    if (!artifact) throw new Error(`release cohort artifact is missing: ${entry.name}`)
    if (artifact.version !== entry.version) {
      throw new Error(
        `release cohort version mismatch for ${entry.name}: expected ${entry.version}, received ${artifact.version}`,
      )
    }
    if (artifact.sourceCommit !== entry.ref) {
      throw new Error(
        `release cohort commit mismatch for ${entry.name}: expected ${entry.ref}, received ${artifact.sourceCommit}`,
      )
    }
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args[0] === '--') args.shift()
  const { values } = parseArgs({
    args,
    options: {
      manifest: { type: 'string' },
      'github-output': { type: 'string' },
    },
    strict: true,
  })
  const cohort = readReleaseCohort(values.manifest)
  if (values['github-output']) {
    const lines = packageKeys.flatMap((key) => [
      `${releaseCohortOutputKey(key, 'ref')}=${cohort.packages[key].ref}`,
      `${releaseCohortOutputKey(key, 'version')}=${cohort.packages[key].version}`,
    ])
    appendFileSync(resolve(values['github-output']), `${lines.join('\n')}\n`)
  } else {
    process.stdout.write(`${JSON.stringify(cohort, null, 2)}\n`)
  }
}
