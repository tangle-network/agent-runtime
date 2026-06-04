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

/** k INDEPENDENT bare attempts — the compute control (random@k). Isolates
 *  "more tries" from "steering": any treatment minus this at equal k is the
 *  steering-specific effect. */
export const randomArm = (label = 'random'): Arm => ({
  label,
  planner: (rootPrompt, rounds) =>
    ({ history }): TopologyMove<string> => {
      if (history.some((h) => h.verdict?.valid)) return { kind: 'stop', rationale: 'a valid answer exists' }
      if (history.length >= rounds) return { kind: 'stop', rationale: 'round budget exhausted' }
      return { kind: 'refine', task: rootPrompt, rationale: 'independent re-attempt (no steering)' }
    },
})

/** Evidence-gated refine: round 1 is bare (== blind); later rounds carry the
 *  prior answer forward + a directive. The steering arm. */
export const refineArm = (label: string, directive: string): Arm => ({
  label,
  planner: (rootPrompt, rounds) =>
    ({ history }): TopologyMove<string> => {
      if (history.some((h) => h.verdict?.valid)) return { kind: 'stop', rationale: 'a valid answer exists' }
      if (history.length === 0) return { kind: 'refine', task: rootPrompt, rationale: 'blind attempt' }
      if (history.length >= rounds) return { kind: 'stop', rationale: 'round budget exhausted' }
      const prior = history.at(-1)?.output ?? ''
      return {
        kind: 'refine',
        task: `${rootPrompt}\n\n--- Your previous answer ---\n${prior.slice(-3000)}\n\n${directive}`,
        rationale: 'evidence-gated refine',
      }
    },
})

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
