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
