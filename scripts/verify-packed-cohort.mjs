#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  assertPublishableDependencySpecs,
  createStrictNodeConsumerTsconfig,
  requiredPackedDevelopmentDependency,
} from './lib/packed-package-test.mjs'

const PACKAGE_NAMES = [
  '@tangle-network/agent-eval',
  '@tangle-network/agent-knowledge',
  '@tangle-network/agent-runtime',
]
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()
const { values } = parseArgs({
  args,
  options: {
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
  '@tangle-network/agent-eval': resolve(
    values['agent-eval-repo'] ?? join(repoRoot, '..', 'agent-eval'),
  ),
  '@tangle-network/agent-knowledge': resolve(
    values['agent-knowledge-repo'] ?? join(repoRoot, '..', 'agent-knowledge'),
  ),
  '@tangle-network/agent-runtime': resolve(values['agent-runtime-repo'] ?? repoRoot),
}
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-package-cohort-'))
const artifactsDir = join(tempRoot, 'artifacts')
const packageManagerBin = join(tempRoot, 'bin')
mkdirSync(artifactsDir, { recursive: true })
mkdirSync(packageManagerBin, { recursive: true })

try {
  captured(
    'corepack',
    ['enable', '--install-directory', packageManagerBin, 'pnpm'],
    repoRoot,
  )
  const artifacts = []
  const artifactsByIdentity = new Map()

  const agentEval = buildAndPack({
    packageName: PACKAGE_NAMES[0],
    sourceRepo: sourceRepos[PACKAGE_NAMES[0]],
    localPackages: [],
  })
  registerArtifact(agentEval)
  artifacts.push(agentEval)

  const agentKnowledge = buildAndPack({
    packageName: PACKAGE_NAMES[1],
    sourceRepo: sourceRepos[PACKAGE_NAMES[1]],
    localPackages: [agentEval],
  })
  registerArtifact(agentKnowledge)
  artifacts.push(agentKnowledge)

  const agentRuntime = buildAndPack({
    packageName: PACKAGE_NAMES[2],
    sourceRepo: sourceRepos[PACKAGE_NAMES[2]],
    localPackages: [agentEval, agentKnowledge],
  })
  registerArtifact(agentRuntime)
  artifacts.push(agentRuntime)

  assertCohortPackageContracts({ agentEval, agentKnowledge, agentRuntime })
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

function buildAndPack({ packageName, sourceRepo, localPackages }) {
  assertCleanGitCheckout(sourceRepo, packageName)
  const sourceCommit = captured('git', ['rev-parse', 'HEAD'], sourceRepo).trim()
  const buildDir = join(tempRoot, 'build', packageName.replace('@tangle-network/', ''))
  mkdirSync(buildDir, { recursive: true })
  const sourceArchive = join(tempRoot, `${packageName.replace('@tangle-network/', '')}.tar`)
  captured('git', ['archive', '--format=tar', '--output', sourceArchive, sourceCommit], sourceRepo)
  captured('tar', ['-xf', sourceArchive, '-C', buildDir], sourceRepo)

  const packagePath = join(buildDir, 'package.json')
  const originalPackageText = readFileSync(packagePath, 'utf8')
  const packageJson = JSON.parse(originalPackageText)
  if (packageJson.name !== packageName) {
    throw new Error(`${sourceRepo} contains ${packageJson.name}, expected ${packageName}`)
  }

  if (localPackages.length > 0) {
    const overrides = {
      ...(packageJson.pnpm?.overrides ?? {}),
      ...Object.fromEntries(
        localPackages.map((artifact) => [artifact.name, `file:${artifact.path}`]),
      ),
    }
    packageJson.pnpm = { ...(packageJson.pnpm ?? {}), overrides }
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    captured(
      'corepack',
      [
        'pnpm',
        'config',
        'set',
        '--location=project',
        '--json',
        'overrides',
        JSON.stringify(overrides),
      ],
      buildDir,
    )
  }

  captured('corepack', ['pnpm', 'install', '--no-frozen-lockfile'], buildDir, {
    HUSKY: '0',
  })
  assertArchiveDependencies(buildDir, localPackages, `${packageName} build`)
  captured('corepack', ['pnpm', 'run', 'build'], buildDir)

  writeFileSync(packagePath, originalPackageText)
  const before = new Set(readdirSync(artifactsDir))
  if (originalPackageText.includes('catalog:')) {
    captured(
      'corepack',
      ['pnpm', 'pack', '--pack-destination', artifactsDir],
      buildDir,
      { npm_config_ignore_scripts: 'true' },
    )
  } else {
    captured(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', artifactsDir],
      buildDir,
    )
  }
  const created = readdirSync(artifactsDir).filter(
    (name) => name.endsWith('.tgz') && !before.has(name),
  )
  if (created.length !== 1) {
    throw new Error(`${packageName} produced ${created.length} archives, expected exactly one`)
  }

  const archivePath = join(artifactsDir, created[0])
  const extractedDir = join(tempRoot, 'extracted', packageName.replace('@tangle-network/', ''))
  mkdirSync(extractedDir, { recursive: true })
  captured('tar', ['-xzf', archivePath, '-C', extractedDir], buildDir)
  const extractedPackageDir = join(extractedDir, 'package')
  const packedPackageJson = JSON.parse(
    readFileSync(join(extractedPackageDir, 'package.json'), 'utf8'),
  )
  if (packedPackageJson.name !== packageName || packedPackageJson.version !== packageJson.version) {
    throw new Error(
      `${packageName} archive identity changed: ${packedPackageJson.name}@${packedPackageJson.version}`,
    )
  }
  assertPublishableDependencySpecs(packedPackageJson)

  return {
    name: packageName,
    version: packedPackageJson.version,
    sourceCommit,
    sha256: sha256File(archivePath),
    path: archivePath,
    extractedPackageDir,
    packageJson: packedPackageJson,
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
  const typescriptVersion = requiredPackedDevelopmentDependency(
    runtime.packageJson,
    'typescript',
  )
  const nodeTypesVersion = requiredPackedDevelopmentDependency(
    runtime.packageJson,
    '@types/node',
  )
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
  const resolved = collectTargetDependencies(dependencyTree)
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
  const proposalOutput = captured(process.execPath, ['dist/consumer.js'], appDir)
    .trim()
    .split('\n')
  const proposalReport = proposalOutput.find((line) =>
    line.startsWith('PACKED_COHORT_PROPOSAL='),
  )
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

function assertArchiveDependencies(directory, artifacts, context) {
  if (artifacts.length === 0) return
  const dependencyTree = JSON.parse(
    captured('corepack', ['pnpm', 'list', '--json', '--depth', 'Infinity'], directory),
  )
  const resolved = collectTargetDependencies(dependencyTree)
  for (const artifact of artifacts) {
    const occurrences = resolved.get(artifact.name) ?? []
    if (occurrences.length === 0) {
      throw new Error(`${context} did not resolve ${artifact.name}`)
    }
    for (const occurrence of occurrences) {
      assertArchiveResolution(artifact, occurrence, context)
    }
  }
}

function assertArchiveResolution(artifact, occurrence, context) {
  if (occurrence.version !== artifact.version) {
    throw new Error(
      `${context} resolved ${artifact.name}@${occurrence.version}, expected ${artifact.version}`,
    )
  }
  if (
    typeof occurrence.resolved !== 'string' ||
    occurrence.resolved.startsWith('http:') ||
    occurrence.resolved.startsWith('https:') ||
    !occurrence.resolved.includes(basename(artifact.path))
  ) {
    throw new Error(
      `${context} did not resolve ${artifact.name}@${artifact.version} from ${basename(artifact.path)}: ${String(occurrence.resolved)}`,
    )
  }
}

function collectTargetDependencies(dependencyTree) {
  const targets = new Map(PACKAGE_NAMES.map((name) => [name, []]))
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, dependency] of Object.entries(node[section] ?? {})) {
        if (targets.has(name)) targets.get(name).push(dependency)
        visit(dependency)
      }
    }
  }
  for (const root of dependencyTree) visit(root)
  return targets
}

function assertSamePackageFiles(artifact, installedPath) {
  if (typeof installedPath !== 'string' || !existsSync(installedPath)) {
    throw new Error(`${artifact.name} has no installed package path: ${String(installedPath)}`)
  }
  const expected = packageFileManifest(artifact.extractedPackageDir)
  const actual = packageFileManifest(realpathSync(installedPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${artifact.name}@${artifact.version} installed files differ from archive ${artifact.sha256}`,
    )
  }
}

function packageFileManifest(root) {
  const entries = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      const relativePath = relative(root, path).split(sep).join('/')
      if (entry.isDirectory()) {
        visit(path)
      } else if (entry.isSymbolicLink()) {
        entries.push([relativePath, `link:${readlinkSync(path)}`])
      } else if (entry.isFile()) {
        entries.push([relativePath, sha256File(path)])
      } else {
        throw new Error(`unsupported package file at ${path}`)
      }
    }
  }
  visit(root)
  return entries.sort(([left], [right]) => left.localeCompare(right))
}

function assertCohortPackageContracts({ agentEval, agentKnowledge, agentRuntime }) {
  const knowledgeEval = agentKnowledge.packageJson.dependencies?.[agentEval.name]
  if (knowledgeEval !== agentEval.version) {
    throw new Error(
      `${agentKnowledge.name} requires ${agentEval.name}@${knowledgeEval}, packed ${agentEval.version}`,
    )
  }
  const runtimeKnowledge = agentRuntime.packageJson.dependencies?.[agentKnowledge.name]
  if (runtimeKnowledge !== agentKnowledge.version) {
    throw new Error(
      `${agentRuntime.name} requires ${agentKnowledge.name}@${runtimeKnowledge}, packed ${agentKnowledge.version}`,
    )
  }
  if (!agentRuntime.packageJson.peerDependencies?.[agentEval.name]) {
    throw new Error(`${agentRuntime.name} must declare ${agentEval.name} as a required peer`)
  }
  if (agentRuntime.packageJson.peerDependenciesMeta?.[agentEval.name]?.optional) {
    throw new Error(`${agentRuntime.name} cannot make ${agentEval.name} optional`)
  }
}

function assertCleanGitCheckout(sourceRepo, packageName) {
  if (!existsSync(join(sourceRepo, '.git'))) {
    throw new Error(`${packageName} source is not a Git checkout: ${sourceRepo}`)
  }
  const changes = captured(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=no'],
    sourceRepo,
  ).trim()
  if (changes) {
    throw new Error(`${packageName} source has tracked changes:\n${changes}`)
  }
}

function archiveFileSpec(from, archivePath) {
  const path = relative(from, archivePath).split(sep).join('/')
  return `file:${path.startsWith('.') ? path : `./${path}`}`
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function captured(command, args, cwd, extraEnv = {}) {
  return run(command, args, cwd, extraEnv, 'pipe')
}

function run(command, args, cwd, extraEnv, stdio) {
  const env = {
    ...process.env,
    PATH: `${packageManagerBin}${delimiter}${process.env.PATH ?? ''}`,
    ...extraEnv,
  }
  delete env.FORCE_COLOR
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio,
    timeout: 15 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `command failed: ${command} ${args.join(' ')}`,
        result.error?.message,
        typeof result.stdout === 'string' ? result.stdout.trim() : '',
        typeof result.stderr === 'string' ? result.stderr.trim() : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  return typeof result.stdout === 'string' ? result.stdout : ''
}
