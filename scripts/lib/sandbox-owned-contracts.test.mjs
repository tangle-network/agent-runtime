import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contractFingerprint, sandboxOwnedContractCopies } from './sandbox-owned-contracts.mjs'
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const peerRange = '>=0.62.14 <0.62.16 || >=0.63.10 <0.65.0'
const contractPaths = [
  ['agent-interface', '5.7.0'],
  ['agent-core', '0.12.0'],
  ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0'],
  ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0'],
]
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-contract-guard-'))
  roots.push(root)
  const scope = join(root, '@tangle-network')
  mkdirSync(scope)
  const write = (path, version, extra = {}) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(
      join(path, 'package.json'),
      JSON.stringify({ name: `@tangle-network/${basename(path)}`, version, ...extra }),
    )
    writeFileSync(join(path, 'index.js'), `module.exports = ${JSON.stringify(path)}\n`)
  }
  return { scope, write }
}
// An npm packed-consumer layout whose four contract copies are qualified by their own fingerprints.
function packedLayout(sandboxVersion) {
  const { scope, write } = fixture()
  write(join(scope, 'agent-runtime'), '0.342.0', {
    peerDependencies: { '@tangle-network/sandbox': peerRange },
  })
  write(join(scope, 'sandbox'), sandboxVersion)
  for (const [path, version] of contractPaths) write(join(scope, path), version)
  const tuple = contractPaths.map(([path, version]) => [path, version, contractFingerprint(join(scope, path))])
  return { scope, tuple }
}
const nestedCopies = scope => contractPaths.slice(2).map(([path]) => join(scope, path))
describe('Sandbox-owned contract qualification', () => {
  it('does not exempt copies owned by another package', () => {
    const { scope, write } = fixture()
    write(join(scope, 'another', 'node_modules', '@tangle-network', 'agent-interface'), '4.0.0')
    expect([...sandboxOwnedContractCopies(scope)]).toEqual([])
  })
  it('qualifies an in-range Sandbox whose own files changed but whose contract copies did not', () => {
    const { scope, tuple } = packedLayout('0.64.0')
    writeFileSync(join(scope, 'sandbox', 'package.json'), JSON.stringify({ name: '@tangle-network/sandbox', version: '0.64.7' }))
    appendFileSync(join(scope, 'sandbox', 'index.js'), '// a Sandbox patch\n')
    writeFileSync(join(scope, 'sandbox', 'unreviewed.js'), 'export {}\n')
    expect([...sandboxOwnedContractCopies(scope, [tuple])]).toEqual(nestedCopies(scope))
  })
  it('refuses one changed byte in the nested agent-interface copy and names that copy', () => {
    const { scope, tuple } = packedLayout('0.64.1')
    appendFileSync(join(scope, 'sandbox', 'node_modules', '@tangle-network', 'agent-interface', 'index.js'), ' ')
    expect(() => sandboxOwnedContractCopies(scope, [tuple])).toThrow(
      /^changed Sandbox contract artifact: sandbox\/node_modules\/@tangle-network\/agent-interface$/,
    )
  })
  it.each(['0.65.0', '0.63.9', '0.62.16'])('refuses Sandbox %s outside the declared peer range', version => {
    const { scope, tuple } = packedLayout(version)
    expect(() => sandboxOwnedContractCopies(scope, [tuple])).toThrow(
      `unqualified Sandbox contract artifact: sandbox@${version} outside the Runtime peer range ${peerRange}`,
    )
  })
  it('refuses an unknown contract version and names that copy', () => {
    const { scope, tuple } = packedLayout('0.64.1')
    const unknown = tuple.map((entry, index) => (index === 3 ? [entry[0], '0.11.1', entry[2]] : entry))
    expect(() => sandboxOwnedContractCopies(scope, [unknown])).toThrow(
      'unqualified Sandbox contract artifact: sandbox/node_modules/@tangle-network/agent-core@0.11.0',
    )
  })
  it('refuses fixture bytes under the shipped qualified tuple', () => {
    const { scope } = packedLayout('0.64.1')
    expect(() => sandboxOwnedContractCopies(scope)).toThrow(/^changed Sandbox contract artifact: agent-interface$/)
  })
})
