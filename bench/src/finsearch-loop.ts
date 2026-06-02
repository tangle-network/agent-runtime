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
  blind,
  createDynamicDriver,
  type OutputAdapter,
  runLoop,
  type TopologyMove,
  type TopologyPlanner,
  type Validator,
} from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import type { BenchTask } from './benchmarks/types'
import { DEFAULT_SANDBOX_REFINE_DIRECTIVE } from './worker-sandbox-research'

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
function refinePlanner(rootQuestion: string, maxRounds: number): TopologyPlanner<string, string> {
  return ({ history }): TopologyMove<string> => {
    if (history.some((h) => h.verdict?.valid)) return { kind: 'stop', rationale: 'a valid answer exists' }
    if (history.length === 0) return { kind: 'refine', task: rootQuestion, rationale: 'blind attempt' }
    if (history.length >= maxRounds) return { kind: 'stop', rationale: 'round budget exhausted' }
    const prior = history.at(-1)?.output ?? ''
    return {
      kind: 'refine',
      task: `${rootQuestion}\n\n--- Your previous answer ---\n${prior.slice(-3000)}\n\n${DEFAULT_SANDBOX_REFINE_DIRECTIVE}`,
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
  const fs = await import('node:fs/promises')

  await adapter.preflight()
  const ids = process.env.IDS ? process.env.IDS.split(',') : undefined
  const tasks = await adapter.loadTasks(ids ? { ids } : { limit: Number(process.env.N ?? 8) })
  console.log(
    `[finsearch-loop] ${tasks.length} instances · THROUGH runLoop+createDynamicDriver · rounds=${rounds} · model=${model} · conc=${conc}`,
  )

  const client = new Sandbox({ baseUrl: sandboxBaseUrl, apiKey: sandboxKey, timeoutMs: 180_000 } as never)
  const agg = { n: 0, blind: 0, randomK: 0, refine: 0, errored: 0 }
  let next = 0
  let done = 0

  const agentRun: AgentRunSpec<string> = {
    profile: { name: 'finsearch-worker', metadata: { backendType: 'opencode' } },
    name: 'finsearch-worker',
    taskToPrompt: (q) => q,
    sandboxOverrides: {
      backend: { model: { provider: 'openai', model, baseUrl: routerBaseUrl, apiKey: routerKey } },
    },
  }

  // Run one condition through the real kernel; return {resolved, blind(iter0), infraError}.
  const runCondition = async (task: BenchTask, planner: TopologyPlanner<string, string>) => {
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
    return {
      resolved: result.winner?.verdict?.valid === true,
      blind: iter0?.verdict?.valid === true,
      infraError,
    }
  }

  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++] as BenchTask
      try {
        // Paired: same task/model/judge, only the planner differs. random@k = compute control.
        const rnd = await runCondition(task, randomPlanner(task.prompt, rounds))
        const ref = await runCondition(task, refinePlanner(task.prompt, rounds))
        done += 1
        if (rnd.infraError || ref.infraError) {
          agg.errored += 1
          console.log(`  [${done}/${tasks.length}] ${task.id}: INFRA-ERROR (excluded)`)
          await fs.appendFile(out, `${JSON.stringify({ id: task.id, infraError: true })}\n`)
          continue
        }
        agg.n += 1
        if (ref.blind) agg.blind += 1
        if (rnd.resolved) agg.randomK += 1
        if (ref.resolved) agg.refine += 1
        console.log(
          `  [${done}/${tasks.length}] ${task.id}: blind=${ref.blind ? '✓' : '·'} random@${rounds}=${rnd.resolved ? '✓' : '·'} refine@${rounds}=${ref.resolved ? '✓' : '·'}`,
        )
        await fs.appendFile(
          out,
          `${JSON.stringify({ id: task.id, blind: ref.blind, randomK: rnd.resolved, refineK: ref.resolved })}\n`,
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
  console.log(`\n=== FinSearchComp THROUGH runLoop — refine@k vs random@k (clean n=${agg.n}, excluded ${agg.errored} infra-errored, rounds=${rounds}) ===`)
  console.log(`  blind     (1 attempt):        ${pct(agg.blind)}  (${agg.blind}/${agg.n})`)
  console.log(`  random@${rounds} (k tries, no steer): ${pct(agg.randomK)}  (${agg.randomK}/${agg.n})  ← compute control`)
  console.log(`  refine@${rounds} (k tries, steered):  ${pct(agg.refine)}  (${agg.refine}/${agg.n})`)
  console.log(`  ► more-compute effect (random@k − blind): ${dlt(agg.randomK - agg.blind)}`)
  console.log(`  ► STEERING effect (refine@k − random@k):  ${dlt(agg.refine - agg.randomK)}  ← the isolated driver-loop contribution`)
  console.log(`scorecard: ${out}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
