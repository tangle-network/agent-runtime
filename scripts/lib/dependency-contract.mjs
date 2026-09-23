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
// Registry checks require published artifacts, so this matrix names only versions npm serves.
// The peer ceiling runs ahead of it: 0.47.0 is admitted on its source diff against 0.46.0 —
// 325 insertions, 0 deletions, a new delete-matching module plus additions to client, index and
// types — so nothing this runtime consumes can have changed. Add 0.47.0 here once it publishes.
export const sandboxCompatibilityVersions = Object.freeze([
  sandboxFloor,
  '0.43.0',
  '0.46.0',
])
