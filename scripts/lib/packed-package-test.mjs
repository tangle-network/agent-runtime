const unsupportedDependencyProtocol = /^(?:catalog|file|link|patch|portal|workspace):/

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

/** A caret range admits a version when the major matches and the floor is at or below it. */
export function caretAdmits(range, version) {
  const floor = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range)
  const found = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (floor === null || found === null) return false
  const [floorMajor, floorMinor, floorPatch] = floor.slice(1).map(Number)
  const [major, minor, patch] = found.slice(1).map(Number)
  if (floorMajor < 1 || major !== floorMajor) return false
  return minor * 1_000_000 + patch >= floorMinor * 1_000_000 + floorPatch
}

export function assertPeerMatchesDevelopmentDependency(packageJson, name) {
  const version = requiredPackedDevelopmentDependency(packageJson, name)
  const expected = expectedPeerRange(version)
  const actual = packageJson.peerDependencies?.[name]
  if (actual !== expected) {
    const packageName =
      typeof packageJson.name === 'string' ? packageJson.name : 'packed package'
    throw new Error(
      `${packageName} peerDependencies.${name} must match its resolved development dependency: expected ${expected}, found ${String(actual)}`,
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
