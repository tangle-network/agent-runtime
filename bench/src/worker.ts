/**
 * SWE-bench worker: one shot = a fresh staging sandbox where a coding agent
 * clones the repo at base_commit, resolves the issue, and writes a patch we read
 * back via the sandbox filesystem. The artifact is a unified git diff the
 * SWE-bench judge scores. Runs against the REAL product path (our SDK → staging
 * sandbox → opencode agent → router model), so it also exercises provisioning.
 */

import {
  type AgentRunSpec,
  type Deliverable,
  openSandboxRun,
} from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import type { BenchTask } from './benchmarks/types'
import {
  type BenchRuntimeDecisionPoint,
  type BenchRuntimeHookEvent,
  createRuntimeHookRecorder,
} from './runtime-hook-recorder'

export interface WorkerConfig {
  sandboxBaseUrl: string
  sandboxKey: string
  /** Pins the in-box provider's baseUrl only. Model auth is the box-provisioned
   *  credential (`OPENCODE_MODEL_API_KEY`) — never an external key. */
  routerBaseUrl: string
  model: string
  provider?: string
  timeoutMs?: number
}

export interface ShotResult {
  patch: string
  ok: boolean
  detail?: string
  runtimeEvents?: BenchRuntimeHookEvent[]
  runtimeDecisionPoints?: BenchRuntimeDecisionPoint[]
}

const PATCH_PATH = '/tmp/solution.patch'

const randomSuffix = () => Math.random().toString(36).slice(2, 10)

/** The git diff the agent wrote, read back off the box FS (+ any in-box error). A
 *  MISSING patch file is a real "agent produced no patch" outcome; any OTHER read
 *  failure surfaces in `TurnResult.readError`, never masked as an empty patch — so a
 *  judge distinguishes agent-failure from fs-failure. */
interface SwePatch {
  patch: string
  lastErr?: string
}

const swePatchDeliverable: Deliverable<SwePatch> = {
  kind: 'artifact',
  path: PATCH_PATH,
  fromArtifact: (raw, events) => {
    let lastErr: string | undefined
    for (const ev of events) {
      if ((ev as { type?: string }).type === 'error') lastErr = JSON.stringify((ev as { data?: unknown }).data).slice(0, 300)
    }
    return { patch: raw, ...(lastErr ? { lastErr } : {}) }
  },
}

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

  // Cold-start-resilient via the shared lineage layer (a gateway-timed-out create is
  // recovered by name lookup). The inline profile + backend override is the same
  // generic AgentRunSpec the runLoop kernel boots against the real sandbox.
  const controller = new AbortController()
  const timer = cfg.timeoutMs ? setTimeout(() => controller.abort(), cfg.timeoutMs) : undefined
  const agentRun: AgentRunSpec<string> = {
    profile: { name: 'swebench-worker', metadata: { backendType: 'opencode' } },
    name: 'swebench-worker',
    taskToPrompt: () => '', // unused — the prompt is streamed directly by openSandboxRun
    sandboxOverrides: {
      name: `bench-${task.id}-${randomSuffix()}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60),
      environment: 'universal',
      backend: {
        type: 'opencode',
        model: { provider: cfg.provider ?? 'openai', model: cfg.model, baseUrl: cfg.routerBaseUrl },
      },
    },
  }
  const runtime = createRuntimeHookRecorder()
  const run = await openSandboxRun(
    client,
    {
      agentRun,
      signal: controller.signal,
      hooks: runtime.hooks,
      runId: `swe-bench:${task.id}`,
      scenarioId: task.id,
    },
    swePatchDeliverable,
  )
  try {
    const turn = await run.start(prompt)
    const empty = turn.out.patch.trim().length === 0
    return {
      patch: turn.out.patch,
      ok: !empty,
      detail: empty
        ? `empty patch${turn.readError ? ` (patch read failed: ${turn.readError.slice(0, 120)})` : ''}${turn.out.lastErr ? `; lastError=${turn.out.lastErr}` : ''}`
        : undefined,
      runtimeEvents: runtime.events,
      runtimeDecisionPoints: runtime.decisionPoints,
    }
  } finally {
    if (timer) clearTimeout(timer)
    await run.close()
  }
}
