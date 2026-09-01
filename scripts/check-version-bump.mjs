#!/usr/bin/env node
/**
 * Fail a change that alters a consumer-visible package surface without bumping
 * that package's version to a higher one.
 *
 * The defect this closes: a pull request moves a peer range or a catalog pin,
 * merges, and main now declares a version the registry already holds under
 * DIFFERENT, consumer-visible terms. `publish.yml` skips a version already on
 * the registry, so re-tagging cannot correct it — the change simply never
 * reaches a consumer, and nothing goes red. It happened to 0.119.0, whose
 * agent-eval peer floor moved from `>=0.139.2` to `>=0.140.1` with no bump, and
 * unnoticed for far longer to `@tangle-network/agent-bench`.
 *
 * The rule: for every publishable manifest in the workspace, if any field npm
 * copies into the published manifest differs from the merge base, `version` must
 * be strictly higher than the base's. `version` is not part of the compared
 * surface — it is the payment a surface change is made with, and a payment in
 * the wrong direction lands on a version the registry may already hold.
 *
 * `catalog:` specifiers are compared by what they RESOLVE to, through
 * `pnpm-workspace.yaml`. That indirection is how the drift stayed invisible:
 * `"@tangle-network/agent-knowledge": "catalog:"` is byte-identical across the
 * change that moved the installed version 7.0.3 -> 7.0.4. Only the resolved
 * version is compared, so moving a dependency between the default catalog, a
 * named catalog, and a literal pin is silent as long as the version is the same.
 *
 * Two deliberate scope boundaries, so neither reads as an oversight:
 *
 *   - `workspace:` specifiers are NOT resolved. One resolves to a sibling in the
 *     same commit, so it moves only when that sibling's version moves — which
 *     this check already requires to be paid for, on that sibling. Resolving it
 *     here would demand a second bump for a change already accounted.
 *   - Built output is not compared. A `src/` change that rewrites all of
 *     `dist/` is allowed with no bump; releases, not this check, decide when
 *     code ships. The EXPORTED SYMBOLS are the one exception, below.
 *
 * The manifest is only half of what a consumer sees. Adding an export to an
 * entry point changes no manifest field at all — `exports["./durable"].types`
 * still reads `./dist/durable.d.ts` — so the manifest comparison reports
 * "consumer surface unchanged" and the new symbol ships under a version the
 * registry already holds. That happened to `PursuitProjection`,
 * `PursuitRunProjection` and `PursuitNodeProjection`: added and exported at
 * 0.140.0, which npm already held, so they resolved in no published version and
 * a consumer spent hours proving types that existed were absent.
 *
 * So every publishable package also commits `api-surface.json`, the symbols each
 * entry point exports AND the shape of each one, generated from the built
 * declarations by `check-api-surface.mjs`. A name alone is not enough: removing
 * a field from an exported interface, or adding a member to an exported union,
 * moves no name, so a name-only record answers "consumer surface unchanged" for
 * a change every consumer can see. This check compares that record against the
 * merge base and requires the level the change implies:
 *
 *   - a removed export, one narrowed from a value to a type, or one whose SHAPE
 *     moved, is breaking;
 *   - an added export is additive;
 *   - a manifest-only change asks for a higher version, as it always did.
 *
 * The level each severity demands is read off the consumer's compatibility
 * boundary, which sits one position further right below 1.0 — see
 * `requiredBumpLevel` in `lib/api-surface.mjs`.
 *
 * This file, `check-api-surface.mjs` and `lib/api-surface.mjs` are kept
 * byte-identical in agent-knowledge and agent-runtime. They read everything
 * repo-specific out of the manifests they inspect, so an edit to one belongs in
 * both. Nothing here may name a single repository.
 *
 * agent-eval is deliberately NOT in that set, and the roster that used to name it
 * was never true: it has never carried these files on main. Its copy sits on an
 * unmerged branch, `feat/export-surface-gate`, written 2026-08-18 and 59 commits
 * behind main on 2026-09-01, whose own copy of this file had already drifted from
 * this one before the fix below existed. Adopting the gate there is a decision
 * about that repository's release discipline, not an edit this file is owed, so
 * it is tracked as its own issue. Restore the third name only when agent-eval
 * actually carries the file.
 *
 * The version a change is measured against is the LAST PUBLISHED one, not the
 * base branch's. Those differ whenever main already carries a bump that has not
 * shipped, and reading the base branch instead made an unreleased version behave
 * like a released one: the first consumer-visible change claimed the open slot
 * and every later one in the same train was told to open another.
 *
 * Measured 2026-09-01 on agent-runtime. Two export-adding pull requests were
 * open against a main that declared 0.190.0 while the registry's newest version
 * was 0.189.0. Nothing could ship under 0.190.0 without a second bump, so #1065
 * and #1066 were each refused, each for adding exports to a version no consumer
 * could yet resolve, and both had to be merged with admin over a red gate. One
 * unpublished bump can absorb every consumer-visible change until it ships,
 * which is what a release train is for.
 *
 * A version that IS on the registry still demands its own bump. That is the
 * defect this file exists for, and it is unchanged: 0.119.0 moved a peer floor
 * under a version npm already held, and `publish.yml` skips a version already
 * published, so re-tagging could never correct it.
 *
 * What "published" means here, in order:
 *
 *   1. The highest `v*` tag reachable from the base — the repository's own
 *      record of what it released, since `publish.yml` fires on that tag. Each
 *      package's released version is read from ITS manifest at that tag, so a
 *      workspace package with its own version line is never handed the root's.
 *   2. The npm registry's `latest`, consulted only when no tag is reachable and
 *      only as a best effort. A registry that cannot be reached changes nothing.
 *   3. Neither: fall back to the base branch's version, which is the behavior
 *      this check has always had. Unknown publication state must not weaken it.
 *
 * Usage: pnpm run check:version-bump
 *   PACKAGE_VERSION_BUMP_BASE      base ref to compare against (default: the
 *                                  CI base branch, else origin/main, else main)
 *   PACKAGE_VERSION_BUMP_ROOT      repository to inspect (default: this repo)
 *   PACKAGE_VERSION_BUMP_REGISTRY  `0` skips the registry fallback entirely,
 *                                  for a hermetic or offline run
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  LEVEL_RANK,
  compareSurfaces,
  requiredBumpLevel,
  surfaceRecordPath,
  surfaceSeverity,
  versionBumpLevel,
} from './lib/api-surface.mjs'

const repoRoot = resolve(
  process.env.PACKAGE_VERSION_BUMP_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), '..'),
)

/**
 * Every field npm copies into the published manifest, so every field a consumer
 * can read or resolve against. `version` is absent on purpose (see the header);
 * so are `scripts` as a whole, `devDependencies`, and metadata prose, none of
 * which change what a consumer installs. The install-lifecycle scripts are the
 * exception and are compared separately — they execute on a consumer's machine.
 */
const CONSUMER_VISIBLE_FIELDS = [
  'name',
  'private',
  'type',
  'main',
  'module',
  'types',
  'typings',
  'browser',
  'exports',
  'imports',
  'typesVersions',
  'bin',
  'files',
  'directories',
  'engines',
  'os',
  'cpu',
  'license',
  'sideEffects',
  'publishConfig',
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'bundleDependencies',
  'bundledDependencies',
  'installScripts',
]

/** Fields whose values are `{ [dependency]: specifier }` and so carry `catalog:` indirection. */
const SPECIFIER_FIELDS = new Set(['dependencies', 'optionalDependencies', 'peerDependencies'])

/** Fields npm treats as an unordered set, where a reordering changes nothing. */
const UNORDERED_FIELDS = new Set(['files', 'os', 'cpu'])

/** The scripts npm runs on the CONSUMER's machine when the tarball is installed. */
const INSTALL_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall']

const git = (args, { allowFailure = false } = {}) => {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    if (allowFailure) return null
    throw new Error(`git ${args.join(' ')} failed: ${error.stderr || error.message}`)
  }
}

const fileAtRef = (ref, path) => git(['show', `${ref}:${path}`], { allowFailure: true })

const resolveBase = () => {
  const configured =
    process.env.PACKAGE_VERSION_BUMP_BASE ||
    // The base BRANCH, never the webhook's frozen base sha. On a pull_request
    // run the checked-out merge ref is recomputed against the CURRENT base tip,
    // so the frozen sha can name a commit that is no longer the merge parent —
    // and then a release someone else merged in the meantime pays for a change
    // in this pull request.
    (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : '')
  // Fail closed on any event that HAS a base branch, BEFORE any fallback. A
  // fallback would compare against whatever `main` happens to be in the clone,
  // which is not the branch under review — a silent pass with no signal. A push
  // or manual run genuinely has no base and is not what this gates.
  const baselessEvents = new Set(['push', 'workflow_dispatch', 'schedule'])
  if (
    !configured &&
    process.env.GITHUB_ACTIONS &&
    !baselessEvents.has(process.env.GITHUB_EVENT_NAME ?? '')
  ) {
    throw new Error(
      `running in CI on a ${process.env.GITHUB_EVENT_NAME ?? 'unknown'} event with no base ` +
        'branch to compare against. Set GITHUB_BASE_REF (or PACKAGE_VERSION_BUMP_BASE).',
    )
  }
  const candidates = configured ? [configured] : ['origin/main', 'main']
  for (const candidate of candidates) {
    const resolved = git(['rev-parse', '--verify', `${candidate}^{commit}`], { allowFailure: true })
    if (resolved) return { ref: resolved.trim(), label: candidate }
  }
  if (configured) {
    throw new Error(
      `cannot resolve the requested base commit ${configured}. ` +
        'Check out with fetch-depth: 0 so the base is present.',
    )
  }
  return null
}

const globToRegExp = (glob) => {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const body = escaped.replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*')
  return new RegExp(`^${body}$`)
}

/** pnpm workspace `packages:` patterns, including `!` exclusions and `**`. */
const workspaceMatcher = (patterns) => {
  const include = []
  const exclude = []
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue
    const normalized = pattern.replace(/^\.\//, '').replace(/\/+$/, '')
    if (normalized.startsWith('!')) exclude.push(globToRegExp(normalized.slice(1)))
    else include.push(globToRegExp(normalized))
  }
  return (directory) =>
    include.some((pattern) => pattern.test(directory)) &&
    !exclude.some((pattern) => pattern.test(directory))
}

const workspaceAtRef = (ref) => {
  const raw = fileAtRef(ref, 'pnpm-workspace.yaml')
  if (raw === null) return { catalogs: { default: {}, named: {} }, matches: () => false }
  const document = parseYaml(raw) ?? {}
  return {
    catalogs: { default: document.catalog ?? {}, named: document.catalogs ?? {} },
    matches: workspaceMatcher(document.packages ?? []),
  }
}

/**
 * Every manifest that could be published from this ref, keyed by package NAME.
 * Keyed by name, not path, so moving a package between directories still
 * compares against what that same package name already published.
 */
const manifestsAtRef = (ref, workspace) => {
  const tracked = (git(['ls-tree', '-r', '--name-only', ref]) ?? '')
    .split('\n')
    .filter((path) => path.endsWith('package.json') && !path.includes('node_modules/'))
  const byName = new Map()
  for (const path of tracked) {
    const directory = path === 'package.json' ? '' : dirname(path)
    if (directory !== '' && !workspace.matches(directory)) continue
    const raw = fileAtRef(ref, path)
    if (raw === null) continue
    let manifest
    try {
      manifest = JSON.parse(raw)
    } catch (error) {
      throw new Error(`${path} at ${ref.slice(0, 12)} is not valid JSON: ${error.message}`)
    }
    if (typeof manifest?.name !== 'string') continue
    byName.set(manifest.name, { path, manifest })
  }
  return byName
}

/**
 * What a consumer actually resolves. Only the RESOLVED version is returned, so
 * moving a dependency between the default catalog, a named catalog, and a
 * literal pin is silent when the version does not move.
 */
const resolveSpecifier = (specifier, catalogs, context) => {
  if (typeof specifier !== 'string' || !specifier.startsWith('catalog:')) return specifier
  const name = specifier.slice('catalog:'.length).trim()
  const table = name === '' ? catalogs.default : catalogs.named[name]
  const resolved = table?.[context.dependency]
  if (resolved === undefined) {
    // Fail closed: an unresolvable catalog pin must not compare equal by accident.
    throw new Error(
      `${context.path} ${context.field}.${context.dependency} is "${specifier}" but ` +
        `pnpm-workspace.yaml has no ${name === '' ? 'catalog' : `catalogs.${name}`} entry for it`,
    )
  }
  return String(resolved)
}

const surfaceOf = ({ path, manifest }, catalogs) => {
  const surface = {}
  const withInstallScripts = {
    ...manifest,
    installScripts: Object.fromEntries(
      INSTALL_LIFECYCLE_SCRIPTS.filter((name) => manifest.scripts?.[name] !== undefined).map(
        (name) => [name, manifest.scripts[name]],
      ),
    ),
  }
  for (const field of CONSUMER_VISIBLE_FIELDS) {
    if (!(field in withInstallScripts)) continue
    const value = withInstallScripts[field]
    if (field === 'installScripts' && Object.keys(value).length === 0) continue
    if (SPECIFIER_FIELDS.has(field) && value && typeof value === 'object') {
      surface[field] = Object.fromEntries(
        Object.entries(value).map(([dependency, specifier]) => [
          dependency,
          resolveSpecifier(specifier, catalogs, { path, field, dependency }),
        ]),
      )
    } else if (UNORDERED_FIELDS.has(field) && Array.isArray(value)) {
      // npm reads these as sets. Negations are order-sensitive, so only sort
      // when none is present.
      surface[field] = value.some((entry) => typeof entry === 'string' && entry.startsWith('!'))
        ? value
        : [...value].sort()
    } else {
      surface[field] = value
    }
  }
  return surface
}

const show = (value) => (value === undefined ? '(absent)' : JSON.stringify(value))

/** Report the changed leaves, so a failure names the exact edit to pay for. */
const surfaceChanges = (before, after) => {
  const changes = []
  for (const field of CONSUMER_VISIBLE_FIELDS) {
    const left = before[field]
    const right = after[field]
    if (JSON.stringify(left) === JSON.stringify(right)) continue
    const isMap = (value) => value && typeof value === 'object' && !Array.isArray(value)
    if (isMap(left) && isMap(right)) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        if (JSON.stringify(left[key]) === JSON.stringify(right[key])) continue
        changes.push(`${field}.${key}: ${show(left[key])} -> ${show(right[key])}`)
      }
    } else {
      changes.push(`${field}: ${show(left)} -> ${show(right)}`)
    }
  }
  return changes
}

/**
 * The export surface record of one package at one ref, or `null` when the ref
 * carries no record for it.
 */
const surfaceAtRef = (ref, manifestPath) => {
  const recordPath = surfaceRecordPath(manifestPath === 'package.json' ? '' : dirname(manifestPath))
  const raw = fileAtRef(ref, recordPath)
  if (raw === null) return null
  try {
    return { path: recordPath, surface: JSON.parse(raw) }
  } catch (error) {
    throw new Error(`${recordPath} at ${ref.slice(0, 12)} is not valid JSON: ${error.message}`)
  }
}

/** Rank a level, treating `lower` and `unorderable` as paying nothing. */
const rankOf = (level) => LEVEL_RANK[level] ?? 0

/** True when `candidate` is strictly higher than `reference`. */
const isHigher = (reference, candidate) => rankOf(versionBumpLevel(reference, candidate)) > 0

/**
 * The newest `v*` tag reachable from `ref`, or `null`.
 *
 * Reachability is the point: a tag on a branch nobody merged describes nothing
 * this base contains. Ordering is semantic, never lexical — `v0.99.0` sorts
 * above `v0.100.0` as a string, and picking the wrong tag would compare against
 * a version older than the one that actually shipped.
 */
const lastReleaseTag = (ref) => {
  const tags = (git(['tag', '--list', 'v*', '--merged', ref], { allowFailure: true }) ?? '')
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
  let newest = null
  for (const tag of tags) {
    if (newest === null || isHigher(newest.slice(1), tag.slice(1))) newest = tag
  }
  return newest
}

/**
 * `latest` from the npm registry for one package, or `undefined`.
 *
 * Best effort by construction. This runs only when no release tag is reachable,
 * and every failure — offline, private package, never published, a slow
 * registry — returns `undefined` and leaves the check exactly as it was.
 */
const registryVersion = (name) => {
  if (process.env.PACKAGE_VERSION_BUMP_REGISTRY === '0') return undefined
  try {
    const stdout = execFileSync('npm', ['view', name, 'version', '--silent'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const version = stdout.trim()
    return version.length > 0 ? version : undefined
  } catch {
    return undefined
  }
}


const base = resolveBase()
if (base === null) {
  process.stdout.write('No base ref to compare against; version-bump check does not apply.\n')
  process.exit(0)
}

const head = git(['rev-parse', 'HEAD']).trim()
const mergeBase = git(['merge-base', base.ref, head], { allowFailure: true })?.trim()
if (!mergeBase) {
  throw new Error(`${base.label} (${base.ref.slice(0, 12)}) shares no history with HEAD`)
}

const baseLabel = `${base.label} (${mergeBase.slice(0, 12)})`

if (mergeBase === head) {
  process.stdout.write(`No commits ahead of ${baseLabel}; nothing to compare for a version bump.\n`)
  process.exit(0)
}

const baseWorkspace = workspaceAtRef(mergeBase)
const headWorkspace = workspaceAtRef(head)
const baseManifests = manifestsAtRef(mergeBase, baseWorkspace)
const headManifests = manifestsAtRef(head, headWorkspace)

// What a consumer can ALREADY resolve, per package name. The base branch's
// version is not that: main routinely carries a bump that has not shipped, and
// one unpublished bump absorbs every consumer-visible change until it does.
const releaseTag = lastReleaseTag(mergeBase)
// Each package's released version comes from ITS OWN manifest at the tag, so a
// workspace package on a separate version line is never handed the root's.
const releasedManifests =
  releaseTag === null ? null : manifestsAtRef(releaseTag, workspaceAtRef(releaseTag))
const releasedFrom = releaseTag === null ? 'the npm registry' : `${releaseTag}`
const releasedVersionOf = (name) =>
  releasedManifests === null
    ? registryVersion(name)
    : releasedManifests.get(name)?.manifest.version

const publishable = (entry) => entry !== undefined && entry.manifest.private !== true
const failures = []
const inspected = []

// The union: a package that STOPS being publishable is itself a consumer-visible
// change, so it cannot be dropped from the comparison by the flag that hides it.
const names = [
  ...new Set(
    [...baseManifests.entries(), ...headManifests.entries()]
      .filter(([name]) => publishable(baseManifests.get(name)) || publishable(headManifests.get(name)))
      .map(([name]) => name),
  ),
].sort()

for (const name of names) {
  const baseEntry = baseManifests.get(name)
  const headEntry = headManifests.get(name)
  if (!headEntry) {
    inspected.push(`${name}: removed from the workspace; nothing left to version`)
    continue
  }
  if (!baseEntry) {
    inspected.push(`${headEntry.path}: new publishable package at ${headEntry.manifest.version}`)
    continue
  }

  const changes = surfaceChanges(
    surfaceOf(baseEntry, baseWorkspace.catalogs),
    surfaceOf(headEntry, headWorkspace.catalogs),
  )

  const baseRecord = surfaceAtRef(mergeBase, baseEntry.path)
  const headRecord = surfaceAtRef(head, headEntry.path)
  if (headRecord === null) {
    // Fail closed rather than pass a package whose symbols nothing states. A
    // missing record is indistinguishable from a surface that never changes.
    failures.push({
      path: headEntry.path,
      name,
      baseVersion: baseEntry.manifest.version,
      headVersion: headEntry.manifest.version,
      changes,
      missingRecord: surfaceRecordPath(
        headEntry.path === 'package.json' ? '' : dirname(headEntry.path),
      ),
    })
    continue
  }
  // A record appearing for the first time states the surface as it already is,
  // so there is nothing yet to have changed against.
  const exportChanges =
    baseRecord === null
      ? { added: [], removed: [], narrowed: [], widened: [], changed: [] }
      : compareSurfaces(baseRecord.surface, headRecord.surface)
  const severity = surfaceSeverity(exportChanges)
  const exportLines = [
    ...exportChanges.removed.map((change) => `export removed: ${change}`),
    ...exportChanges.narrowed.map((change) => `export narrowed: ${change}`),
    ...exportChanges.changed.map((change) => `export shape changed: ${change}`),
    ...exportChanges.added.map((change) => `export added: ${change}`),
    ...exportChanges.widened.map((change) => `export kind changed: ${change}`),
  ]

  if (changes.length === 0 && exportLines.length === 0) {
    inspected.push(`${headEntry.path}: consumer surface unchanged at ${headEntry.manifest.version}`)
    continue
  }

  // Measure the bump against the last PUBLISHED version. When the base already
  // carries a bump nobody can resolve yet, that bump pays for this change too;
  // when the base's version is on the registry, it pays for nothing.
  const releasedVersion = releasedVersionOf(name)
  const absorbing =
    releasedVersion !== undefined && isHigher(releasedVersion, baseEntry.manifest.version)
  const comparisonVersion = absorbing ? releasedVersion : baseEntry.manifest.version

  // The manifest rule asks only for a higher version; the export rule asks for a
  // level. The stronger of the two governs.
  const requiredLevel = (() => {
    const forExports = requiredBumpLevel(severity, comparisonVersion)
    const forManifest = changes.length > 0 ? 'patch' : 'none'
    return rankOf(forExports) >= rankOf(forManifest) ? forExports : forManifest
  })()
  const paidLevel = versionBumpLevel(comparisonVersion, headEntry.manifest.version)

  if (rankOf(paidLevel) >= rankOf(requiredLevel)) {
    inspected.push(
      `${headEntry.path}: ${changes.length} manifest and ${exportLines.length} export change(s) ` +
        `needing a ${requiredLevel} bump, paid for by ` +
        `${comparisonVersion} -> ${headEntry.manifest.version} (${paidLevel})` +
        (absorbing ? ` — ${comparisonVersion} is the last published version (${releasedFrom})` : ''),
    )
    continue
  }
  failures.push({
    path: headEntry.path,
    name,
    baseVersion: baseEntry.manifest.version,
    comparisonVersion,
    absorbing,
    headVersion: headEntry.manifest.version,
    changes: [...changes, ...exportLines],
    requiredLevel,
    paidLevel,
    severity,
  })
}

if (failures.length > 0) {
  const lines = ['A consumer-visible change must ship under a higher version.', '']
  for (const failure of failures) {
    if (failure.missingRecord) {
      lines.push(
        `${failure.path} (${failure.name}) publishes entry points but ${failure.missingRecord} ` +
          'does not exist, so a change to its exported symbols cannot be seen here.',
        '  Generate it with: pnpm run build && pnpm run api:surface',
        '',
      )
      continue
    }
    const versionState = (() => {
      if (failure.comparisonVersion === failure.headVersion) {
        return `still declares ${failure.headVersion}`
      }
      const move = `moves ${failure.comparisonVersion} -> ${failure.headVersion}`
      return rankOf(failure.paidLevel) === 0
        ? `${move}, which is not higher`
        : `${move}, only a ${failure.paidLevel} bump`
    })()
    const severityLabel = failure.severity === 'none' ? 'manifest-only' : failure.severity
    lines.push(
      `${failure.path} (${failure.name}) ${versionState}, but against ${baseLabel} it makes ` +
        `${severityLabel === 'additive' ? 'an' : 'a'} ${severityLabel} change needing a ` +
        `${failure.requiredLevel} bump:`,
    )
    if (failure.absorbing) {
      lines.push(
        `  measured against the last published version ${failure.comparisonVersion} ` +
          `(${releasedFrom}); the base declares ${failure.baseVersion}, which is not published yet`,
      )
    }
    for (const change of failure.changes) lines.push(`  ${change}`)
    lines.push('')
  }
  // The command a repository actually uses to set a version, read from its own
  // manifest rather than named here, so this file stays identical across repos.
  const rootManifest = JSON.parse(fileAtRef(head, 'package.json') ?? '{}')
  const bumpCommand =
    rootManifest.scripts?.['release:prepare'] === undefined
      ? '  set "version" in package.json'
      : '  pnpm run release:prepare <next-version>   (root package)'
  lines.push(
    'A version already on the registry cannot be corrected by re-tagging — publish.yml',
    'skips it — so this change would never reach a consumer.',
    '',
    'Bump the version in the same pull request:',
    bumpCommand,
    'and add the CHANGELOG entry that says what a consumer must do differently.',
  )
  process.stderr.write(`${lines.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(
  `${[
    `Consumer-visible package surfaces carry their version bumps (against ${baseLabel}).`,
    ...inspected.map((line) => `  ${line}`),
  ].join('\n')}\n`,
)
