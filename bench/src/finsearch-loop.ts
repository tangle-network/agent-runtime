/**
 * FinSearchComp through the REAL driver loop — the product validation.
 *
 * Every other bench runner hand-rolls the refine loop inside the worker. This one
 * routes blind-vs-refine through the actual agent-runtime kernel:
 *   runLoop({ driver: createDynamicDriver({ planner }), agentRun, output, validator })
 * - agentRun = the FinSearchComp sandbox worker (Sandbox.create + streamPrompt), the
 *   kernel's native contract — a fresh sandbox per iteration.
 * - planner = a real TopologyPlanner: round 1 = the bare question (== blind pass@1);
 *   rounds 2..k = the question + the prior answer + the evidence-gated refine
 *   directive (carried forward via history, since each iteration is a fresh box).
 *   Stops as soon as an iteration is valid.
 * - validator = the benchmark's own per-record LLM judge → DefaultVerdict.
 *
 * One runLoop per instance yields BOTH numbers: iterations[0].verdict = blind pass@1
 * (round 1, no directive); winner.verdict.valid = refine (any iteration resolved).
 * So the SAME kernel run produces the paired blind-vs-refine comparison — and the
 * delta, if any, is the driver loop's, not a reimplementation's.
 */

import {
  type AgentRunSpec,
  createDynamicDriver,
  type OutputAdapter,
  runLoop,
  type TopologyMove,
  type TopologyPlanner,
  type Validator,
} from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import { appendRunRecord, buildRunRecord } from './corpus'
import type { BenchTask } from './benchmarks/types'
import { DEFAULT_SANDBOX_REFINE_DIRECTIVE } from './worker-sandbox-research'
import { runSteeringExperiment } from './steering-experiment'

/** One condition's outcome: did the k-attempt loop resolve, was the blind (iter0)
 *  attempt valid, and did infra (not a wrong answer) fail the run. */
interface ConditionResult {
  resolved: boolean
  blind: boolean
  infraError: boolean
}

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

/** Parse the agent's answer from the sandbox event stream (harness-agnostic). */
const answerOutput: OutputAdapter<string> = {
  parse(events) {
    let answer = ''
    for (const ev of events) {
      const d = ev?.data as Record<string, unknown> | undefined
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) answer = t
    }
    return answer
  },
}

/**
 * Evidence-gated refine planner — a real TopologyPlanner driving the kernel.
 * Round 1 issues the bare question (the blind attempt the kernel judges first).
 * Later rounds carry the prior answer forward (fresh box each iteration) + the
 * gated directive. Stops on the first valid verdict or when the budget runs out.
 */
/** GEPA-learned refine directive (bycd31l10, +7.1pp held-out vs hand-written on the
 *  GEPA run). Fixes the hand-written directive's blank-reply failure mode by
 *  separating the verification note from the (verbatim-preserved) final answer. */
const GEPA_LEARNED_DIRECTIVE =
  'Double-check it: re-verify the fact/value against a reliable, citable source. Provide a brief Verification note naming the source you used (link or title); this note is not part of the final answer. Confirm the requested units/precision/tolerance exactly. If the prior answer is correct, copy the SAME final answer text verbatim with identical formatting—do not add or remove words. Change it ONLY if you find a concrete error in the value or in the cited source; in that case, briefly describe the specific error in the Verification note and provide the corrected value with the requested units/precision/tolerance. If you cannot verify, state that in the Verification note, but do not alter or omit the final answer. Always place the final answer as the last line of your reply, containing only the answer text.'

function refinePlanner(rootQuestion: string, maxRounds: number, directive: string): TopologyPlanner<string, string> {
  return ({ history }): TopologyMove<string> => {
    if (history.some((h) => h.verdict?.valid)) return { kind: 'stop', rationale: 'a valid answer exists' }
    if (history.length === 0) return { kind: 'refine', task: rootQuestion, rationale: 'blind attempt' }
    if (history.length >= maxRounds) return { kind: 'stop', rationale: 'round budget exhausted' }
    const prior = history.at(-1)?.output ?? ''
    return {
      kind: 'refine',
      task: `${rootQuestion}\n\n--- Your previous answer ---\n${prior.slice(-3000)}\n\n${directive}`,
      rationale: 'evidence-gated refine',
    }
  }
}

/**
 * The COMPUTE CONTROL: k INDEPENDENT bare attempts (no carried answer, no
 * directive). any-pass over k = random@k. Isolates "more tries" from "steering"
 * — refine@k minus random@k at equal k is the steering-specific contribution.
 */
function randomPlanner(rootQuestion: string, maxRounds: number): TopologyPlanner<string, string> {
  return ({ history }): TopologyMove<string> => {
    if (history.some((h) => h.verdict?.valid)) return { kind: 'stop', rationale: 'a valid answer exists' }
    if (history.length >= maxRounds) return { kind: 'stop', rationale: 'round budget exhausted' }
    return { kind: 'refine', task: rootQuestion, rationale: 'independent re-attempt (no steering)' }
  }
}

async function main() {
  const adapter = createFinsearchcompAdapter()
  const model = process.env.WORKER_MODEL ?? 'gpt-5'
  const rounds = Number(process.env.ROUNDS ?? 3)
  const conc = Number(process.env.CONCURRENCY ?? 3)
  const sandboxBaseUrl = process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools'
  const sandboxKey = must('SANDBOX_KEY')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('ROUTER_KEY')
  const out = process.env.SCORECARD ?? '/tmp/finsearch-loop.jsonl'
  // The durable learning-flywheel corpus (full RunRecords; see docs/learning-flywheel.md).
  const corpus = process.env.CORPUS ?? '/home/drew/code/agent-runtime/bench/corpus/finsearch.jsonl'
  const fs = await import('node:fs/promises')

  await adapter.preflight()
  const ids = process.env.IDS ? process.env.IDS.split(',') : undefined
  const tasks = await adapter.loadTasks(ids ? { ids } : { limit: Number(process.env.N ?? 8) })
  console.log(
    `[finsearch-loop] ${tasks.length} instances · THROUGH runLoop+createDynamicDriver · rounds=${rounds} · model=${model} · conc=${conc}`,
  )

  // 20-min transport timeout — a multi-turn web-research agent legitimately takes
  // minutes; a 3-min cap guillotines deep research and understates every condition.
  const client = new Sandbox({ baseUrl: sandboxBaseUrl, apiKey: sandboxKey, timeoutMs: 1_200_000 } as never)
  const agg = { n: 0, blind: 0, randomK: 0, refineHand: 0, refineGepa: 0, errored: 0 }
  let next = 0
  let done = 0

  const agentRun: AgentRunSpec<string> = {
    profile: { name: 'finsearch-worker', metadata: { backendType: 'opencode' } },
    name: 'finsearch-worker',
    taskToPrompt: (q) => q,
    sandboxOverrides: {
      backend: { type: 'opencode', model: { provider: 'openai', model, baseUrl: routerBaseUrl, apiKey: routerKey } },
    },
  }

  // Run one condition through the real kernel; persist a full RunRecord to the
  // flywheel corpus (state·steer·trace·output·verdict·cost — not a boolean); return
  // {resolved, blind(iter0), infraError}.
  const runCondition = async (
    task: BenchTask,
    planner: TopologyPlanner<string, string>,
    condition: string,
  ): Promise<ConditionResult> => {
    const validator: Validator<string> = {
      async validate(answer) {
        if (!answer.trim()) return { valid: false, score: 0 }
        const v = await adapter.judge(task, answer)
        return { valid: v.resolved === true, score: v.score }
      },
    }
    const result = await runLoop<string, string, 'continue' | 'done'>({
      driver: createDynamicDriver<string, string>({ planner, maxIterations: rounds }),
      agentRun,
      output: answerOutput,
      validator,
      task: task.prompt,
      ctx: { sandboxClient: client },
      maxIterations: rounds,
    })
    const iter0 = result.iterations[0]
    // Infra error = round-1 iteration itself threw (stream drop / sandbox), not a wrong answer.
    const infraError = iter0?.error !== undefined && iter0.output === undefined
    const resolved = result.winner?.verdict?.valid === true
    // The flywheel fuel: every attempt's trace+outcome, durably, for cross-run learning.
    // A failed append is logged LOUD, never swallowed — a silent drop would leave the
    // corpus with treatment rows but a missing control row for an instance (fail-loud
    // doctrine). Downstream corpus-report pairs on the instanceId INTERSECTION, so a
    // dropped row excludes that instance from the contrast rather than scoring it 0 —
    // but the loss must still be visible, not silent.
    await appendRunRecord(
      corpus,
      buildRunRecord({
        benchmark: 'finsearchcomp',
        instanceId: task.id,
        condition,
        model,
        iterations: result.iterations,
        resolved,
        infraError,
      }),
    ).catch((err) =>
      console.error(
        `[corpus] append FAILED for ${task.id} [${condition}] — row dropped: ${err instanceof Error ? err.message : err}`,
      ),
    )
    return { resolved, blind: iter0?.verdict?.valid === true, infraError }
  }

  // Retry a condition on TRANSIENT infra failure (sandbox stream drop) — a dropped
  // stream is infra noise, not a failed attempt. Up to `tries` fresh runLoops; only a
  // persistent infra error (all tries drop) marks the cell infra-errored. The runLoop
  // path creates a fresh box per iteration → high stream-drop exposure; this is the fix.
  const tries = Number(process.env.INFRA_RETRIES ?? 3)
  const runConditionRetried = async (task: BenchTask, planner: TopologyPlanner<string, string>, condition: string) => {
    let last = await runCondition(task, planner, condition)
    for (let t = 1; t < tries && last.infraError; t++) last = await runCondition(task, planner, condition)
    return last
  }

  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++] as BenchTask
      try {
        // Paired 3-way through runSteeringExperiment: same task/model/judge, only
        // the planner differs. The compute control (random@k) is a REQUIRED field
        // — it cannot be dropped without a type error, so no steering delta is ever
        // reported uncontrolled. refineHand = hand directive · refineGepa = learned.
        const { control, treatments } = await runSteeringExperiment<string, string, ConditionResult>(
          {
            control: { label: `random@${rounds}`, planner: randomPlanner(task.prompt, rounds) },
            treatments: [
              { label: `refineHand@${rounds}`, planner: refinePlanner(task.prompt, rounds, DEFAULT_SANDBOX_REFINE_DIRECTIVE) },
              { label: `refineGepa@${rounds}`, planner: refinePlanner(task.prompt, rounds, GEPA_LEARNED_DIRECTIVE) },
            ],
          },
          (arm) => runConditionRetried(task, arm.planner, arm.label),
        )
        const rnd = control.result
        const refH = treatments[0]?.result as ConditionResult // refineHand (stable order)
        const refG = treatments[1]?.result as ConditionResult // refineGepa
        done += 1
        if (rnd.infraError || refH.infraError || refG.infraError) {
          agg.errored += 1
          console.log(`  [${done}/${tasks.length}] ${task.id}: INFRA-ERROR (excluded)`)
          await fs.appendFile(out, `${JSON.stringify({ id: task.id, infraError: true })}\n`)
          continue
        }
        agg.n += 1
        if (refH.blind) agg.blind += 1
        if (rnd.resolved) agg.randomK += 1
        if (refH.resolved) agg.refineHand += 1
        if (refG.resolved) agg.refineGepa += 1
        console.log(
          `  [${done}/${tasks.length}] ${task.id}: blind=${refH.blind ? '✓' : '·'} random@${rounds}=${rnd.resolved ? '✓' : '·'} refineHand=${refH.resolved ? '✓' : '·'} refineGepa=${refG.resolved ? '✓' : '·'}`,
        )
        await fs.appendFile(
          out,
          `${JSON.stringify({ id: task.id, blind: refH.blind, randomK: rnd.resolved, refineHand: refH.resolved, refineGepa: refG.resolved })}\n`,
        )
      } catch (err) {
        done += 1
        agg.errored += 1
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`  [${done}/${tasks.length}] ${task.id}: ERR ${msg.slice(0, 70)} (excluded)`)
        await fs.appendFile(out, `${JSON.stringify({ id: task.id, error: msg })}\n`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, tasks.length) }, worker))

  const pct = (x: number) => (agg.n > 0 ? `${((x / agg.n) * 100).toFixed(1)}%` : 'n/a')
  const dlt = (x: number) => `${(((x) / Math.max(agg.n, 1)) * 100).toFixed(1)} pp`
  console.log(`\n=== FinSearchComp THROUGH runLoop — 3-way (clean n=${agg.n}, excluded ${agg.errored} infra-errored, rounds=${rounds}) ===`)
  console.log(`  blind          (1 attempt):         ${pct(agg.blind)}  (${agg.blind}/${agg.n})`)
  console.log(`  random@${rounds}      (k tries, no steer):  ${pct(agg.randomK)}  (${agg.randomK}/${agg.n})  ← compute control`)
  console.log(`  refineHand@${rounds}  (hand directive):    ${pct(agg.refineHand)}  (${agg.refineHand}/${agg.n})`)
  console.log(`  refineGepa@${rounds}  (GEPA directive):    ${pct(agg.refineGepa)}  (${agg.refineGepa}/${agg.n})`)
  console.log(`  ► more-compute (random − blind):          ${dlt(agg.randomK - agg.blind)}`)
  console.log(`  ► STEERING hand (refineHand − random):    ${dlt(agg.refineHand - agg.randomK)}`)
  console.log(`  ► STEERING GEPA (refineGepa − random):    ${dlt(agg.refineGepa - agg.randomK)}  ← does the LEARNED directive beat just-more-compute?`)
  console.log(`scorecard: ${out} · CI: tsx src/analyze-paired.mts ${out}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
