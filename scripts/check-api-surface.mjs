#!/usr/bin/env node
/**
 * Record - and hold to - the symbols each published entry point exports, and
 * the shape of each one.
 *
 * Reads the BUILT declaration files, because those are what npm puts in the
 * tarball and what a consumer's compiler reads. Source is not consulted: a
 * symbol that source exports but the build drops is not on the surface, and the
 * defect being closed is about what a consumer can actually resolve.
 *
 * The shape is a digest over the declaration a consumer compiles against, taken
 * so that only a consumer-visible edit moves it:
 *
 *   - comments are removed, so a doc edit moves nothing;
 *   - whitespace is collapsed, so a formatting change moves nothing;
 *   - the declaration's own local name is blanked and every type reference is
 *     rewritten to a stable token, so the private names a bundler invents when
 *     two modules declare the same identifier move nothing;
 *   - a reference to a symbol this package exports contributes that symbol's
 *     PUBLIC NAME, so an edit is reported once, on the record line of the
 *     symbol that actually changed, and not on every symbol reaching it;
 *   - a reference to a symbol re-exported from a dependency contributes the
 *     dependency and the name, never that dependency's structure: it moves with
 *     the dependency range, which the manifest half of the check already gates;
 *   - a reference to a symbol this package declares but does not export
 *     contributes that declaration's own digest, because no record line would
 *     otherwise state that it moved.
 *
 * What this does NOT decide is whether a shape change is additive or breaking.
 * That is a subtyping question, and the record states structure. The comparison
 * calls every shape change breaking; see `surfaceSeverity` in
 * `lib/api-surface.mjs`.
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
 *   API_SURFACE_ROOT  repository to inspect (default: this repo)
 *
 * Default package directory is the repository root. `--write` regenerates the
 * records; without it the command compares and fails on any difference.
 */
import { createHash } from 'node:crypto'
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

const repoRoot = resolve(
  process.env.API_SURFACE_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'),
)

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

const DECLARATION_TYPES = new Set([
  'ClassDeclaration',
  'FunctionDeclaration',
  'TSDeclareFunction',
  'TSEnumDeclaration',
  'TSInterfaceDeclaration',
  'TSModuleDeclaration',
  'TSTypeAliasDeclaration',
  'VariableDeclaration',
])

const declaredNames = (node) => {
  const named = (identifier, context) => {
    // A destructuring pattern carries no single name. It cannot appear in a
    // declaration file, so reaching here means the parse is not what this
    // reader assumes — record nothing rather than a key of `undefined`.
    if (identifier?.type === 'Identifier') return identifier.name
    if (identifier?.type === 'Literal') return identifier.value
    throw new Error(`cannot read the exported name of a ${context} (${identifier?.type})`)
  }
  if (node.type === 'VariableDeclaration') {
    return node.declarations.map((declarator) => named(declarator.id, 'variable declarator'))
  }
  return [named(node.id, node.type)]
}

/** The name a specifier or module-export node states, written bare or quoted. */
const nameOf = (node) => (node.type === 'Identifier' ? node.name : node.value)

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
 * One declaration file, read once: the bindings it imports, the declarations it
 * states, and the names it exports. A name is followed through these three maps
 * until it reaches the declaration a consumer's compiler would land on.
 *
 * `declarations` holds a LIST per name, because an overloaded function is
 * several declarations under one name and all of them are the shape.
 */
const readModule = (file, modules) => {
  const memoized = modules.get(file)
  if (memoized !== undefined) return memoized
  const source = readFileSync(file, 'utf8')
  const parsed = parseSync(file, source, { lang: 'dts' })
  if (parsed.errors.length > 0) {
    throw new Error(`${file} failed to parse: ${parsed.errors[0].message}`)
  }
  const imports = new Map()
  const declarations = new Map()
  const exported = new Map()
  const starSources = []
  const declare = (node) => {
    for (const name of declaredNames(node)) {
      const list = declarations.get(name)
      if (list === undefined) declarations.set(name, [node])
      else list.push(node)
    }
  }
  for (const node of parsed.program.body) {
    if (DECLARATION_TYPES.has(node.type)) {
      declare(node)
      continue
    }
    switch (node.type) {
      case 'ImportDeclaration':
        for (const specifier of node.specifiers) {
          // A default or namespace import binds no single exported name, so it
          // cannot be followed to one declaration.
          if (specifier.type !== 'ImportSpecifier') continue
          imports.set(specifier.local.name, {
            source: node.source.value,
            name: nameOf(specifier.imported),
          })
        }
        break
      case 'ExportNamedDeclaration': {
        if (node.declaration) {
          declare(node.declaration)
          const kind = declarationKind(node.declaration)
          for (const name of declaredNames(node.declaration)) {
            exported.set(name, { local: name, kind, source: null })
          }
          break
        }
        for (const specifier of node.specifiers) {
          // `export type { A }` marks the statement; `export { type A }` marks
          // the specifier. Either one makes the name type-only.
          const typeOnly = node.exportKind === 'type' || specifier.exportKind === 'type'
          exported.set(nameOf(specifier.exported), {
            local: nameOf(specifier.local),
            kind: typeOnly ? 'type' : 'value',
            source: node.source?.value ?? null,
          })
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
        if (node.exported) {
          exported.set(nameOf(node.exported), {
            local: null,
            kind: 'value',
            source: specifier,
            namespace: true,
          })
          break
        }
        starSources.push({ source: specifier, typeOnly: node.exportKind === 'type' })
        break
      }
      case 'ExportDefaultDeclaration':
        exported.set('default', {
          local: node.declaration?.type === 'Identifier' ? node.declaration.name : null,
          kind: 'value',
          source: null,
          node: node.declaration,
        })
        break
      default:
        throw new Error(`${file} uses unhandled export form ${node.type}`)
    }
  }
  const module = {
    file,
    source,
    comments: parsed.comments,
    imports,
    declarations,
    exported,
    starSources,
  }
  modules.set(file, module)
  return module
}

/** Where a name in `file`'s scope was declared, or `null` when nothing states it. */
const resolveBinding = (file, name, ctx) => {
  const module = readModule(file, ctx.modules)
  if (module.declarations.has(name)) return { file, name }
  const imported = module.imports.get(name)
  if (imported === undefined) return null
  if (!imported.source.startsWith('.')) {
    return { external: imported.source, name: imported.name }
  }
  return resolveExport(resolveRelativeDeclaration(file, imported.source), imported.name, ctx)
}

/** Where the symbol `file` exports under `name` was declared. */
const resolveExport = (file, name, ctx, visiting = new Set()) => {
  const key = `${file} ${name}`
  if (visiting.has(key)) return null
  visiting.add(key)
  const module = readModule(file, ctx.modules)
  const record = module.exported.get(name)
  if (record !== undefined) {
    if (record.namespace) return { namespace: resolveRelativeDeclaration(file, record.source) }
    if (record.source !== null) {
      if (!record.source.startsWith('.')) return { external: record.source, name: record.local }
      const target = resolveRelativeDeclaration(file, record.source)
      return resolveExport(target, record.local, ctx, visiting)
    }
    if (record.local === null) return record.node ? { file, node: record.node } : null
    return resolveBinding(file, record.local, ctx)
  }
  for (const star of module.starSources) {
    const found = resolveExport(resolveRelativeDeclaration(file, star.source), name, ctx, visiting)
    if (found !== null) return found
  }
  return null
}

/**
 * Every symbol `file` exports, name to kind and to the declaration behind it.
 * Follows `export * from` into the chunk files the build splits declarations
 * across, because those re-exports are what a consumer's entry point actually
 * resolves through.
 */
const exportsOfFile = (file, ctx, visiting = new Set()) => {
  const memoized = ctx.exports.get(file)
  if (memoized !== undefined) return memoized
  if (visiting.has(file)) return new Map()
  visiting.add(file)
  const module = readModule(file, ctx.modules)
  const names = new Map()
  for (const star of module.starSources) {
    const target = resolveRelativeDeclaration(file, star.source)
    for (const [name, record] of exportsOfFile(target, ctx, visiting)) {
      names.set(name, { kind: star.typeOnly ? 'type' : record.kind, origin: record.origin })
    }
  }
  for (const [name, record] of module.exported) {
    names.set(name, { kind: record.kind, origin: resolveExport(file, name, ctx) })
  }
  visiting.delete(file)
  ctx.exports.set(file, names)
  return names
}

/** Every type this declaration names, as the identifier a reference resolves through. */
const typeReferences = (node) => {
  const found = []
  const leftmost = (name) => {
    let current = name
    while (current?.type === 'TSQualifiedName') current = current.left
    return current?.type === 'Identifier' ? current : null
  }
  const take = (identifier) => {
    if (identifier !== null) found.push(identifier)
  }
  const visit = (value) => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const element of value) visit(element)
      return
    }
    switch (value.type) {
      case 'TSTypeReference':
        take(leftmost(value.typeName))
        break
      case 'TSTypeQuery':
        take(leftmost(value.exprName))
        break
      case 'TSInterfaceHeritage':
      case 'TSClassImplements':
        take(leftmost(value.expression))
        break
      default:
        break
    }
    for (const key of Object.keys(value)) {
      if (key === 'type' || key === 'start' || key === 'end') continue
      visit(value[key])
    }
  }
  visit(node)
  return found
}

const originKey = (origin) => {
  if (origin === null) return null
  if (origin.external !== undefined) return `external ${origin.external} ${origin.name}`
  if (origin.namespace !== undefined) return `namespace ${origin.namespace}`
  return `${origin.file} ${origin.name ?? 'default'}`
}

const digestOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/**
 * The declaration as the shape comparison reads it: no comments, no private
 * naming, whitespace collapsed, and every type reference replaced by a token
 * that does not move when the bundler renames what it emits.
 */
const normalizedDeclaration = (module, node, selfName, ctx, inlining) => {
  const edits = []
  const blankSelf = (identifier) => {
    if (identifier?.type === 'Identifier' && identifier.name === selfName) {
      edits.push({ start: identifier.start, end: identifier.end, text: '#self' })
    }
  }
  if (node.type === 'VariableDeclaration') {
    for (const declarator of node.declarations) blankSelf(declarator.id)
  } else blankSelf(node.id)
  for (const comment of module.comments) {
    if (comment.start >= node.start && comment.end <= node.end) {
      edits.push({ start: comment.start, end: comment.end, text: ' ' })
    }
  }
  for (const reference of typeReferences(node)) {
    const token = referenceToken(module, reference.name, selfName, ctx, inlining)
    if (token === null) continue
    edits.push({ start: reference.start, end: reference.end, text: token })
  }
  edits.sort((left, right) => left.start - right.start)
  let text = ''
  let cursor = node.start
  for (const edit of edits) {
    if (edit.start < cursor) continue
    text += module.source.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  text += module.source.slice(cursor, node.end)
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * What one type reference contributes to the shape.
 *
 * A symbol the package exports contributes its PUBLIC NAME, so a change to it
 * is reported once, on its own record line, instead of on every symbol that can
 * reach it. A symbol re-exported from a dependency contributes that dependency
 * and name: its structure is owned there and moves with the dependency range,
 * which the manifest half of the check already gates. A symbol the package
 * declares without exporting contributes its own digest, because nothing else
 * would ever state that it moved. Anything else — a global, a lib type, a type
 * parameter — keeps the text it is written with.
 */
const referenceToken = (module, name, selfName, ctx, inlining) => {
  if (name === selfName) return '#self'
  const origin = resolveBinding(module.file, name, ctx)
  if (origin === null) return null
  if (origin.external !== undefined) return `#${origin.external}:${origin.name}`
  const published = ctx.publicNames.get(originKey(origin))
  if (published !== undefined) return `#${published}`
  const key = originKey(origin)
  if (inlining.has(key)) return '#recursive'
  return `#${shapeOfOrigin(origin, ctx, new Set([...inlining, key]))}`
}

/** The digest a surface record states for one exported symbol. */
const shapeOfOrigin = (origin, ctx, inlining = new Set()) => {
  if (origin === null) {
    throw new Error('an export resolved to no declaration, so its shape cannot be stated')
  }
  if (origin.external !== undefined) return digestOf(`${origin.external}:${origin.name}`)
  if (origin.namespace !== undefined) {
    const members = exportsOfFile(origin.namespace, ctx)
    const lines = [...members]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, record]) => `${name} ${record.kind} ${shapeOfOrigin(record.origin, ctx)}`)
    return digestOf(lines.join('\n'))
  }
  const key = originKey(origin)
  const cached = inlining.size === 0 ? ctx.shapes.get(key) : undefined
  if (cached !== undefined) return cached
  const module = readModule(origin.file, ctx.modules)
  if (origin.node !== undefined) {
    return digestOf(normalizedDeclaration(module, origin.node, null, ctx, inlining))
  }
  const nodes = module.declarations.get(origin.name)
  if (nodes === undefined) {
    throw new Error(`${origin.file} states no declaration for "${origin.name}"`)
  }
  const digest = digestOf(
    nodes.map((node) => normalizedDeclaration(module, node, origin.name, ctx, inlining)).join('\n'),
  )
  if (inlining.size === 0) ctx.shapes.set(key, digest)
  return digest
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
  const ctx = { modules: new Map(), exports: new Map(), publicNames: new Map(), shapes: new Map() }
  // Every public name is read first, because a reference contributes the name a
  // consumer knows the symbol by, and that is only settled once every entry
  // point has been read.
  const perEntry = entries.map((entry) => [entry.subpath, exportsOfFile(entry.file, ctx)])
  for (const [, names] of perEntry) {
    for (const [name, record] of names) {
      const key = originKey(record.origin)
      if (key === null) continue
      const held = ctx.publicNames.get(key)
      // A symbol exported under several names is known by the first in sorted
      // order, so a token never depends on which entry point was read first.
      if (held === undefined || name < held) ctx.publicNames.set(key, name)
    }
  }
  const recorded = {}
  for (const [subpath, names] of perEntry) {
    const stated = {}
    for (const [name, record] of names) {
      stated[name] = `${record.kind} ${shapeOfOrigin(record.origin, ctx)}`
    }
    recorded[subpath] = stated
  }
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
      ['shape changed', changes.changed],
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
