#!/usr/bin/env node
/**
 * Emit the conformance manifest for one packed Runtime archive.
 *
 * Inputs are all existing artifacts: the packed tarball `publish.yml` already
 * builds, the cohort report `verify-packed-cohort.mjs --report` already
 * computes, and the native conformance tests this repository already runs. The
 * emitter adds no runtime, no scheduler and no evidence store — it runs the
 * named vitest files, records what they reported, and content-addresses the
 * record.
 *
 * Usage:
 *   node scripts/emit-conformance-manifest.mjs \
 *     --tarball <path.tgz> --cohort-report <path.json> --out <manifest.json>
 *     [--capabilities conformance/capabilities.json] [--skip-tests]
 *
 * `--skip-tests` records every declared case as `missing`, so every capability
 * lands `unproven`. It exists for a dry run of the wiring, never for a release.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  buildConformanceManifest,
  evidenceFiles,
  readCapabilityMap,
  resolveCapabilities,
  sha256OfFile,
} from './lib/conformance-manifest.mjs'
import { sandboxCompatibilityVersions, sandboxPeerRange } from './lib/packed-package-test.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    tarball: { type: 'string' },
    'cohort-report': { type: 'string' },
    out: { type: 'string' },
    capabilities: { type: 'string', default: 'conformance/capabilities.json' },
    'skip-tests': { type: 'boolean', default: false },
  },
  strict: true,
})

for (const required of ['tarball', 'cohort-report', 'out']) {
  if (!values[required]) throw new Error(`--${required} is required`)
}

const tarball = resolve(values.tarball)
const capabilityMapPath = resolve(repoRoot, values.capabilities)
const map = readCapabilityMap(capabilityMapPath)
const files = evidenceFiles(map)
const results = values['skip-tests'] ? {} : runEvidenceTests(files)

const packedManifest = JSON.parse(
  execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }),
)
const cohort = JSON.parse(readFileSync(resolve(values['cohort-report']), 'utf8'))

const manifest = buildConformanceManifest({
  package: {
    name: packedManifest.name,
    version: packedManifest.version,
    sourceCommit: execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sha256: sha256OfFile(tarball),
    buildIdentity: {
      capabilityMap: sha256OfFile(capabilityMapPath),
      packageManager: packedManifest.packageManager ?? null,
    },
  },
  cohort,
  sandboxVersions: { peerRange: sandboxPeerRange, verified: [...sandboxCompatibilityVersions] },
  environment: { node: process.version, platform: `${process.platform}-${process.arch}` },
  capabilities: resolveCapabilities(map, results, (file) => sha256OfFile(join(repoRoot, file))),
  verifiedBy: {
    tool: 'scripts/verify-conformance-manifest.mjs',
    version: JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version,
  },
})

writeFileSync(resolve(values.out), `${JSON.stringify(manifest, null, 2)}\n`)

const counts = {}
for (const capability of Object.values(manifest.capabilities)) {
  counts[capability.status] = (counts[capability.status] ?? 0) + 1
}
process.stdout.write(
  `Conformance manifest for ${manifest.package.name}@${manifest.package.version} written to ${values.out}\n` +
    `digest=${manifest.digest}\n` +
    `${Object.entries(counts)
      .sort()
      .map(([status, count]) => `${status}=${count}`)
      .join(' ')}\n`,
)
for (const [key, capability] of Object.entries(manifest.capabilities)) {
  process.stdout.write(`  ${capability.status.padEnd(11)} ${key} (${capability.scenario})\n`)
}

/**
 * Run the named test files once and read each case's status out of vitest's
 * JSON reporter. Durations and timestamps are dropped here: they never enter
 * the manifest, so an identical set of package bytes reproduces its digest.
 */
function runEvidenceTests(testFiles) {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'conformance-evidence-'))
  const outputFile = join(outputDirectory, 'results.json')
  try {
    try {
      execFileSync(
        'pnpm',
        ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outputFile}`, ...testFiles],
        { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
      )
    } catch (error) {
      // A failing scenario is evidence, not a crash: the manifest records the
      // failure as `unsupported`. Only a missing report is fatal.
      if (!error.status) throw error
    }
    const report = JSON.parse(readFileSync(outputFile, 'utf8'))
    const observed = {}
    for (const suite of report.testResults ?? []) {
      const file = relative(repoRoot, suite.name).split('\\').join('/')
      const cases = (observed[file] ??= {})
      for (const assertion of suite.assertionResults ?? []) {
        cases[assertion.title] = assertion.status
        if (assertion.fullName && assertion.fullName !== assertion.title) {
          cases[assertion.fullName] = assertion.status
        }
      }
    }
    return observed
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }
}
