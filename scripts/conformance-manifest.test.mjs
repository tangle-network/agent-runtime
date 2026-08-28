/**
 * A manifest that verifies when it should not is worthless, so these are
 * mutation tests: each one changes exactly one input a consumer trusts —
 * package bytes, cohort identity, a scenario result, or evidence bytes — and
 * requires verification to reject it. The last test pins determinism, because
 * an unstable digest makes every other check unfalsifiable.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildConformanceManifest,
  resolveCapabilities,
  sha256OfFile,
  verifyConformanceManifest,
} from './lib/conformance-manifest.mjs'

const capabilityMap = {
  schemaVersion: 'agent-runtime/conformance-capabilities/v1',
  capabilities: {
    'cancellation-acknowledgement': {
      scenario: 'stop-accepted',
      summary: 'cancellation is acknowledged once',
      evidence: [{ file: 'evidence/cancel.test.ts', cases: ['acknowledges cancellation once'] }],
    },
    'context-transfer': {
      scenario: 'accepted-transfer-receipt',
      summary: 'context moves between environments',
      evidence: [],
    },
  },
}

const passingResults = {
  'evidence/cancel.test.ts': { 'acknowledges cancellation once': 'passed' },
}

let workspace
let tarball
let cohortReport
let evidenceFile

function fileDigest() {
  return sha256OfFile(evidenceFile)
}

function manifestOf(results = passingResults) {
  return buildConformanceManifest({
    package: {
      name: '@tangle-network/agent-runtime',
      version: '0.143.0',
      sourceCommit: '6859ff58c0700000000000000000000000000000',
      sha256: sha256OfFile(tarball),
      buildIdentity: { capabilityMap: 'a'.repeat(64), packageManager: 'pnpm@11.17.0' },
    },
    cohort: cohort(),
    sandboxVersions: { peerRange: '>=0.34.0 <0.35.0', verified: ['0.34.0'] },
    environment: { node: 'v22.0.0', platform: 'linux-x64' },
    capabilities: resolveCapabilities(capabilityMap, results, fileDigest),
    verifiedBy: { tool: 'scripts/verify-conformance-manifest.mjs', version: '0.143.0' },
  })
}

function cohort() {
  return {
    packages: [
      {
        name: '@tangle-network/agent-runtime',
        version: '0.143.0',
        sourceCommit: '6859ff58c0700000000000000000000000000000',
        sha256: 'b'.repeat(64),
      },
    ],
    consumer: { install: 'pnpm install --frozen-lockfile', packageCount: 4 },
  }
}

function verify(manifest, overrides = {}) {
  return verifyConformanceManifest(manifest, {
    tarball,
    cohortReport,
    sourceRoot: workspace,
    readPackedManifest: () => JSON.stringify({ name: manifest.package.name, version: manifest.package.version }),
    ...overrides,
  })
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'conformance-manifest-'))
  execFileSync('mkdir', ['-p', join(workspace, 'evidence')])
  evidenceFile = join(workspace, 'evidence/cancel.test.ts')
  writeFileSync(evidenceFile, "it('acknowledges cancellation once', () => {})\n")
  tarball = join(workspace, 'agent-runtime-0.143.0.tgz')
  writeFileSync(tarball, 'packed archive bytes')
  cohortReport = join(workspace, 'cohort.json')
  writeFileSync(cohortReport, `${JSON.stringify(cohort(), null, 2)}\n`)
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('conformance manifest verification', () => {
  it('accepts the manifest it emitted, and reports unproven for a capability with no evidence', () => {
    const manifest = manifestOf()
    expect(verify(manifest)).toEqual({ ok: true, problems: [] })
    expect(manifest.capabilities['cancellation-acknowledgement'].status).toBe('supported')
    expect(manifest.capabilities['context-transfer'].status).toBe('unproven')
  })

  it('rejects changed package bytes', () => {
    const manifest = manifestOf()
    writeFileSync(tarball, 'packed archive bytes, mutated')
    try {
      const { ok, problems } = verify(manifest)
      expect(ok).toBe(false)
      expect(problems.join('\n')).toMatch(/packed archive sha256 .* does not match the manifest/)
    } finally {
      writeFileSync(tarball, 'packed archive bytes')
    }
  })

  it('rejects a packed archive whose identity is not the one the manifest claims', () => {
    const manifest = manifestOf()
    const { ok, problems } = verify(manifest, {
      readPackedManifest: () => JSON.stringify({ name: '@tangle-network/agent-runtime', version: '0.144.0' }),
    })
    expect(ok).toBe(false)
    expect(problems.join('\n')).toMatch(/packed archive is @tangle-network\/agent-runtime@0\.144\.0/)
  })

  it('rejects changed cohort identity', () => {
    const manifest = manifestOf()
    const mutated = cohort()
    mutated.packages[0].version = '0.144.0'
    writeFileSync(cohortReport, `${JSON.stringify(mutated, null, 2)}\n`)
    try {
      const { ok, problems } = verify(manifest)
      expect(ok).toBe(false)
      expect(problems.join('\n')).toMatch(/cohort identity does not match/)
    } finally {
      writeFileSync(cohortReport, `${JSON.stringify(cohort(), null, 2)}\n`)
    }
  })

  it('rejects a scenario result rewritten inside the manifest', () => {
    const manifest = manifestOf({ 'evidence/cancel.test.ts': { 'acknowledges cancellation once': 'failed' } })
    expect(manifest.capabilities['cancellation-acknowledgement'].status).toBe('unsupported')
    const forged = structuredClone(manifest)
    forged.capabilities['cancellation-acknowledgement'].status = 'supported'
    forged.capabilities['cancellation-acknowledgement'].evidence[0].cases[0].status = 'passed'
    const { ok, problems } = verify(forged)
    expect(ok).toBe(false)
    expect(problems.join('\n')).toMatch(/result digest does not match its evidence/)
    expect(problems.join('\n')).toMatch(/manifest digest .* does not match its body/)
  })

  it('rejects a capability promoted to supported without its digest moving', () => {
    const manifest = manifestOf({ 'evidence/cancel.test.ts': { 'acknowledges cancellation once': 'failed' } })
    const forged = structuredClone(manifest)
    forged.capabilities['cancellation-acknowledgement'].status = 'supported'
    forged.digest = verifyDigestOf(forged)
    const { ok, problems } = verify(forged)
    expect(ok).toBe(false)
    expect(problems.join('\n')).toMatch(/claims supported without every declared case passing/)
  })

  it('rejects changed evidence bytes', () => {
    const manifest = manifestOf()
    writeFileSync(evidenceFile, "it('acknowledges cancellation once', () => { /* edited */ })\n")
    try {
      const { ok, problems } = verify(manifest)
      expect(ok).toBe(false)
      expect(problems.join('\n')).toMatch(/evidence file evidence\/cancel\.test\.ts changed since emission/)
    } finally {
      writeFileSync(evidenceFile, "it('acknowledges cancellation once', () => {})\n")
    }
  })

  it('reports unproven when a declared case is absent from the run', () => {
    const manifest = manifestOf({ 'evidence/cancel.test.ts': { 'a renamed case': 'passed' } })
    expect(manifest.capabilities['cancellation-acknowledgement'].status).toBe('unproven')
    expect(verify(manifest).ok).toBe(true)
  })

  it('emits the same digest twice from the same inputs', () => {
    expect(manifestOf().digest).toBe(manifestOf().digest)
  })
})

function verifyDigestOf(manifest) {
  const { digest: _ignored, ...body } = manifest
  return buildConformanceManifest({
    package: body.package,
    cohort: body.cohort,
    sandboxVersions: body.sandboxVersions,
    environment: body.environment,
    capabilities: body.capabilities,
    verifiedBy: body.verifiedBy,
  }).digest
}
