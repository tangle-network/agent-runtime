import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'

export function assertArchiveDependencies({ directory, artifacts, context, captured }) {
  if (artifacts.length === 0) return
  const dependencyTree = JSON.parse(
    captured('corepack', ['pnpm', 'list', '--json', '--depth', 'Infinity'], directory),
  )
  const resolved = collectTargetDependencies(
    dependencyTree,
    artifacts.map(({ name }) => name),
  )
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

export function assertArchiveResolution(artifact, occurrence, context) {
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

export function collectTargetDependencies(dependencyTree, packageNames) {
  const targets = new Map(packageNames.map((name) => [name, []]))
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

export function assertSamePackageFiles(artifact, installedPath) {
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

export function archiveFileSpec(from, archivePath) {
  const path = relative(from, archivePath).split(sep).join('/')
  return `file:${path.startsWith('.') ? path : `./${path}`}`
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
