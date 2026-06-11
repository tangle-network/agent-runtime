/**
 * STEERING MODES — three corners of the steering hypercube vs the incumbent critic,
 * at equal budget, gated pairwise on the same holdout tasks:
 *
 *   refine        the incumbent: LLM trace-critique → advisory prose, every round
 *   structural    the DETERMINISTIC floor (the ddmin of steering): a pure function over
 *                 the trajectory detects stuck loops / tool-error pileups / no-execution
 *                 and emits a templated corrective. Zero LLM cost, zero added latency.
 *                 If the LLM critic cannot beat this, it is not earning its calls.
 *   contrastive   POPULATION-information steering: two fresh attempts (already paid for
 *                 in hybrid strategies, normally discarded), the critic sees BOTH
 *                 trajectories (never scores — firewall intact) and emits the DIFFERENCE
 *                 that matters; the better attempt continues with the diff as steer.
 *   belief        DECISION-theoretic steering (E8's cheap form): the critic emits a
 *                 VERDICT (CONTINUE | RESTART | STOP) + confidence — a prediction of
 *                 value-of-continuation — and the strategy obeys; it steers the BUDGET
 *                 allocation, not the message content.
 *
 * Each mode runs as its own arm on identical tasks (the grid pattern); verdicts pair
 * every mode against refine. `sample` rides along as the no-steering control. The
 * waterfall collector prints the full cost/latency story per arm.
 *
 *   N=16 BUDGET=3 INNER_TURNS=2 WORKER_MODEL=deepseek-v4-flash tsx src/steering-modes.mts
 */
import { writeFileSync } from 'node:fs'
import {
  type AgenticTask,
  anytimeReport,
  type BenchmarkReport,
  createWaterfallCollector,
  renderAnytimeTable,
  defineStrategy,
  promotionGate,
  type PromotionVerdict,
  refine,
  runBenchmark,
  sample,
  type Strategy,
} from '@tangle-network/agent-runtime/loops'
import { aimeEnvironment } from './ablation-math-env.mts'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

type Msg = Record<string, unknown>

// ── structural: the deterministic steerer (no LLM) ────────────────────────────────

interface StructuralFinding {
  steer: string | null
}

export function structuralSteer(messages: Msg[]): StructuralFinding {
  const calls: string[] = []
  let toolErrors = 0
  let assistantTurns = 0
  for (const m of messages) {
    if (m.role === 'assistant') {
      assistantTurns += 1
      const tcs = (m.tool_calls as Array<{ function?: { name?: string; arguments?: string } }> | undefined) ?? []
      for (const tc of tcs) calls.push(`${tc.function?.name}(${tc.function?.arguments ?? ''})`)
    }
    if (m.role === 'tool' && String(m.content ?? '').startsWith('ERROR:')) toolErrors += 1
  }
  const counts = new Map<string, number>()
  for (const c of calls) counts.set(c, (counts.get(c) ?? 0) + 1)
  const repeated = [...counts.entries()].filter(([, n]) => n >= 3)
  const parts: string[] = []
  if (repeated.length > 0)
    parts.push(
      `You repeated the same call ${repeated[0]?.[1]} times (${repeated[0]?.[0]?.slice(0, 80)}). Stop repeating it; take a DIFFERENT action.`,
    )
  if (toolErrors > 0)
    parts.push(`${toolErrors} tool call(s) returned ERROR. Read the error text and fix the arguments before retrying.`)
  if (calls.length === 0 && assistantTurns > 0)
    parts.push('You produced text but called NO tools. The task requires acting through the tools — act, then verify.')
  return { steer: parts.length > 0 ? parts.join('\n') : null }
}

const structural: Strategy = defineStrategy('structural', async ({ surface, task, budget, shot }) => {
  const handle = await surface.open(task)
  const progression: number[] = []
  let messages: Msg[] | undefined
  let steer: string | undefined
  let completions = 0
  let shots = 0
  try {
    for (shots = 0; shots < budget; shots += 1) {
      const out = await shot({ handle, messages, steer })
      if (!out) break
      completions += out.completions
      progression.push(out.score)
      if (out.score >= 1) break
      messages = out.messages
      const finding = structuralSteer(out.messages)
      // No structural defect found ⇒ the deterministic steerer has nothing to say:
      // re-attempt with a plain continue nudge (it never invents content).
      steer = finding.steer ?? 'Your previous attempt is incomplete. Re-check the request and finish every required change.'
    }
    const score = progression.length ? Math.max(...progression) : 0
    return { score, resolved: score >= 1, completions, progression, shots }
  } finally {
    await surface.close(handle)
  }
})

// ── contrastive: steer by the diff between two attempts ──────────────────────────

const contrastive: Strategy = defineStrategy(
  'contrastive',
  async ({ surface, task, budget, shot, critique }) => {
    const progression: number[] = []
    let completions = 0
    let shots = 0
    // Two independent fresh attempts (the population we normally discard).
    const a = await shot({})
    shots += 1
    if (a) {
      completions += a.completions
      progression.push(a.score)
      if (a.score >= 1) return { score: a.score, resolved: true, completions, progression, shots }
    }
    const b = await shot({})
    shots += 1
    if (b) {
      completions += b.completions
      progression.push(b.score)
      if (b.score >= 1) return { score: b.score, resolved: true, completions, progression, shots }
    }
    if (!a && !b) return { score: 0, resolved: false, completions, progression, shots }
    // The body (the selector role) picks the better attempt by harness-verified score;
    // the CRITIC sees both trajectories and never a score — the firewall holds.
    const best = (a?.score ?? -1) >= (b?.score ?? -1) ? a : b
    const other = best === a ? b : a
    if (!best) return { score: 0, resolved: false, completions, progression, shots }
    const handle = await surface.open(task)
    try {
      let steer: string | undefined
      if (other) {
        const contrast: Msg[] = [
          { role: 'assistant', content: '=== TRANSCRIPT A (the attempt being continued) ===' },
          ...best.messages,
          { role: 'assistant', content: '=== TRANSCRIPT B (an alternative attempt at the same task) ===' },
          ...other.messages,
          {
            role: 'assistant',
            content:
              'Compare the two transcripts. What did B attempt or verify that A missed, and what did A do that B shows to be unnecessary or wrong?',
          },
        ]
        const diff = await critique(contrast)
        completions += 1
        if (diff) steer = `A comparison of two attempts surfaced these differences to act on:\n${diff}`
      }
      for (let i = shots; i < budget; i += 1) {
        const out = await shot({ handle, messages: best.messages, steer })
        shots += 1
        if (!out) break
        completions += out.completions
        progression.push(out.score)
        if (out.score >= 1) break
      }
      const score = progression.length ? Math.max(...progression) : 0
      return { score, resolved: score >= 1, completions, progression, shots }
    } finally {
      await surface.close(handle)
    }
  },
)

// ── belief: the critic decides CONTINUE / RESTART / STOP ─────────────────────────

export const beliefInstruction = `You are a budget controller for an agent attempting a checkable task.
Read the trajectory and decide whether ONE MORE attempt continuing this line is likely to
improve the outcome, whether a FRESH restart is more promising, or whether further spend
is waste. Respond with EXACTLY one line in this format and nothing else:
VERDICT: CONTINUE|RESTART|STOP confidence=<0.0-1.0> reason=<one short clause>`

const belief: Strategy = defineStrategy('belief', async ({ surface, task, budget, shot, consult }) => {
  let handle = await surface.open(task)
  const progression: number[] = []
  let messages: Msg[] | undefined
  let completions = 0
  let shots = 0
  let parseFailures = 0
  try {
    for (shots = 0; shots < budget; shots += 1) {
      const out = await shot({ handle, messages })
      if (!out) break
      completions += out.completions
      progression.push(out.score)
      if (out.score >= 1) break
      if (shots === budget - 1) break
      // The RAW channel — the findings protocol strips verdict formats; consult() does not.
      const verdictText = await consult(out.messages, beliefInstruction)
      completions += 1
      if (!verdictText) break // analyst went down
      const m = verdictText.match(/VERDICT:\s*(CONTINUE|RESTART|STOP)/i)
      const decision = m?.[1]?.toUpperCase()
      if (!decision) parseFailures += 1
      // Calibration floor: an uncertain STOP is not obeyed — spend the budget.
      const conf = Number.parseFloat(verdictText.match(/confidence=([\d.]+)/i)?.[1] ?? '1')
      if (decision === 'STOP' && conf >= 0.7) break
      if (decision === 'RESTART') {
        await surface.close(handle)
        handle = await surface.open(task)
        messages = undefined
      } else {
        messages = out.messages
      }
    }
    const score = progression.length ? Math.max(...progression) : 0
    return { score, resolved: score >= 1, completions: completions + parseFailures * 0, progression, shots }
  } finally {
    await surface.close(handle)
  }
})

// ── The arm runner (the grid pattern: one strategy per call, pair on task ids) ────

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 16)
  const offset = Number(process.env.OFFSET ?? 40)
  const budget = Number(process.env.BUDGET ?? 3)
  const concurrency = Number(process.env.CONCURRENCY ?? 4)
  const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const { environment, tasks } = aimeEnvironment()
  const holdout = await tasks(offset, n)

  const arms: Array<{ name: string; strategy: Strategy; analystInstruction?: string }> = [
    { name: 'sample', strategy: sample },
    { name: 'refine', strategy: refine },
    { name: 'structural', strategy: structural },
    { name: 'contrastive', strategy: contrastive },
    { name: 'belief', strategy: belief },
  ]
  const armFilter = process.env.ARMS?.split(',').map((a) => a.trim())
  const selected = armFilter ? arms.filter((a) => armFilter.includes(a.name)) : arms
  if (selected.length < 2) throw new Error(`ARMS must include refine + at least one mode (got: ${process.env.ARMS})`)

  console.error(
    `=== STEERING MODES · ${selected.map((a) => a.name).join(' vs ')} · AIME[${offset},${offset + n}) · budget=${budget} · worker=${workerModel} ===`,
  )
  const reports: Record<string, BenchmarkReport> = {}
  for (const arm of selected) {
    const waterfall = createWaterfallCollector()
    const report = await runBenchmark({
      environment,
      tasks: holdout,
      worker: {
        routerBaseUrl,
        routerKey,
        model: workerModel,
        innerTurns: Number(process.env.INNER_TURNS ?? 2),
        temperature: Number(process.env.WORKER_TEMPERATURE ?? 0.7),
        ...(process.env.WORKER_MAX_TOKENS ? { maxTokens: Number(process.env.WORKER_MAX_TOKENS) } : {}),
      },
      strategies: [arm.strategy],
      budget,
      concurrency,
      hooks: waterfall.hooks,
    })
    reports[arm.name] = report
    const s = report.perStrategy[arm.strategy.name]
    const wf = waterfall.report()
    console.error(
      `\n▶ ${arm.name}: ${(100 * (s?.score ?? 0)).toFixed(1)}%  $${(s?.usd ?? 0).toFixed(4)}/task  ${((s?.ms ?? 0) / 1000).toFixed(0)}s/task` +
        `\n  spans: ${Object.entries(wf.byKind)
          .map(([k, v]) => `${k}×${v.count} $${v.usd.toFixed(4)}`)
          .join(' · ')}  (stream total $${wf.totalUsd.toFixed(4)})`,
    )
    if (process.env.WATERFALL) {
      console.error(waterfall.render({ width: 40, maxRows: 24 }))
    }
    console.error(
      renderAnytimeTable(anytimeReport(wf.spans, { targets: [0.5, 1] })),
    )
  }

  console.error(
    `\n${'='.repeat(74)}\nSTEERING VERDICTS (each mode vs refine, paired on task ids)\nworker=${workerModel} analyst=${workerModel} · AIME[${offset},${offset + n}) budget=${budget} innerTurns=${process.env.INNER_TURNS ?? 2}\n${'='.repeat(74)}`,
  )
  const verdicts: Record<string, PromotionVerdict> = {}
  const incumbentReport = reports.refine
  if (!incumbentReport) throw new Error('refine arm missing')
  for (const arm of selected) {
    if (arm.name === 'refine') continue
    const candidate = reports[arm.name]
    if (!candidate) continue
    const merged: BenchmarkReport = {
      n,
      excluded: 0,
      perStrategy: {},
      pareto: [],
      perTask: incumbentReport.perTask.map((row) => {
        const cRow = candidate.perTask.find((x) => x.taskId === row.taskId)
        const iCell = row.cells?.refine
        const cCell = cRow?.cells?.[arm.strategy.name]
        return iCell && cCell
          ? { taskId: row.taskId, cells: { refine: iCell, [arm.name]: cCell } }
          : { taskId: row.taskId, error: 'arm missing cell' }
      }),
    }
    const verdict = promotionGate({
      report: merged,
      incumbent: 'refine',
      candidate: arm.name,
      mode: 'non-inferiority',
      minPairedTasks: Math.min(6, n),
    })
    verdicts[arm.name] = verdict
    const lat = verdict.latency ? ` Δ${(verdict.latency.mean / 1000).toFixed(1)}s` : ''
    console.error(
      `  ${arm.name.padEnd(13)} Δscore ${(verdict.lift.mean * 100).toFixed(1)}pp CI[${(verdict.lift.low * 100).toFixed(1)},${(verdict.lift.high * 100).toFixed(1)}]  savings $${verdict.costSavings?.mean.toFixed(4)} CI[${verdict.costSavings?.low.toFixed(4)},${verdict.costSavings?.high.toFixed(4)}]${lat}  → ${verdict.promoted ? `PROMOTED (${verdict.reason})` : verdict.reason}`,
    )
  }
  const outPath = process.env.OUT ?? '/tmp/steering-modes-result.json'
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        models: { worker: workerModel, analyst: workerModel },
        domain: `aime[${offset},${offset + n})`,
        budget,
        arms: selected.map((a) => a.name),
        reports,
        verdicts,
      },
      null,
      2,
    ),
  )
  console.error(`  full artifact → ${outPath}`)
}

main().catch((e) => {
  console.error(`steering-modes: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
