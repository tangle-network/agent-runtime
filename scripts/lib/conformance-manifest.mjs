/**
 * The conformance manifest: what an exact packed Runtime release proves about
 * its own durable and control capabilities, and how a consumer checks it.
 *
 * The capability -> test mapping in `conformance/capabilities.json` is
 * hand-authored judgment. Everything in this file is mechanical: it reads test
 * results, records them, and content-addresses the record.
 *
 * Canonical serialization and hashing come from the published
 * `@tangle-network/agent-eval` package (`canonicalJson`, `contentHash`), which
 * is the one canonical-JSON owner for this tree. Do not add a second stable
 * stringify here.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson, contentHash } from '@tangle-network/agent-eval'

export const conformanceManifestSchemaVersion = 'agent-runtime/conformance-manifest/v1'
export const capabilityMapSchemaVersion = 'agent-runtime/conformance-capabilities/v1'

/** A capability status. `unproven` is the fail-closed default: no passing evidence, no claim. */
const statuses = new Set(['supported', 'unsupported', 'unproven'])

export function sha256OfFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** The digest of any manifest part: sha256 over its canonical JSON. */
export function digestOf(value) {
  return contentHash(value)
}

export function readCapabilityMap(path) {
  const map = JSON.parse(readFileSync(path, 'utf8'))
  if (map.schemaVersion !== capabilityMapSchemaVersion) {
    throw new Error(
      `${path} declares schema ${String(map.schemaVersion)}, expected ${capabilityMapSchemaVersion}`,
    )
  }
  for (const [key, capability] of Object.entries(map.capabilities ?? {})) {
    const declared = Array.isArray(capability.evidence) ? capability.evidence : undefined
    if (!capability.scenario || !declared) {
      throw new Error(`capability ${key} needs a scenario and an evidence array`)
    }
    if (declared.some((entry) => !entry.file || !entry.cases?.length)) {
      throw new Error(`capability ${key} declares an evidence entry with no file or cases`)
    }
  }
  if (Object.keys(map.capabilities ?? {}).length === 0) throw new Error(`${path} declares no capabilities`)
  return map
}

/** Every test file the map names, in stable order — what the emitter runs. */
export function evidenceFiles(map) {
  const files = new Set()
  for (const capability of Object.values(map.capabilities)) {
    for (const entry of capability.evidence) files.add(entry.file)
  }
  return [...files].sort()
}

/**
 * Resolve one declared case against the observed results.
 *
 * `results` maps a test file to `{ name: status }`. A case the run never
 * reported is `missing`; that keeps its capability unproven instead of letting
 * a renamed or deleted test read as proof. `fileDigest` binds each evidence
 * entry to the exact test bytes that produced the result.
 */
function caseStatus(results, file, name) {
  const observed = results[file]
  if (!observed || !(name in observed)) return 'missing'
  return observed[name]
}

/**
 * Build the capability record for the manifest body.
 *
 * `supported` requires every declared case to have passed. A declared case that
 * failed makes the capability `unsupported`. Anything else — no declared
 * evidence, a case the run did not report, a skipped case — is `unproven`.
 */
export function resolveCapabilities(map, results, fileDigest) {
  const capabilities = {}
  for (const key of Object.keys(map.capabilities).sort()) {
    const declared = map.capabilities[key]
    const evidence = declared.evidence.map((entry) => ({
      file: entry.file,
      sha256: fileDigest(entry.file),
      cases: entry.cases.map((name) => ({ name, status: caseStatus(results, entry.file, name) })),
    }))
    const observed = evidence.flatMap((entry) => entry.cases.map((testCase) => testCase.status))
    let status = 'unproven'
    if (observed.length > 0) {
      if (observed.includes('failed')) status = 'unsupported'
      else if (observed.every((value) => value === 'passed')) status = 'supported'
    }
    capabilities[key] = {
      status,
      scenario: declared.scenario,
      summary: declared.summary ?? '',
      evidence,
      resultDigest: digestOf(evidence),
    }
  }
  return capabilities
}

/**
 * Assemble the manifest. The digest covers the whole body, so package identity,
 * cohort identity, capability results and the execution environment are all
 * bound to it. Wall-clock time, run ids and durations are deliberately absent:
 * re-emitting from identical package bytes on the same runner must reproduce
 * the digest.
 */
export function buildConformanceManifest(input) {
  const body = {
    schemaVersion: conformanceManifestSchemaVersion,
    package: input.package,
    cohort: input.cohort,
    sandboxVersions: input.sandboxVersions,
    environment: input.environment,
    capabilities: input.capabilities,
    verifiedBy: input.verifiedBy,
  }
  return { ...body, digest: digestOf(body) }
}

/**
 * Check a manifest without importing workspace source.
 *
 * Every check is a recomputation, never a comparison of the manifest against
 * itself: the body digest, each capability's result digest, the packed archive
 * identity read out of the archive, the cohort identity read out of the cohort
 * report, and the bytes of every evidence file.
 */
export function verifyConformanceManifest(manifest, options = {}) {
  const problems = []
  const { digest, ...body } = manifest

  if (body.schemaVersion !== conformanceManifestSchemaVersion) {
    problems.push(`manifest schema is ${String(body.schemaVersion)}, expected ${conformanceManifestSchemaVersion}`)
  }
  const recomputed = digestOf(body)
  if (digest !== recomputed) {
    problems.push(`manifest digest ${String(digest)} does not match its body (${recomputed})`)
  }
  for (const [key, capability] of Object.entries(body.capabilities ?? {})) {
    const evidenceDigest = digestOf(capability.evidence)
    if (capability.resultDigest !== evidenceDigest) {
      problems.push(`capability ${key} result digest does not match its evidence (${evidenceDigest})`)
    }
    if (!statuses.has(capability.status)) {
      problems.push(`capability ${key} carries unknown status ${String(capability.status)}`)
    }
    const cases = capability.evidence.flatMap((entry) => entry.cases)
    if (capability.status === 'supported' && !cases.every((testCase) => testCase.status === 'passed')) {
      problems.push(`capability ${key} claims supported without every declared case passing`)
    }
    if (capability.status !== 'unproven' && cases.length === 0) {
      problems.push(`capability ${key} claims ${capability.status} with no evidence`)
    }
  }

  if (options.tarball) {
    const sha256 = sha256OfFile(options.tarball)
    if (sha256 !== body.package.sha256) {
      problems.push(`packed archive sha256 ${sha256} does not match the manifest (${body.package.sha256})`)
    }
    const readPackedManifest = options.readPackedManifest ?? defaultReadPackedManifest
    const identity = JSON.parse(readPackedManifest(options.tarball))
    if (identity.name !== body.package.name || identity.version !== body.package.version) {
      problems.push(
        `packed archive is ${identity.name}@${identity.version}, manifest claims ${body.package.name}@${body.package.version}`,
      )
    }
  }

  if (options.cohortReport) {
    const report = JSON.parse(readFileSync(options.cohortReport, 'utf8'))
    if (canonicalJson(report) !== canonicalJson(body.cohort)) {
      problems.push('cohort identity does not match the cohort report it was verified with')
    }
  }

  if (options.sourceRoot) {
    for (const [key, capability] of Object.entries(body.capabilities ?? {})) {
      for (const entry of capability.evidence) {
        let sha256
        try {
          sha256 = sha256OfFile(join(options.sourceRoot, entry.file))
        } catch (error) {
          problems.push(`capability ${key} evidence file ${entry.file} is unreadable: ${error.message}`)
          continue
        }
        if (sha256 !== entry.sha256) {
          problems.push(`capability ${key} evidence file ${entry.file} changed since emission`)
        }
      }
    }
  }

  return { ok: problems.length === 0, problems }
}

function defaultReadPackedManifest(tarball) {
  return execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' })
}
