/**
 * Sequential-refine worker — the steering condition the oracle test couldn't rule out.
 *
 * Round 1 solves the issue (this IS the blind pass@1 attempt). Rounds 2..k refine
 * IN PLACE: opencode re-runs in the same workspace, sees its own prior changes in
 * the working tree, and is told to critically review + improve them. This uses
 * INFORMATION (the agent's accumulated work) rather than independent resampling —
 * so it can solve an instance no single blind shot would, which is exactly what
 * oracle-over-independent-samples cannot measure.
 *
 * Integrity: the refinement signal is the agent's own review + the repo's existing
 * tests. The hidden SWE-bench FAIL_TO_PASS tests are never in the workspace, so the
 * loop cannot steer on the answer key.
 *
 * Returns the cumulative diff after round 1 (blind) and after the final round
 * (refine) so the harness scores both from one run.
 */

import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BenchTask } from './benchmarks/types'

const execFileAsync = promisify(execFile)
const BIG = 1024 * 1024 * 256
const DEFAULT_LIVENESS_MS = 1_200_000

export interface RefineWorkerConfig {
  model: string
  /** Total rounds. Round 1 = blind; the rest refine in place. Default 3. */
  rounds?: number
  livenessMs?: number
  keep?: boolean
}

export interface RefineShot {
  /** Cumulative diff after round 1 — the blind pass@1 artifact. */
  round1Patch: string
  /** Cumulative diff after the final refine round. */
  finalPatch: string
  rounds: number
  ok: boolean
  detail?: string
}

/** opencode, stdin closed + stdout discarded, wall-clock SIGKILL backstop. Resolves
 *  `{ killed }`; rejects only on spawn error (a non-zero exit is tolerated — the
 *  working tree still holds whatever the round changed). */
function runOpencode(args: string[], cwd: string, livenessMs: number): Promise<{ killed: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('opencode', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    let killed = false
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
      resolve({ killed })
    })
  })
}

async function captureDiff(dir: string): Promise<string> {
  await execFileAsync('git', ['-C', dir, 'add', '-A'], { maxBuffer: BIG })
  const { stdout } = await execFileAsync(
    'git',
    ['-C', dir, 'diff', '--cached', '--', '.', ':(exclude)*/tests/*', ':(exclude)*/test/*'],
    { maxBuffer: BIG },
  )
  return stdout
}

export async function solveRefineLocal(
  task: BenchTask,
  cfg: RefineWorkerConfig,
): Promise<RefineShot> {
  const md = task.metadata ?? {}
  const repo = String(md.repo)
  const base = String(md.base_commit)
  const issue = String(md.problem_statement ?? task.prompt)
  const rounds = Math.max(1, cfg.rounds ?? 3)
  const livenessMs = cfg.livenessMs ?? DEFAULT_LIVENESS_MS
  const dir = await mkdtemp(join(tmpdir(), 'swebench-refine-'))
  try {
    await execFileAsync('git', ['clone', '--quiet', `https://github.com/${repo}.git`, dir], {
      maxBuffer: BIG,
    })
    await execFileAsync('git', ['-C', dir, 'checkout', '--quiet', base], { maxBuffer: BIG })

    let round1Patch = ''
    let finalPatch = ''
    const notes: string[] = []
    for (let r = 1; r <= rounds; r += 1) {
      const prompt =
        r === 1
          ? [
              'Resolve this GitHub issue by editing the repository SOURCE. Do NOT edit test files.',
              'Make the failing behavior correct. Keep the change minimal.',
              '',
              issue,
            ].join('\n')
          : [
              'You have an in-progress fix for the issue below; your changes are already in',
              'the working tree. VERIFY it: re-read the issue and run the repository\'s existing',
              'tests. If the patch correctly and completely resolves the issue, leave it',
              'UNCHANGED. Change it ONLY if you find a CONCRETE problem — a failing test, a',
              'missed requirement, or a clear bug. Do not churn a working patch. Do NOT edit',
              'test files.',
              '',
              issue,
            ].join('\n')
      try {
        const { killed } = await runOpencode(
          ['run', prompt, '-m', cfg.model, '--dangerously-skip-permissions'],
          dir,
          livenessMs,
        )
        if (killed) notes.push(`round ${r}: liveness backstop`)
      } catch (err) {
        notes.push(`round ${r}: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`)
      }
      const patch = await captureDiff(dir)
      if (r === 1) round1Patch = patch
      finalPatch = patch
    }
    return {
      round1Patch,
      finalPatch,
      rounds,
      ok: finalPatch.trim().length > 0,
      detail: notes.length ? notes.join(' · ') : undefined,
    }
  } finally {
    if (!cfg.keep) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
