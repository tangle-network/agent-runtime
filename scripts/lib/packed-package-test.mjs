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

export function assertPeerMatchesDevelopmentDependency(packageJson, name) {
  const version = requiredPackedDevelopmentDependency(packageJson, name)
  const expected = currentMinorPeerRange(version)
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
