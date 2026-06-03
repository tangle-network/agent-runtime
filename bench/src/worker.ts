/**
 * SWE-bench worker: one shot = a fresh staging sandbox where a coding agent
 * clones the repo at base_commit, resolves the issue, and writes a patch we read
 * back via the sandbox filesystem. The artifact is a unified git diff the
 * SWE-bench judge scores. Runs against the REAL product path (our SDK → staging
 * sandbox → opencode agent → router model), so it also exercises provisioning.
 */

import { acquireSandbox } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import type { BenchTask } from './benchmarks/types'

export interface WorkerConfig {
  sandboxBaseUrl: string
  sandboxKey: string
  routerBaseUrl: string
  routerKey: string
  model: string
  provider?: string
  timeoutMs?: number
}

export interface ShotResult {
  patch: string
  ok: boolean
  detail?: string
}

const PATCH_PATH = '/tmp/solution.patch'

const randomSuffix = () => Math.random().toString(36).slice(2, 10)

/** Run one resolution shot. `steer` (optional) carries guidance from a prior attempt. */
export async function solveShot(
  task: BenchTask,
  cfg: WorkerConfig,
  steer?: string,
): Promise<ShotResult> {
  const md = task.metadata ?? {}
  const repo = String(md.repo)
  const base = String(md.base_commit)
  const client = new Sandbox({ baseUrl: cfg.sandboxBaseUrl, apiKey: cfg.sandboxKey })

  // Cold-start-resilient: tolerates scale-from-zero node provisioning behind the
  // gateway's ~100s limit (a timed-out create is recovered by name lookup).
  const box = await acquireSandbox(client, {
    name: `bench-${task.id}-${randomSuffix()}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60),
    environment: 'universal',
    backend: {
      type: 'opencode',
      model: {
        provider: cfg.provider ?? 'openai',
        model: cfg.model,
        baseUrl: cfg.routerBaseUrl,
        apiKey: cfg.routerKey,
      },
    },
  })

  try {
    const prompt = [
      `Clone https://github.com/${repo} into /work and \`git checkout ${base}\`.`,
      '',
      'Resolve this issue by editing the SOURCE (never the tests):',
      '',
      String(md.problem_statement ?? task.prompt),
      steer ? `\n--- Guidance from a prior failed attempt ---\n${steer}\n` : '',
      '',
      `When finished, from the repo root run EXACTLY:`,
      `  git add -A && git diff --cached -- . ':(exclude)*/tests/*' > ${PATCH_PATH}`,
      `Then stop. The patch file is the only deliverable.`,
    ].join('\n')

    const signal = cfg.timeoutMs ? AbortSignal.timeout(cfg.timeoutMs) : undefined
    let lastErr: string | undefined
    for await (const ev of box.streamPrompt(prompt, signal ? { signal } : {})) {
      if (ev?.type === 'error') lastErr = JSON.stringify(ev.data).slice(0, 300)
    }

    // A MISSING patch file is a real "agent produced no patch" outcome; any OTHER
    // read failure (permissions, stream) is surfaced in `detail`, never silently
    // masked as an empty patch — so a judge sees agent-failure vs fs-failure.
    let patch = ''
    let readErr: string | undefined
    try {
      patch = await box.fs.read(PATCH_PATH)
    } catch (err) {
      readErr = err instanceof Error ? err.message : String(err)
    }
    const empty = patch.trim().length === 0
    return {
      patch,
      ok: !empty,
      detail: empty
        ? `empty patch${readErr ? ` (patch read failed: ${readErr.slice(0, 120)})` : ''}${lastErr ? `; lastError=${lastErr}` : ''}`
        : undefined,
    }
  } finally {
    try {
      await box.delete()
    } catch {
      // staging reaps on expiry; ignore cleanup failures
    }
  }
}
