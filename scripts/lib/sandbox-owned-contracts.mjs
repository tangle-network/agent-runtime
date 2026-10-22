import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { rangeAdmits } from './packed-package-test.mjs'

// Sandbox qualifies by the contract copies it carries, not by its own package bytes.
// Runtime refuses proxySecrets and candidate secret-ref config values because the SDK's private
// Interface 4.0.0 cannot carry them. That refusal is sound only while Sandbox's private copies,
// and the shared copies it resolves, are the reviewed bytes below, so an installed Sandbox passes when:
// - its version is inside the peer range the installed Runtime declares for @tangle-network/sandbox;
// - all four contract copies match one tuple below by version and fingerprint;
// - Sandbox resolves each private name inside its own nested copy.
// A Sandbox patch with unchanged contract bytes passes without review; Sandbox's own code is not
// fingerprinted here. A new Sandbox minor still needs a reviewed peer-range change.
// Qualification is limited to the Linux npm packed-consumer layout used by this gate.
// Keep unknown versions and changed bytes fail-closed.
const qualifiedContractTuples = [
  [
    ['agent-interface', '5.7.0', '4f662a47917b3057a4f38b4fbf719e8a97590b9d9213c80dd36a7cafa6ea1e0f'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
  ],
  // The shared agent-core moved to 0.13.1 with the stack (agent-runtime #1994, agent-eval #1054); the SDK-private
  // copies the refusal depends on are unchanged.
  [
    ['agent-interface', '5.7.0', '4f662a47917b3057a4f38b4fbf719e8a97590b9d9213c80dd36a7cafa6ea1e0f'],
    ['agent-core', '0.13.1', '0837760f6e9dd26299e93247ce5db351ee94a09a38838b23c7c71074e60daece'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
  ],
]

function ownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.name !== 'node_modules').flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`unqualified package symlink: ${path}`)
    return entry.isDirectory() ? ownFiles(path) : [path]
  })
}

/** The sha256 over a package's own files, excluding node_modules, in path order. */
export function contractFingerprint(directory) {
  const hash = createHash('sha256')
  for (const file of ownFiles(directory).sort()) {
    const bytes = readFileSync(file)
    hash.update(`${relative(directory, file)}\0${bytes.length}\0`).update(bytes)
  }
  return hash.digest('hex')
}

function readManifest(directory) {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
}

/** Exempt only these exact SDK-owned implementation copies from the Runtime cohort count. */
export function sandboxOwnedContractCopies(scopeDir, tuples = qualifiedContractTuples) {
  const nested = tuples[0].slice(2).map(([path]) => join(scopeDir, path))
  if (nested.every(path => !existsSync(path))) return new Set()
  const sandbox = readManifest(join(scopeDir, 'sandbox'))
  const runtimeDir = join(scopeDir, 'agent-runtime')
  const peerRange = existsSync(runtimeDir)
    ? readManifest(runtimeDir).peerDependencies?.['@tangle-network/sandbox']
    : undefined
  if (!rangeAdmits(peerRange, sandbox.version)) {
    throw new Error(
      `unqualified Sandbox contract artifact: sandbox@${sandbox.version} outside the Runtime peer range ${peerRange ?? '(none declared)'}`,
    )
  }
  // Narrow one position at a time so the refusal names the first copy no qualified tuple holds.
  let candidates = tuples
  for (const [index, [path]] of tuples[0].entries()) {
    const directory = join(scopeDir, path)
    const manifest = readManifest(directory)
    candidates = candidates.filter(tuple => tuple[index][1] === manifest.version)
    if (manifest.name !== `@tangle-network/${path.split('/').at(-1)}` || candidates.length === 0) {
      throw new Error(`unqualified Sandbox contract artifact: ${path}@${manifest.version}`)
    }
    const fingerprint = contractFingerprint(directory)
    candidates = candidates.filter(tuple => tuple[index][2] === fingerprint)
    if (candidates.length === 0) throw new Error(`changed Sandbox contract artifact: ${path}`)
  }
  const sdk = createRequire(join(scopeDir, 'sandbox', 'package.json'))
  for (const directory of nested) {
    const name = directory.split('/').at(-1)
    if (!sdk.resolve(`@tangle-network/${name}`).startsWith(`${directory}/`)) {
      throw new Error(`Sandbox resolves ${name} outside its qualified owned copy`)
    }
  }
  return new Set(nested)
}
