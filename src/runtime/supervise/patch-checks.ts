/**
 * @experimental
 *
 * The mechanical patch gate — the SINGLE source of the no-op / always-on secret-path floor /
 * forbidden-path / diff-size / test / typecheck checks over a captured diff. No I/O: it scores a
 * patch plus its already-derived test/typecheck PASS signals. The generic worktree-CLI deliverable
 * (`patchDelivered`, which runs the commands itself) calls this, so the gate logic never forks.
 *
 * The always-on safety floors (no-op rejection + secret-path) are also exported standalone
 * (`isNonEmptyPatch` / `touchesSecretPath`) for reuse outside the full scorer.
 */

import type { DefaultVerdict } from '../types'

const DEFAULT_MAX_DIFF_LINES = 400

/**
 * Default-on credential-path floor: a patch that touches a credential-shaped path is rejected
 * regardless of the per-task `forbiddenPaths` config. Catches `.env`, private keys, keystores,
 * wallets, and the common secret/credential JSON files.
 */
const secretPathPattern =
  /(^|\/)(\.env(\.|$)|.*\.(pem|key|p12|pfx|keystore|wallet)|id_rsa|id_ed25519|secrets?\.json|credentials?\.json)$/i

/** @experimental The patch + its derived PASS signals the mechanical gate decides on. */
export interface CoderCheckInput {
  /** The unified diff produced by the run. */
  patch: string
  /** Did `testCmd` exit clean? */
  testsPassed: boolean
  /** Did `typecheckCmd` exit clean? */
  typecheckPassed: boolean
}

/** @experimental The per-task constraints the mechanical gate enforces. */
export interface CoderCheckConstraints {
  /** Default 400. Hard cap; gate fails when exceeded. */
  maxDiffLines?: number
  /** Literal path prefixes the patch must not touch. */
  forbiddenPaths?: string[]
}

/** The unified-diff paths the patch touches — the `+++`/`---` headers, de-`a/`/`b/`-prefixed,
 *  with `/dev/null` (a delete's other side) dropped. */
export function touchedPathsFromPatch(patch: string): string[] {
  const out = new Set<string>()
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const rest = line.slice(4).trim()
      if (rest === '/dev/null') continue
      const stripped = rest.startsWith('a/') || rest.startsWith('b/') ? rest.slice(2) : rest
      out.add(stripped)
    }
  }
  return [...out]
}

/** Count the added/removed content lines in a unified diff (excludes the `+++`/`---` headers). */
export function countDiffLines(patch: string): number {
  let count = 0
  for (const line of patch.split(/\r?\n/)) {
    if (
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      count += 1
    }
  }
  return count
}

/** True when the patch actually changes something — at least one touched path AND non-blank body.
 *  An empty patch can trivially "pass" tests/typecheck (nothing changed) yet does no work. */
export function isNonEmptyPatch(patch: string): boolean {
  return touchedPathsFromPatch(patch).length > 0 && patch.trim().length > 0
}

/** The credential-shaped paths the patch touches (always-on floor, independent of `forbiddenPaths`). */
export function touchesSecretPath(patch: string): string[] {
  return touchedPathsFromPatch(patch).filter((p) => secretPathPattern.test(p))
}

/**
 * @experimental
 *
 * The pure mechanical gate — the SINGLE source of the no-op / always-on secret-path floor /
 * diff-size / forbidden-path / test / typecheck checks. No I/O: it scores a patch + its
 * already-derived pass signals.
 *
 * Checks in order: (1) no-op rejection, (2) always-on secret-path floor (independent of
 * `forbiddenPaths`), (3) forbidden-path, (4) diff-size cap, (5) tests, (6) typecheck.
 * Aggregate score: `0.5*tests + 0.3*typecheck + 0.2*(1 - diffLines/maxDiff)`; `valid` is the
 * conjunction of all six.
 */
export function runCoderChecks(
  input: CoderCheckInput,
  constraints: CoderCheckConstraints = {},
): DefaultVerdict {
  const maxDiff = constraints.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES
  const forbidden = constraints.forbiddenPaths ?? []
  const scores: Record<string, number> = {}
  const notes: string[] = []
  let pass = true

  const touched = touchedPathsFromPatch(input.patch)

  // No-op rejection: an empty patch can trivially "pass" tests/typecheck (nothing changed) yet
  // does no work — never a valid result.
  if (touched.length === 0 || input.patch.trim().length === 0) {
    pass = false
    scores.nonEmpty = 0
    notes.push('empty patch — no files changed')
  } else {
    scores.nonEmpty = 1
  }

  // Secret-path floor: always-on, independent of `forbiddenPaths`.
  const touchedSecrets = touched.filter((p) => secretPathPattern.test(p))
  if (touchedSecrets.length > 0) {
    pass = false
    scores.noSecrets = 0
    notes.push(`touched secret-shaped paths: ${touchedSecrets.join(', ')}`)
  } else {
    scores.noSecrets = 1
  }

  const touchedForbidden = forbidden.filter((path) => {
    const prefix = path.endsWith('/') ? path : `${path}/`
    const exact = prefix.slice(0, -1)
    return touched.some((p) => p === exact || p.startsWith(prefix))
  })
  if (touchedForbidden.length > 0) {
    pass = false
    scores.forbiddenPath = 0
    notes.push(`touched forbidden paths: ${touchedForbidden.join(', ')}`)
  } else {
    scores.forbiddenPath = 1
  }

  const diffLines = countDiffLines(input.patch)
  if (diffLines > maxDiff) {
    pass = false
    scores.diffSize = 0
    notes.push(`diff ${diffLines} lines exceeds cap ${maxDiff}`)
  } else {
    scores.diffSize = maxDiff === 0 ? 0 : Math.max(0, 1 - diffLines / maxDiff)
  }

  scores.tests = input.testsPassed ? 1 : 0
  scores.typecheck = input.typecheckPassed ? 1 : 0
  if (!input.testsPassed) {
    pass = false
    notes.push('tests failed')
  }
  if (!input.typecheckPassed) {
    pass = false
    notes.push('typecheck failed')
  }

  const score = 0.5 * scores.tests + 0.3 * scores.typecheck + 0.2 * scores.diffSize
  const verdict: DefaultVerdict = {
    valid: pass,
    score: Number.isFinite(score) ? score : 0,
    scores,
  }
  if (notes.length > 0) verdict.notes = notes.join('; ')
  return verdict
}
