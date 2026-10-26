import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isExactVersionSpec, rangeAdmits } from './packed-package-test.mjs'
import { firstPartyPackageDirs } from './first-party-package-tree.mjs'



export function assertSingleFirstPartyPackageVersion(scopeDir, packageName, expectedVersion) {
  const installations = firstPartyPackageDirs(scopeDir)
    .map((packageDir) => ({
      packageDir,
      packageJson: JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')),
    }))
    .filter(({ packageJson }) => packageJson.name === packageName)
  if (installations.length === 0) {
    throw new Error(`packed consumer did not install ${packageName}`)
  }
  // A packed catalog specifier is a range below 1.0, so the installed copy is
  // proven by admission; only an exact specifier names one version to match.
  const installedVersion = installations[0].packageJson.version
  const admits = isExactVersionSpec(expectedVersion)
    ? installedVersion === expectedVersion
    : rangeAdmits(expectedVersion, installedVersion)
  if (installations.length !== 1 || !admits) {
    throw new Error(
      [
        `packed consumer must load exactly one ${packageName}@${expectedVersion}; found ${installations.length} installed path(s)`,
        ...installations.map(
          ({ packageDir, packageJson }) =>
            `  - ${packageJson.version} at ${relative(scopeDir, packageDir)}`,
        ),
      ].join('\n'),
    )
  }
  process.stdout.write(
    `${packageName}: one ${expectedVersion} installation.\n`,
  )
}


export function assertPeerInstalled(scopeDir, packageName, peerRange) {
  const installations = firstPartyPackageDirs(scopeDir)
    .map((packageDir) => ({
      packageDir,
      packageJson: JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')),
    }))
    .filter(({ packageJson }) => packageJson.name === packageName)
  if (installations.length !== 1) {
    throw new Error(
      `standalone consumer must install exactly one ${packageName}; found ${installations.length}`,
    )
  }
  const installedVersion = installations[0].packageJson.version
  if (!rangeAdmits(peerRange, installedVersion)) {
    throw new Error(
      `standalone consumer installed ${packageName}@${installedVersion}, outside ${peerRange}`,
    )
  }
}
