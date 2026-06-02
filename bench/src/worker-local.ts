/**
 * Local SWE-bench worker: drive the `opencode` agent (the same agent the sandbox
 * runs) against a locally cloned repo, model via opencode's configured providers.
 * Decoupled from staging — produces a patch the verified SWE-bench judge scores.
 * One shot = clone repo@base_commit → opencode resolves → git diff (excluding tests).
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BenchTask } from './benchmarks/types'

const execFileAsync = promisify(execFile)
const BIG = 1024 * 1024 * 256

export interface LocalWorkerConfig {
  /** opencode model id (provider/model), e.g. deepseek/deepseek-v4-pro. */
  model: string
  /** Keep the clone dir (debug). Default: remove. */
  keep?: boolean
}

export interface ShotResult {
  patch: string
  ok: boolean
  detail?: string
}

export async function solveShotLocal(
  task: BenchTask,
  cfg: LocalWorkerConfig,
  steer?: string,
): Promise<ShotResult> {
  const md = task.metadata ?? {}
  const repo = String(md.repo)
  const base = String(md.base_commit)
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

    // opencode resolves the issue in-place. No timeout — runs to completion.
    await execFileAsync(
      'opencode',
      ['run', prompt, '-m', cfg.model, '--dangerously-skip-permissions'],
      { cwd: dir, maxBuffer: BIG },
    )

    await execFileAsync('git', ['-C', dir, 'add', '-A'], { maxBuffer: BIG })
    const { stdout: patch } = await execFileAsync(
      'git',
      ['-C', dir, 'diff', '--cached', '--', '.', ":(exclude)*/tests/*", ":(exclude)*/test/*"],
      { maxBuffer: BIG },
    )
    return {
      patch,
      ok: patch.trim().length > 0,
      detail: patch.trim().length > 0 ? undefined : 'empty patch (agent made no source change)',
    }
  } finally {
    if (!cfg.keep) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
