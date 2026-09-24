import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertFirstPartyRangeSpecs,
  assertPeerMatchesDevelopmentDependency,
  assertSingleRegistryInstall,
  cohortRange,
  currentMinorPeerRange,
  isExactVersionSpec,
  rangeAdmits,
} from './packed-package-test.mjs'
import {
  evalCompatibilityVersions,
  evalPeerRange,
  peerCompatibility,
  peerWindowVersions,
  sandboxCompatibilityVersions,
  sandboxPeerRange,
} from './dependency-contract.mjs'

const sandboxVersion = sandboxCompatibilityVersions[0]
if (sandboxVersion === undefined) throw new Error('Sandbox compatibility version is missing')
const [sandboxMajor, sandboxMinor] = sandboxVersion.split('.').map(Number)
const priorSandboxVersion = `${sandboxMajor}.${sandboxMinor - 1}.0`
const sandboxCeiling = /<(\d+)\.(\d+)\.0\b/u.exec(sandboxPeerRange)
if (sandboxCeiling === undefined) throw new Error('Sandbox peer ceiling is missing')
const nextSandboxVersion = `${sandboxCeiling[1]}.${sandboxCeiling[2]}.0`
const latestSandboxVersion = sandboxCompatibilityVersions.at(-1)
if (latestSandboxVersion === undefined) throw new Error('Sandbox compatibility version is missing')

describe('isExactVersionSpec', () => {
  it('reads a bare version as exact', () => {
    expect(isExactVersionSpec('1.0.0')).toBe(true)
    expect(isExactVersionSpec('0.145.21')).toBe(true)
    expect(isExactVersionSpec('1.0.0-rc.1')).toBe(true)
  })

  it('reads every range shape as not exact', () => {
    expect(isExactVersionSpec('^1.0.0')).toBe(false)
    expect(isExactVersionSpec(sandboxPeerRange)).toBe(false)
    expect(isExactVersionSpec('~1.0.0')).toBe(false)
    expect(isExactVersionSpec('catalog:')).toBe(false)
    expect(isExactVersionSpec('workspace:^')).toBe(false)
  })
})

describe('cohortRange', () => {
  it('returns a range unchanged', () => {
    expect(cohortRange('^1.0.0')).toBe('^1.0.0')
    expect(cohortRange(sandboxPeerRange)).toBe(sandboxPeerRange)
  })

  it('derives the range an exact version earns', () => {
    expect(cohortRange('1.2.3')).toBe('^1.2.3')
    expect(cohortRange('0.29.0')).toBe('>=0.29.0 <0.30.0')
  })
})

describe('rangeAdmits', () => {
  it('admits inside a caret range and refuses the next major', () => {
    expect(rangeAdmits('^1.0.0', '1.4.2')).toBe(true)
    expect(rangeAdmits('^1.2.0', '1.1.9')).toBe(false)
    expect(rangeAdmits('^1.0.0', '2.0.0')).toBe(false)
  })

  it('admits a zero-major caret only within its minor', () => {
    expect(rangeAdmits('^0.49.0', '0.49.0')).toBe(true)
    expect(rangeAdmits('^0.49.0', '0.49.1')).toBe(true)
    expect(rangeAdmits('^0.49.0', '0.50.0')).toBe(false)
    expect(rangeAdmits('>=0.36.4 <0.48.0 || ^0.49.0', '0.48.0')).toBe(false)
  })

  it('admits prereleases only at the declared caret base', () => {
    const snapshot = '0.49.0-l9.20260924035255.062dd6f'
    expect(rangeAdmits('^0.49.0', snapshot)).toBe(false)
    expect(rangeAdmits(sandboxPeerRange, snapshot)).toBe(true)
    expect(rangeAdmits(sandboxPeerRange, '0.49.0')).toBe(true)
    expect(rangeAdmits(sandboxPeerRange, '0.49.1-l9.1')).toBe(false)
    expect(rangeAdmits(sandboxPeerRange, '0.48.0')).toBe(false)
    expect(rangeAdmits(sandboxPeerRange, '0.50.0-0')).toBe(false)
    expect(rangeAdmits('>=0.36.4 <0.48.0', '0.47.0-l9.1')).toBe(false)
  })

  it('admits inside a minor window and refuses the next minor', () => {
    expect(rangeAdmits('>=0.145.21 <0.146.0', '0.145.22')).toBe(true)
    expect(rangeAdmits('>=0.145.21 <0.146.0', '0.145.20')).toBe(false)
    expect(rangeAdmits('>=0.145.21 <0.146.0', '0.146.0')).toBe(false)
  })

  it('admits the published Eval and Sandbox cohorts', () => {
    expect(rangeAdmits('>=0.149.0 <0.150.0', '0.149.0')).toBe(true)
    expect(rangeAdmits('>=0.149.0 <0.150.0', '0.150.0')).toBe(false)
    expect(rangeAdmits(sandboxPeerRange, priorSandboxVersion)).toBe(false)
    expect(rangeAdmits(sandboxPeerRange, sandboxVersion)).toBe(true)
    expect(rangeAdmits(sandboxPeerRange, latestSandboxVersion)).toBe(true)
    expect(rangeAdmits(sandboxPeerRange, nextSandboxVersion)).toBe(false)
  })

  it('refuses an exact specifier, which states no range', () => {
    expect(rangeAdmits('0.145.21', '0.145.21')).toBe(false)
  })
})

describe('assertFirstPartyRangeSpecs', () => {
  it('accepts a manifest whose first-party specifiers are all ranges', () => {
    expect(() =>
      assertFirstPartyRangeSpecs({
        name: '@tangle-network/agent-bench',
        dependencies: {
          '@tangle-network/agent-interface': '^1.0.0',
          '@tangle-network/agent-eval': '>=0.149.0 <0.150.0',
          'tar-stream': '3.2.0',
        },
        peerDependencies: { '@tangle-network/sandbox': sandboxPeerRange },
      }),
    ).not.toThrow()
  })

  it('names every exact first-party pin it refuses', () => {
    let message = ''
    try {
      assertFirstPartyRangeSpecs({
        name: '@tangle-network/agent-bench',
        dependencies: {
          '@tangle-network/agent-interface': '1.0.0',
          '@tangle-network/agent-runtime': '0.137.0',
        },
        peerDependencies: { '@tangle-network/sandbox': '^0.29.0' },
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('dependencies.@tangle-network/agent-interface = 1.0.0')
    expect(message).toContain('dependencies.@tangle-network/agent-runtime = 0.137.0')
    expect(message).not.toContain('sandbox')
  })

  it('ignores a third-party exact pin, which duplicates nothing first-party', () => {
    expect(() =>
      assertFirstPartyRangeSpecs({
        name: '@tangle-network/agent-runtime',
        dependencies: { 'tar-stream': '3.2.0' },
      }),
    ).not.toThrow()
  })
})

describe('compatibility peer ranges', () => {
  const priorSandboxRange = currentMinorPeerRange(priorSandboxVersion)

  it('admits a broader upstream window only when it includes the selected version', () => {
    const name = '@tangle-network/agent-eval'
    const range = '>=0.174.0 <0.176.0'
    const manifest = {
      name: '@tangle-network/agent-knowledge',
      devDependencies: { [name]: '0.175.0' },
      peerDependencies: { [name]: range },
    }
    expect(() => assertPeerMatchesDevelopmentDependency(manifest, name, {
      expectedRange: range,
      admittedVersions: ['0.174.0', '0.175.0'],
    })).not.toThrow()
    expect(() => assertPeerMatchesDevelopmentDependency(manifest, name, {
      expectedRange: range,
      admittedVersions: ['0.176.0'],
    })).toThrow(/does not admit 0.176.0/)
    expect(() => assertPeerMatchesDevelopmentDependency(manifest, name)).toThrow(
      /must match its resolved development dependency/,
    )
  })

  it('accepts the current Sandbox cohort with the exact development pin', () => {
    expect(() =>
      assertPeerMatchesDevelopmentDependency(
        {
          name: '@tangle-network/agent-runtime',
          devDependencies: { '@tangle-network/sandbox': sandboxVersion },
          peerDependencies: { '@tangle-network/sandbox': sandboxPeerRange },
        },
        '@tangle-network/sandbox',
        {
          expectedRange: sandboxPeerRange,
          admittedVersions: sandboxCompatibilityVersions,
        },
      ),
    ).not.toThrow()
  })

  it('rejects a compatibility range that drops the current Sandbox cohort', () => {
    expect(() =>
      assertPeerMatchesDevelopmentDependency(
        {
          name: '@tangle-network/agent-runtime',
          devDependencies: { '@tangle-network/sandbox': sandboxVersion },
          peerDependencies: { '@tangle-network/sandbox': priorSandboxRange },
        },
        '@tangle-network/sandbox',
        {
          expectedRange: priorSandboxRange,
          admittedVersions: sandboxCompatibilityVersions,
        },
      ),
    ).toThrow(new RegExp(`does not admit ${sandboxVersion.replaceAll('.', '\\.')}`))
  })
})

describe('Eval peer window', () => {
  const name = '@tangle-network/agent-eval'
  const runtimeManifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  )

  it('adds every earlier admitted minor to the development pin and nothing past it', () => {
    expect(peerWindowVersions(name, '>=0.183.0 <0.185.0', '0.184.0')).toEqual(['0.183.0'])
    expect(peerWindowVersions(name, '>=0.184.0 <0.185.0', '0.184.0')).toEqual([])
    expect(peerWindowVersions(name, '>=0.185.0 <0.188.0', '0.187.0')).toEqual([
      '0.185.0',
      '0.186.0',
    ])
    expect(() => peerWindowVersions(name, '>=0.183.0 <0.186.0', '0.184.0')).toThrow(
      /must end at its development minor: expected >=0\.183\.0 <0\.185\.0/,
    )
    expect(() => peerWindowVersions(name, '>=0.183.0 <0.184.0', '0.184.0')).toThrow(
      /must end at its development minor/,
    )
    expect(() => peerWindowVersions(name, '>=0.181.0 <0.185.0', '0.184.0')).toThrow(
      /reaches back more than two minors/,
    )
    expect(() => peerWindowVersions(name, '>=0.99.0 <1.1.0', '1.0.0')).toThrow(
      /reaches back more than two minors/,
    )
    expect(() => peerWindowVersions(name, '>=0.183.0 <0.185.0', '>=0.184.0')).toThrow(
      /must be developed against an exact stable version/,
    )
    expect(() => peerWindowVersions(name, '>=0.183.0 <0.185.0', '0.184.1-rc.1')).toThrow(
      /must be developed against an exact stable version, found 0\.184\.1-rc\.1/,
    )
  })

  it('refuses a floor above the development pin', () => {
    expect(() => peerWindowVersions(name, '>=0.184.5 <0.185.0', '0.184.0')).toThrow(
      /peer >=0\.184\.5 <0\.185\.0 does not admit its development pin 0\.184\.0/,
    )
    expect(() => peerWindowVersions(name, '>=0.185.0 <0.185.0', '0.184.0')).toThrow(
      /does not admit its development pin/,
    )
    expect(peerWindowVersions(name, '>=0.184.1 <0.185.0', '0.184.1')).toEqual([])
    expect(peerWindowVersions(name, '>=0.184.0 <0.185.0', '0.184.3')).toEqual(['0.184.0'])
  })

  it("accepts Runtime's own manifest only through the declared window", () => {
    expect(evalPeerRange).toBe(runtimeManifest.peerDependencies[name])
    for (const version of [runtimeManifest.devDependencies[name], ...evalCompatibilityVersions]) {
      expect(rangeAdmits(evalPeerRange, version)).toBe(true)
    }
    expect(() =>
      assertPeerMatchesDevelopmentDependency(runtimeManifest, name, peerCompatibility[name]),
    ).not.toThrow()
    if (evalCompatibilityVersions.length > 0) {
      expect(() => assertPeerMatchesDevelopmentDependency(runtimeManifest, name)).toThrow(
        /must match its resolved development dependency/,
      )
    }
  })
})

describe('registry peer install', () => {
  const name = '@tangle-network/agent-eval'
  const roots = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  // A pnpm-shaped consumer: store copies under .pnpm, the top-level entry a symlink into one.
  function consumer(storeVersions, linked) {
    const appDir = mkdtempSync(join(tmpdir(), 'registry-install-'))
    roots.push(appDir)
    const copies = storeVersions.map((version, index) => {
      const dir = join(appDir, 'node_modules', '.pnpm', `copy-${index}`, 'node_modules', name)
      mkdirSync(dir, { recursive: true })
      return { version, path: dir }
    })
    mkdirSync(join(appDir, 'node_modules', '@tangle-network'), { recursive: true })
    symlinkSync(copies[linked].path, join(appDir, 'node_modules', name))
    return { appDir, copies }
  }

  it('accepts one physical copy at the exact version, reached by every occurrence', () => {
    const { appDir, copies } = consumer(['0.183.0'], 0)
    const resolved = new Map([[name, [copies[0], { ...copies[0], path: join(appDir, 'node_modules', name) }]]])
    expect(assertSingleRegistryInstall(appDir, resolved, name, '0.183.0')).toBe('0.183.0')
  })

  it('refuses a missing, mismatched or duplicated install', () => {
    const { appDir, copies } = consumer(['0.183.0', '0.183.0'], 0)
    expect(() => assertSingleRegistryInstall(appDir, new Map(), name, '0.183.0')).toThrow(
      /did not resolve @tangle-network\/agent-eval/,
    )
    expect(() =>
      assertSingleRegistryInstall(appDir, new Map([[name, [{ ...copies[0], version: '0.184.0' }]]]), name, '0.183.0'),
    ).toThrow(/resolved @tangle-network\/agent-eval@0\.184\.0, expected 0\.183\.0/)
    expect(() => assertSingleRegistryInstall(appDir, new Map([[name, [copies[1]]]]), name, '0.183.0')).toThrow(
      /installed 2 physical copies/,
    )
  })
})
