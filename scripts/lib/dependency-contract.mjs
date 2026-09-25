import { execFileSync } from 'node:child_process'
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

function stableVersionTuple(version) {
  const match = /^(\\d+)\\.(\\d+)\\.(\\d+)$/.exec(version)
  return match ? match.slice(1).map(Number) : null
}

function compareVersions(left, right) {
  const a = stableVersionTuple(left)
  const b = stableVersionTuple(right)
  if (a === null || b === null) return left.localeCompare(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

function rangeAdmitsStable(range, version) {
  const target = stableVersionTuple(version)
  if (target === null) return false
  const order = ([major, minor, patch]) => major * 1_000_000_000_000 + minor * 1_000_000 + patch
  return range.split('||').some((rawClause) => {
    const clause = rawClause.trim()
    const window = /^>=(\\d+\\.\\d+\\.\\d+)\\s+<(\\d+\\.\\d+\\.\\d+)$/.exec(clause)
    if (window) {
      return order(target) >= order(stableVersionTuple(window[1])) && order(target) < order(stableVersionTuple(window[2]))
    }
    const caret = /^\\^(\\d+)\\.(\\d+)\\.(\\d+)(?:-0)?$/.exec(clause)
    if (!caret) return false
    const floor = caret.slice(1).map(Number)
    if (order(target) < order(floor) || target[0] !== floor[0]) return false
    if (floor[0] > 0) return true
    if (target[1] !== floor[1]) return false
    return floor[1] > 0 ? target[2] >= floor[2] : target[2] === floor[2]
  })
}

function publishedCompatibilityVersions(name, range) {
  const raw = execFileSync('npm', ['view', name, 'versions', '--json', '--registry=https://registry.npmjs.org'], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  const published = JSON.parse(raw)
  if (!Array.isArray(published)) throw new Error(`npm returned no version list for ${name}`)
  const admitted = published.filter((version) => rangeAdmitsStable(range, version)).sort(compareVersions)
  if (admitted.length === 0) throw new Error(`npm has no published ${name} version admitted by ${range}`)

  // Exercise the exact floor and the newest published patch in every admitted minor.
  // This is derived from npm on every cohort run, so a newly published admitted minor
  // cannot wait for a hand edit in Runtime before it is tested.
  const floor = peerFloor(name, range)
  const selected = new Set(admitted.includes(floor) ? [floor] : [])
  const newestByMinor = new Map()
  for (const version of admitted) {
    const [major, minor] = stableVersionTuple(version)
    newestByMinor.set(`${major}.${minor}`, version)
  }
  for (const version of newestByMinor.values()) selected.add(version)
  return [...selected].sort(compareVersions)
}

export const sandboxCompatibilityVersions = Object.freeze(
  publishedCompatibilityVersions('@tangle-network/sandbox', sandboxPeerRange),
)

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
