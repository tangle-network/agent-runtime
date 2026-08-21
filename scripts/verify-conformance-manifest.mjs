#!/usr/bin/env node
/**
 * Verify a Runtime conformance manifest.
 *
 * Every check recomputes a value from an artifact outside the manifest: the
 * body digest, each capability's result digest, the packed archive identity and
 * bytes, the cohort report, and the bytes of every evidence file. Nothing here
 * imports workspace source, so a consumer can run this file against a published
 * manifest and an archive alone.
 *
 * Usage:
 *   node scripts/verify-conformance-manifest.mjs <manifest.json> [--tarball <path.tgz>]
 *     [--cohort-report <path.json>] [--source-root <dir>] [--require <capability>]...
 *
 * `--require` fails the run when the named capability is not `supported`. That
 * choice belongs to the consumer: an unproven capability never fails an
 * install by itself.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { verifyConformanceManifest } from './lib/conformance-manifest.mjs'

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    tarball: { type: 'string' },
    'cohort-report': { type: 'string' },
    'source-root': { type: 'string' },
    require: { type: 'string', multiple: true, default: [] },
  },
  allowPositionals: true,
  strict: true,
})

const manifestPath = positionals[0]
if (!manifestPath) throw new Error('usage: verify-conformance-manifest.mjs <manifest.json> [options]')

const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'))
const { ok, problems } = verifyConformanceManifest(manifest, {
  ...(values.tarball ? { tarball: resolve(values.tarball) } : {}),
  ...(values['cohort-report'] ? { cohortReport: resolve(values['cohort-report']) } : {}),
  ...(values['source-root'] ? { sourceRoot: resolve(values['source-root']) } : {}),
})

const unmet = values.require.filter((key) => manifest.capabilities?.[key]?.status !== 'supported')
for (const key of unmet) {
  problems.push(`required capability ${key} is ${manifest.capabilities?.[key]?.status ?? 'absent'}`)
}

if (!ok || unmet.length > 0) {
  for (const problem of problems) process.stderr.write(`::error::${problem}\n`)
  process.exit(1)
}

const counts = {}
for (const capability of Object.values(manifest.capabilities)) {
  counts[capability.status] = (counts[capability.status] ?? 0) + 1
}
process.stdout.write(
  `Conformance manifest verified for ${manifest.package.name}@${manifest.package.version}\n` +
    `digest=${manifest.digest}\n` +
    `${Object.entries(counts)
      .sort()
      .map(([status, count]) => `${status}=${count}`)
      .join(' ')}\n`,
)
