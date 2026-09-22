import { describe, expect, it } from 'vitest'

import { assertEgressEnforced } from './assert-enforced'
import {
  buildEgressProbeScript,
  gradeControlArm,
  gradeEnforcedArm,
  parseEgressProbeOutput,
} from './probe'

const record = (id: string, target: string, status: string, detail = ''): string =>
  `EGRESS-PROBE\t${id}\t${target}\t${status}\t${detail}`

const enforcedOutput = [
  record('clone', 'https://github.com/psf/requests.git', 'blocked', 'git clone exit 128'),
  record('blocked:github.com', 'github.com', 'blocked', 'proxy denied (http=403)'),
  record('blocked:codeload.github.com', 'codeload.github.com', 'blocked', 'proxy denied'),
  record('blocked:raw.githubusercontent.com', 'raw.githubusercontent.com', 'blocked', 'denied'),
  record('blocked:pypi.org', 'pypi.org', 'blocked', 'denied'),
  record('blocked:registry.npmjs.org', 'registry.npmjs.org', 'blocked', 'denied'),
  record('blocked:api.anthropic.com', 'api.anthropic.com', 'blocked', 'denied'),
  record('allowed:router.tangle.tools', 'router.tangle.tools', 'reached', 'http=200'),
  record('bypass:raw-tcp', '1.1.1.1:443', 'blocked', 'Network unreachable'),
].join('\n')

describe('the probe program', () => {
  it('refuses to be built with nothing that must stay reachable', () => {
    expect(() => buildEgressProbeScript({ allowed: [], blocked: ['github.com'] })).toThrow(
      /at least one allowed host/,
    )
  })

  it('always checks the built-in blocked list even when the caller names none', () => {
    const script = buildEgressProbeScript({ allowed: ['router.tangle.tools'], blocked: [] })
    for (const host of ['github.com', 'pypi.org', 'registry.npmjs.org', 'api.anthropic.com']) {
      expect(script).toContain(`blocked:${host}`)
    }
  })

  it('quotes hostile targets rather than interpolating them into the shell', () => {
    const script = buildEgressProbeScript({
      allowed: ['router.tangle.tools'],
      blocked: [],
      graded: "https://x.dev/a'; touch /tmp/pwned; #",
    })
    expect(script).not.toContain('; touch /tmp/pwned; #\n')
    expect(script).toContain(`'https://x.dev/a'\\''; touch /tmp/pwned; #'`)
  })
})

describe('grading', () => {
  it('passes an arm that blocked everything and kept the model reachable', () => {
    expect(gradeEnforcedArm(parseEgressProbeOutput(enforcedOutput)).enforced).toBe(true)
  })

  it('fails when a blocked host was reached', () => {
    const leaked = enforcedOutput.replace(
      record('blocked:github.com', 'github.com', 'blocked', 'proxy denied (http=403)'),
      record('blocked:github.com', 'github.com', 'reached', 'http=200'),
    )
    const verdict = gradeEnforcedArm(parseEgressProbeOutput(leaked))
    expect(verdict.enforced).toBe(false)
    expect(verdict.failures[0]).toMatch(/blocked:github.com: expected blocked, observed reached/)
  })

  it('treats a missing tool as a failure, never a vacuous pass', () => {
    const noGit = enforcedOutput.replace(
      record('clone', 'https://github.com/psf/requests.git', 'blocked', 'git clone exit 128'),
      record('clone', 'https://github.com/psf/requests.git', 'tool-missing', 'git absent'),
    )
    expect(gradeEnforcedArm(parseEgressProbeOutput(noGit)).enforced).toBe(false)
  })

  it('fails a silent probe — no records means it never ran', () => {
    expect(gradeEnforcedArm([]).enforced).toBe(false)
  })

  it('fails an arm with no reachability check, which cannot be told from a dead network', () => {
    const noAllowed = parseEgressProbeOutput(enforcedOutput).filter(
      (r) => !r.id.startsWith('allowed:'),
    )
    expect(gradeEnforcedArm(noAllowed).failures.join()).toMatch(/no allowed-host check ran/)
  })

  it('does not gate on DNS, which a CONNECT-time filter legitimately allows to resolve', () => {
    const withDns = `${enforcedOutput}\n${record('dns:github.com', 'github.com', 'reached', 'resolved')}`
    expect(gradeEnforcedArm(parseEgressProbeOutput(withDns)).enforced).toBe(true)
  })

  it('requires the negative control to actually reach the graded repository', () => {
    expect(gradeControlArm(parseEgressProbeOutput(enforcedOutput)).enforced).toBe(false)
    const control = record('clone', 'https://github.com/psf/requests.git', 'reached', 'ok')
    expect(gradeControlArm(parseEgressProbeOutput(control)).enforced).toBe(true)
  })
})

describe('assertEgressEnforced', () => {
  const modelHosts = ['router.tangle.tools']

  it('refuses to certify an open policy', async () => {
    await expect(
      assertEgressEnforced({
        policy: { mode: 'open', reason: 'trusted' },
        modelHosts,
        run: async () => ({ stdout: '', exitCode: 0 }),
      }),
    ).rejects.toThrow(/nothing to enforce/)
  })

  it('rejects a boundary that kept the implicit domain list', async () => {
    await expect(
      assertEgressEnforced({
        policy: { mode: 'gateway' },
        modelHosts,
        readPolicy: async () => ({
          mode: 'strict',
          allowDomains: ['router.tangle.tools'],
          includeImplicitDomains: true,
        }),
        run: async () => ({ stdout: enforcedOutput, exitCode: 0 }),
      }),
    ).rejects.toThrow(/retained implicit domains/)
  })

  it('rejects a boundary whose read-back allowlist differs from what was requested', async () => {
    await expect(
      assertEgressEnforced({
        policy: { mode: 'gateway' },
        modelHosts,
        readPolicy: async () => ({
          mode: 'strict',
          allowDomains: ['github.com'],
          includeImplicitDomains: false,
        }),
        run: async () => ({ stdout: enforcedOutput, exitCode: 0 }),
      }),
    ).rejects.toThrow(/differs from the requested allowlist/)
  })

  it('rejects a boundary that reads back correctly but leaks in practice', async () => {
    const leaked = enforcedOutput.replace(
      record('clone', 'https://github.com/psf/requests.git', 'blocked', 'git clone exit 128'),
      record('clone', 'https://github.com/psf/requests.git', 'reached', 'clone succeeded'),
    )
    await expect(
      assertEgressEnforced({
        policy: { mode: 'gateway' },
        modelHosts,
        readPolicy: async () => ({
          mode: 'strict',
          allowDomains: ['router.tangle.tools'],
          includeImplicitDomains: false,
        }),
        run: async () => ({ stdout: leaked, exitCode: 0 }),
      }),
    ).rejects.toThrow(/is NOT enforced in this environment/)
  })

  it('accepts a boundary that both reads back and behaves correctly', async () => {
    const verdict = await assertEgressEnforced({
      policy: { mode: 'gateway' },
      modelHosts,
      readPolicy: async () => ({
        mode: 'strict',
        allowDomains: ['router.tangle.tools'],
        includeImplicitDomains: false,
      }),
      run: async () => ({ stdout: enforcedOutput, exitCode: 0 }),
    })
    expect(verdict.enforced).toBe(true)
  })

  it('moves the model host into the denied set under a blocked policy', async () => {
    const script: string[] = []
    const blockedOutput = [
      record('blocked:github.com', 'github.com', 'blocked', 'denied'),
      record('blocked:router.tangle.tools', 'router.tangle.tools', 'blocked', 'denied'),
    ].join('\n')
    const verdict = await assertEgressEnforced({
      policy: { mode: 'blocked' },
      modelHosts,
      run: async (s) => {
        script.push(s)
        return { stdout: blockedOutput, exitCode: 0 }
      },
    })
    expect(verdict.enforced).toBe(true)
    expect(script[0]).toContain('blocked:router.tangle.tools')
    expect(script[0]).not.toContain('allowed:router.tangle.tools')
  })

  it('fails a blocked policy whose model host is still reachable', async () => {
    await expect(
      assertEgressEnforced({
        policy: { mode: 'blocked' },
        modelHosts,
        run: async () => ({
          stdout: record(
            'blocked:router.tangle.tools',
            'router.tangle.tools',
            'reached',
            'http=200',
          ),
          exitCode: 0,
        }),
      }),
    ).rejects.toThrow(/blocked:router.tangle.tools: expected blocked, observed reached/)
  })
})
