/**
 *
 * `agenticGenerator` — the full-agentic `CandidateGenerator`: the
 * `shots=N, sandbox=on` setting of the one `improvementDriver`. It runs a real
 * coding harness (claude / codex / opencode) inside the candidate worktree the
 * driver already created, letting the agent read the codebase + the research
 * report and make the change in place. The driver then commits the worktree
 * into a `CodeSurface`.
 *
 * Mechanism: identical to the proven Phase-2.8 in-process executor — spawn the
 * harness as a subprocess with `cwd` = the worktree, on the same filesystem,
 * so edits land in place (no sandbox-mount round-trip). `runLocalHarness` is
 * the verified primitive. The OUTER sandbox is the improvement loop's own
 * execution context; the generator does not nest a second sandbox per
 * candidate (which would reintroduce a host↔sandbox worktree-transport
 * problem that does not need solving here).
 *
 * `maxShots` is the DEPTH dial — a multi-shot verify-in-session loop, NOT the
 * kernel `runLoop`. Each shot runs one full harness session in the (persistent)
 * worktree; between shots the loop refines based on what the last shot produced:
 *   - empty tree   → "you changed nothing, make the edits" → retry
 *   - dirty + `verify` fails → feed the verifier's failure into the next shot
 *       (the worktree persists, so the harness RESUMES atop its own failing
 *       edits with the error in hand — no `--resume` session plumbing needed,
 *       and harness-agnostic across claude/codex/opencode)
 *   - dirty + `verify` ok (or no verifier configured) → return the candidate
 * A candidate that never verifies within `maxShots` is discarded (`applied:
 * false`), never shipped — if you configured a verifier, a non-passing tree is
 * not a candidate. With no verifier the legacy behavior holds: first dirty shot
 * is the candidate.
 *
 * @experimental
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { type LocalHarness, runLocalHarness } from '../mcp/local-harness'
import type { CandidateGenerator } from './improvement-driver'

const RAW_TRACE_ANALYST_ID = 'raw-trace-distiller'
const RAW_TRACE_AREA = 'raw-trace-context'
const RAW_TRACE_DIAGNOSIS_PATH = '.improve/raw-trace-diagnosis.md'

/** Outcome of verifying a candidate worktree. `feedback` (compiler errors,
 *  failing test output) is fed into the next shot when `ok` is false. */
export interface VerifyResult {
  ok: boolean
  feedback?: string
}

/** Verifies the edited worktree. Sync or async; throws only on a setup fault
 *  (a candidate that fails verification returns `{ok:false}`, it does not
 *  throw). */
export type Verifier = (worktreePath: string) => Promise<VerifyResult> | VerifyResult

export interface AgenticGeneratorOptions {
  /** Local coding harness to run in the worktree. Default `claude`. */
  harness?: LocalHarness
  /** Per-shot wall-clock timeout (ms). Default = `runLocalHarness` default (5m). */
  timeoutMs?: number
  /** Build the harness task prompt from the report + findings. Override for
   *  domain phrasing; the default turns findings into a concrete coder task. */
  buildPrompt?: (args: { report: unknown; findings: AnalystFinding[] }) => string
  /** Verify the worktree after each dirtying shot. When set, a candidate that
   *  fails verification is NOT returned — the failure feeds the next shot
   *  (verify-in-session), up to `maxShots`; a candidate that never verifies is
   *  discarded (`applied:false`), never shipped. Omitted ⇒ legacy behavior:
   *  the first dirty shot is the candidate. See `commandVerifier`. */
  verify?: Verifier
  /** Test seam — inject the harness runner (defaults to `runLocalHarness`). */
  runHarness?: typeof runLocalHarness
  /** Test seam — inject the worktree-dirty check (defaults to `git status`). */
  isDirty?: (worktreePath: string) => boolean
}

/** Full-agentic `CandidateGenerator` (the `shots=N, sandbox=on` setting): run a real coding harness inside the candidate worktree so the agent makes the change in place. */
export function agenticGenerator(opts: AgenticGeneratorOptions = {}): CandidateGenerator {
  const harness = opts.harness ?? 'claude'
  const buildPrompt = opts.buildPrompt ?? defaultBuildPrompt
  const run = opts.runHarness ?? runLocalHarness
  const dirty = opts.isDirty ?? worktreeDirty
  const verify = opts.verify

  return {
    kind: `agentic:${harness}`,
    // The seed repo + (in rawTraceContext mode) the raw-trace filesystem context
    // are the change signal — an agentic coder proposes from them even when the
    // distiller yielded zero findings. Without this, the improvementDriver's
    // empty-findings guard short-circuits and generates ZERO candidates on the
    // first (and, for a single-generation run, only) proposal round.
    proposesWithoutFindings: true,
    async generate({ worktreePath, report, findings, maxShots, signal }) {
      const basePrompt = buildPrompt({ report, findings })
      const needsRawTraceEvidence = requiresRawTraceEvidence(findings)
      const shots = Math.max(1, maxShots)
      // Feedback appended to the base prompt for the NEXT shot — empty on shot 0.
      let attemptNote = ''

      for (let shot = 0; shot < shots; shot++) {
        if (signal.aborted) break
        await run({
          harness,
          cwd: worktreePath,
          taskPrompt: attemptNote ? `${basePrompt}\n\n${attemptNote}` : basePrompt,
          timeoutMs: opts.timeoutMs,
          signal,
        })

        // The worktree IS the signal: no edits ⇒ tell the next shot to act.
        if (!dirty(worktreePath)) {
          attemptNote = EMPTY_TREE_NOTE
          continue
        }

        if (needsRawTraceEvidence) {
          const problem = rawTraceEvidenceProblem(worktreePath, findings)
          if (problem) {
            attemptNote = problem
            continue
          }
        }

        // Dirty: with no verifier the diff IS the candidate (we trust the diff,
        // not the harness's stdout). With a verifier the candidate must pass it.
        if (!verify) {
          return { applied: true, summary: summarize(findings) }
        }
        const result = await verify(worktreePath)
        if (result.ok) {
          return { applied: true, summary: summarize(findings) }
        }
        // Dirty but failing — resume next shot atop these edits with the error.
        attemptNote = failureNote(result.feedback)
      }

      // Shots exhausted: no verified candidate (or, sans verifier, no edits).
      return { applied: false, summary: '' }
    },
  }
}

/** Turn the analyst's findings (+ optional report) into a concrete coder task. */
function defaultBuildPrompt(args: { report: unknown; findings: AnalystFinding[] }): string {
  const lines: string[] = [
    'You are improving this codebase based on an evaluation analysis.',
    'Make the smallest set of edits that addresses the findings below, then stop.',
    'Do not change unrelated code. Do not commit — leave changes in the working tree.',
    '',
    'Findings:',
  ]
  for (const f of args.findings) {
    const where = f.subject ? ` [${f.subject}]` : ''
    lines.push(`- (${f.severity})${where} ${f.claim}`)
    if (f.recommended_action) lines.push(`    → ${f.recommended_action}`)
  }
  if (requiresRawTraceEvidence(args.findings)) {
    lines.push(
      '',
      'Raw trace evidence requirement:',
      `- Inspect at least one raw trace path named above before editing.`,
      `- Write ${RAW_TRACE_DIAGNOSIS_PATH} in this worktree.`,
      '- Include the exact trace path(s) inspected, the failure mechanism, and the code change made.',
      '- A candidate without this file, or with only this file changed, is discarded.',
    )
  }
  return lines.join('\n')
}

const EMPTY_TREE_NOTE =
  'NOTE: your previous attempt left the working tree unchanged. Make the concrete file edits now.'

/** Next-shot feedback when the worktree is dirty but failed verification. The
 *  edits persist on disk, so the harness resumes atop them — tell it to fix in
 *  place, not start over. Verifier detail is truncated to keep the prompt bounded. */
function failureNote(feedback?: string): string {
  const detail = feedback?.trim()
  return [
    'NOTE: your edits are in the working tree but verification FAILED.',
    'Fix the problem in place — build on your existing edits, do not revert them.',
    detail ? `Verifier output:\n${truncate(detail, 4000)}` : 'No verifier detail was captured.',
  ].join('\n')
}

function rawTraceEvidenceProblem(worktreePath: string, findings: AnalystFinding[]): string | null {
  const changedPaths = worktreeChangedPaths(worktreePath)
  const substantive = changedPaths.filter((path) => path !== RAW_TRACE_DIAGNOSIS_PATH)
  if (substantive.length === 0) {
    return [
      `NOTE: raw-trace mode requires a real code/config edit in addition to ${RAW_TRACE_DIAGNOSIS_PATH}.`,
      'Your previous attempt only changed the diagnosis artifact. Inspect the cited traces and make the causal code change.',
    ].join('\n')
  }

  const diagnosisPath = join(worktreePath, RAW_TRACE_DIAGNOSIS_PATH)
  if (!existsSync(diagnosisPath)) {
    return [
      `NOTE: raw-trace mode requires ${RAW_TRACE_DIAGNOSIS_PATH}.`,
      'Before retrying, inspect at least one cited spans.jsonl/cached-result.json/artifact path, then write the diagnosis file with the exact path, failure mechanism, and code change.',
    ].join('\n')
  }

  const body = readFileSync(diagnosisPath, 'utf8')
  const evidencePaths = traceEvidencePaths(findings)
  if (evidencePaths.length > 0 && !evidencePaths.some((path) => body.includes(path))) {
    return [
      `${RAW_TRACE_DIAGNOSIS_PATH} exists, but it does not cite any exact raw trace path from the findings.`,
      `Cite at least one of these inspected paths exactly: ${evidencePaths.slice(0, 5).join(', ')}`,
    ].join('\n')
  }

  return null
}

function requiresRawTraceEvidence(findings: AnalystFinding[]): boolean {
  return findings.some((finding) => {
    const f = finding as unknown as Record<string, unknown>
    return f.analyst_id === RAW_TRACE_ANALYST_ID || f.area === RAW_TRACE_AREA
  })
}

function traceEvidencePaths(findings: AnalystFinding[]): string[] {
  const out: string[] = []
  for (const finding of findings) {
    const refs = (finding as unknown as { evidence_refs?: unknown }).evidence_refs
    if (!Array.isArray(refs)) continue
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object') continue
      const uri = (ref as { uri?: unknown }).uri
      if (typeof uri === 'string' && uri.length > 0) out.push(uri)
    }
  }
  return [...new Set(out)]
}

/** A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other
 *  exit ⇒ failed with stdout+stderr as feedback. The common case — verify by
 *  `tsc --noEmit`, `pnpm build`, or a test command. A timeout is treated as a
 *  FAILED candidate (a change that hangs the build is a bad change); a missing
 *  binary or spawn fault throws (a setup bug, not a failed candidate — no
 *  silent fallback). */
export function commandVerifier(
  command: string,
  args: string[] = [],
  timeoutMs = 300_000,
): Verifier {
  return (worktreePath: string): VerifyResult => {
    const result = spawnSync(command, args, {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout: timeoutMs,
    })
    if (result.signal) {
      return {
        ok: false,
        feedback: `verifier '${command}' killed by ${result.signal} (likely timeout after ${timeoutMs}ms)`,
      }
    }
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new Error(
          `commandVerifier: '${command}' not found in PATH (setup bug, not a failed candidate)`,
        )
      }
      throw new Error(`commandVerifier: '${command}' failed to spawn: ${result.error.message}`)
    }
    if (result.status === 0) return { ok: true }
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    return { ok: false, feedback: out.length > 0 ? out : `exit ${result.status}` }
  }
}

/** A one-line summary for the commit message, derived from the findings. */
function summarize(findings: AnalystFinding[]): string {
  if (findings.length === 0) return 'agentic improvement'
  if (findings.length === 1) return `agentic: ${truncate(findings[0]!.claim, 64)}`
  return `agentic: ${findings.length} findings addressed`
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

/** Non-empty `git status --porcelain` ⇒ the harness changed the worktree.
 *  Fails loud: the worktree is a fresh checkout, so a git error here means
 *  something is genuinely broken (git missing, corrupt index, killed mid-run).
 *  Folding that into `false` would silently discard a candidate and mask the
 *  real failure — forbidden by the no-silent-fallbacks doctrine. */
function worktreeDirty(worktreePath: string): boolean {
  return worktreeChangedPaths(worktreePath).length > 0
}

function worktreeChangedPaths(worktreePath: string): string[] {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: worktreePath,
    encoding: 'utf-8',
  })
  if (result.error) {
    throw new Error(
      `agenticGenerator: git status failed to spawn in ${worktreePath}: ${result.error.message}`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `agenticGenerator: git status exited ${result.status} in ${worktreePath}: ${result.stderr.trim()}`,
    )
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim())
}
