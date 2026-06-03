/**
 * Local RESEARCH worker: answer a question with the `opencode` agent and capture
 * its answer text. Unlike worker-local (which edits a cloned repo and reads back a
 * git diff), a research task has no repo — the deliverable is the agent's final
 * answer, so we run opencode in a scratch dir and capture stdout. The benchmark's
 * loadTasks already appends the `FINAL ANSWER:` contract to task.prompt; the
 * judge extracts the answer from the captured text.
 *
 * Note: opencode here answers from model knowledge (no web-search tool wired), so
 * this fits knowledge-grounded benchmarks (SimpleQA, HotpotQA). Time-sensitive
 * benchmarks (FinSearchComp T1) need a search-capable worker — a separate seam.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BenchTask } from './benchmarks/types'
import { DEFAULT_RESEARCH_REFINE_DIRECTIVE } from './directives'
import { runRefineLoop } from './refine-loop'

/** See worker-local: a hang backstop, not a step cap. 0 disables. */
const DEFAULT_LIVENESS_MS = 1_800_000

export interface ResearchWorkerConfig {
  model: string
  livenessMs?: number
  keep?: boolean
}

export interface ResearchShot {
  answer: string
  ok: boolean
  detail?: string
}

const ANSI = /\[[0-9;]*m/g

/** Run opencode non-interactively, capturing stdout (the answer). stdin closed; a
 *  wall-clock timer SIGKILLs a hang. Returns whatever was captured even on a
 *  non-zero exit — the judge is the arbiter, so a partial answer still gets scored. */
function runOpencodeCapture(
  args: string[],
  cwd: string,
  livenessMs: number,
): Promise<{ stdout: string; killed: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('opencode', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let killed = false
    child.stdout?.on('data', (d) => {
      stdout += String(d)
      if (stdout.length > 5_000_000) stdout = stdout.slice(-5_000_000)
    })
    child.stderr?.on('data', () => {})
    const timer =
      livenessMs > 0
        ? setTimeout(() => {
            killed = true
            child.kill('SIGKILL')
          }, livenessMs)
        : undefined
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', () => {
      if (timer) clearTimeout(timer)
      resolve({ stdout, killed })
    })
  })
}

export interface ResearchRefineShot {
  /** Answer after round 1 — the blind artifact. */
  round1Answer: string
  /** Answer after the final refine round. */
  finalAnswer: string
  rounds: number
  ok: boolean
  detail?: string
}

/**
 * Sequential-refine research worker — the research analogue of worker-refine.
 * Round 1 answers (= blind). Rounds 2..k feed the PRIOR answer back in (there's no
 * shared workspace for a question, so the prior answer is carried in the prompt)
 * and ask the agent to critically review + correct it. Tests whether self-review
 * improves a factual answer — the steering mode oracle-headroom can't measure.
 * The directive (the steer) lives in directives.ts, not here — a worker is a
 * substrate; it takes the directive as an optional param defaulting to the surface.
 */

export async function solveRefineResearchLocal(
  task: BenchTask,
  cfg: ResearchWorkerConfig & { rounds?: number; refineDirective?: string },
): Promise<ResearchRefineShot> {
  const rounds = Math.max(1, cfg.rounds ?? 3)
  const directive = cfg.refineDirective ?? DEFAULT_RESEARCH_REFINE_DIRECTIVE
  const livenessMs = cfg.livenessMs ?? DEFAULT_LIVENESS_MS
  // Migrated onto the shared runRefineLoop atom (docs/architecture.md §12).
  // No shared workspace for a question — prior state carries in the prompt only;
  // no per-round judge → all k rounds run (the orchestrator scores round1 vs final).
  const res = await runRefineLoop<string, string>({
    rounds,
    setup: () => mkdtemp(join(tmpdir(), 'research-refine-')),
    prompt: (r, history) =>
      r === 1
        ? task.prompt
        : `${task.prompt}\n\n--- Your previous answer ---\n${(history[history.length - 1]?.artifact ?? '').slice(-4000)}\n\n${directive}`,
    runShot: async (prompt, _r, dir) => {
      const { stdout, killed } = await runOpencodeCapture(
        ['run', prompt, '-m', cfg.model, '--dangerously-skip-permissions'],
        dir,
        livenessMs,
      )
      return { artifact: stdout.replace(ANSI, ''), note: killed ? 'liveness backstop' : undefined }
    },
    teardown: cfg.keep
      ? undefined
      : (dir) => rm(dir, { recursive: true, force: true }).then(() => {}, () => {}),
  })
  const notes = res.rounds.filter((rr) => rr.note).map((rr) => `round ${rr.round}: ${rr.note}`)
  return {
    round1Answer: res.blind.artifact,
    finalAnswer: res.final.artifact,
    rounds,
    ok: res.final.artifact.trim().length > 0,
    detail: notes.length ? notes.join(' · ') : undefined,
  }
}

export async function solveResearchLocal(
  task: BenchTask,
  cfg: ResearchWorkerConfig,
): Promise<ResearchShot> {
  const livenessMs = cfg.livenessMs ?? DEFAULT_LIVENESS_MS
  const dir = await mkdtemp(join(tmpdir(), 'research-work-'))
  try {
    const { stdout, killed } = await runOpencodeCapture(
      ['run', task.prompt, '-m', cfg.model, '--dangerously-skip-permissions'],
      dir,
      livenessMs,
    )
    const answer = stdout.replace(ANSI, '')
    const ok = answer.trim().length > 0
    return {
      answer,
      ok,
      detail: killed
        ? `liveness backstop reaped opencode @${Math.round(livenessMs / 1000)}s`
        : ok
          ? undefined
          : 'empty output',
    }
  } finally {
    if (!cfg.keep) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
