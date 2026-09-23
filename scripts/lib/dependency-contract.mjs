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
  const floor = /^>=(\d+\.\d+\.\d+)\b/u.exec(range)?.[1]
  if (floor === undefined) throw new Error(`cannot derive ${name} compatibility version from ${range}`)
  return floor
}

const sandboxPeerRange = declaredPeerRange('@tangle-network/sandbox')

export { sandboxPeerRange }
// Registry checks require published artifacts, so this matrix names only versions npm serves.
// The peer ceiling runs ahead of it: 0.47.0 is admitted on its source diff against 0.46.0 —
// 325 insertions, 0 deletions, a new delete-matching module plus additions to client, index and
// types — so nothing this runtime consumes can have changed. Add 0.47.0 here once it publishes.
export const sandboxCompatibilityVersions = Object.freeze([
  peerFloor('@tangle-network/sandbox', sandboxPeerRange),
  '0.43.0',
  '0.46.0',
])

/**
 * The registry versions a peer window adds to its exact development pin.
 *
 * A window may reach back to minors that consumers still hold, but it ends at the minor
 * Runtime develops against: no later minor has run this code.
 */
export function peerWindowVersions(name, range, developmentVersion) {
  const development = /^(\d+)\.(\d+)\.\d+$/u.exec(developmentVersion ?? '')
  if (development === null) {
    throw new Error(`${name} must be developed against an exact version, found ${String(developmentVersion)}`)
  }
  const floor = peerFloor(name, range)
  const window = `>=${floor} <${development[1]}.${Number(development[2]) + 1}.0`
  if (range !== window) {
    throw new Error(`${name} peer must end at its development minor: expected ${window}, found ${range}`)
  }
  return floor === developmentVersion ? [] : [floor]
}

const evalPeerRange = declaredPeerRange('@tangle-network/agent-eval')

export { evalPeerRange }
// Each version here is installed from the registry beside the packed Runtime, so the window's
// floor runs as well as the development pin that the source build and packed cohort use.
export const evalCompatibilityVersions = Object.freeze(
  peerWindowVersions(
    '@tangle-network/agent-eval',
    evalPeerRange,
    runtimePackage.devDependencies?.['@tangle-network/agent-eval'],
  ),
)

/**
 * The declared window and verified versions for each peer whose range is wider than the
 * development minor. Every other first-party peer must equal its development minor.
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
