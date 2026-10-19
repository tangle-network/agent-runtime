import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'

// Exact published package tuples, qualified at the Runtime/Sandbox adapter boundary.
// The .41 tuple has byte-identical shared contracts. The .49, .50, .51, .53 and .58 tuples preserve
// shared execution fields and explicitly refuse unresolved Interface 5.2 knowledge pins. The
// .58 tuple with Interface 5.3.1 and the .78 and .86 tuples with Interface 5.7.0 rely on Runtime refusing
// proxySecrets and candidate secret-ref config values, which the SDK's private Interface 4.0.0
// cannot carry.
// Qualification is limited to the Linux npm packed-consumer layout used by this gate.
// Keep unknown versions and changed bytes fail-closed.
const qualifiedArtifacts = {
  sandbox0_60_41: ['sandbox', '0.60.41', '5b2f978e58af165f50248f41f92fd5a5406b70e8faa34331154de6dae7787ef2'],
  interface5_0_0: ['agent-interface', '5.0.0', '8f40f58b7f3c67e15648de88763770e0aee8a4eaea1fa7ce6f28993f5b572bf9'],
  core0_12_0: ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
  sdkInterface3_2_0: ['sandbox/node_modules/@tangle-network/agent-interface', '3.2.0', '662d92cd1d64f200cb7c4725e291700dd3ea42a44888039ade450080c2be0c9b'],
  sdkCore0_10_3: ['sandbox/node_modules/@tangle-network/agent-core', '0.10.3', '19d424cdd6693a3f06831cfc929790ec6e5e5ddd7ad1faf6beffdd658d73cd4b'],
  sandbox0_60_49: ['sandbox', '0.60.49', '9811efcaaab04ea8e23b903accb415ff550eb4d3ef6dfa51fb7e542545ee2be5'],
  interface5_2_0: ['agent-interface', '5.2.0', '48c44c1d837212f0bd39f4cb6d61943abfe423ff374fed94ed1095ecabda49f2'],
  sdkInterface4_0_0: ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
  sdkCore0_11_0: ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
  sandbox0_60_50: ['sandbox', '0.60.50', '43b9e1447249905254ddb9462c405fdd609a4faef7a34a432b97919c2be7dc37'],
  interface5_2_1: ['agent-interface', '5.2.1', '8b7fb911efa58195c926f9a7f1e76db0edaf2bf57f086531304fdc10d5e3b559'],
  sandbox0_60_51: ['sandbox', '0.60.51', '38b7cb3029e294acb0c796fe9d33ebc31d176b09ab5a7028b2217d0ec0c45b6b'],
  sandbox0_60_53: ['sandbox', '0.60.53', 'c2f7faf11b8e001f81774a61f3a41196f41f669762777fba3435f2a3e4c021f9'],
  sandbox0_60_58: ['sandbox', '0.60.58', 'd0c68868c1f07c64a44d84bc9dd8b1e6546579acda2db01b142940f6f2004c29'],
  interface5_3_1: ['agent-interface', '5.3.1', '75aaca3eadc2f4cc9c34eb00fcd88aa11e5ba08fb829af291943468c7b016e4f'],
  sandbox0_60_78: ['sandbox', '0.60.78', 'cb70896cbc503522b16507fa63d9379d5e52d600cdd4dbe6e9a34f4806c523f3'],
  sandbox0_60_86: ['sandbox', '0.60.86', '05a17e2dd4639131483ac8a1d8988ff6436e635ea4752a3284ec4a2be1ba351d'],
  sandbox0_60_92: ['sandbox', '0.60.92', '6c8ebac02172ef6f24314af1577a7b10b16a491b67c268f02b573e05f9223960'],
  sandbox0_61_1: ['sandbox', '0.61.1', '2737278289167746503ffdd6de809e54a96232b3a4d754d3c002a9d26a0651dd'],
  sandbox0_62_2: ['sandbox', '0.62.2', '0cb9efb38e5fac4a2247865603cda9dbeca538f4f13bc1dcba4540a83facde54'],
  sandbox0_62_14: ['sandbox', '0.62.14', '6ed6617560e63e0f68590239d1b0f867cf1b1011c18ba8a101398aae9184e8c0'],
  interface5_7_0: ['agent-interface', '5.7.0', '4f662a47917b3057a4f38b4fbf719e8a97590b9d9213c80dd36a7cafa6ea1e0f'],
}

// Only these reviewed combinations may share the artifact records above.
const qualifiedCohorts = [
  ['sandbox0_60_41', 'interface5_0_0', 'core0_12_0', 'sdkInterface3_2_0', 'sdkCore0_10_3'],
  ['sandbox0_60_49', 'interface5_2_0', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_60_50', 'interface5_2_0', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_60_49', 'interface5_2_1', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_60_50', 'interface5_2_1', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_60_51', 'interface5_2_1', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_60_53', 'interface5_2_1', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_60_58', 'interface5_2_1', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_60_58', 'interface5_3_1', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_60_78', 'interface5_7_0', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_60_86', 'interface5_7_0', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_60_92', 'interface5_7_0', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_61_1', 'interface5_7_0', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_62_2', 'interface5_7_0', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
  ['sandbox0_62_14', 'interface5_7_0', 'core0_12_0', 'sdkInterface4_0_0', 'sdkCore0_11_0'],
].map(cohort => cohort.map(artifact => qualifiedArtifacts[artifact]))

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
