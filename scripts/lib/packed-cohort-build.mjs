import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { assertArchiveDependencies, sha256File } from './packed-cohort-archive.mjs'
import { assertCleanGitCheckout } from './packed-cohort-process.mjs'
import { assertPublishableDependencySpecs } from './packed-package-test.mjs'

export function buildAndPack({
  packageName,
  sourceRepo,
  packageDirectory = '.',
  localPackages = [],
  tempRoot,
  artifactsDir,
  captured,
}) {
  assertCleanGitCheckout(sourceRepo, packageName, captured)
  const sourceCommit = captured('git', ['rev-parse', 'HEAD'], sourceRepo).trim()
  const buildRoot = join(tempRoot, 'build', packageName.replace('@tangle-network/', ''))
  mkdirSync(buildRoot, { recursive: true })
  const sourceArchive = join(tempRoot, `${packageName.replace('@tangle-network/', '')}.tar`)
  captured('git', ['archive', '--format=tar', '--output', sourceArchive, sourceCommit], sourceRepo)
  captured('tar', ['-xf', sourceArchive, '-C', buildRoot], sourceRepo)

  const buildDir = resolve(buildRoot, packageDirectory)
  if (buildDir !== buildRoot && !buildDir.startsWith(`${buildRoot}${sep}`)) {
    throw new Error(`${packageName} package directory escapes its source archive`)
  }
  const packagePath = join(buildDir, 'package.json')
  if (!existsSync(packagePath)) {
    throw new Error(`${packageName} has no package.json at ${packageDirectory}`)
  }
  const packageText = readFileSync(packagePath, 'utf8')
  const packageJson = JSON.parse(packageText)
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
    const workspaceRoot = findPnpmWorkspaceRoot(buildDir, buildRoot)
    if (workspaceRoot) {
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
        workspaceRoot,
      )
    } else {
      packageJson.pnpm = { ...(packageJson.pnpm ?? {}), overrides }
      writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    }
  }

  captured('corepack', ['pnpm', 'install', '--no-frozen-lockfile', '--ignore-scripts'], buildDir, {
    HUSKY: '0',
  })
  assertArchiveDependencies({
    directory: buildDir,
    artifacts: localPackages,
    context: `${packageName} build`,
    captured,
  })
  captured('corepack', ['pnpm', 'run', 'build'], buildDir)

  writeFileSync(packagePath, packageText)
  const before = new Set(readdirSync(artifactsDir))
  if (packageText.includes('catalog:')) {
    captured('corepack', ['pnpm', 'pack', '--pack-destination', artifactsDir], buildDir, {
      npm_config_ignore_scripts: 'true',
    })
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

function findPnpmWorkspaceRoot(startDirectory, sourceRoot) {
  let directory = startDirectory
  while (true) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory
    if (directory === sourceRoot) return undefined
    directory = dirname(directory)
  }
}
