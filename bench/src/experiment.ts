/**
 * The ONE flow.
 *
 * Every bench experiment is the same shape — `N instances × a set of arms`, each
 * arm a topology driven through the real kernel, judged, and written to the
 * flywheel corpus. The zoo of subcommands (`batch-blind`, `batch-oracle`,
 * `batch-compare`, the `-local`/`SANDBOX`/`RESEARCH`/`DIVERSE` flag matrix) was
 * that one shape with four orthogonal knobs frozen into separate commands. Here
 * the knobs are PARAMETERS:
 *
 *   - task        = the `BenchmarkAdapter` (prompt · deliverable · judge)   — any task
 *   - backend     = the injected `LoopSandboxClient` (router / local-bridge / sandbox) — the cost dial
 *   - arms        = `Arm[]` (blind · random@k · refine@k · diverse@k …), each a `TopologyPlanner`
 *   - judge       = `adapter.judge` → `Validator`                            — swap for any judge
 *
 * Nothing here re-implements execution or usage capture: `runLoop` is the loop,
 * `createDynamicDriver` turns an arm's planner into the driver, and the kernel
 * sums real token usage + cost into each `Iteration` by construction. The
 * compute-matched control is enforced by `runSteeringExperiment` (a steering
 * delta cannot be computed without its random@k control — a type-level guard).
 */

import {
  type AgentProfile,
  type AgentRunSpec,
  createDynamicDriver,
  type LoopSandboxClient,
  type OutputAdapter,
  runLoop,
  type TopologyMove,
  type TopologyPlanner,
  type Validator,
} from '@tangle-network/agent-runtime/loops'
import type { BenchmarkAdapter, BenchTask } from './benchmarks/types'
import { appendRunRecord, buildRunRecord } from './corpus'
import { routerChatWithUsage } from './router-client'
import { runPool } from './run-pool'
import { runSteeringExperiment } from './steering-experiment'

/** Parse the agent's final answer from the event stream (harness-agnostic).
 *  The default deliverable; a benchmark whose artifact is a file overrides via
 *  its own `OutputAdapter` that reads from the run. */
export const answerOutput: OutputAdapter<string> = {
  parse(events) {
    let answer = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) answer = t
    }
    return answer
  },
}

/** An experiment arm = a labelled topology. `planner(task, rounds)` builds the
 *  per-instance `TopologyPlanner` the kernel drives. Blind is just `rounds: 1`. */
export interface Arm {
  label: string
  planner: (rootPrompt: string, rounds: number) => TopologyPlanner<string, string>
}

/** The steer `f(trace)`: given the root prompt + the attempts so far, build the
 *  NEXT attempt's prompt. This is the ONLY thing that varies between arms — the
 *  docs' `steerPolicy: (trace, history) → steer` (learning-flywheel.md), "the
 *  optimizable core". Stop (valid-or-budget) and topology (sequential, width 1)
 *  are identical across every arm, so they live ONCE in `arm`, not per-arm.
 *  ("refine"/"random"/"diverse" are just three points in steer-space; the RSI
 *  endgame is to LEARN this `f`, not hand-write it.) */
/** What a steer sees of each prior attempt: its output, its verdict, and its raw
 *  trace events. Structurally a subset of the kernel's `Iteration`, so the real
 *  history passes straight in. The events are the trace an analyst reads. */
export type SteerHistory = ReadonlyArray<{
  output?: string
  verdict?: { valid?: boolean; score?: number }
  events?: readonly unknown[]
}>

/** The steer `f(trace)`. ASYNC, so a steer can DO work before emitting the next
 *  prompt: a static string (refine/diverse), one LLM call over the trace
 *  (llmAnalyst), or a whole sub-loop / sandbox execution (loopAnalyst). */
export type Steer = (rootPrompt: string, history: SteerHistory, round: number) => string | Promise<string>

/** An arm IS a steer wrapped in the shared stop/topology shell. */
export const arm = (label: string, steer: Steer): Arm => ({
  label,
  planner: (rootPrompt, rounds) =>
    async ({ history }): Promise<TopologyMove<string>> => {
      if (history.some((h) => h.verdict?.valid)) return { kind: 'stop', rationale: 'a valid answer exists' }
      if (history.length >= rounds) return { kind: 'stop', rationale: 'round budget exhausted' }
      return { kind: 'refine', task: await steer(rootPrompt, history, history.length), rationale: `${label} step ${history.length}` }
    },
})

/** random@k — ignore history (the compute control: more tries, no steering). */
export const randomArm = (label = 'random'): Arm => arm(label, (root) => root)

/** refine@k — round 0 bare (== blind); later rounds carry the prior answer + a directive. */
export const refineArm = (label: string, directive: string): Arm =>
  arm(label, (root, history, round) =>
    round === 0
      ? root
      : `${root}\n\n--- Your previous answer ---\n${(history.at(-1)?.output ?? '').slice(-3000)}\n\n${directive}`,
  )

/** diverse@k — rotate a distinct strategy lens per attempt (approach diversity). */
export const diverseArm = (label: string, lenses: string[]): Arm =>
  arm(label, (root, _history, round) => {
    const lens = lenses[round % lenses.length] ?? ''
    return lens ? `${lens}\n\n${root}` : root
  })

/**
 * The investigation: read the prior attempt's trace, return targeted feedback for
 * the next one. This is the `LLM(trace)` rung and up (docs/learning-flywheel.md) —
 * "a targeted steer from the actual failure", where signal likely lives. It is an
 * `Agent.act` over the history: a single model call (llmAnalyst), or a whole sub-loop
 * (loopAnalyst). It observes BEHAVIOR (output, trace), never the judge's verdict —
 * the selector != judge firewall.
 */
export type AnalystFn = (history: SteerHistory) => Promise<string>

/** analyst@k — round 0 is bare; later rounds prepend a TARGETED correction the
 *  analyst derived from the actual trace (not a fixed "double-check it" directive).
 *  The honest open question vs blind compute; this is the seam to test it. */
export const analystArm = (label: string, analyze: AnalystFn): Arm =>
  arm(label, async (root, history, round) => {
    if (round === 0) return root
    const feedback = (await analyze(history)).trim()
    return feedback && !/^no change needed/i.test(feedback)
      ? `${root}\n\n--- Analysis of your previous attempt ---\n${feedback}\n\nApply this correction and give the final answer.`
      : root
  })

/** Simple analyst: ONE model call reads a bounded view of the last attempt (its
 *  output + a tail of its trace events) and returns a concrete correction. */
export const llmAnalyst = (cfg: { routerBaseUrl: string; routerKey: string; model: string }): AnalystFn =>
  async (history) => {
    const last = history.at(-1)
    const traceTail = (last?.events ?? [])
      .slice(-12)
      .map((e) => (typeof e === 'string' ? e : JSON.stringify(e)))
      .join('\n')
      .slice(-2000)
    const { content } = await routerChatWithUsage(cfg, [
      {
        role: 'system',
        content:
          "You review an AI agent's previous attempt at a task. Name the SPECIFIC error (a wrong value, a missing step, a misread requirement) and state the concrete correction in 1-3 sentences. If the attempt looks correct, reply exactly: no change needed.",
      },
      { role: 'user', content: `Previous answer:\n${last?.output ?? '(none)'}\n\nTrace tail:\n${traceTail}` },
    ])
    return content
  }

/** Agentic analyst: the steer is a WHOLE sub-loop. A sandbox agent investigates the
 *  failed attempt (re-reads the task, checks sources/tests) and its conclusion IS the
 *  steer. The recursive Agent atom in practice: one loop's steer is itself a `runLoop`
 *  (max power, max cost). The rung the gate has not yet cleared — wire it, then test it. */
export const loopAnalyst = (cfg: {
  sandboxClient: LoopSandboxClient
  agentRun: AgentRunSpec<string>
  rounds?: number
}): AnalystFn =>
  async (history) => {
    const last = history.at(-1)
    const task =
      `A prior attempt at the task FAILED or is unverified. Its output was:\n\n${last?.output ?? '(empty)'}\n\n` +
      'Investigate WHY: re-read the requirements, check the relevant sources or tests, and find the specific error. ' +
      'Produce a concise, targeted correction (what to change and why) for the next attempt.'
    const result = await runLoop<string, string, 'continue' | 'done'>({
      driver: createDynamicDriver<string, string>({
        planner: randomArm('investigate').planner(task, cfg.rounds ?? 1),
        maxIterations: cfg.rounds ?? 1,
      }),
      agentRun: cfg.agentRun,
      output: answerOutput,
      validator: { async validate(a) { return { valid: a.trim().length > 0, score: a.trim() ? 1 : 0 } } },
      task,
      ctx: { sandboxClient: cfg.sandboxClient },
      maxIterations: cfg.rounds ?? 1,
    })
    return result.winner?.output ?? [...result.iterations].reverse().find((it) => (it.output ?? '').trim())?.output ?? ''
  }

/** Cost-dial backend types we drive (tcloud `BackendType`). `hermes` = the
 *  inference-router agent (the cheap "router llm-call" dial); the rest are agent
 *  CLIs. This is the ONLY knob that changes which agent runs — no per-backend worker. */
export type WorkerBackendType = 'opencode' | 'hermes' | 'claude-code' | 'codex' | 'kimi-code' | 'pi'

/** Build the standard sandbox `AgentRunSpec` for a benchmark — the worker the
 *  kernel injects. `backendType` is the cost dial; the router env wiring mirrors
 *  every sandbox path (opencode's provider auth reads OPENAI_* in-box). */
export function sandboxAgentRun(opts: {
  model: string
  routerBaseUrl: string
  routerKey: string
  backendType?: WorkerBackendType
  name?: string
  taskToPrompt?: (task: string) => string
  /** The developer's AgentProfile — the one knob for "which agent" (prompt / model /
   *  tools / mcp). Spread through verbatim; the backend cost-dial is tagged into
   *  metadata. Omitted ⇒ a minimal worker profile. */
  profile?: AgentProfile
}): AgentRunSpec<string> {
  const backendType = opts.backendType ?? 'opencode'
  const name = opts.profile?.name ?? opts.name ?? `${backendType}-worker`
  return {
    profile: { ...opts.profile, name, metadata: { ...opts.profile?.metadata, backendType } },
    name,
    taskToPrompt: opts.taskToPrompt ?? ((t) => t),
    sandboxOverrides: {
      env: { OPENAI_API_KEY: opts.routerKey, OPENAI_BASE_URL: opts.routerBaseUrl },
      backend: {
        type: backendType,
        model: { provider: 'openai', model: opts.model, baseUrl: opts.routerBaseUrl, apiKey: opts.routerKey },
      },
    },
  }
}

export interface ExperimentConfig {
  /** The task — supplies prompt (`loadTasks`), judge, and (optionally) deliverable. */
  adapter: BenchmarkAdapter
  /** The cost-dial backend, injected. The kernel provisions per iteration. */
  sandboxClient: LoopSandboxClient
  /** The worker profile + task→prompt formatter the kernel runs. */
  agentRun: AgentRunSpec<string>
  /** control + treatments. `arms[0]` is the compute control (random@k). */
  arms: [Arm, ...Arm[]]
  model: string
  rounds?: number
  n?: number
  ids?: string[]
  concurrency?: number
  /** Deliverable extraction. Default: the agent's final answer text. */
  output?: OutputAdapter<string>
  /** Durable flywheel corpus path (full RunRecords). */
  corpusPath?: string
  /** Retries on a TRANSIENT infra failure (sandbox stream drop) before a cell
   *  is marked infra-errored and excluded. */
  infraRetries?: number
  now?: () => Date
}

export interface ArmAggregate {
  label: string
  resolved: number
  /** Δ vs the control arm (`arms[0]`), in instances. */
  deltaVsControl: number
}

export interface ExperimentResult {
  benchmark: string
  n: number
  errored: number
  blind: number
  arms: ArmAggregate[]
}

interface ArmOutcome {
  resolved: boolean
  blind: boolean
  infraError: boolean
}

/**
 * Run one experiment: N instances, each through every arm via the real kernel,
 * judged, written to the corpus. Returns per-arm resolve counts + Δ-vs-control.
 */
export async function runExperiment(cfg: ExperimentConfig): Promise<ExperimentResult> {
  const rounds = cfg.rounds ?? 3
  const conc = cfg.concurrency ?? 3
  const output = cfg.output ?? answerOutput
  const tries = cfg.infraRetries ?? 3
  const benchmark = cfg.adapter.name

  await cfg.adapter.preflight()
  const tasks = await cfg.adapter.loadTasks(cfg.ids ? { ids: cfg.ids } : { limit: cfg.n ?? 8 })

  // One arm through the kernel for one task; persist a full RunRecord (the
  // flywheel fuel — state·steer·trace·output·verdict·cost, never a boolean).
  // `planner` is already built for this task (createDynamicDriver wraps it).
  const runArm = async (
    task: BenchTask,
    label: string,
    planner: TopologyPlanner<string, string>,
  ): Promise<ArmOutcome> => {
    const validator: Validator<string> = {
      async validate(answer) {
        if (!answer.trim()) return { valid: false, score: 0 }
        const v = await cfg.adapter.judge(task, answer)
        return { valid: v.resolved === true, score: v.score }
      },
    }
    const result = await runLoop<string, string, 'continue' | 'done'>({
      driver: createDynamicDriver<string, string>({ planner, maxIterations: rounds }),
      agentRun: cfg.agentRun,
      output,
      validator,
      task: task.prompt,
      ctx: { sandboxClient: cfg.sandboxClient },
      maxIterations: rounds,
    })
    const iter0 = result.iterations[0]
    const infraError = iter0?.error !== undefined && iter0.output === undefined
    const resolved = result.winner?.verdict?.valid === true
    if (cfg.corpusPath) {
      // Fail-loud on a dropped row: a silent drop would leave the corpus with
      // some arms but not others for an instance. corpus-report pairs on the
      // instance intersection, so a logged drop excludes it rather than scoring 0.
      await appendRunRecord(
        cfg.corpusPath,
        buildRunRecord({
          benchmark,
          instanceId: task.id,
          condition: `${label}@${rounds}`,
          model: cfg.model,
          iterations: result.iterations,
          resolved,
          infraError,
          ...(cfg.now ? { now: cfg.now } : {}),
        }),
      ).catch((err) =>
        console.error(
          `[corpus] append FAILED for ${task.id} [${label}] — row dropped: ${err instanceof Error ? err.message : err}`,
        ),
      )
    }
    return { resolved, blind: iter0?.verdict?.valid === true, infraError }
  }

  const runArmRetried = async (
    task: BenchTask,
    label: string,
    planner: TopologyPlanner<string, string>,
  ): Promise<ArmOutcome> => {
    let last = await runArm(task, label, planner)
    for (let t = 1; t < tries && last.infraError; t++) last = await runArm(task, label, planner)
    return last
  }

  const [control, ...treatments] = cfg.arms
  const counts = cfg.arms.map((a) => ({ label: a.label, resolved: 0 }))
  const agg = { n: 0, errored: 0, blind: 0 }
  let done = 0

  await runPool(tasks, conc, async (task) => {
    try {
      // The compute control is REQUIRED by construction (runSteeringExperiment) —
      // no arm's delta is ever reported without its equal-k random@k control.
      const { control: ctl, treatments: treats } = await runSteeringExperiment<string, string, ArmOutcome>(
        {
          control: { label: control.label, planner: control.planner(task.prompt, rounds) },
          treatments: treatments.map((t) => ({ label: t.label, planner: t.planner(task.prompt, rounds) })),
        },
        (arm) => runArmRetried(task, arm.label, arm.planner),
      )
      const outcomes: ArmOutcome[] = [ctl.result, ...treats.map((t) => t.result as ArmOutcome)]
      done += 1
      if (outcomes.some((o) => o.infraError)) {
        agg.errored += 1
        console.log(`  [${done}/${tasks.length}] ${task.id}: INFRA-ERROR (excluded)`)
        return
      }
      agg.n += 1
      if (outcomes[0]?.blind) agg.blind += 1
      outcomes.forEach((o, i) => {
        if (o.resolved && counts[i]) counts[i].resolved += 1
      })
      console.log(
        `  [${done}/${tasks.length}] ${task.id}: ${cfg.arms.map((a, i) => `${a.label}=${outcomes[i]?.resolved ? '✓' : '·'}`).join(' ')}`,
      )
    } catch (err) {
      done += 1
      agg.errored += 1
      console.log(`  [${done}/${tasks.length}] ${task.id}: ERR ${(err instanceof Error ? err.message : String(err)).slice(0, 70)} (excluded)`)
    }
  })

  const controlResolved = counts[0]?.resolved ?? 0
  return {
    benchmark,
    n: agg.n,
    errored: agg.errored,
    blind: agg.blind,
    arms: counts.map((c) => ({ label: c.label, resolved: c.resolved, deltaVsControl: c.resolved - controlResolved })),
  }
}
