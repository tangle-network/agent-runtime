import { satisfies, valid } from 'semver'
import { sandboxCompatibilityVersions, sandboxPeerRange } from './dependency-contract.mjs'

const unsupportedDependencyProtocol = /^(?:catalog|file|link|patch|portal|workspace):/

export { sandboxCompatibilityVersions, sandboxPeerRange }

export function assertPublishableDependencySpecs(packageJson) {
  const packageName =
    typeof packageJson.name === 'string' ? packageJson.name : 'packed package'
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(packageJson[section] ?? {})) {
      if (typeof spec !== 'string' || unsupportedDependencyProtocol.test(spec)) {
        throw new Error(
          `${packageName} packed ${section}.${name} is not publishable: ${String(spec)}`,
        )
      }
    }
  }
}

export function requiredPackedDevelopmentDependency(packageJson, name) {
  return requiredPackedPackageVersion(
    packageJson.devDependencies?.[name],
    name,
    packageJson.name,
  )
}

export function requiredPackedPackageVersion(version, name, owner) {
  if (
    typeof version !== 'string' ||
    !version ||
    unsupportedDependencyProtocol.test(version)
  ) {
    const packageName = typeof owner === 'string' ? owner : 'packed package'
    throw new Error(`${packageName} has no resolved ${name} dependency version`)
  }
  return version
}

export function currentMinorPeerRange(version) {
  const match = /^(\d+)\.(\d+)\.\d+(?:-.+)?$/.exec(version)
  if (!match) throw new Error(`cannot derive peer range from version ${version}`)
  return `>=${version} <${match[1]}.${Number(match[2]) + 1}.0`
}

/**
 * The peer range shape a dependency earns from its own versioning.
 *
 * From 1.0.0 a package states that a minor is additive and only a major removes
 * or narrows, so a caret range holds one installed copy across later minors. A
 * pre-1.0 package states no such promise, so its range still stops at the next
 * minor.
 */
export function expectedPeerRange(version) {
  const match = /^(\d+)\.\d+\.\d+(?:-.+)?$/.exec(version)
  if (!match) throw new Error(`cannot derive peer range from version ${version}`)
  return Number(match[1]) >= 1 ? `^${version}` : currentMinorPeerRange(version)
}

/** True when a specifier names one version and admits no other. */
export function isExactVersionSpec(spec) {
  return typeof spec === 'string' && valid(spec.trim()) !== null
}

/**
 * The cohort range a specifier states.
 *
 * A range states itself. An exact version states no range at all, so it is read
 * as the range its own versioning earns — the shape `expectedPeerRange` returns.
 */
export function cohortRange(spec) {
  if (typeof spec !== 'string' || spec.length === 0) {
    throw new Error(`cannot read a cohort range from ${String(spec)}`)
  }
  return isExactVersionSpec(spec) ? expectedPeerRange(spec.trim()) : spec
}

/** Use npm's version rules while keeping the cohort's no-exact-pin policy. */
export function rangeAdmits(range, version) {
  return typeof range === 'string' && !isExactVersionSpec(range) && satisfies(version, range)
}

/**
 * The published first-party specifiers a consumer resolves against.
 *
 * An exact version here forces a second physical copy of the named package for
 * every consumer that already holds a later one, so every first-party
 * specifier a consumer can read must be a range.
 */
export function assertFirstPartyRangeSpecs(packageJson, scope = '@tangle-network/') {
  const packageName =
    typeof packageJson.name === 'string' ? packageJson.name : 'packed package'
  const exact = []
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(packageJson[section] ?? {})) {
      if (!name.startsWith(scope)) continue
      if (isExactVersionSpec(spec)) exact.push(`${section}.${name} = ${spec}`)
    }
  }
  if (exact.length > 0) {
    throw new Error(
      `${packageName} publishes exact first-party version pins, which duplicate the package for every consumer already holding a later one:\n${exact
        .map((entry) => `  ${entry}`)
        .join('\n')}\nDeclare a range instead: a caret from 1.0.0, or ">=X.Y.Z <X.Y+1.0" below it.`,
    )
  }
}

export function assertPeerMatchesDevelopmentDependency(packageJson, name, options = {}) {
  const version = requiredPackedDevelopmentDependency(packageJson, name)
  const expected = options.expectedRange ?? cohortRange(version)
  const actual = packageJson.peerDependencies?.[name]
  if (actual !== expected) {
    const packageName =
      typeof packageJson.name === 'string' ? packageJson.name : 'packed package'
    throw new Error(
      `${packageName} peerDependencies.${name} must match its resolved development dependency: expected ${expected}, found ${String(actual)}`,
    )
  }
  const admittedVersions = [
    ...(isExactVersionSpec(version) ? [version] : []),
    ...(options.admittedVersions ?? []),
  ]
  const rejectedVersions = [...new Set(admittedVersions)].filter(
    (candidate) => !rangeAdmits(actual, candidate),
  )
  if (rejectedVersions.length > 0) {
    const packageName =
      typeof packageJson.name === 'string' ? packageJson.name : 'packed package'
    throw new Error(
      `${packageName} peerDependencies.${name} does not admit ${rejectedVersions.join(', ')}`,
    )
  }
}

export function createStrictNodeConsumerTsconfig(options = {}) {
  return {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      ...(options.outputDirectory
        ? { outDir: options.outputDirectory }
        : { noEmit: true }),
      skipLibCheck: false,
      types: ['node'],
    },
    include: ['consumer.ts'],
  }
}
