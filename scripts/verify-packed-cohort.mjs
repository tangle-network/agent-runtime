#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  archiveFileSpec,
  assertArchiveResolution,
  assertSamePackageFiles,
  collectTargetDependencies,
} from './lib/packed-cohort-archive.mjs'
import { buildAndPack } from './lib/packed-cohort-build.mjs'
import { assertCohortPackageContracts } from './lib/packed-cohort-metadata.mjs'
import { createCommandRunner, primaryCheckoutFor } from './lib/packed-cohort-process.mjs'
import {
  createStrictNodeConsumerTsconfig,
  requiredPackedDevelopmentDependency,
} from './lib/packed-package-test.mjs'

const PACKAGES = {
  agentInterface: '@tangle-network/agent-interface',
  agentEval: '@tangle-network/agent-eval',
  agentKnowledge: '@tangle-network/agent-knowledge',
  agentRuntime: '@tangle-network/agent-runtime',
}
const PACKAGE_NAMES = Object.values(PACKAGES)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const primaryCheckout = primaryCheckoutFor(repoRoot)
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()
const { values } = parseArgs({
  args,
  options: {
    'agent-interface-repo': { type: 'string' },
    'agent-eval-repo': { type: 'string' },
    'agent-knowledge-repo': { type: 'string' },
    'agent-runtime-repo': { type: 'string' },
    'keep-temp': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
})

if (values.help) {
  process.stdout.write(
    [
      'Usage: pnpm run verify:cohort -- [options]',
      '',
      'Options:',
      '  --agent-interface-repo <path>  Clean agent-sdk Git checkout',
      '  --agent-eval-repo <path>       Clean agent-eval Git checkout',
      '  --agent-knowledge-repo <path>  Clean agent-knowledge Git checkout',
      '  --agent-runtime-repo <path>    Clean agent-runtime Git checkout',
      '  --keep-temp                    Retain the generated archives and consumer',
      '',
      'Repository paths default to sibling checkouts next to agent-runtime.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const sourceRepos = {
  [PACKAGES.agentInterface]: resolve(
    values['agent-interface-repo'] ?? join(dirname(primaryCheckout), 'agent-sdk'),
  ),
  [PACKAGES.agentEval]: resolve(
    values['agent-eval-repo'] ?? join(dirname(primaryCheckout), 'agent-eval'),
  ),
  [PACKAGES.agentKnowledge]: resolve(
    values['agent-knowledge-repo'] ?? join(dirname(primaryCheckout), 'agent-knowledge'),
  ),
  [PACKAGES.agentRuntime]: resolve(values['agent-runtime-repo'] ?? repoRoot),
}
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-package-cohort-'))
const artifactsDir = join(tempRoot, 'artifacts')
const packageManagerBin = join(tempRoot, 'bin')
mkdirSync(artifactsDir, { recursive: true })
mkdirSync(packageManagerBin, { recursive: true })
const { captured } = createCommandRunner(packageManagerBin)

try {
  captured('corepack', ['enable', '--install-directory', packageManagerBin, 'pnpm'], repoRoot)
  const artifacts = []
  const artifactsByIdentity = new Map()

  const agentInterface = buildAndPack({
    packageName: PACKAGES.agentInterface,
    sourceRepo: sourceRepos[PACKAGES.agentInterface],
    packageDirectory: 'packages/agent-interface',
    localPackages: [],
    tempRoot,
    artifactsDir,
    captured,
  })
  registerArtifact(agentInterface)
  artifacts.push(agentInterface)

  const agentEval = buildAndPack({
    packageName: PACKAGES.agentEval,
    sourceRepo: sourceRepos[PACKAGES.agentEval],
    localPackages: [agentInterface],
    tempRoot,
    artifactsDir,
    captured,
  })
  registerArtifact(agentEval)
  artifacts.push(agentEval)

  const agentKnowledge = buildAndPack({
    packageName: PACKAGES.agentKnowledge,
    sourceRepo: sourceRepos[PACKAGES.agentKnowledge],
    localPackages: [agentInterface, agentEval],
    tempRoot,
    artifactsDir,
    captured,
  })
  registerArtifact(agentKnowledge)
  artifacts.push(agentKnowledge)

  const agentRuntime = buildAndPack({
    packageName: PACKAGES.agentRuntime,
    sourceRepo: sourceRepos[PACKAGES.agentRuntime],
    localPackages: [agentInterface, agentEval, agentKnowledge],
    tempRoot,
    artifactsDir,
    captured,
  })
  registerArtifact(agentRuntime)
  artifacts.push(agentRuntime)

  assertCohortPackageContracts({
    agentInterface,
    agentEval,
    agentKnowledge,
    agentRuntime,
  })
  const consumer = verifyConsumer(artifacts)

  process.stdout.write('Packed package cohort verified.\n')
  for (const artifact of artifacts) {
    process.stdout.write(
      `${artifact.name}@${artifact.version} commit=${artifact.sourceCommit} sha256=${artifact.sha256} archive=${basename(artifact.path)}\n`,
    )
  }
  process.stdout.write(
    `${JSON.stringify({
      packages: artifacts.map(({ name, version, sourceCommit, sha256 }) => ({
        name,
        version,
        sourceCommit,
        sha256,
      })),
      consumer,
    })}\n`,
  )

  function registerArtifact(artifact) {
    const identity = `${artifact.name}@${artifact.version}`
    const existing = artifactsByIdentity.get(identity)
    if (existing && existing.sha256 !== artifact.sha256) {
      throw new Error(
        `${identity} was packed with two byte-distinct archives: ${existing.sha256} and ${artifact.sha256}`,
      )
    }
    artifactsByIdentity.set(identity, artifact)
  }
} finally {
  if (values['keep-temp']) {
    process.stdout.write(`Packed cohort files retained at ${tempRoot}\n`)
  } else {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

function verifyConsumer(artifacts) {
  const appDir = join(tempRoot, 'consumer')
  mkdirSync(appDir, { recursive: true })
  const byName = new Map(artifacts.map((artifact) => [artifact.name, artifact]))
  const runtime = byName.get('@tangle-network/agent-runtime')
  if (!runtime) throw new Error('Runtime artifact is missing')

  const fileSpecs = Object.fromEntries(
    artifacts.map((artifact) => [artifact.name, archiveFileSpec(appDir, artifact.path)]),
  )
  const runtimePeers = Object.fromEntries(
    Object.entries(runtime.packageJson.peerDependencies ?? {}).filter(
      ([name]) => !byName.has(name),
    ),
  )
  const typescriptVersion = requiredPackedDevelopmentDependency(runtime.packageJson, 'typescript')
  const nodeTypesVersion = requiredPackedDevelopmentDependency(runtime.packageJson, '@types/node')
  writeFileSync(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'packed-agent-cohort-consumer',
        private: true,
        type: 'module',
        packageManager: runtime.packageJson.packageManager,
        dependencies: {
          ...fileSpecs,
          ...runtimePeers,
        },
        devDependencies: {
          '@types/node': nodeTypesVersion,
          typescript: typescriptVersion,
        },
      },
      null,
      2,
    )}\n`,
  )
  captured(
    'corepack',
    [
      'pnpm',
      'config',
      'set',
      '--location=project',
      '--json',
      'overrides',
      JSON.stringify(fileSpecs),
    ],
    appDir,
  )
  writeFileSync(
    join(appDir, '.npmrc'),
    ['auto-install-peers=true', 'strict-peer-dependencies=true', ''].join('\n'),
  )
  writeFileSync(
    join(appDir, 'tsconfig.json'),
    `${JSON.stringify(createStrictNodeConsumerTsconfig({ outputDirectory: 'dist' }), null, 2)}\n`,
  )
  copyFileSync(
    join(repoRoot, 'scripts', 'fixtures', 'packed-cohort-consumer.ts'),
    join(appDir, 'consumer.ts'),
  )

  captured('corepack', ['pnpm', 'install', '--lockfile-only', '--ignore-scripts'], appDir)
  rmSync(join(appDir, 'node_modules'), { recursive: true, force: true })
  captured('corepack', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'], appDir)

  const dependencyTree = JSON.parse(
    captured('corepack', ['pnpm', 'list', '--json', '--depth', 'Infinity'], appDir),
  )
  const resolved = collectTargetDependencies(dependencyTree, PACKAGE_NAMES)
  for (const artifact of artifacts) {
    const occurrences = resolved.get(artifact.name) ?? []
    if (occurrences.length === 0) {
      throw new Error(`consumer did not resolve ${artifact.name}`)
    }
    for (const occurrence of occurrences) {
      assertArchiveResolution(artifact, occurrence, 'consumer')
      assertSamePackageFiles(artifact, occurrence.path)
    }
    const directPackage = join(appDir, 'node_modules', ...artifact.name.split('/'))
    if (!existsSync(directPackage)) {
      throw new Error(`consumer has no direct installation for ${artifact.name}`)
    }
    assertSamePackageFiles(artifact, directPackage)
  }

  const publicImportCount = verifyPublicImports(appDir, artifacts)
  captured('corepack', ['pnpm', 'exec', 'tsc', '-p', 'tsconfig.json'], appDir)
  const proposalOutput = captured(process.execPath, ['dist/consumer.js'], appDir).trim().split('\n')
  const proposalReport = proposalOutput.find((line) => line.startsWith('PACKED_COHORT_PROPOSAL='))
  if (!proposalReport) {
    throw new Error(`packed proposal produced no report:\n${proposalOutput.join('\n')}`)
  }
  const proposal = JSON.parse(proposalReport.slice('PACKED_COHORT_PROPOSAL='.length))
  return {
    install: 'pnpm install --frozen-lockfile',
    packageCount: artifacts.length,
    publicImportCount,
    exactArchiveResolution: true,
    proposal,
  }
}

function verifyPublicImports(appDir, artifacts) {
  let imported = 0
  for (const artifact of artifacts) {
    for (const [subpath, target] of Object.entries(artifact.packageJson.exports ?? {})) {
      const importTarget =
        typeof target === 'string'
          ? target
          : target && typeof target === 'object'
            ? target.import
            : undefined
      if (typeof importTarget !== 'string') continue
      const specifier = subpath === '.' ? artifact.name : artifact.name + subpath.slice(1)
      captured(
        process.execPath,
        ['--input-type=module', '--eval', `await import(${JSON.stringify(specifier)})`],
        appDir,
      )
      imported += 1
    }
  }
  if (imported < artifacts.length) throw new Error(`only ${imported} public imports were exercised`)
  return imported
}
