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
 * `maxShots` is the DEPTH dial: the harness runs once; if it produced no change
 * (the worktree stays clean), the generator refines the prompt and retries, up
 * to `maxShots` times. A harness that already changed files returns on shot 1.
 */

import { spawnSync } from 'node:child_process'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { type LocalHarness, runLocalHarness } from '../mcp/local-harness'
import type { CandidateGenerator } from './improvement-driver'

export interface AgenticGeneratorOptions {
  /** Local coding harness to run in the worktree. Default `claude`. */
  harness?: LocalHarness
  /** Per-shot wall-clock timeout (ms). Default = `runLocalHarness` default (5m). */
  timeoutMs?: number
  /** Build the harness task prompt from the report + findings. Override for
   *  domain phrasing; the default turns findings into a concrete coder task. */
  buildPrompt?: (args: { report: unknown; findings: AnalystFinding[] }) => string
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

  return {
    kind: `agentic:${harness}`,
    async generate({ worktreePath, report, findings, maxShots, signal }) {
      let prompt = buildPrompt({ report, findings })
      const shots = Math.max(1, maxShots)

      for (let shot = 0; shot < shots; shot++) {
        if (signal.aborted) break
        await run({
          harness,
          cwd: worktreePath,
          taskPrompt: prompt,
          timeoutMs: opts.timeoutMs,
          signal,
        })
        // The worktree IS the signal: if the harness touched files, we have a
        // candidate. We don't trust the harness's stdout — we trust the diff.
        if (dirty(worktreePath)) {
          return { applied: true, summary: summarize(findings) }
        }
        // No change this shot — give the next attempt explicit feedback.
        prompt = refine(prompt)
      }
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

function refine(prompt: string): string {
  return `${prompt}\n\nNOTE: your previous attempt left the working tree unchanged. Make the concrete file edits now.`
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
