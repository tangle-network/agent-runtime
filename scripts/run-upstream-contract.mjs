#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { readReleaseCohort } from './release-cohort.mjs'
import { UPSTREAM_CONTRACTS } from './lib/upstream-contract.mjs'
import { requiredPackedDevelopmentDependency, requiredPackedPeerCandidateVersion } from './lib/packed-package-test.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const runtimeName = '@tangle-network/agent-runtime'
const exactChecks = Object.keys(UPSTREAM_CONTRACTS)
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()
const { values } = parseArgs({
  args,
  options: {
    check: { type: 'string' },
    tarball: { type: 'string' },
    output: { type: 'string' },
    'release-tag': { type: 'string' },
    'tag-commit': { type: 'string' },
    'cohort-manifest': { type: 'string' },
    candidate: { type: 'boolean', default: false },
    'keep-temp': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
})

if (values.help) {
  process.stdout.write(
    [
      'Usage: node scripts/run-upstream-contract.mjs --check UP-02 --tarball <archive> --output <report>',
      'Default: require --release-tag and --tag-commit; exact released source/archive only.',
      '--candidate --check all: local pre-tag qualification; never emits release attestation.',
    ].join('\n'),
  )
  process.exit(0)
}

const check = values.check
if (!exactChecks.includes(check) && !(values.candidate && check === 'all')) {
  throw new Error(`--check must be one of ${exactChecks.join(', ')}`)
}
if (!values.tarball) throw new Error('--tarball is required')
if (!values.output) throw new Error('--output is required')
const archive = resolve(values.tarball)
const output = resolve(values.output)
const releaseTag = values['release-tag']
const tagCommit = values['tag-commit']
if (!existsSync(archive) || !statSync(archive).isFile()) throw new Error(`archive is not a file: ${archive}`)
const archiveSha256 = sha256File(archive)
const archivedPackage = JSON.parse(run('tar', ['-xOzf', archive, 'package/package.json']))
if (archivedPackage.name !== runtimeName) {
  throw new Error(`archive contains ${archivedPackage.name}, expected ${runtimeName}`)
}
const head = run('git', ['rev-parse', 'HEAD'], repoRoot).trim()
if (values.candidate) {
  if (releaseTag !== undefined || tagCommit !== undefined) throw new Error('candidate evidence cannot name a release tag or tag commit')
  if (archivedPackage.version !== sourcePackage.version) throw new Error('candidate archive/version mismatch')
} else {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(releaseTag ?? ''))
    throw new Error('release tag must name an existing v* version tag')
  if (!/^[a-f0-9]{40}$/u.test(tagCommit ?? '')) throw new Error('tag commit must be a full commit SHA')
  if (archivedPackage.version !== releaseTag.slice(1)) throw new Error('release tag/archive version mismatch')
  if (head !== tagCommit) throw new Error(`checkout ${head} does not match tag commit ${tagCommit}`)
  const tagTarget = run('git', ['rev-parse', `${releaseTag}^{}`], repoRoot).trim()
  if (tagTarget !== tagCommit) throw new Error(`${releaseTag} resolves to ${tagTarget}, not ${tagCommit}`)
}
const sandboxName = '@tangle-network/sandbox'
const sandboxVersion = requiredPackedPeerCandidateVersion(archivedPackage, sandboxName, {
  name: sandboxName, version: requiredPackedDevelopmentDependency(archivedPackage, sandboxName),
})

const cohort = readReleaseCohort(values['cohort-manifest'])
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-runtime-upstream-contract-'))
const consumer = join(tempRoot, 'consumer')
mkdirSync(join(consumer, 'lib'), { recursive: true })

try {
  writeConsumerFiles(consumer, archive, cohort)
  run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], consumer)
  run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], consumer)
  run('pnpm', ['peers', 'check'], consumer)
  const installed = readInstalledPackages(consumer, [
    runtimeName,
    cohort.packages.agentInterface.name,
    cohort.packages.agentEval.name,
    cohort.packages.agentKnowledge.name,
    sandboxName,
  ])
  assertInstalledCohort(installed, archivedPackage, cohort)
  const dependencyResolution = inspectDependencyResolution(
    consumer,
    Object.keys(installed),
    archive,
    installed,
  )
  const contract = check === 'all'
    ? Object.fromEntries(exactChecks.map((name) => [name, runConsumer(name, consumer)]))
    : runConsumer(check, consumer)
  const result = {
    schema: `agent-runtime/upstream-contract-${values.candidate ? 'candidate' : 'attestation'}/v1`,
    requirement: check,
    package: {
      name: archivedPackage.name,
      version: archivedPackage.version,
      tarball: basename(archive),
      tarballSha256: archiveSha256,
      ...(values.candidate ? {} : { releaseTag }),
      sourceCommit: head,
    },
    cohort: Object.fromEntries(
      Object.values(cohort.packages).map((entry) => [
        entry.name,
        { version: entry.version, repository: entry.repository, sourceCommit: entry.ref },
      ]),
    ),
    consumer: {
      packageManager: run('pnpm', ['--version'], consumer).trim(),
      installRoot: 'clean-consumer-outside-runtime-repository',
      installed,
      dependencyResolution,
      strictPeerDependencies: true,
    },
    contract,
  }
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`Upstream ${values.candidate ? 'candidate' : 'contract'} ${check} passed for ${runtimeName}@${archivedPackage.version}.\n`)
  process.stdout.write(`Archive sha256: ${archiveSha256}\n`)
  process.stdout.write(`Evidence: ${output}\n`)
} finally {
  if (values['keep-temp']) process.stdout.write(`Consumer retained at ${consumer}\n`)
  else rmSync(tempRoot, { recursive: true, force: true })
}

function writeConsumerFiles(consumerRoot, archivePath, releaseCohort) {
  const exactCohortVersions = Object.fromEntries(
    Object.values(releaseCohort.packages).map((entry) => [entry.name, entry.version]),
  )
  const packageJson = {
    name: 'agent-runtime-upstream-contract-consumer',
    version: '1.0.0',
    private: true,
    type: 'module',
    packageManager: sourcePackage.packageManager,
    dependencies: {
      [runtimeName]: `file:${archivePath}`,
      [releaseCohort.packages.agentInterface.name]: releaseCohort.packages.agentInterface.version,
      [releaseCohort.packages.agentEval.name]: releaseCohort.packages.agentEval.version,
      [releaseCohort.packages.agentKnowledge.name]: releaseCohort.packages.agentKnowledge.version,
      [sandboxName]: sandboxVersion,
    },
  }
  writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  writeFileSync(
    join(consumerRoot, 'pnpm-workspace.yaml'),
    [
      'packages: []',
      'autoInstallPeers: false',
      'strictPeerDependencies: true',
      'overrides:',
      ...Object.entries(exactCohortVersions).map(([name, version]) => `  '${name}': '${version}'`),
      '',
    ].join('\n'),
  )
  copyFileSync(join(repoRoot, 'scripts', 'upstream-contract-consumer.mjs'), join(consumerRoot, 'consumer.mjs'))
  copyFileSync(join(repoRoot, 'scripts', 'lib', 'upstream-contract.mjs'), join(consumerRoot, 'lib', 'upstream-contract.mjs'))
  copyFileSync(
    join(repoRoot, 'scripts', 'lib', 'upstream-contract-provider.mjs'),
    join(consumerRoot, 'lib', 'upstream-contract-provider.mjs'),
  )
}

function runConsumer(check, consumerRoot) {
  const lines = run(process.execPath, ['consumer.mjs', check], consumerRoot,
    { ...process.env, FORCE_COLOR: '0' }).trim().split('\n').filter(Boolean)
  const json = lines.at(-1)
  if (!json) throw new Error(`packed contract ${check} produced no JSON result`)
  return JSON.parse(json)
}

function readInstalledPackages(consumerRoot, names) {
  const requireFromConsumer = createRequire(join(consumerRoot, 'consumer.mjs'))
  return Object.fromEntries(
    names.map((name) => {
      const entry = JSON.parse(readFileSync(packageJsonPath(requireFromConsumer, name), 'utf8'))
      return [name, { name: entry.name, version: entry.version }]
    }),
  )
}

function packageJsonPath(requireFromConsumer, name) {
  const entry = requireFromConsumer.resolve(name)
  let current = dirname(entry)
  for (;;) {
    const candidate = join(current, 'package.json')
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8'))
      if (parsed.name === name) return candidate
    }
    const parent = dirname(current)
    if (parent === current) throw new Error(`could not locate package.json for ${name}`)
    current = parent
  }
}

function assertInstalledCohort(installed, archivedPackage, releaseCohort) {
  if (installed[runtimeName]?.version !== archivedPackage.version) {
    throw new Error('consumer did not install the exact Runtime archive version')
  }
  for (const entry of Object.values(releaseCohort.packages)) {
    if (installed[entry.name]?.version !== entry.version) {
      throw new Error(`consumer installed the wrong ${entry.name} version`)
    }
  }
  if (installed[sandboxName]?.version !== sandboxVersion) {
    throw new Error('consumer installed the wrong @tangle-network/sandbox version')
  }
}

function inspectDependencyResolution(consumerRoot, names, archivePath, expectedPackages) {
  const dependencyTree = JSON.parse(
    run('pnpm', ['list', '--json', '--depth', 'Infinity'], consumerRoot),
  )
  const resolution = {}
  for (const name of names) {
    const occurrences = collectPackageOccurrences(dependencyTree, name)
    if (occurrences.length === 0) throw new Error(`consumer did not resolve ${name}`)
    const expectedVersion = expectedPackages[name].version
    const versions = new Set(occurrences.map((occurrence) => occurrence.version))
    if (versions.size !== 1 || !versions.has(expectedVersion)) {
      throw new Error(
        `consumer resolved ${name} versions ${[...versions].join(', ')}, expected ${expectedVersion}`,
      )
    }
    const physicalPaths = new Set(
      occurrences.map((occurrence) => {
        if (typeof occurrence.path !== 'string' || !existsSync(occurrence.path)) {
          throw new Error(`consumer has no installed path for ${name}`)
        }
        return realpathSync(occurrence.path)
      }),
    )
    if (physicalPaths.size !== 1) {
      throw new Error(`consumer installed ${physicalPaths.size} physical copies of ${name}`)
    }
    const sources = new Set(
      occurrences.map((occurrence) => resolutionSource(occurrence.resolved, archivePath)),
    )
    if (name === runtimeName && !sources.has('runtime-tarball')) {
      throw new Error(`consumer did not resolve ${name} from the exact Runtime tarball`)
    }
    if (name !== runtimeName && sources.has('runtime-tarball')) {
      throw new Error(`consumer resolved cohort package ${name} from the Runtime tarball`)
    }
    resolution[name] = {
      version: expectedVersion,
      occurrences: occurrences.length,
      physicalCopies: physicalPaths.size,
      sources: [...sources].sort(),
    }
  }
  return resolution
}

function collectPackageOccurrences(dependencyTree, packageName) {
  const occurrences = []
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, dependency] of Object.entries(node[section] ?? {})) {
        if (name === packageName) occurrences.push(dependency)
        visit(dependency)
      }
    }
  }
  for (const root of dependencyTree) visit(root)
  return occurrences
}

function resolutionSource(resolved, archivePath) {
  if (typeof resolved !== 'string') return 'unknown'
  if (resolved.includes(basename(archivePath))) return 'runtime-tarball'
  if (/^https?:\/\//u.test(resolved)) return 'registry'
  return 'other'
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function run(program, args, cwd, env = process.env) {
  const result = spawnSync(program, args, { cwd, env, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      [`${program} ${args.join(' ')} failed`, result.error?.message, result.stdout?.trim(), result.stderr?.trim()]
        .filter(Boolean)
        .join('\n'),
    )
  }
  return result.stdout
}
