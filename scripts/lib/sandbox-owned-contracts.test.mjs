import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sandboxOwnedContractCopies } from './sandbox-owned-contracts.mjs'
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-contract-guard-'))
  roots.push(root)
  const scope = join(root, '@tangle-network')
  mkdirSync(scope)
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
  it.each(['0.60.49', '0.60.50', '0.60.51', '0.60.53', '0.60.58'])('rejects changed bytes for the qualified standalone Sandbox %s tuple', (version) => {
    const { scope, write } = fixture()
    write(join(scope, 'sandbox'), version)
    write(join(scope, 'agent-interface'), '5.2.1')
    write(join(scope, 'agent-core'), '0.12.0')
    const nested = join(scope, 'sandbox', 'node_modules', '@tangle-network')
    write(join(nested, 'agent-interface'), '4.0.0')
    write(join(nested, 'agent-core'), '0.11.0')
    expect(() => sandboxOwnedContractCopies(scope)).toThrow(/changed Sandbox contract artifact/)
  })
})
