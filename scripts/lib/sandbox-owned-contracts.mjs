import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'

// Exact published package tuples, qualified at the Runtime/Sandbox adapter boundary.
// The .41 tuple has byte-identical shared contracts. The .49 and .50 tuples preserve
// shared execution fields and explicitly refuse unresolved Interface 5.2 knowledge pins.
// Qualification is limited to the Linux npm packed-consumer layout used by this gate.
// Keep unknown versions and changed bytes fail-closed.
const qualifiedCohorts = [
  [
    ['sandbox', '0.60.41', '5b2f978e58af165f50248f41f92fd5a5406b70e8faa34331154de6dae7787ef2'],
    ['agent-interface', '5.0.0', '8f40f58b7f3c67e15648de88763770e0aee8a4eaea1fa7ce6f28993f5b572bf9'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '3.2.0', '662d92cd1d64f200cb7c4725e291700dd3ea42a44888039ade450080c2be0c9b'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.10.3', '19d424cdd6693a3f06831cfc929790ec6e5e5ddd7ad1faf6beffdd658d73cd4b'],
  ],
  [
    ['sandbox', '0.60.49', '9811efcaaab04ea8e23b903accb415ff550eb4d3ef6dfa51fb7e542545ee2be5'],
    ['agent-interface', '5.2.0', '48c44c1d837212f0bd39f4cb6d61943abfe423ff374fed94ed1095ecabda49f2'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
  ],
  [
    ['sandbox', '0.60.50', '43b9e1447249905254ddb9462c405fdd609a4faef7a34a432b97919c2be7dc37'],
    ['agent-interface', '5.2.0', '48c44c1d837212f0bd39f4cb6d61943abfe423ff374fed94ed1095ecabda49f2'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
  ],
  [
    ['sandbox', '0.60.49', '9811efcaaab04ea8e23b903accb415ff550eb4d3ef6dfa51fb7e542545ee2be5'],
    ['agent-interface', '5.2.1', '8b7fb911efa58195c926f9a7f1e76db0edaf2bf57f086531304fdc10d5e3b559'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
  ],
  [
    ['sandbox', '0.60.50', '43b9e1447249905254ddb9462c405fdd609a4faef7a34a432b97919c2be7dc37'],
    ['agent-interface', '5.2.1', '8b7fb911efa58195c926f9a7f1e76db0edaf2bf57f086531304fdc10d5e3b559'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
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

/** Exempt only these exact SDK-owned implementation copies from the Runtime cohort count. */
export function sandboxOwnedContractCopies(scopeDir) {
  const nested = qualifiedCohorts[0].slice(3).map(([path]) => join(scopeDir, path))
  if (nested.every(path => !existsSync(path))) return new Set()
  const sandbox = JSON.parse(readFileSync(join(scopeDir, 'sandbox', 'package.json'), 'utf8'))
  const candidates = qualifiedCohorts.filter(cohort => cohort[0][1] === sandbox.version)
  if (candidates.length === 0) {
    throw new Error(`unqualified Sandbox contract artifact: sandbox@${sandbox.version}`)
  }
  const agentInterface = JSON.parse(readFileSync(join(scopeDir, 'agent-interface', 'package.json'), 'utf8'))
  const qualified = candidates.find(cohort => cohort[1][1] === agentInterface.version)
  if (!qualified) {
    throw new Error(
      `unqualified Sandbox contract artifact: sandbox@${sandbox.version} with agent-interface@${agentInterface.version}`,
    )
  }
  for (const [path, version, fingerprint] of qualified) {
    const directory = join(scopeDir, path)
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (manifest.name !== `@tangle-network/${path.split('/').at(-1)}` || manifest.version !== version) {
      throw new Error(`unqualified Sandbox contract artifact: ${path}@${manifest.version}`)
    }
    const hash = createHash('sha256')
    for (const file of ownFiles(directory).sort()) {
      const bytes = readFileSync(file)
      hash.update(`${relative(directory, file)}\0${bytes.length}\0`).update(bytes)
    }
    if (hash.digest('hex') !== fingerprint) throw new Error(`changed Sandbox contract artifact: ${path}`)
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
