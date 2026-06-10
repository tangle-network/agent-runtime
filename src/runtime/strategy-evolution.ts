/**
 * runStrategyEvolution — the multi-generation strategy search: per generation the system
 * authors a POPULATION of candidate strategies from the current tournament's losses,
 * plays them against the incumbent at equal budget, and advances a champion; one final
 * promotion decision runs on a NEVER-BEFORE-USED holdout slice through `promotionGate`.
 *
 * Measurement invariants (the reasons this design is shaped the way it is):
 *  - The author sees TRAIN losses only. The holdout slice is drawn fresh (disjoint task
 *    offsets) after all authoring is done — one promotion decision, one untouched slice,
 *    so adaptive reuse of evaluation data never enters the verdict.
 *  - Every tournament runs at the same per-strategy budget through the conserved pool;
 *    candidates cannot win by overspending.
 *  - Champion selection within the search is a SEARCH policy (configurable, default
 *    cost-aware: ties on score go to the cheapest strategy — a scalar hides a strategy
 *    that ties at half the cost). The promotion verdict never comes from search
 *    selection; it comes from the gate on the fresh slice.
 *  - Every authored artifact's description length (gzip bits) is recorded, so the
 *    artifact-complexity-vs-holdout-gap relation is analyzable from any run's report.
 *
 * Lineage fields (`parent`, `generation`) are recorded on every archive node so a
 * descendant-productivity parent-selection policy can be added without changing the
 * report schema; the v1 search authors from the latest tournament's losses.
 */

import { gzipSync } from 'node:zlib'
import type { ChatClient } from '@tangle-network/agent-eval'
import type { RuntimeHooks } from '../runtime-hooks'
import { type PromotionVerdict, promotionGate } from './promotion-gate'
import {
  type BenchmarkReport,
  type BenchmarkTaskRow,
  type Environment,
  runBenchmark,
} from './run-benchmark'
import {
  type AgenticOptions,
  type AgenticTask,
  refine,
  type Strategy,
  sample,
  sampleThenRefine,
} from './strategy'
import { authorStrategy, strategyAuthorContract } from './strategy-author'

export interface EvolutionAuthor {
  /** The model-call seam (agent-eval `createChatClient`). */
  chat: ChatClient
  model?: string
  fallbackModel?: string
  temperature?: number
  maxTokens?: number
}

export type ChampionPolicy = 'score' | 'costAware'

export interface StrategyEvolutionConfig {
  environment: Environment
  /** Task supply by DISJOINT slice: `(offset, n)` must return n tasks unique to that
   *  offset range. Train draws [0, trainN); the holdout draws [trainN + holdoutOffset,
   *  …) — tasks the search never touched. */
  tasks: (offset: number, n: number) => Promise<AgenticTask[]>
  trainN: number
  holdoutN: number
  /** Extra offset past the train slice for the holdout draw (rotate across runs). */
  holdoutOffset?: number
  worker: AgenticOptions
  author: EvolutionAuthor
  /** Rollouts (sample) / shots (refine) per strategy per task. Default 3. */
  budget?: number
  concurrency?: number
  /** Author→tournament rounds after gen0. Default 2. */
  generations?: number
  /** Authored candidates per generation. Default 2. */
  populationSize?: number
  /** The gen0 field. Default [sample, refine, sampleThenRefine]. */
  baselines?: Strategy[]
  /** Search-side champion selection. Default 'costAware'. */
  champion?: ChampionPolicy
  /** Score band treated as a tie under 'costAware'. Default 0.01. */
  championEpsilon?: number
  /** Where authored modules are written. */
  outDir: string
  /** Promotion-gate evidence floor (paired holdout tasks). */
  minPairedTasks?: number
  onTask?: (phase: string, row: BenchmarkTaskRow, done: number, total: number) => void
  hooks?: RuntimeHooks
}

export interface ChampionPick {
  name: string
  score: number
  usd: number
}

export interface EvolutionCandidate {
  name: string
  file?: string
  gzipBits?: number
  codeChars?: number
  /** Present when this author attempt failed (recorded, never silent). */
  error?: string
}

export interface EvolutionGeneration {
  generation: number
  candidates: EvolutionCandidate[]
  report: BenchmarkReport
  champion: ChampionPick
}

export interface EvolutionArchiveNode {
  name: string
  source: 'baseline' | 'authored'
  generation: number
  /** The champion whose tournament losses this candidate was authored from. */
  parent?: string
  gzipBits?: number
  file?: string
  /** Latest measured tournament result — 0 until the node's first tournament settles
   *  (an authored node is created before its generation's benchmark runs). */
  score: number
  usd: number
}

export interface EvolutionReport {
  gen0: BenchmarkReport
  gen0Champion: ChampionPick
  generations: EvolutionGeneration[]
  archive: EvolutionArchiveNode[]
  finalChampion: ChampionPick
  holdout: BenchmarkReport
  verdict: PromotionVerdict
  /** SEARCH TELEMETRY, not evidence: each entry is that generation's own train-slice
   *  re-measurement, so cross-generation deltas mix true drift with run-to-run variance
   *  (entries are unpaired across generations). The only evidence-grade comparison in
   *  this report is `verdict` — both finalists measured fresh, paired, on the holdout. */
  trajectory: Array<{ generation: number; champion: string; score: number; usd: number }>
}

/** Search-side champion selection over a tournament report. 'score' takes the best mean
 *  score (ties → field order). 'costAware' treats scores within `epsilon` of the best as
 *  tied and takes the cheapest — the (score, $) Pareto rule collapsed to one pick. */
export function selectChampion(
  report: BenchmarkReport,
  fieldOrder: string[],
  policy: ChampionPolicy,
  epsilon: number,
): ChampionPick {
  const entries = fieldOrder
    .map((name) => ({ name, summary: report.perStrategy[name] }))
    .filter((e): e is { name: string; summary: NonNullable<typeof e.summary> } => !!e.summary)
  if (entries.length === 0)
    throw new Error('selectChampion: report carries none of the field strategies')
  const best = Math.max(...entries.map((e) => e.summary.score))
  const pick =
    policy === 'score'
      ? entries.find((e) => e.summary.score === best)
      : entries
          .filter((e) => e.summary.score >= best - epsilon)
          .sort((a, b) => a.summary.usd - b.summary.usd || b.summary.score - a.summary.score)[0]
  if (!pick) throw new Error('selectChampion: empty pick (unreachable)')
  return { name: pick.name, score: pick.summary.score, usd: pick.summary.usd }
}

const fieldSummary = (archive: EvolutionArchiveNode[]): string =>
  archive
    .map(
      (n) =>
        `- ${n.name} (${n.source}, gen ${n.generation}, last score ${(n.score * 100).toFixed(0)}%)`,
    )
    .join('\n')

/** The author-visible losses: EVERY train task in compact form (score/resolved/
 *  progression per cell). A pretty-printed prefix slice would hide the tail tasks from
 *  the author and bias which failure modes it can target; the hard cap stays only as a
 *  guard against enormous fields. */
const compactLosses = (report: BenchmarkReport): string => {
  const r2 = (x: number) => Math.round(x * 100) / 100
  const rows = report.perTask.map((row) =>
    row.cells
      ? {
          task: row.taskId,
          cells: Object.fromEntries(
            Object.entries(row.cells).map(([name, c]) => [
              name,
              { score: r2(c.score), resolved: c.resolved, progression: c.progression.map(r2) },
            ]),
          ),
        }
      : { task: row.taskId, error: row.error?.slice(0, 80) },
  )
  return JSON.stringify(rows).slice(0, 12000)
}

export async function runStrategyEvolution(cfg: StrategyEvolutionConfig): Promise<EvolutionReport> {
  const budget = cfg.budget ?? 3
  const concurrency = cfg.concurrency ?? 3
  const generations = cfg.generations ?? 2
  const populationSize = cfg.populationSize ?? 2
  const baselines = cfg.baselines ?? [sample, refine, sampleThenRefine]
  const policy = cfg.champion ?? 'costAware'
  const epsilon = cfg.championEpsilon ?? 0.01
  const byName = new Map<string, Strategy>(baselines.map((s) => [s.name, s]))

  const bench = (phase: string, tasks: AgenticTask[], strategies: Strategy[]) =>
    runBenchmark({
      environment: cfg.environment,
      tasks,
      worker: cfg.worker,
      strategies,
      budget,
      concurrency,
      ...(cfg.onTask
        ? { onTask: (row, done, total) => cfg.onTask?.(phase, row, done, total) }
        : {}),
      ...(cfg.hooks ? { hooks: cfg.hooks } : {}),
    })

  const train = await cfg.tasks(0, cfg.trainN)
  const gen0 = await bench('gen0', train, baselines)
  const archive: EvolutionArchiveNode[] = baselines.map((s) => ({
    name: s.name,
    source: 'baseline' as const,
    generation: 0,
    score: gen0.perStrategy[s.name]?.score ?? 0,
    usd: gen0.perStrategy[s.name]?.usd ?? 0,
  }))
  const gen0Champion = selectChampion(
    gen0,
    baselines.map((s) => s.name),
    policy,
    epsilon,
  )
  let incumbent = gen0Champion
  let latestReport = gen0

  const generationRows: EvolutionGeneration[] = []
  const trajectory = [
    {
      generation: 0,
      champion: gen0Champion.name,
      score: gen0Champion.score,
      usd: gen0Champion.usd,
    },
  ]
  let authoredOk = 0

  for (let g = 1; g <= generations; g += 1) {
    const lossesJson = compactLosses(latestReport)
    const candidates: EvolutionCandidate[] = []
    const newStrategies: Strategy[] = []
    for (let i = 0; i < populationSize; i += 1) {
      const contract = `${strategyAuthorContract}\n\nSTRATEGIES ALREADY IN THE TOURNAMENT (author something MEANINGFULLY different — a new composition, not a rename):\n${fieldSummary(archive)}\n\nYou are authoring candidate ${i + 1} of ${populationSize} this generation; explore a distinct region of the strategy space from your siblings.`
      try {
        const authored = await authorStrategy({
          chat: cfg.author.chat,
          ...(cfg.author.model ? { model: cfg.author.model } : {}),
          ...(cfg.author.fallbackModel ? { fallbackModel: cfg.author.fallbackModel } : {}),
          ...(cfg.author.temperature !== undefined ? { temperature: cfg.author.temperature } : {}),
          ...(cfg.author.maxTokens !== undefined ? { maxTokens: cfg.author.maxTokens } : {}),
          contract,
          environmentName: cfg.environment.name,
          lossesJson,
          budget,
          outDir: cfg.outDir,
        })
        // A name collision with the archive would silently overwrite a report cell —
        // disambiguate the strategy key. The defineStrategy driver closes over the
        // ORIGINAL name for its deliverable's `mode` label, so the wrapper must rename
        // the returned agent AND its deliverable or observability labels diverge from
        // the report keys.
        const unique = byName.has(authored.strategy.name)
          ? `${authored.strategy.name}-g${g}c${i + 1}`
          : authored.strategy.name
        const strategy: Strategy =
          unique === authored.strategy.name
            ? authored.strategy
            : {
                name: unique,
                driver: (s, t, o, b) => {
                  const agent = authored.strategy.driver(s, t, o, b)
                  return {
                    ...agent,
                    name: unique,
                    act: async (task, scope) => {
                      const out = await agent.act(task, scope)
                      if (out.kind !== 'done') return out
                      const deliverable = {
                        ...(out.deliverable as Record<string, unknown>),
                        mode: unique,
                      }
                      return { ...out, deliverable }
                    },
                  }
                },
              }
        byName.set(unique, strategy)
        newStrategies.push(strategy)
        archive.push({
          name: unique,
          source: 'authored',
          generation: g,
          parent: incumbent.name,
          gzipBits: gzipSync(Buffer.from(authored.code)).length * 8,
          file: authored.file,
          score: 0,
          usd: 0,
        })
        candidates.push({
          name: unique,
          file: authored.file,
          gzipBits: gzipSync(Buffer.from(authored.code)).length * 8,
          codeChars: authored.code.length,
        })
        authoredOk += 1
      } catch (e) {
        candidates.push({
          name: `(author-failed g${g}c${i + 1})`,
          error: e instanceof Error ? e.message.slice(0, 300) : String(e),
        })
      }
    }

    const incumbentStrategy = byName.get(incumbent.name)
    if (!incumbentStrategy)
      throw new Error(`evolution: incumbent "${incumbent.name}" missing from the field`)
    const field = [incumbentStrategy, ...newStrategies]
    const report = await bench(`gen${g}`, train, field)
    for (const node of archive) {
      const cell = report.perStrategy[node.name]
      if (cell) {
        node.score = cell.score
        node.usd = cell.usd
      }
    }
    const champion = selectChampion(
      report,
      field.map((s) => s.name),
      policy,
      epsilon,
    )
    generationRows.push({ generation: g, candidates, report, champion })
    trajectory.push({
      generation: g,
      champion: champion.name,
      score: champion.score,
      usd: champion.usd,
    })
    incumbent = champion
    latestReport = report
  }

  if (authoredOk === 0) {
    throw new Error(
      'runStrategyEvolution: every author attempt failed across all generations — no search happened; see the candidates[].error entries',
    )
  }

  // The promotion decision: ONE fresh slice the search never touched, drawn after all
  // authoring is done. The gate, not the search policy, owns this verdict.
  const holdoutTasks = await cfg.tasks(cfg.trainN + (cfg.holdoutOffset ?? 0), cfg.holdoutN)
  const finalists = [...new Set([gen0Champion.name, incumbent.name])]
    .map((n) => byName.get(n))
    .filter((s): s is Strategy => !!s)
  const holdout = await bench('holdout', holdoutTasks, finalists)
  const verdict = promotionGate({
    report: holdout,
    incumbent: gen0Champion.name,
    candidate: incumbent.name,
    ...(cfg.minPairedTasks !== undefined ? { minPairedTasks: cfg.minPairedTasks } : {}),
  })

  return {
    gen0,
    gen0Champion,
    generations: generationRows,
    archive,
    finalChampion: incumbent,
    holdout,
    verdict,
    trajectory,
  }
}
