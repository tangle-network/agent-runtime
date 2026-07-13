/**
 * `sweEvalRunner` — the SWE-domain `EvalRunner`: the first production filler of
 * the lifecycle's scoring hole (`marginal-lift.ts`'s `EvalRunner` type).
 *
 * It scores an `AgentProfile` by DRIVING a real coding agent over pinned
 * SWE-bench instances and grading each resulting patch with the official
 * Docker judge. Three invariants make the number real:
 *
 *   1. MULTI-TURN DRIVE — each instance is driven with the atom
 *      (`runAgentic` + `refine`), not a single-shot prompt, so the profile is
 *      scored on the same loop production runs use.
 *   2. JUDGE OUTSIDE THE AGENT — the grader is an injected `judge` (the
 *      swebench Docker harness); the driven surface's own `score()` is replaced
 *      by a patch-presence probe, so the scaffold can never grade its own axis
 *      and the judge runs exactly once per (profile, task).
 *   3. PROMPT BRIDGE — `applyArtifact` lands `prompt` candidates on
 *      `profile.prompt.instructions`, so the driven system prompt MUST fold
 *      `instructions` in after `systemPrompt` (seed fallback when empty).
 *      Reading `systemPrompt` alone would score every prompt candidate as a
 *      fake zero delta and the loop could never promote anything.
 *
 * The SWE environment, task rows, and judge are INJECTED: they live in the
 * bench package (`createSweBenchEnvironment`, the swebench adapter), which
 * depends on this package — importing them here would invert the dependency.
 *
 * Phase-3 adds the `materializeMcp` path: when set and the profile declares
 * `mcp` servers, each enabled stdio server is spawned SAME-HOST
 * (`materializeLocalMcp`) for the duration of the eval and its tools are
 * overlaid on the domain surface — so a worktree-BUILT MCP candidate is LIVE
 * while the profile is scored, and its marginal lift is real. Default off:
 * the prompt-only path spawns nothing.
 *
 * Phase-1 scope otherwise: returns the scalar `composite` (mean resolved) +
 * `costUsd` only — no per-task `RunRecord`s — so it pairs with
 * `thresholdPromotionGate`, not `heldOutPromotionGate`. Tasks run sequentially
 * on purpose: the patch capture closes over one mutable cell per drive.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import {
  type AgenticSurface,
  type ArtifactHandle,
  type LocalMcpMaterialization,
  materializeLocalMcp,
  refine,
  runAgentic,
  type SurfaceScore,
} from '../runtime'
import type { EvalResult, EvalRunner } from './marginal-lift'

const exec = promisify(execFile)

/** The minimal shape of a held-out SWE instance the runner needs. The bench
 *  adapter's `BenchTask` satisfies it structurally; the generic `T` lets the
 *  injected `judge` keep its own richer task type. */
export interface SweEvalTask {
  /** SWE-bench instance id (must be in the environment's pinned pool). */
  id: string
  /** The adapter-rendered issue prompt (the user message for the worker). */
  prompt: string
}

/** Per-instance audit row surfaced through `EvalResult.details`. */
export interface SweEvalTaskResult {
  id: string
  resolved: boolean
  patchBytes: number
  usd: number
  shots: number
  tokens: { input: number; output: number }
  /** Set when the Docker judge threw for this instance (scored unresolved). */
  judgeError?: string
}

export interface SweEvalRunnerOptions<T extends SweEvalTask = SweEvalTask> {
  /** The SWE `AgenticSurface` (bench's `createSweBenchEnvironment`), pinned to
   *  the held-out ids so `open(task)` can find each instance. */
  environment: AgenticSurface
  /** The held-out instances EVERY profile is scored on (same set for the
   *  baseline and each candidate arm — the ablation holds the exam constant). */
  tasks: readonly T[]
  /** The grader, held OUTSIDE the agent (bench `adapter.judge` → the official
   *  swebench Docker harness): patch in, resolved verdict out. */
  judge: (task: T, patch: string) => Promise<{ resolved: boolean }>
  /** Fallback system prompt when the profile carries none (the SWE seed). */
  seedPrompt: string
  routerBaseUrl: string
  routerKey: string
  /** The worker model the refine strategy drives. */
  model: string
  /** Completion cap per worker turn (required for thinking models). */
  maxTokens?: number
  /** Worker turns per shot before the driver's analyst intervenes. */
  innerTurns?: number
  /** Max refine shots per task. Default 1. */
  budget?: number
  /** Same-host MCP materialization: when true and the profile declares `mcp`
   *  servers, spawn each enabled stdio server as a LOCAL child for the eval's
   *  duration and expose its tools (`<server>__<tool>`) to the driven worker
   *  alongside the domain tools. Default false (prompt-only). A declared
   *  server that cannot boot THROWS — scoring it silently without its tools
   *  would fake the with/without ablation. */
  materializeMcp?: boolean
}

/**
 * Build the `EvalRunner` closed over one fixed SWE exam. `runLifecycle` calls
 * it once for the baseline profile and once per candidate; each call drives
 * every pinned instance and returns `{ composite: mean(resolved), costUsd }`.
 */
export function sweEvalRunner<T extends SweEvalTask = SweEvalTask>(
  opts: SweEvalRunnerOptions<T>,
): EvalRunner {
  if (opts.tasks.length === 0) {
    throw new ValidationError('sweEvalRunner: at least one held-out task is required')
  }

  return async (profile: AgentProfile, signal?: AbortSignal): Promise<EvalResult> => {
    const systemPrompt = renderSystemPrompt(profile, opts.seedPrompt)
    // Same-host materialization of the profile's MCP surface (opt-in): the
    // spawned servers live across all tasks of THIS eval and die in finally.
    const mcp = opts.materializeMcp ? await materializeLocalMcp(profile) : undefined
    const environment =
      mcp && mcp.tools.length > 0 ? withLocalMcpTools(opts.environment, mcp) : opts.environment
    try {
      return await driveAndGrade(environment, mcp, systemPrompt, opts, signal)
    } finally {
      await mcp?.close()
    }
  }
}

/** Drive every pinned instance under `environment` and grade the patches —
 *  the Phase-1 loop body, factored so the MCP materialization wraps it. */
async function driveAndGrade<T extends SweEvalTask>(
  environment: AgenticSurface,
  mcp: LocalMcpMaterialization | undefined,
  systemPrompt: string,
  opts: SweEvalRunnerOptions<T>,
  signal?: AbortSignal,
): Promise<EvalResult> {
  const rows: SweEvalTaskResult[] = []
  let costUsd = 0
  let judgeCalls = 0
  let judgeErrors = 0

  for (const task of opts.tasks) {
    if (signal?.aborted) throw new Error('sweEvalRunner: aborted')

    // Capture the LATEST non-empty diff from inside score() — the refine loop
    // calls it before the surface closes and rms the checkout, and a later
    // empty read must never clobber a real patch (the swe-emit-patch pattern).
    let capturedPatch = ''
    const proxy: AgenticSurface = {
      ...environment,
      async score(_t, handle: ArtifactHandle): Promise<SurfaceScore> {
        try {
          const d = await exec('git', ['-C', handle.id, 'diff'], {
            maxBuffer: 40_000_000,
            timeout: 60_000,
          })
          if (d.stdout.trim()) capturedPatch = d.stdout
        } catch {
          /* workspace gone or git error → keep whatever we already captured */
        }
        return { passes: capturedPatch.trim() ? 1 : 0, total: 1, errored: 0 }
      },
    }

    const run = await runAgentic({
      surface: proxy,
      task: { id: task.id, systemPrompt, userPrompt: task.prompt, meta: { instanceId: task.id } },
      strategy: refine,
      routerBaseUrl: opts.routerBaseUrl,
      routerKey: opts.routerKey,
      model: opts.model,
      maxTokens: opts.maxTokens,
      innerTurns: opts.innerTurns,
      budget: opts.budget ?? 1,
    })
    costUsd += run.usd

    let resolved = false
    let judgeError: string | undefined
    if (capturedPatch.trim()) {
      judgeCalls += 1
      try {
        resolved = (await opts.judge(task, capturedPatch)).resolved
      } catch (e) {
        judgeErrors += 1
        judgeError = e instanceof Error ? e.message : String(e)
      }
    }

    rows.push({
      id: task.id,
      resolved,
      patchBytes: capturedPatch.length,
      usd: run.usd,
      shots: run.shots,
      tokens: run.tokens,
      ...(judgeError === undefined ? {} : { judgeError }),
    })
    console.error(
      `[swe-eval] ${task.id} resolved=${resolved} patch=${capturedPatch.length}b ` +
        `shots=${run.shots} tok=in:${run.tokens.input}/out:${run.tokens.output} usd=${run.usd.toFixed(4)}` +
        (judgeError ? ` judgeError=${judgeError.slice(0, 200)}` : ''),
    )
  }

  // Every judge invocation failing is broken grading infrastructure (docker
  // down, venv missing) — reporting composite=0 from it would fabricate a
  // score, so fail loud instead.
  if (judgeErrors > 0 && judgeErrors === judgeCalls) {
    throw new Error(
      `sweEvalRunner: all ${judgeErrors} judge invocation(s) failed — grading infra is down, refusing to report a fabricated composite`,
    )
  }

  return {
    composite: rows.filter((r) => r.resolved).length / rows.length,
    costUsd,
    details: { systemPrompt, mcpTools: mcp?.tools.map((t) => t.function.name) ?? [], rows },
  }
}

/** Overlay the same-host MCP tools onto the domain surface: `tools()` appends
 *  the namespaced MCP tools, `call()` routes owned names to the live stdio
 *  children — open/score/close pass through untouched. */
function withLocalMcpTools(env: AgenticSurface, mcp: LocalMcpMaterialization): AgenticSurface {
  return {
    ...env,
    tools: async (task, handle) => [...(await env.tools(task, handle)), ...mcp.tools],
    call: (handle, name, args) =>
      mcp.owns(name) ? mcp.call(name, args) : env.call(handle, name, args),
  }
}

/** The profile→prompt bridge: base `systemPrompt` (seed fallback) followed by
 *  every `instructions` line — the surface `applyArtifact` mutates for `prompt`
 *  artifacts, so candidates measurably change the driven worker. */
function renderSystemPrompt(profile: AgentProfile, seedPrompt: string): string {
  const base = profile.prompt?.systemPrompt?.trim() || seedPrompt
  const instructions = (profile.prompt?.instructions ?? []).filter((s) => s.trim().length > 0)
  return [base, ...instructions].join('\n\n')
}
