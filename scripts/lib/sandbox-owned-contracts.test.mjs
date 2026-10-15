import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sandboxContractArtifact, sandboxOwnedContractCopies } from './sandbox-owned-contracts.mjs'
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-contract-guard-'))
  roots.push(root)
  const scope = join(root, 'node_modules', '@tangle-network')
  mkdirSync(scope, { recursive: true })
  const write = (path, version) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(
      join(path, 'package.json'),
      JSON.stringify({ name: `@tangle-network/${basename(path)}`, version }),
    )
  }
  return { scope, write }
}
describe('Sandbox-owned contract qualification', () => {
  it('does not exempt copies owned by another package', () => {
    const { scope, write } = fixture()
    write(join(scope, 'another', 'node_modules', '@tangle-network', 'agent-interface'), '3.2.0')
    expect([...sandboxOwnedContractCopies(scope)]).toEqual([])
  })
  it('fails closed for a different Sandbox version', () => {
    const { scope, write } = fixture()
    write(join(scope, 'sandbox'), '0.60.42')
    write(join(scope, 'sandbox', 'node_modules', '@tangle-network', 'agent-interface'), '3.2.0')
    expect(() => sandboxOwnedContractCopies(scope)).toThrow(/unqualified Sandbox contract artifact/)
  })
  it('rejects changed artifact bytes even with qualified versions', () => {
    const { scope, write } = fixture()
    write(join(scope, 'sandbox'), '0.60.41')
    write(join(scope, 'agent-interface'), '5.0.0')
    write(join(scope, 'agent-core'), '0.12.0')
    const nested = join(scope, 'sandbox', 'node_modules', '@tangle-network')
    write(join(nested, 'agent-interface'), '3.2.0')
    write(join(nested, 'agent-core'), '0.10.3')
    writeFileSync(join(nested, 'agent-interface', 'index.js'), '')
    writeFileSync(join(nested, 'agent-core', 'index.js'), '')
    writeFileSync(
      join(scope, 'sandbox', 'unexpected.js'),
      "import * as contracts from '@tangle-network/agent-interface'",
    )
    expect(() => sandboxOwnedContractCopies(scope)).toThrow(/changed Sandbox contract artifact/)
  })
  it.each(['0.60.49', '0.60.50', '0.60.51', '0.60.53'])('rejects changed bytes for the qualified standalone Sandbox %s tuple', (version) => {
    const { scope, write } = fixture()
    write(join(scope, 'sandbox'), version)
    write(join(scope, 'agent-interface'), '5.2.1')
    write(join(scope, 'agent-core'), '0.12.0')
    const nested = join(scope, 'sandbox', 'node_modules', '@tangle-network')
    write(join(nested, 'agent-interface'), '4.0.0')
    write(join(nested, 'agent-core'), '0.11.0')
    expect(() => sandboxOwnedContractCopies(scope)).toThrow(/changed Sandbox contract artifact/)
  })
  it.each([['0.60.49', '5.3.0'], ['0.60.58', '5.3.0'], ['0.60.49', '5.3.1'], ['0.60.58', '5.3.1']])('rejects changed bytes for Sandbox %s / Interface %s', (version, interfaceVersion) => {
    const { scope, write } = fixture()
    write(join(scope, 'sandbox'), version)
    write(join(scope, 'agent-interface'), interfaceVersion)
    write(join(scope, 'agent-core'), '0.12.0')
    const ownedCore = join(scope, 'sandbox', 'node_modules', '@tangle-network', 'agent-core')
    write(ownedCore, '0.11.0')
    const interfaceOwner = version === '0.60.58' ? ownedCore : join(scope, 'sandbox')
    write(join(interfaceOwner, 'node_modules', '@tangle-network', 'agent-interface'), '4.0.0')
    expect(() => sandboxOwnedContractCopies(scope)).toThrow(/changed Sandbox contract artifact/)
  })
  it('measures a deduped interface and SDK-owned core without admitting an unknown tuple', () => {
    const { scope, write } = fixture()
    write(join(scope, 'sandbox'), '0.60.999')
    write(join(scope, 'agent-interface'), '5.3.0')
    write(join(scope, 'agent-core'), '0.12.0')
    const ownedCore = join(scope, 'sandbox', 'node_modules', '@tangle-network', 'agent-core')
    write(ownedCore, '0.11.0')
    writeFileSync(join(scope, 'agent-interface', 'index.js'), 'export {}')
    writeFileSync(join(ownedCore, 'index.js'), 'export {}')
    const artifact = sandboxContractArtifact(scope)
    expect(artifact.cohort.map(([path, version]) => [path, version])).toEqual([
      ['sandbox', '0.60.999'],
      ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0'],
      ['agent-interface', '5.3.0'],
      ['agent-core', '0.12.0'],
    ])
    expect(artifact.resolutions).toEqual([
      ['sandbox', 'agent-interface', 'agent-interface/index.js'],
      ['sandbox', 'agent-core', 'sandbox/node_modules/@tangle-network/agent-core/index.js'],
      ['sandbox/node_modules/@tangle-network/agent-core', 'agent-interface', 'agent-interface/index.js'],
      ['agent-core', 'agent-interface', 'agent-interface/index.js'],
    ])
    for (const [, , hash] of artifact.cohort) expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(() => sandboxOwnedContractCopies(scope)).toThrow(/unqualified Sandbox contract artifact/)
    expect(() => sandboxOwnedContractCopies(scope)).toThrow(/Sandbox contract artifact:.*resolutions/)
  })
  it('records a Core-owned interface independently of the SDK direct interface', () => {
    const { scope, write } = fixture()
    write(join(scope, 'sandbox'), '0.60.999')
    write(join(scope, 'agent-interface'), '5.3.0')
    writeFileSync(join(scope, 'agent-interface', 'index.js'), 'export {}')
    const ownedCore = 'sandbox/node_modules/@tangle-network/agent-core'
    const ownedInterface = `${ownedCore}/node_modules/@tangle-network/agent-interface`
    write(join(scope, ownedCore), '0.11.0')
    write(join(scope, ownedInterface), '4.0.0')
    writeFileSync(join(scope, ownedCore, 'index.js'), 'export {}')
    writeFileSync(join(scope, ownedInterface, 'index.js'), 'export {}')
    const artifact = sandboxContractArtifact(scope)
    expect(artifact.cohort.map(([path]) => path)).toContain(ownedInterface)
    expect(artifact.resolutions).toContainEqual(['sandbox', 'agent-interface', 'agent-interface/index.js'])
    expect(artifact.resolutions).toContainEqual([ownedCore, 'agent-interface', `${ownedInterface}/index.js`])
    expect(() => sandboxOwnedContractCopies(scope)).toThrow(/unqualified Sandbox contract artifact/)
  })
  it('fingerprints own bytes independently of SDK-owned dependency bytes', () => {
    const { scope, write } = fixture()
    write(join(scope, 'sandbox'), '0.60.999')
    const ownedCore = join(scope, 'sandbox', 'node_modules', '@tangle-network', 'agent-core')
    write(ownedCore, '0.11.0')
    const before = sandboxContractArtifact(scope)
    writeFileSync(join(ownedCore, 'index.js'), 'export const changed = true')
    const after = sandboxContractArtifact(scope)
    expect(after.cohort[0]).toEqual(before.cohort[0])
    expect(after.cohort[1][2]).not.toEqual(before.cohort[1][2])
    expect(JSON.stringify(after)).not.toContain('export const changed')
  })
  it('refuses symlinked artifact contents during qualification diagnostics', () => {
    const { scope, write } = fixture()
    write(join(scope, 'sandbox'), '0.60.999')
    symlinkSync(join(scope, 'sandbox', 'package.json'), join(scope, 'sandbox', 'linked.json'))
    expect(() => sandboxContractArtifact(scope)).toThrow(/unqualified package symlink/)
  })

})
