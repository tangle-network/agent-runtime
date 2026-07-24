/**
 * Gen-5 activation gate (SOTA adoption #2, GSME-style "verify the mechanism
 * fired before the score counts").
 *
 * Every proposer's deliverable must include a MACHINE-CHECKABLE ACTIVATION
 * PREDICATE at `.improve/activation.json` (inside the change-space's metadata
 * prefix, so the improvement driver's finalize commits it with the candidate):
 * a grep pattern or script over the candidate's OWN campaign run artifacts
 * that proves its mechanism actually fired (e.g. "the new prompt section
 * rendered in worker prompts", "patchRiskWarnings emitted in >=1 settle").
 *
 * Enforcement is two-stage, both fail-closed:
 *   1. PREFILTER — a candidate without a parseable predicate is killed before
 *      any evaluation spend (proposer-fanout.mts, stage 'activation-predicate').
 *   2. POST-EVAL — the evaluator runs the predicate over the candidate's own
 *      cell run dirs; a candidate whose mechanism NEVER fired is QUARANTINED
 *      (staircase verdict 'quarantined-inactive': recorded, never promoted)
 *      even when its score improved — a score with an inactive mechanism is
 *      indistinguishable from luck or from gaming the visible instances.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { run } from './proc.ts'

export const ACTIVATION_PREDICATE_RELPATH = '.improve/activation.json'

export interface ActivationPredicate {
  version: 'v1'
  /** One sentence: which mechanism this proves fired. */
  description: string
  kind: 'grep' | 'script'
  /** kind 'grep': JS RegExp source tested line-by-line over run artifacts. */
  pattern?: string
  /** kind 'grep': optional relative-path substring filters (a file is searched
   *  when its run-dir-relative path contains ANY entry). Empty/absent = all. */
  files?: string[]
  /** kind 'script': bash script; run once per run dir with cwd=<runDir> and
   *  $RUN_DIR set; exit 0 in ANY run dir = mechanism fired. */
  script?: string
}

export type ParsedPredicate = { ok: true; predicate: ActivationPredicate } | { ok: false; error: string }

export function parseActivationPredicate(raw: string): ParsedPredicate {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    return { ok: false, error: `not valid JSON: ${(cause as Error).message}` }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'must be a JSON object' }
  }
  const p = value as Record<string, unknown>
  if (p.version !== 'v1') return { ok: false, error: `version must be "v1", got ${JSON.stringify(p.version)}` }
  if (typeof p.description !== 'string' || p.description.trim().length === 0) {
    return { ok: false, error: 'description must be a non-empty string' }
  }
  if (p.kind === 'grep') {
    if (typeof p.pattern !== 'string' || p.pattern.length === 0) {
      return { ok: false, error: 'kind "grep" requires a non-empty pattern' }
    }
    try {
      new RegExp(p.pattern)
    } catch (cause) {
      return { ok: false, error: `pattern is not a valid RegExp: ${(cause as Error).message}` }
    }
    if (p.files !== undefined && (!Array.isArray(p.files) || p.files.some((f) => typeof f !== 'string'))) {
      return { ok: false, error: 'files must be an array of strings when present' }
    }
  } else if (p.kind === 'script') {
    if (typeof p.script !== 'string' || p.script.trim().length === 0) {
      return { ok: false, error: 'kind "script" requires a non-empty script' }
    }
  } else {
    return { ok: false, error: `kind must be "grep" or "script", got ${JSON.stringify(p.kind)}` }
  }
  return { ok: true, predicate: p as unknown as ActivationPredicate }
}

/** The prompt-visible contract: template + worked example. */
export function activationPredicateInstruction(): string {
  return [
    'ACTIVATION PREDICATE (required deliverable — a candidate without one is rejected before evaluation):',
    `Write ${ACTIVATION_PREDICATE_RELPATH} in this worktree: a machine-checkable proof that YOUR mechanism`,
    "actually fired during evaluation. The evaluator runs it over your candidate's own run artifacts",
    '(each arm run dir: driver.log, brain.jsonl, result.json, ws/.loops/** journal + worker evidence);',
    'if it never fires, your candidate is QUARANTINED even when its score improved.',
    '',
    'Template (kind "grep" — a RegExp tested over the run artifacts):',
    '  {',
    '    "version": "v1",',
    '    "description": "patchRiskWarnings emitted in at least one settle",',
    '    "kind": "grep",',
    '    "pattern": "patchRiskWarnings|patch-risk",',
    '    "files": ["journal.jsonl", "workers/"]',
    '  }',
    'Or kind "script": {"version":"v1","description":"...","kind":"script","script":"grep -rq NEW_SECTION ws/.loops"}',
    '(exit 0 in any run dir = fired).',
    'Pick a pattern that can ONLY appear when your mechanism ran — not one that matches the diff itself.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Predicate execution over run dirs.
// ---------------------------------------------------------------------------

export interface ActivationResult {
  fired: boolean
  /** Bounded evidence: matching `path:line` refs (grep) or script stdout tails. */
  evidence: string[]
  checkedRunDirs: number
  checkedFiles: number
  /** Bounded notes on skipped inputs (oversized files, walk caps). */
  warnings: string[]
}

const MAX_FILES_PER_RUN_DIR = 4000
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_EVIDENCE = 10
const SCRIPT_TIMEOUT_MS = 120_000

/** Walk one run dir. The `ws/` workspace subtree (a whole checked-out repo) is
 *  skipped EXCEPT `ws/.loops/**` — the supervisor's own artifacts live there
 *  and are exactly where mechanism traces land. */
async function walkRunDir(runDir: string, warnings: string[]): Promise<string[]> {
  const files: string[] = []
  const queue: string[] = [runDir]
  while (queue.length > 0) {
    const dir = queue.shift()!
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relative(runDir, abs)
      if (entry.isDirectory()) {
        if (rel === 'ws') {
          queue.push(join(abs, '.loops'))
          continue
        }
        queue.push(abs)
      } else if (entry.isFile()) {
        files.push(abs)
        if (files.length >= MAX_FILES_PER_RUN_DIR) {
          warnings.push(`${runDir}: file walk capped at ${MAX_FILES_PER_RUN_DIR} files`)
          return files
        }
      }
    }
  }
  return files
}

/** Run the predicate over the candidate's run dirs. Fail-closed: an unreadable
 *  artifact contributes nothing (with a warning) — it can never count as
 *  "fired". */
export async function runActivationPredicate(
  predicate: ActivationPredicate,
  runDirs: readonly string[],
): Promise<ActivationResult> {
  const result: ActivationResult = { fired: false, evidence: [], checkedRunDirs: 0, checkedFiles: 0, warnings: [] }
  for (const runDir of runDirs) {
    result.checkedRunDirs += 1
    if (predicate.kind === 'script') {
      const res = await run('bash', ['-c', predicate.script!], {
        cwd: runDir,
        timeoutMs: SCRIPT_TIMEOUT_MS,
        env: { ...process.env, RUN_DIR: runDir },
      })
      if (res.code === 0) {
        result.fired = true
        if (result.evidence.length < MAX_EVIDENCE) {
          result.evidence.push(`${runDir}: script rc=0${res.stdout.trim() ? ` — ${res.stdout.trim().slice(0, 200)}` : ''}`)
        }
      } else if (res.timedOut) {
        result.warnings.push(`${runDir}: script timed out after ${SCRIPT_TIMEOUT_MS}ms (counted as not-fired)`)
      }
      continue
    }
    const regex = new RegExp(predicate.pattern!)
    const filters = (predicate.files ?? []).filter((f) => f.length > 0)
    for (const file of await walkRunDir(runDir, result.warnings)) {
      const rel = relative(runDir, file)
      if (filters.length > 0 && !filters.some((f) => rel.includes(f))) continue
      const info = await stat(file).catch(() => null)
      if (info === null) continue
      if (info.size > MAX_FILE_BYTES) {
        result.warnings.push(`${rel}: skipped (${info.size} bytes > ${MAX_FILE_BYTES})`)
        continue
      }
      result.checkedFiles += 1
      const content = await readFile(file, 'utf8').catch(() => null)
      if (content === null) continue
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          result.fired = true
          if (result.evidence.length < MAX_EVIDENCE) {
            result.evidence.push(`${file}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`)
          }
          break // one match per file is enough evidence
        }
      }
    }
  }
  return result
}

/** Read + parse the predicate committed at a candidate's loops commit. */
export async function readCommittedPredicate(
  loopsRepo: string,
  commit: string,
): Promise<{ raw: string; parsed: ParsedPredicate } | null> {
  const show = await run('git', ['-C', loopsRepo, 'show', `${commit}:${ACTIVATION_PREDICATE_RELPATH}`])
  if (show.code !== 0) return null
  return { raw: show.stdout, parsed: parseActivationPredicate(show.stdout) }
}

/** The staircase row's activation record. */
export interface ActivationRecord {
  /** Whether a parseable predicate was present on the candidate commit. */
  present: boolean
  description: string | null
  /** null = not evaluated (no predicate / gate disabled / baseline). */
  fired: boolean | null
  evidence: string[]
  warnings: string[]
}
