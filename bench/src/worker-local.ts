/**
 * Local SWE-bench worker: drive the `opencode` agent (the same agent the sandbox
 * runs) against a locally cloned repo, model via opencode's configured providers.
 * Decoupled from staging — produces a patch the verified SWE-bench judge scores.
 * One shot = clone repo@base_commit → opencode resolves → git diff (excluding tests).
 */

import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BenchTask } from './benchmarks/types'

const execFileAsync = promisify(execFile)
const BIG = 1024 * 1024 * 256

/**
 * Liveness backstop (ms) for the opencode subprocess. A healthy solve completes
 * in seconds-to-minutes; a stalled model/transport read otherwise hangs the
 * agent indefinitely (observed: 9h at 0% CPU) and, with no cap, is never reaped.
 * This is NOT a step cap on productive work — it sits far above any real solve —
 * it converts an unrecoverable hang into a scored failure. Set 0 to disable.
 */
const DEFAULT_LIVENESS_MS = 1_800_000

export interface LocalWorkerConfig {
  /** opencode model id (provider/model), e.g. deepseek/deepseek-v4-pro. */
  model: string
  /** Keep the clone dir (debug). Default: remove. */
  keep?: boolean
  /** Wall-clock hang backstop for opencode. Default 30min; 0 disables. */
  livenessMs?: number
}

export interface ShotResult {
  patch: string
  ok: boolean
  detail?: string
}

/**
 * Run opencode non-interactively with a liveness backstop. stdin is closed
 * (`run` must never block waiting on it) and stdout is discarded (the deliverable
 * is the git diff, not opencode's narration — closing it also removes any buffer
 * limit). A wall-clock timer SIGKILLs a hung process so a stalled call cannot
 * consume the run forever. Resolves `{ killed }`; rejects on spawn error or a
 * non-zero exit so a real opencode failure surfaces loudly to the caller.
 */
function runOpencode(
  args: string[],
  cwd: string,
  livenessMs: number,
): Promise<{ killed: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('opencode', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let killed = false
    child.stderr?.on('data', (d) => {
      stderr += String(d)
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000)
    })
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
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      if (killed) return resolve({ killed: true })
      if (code === 0) return resolve({ killed: false })
      reject(
        Object.assign(new Error(`opencode exited code=${code} signal=${signal}: ${stderr.slice(-300)}`), {
          code,
          signal,
        }),
      )
    })
  })
}

export async function solveShotLocal(
  task: BenchTask,
  cfg: LocalWorkerConfig,
  steer?: string,
): Promise<ShotResult> {
  const md = task.metadata ?? {}
  const repo = String(md.repo)
  const base = String(md.base_commit)
  const livenessMs = cfg.livenessMs ?? DEFAULT_LIVENESS_MS
  const dir = await mkdtemp(join(tmpdir(), 'swebench-work-'))
  try {
    await execFileAsync('git', ['clone', '--quiet', `https://github.com/${repo}.git`, dir], {
      maxBuffer: BIG,
    })
    await execFileAsync('git', ['-C', dir, 'checkout', '--quiet', base], { maxBuffer: BIG })

    const prompt = [
      'Resolve this GitHub issue by editing the repository SOURCE. Do NOT edit test files.',
      'Make the failing behavior described below correct. Keep the change minimal.',
      '',
      String(md.problem_statement ?? task.prompt),
      steer ? `\n--- Guidance from a prior failed attempt ---\n${steer}` : '',
    ].join('\n')

    // opencode resolves the issue in-place; reaped by the liveness backstop if it hangs.
    let exitNote: string | undefined
    try {
      const { killed } = await runOpencode(
        ['run', prompt, '-m', cfg.model, '--dangerously-skip-permissions'],
        dir,
        livenessMs,
      )
      if (killed) exitNote = `liveness backstop reaped opencode @${Math.round(livenessMs / 1000)}s`
    } catch (err) {
      // Non-zero exit / spawn failure: capture whatever opencode wrote and let the
      // judge score it — losing partial work to a thrown error helps no one — but
      // record why, loudly, in the result detail.
      exitNote = `opencode failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`
    }

    await execFileAsync('git', ['-C', dir, 'add', '-A'], { maxBuffer: BIG })
    const { stdout: patch } = await execFileAsync(
      'git',
      ['-C', dir, 'diff', '--cached', '--', '.', ':(exclude)*/tests/*', ':(exclude)*/test/*'],
      { maxBuffer: BIG },
    )
    const hasPatch = patch.trim().length > 0
    return {
      patch,
      ok: hasPatch,
      detail:
        [exitNote, hasPatch ? undefined : 'empty patch (agent made no source change)']
          .filter(Boolean)
          .join(' · ') || undefined,
    }
  } finally {
    if (!cfg.keep) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
