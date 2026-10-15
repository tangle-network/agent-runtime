import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'

// Exact immutable package tuples, qualified at the Runtime/Sandbox adapter boundary.
// The .41 tuple has byte-identical shared contracts. The .49, .50, .51 and .53 tuples preserve
// shared execution fields and explicitly refuse unresolved Interface 5.2 knowledge pins.
// The .58 rows distinguish the published legacy SDK and active frozen candidate by exact bytes.
// The published legacy .58 requires refusal of proxySecrets and secret-ref config values
// its private Interface 4 cannot carry; the frozen candidate exercises positive custody.
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
  [
    ['sandbox', '0.60.51', '38b7cb3029e294acb0c796fe9d33ebc31d176b09ab5a7028b2217d0ec0c45b6b'],
    ['agent-interface', '5.2.1', '8b7fb911efa58195c926f9a7f1e76db0edaf2bf57f086531304fdc10d5e3b559'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
  ],
  [
    ['sandbox', '0.60.53', 'c2f7faf11b8e001f81774a61f3a41196f41f669762777fba3435f2a3e4c021f9'],
    ['agent-interface', '5.2.1', '8b7fb911efa58195c926f9a7f1e76db0edaf2bf57f086531304fdc10d5e3b559'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
  ],
  [
    ['sandbox', '0.60.49', '9811efcaaab04ea8e23b903accb415ff550eb4d3ef6dfa51fb7e542545ee2be5'],
    ['agent-interface', '5.3.1', '75aaca3eadc2f4cc9c34eb00fcd88aa11e5ba08fb829af291943468c7b016e4f'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
  ],
  [
    ['sandbox', '0.60.58', 'ff6d93d95da2ebd13929ac6b709973d04864fc861cb1e7e842114e6b58731d04'],
    ['agent-interface', '5.3.1', '75aaca3eadc2f4cc9c34eb00fcd88aa11e5ba08fb829af291943468c7b016e4f'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
    ['sandbox/node_modules/@tangle-network/agent-core/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
  ],
  [
    ['sandbox', '0.60.58', 'd0c68868c1f07c64a44d84bc9dd8b1e6546579acda2db01b142940f6f2004c29'],
    ['agent-interface', '5.2.1', '8b7fb911efa58195c926f9a7f1e76db0edaf2bf57f086531304fdc10d5e3b559'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
  ],
  [
    ['sandbox', '0.60.58', 'd0c68868c1f07c64a44d84bc9dd8b1e6546579acda2db01b142940f6f2004c29'],
    ['agent-interface', '5.3.1', '75aaca3eadc2f4cc9c34eb00fcd88aa11e5ba08fb829af291943468c7b016e4f'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
  ],
  [
    ['sandbox', '0.60.59', '952ea347f7b669ce320049f1bece98e3c2a0c565ede6d091cd3d49ab02dc398c'],
    ['agent-interface', '5.3.1', '75aaca3eadc2f4cc9c34eb00fcd88aa11e5ba08fb829af291943468c7b016e4f'],
    ['agent-core', '0.12.0', '81c0e698c4f08418cdbf7aa4901a5278d23b5cdac3d35260504b2112d3e4999e'],
    ['sandbox/node_modules/@tangle-network/agent-core', '0.11.0', '3c7f492ef60b48ea3019fec28c5084ac1a903d6f3f5517bf18b34487b17435f8'],
    ['sandbox/node_modules/@tangle-network/agent-interface', '4.0.0', '8eb4a8aa8a0a7650df79fbc147b166e4380a7058f5890165b4dd304372405668'],
  ],
]

function ownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.name !== 'node_modules').flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`unqualified package symlink: ${path}`)
    return entry.isDirectory() ? ownFiles(path) : [path]
  })
}

function fingerprint(directory) {
  const hash = createHash('sha256')
  for (const file of ownFiles(directory).sort()) {
    const bytes = readFileSync(file)
    hash.update(`${relative(directory, file)}\0${bytes.length}\0`).update(bytes)
  }
  return hash.digest('hex')
}

function contractResolvers(scopeDir, cohort) {
  return cohort.flatMap(([owner]) => {
    const names = owner === 'sandbox' ? ['agent-interface', 'agent-core']
      : owner.split('/').at(-1) === 'agent-core' ? ['agent-interface'] : []
    const loader = createRequire(join(scopeDir, owner, 'package.json'))
    return names.map(name => ({ owner, name, loader }))
  })
}

// Artifact diagnostics contain declarations, content hashes and resolution paths;
// they never contain package file contents or credential values.
export function sandboxContractArtifact(scopeDir) {
  const cohort = []
  const visit = path => {
    const directory = join(scopeDir, path)
    if (!existsSync(directory)) return
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    cohort.push([path, manifest.version, fingerprint(directory)])
    for (const name of ['agent-interface', 'agent-core']) {
      visit(`${path}/node_modules/@tangle-network/${name}`)
    }
  }
  for (const path of ['sandbox', 'agent-interface', 'agent-core']) visit(path)
  const resolutions = contractResolvers(scopeDir, cohort).map(({ owner, name, loader }) => {
    try {
      return [owner, name, relative(scopeDir, loader.resolve(`@tangle-network/${name}`))]
    } catch (error) {
      return [owner, name, error.code]
    }
  })
  return { cohort, resolutions }
}

/** Exempt only these exact SDK-owned implementation copies from the Runtime cohort count. */
export function sandboxOwnedContractCopies(scopeDir) {
  const sdkScope = join(scopeDir, 'sandbox', 'node_modules', '@tangle-network')
  if (!['agent-interface', 'agent-core'].some(name => existsSync(join(sdkScope, name)))) {
    return new Set()
  }
  try {
    const sandbox = JSON.parse(readFileSync(join(scopeDir, 'sandbox', 'package.json'), 'utf8'))
    const candidates = qualifiedCohorts.filter(cohort => cohort[0][1] === sandbox.version)
    if (candidates.length === 0) {
      throw new Error(`unqualified Sandbox contract artifact: sandbox@${sandbox.version}`)
    }
    const agentInterface = JSON.parse(readFileSync(join(scopeDir, 'agent-interface', 'package.json'), 'utf8'))
    const interfaceCandidates = candidates.filter(cohort => cohort[1][1] === agentInterface.version)
    if (interfaceCandidates.length === 0) {
      throw new Error(
        `unqualified Sandbox contract artifact: sandbox@${sandbox.version} with agent-interface@${agentInterface.version}`,
      )
    }
    const sandboxFingerprint = fingerprint(join(scopeDir, 'sandbox'))
    const qualified = interfaceCandidates.find(cohort => cohort[0][2] === sandboxFingerprint)
    if (!qualified) throw new Error('changed Sandbox contract artifact: sandbox')
    for (const [path, version, expectedFingerprint] of qualified) {
      const directory = join(scopeDir, path)
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      if (manifest.name !== `@tangle-network/${path.split('/').at(-1)}` || manifest.version !== version) {
        throw new Error(`unqualified Sandbox contract artifact: ${path}@${manifest.version}`)
      }
      const actualFingerprint = path === 'sandbox' ? sandboxFingerprint : fingerprint(directory)
      if (actualFingerprint !== expectedFingerprint) {
        throw new Error(`changed Sandbox contract artifact: ${path}`)
      }
    }
    const nested = qualified.slice(3).map(([path]) => join(scopeDir, path))
    const directories = new Set(qualified.map(([path]) => join(scopeDir, path)))
    for (const { owner, name, loader } of contractResolvers(scopeDir, qualified)) {
      const specifier = `@tangle-network/${name}`
      const directory = loader.resolve.paths(specifier)
        .map(path => join(path, specifier)).find(path => directories.has(path))
      if (!directory || !loader.resolve(specifier).startsWith(`${directory}/`)) {
        throw new Error(`${owner} resolves ${name} outside its qualified copy`)
      }
    }
    return new Set(nested)
  } catch (error) {
    let diagnostic
    try {
      diagnostic = JSON.stringify(sandboxContractArtifact(scopeDir))
    } catch (inspectionError) {
      diagnostic = `artifact inspection failed: ${inspectionError.message}`
    }
    throw new Error(`${error.message}\nSandbox contract artifact: ${diagnostic}`, { cause: error })
  }
}
