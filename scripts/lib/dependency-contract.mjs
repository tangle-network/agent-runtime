import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const runtimePackage = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'),
)
const sandboxPeerRange = runtimePackage.peerDependencies?.['@tangle-network/sandbox']
if (typeof sandboxPeerRange !== 'string' || sandboxPeerRange.length === 0) {
  throw new Error('Runtime package.json must declare the Sandbox peer range')
}

const sandboxFloor = /^>=(\d+\.\d+\.\d+)\b/u.exec(sandboxPeerRange)?.[1]
if (sandboxFloor === undefined) {
  throw new Error(`cannot derive Sandbox compatibility version from ${sandboxPeerRange}`)
}

export { sandboxPeerRange }
export const sandboxCompatibilityVersions = Object.freeze([sandboxFloor])
