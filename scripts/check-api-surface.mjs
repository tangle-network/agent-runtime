#!/usr/bin/env node
/**
 * Record — and hold to — the symbols each published entry point exports.
 *
 * Reads the BUILT declaration files, because those are what npm puts in the
 * tarball and what a consumer's compiler reads. Source is not consulted: a
 * symbol that source exports but the build drops is not on the surface, and the
 * defect being closed is about what a consumer can actually resolve.
 *
 * The parser is `oxc-parser`, not the TypeScript compiler API, and that is a
 * requirement rather than a preference. This repository set spans TypeScript 6
 * and TypeScript 7, and TypeScript 7 ships no JavaScript compiler API at all —
 * `ts.createProgram` is undefined there. A checker-based extractor would work
 * in one repository and have to be rewritten in the others, which is how three
 * copies of one rule end up with three different bugs. `oxc-parser` presents
 * the same API on every repository and parses the declaration dialect the
 * build already emits through the same parser family.
 *
 * Usage:
 *   node scripts/check-api-surface.mjs [--write] [packageDirectory...]
 *
 * Default package directory is the repository root. `--write` regenerates the
 * records; without it the command compares and fails on any difference.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'
import {
  compareSurfaces,
  formatSurface,
  relativeToRoot,
  resolveExportEntries,
  surfaceRecordPath,
} from './lib/api-surface.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const write = args.includes('--write')
const packageDirectories = args.filter((argument) => !argument.startsWith('--'))
if (packageDirectories.length === 0) packageDirectories.push('.')

/** Declaration kind of a top-level declaration node. */
const declarationKind = (node) => {
  switch (node.type) {
    case 'TSInterfaceDeclaration':
    case 'TSTypeAliasDeclaration':
      return 'type'
    case 'ClassDeclaration':
    case 'FunctionDeclaration':
    case 'TSDeclareFunction':
    case 'TSEnumDeclaration':
    case 'TSModuleDeclaration':
    case 'VariableDeclaration':
      return 'value'
    default:
      throw new Error(`unhandled exported declaration node ${node.type}`)
  }
}

const declaredNames = (node) => {
  if (node.type === 'VariableDeclaration') {
    return node.declarations.map((declarator) => declarator.id.name)
  }
  if (node.type === 'TSModuleDeclaration') {
    return [node.id.type === 'Identifier' ? node.id.name : node.id.value]
  }
  return [node.id.name]
}

/**
 * Resolve a relative specifier written with the runtime extension back to the
 * declaration file that states its types, the way a bundler-mode compiler does.
 */
const resolveRelativeDeclaration = (fromFile, specifier) => {
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [
    base.replace(/\.m?js$/, '.d.ts'),
    base.replace(/\.m?js$/, '.d.mts'),
    `${base}.d.ts`,
    base,
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`cannot resolve "${specifier}" from ${fromFile} to a declaration file`)
}

/**
 * Every symbol `file` exports, name to kind. Follows `export * from` into the
 * chunk files the build splits declarations across, because those re-exports
 * are what a consumer's entry point actually resolves through.
 */
const exportsOfFile = (file, seen = new Set()) => {
  if (seen.has(file)) return {}
  seen.add(file)
  const source = readFileSync(file, 'utf8')
  const parsed = parseSync(file, source, { lang: 'dts' })
  if (parsed.errors.length > 0) {
    throw new Error(`${file} failed to parse: ${parsed.errors[0].message}`)
  }
  const names = {}
  for (const node of parsed.program.body) {
    if (!node.type.startsWith('Export')) continue
    switch (node.type) {
      case 'ExportNamedDeclaration': {
        if (node.declaration) {
          const kind = declarationKind(node.declaration)
          for (const name of declaredNames(node.declaration)) names[name] = kind
          break
        }
        for (const specifier of node.specifiers) {
          const exported = specifier.exported
          const name = exported.type === 'Identifier' ? exported.name : exported.value
          // `export type { A }` marks the statement; `export { type A }` marks
          // the specifier. Either one makes the name type-only.
          names[name] = node.exportKind === 'type' || specifier.exportKind === 'type' ? 'type' : 'value'
        }
        break
      }
      case 'ExportAllDeclaration': {
        const specifier = node.source.value
        if (!specifier.startsWith('.')) {
          throw new Error(
            `${file} re-exports all of "${specifier}", which is outside this package. ` +
              'The surface record cannot state symbols it cannot read; ' +
              'name the re-exported symbols explicitly instead.',
          )
        }
        const target = resolveRelativeDeclaration(file, specifier)
        if (node.exported) {
          const name = node.exported.type === 'Identifier' ? node.exported.name : node.exported.value
          names[name] = 'value'
          break
        }
        for (const [name, kind] of Object.entries(exportsOfFile(target, seen))) {
          names[name] = node.exportKind === 'type' ? 'type' : kind
        }
        break
      }
      case 'ExportDefaultDeclaration':
        names.default = 'value'
        break
      default:
        throw new Error(`${file} uses unhandled export form ${node.type}`)
    }
  }
  return names
}

const surfaceOfPackage = (packageDirectory) => {
  const packageDir = resolve(repoRoot, packageDirectory)
  const manifestPath = resolve(packageDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const { entries, assets } = resolveExportEntries(manifest, packageDir)
  const missing = entries.filter((entry) => !existsSync(entry.file))
  if (missing.length > 0) {
    throw new Error(
      `${relativeToRoot(repoRoot, manifestPath)} declares entry points whose declarations are ` +
        `not built: ${missing.map((entry) => entry.subpath).join(', ')}. Build the package first.`,
    )
  }
  const recorded = {}
  for (const entry of entries) recorded[entry.subpath] = exportsOfFile(entry.file)
  return { package: manifest.name, entries: recorded, assets }
}

const failures = []
const reports = []

for (const packageDirectory of packageDirectories) {
  const recordPath = resolve(repoRoot, surfaceRecordPath(packageDirectory.replace(/^\.\/?/, '')))
  const surface = surfaceOfPackage(packageDirectory)
  const generated = formatSurface(surface)
  const total = Object.values(surface.entries).reduce(
    (sum, names) => sum + Object.keys(names).length,
    0,
  )
  const displayPath = relativeToRoot(repoRoot, recordPath)
  if (write) {
    writeFileSync(recordPath, generated)
    reports.push(`${displayPath}: wrote ${total} exports across ${Object.keys(surface.entries).length} entry points`)
    continue
  }
  const committed = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : null
  if (committed === null) {
    failures.push(
      `${displayPath} does not exist. Every publishable package records its export surface ` +
        'so a change to it can be required to carry a version bump.',
    )
    continue
  }
  if (committed !== generated) {
    const changes = compareSurfaces(JSON.parse(committed), surface)
    const lines = [`${displayPath} does not match the built declarations.`]
    for (const [label, list] of [
      ['not recorded (present in the build)', changes.added],
      ['recorded but gone from the build', changes.removed],
      ['kind narrowed', changes.narrowed],
      ['kind changed', changes.widened],
    ]) {
      for (const change of list.slice(0, 20)) lines.push(`  ${label}: ${change}`)
      if (list.length > 20) lines.push(`  ${label}: ...and ${list.length - 20} more`)
    }
    failures.push(lines.join('\n'))
    continue
  }
  reports.push(`${displayPath}: ${total} exports across ${Object.keys(surface.entries).length} entry points, record current`)
}

if (failures.length > 0) {
  process.stderr.write(
    `${[
      'The export surface record is out of date.',
      '',
      ...failures,
      '',
      'Regenerate it in the same change:',
      `  pnpm run build && pnpm run api:surface`,
      '',
      'The record is what check:version-bump compares against the merge base, so a stale',
      'record lets a new export ship under a version the registry already holds.',
    ].join('\n')}\n`,
  )
  process.exit(1)
}

process.stdout.write(`${reports.join('\n')}\n`)
