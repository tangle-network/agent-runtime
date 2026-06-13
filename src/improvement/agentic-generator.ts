/**
 * @experimental
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
 */

import { spawnSync } from 'node:child_process'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { type LocalHarness, runLocalHarness } from '../mcp/local-harness'
import type { CandidateGenerator } from './improvement-driver'

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

export function agenticGenerator(opts: AgenticGeneratorOptions = {}): CandidateGenerator {
  const harness = opts.harness ?? 'claude'
  const buildPrompt = opts.buildPrompt ?? defaultBuildPrompt
  const run = opts.runHarness ?? runLocalHarness
  const dirty = opts.isDirty ?? worktreeDirty
  const verify = opts.verify

  return {
    kind: `agentic:${harness}`,
    async generate({ worktreePath, report, findings, maxShots, signal }) {
      const basePrompt = buildPrompt({ report, findings })
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
  const result = spawnSync('git', ['status', '--porcelain'], {
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
  return result.stdout.trim().length > 0
}
