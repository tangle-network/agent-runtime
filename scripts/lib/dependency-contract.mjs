import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const runtimePackage = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'),
)

function declaredPeerRange(name) {
  const range = runtimePackage.peerDependencies?.[name]
  if (typeof range !== 'string' || range.length === 0) {
    throw new Error(`Runtime package.json must declare the ${name} peer range`)
  }
  return range
}

function peerFloor(name, range) {
  const floor = /^(?:>=|\^)(\d+\.\d+\.\d+)\b/u.exec(range)?.[1]
  if (floor === undefined) throw new Error(`cannot derive ${name} compatibility version from ${range}`)
  return floor
}

const sandboxPeerRange = declaredPeerRange('@tangle-network/sandbox')

export { sandboxPeerRange }
// The newest Sandbox may be packed from a pinned ADC cut before npm serves it.
export const sandboxCompatibilityVersions = Object.freeze([
  peerFloor('@tangle-network/sandbox', sandboxPeerRange),
  '0.43.0',
  '0.46.0',
  '0.47.0',
  '0.49.0',
  '0.50.0',
  '0.51.0',
  '0.52.0',
])

/**
 * The registry versions a peer window adds to its exact development pin.
 *
 * A window ends at the minor Runtime develops against: no later minor has run this code.
 * It may reach back two minors, to versions consumers still hold. The packed cohort
 * installs every earlier minor, so none of the admitted minors is left unrun.
 */
export function peerWindowVersions(name, range, developmentVersion) {
  const development = /^(\d+)\.(\d+)\.(\d+)$/u.exec(developmentVersion ?? '')
  if (development === null) {
    throw new Error(
      `${name} must be developed against an exact stable version, found ${String(developmentVersion)}`,
    )
  }
  const [devMajor, devMinor, devPatch] = development.slice(1).map(Number)
  const floor = peerFloor(name, range)
  const window = `>=${floor} <${devMajor}.${devMinor + 1}.0`
  if (range !== window) {
    throw new Error(`${name} peer must end at its development minor: expected ${window}, found ${range}`)
  }
  const [floorMajor, floorMinor, floorPatch] = floor.split('.').map(Number)
  if (floorMajor !== devMajor || floorMinor < devMinor - 2) {
    throw new Error(
      `${name} peer ${range} reaches back more than two minors from ${developmentVersion}`,
    )
  }
  if (floorMinor > devMinor || (floorMinor === devMinor && floorPatch > devPatch)) {
    throw new Error(`${name} peer ${range} does not admit its development pin ${developmentVersion}`)
  }
  const registryVersions = floor === developmentVersion ? [] : [floor]
  for (let minor = floorMinor + 1; minor < devMinor; minor += 1) {
    registryVersions.push(`${devMajor}.${minor}.0`)
  }
  return registryVersions
}

const evalPeerRange = declaredPeerRange('@tangle-network/agent-eval')

export { evalPeerRange }
// Each version here is installed from the registry beside the packed Runtime, so every
// earlier admitted minor runs as well as the development pin in the packed cohort.
export const evalCompatibilityVersions = Object.freeze(
  peerWindowVersions(
    '@tangle-network/agent-eval',
    evalPeerRange,
    runtimePackage.devDependencies?.['@tangle-network/agent-eval'],
  ),
)

/**
 * The declared range and verified versions for peers admitted beyond the development pin.
 * Every other first-party peer must equal its development minor.
 */
export const peerCompatibility = Object.freeze({
  '@tangle-network/agent-eval': Object.freeze({
    expectedRange: evalPeerRange,
    admittedVersions: evalCompatibilityVersions,
  }),
  '@tangle-network/sandbox': Object.freeze({
    expectedRange: sandboxPeerRange,
    admittedVersions: sandboxCompatibilityVersions,
  }),
})
