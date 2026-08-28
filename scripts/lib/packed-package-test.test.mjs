import { describe, expect, it } from 'vitest'
import {
  assertFirstPartyRangeSpecs,
  assertPeerMatchesDevelopmentDependency,
  cohortRange,
  currentMinorPeerRange,
  isExactVersionSpec,
  rangeAdmits,
} from './packed-package-test.mjs'
import { sandboxCompatibilityVersions, sandboxPeerRange } from './dependency-contract.mjs'

const sandboxVersion = sandboxCompatibilityVersions[0]
if (sandboxVersion === undefined) throw new Error('Sandbox compatibility version is missing')
const [sandboxMajor, sandboxMinor] = sandboxVersion.split('.').map(Number)
const priorSandboxVersion = `${sandboxMajor}.${sandboxMinor - 1}.0`
const nextSandboxVersion = `${sandboxMajor}.${sandboxMinor + 1}.0`

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
