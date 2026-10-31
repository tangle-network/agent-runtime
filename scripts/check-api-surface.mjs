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
 *   - whitespace outside literals is collapsed, so a formatting change moves nothing;
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
 * Each shape that can be split also records its parts (`partsOfOrigin`), from
 * which `classifyShapeChange` in `lib/api-surface.mjs` tells an additive shape
 * change from a breaking one.
 *
 * The parser is `oxc-parser`, not the TypeScript compiler API, and that is a
 * requirement rather than a preference. This repository set spans TypeScript 6
 * and TypeScript 7, and TypeScript 7 ships no JavaScript compiler API at all —
 * `ts.createProgram` is undefined there. A checker-based extractor would work
 * in one repository and have to be rewritten in the others, which is how copies
 * of one rule end up with a different bug each. `oxc-parser` presents
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
const requireRecord = args.includes('--record')
const packageDirectories = args.filter((argument) => !argument.startsWith('--'))
if (packageDirectories.length === 0) packageDirectories.push('.')

/** One declaration inventory owns both recognition and its exported kind. */
const DECLARATION_KINDS = {
  TSInterfaceDeclaration: 'type', TSTypeAliasDeclaration: 'type', ClassDeclaration: 'value',
  FunctionDeclaration: 'value', TSDeclareFunction: 'value', TSEnumDeclaration: 'value',
  TSModuleDeclaration: 'value', VariableDeclaration: 'value',
}

const declaredNames = (node) => {
  const variable = node.type === 'VariableDeclaration'
  const identifiers = variable ? node.declarations.map((declarator) => declarator.id) : [node.id]
  // A destructuring pattern carries no single name. It cannot appear in a
  // declaration file, so reaching here means the parse is not what this
  // reader assumes — refuse it rather than record a key of `undefined`.
  return identifiers.map((identifier) => {
    if (identifier?.type === 'Identifier' || identifier?.type === 'Literal') return nameOf(identifier)
    throw new Error(`cannot read the exported name of a ${variable ? 'variable declarator' : node.type} (${identifier?.type})`)
  })
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
      declarations.set(name, [...(declarations.get(name) ?? []), node])
    }
  }
  for (const node of parsed.program.body) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node
    if (declaration && Object.hasOwn(DECLARATION_KINDS, declaration.type)) {
      declare(declaration)
      if (node.type === 'ExportNamedDeclaration')
        for (const name of declaredNames(declaration))
          exported.set(name, { local: name, kind: DECLARATION_KINDS[declaration.type], source: null })
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
        if (node.declaration) throw new Error(`unhandled exported declaration node ${node.declaration.type}`)
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

const REFERENCE_FIELDS = {
  ClassDeclaration: 'superClass', TSTypeReference: 'typeName', TSTypeQuery: 'exprName',
  TSInterfaceHeritage: 'expression', TSClassImplements: 'expression',
}

/** References to resolve, and literal spans whose whitespace is part of the type. */
const declarationParts = (node) => {
  const references = []
  const literals = []
  const leftmost = (name) => {
    let current = name
    while (current?.type === 'TSQualifiedName' || current?.type === 'MemberExpression') {
      current = current.type === 'TSQualifiedName' ? current.left : current.object
    }
    return current?.type === 'Identifier' ? current : null
  }
  const take = (identifier) => {
    if (identifier !== null) references.push(identifier)
  }
  const visit = (value) => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const element of value) visit(element)
      return
    }
    if (value.type === 'Literal' || value.type === 'TemplateElement') literals.push(value)
    const field = REFERENCE_FIELDS[value.type]
    if (field !== undefined) take(leftmost(value[field]))
    for (const key of Object.keys(value)) {
      if (key === 'type' || key === 'start' || key === 'end') continue
      visit(value[key])
    }
  }
  visit(node)
  return { references, literals }
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
 * naming, non-literal whitespace collapsed, and every reference replaced by a token
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
  const { references, literals } = declarationParts(node)
  for (const literal of literals) {
    edits.push({
      start: literal.start,
      end: literal.end,
      text: module.source.slice(literal.start, literal.end),
      literal: true,
    })
  }
  for (const reference of references) {
    const token = referenceToken(module, reference.name, selfName, ctx, inlining)
    if (token === null) continue
    edits.push({ start: reference.start, end: reference.end, text: token })
  }
  edits.sort((left, right) => left.start - right.start)
  const parts = []
  let text = ''
  let cursor = node.start
  for (const edit of edits) {
    if (edit.start < cursor) continue
    text += module.source.slice(cursor, edit.start)
    if (edit.literal) {
      parts.push(text.replace(/\s+/g, ' '), edit.text)
      text = ''
    } else text += edit.text
    cursor = edit.end
  }
  text += module.source.slice(cursor, node.end)
  parts.push(text.replace(/\s+/g, ' '))
  return parts.join('').trim()
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
  const nodes = origin.node ? [origin.node] : module.declarations.get(origin.name)
  if (nodes === undefined) {
    throw new Error(`${origin.file} states no declaration for "${origin.name}"`)
  }
  const digest = digestOf(
    nodes.map((node) => normalizedDeclaration(module, node, origin.name ?? null, ctx, inlining)).join('\n'),
  )
  if (inlining.size === 0) ctx.shapes.set(key, digest)
  return digest
}

const unwrap = (type) => (type?.type === 'TSParenthesizedType' ? unwrap(type.typeAnnotation) : type)

/**
 * The parts of one exported declaration a consumer depends on separately, so
 * the comparison can tell an added optional member from a removed one. A part
 * is its digest, `[digest, parts]` when it has parts of its own, or `1` when
 * its key already carries its digest. Keys:
 *
 *   `name` `name?` `readonly name`  a property     `name()` `name?()`  a method
 *   `(0)` `(1?)` `(...2)` `this`    a parameter    `=>`  the return type
 *   `|<digest>` or `|tag:...` a union variant; `&<digest>` an opaque intersection part
 *   `@0` `@1`    a signature of a function value         `<>` type parameters
 *   `~form`     completely accounted declaration kind; private heritage is flattened
 *   `~call` an interface's call signature; `~<digest>` any other member (index, construct, accessor)
 *
 * Unsupported, cyclic or ambiguous declarations stay opaque. Only bounded local
 * non-generic aliases, private property heritage and exact mutable const maps expand.
 */
const partsOfOrigin = (origin, ctx, visiting = new Set(), mutable = false) => {
  if (origin?.file === undefined || origin.name === undefined) return null
  const key = originKey(origin)
  if (visiting.has(key) || visiting.size >= 64) return null
  const seen = new Set([...visiting, key])
  const module = readModule(origin.file, ctx.modules)
  const nodes = module.declarations.get(origin.name)
  // A part is only ever compared with the same part of one other version, so a
  // shorter digest keeps the record small without a meaningful collision risk.
  const digest = (node) => digestOf(
    node.type === 'TSLiteralType' && typeof node.literal.value === 'string'
      ? JSON.stringify(node.literal.value) : normalizedDeclaration(module, node, origin.name, ctx, new Set()),
  ).slice(0, 8)
  const localParts = (name, projection = false) => {
    if (name?.type !== 'Identifier') return null
    const target = resolveBinding(module.file, name.name, ctx)
    if (!projection && ctx.publicNames.has(originKey(target))) return null
    const parts = partsOfOrigin(target, ctx, seen, projection)
    if (parts === null || '<>' in parts) return null
    const { '~form': _form, ...body } = parts
    return body
  }
  const typePart = (type) => {
    const parts = typeParts(unwrap(type))
    return parts === null ? digest(unwrap(type)) : [digest(unwrap(type)), parts]
  }
  const functionParts = (node) => {
    if (node.params.some((param) => param.decorators?.length)) return null
    const parts = {}
    if (node.typeParameters) parts['<>'] = digest(node.typeParameters)
    let position = 0
    for (const param of node.params) {
      const annotation = param.typeAnnotation?.typeAnnotation
      const key =
        param.type === 'TSThisParameter' || param.name === 'this'
          ? 'this'
          : param.type === 'RestElement'
            ? `(...${position++})`
            : `(${position++}${param.optional ? '?' : ''})`
      parts[key] = annotation ? typePart(annotation) : digest(param)
    }
    if (node.returnType) parts['=>'] = typePart(node.returnType.typeAnnotation)
    return parts
  }
  const memberName = (member) => member.computed || !member.key ? undefined
    : member.key.type === 'Identifier' ? member.key.name : JSON.stringify(String(member.key.value))
  const memberParts = (members, parts) => {
    for (const member of members) {
      // A quoted key (`'@id'`) is written as JSON so it never reads as a structural key.
      const name = memberName(member)
      let key = null
      if (name !== undefined && member.type === 'TSPropertySignature') {
        key = `${member.readonly ? 'readonly ' : ''}${name}${member.optional ? '?' : ''}`
      } else if (name !== undefined && member.type === 'TSMethodSignature' && member.kind === 'method') {
        key = `${name}${member.optional ? '?' : ''}()`
      } else if (member.type === 'TSCallSignatureDeclaration') key = '~call'
      if (key === null || key in parts) {
        parts[`~${digest(member)}`] = 1
      } else if (member.type !== 'TSPropertySignature') {
        parts[key] = [digest(member), functionParts(member)]
      } else {
        const annotation = member.typeAnnotation?.typeAnnotation
        parts[key] = annotation ? typePart(annotation) : digest(member)
      }
    }
    return parts
  }
  const unionParts = (types) => {
    const variants = types.map(unwrap)
    const literalValue = (member) => member.typeAnnotation.typeAnnotation.literal.value
    const tags = (variant) => variant.type === 'TSTypeLiteral'
      ? variant.members.filter((member) => member.type === 'TSPropertySignature' &&
        !member.optional && memberName(member) !== undefined &&
        member.typeAnnotation?.typeAnnotation.type === 'TSLiteralType' &&
        ['string', 'number', 'boolean'].includes(typeof literalValue(member)))
      : []
    const candidates = tags(variants[0]).map(memberName).filter((name) => {
      const values = variants.map((variant) => tags(variant).filter((tag) => memberName(tag) === name))
      if (values.some((matches) => matches.length !== 1)) return false
      return new Set(values.map(([tag]) => JSON.stringify(literalValue(tag)))).size === variants.length
    })
    return Object.fromEntries(variants.map((variant) => {
      if (candidates.length !== 1) return [`|${digest(variant)}`, 1]
      const tag = tags(variant).find((member) => memberName(member) === candidates[0])
      return [`|tag:${JSON.stringify([candidates[0], literalValue(tag)])}`, typePart(variant)]
    }))
  }
  const typeParts = (type) => {
    switch (type?.type) {
      case 'TSTypeLiteral':
        return memberParts(type.members, {})
      case 'TSFunctionType':
        return functionParts(type)
      case 'TSUnionType':
        return unionParts(type.types)
      case 'TSTypeReference':
        return type.typeArguments ? null : localParts(type.typeName)
      case 'TSMappedType': {
        const constraint = type.constraint
        const indexed = unwrap(type.typeAnnotation)
        const query = constraint?.type === 'TSTypeOperator' && constraint.operator === 'keyof'
          ? unwrap(constraint.typeAnnotation) : null
        const object = unwrap(indexed?.objectType)
        return type.readonly === '-' && !type.optional && !type.nameType &&
          query?.type === 'TSTypeQuery' && !query.typeArguments &&
          object?.type === 'TSTypeQuery' && !object.typeArguments &&
          query.exprName.type === 'Identifier' && object.exprName.type === 'Identifier' &&
          query.exprName.name === object.exprName.name && indexed?.type === 'TSIndexedAccessType' &&
          indexed.indexType.type === 'TSTypeReference' && !indexed.indexType.typeArguments &&
          indexed.indexType.typeName.name === type.key.name
          ? localParts(query.exprName, true) : null
      }
      case 'TSIntersectionType': {
        const parts = {}
        for (const member of type.types.map(unwrap)) {
          if (member.type === 'TSTypeLiteral') memberParts(member.members, parts)
          else parts[`&${digest(member)}`] = 1
        }
        return parts
      }
      default:
        return null
    }
  }
  if (mutable && (nodes.length !== 1 || nodes[0].type !== 'VariableDeclaration')) return null
  if (nodes.every((node) => node.type === 'TSDeclareFunction' || node.type === 'FunctionDeclaration')) {
    if (nodes.some((node) => node.body || node.async || node.generator)) return null
    return { '~form': 'function', ...Object.fromEntries(nodes.map((node, index) => [`@${index}`, [digest(node), functionParts(node)]])) }
  }
  if (nodes.length !== 1) return null
  const [node] = nodes
  let parts = null
  if (node.type === 'TSInterfaceDeclaration') {
    parts = {}
    for (const parent of node.extends ?? []) {
      const inherited = parent.typeArguments ? null : localParts(parent.expression)
      if (inherited === null || Object.keys(inherited).some((key) =>
        !/^(readonly )?[A-Za-z_$][\w$]*\??$/.test(key) || key in parts)) return null
      Object.assign(parts, inherited)
    }
    if (node.extends?.length && node.body.body.some((member) =>
      member.type !== 'TSPropertySignature' || member.computed || member.key.type !== 'Identifier' ||
      Object.keys(parts).some((key) => key.replace(/^readonly /, '').replace(/\?$/, '') === member.key.name))) return null
    memberParts(node.body.body, parts)
  } else if (node.type === 'TSTypeAliasDeclaration') {
    parts = typeParts(unwrap(node.typeAnnotation))
  } else if (node.type === 'VariableDeclaration' && node.declarations.length === 1) {
    // A function-typed binding is called like a declared function; its kind still matters.
    if (node.declarations[0].init || node.declarations[0].definite || node.declarations[0].id.optional) return null
    const type = unwrap(node.declarations[0].id.typeAnnotation?.typeAnnotation)
    if (mutable) {
      if (node.kind !== 'const' || type?.type !== 'TSTypeLiteral' || type.members.some(
        (member) => member.type !== 'TSPropertySignature' || member.computed || member.optional || !member.typeAnnotation,
      )) return null
      parts = memberParts(type.members.map((member) => ({ ...member, readonly: false })), {})
    } else if (type?.type === 'TSFunctionType') parts = { '@0': [digest(node), functionParts(type)] }
  }
  if (parts !== null) {
    parts['~form'] = node.type === 'VariableDeclaration' ? `${node.type}:${node.kind}` : node.type
    if (node.typeParameters) parts['<>'] = digest(node.typeParameters)
  }
  return parts
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
  const structure = {}
  for (const [subpath, names] of perEntry) {
    const stated = {}
    for (const [name, record] of names) {
      const shape = shapeOfOrigin(record.origin, ctx)
      stated[name] = `${record.kind} ${shape}`
      const parts = partsOfOrigin(record.origin, ctx)
      if (parts !== null) structure[shape] = parts
    }
    recorded[subpath] = stated
  }
  return { package: manifest.name, entries: recorded, assets, structure }
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
    if (requireRecord) failures.push(`${displayPath} does not exist`)
    else reports.push(`${displayPath}: generated ${total} exports; no committed release record`)
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
      ['shape extended', changes.extended],
    ]) {
      for (const change of list.slice(0, 20)) lines.push(`  ${label}: ${change}`)
      if (list.length > 20) lines.push(`  ${label}: ...and ${list.length - 20} more`)
    }
    if (requireRecord) failures.push(lines.join('\n'))
    else reports.push(`${displayPath}: generated ${total} exports; release record differs and will be regenerated by release:prepare`)
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
      'This strict record check is for a release candidate.',
      'Run pnpm run release:prepare to regenerate the release record.',
    ].join('\n')}\n`,
  )
  process.exit(1)
}

process.stdout.write(`${reports.join('\n')}\n`)
