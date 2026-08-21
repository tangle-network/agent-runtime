/**
 * The public export surface of a package, and the version level a change to it
 * must be paid for with.
 *
 * `check-version-bump.mjs` compares the MANIFEST — the fields npm copies into
 * the published package.json. That comparison cannot see a symbol. Adding an
 * export to a source entry point leaves every manifest field byte-identical:
 * `exports["./durable"].types` still reads `./dist/durable.d.ts`, so the change
 * is invisible and the package ships under a version the registry already
 * holds. This module supplies the missing half — the SYMBOLS each entry point
 * exports — as a committed record that a change has to update.
 *
 * The record is a file, not a live comparison of two builds. Three reasons:
 *   - the merge base's symbols are then one `git show` away, with no second
 *     checkout, no second install, and no second build;
 *   - the record appears in the pull request diff, so an added export is
 *     visible to a reviewer at the moment it is added;
 *   - `check-version-bump.mjs` keeps needing nothing but git, so it still runs
 *     before the build.
 *
 * A record can go stale. `check-api-surface.mjs` regenerates it from the built
 * declaration files and fails when the two disagree, and it runs wherever a
 * build has already happened. Staleness is therefore loud, never a silent pass.
 *
 * Each name records its KIND and its SHAPE: `"type 4c1f…"`, where the digest
 * covers the declaration a consumer compiles against. A name is only half of
 * what a consumer resolves — removing a field from an exported interface, or
 * adding a member to an exported union, moves no name at all, so a name-only
 * record reports "surface unchanged" for a change every consumer can see.
 *
 * The digest is taken over the BUILT declaration, with comments removed,
 * whitespace collapsed, the declaration's own local name blanked, and every
 * type reference rewritten to a stable token — the referenced symbol's PUBLIC
 * name when the package exports it, the `package:name` it came from when it is
 * re-exported from a dependency, and the referenced declaration's own digest
 * when the package declares it without exporting it. So an internal edit that
 * reaches no exported declaration moves nothing, a doc-comment edit moves
 * nothing, and a bundler's private renaming moves nothing.
 *
 * Two deliberate limits, so neither reads as an oversight:
 *   - A change is reported where it HAPPENED, not everywhere it is reachable
 *     from. `A { b: B }` references `B` by public name, so editing `B` moves
 *     `B`'s digest and not `A`'s. Every affected symbol is still named, once.
 *   - A shape change is classified BREAKING, not additive. Telling an added
 *     optional field from a removed required one is a subtyping question, and
 *     the record states structure rather than subtyping. Guessing additive on a
 *     change that is actually a break is the failure this exists to stop.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join, posix, relative, resolve } from 'node:path'

/** Declaration-file suffixes an `exports` condition can legitimately point at. */
const DECLARATION_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts']

/**
 * Conditions that resolve to the types a consumer compiles against, most
 * specific first. `types` is authoritative; the others are read only when a
 * package states no `types`, and are then required to be a declaration file
 * before they count as an entry point.
 */
const TYPE_CONDITIONS = ['types', 'import', 'module', 'default', 'require']

const isDeclarationFile = (target) => DECLARATION_SUFFIXES.some((suffix) => target.endsWith(suffix))

/**
 * The declaration target of one `exports` value. Returns `null` for an entry
 * that resolves to something other than a declaration file — a JSON asset, a
 * bare script — which is a real entry point with no symbols to record.
 */
const declarationTargetOf = (value) => {
  if (typeof value === 'string') return isDeclarationFile(value) ? value : null
  if (value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const element of value) {
      const target = declarationTargetOf(element)
      if (target !== null) return target
    }
    return null
  }
  for (const condition of TYPE_CONDITIONS) {
    if (!(condition in value)) continue
    const target = declarationTargetOf(value[condition])
    if (target !== null) return target
  }
  return null
}

/**
 * Expand one `*` in a subpath against the files a build produced.
 *
 * `"./benchmarks/*": { "types": "./dist/benchmarks/*.d.ts" }` is a single
 * manifest line standing for however many modules the build emitted. Each one
 * is a separate entry point a consumer can import, so each is recorded
 * separately — otherwise adding a benchmark module would be invisible here for
 * the same reason adding a symbol is invisible to the manifest comparison.
 */
const expandWildcard = (subpath, target, packageDir) => {
  const [prefix, suffix] = target.split('*')
  // npm splits the pattern at the `*`, not at a path boundary: the text before
  // the star is a directory path plus a possible filename prefix, and the star
  // itself matches across `/`. Splitting with `dirname`/`basename` drops the
  // final directory when the prefix ends in a separator, which silently matches
  // nothing.
  const separator = prefix.lastIndexOf('/')
  const directory = resolve(packageDir, separator === -1 ? '.' : prefix.slice(0, separator))
  const namePrefix = separator === -1 ? prefix : prefix.slice(separator + 1)
  const entries = []
  if (existsSync(directory)) {
    const found = readdirSync(directory, { recursive: true, withFileTypes: true })
    const relativeNames = found
      .filter((entry) => entry.isFile())
      .map((entry) =>
        posix.join(relative(directory, entry.parentPath).split('\\').join('/'), entry.name),
      )
      .sort()
    for (const name of relativeNames) {
      if (!name.startsWith(namePrefix) || !name.endsWith(suffix)) continue
      const stem = name.slice(namePrefix.length, name.length - suffix.length)
      if (stem === '') continue
      entries.push({ subpath: subpath.replace('*', stem), file: join(directory, name) })
    }
  }
  if (entries.length === 0) {
    throw new Error(
      `exports["${subpath}"] -> "${target}" matches no built file. Either the build did not ` +
        'emit the modules this pattern publishes, or the pattern is wrong. An entry point ' +
        'that resolves to nothing must not be recorded as an empty surface.',
    )
  }
  return entries
}

/**
 * Every entry point a consumer can import from this package, with the
 * declaration file that states its symbols.
 *
 * Returns `assets` separately so an entry point with no declaration file is
 * recorded as deliberately empty rather than dropped. A dropped entry would be
 * a hole in the surface record with nothing naming it.
 */
export const resolveExportEntries = (manifest, packageDir) => {
  const declared = manifest.exports
  if (declared === undefined) return { entries: [], assets: [] }
  const table =
    typeof declared === 'string' || Array.isArray(declared) ? { '.': declared } : declared
  const entries = []
  const assets = []
  for (const [subpath, value] of Object.entries(table)) {
    // A condition name at the top level (`{ "import": ... }`) is sugar for a
    // single "." entry, not a subpath.
    if (!subpath.startsWith('.')) {
      const target = declarationTargetOf(table)
      if (target !== null) entries.push({ subpath: '.', file: resolve(packageDir, target) })
      else assets.push('.')
      break
    }
    const target = declarationTargetOf(value)
    if (target === null) {
      assets.push(subpath)
      continue
    }
    if (subpath.includes('*') || target.includes('*')) {
      if (!subpath.includes('*') || !target.includes('*')) {
        throw new Error(
          `exports["${subpath}"] uses a pattern on one side only; ` +
            'a wildcard subpath and its target must both carry exactly one "*"',
        )
      }
      entries.push(...expandWildcard(subpath, target, packageDir))
      continue
    }
    entries.push({ subpath, file: resolve(packageDir, target) })
  }
  entries.sort((left, right) => left.subpath.localeCompare(right.subpath))
  return { entries, assets: assets.sort() }
}

/** Stable on-disk form: sorted everywhere, so a diff shows only real movement. */
export const formatSurface = (surface) => {
  const entries = {}
  for (const subpath of Object.keys(surface.entries).sort()) {
    const names = surface.entries[subpath]
    entries[subpath] = Object.fromEntries(Object.keys(names).sort().map((name) => [name, names[name]]))
  }
  return `${JSON.stringify({ package: surface.package, entries, assets: [...surface.assets].sort() }, null, 2)}\n`
}

/**
 * One recorded name, split into what a comparison needs. A record that states
 * only a kind carries no shape, and a shape that is not stated on BOTH sides
 * has nothing to be compared against — the same rule a record appearing for the
 * first time already follows.
 */
export const parseSurfaceEntry = (entry) => {
  const [kind, shape] = String(entry).split(' ')
  return { kind, shape }
}

/**
 * What moved between two surface records.
 *
 * `value -> type` is listed as a narrowing: the name still type-checks, and the
 * runtime binding a consumer imported is gone. That is a break the name set
 * alone would call unchanged.
 *
 * `changed` is a name whose kind held and whose SHAPE moved — a field, a
 * parameter, a union member. It is reported alongside a kind move rather than
 * instead of one, because the two are independent and either can be the break.
 */
export const compareSurfaces = (before, after) => {
  const added = []
  const removed = []
  const narrowed = []
  const widened = []
  const changed = []
  const subpaths = [
    ...new Set([...Object.keys(before.entries ?? {}), ...Object.keys(after.entries ?? {})]),
  ].sort()
  for (const subpath of subpaths) {
    const left = before.entries?.[subpath]
    const right = after.entries?.[subpath]
    if (left === undefined) {
      for (const name of Object.keys(right ?? {}).sort()) added.push(`${subpath} ${name}`)
      continue
    }
    if (right === undefined) {
      for (const name of Object.keys(left).sort()) removed.push(`${subpath} ${name}`)
      continue
    }
    for (const name of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      const from = left[name]
      const to = right[name]
      if (from === to) continue
      if (from === undefined) {
        added.push(`${subpath} ${name}`)
        continue
      }
      if (to === undefined) {
        removed.push(`${subpath} ${name}`)
        continue
      }
      const was = parseSurfaceEntry(from)
      const is = parseSurfaceEntry(to)
      if (was.kind !== is.kind) {
        if (was.kind === 'value' && is.kind === 'type') narrowed.push(`${subpath} ${name}: value -> type`)
        else widened.push(`${subpath} ${name}: ${was.kind} -> ${is.kind}`)
      }
      if (was.shape !== undefined && is.shape !== undefined && was.shape !== is.shape) {
        changed.push(`${subpath} ${name}: shape ${was.shape} -> ${is.shape}`)
      }
    }
  }
  // An entry point that stops carrying declarations is a removal of everything
  // a consumer could import through it, so it is compared with the same rule.
  const beforeAssets = new Set(before.assets ?? [])
  const afterAssets = new Set(after.assets ?? [])
  for (const subpath of [...afterAssets].sort()) {
    if (!beforeAssets.has(subpath) && before.entries?.[subpath] === undefined) {
      added.push(`${subpath} (entry point, no declarations)`)
    }
  }
  for (const subpath of [...beforeAssets].sort()) {
    if (!afterAssets.has(subpath) && after.entries?.[subpath] === undefined) {
      removed.push(`${subpath} (entry point, no declarations)`)
    }
  }
  return { added, removed, narrowed, widened, changed }
}

/**
 * A shape change counts as breaking. Whether it added an optional field or
 * removed a required one is a subtyping question this record cannot answer, and
 * calling a break additive is the outcome the record exists to prevent.
 */
export const surfaceSeverity = (changes) => {
  if (changes.removed.length > 0 || changes.narrowed.length > 0 || changes.changed.length > 0) {
    return 'breaking'
  }
  if (changes.added.length > 0 || changes.widened.length > 0) return 'additive'
  return 'none'
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

const parseVersion = (raw) => {
  const match = VERSION_PATTERN.exec(String(raw).trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  }
}

export const LEVEL_RANK = { none: 0, patch: 1, minor: 2, major: 3 }

/**
 * The level a version move actually pays. `lower` and `unorderable` are not
 * levels — they are the two ways a move pays nothing, kept distinct so a
 * failure can say which happened.
 */
export const versionBumpLevel = (baseVersion, headVersion) => {
  const base = parseVersion(baseVersion)
  const head = parseVersion(headVersion)
  if (!base || !head) return 'unorderable'
  if (head.major !== base.major) return head.major > base.major ? 'major' : 'lower'
  if (head.minor !== base.minor) return head.minor > base.minor ? 'minor' : 'lower'
  if (head.patch !== base.patch) return head.patch > base.patch ? 'patch' : 'lower'
  if (head.prerelease === base.prerelease) return 'none'
  // Same release triple. Leaving a prerelease for its release, or advancing to a
  // later prerelease, is the smallest move that reaches a consumer. Adding a
  // prerelease to an already-released version goes backwards.
  if (base.prerelease === undefined) return 'lower'
  if (head.prerelease === undefined) return 'patch'
  return head.prerelease > base.prerelease ? 'patch' : 'lower'
}

/**
 * The level a surface change must move, read off the consumer's compatibility
 * boundary rather than off semver's headline rule.
 *
 * `^1.2.3` admits every 1.x, so the boundary sits at MAJOR: a break has to move
 * major, and an addition has to move minor to be reachable through a `~1.2`
 * style pin. `^0.2.3` — and the fleet's explicit `>=0.2.3 <0.3.0` window —
 * admits only 0.2.x, so the boundary moves one position right. A break has to
 * move MINOR, because that is what lands outside every existing consumer
 * window, and an addition needs only PATCH, because that is already reachable
 * inside one. Demanding a minor for every added export on a 0.x package would
 * push every consumer range forward for a change that breaks nobody.
 */
export const requiredBumpLevel = (severity, baseVersion) => {
  if (severity === 'none') return 'none'
  const base = parseVersion(baseVersion)
  // An unreadable base version cannot establish a boundary; demand the strongest
  // level rather than guess downwards.
  const stable = base === null || base.major >= 1
  if (severity === 'breaking') return stable ? 'major' : 'minor'
  return stable ? 'minor' : 'patch'
}

/** Path of a package's surface record, relative to the repository root. */
export const surfaceRecordPath = (packageDirectory) => {
  const directory = packageDirectory === '' || packageDirectory === '.' ? '' : packageDirectory
  return directory === '' ? 'api-surface.json' : posix.join(directory, 'api-surface.json')
}

export const relativeToRoot = (repoRoot, absolutePath) =>
  relative(repoRoot, absolutePath).split('\\').join('/')
