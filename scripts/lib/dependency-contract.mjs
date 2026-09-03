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

const sandboxCeilingMatch = /<(\d+)\.(\d+)\.0\b/u.exec(sandboxPeerRange)
const sandboxCurrentMinor = sandboxCeilingMatch === undefined
  ? undefined
  : `${sandboxCeilingMatch[1]}.${Number(sandboxCeilingMatch[2]) - 1}.0`

export { sandboxPeerRange }
export const sandboxCompatibilityVersions = Object.freeze([
  sandboxFloor,
  ...(sandboxCurrentMinor && sandboxCurrentMinor !== sandboxFloor ? [sandboxCurrentMinor] : []),
])
