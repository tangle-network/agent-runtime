import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'

// Exact published artifacts: 47 SDK imports / 30 shared modules were independently
// verified, then the packed behavioral fixture proved profile/control/usage parity.
// Qualification is limited to the Linux npm packed-consumer layout used by this gate.
// Remove this temporary adapter boundary when Sandbox adopts the Runtime cohort.
const qualified = [
  ['sandbox', '0.60.41', '5b2f978e58af165f50248f41f92fd5a5406b70e8faa34331154de6dae7787ef2'],
  ['agent-interface', '5.0.0', '8f40f58b7f3c67e15648de88763770e0aee8a4eaea1fa7ce6f28993f5b572bf9'],
  ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
  ['sandbox/node_modules/@tangle-network/agent-interface', '3.2.0', '662d92cd1d64f200cb7c4725e291700dd3ea42a44888039ade450080c2be0c9b'],
  ['sandbox/node_modules/@tangle-network/agent-core', '0.10.3', '19d424cdd6693a3f06831cfc929790ec6e5e5ddd7ad1faf6beffdd658d73cd4b'],
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
  const nested = qualified.slice(3).map(([path]) => join(scopeDir, path))
  if (nested.every(path => !existsSync(path))) return new Set()
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
