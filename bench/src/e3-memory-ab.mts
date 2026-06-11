/**
 * E3 — certified-program memory vs prose-fact memory (docs/research/e3-certified-memory.md).
 * THREE arms over the SAME EOPS task stream, same order, equal budget through the
 * conserved pool (extends eops-corpus-ab.mts, the two-arm corpus A/B):
 *
 *   cold      — plain refine, every run fresh (the baseline).
 *   prose     — the measured relevance-primed read side (corpus-prime.mts): observe()
 *               facts accumulate across the stream; top-k relevance-overlapping facts
 *               fold into the system prompt. Memory read = prompt text (billed as the
 *               worker's real prompt tokens).
 *   certified — gate-certified EXECUTABLE memory (certified-store.mts): retrieve the
 *               best-matching certified Strategy by task class and RUN it at the same
 *               budget — program retrieval, not prompt injection (the Voyager/AWM cell).
 *               Memory read = disk + import (billed in the arm's wall ms; zero tokens by
 *               construction). No retrieval ⇒ fall back to refine and RECORD the miss.
 *
 * ADMISSION (v1 = the spec's minimal form): the store is PRE-SEEDED and FROZEN for the
 * whole run — programs enter only via the seed CLI's gate rule (promotionGate-promoted,
 * or train-displacer + REPRODUCIBLE under --seed-displacers, named on every row). In-
 * stream admission is deferred: certifying a new program mid-stream requires its own
 * promotion gate (a fresh holdout bench per candidate), and this stream has no author in
 * the loop to produce candidates. CONSEQUENCE, stated honestly: the pre-registered
 * flywheel signature (a GROWING certified-arm slope) has no growth MECHANISM under a
 * frozen store — this run measures the LIFT, the COST, and the HOLDOUT transfer of the
 * memory form-factors; the slope is reported for continuity with the prose cells and
 * binds the thesis only once in-stream admission lands.
 *
 * Reported: per-task paired rows (all three arms), paired lifts (prose−cold,
 * certified−cold, certified−prose; seeded bootstrap via stats.mts), first-half vs
 * second-half slope per arm, a DISJOINT holdout with memory read-only (prose primes
 * without writes; the store is frozen anyway), full cost/latency per arm, retrieval
 * hit-rate. The artifact is self-describing (models + config + store provenance).
 *
 * Launch (the operator runs this — see bench/HARNESS.md for the EOPS container):
 *   cd bench && EOPS_GYM_DBS_DIR=… TANGLE_API_KEY=… \
 *     STORE=runs/2026-06-11/e3-certified-store/store.jsonl \
 *     N=16 HOLDOUT=4 OUT=runs/$(date +%F)/e3-memory-ab.json tsx src/e3-memory-ab.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { createChatClient } from '@tangle-network/agent-eval'
import {
  type AgenticOptions,
  type AgenticRunResult,
  type AgenticSurface,
  type AgenticTask,
  authorStrategy,
  FileCorpus,
  runAgentic,
  type Strategy,
} from '@tangle-network/agent-runtime/loops'
import { createEopsSurface, eopsTaskClass, loadEopsTasks } from './agentic-eops'
import { CertifiedStore } from './certified-store.mts'
import { primeBlock } from './corpus-prime.mts'
import { type PairedLift, pairedLift } from './stats.mts'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

export interface ArmCell {
  score: number
  resolved: boolean
  usd: number
  ms: number
  tokens: { input: number; output: number }
}

const toCell = (r: AgenticRunResult): ArmCell => ({
  score: r.score,
  resolved: r.resolved,
  usd: r.usd,
  ms: r.ms,
  tokens: r.tokens,
})

export interface CertifiedArm {
  cell: ArmCell
  /** The certified row that ran (null on a miss — the miss is the record, never silent). */
  retrieved: string | null
  match: 'class' | 'fallback' | 'miss'
}

/** The certified arm: retrieval-is-execution. Retrieval + import time is billed into the
 *  arm's wall ms (memory reads are not free); the retrieved program runs at the SAME
 *  budget as the other arms through the conserved pool. */
export async function runCertifiedArm(args: {
  store: CertifiedStore
  surface: AgenticSurface
  task: AgenticTask
  taskClass: string
  opts: AgenticOptions
  budget: number
  /** Import cache keyed by row.file — pay the module load once per program. */
  cache: Map<string, Strategy>
}): Promise<CertifiedArm> {
  const { store, surface, task, taskClass, opts, budget, cache } = args
  const started = Date.now()
  const retrieval = store.retrieve(taskClass)
  if (!retrieval) {
    const r = await runAgentic({ ...opts, surface, task, mode: 'depth', budget })
    return { cell: { ...toCell(r), ms: Date.now() - started }, retrieved: null, match: 'miss' }
  }
  let strategy = cache.get(retrieval.row.file)
  if (!strategy) {
    strategy = await store.load(retrieval.row)
    cache.set(retrieval.row.file, strategy)
  }
  const r = await runAgentic({ ...opts, surface, task, strategy, budget })
  return {
    cell: { ...toCell(r), ms: Date.now() - started },
    retrieved: retrieval.row.name,
    match: retrieval.match,
  }
}

interface StreamRow {
  i: number
  taskId: string
  taskClass: string
  cold: ArmCell
  prose: ArmCell & { facts: number }
  certified: ArmCell & { retrieved: string | null; match: 'class' | 'fallback' | 'miss' }
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const sig = (l: PairedLift) => (l.low > 0 ? 'SIGNIF +' : l.high < 0 ? 'SIGNIF -' : 'n.s.')

function slopeOf(deltas: number[]): { firstHalf: number; secondHalf: number; growing: boolean } {
  const half = Math.floor(deltas.length / 2)
  const firstHalf = mean(deltas.slice(0, half))
  const secondHalf = mean(deltas.slice(half))
  return { firstHalf, secondHalf, growing: secondHalf > firstHalf }
}

const armStats = (cells: ArmCell[]) => ({
  meanScore: mean(cells.map((c) => c.score)),
  meanUsd: mean(cells.map((c) => c.usd)),
  meanMs: mean(cells.map((c) => c.ms)),
  totalUsd: cells.reduce((s, c) => s + c.usd, 0),
})

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 16)
  const holdoutN = Number(process.env.HOLDOUT ?? 4)
  const offset = Number(process.env.OFFSET ?? 0)
  const kFacts = Number(process.env.K_FACTS ?? 3)
  const budget = Number(process.env.BUDGET ?? 3)
  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-pro'
  const split = process.env.EOPS_SPLIT ?? 'itsm'
  const storePath = must('STORE')
  const out =
    process.env.OUT ?? `runs/${new Date().toISOString().slice(0, 10)}/e3-memory-ab.json`
  const proseCorpusPath = out.replace(/\.json$/, '') + '-prose-corpus.jsonl'
  const opts: AgenticOptions = {
    routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey: must('TANGLE_API_KEY'),
    model,
    innerTurns: Number(process.env.INNER_TURNS ?? 4),
    temperature: 0.7,
  }
  const surface = createEopsSurface(must('EOPS_GYM_DBS_DIR'))
  const store = new CertifiedStore(storePath)
  const storeRows = store.rows() // unreadable/malformed store throws here, before any spend
  if (storeRows.length === 0) {
    throw new Error(`certified store ${storePath} is empty — a three-arm run with no certified memory measures nothing; seed it first`)
  }
  const corpus = new FileCorpus(proseCorpusPath)
  const corpusTags = ['eops', split, 'e3-memory-ab']
  const cache = new Map<string, Strategy>()

  // IN-STREAM ADMISSION (the decisive-run increment): every ADMIT_EVERY tasks the author
  // reads the certified arm's own recent losses, the candidate replays those SAME K
  // tasks on fresh artifacts, and is admitted iff its mean beats the arm's observed
  // mean. Admission is SEARCH — the experiment's verdict stays the slope + the
  // read-only holdout, both untouched by this loop. 0 = off (the frozen-store form).
  const admitEvery = Number(process.env.ADMIT_EVERY ?? 0)
  const admissions: Array<{
    afterTask: number
    name: string
    candidateMean: number
    incumbentMean: number
    admitted: boolean
    error?: string
  }> = []
  const authorChat = createChatClient({
    transport: 'router',
    apiKey: opts.routerKey,
    baseUrl: opts.routerBaseUrl,
    defaultModel: process.env.AUTHOR_MODEL ?? model,
  })
  const programsDir = resolve(dirname(storePath), 'programs')

  async function admissionRound(rowsSoFar: StreamRow[], streamTasks: AgenticTask[]): Promise<void> {
    const recent = rowsSoFar.slice(-admitEvery)
    const lossesJson = JSON.stringify(
      recent.map((r) => ({
        task: r.taskId,
        score: Math.round(r.certified.score * 100) / 100,
        resolved: r.certified.score >= 1,
        retrieved: r.certified.retrieved,
      })),
    )
    const incumbentMean = recent.reduce((sum, r) => sum + r.certified.score, 0) / recent.length
    try {
      const authored = await authorStrategy({
        chat: authorChat,
        model: process.env.AUTHOR_MODEL ?? model,
        fallbackModel: process.env.AUTHOR_FALLBACK_MODEL ?? 'deepseek-v4-flash',
        environmentName: surface.name,
        lossesJson,
        budget,
        outDir: programsDir,
        temperature: 0.6,
        maxTokens: 8192,
      })
      const recentIds = new Set(recent.map((r) => r.taskId))
      const replayTasks = streamTasks.filter((t) => recentIds.has(t.id))
      let total = 0
      let usd = 0
      for (const t of replayTasks) {
        const r = await runAgentic({ ...opts, surface, task: t, strategy: authored.strategy, budget })
        total += r.score
        usd += r.usd
      }
      const candidateMean = total / replayTasks.length
      const admitted = candidateMean > incumbentMean
      admissions.push({ afterTask: rowsSoFar.length, name: authored.strategy.name, candidateMean, incumbentMean, admitted })
      console.error(
        `  ── admission @${rowsSoFar.length}: ${authored.strategy.name} ${pct(candidateMean)} vs incumbent ${pct(incumbentMean)} → ${admitted ? 'ADMITTED' : 'rejected'}`,
      )
      if (admitted) {
        store.admit({
          name: authored.strategy.name,
          taskClass: eopsTaskClass(replayTasks[0] as AgenticTask),
          file: relative(dirname(storePath), authored.file),
          summary: `in-stream authored @task ${rowsSoFar.length}; beat the certified arm's trailing-${admitEvery} mean`,
          verdictReason: `instream-displacer:cand=${pct(candidateMean)},inc=${pct(incumbentMean)},k=${admitEvery}`,
          score: candidateMean,
          usd: usd / replayTasks.length,
          addedAt: new Date().toISOString(),
        })
      }
    } catch (e) {
      const error = e instanceof Error ? e.message.slice(0, 200) : String(e)
      admissions.push({ afterTask: rowsSoFar.length, name: '(author-failed)', candidateMean: 0, incumbentMean, admitted: false, error })
      console.error(`  ── admission @${rowsSoFar.length}: FAILED (${error.slice(0, 80)}) — the arm continues`)
    }
  }

  const stream = await loadEopsTasks(n, offset, split)
  console.error(`=== E3 memory A/B · cold/prose/certified · stream n=${stream.length} + holdout ${holdoutN} · ${model} · budget=${budget} ===`)
  console.error(`    store: ${storePath} (${storeRows.length} row(s): ${storeRows.map((r) => `${r.name}@${r.taskClass}`).join(', ')})`)
  console.error(`    prose corpus: ${proseCorpusPath}\n`)

  const skipped: Array<{ taskId: string; arm: string; error: string }> = []
  async function runTask(
    task: AgenticTask,
    proseWrites: boolean,
  ): Promise<Omit<StreamRow, 'i'> | null> {
    const taskClass = eopsTaskClass(task)
    const arm = async <T,>(name: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn()
      } catch (e) {
        skipped.push({
          taskId: task.id,
          arm: name,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e),
        })
        console.error(`     SKIP ${task.id.slice(-12)} [${name}] (${e instanceof Error ? e.message.slice(0, 60) : e})`)
        return null
      }
    }
    const cold = await arm('cold', async () =>
      toCell(await runAgentic({ ...opts, surface, task, mode: 'depth', budget })),
    )
    if (!cold) return null
    const prose = await arm('prose', async () => {
      const prime = await primeBlock(corpus, 'relevance', kFacts, task)
      const primedTask: AgenticTask = { ...task, systemPrompt: `${task.systemPrompt}${prime.text}` }
      const r = await runAgentic({
        ...opts,
        ...(proseWrites ? { corpus, corpusTags } : {}),
        surface,
        task: primedTask,
        mode: 'depth',
        budget,
      })
      return { ...toCell(r), facts: prime.count }
    })
    if (!prose) return null
    const certified = await arm('certified', async () => {
      const c = await runCertifiedArm({ store, surface, task, taskClass, opts, budget, cache })
      return { ...c.cell, retrieved: c.retrieved, match: c.match }
    })
    if (!certified) return null
    return { taskId: task.id, taskClass, cold, prose, certified }
  }

  const rows: StreamRow[] = []
  for (let i = 0; i < stream.length; i += 1) {
    const task = stream[i] as AgenticTask
    const row = await runTask(task, true)
    if (!row) continue
    rows.push({ i, ...row })
    console.error(
      `  [${i + 1}/${stream.length}] ${task.id.slice(-12)}: cold ${pct(row.cold.score)}  prose ${pct(row.prose.score)} (facts ${row.prose.facts})  certified ${pct(row.certified.score)} (${row.certified.match}${row.certified.retrieved ? `:${row.certified.retrieved}` : ''})`,
    )
    if (admitEvery > 0 && rows.length % admitEvery === 0 && rows.length < stream.length) {
      await admissionRound(rows, stream)
    }
  }
  if (rows.length < 2) {
    throw new Error(`only ${rows.length} stream task(s) completed all three arms — no paired statistics possible; see skipped[] in the partial artifact`)
  }

  const lifts = {
    proseVsCold: pairedLift(rows.map((r) => r.cold.score), rows.map((r) => r.prose.score)),
    certifiedVsCold: pairedLift(rows.map((r) => r.cold.score), rows.map((r) => r.certified.score)),
    certifiedVsProse: pairedLift(rows.map((r) => r.prose.score), rows.map((r) => r.certified.score)),
  }
  const slope = {
    prose: slopeOf(rows.map((r) => r.prose.score - r.cold.score)),
    certified: slopeOf(rows.map((r) => r.certified.score - r.cold.score)),
  }

  // Disjoint holdout, memory READ-ONLY: prose primes from the accumulated corpus without
  // writes; the certified store was frozen all along. Across-task transfer, not recency.
  let holdout:
    | {
        n: number
        rows: StreamRow[]
        lifts: { proseVsCold: PairedLift; certifiedVsCold: PairedLift; certifiedVsProse: PairedLift }
      }
    | undefined
  if (holdoutN > 0) {
    console.error(`\n▶ holdout (${holdoutN} disjoint tasks, memory read-only)…`)
    const htasks = await loadEopsTasks(holdoutN, offset + n, split)
    const hrows: StreamRow[] = []
    for (let i = 0; i < htasks.length; i += 1) {
      const task = htasks[i] as AgenticTask
      const row = await runTask(task, false)
      if (!row) continue
      hrows.push({ i, ...row })
      console.error(
        `   ${task.id.slice(-12)}: cold ${pct(row.cold.score)}  prose ${pct(row.prose.score)}  certified ${pct(row.certified.score)} (${row.certified.match})`,
      )
    }
    if (hrows.length >= 2) {
      holdout = {
        n: hrows.length,
        rows: hrows,
        lifts: {
          proseVsCold: pairedLift(hrows.map((r) => r.cold.score), hrows.map((r) => r.prose.score)),
          certifiedVsCold: pairedLift(hrows.map((r) => r.cold.score), hrows.map((r) => r.certified.score)),
          certifiedVsProse: pairedLift(hrows.map((r) => r.prose.score), hrows.map((r) => r.certified.score)),
        },
      }
    }
  }

  const allRows = [...rows, ...(holdout?.rows ?? [])]
  const retrieval = {
    hitRate: allRows.filter((r) => r.certified.match !== 'miss').length / allRows.length,
    byMatch: {
      class: allRows.filter((r) => r.certified.match === 'class').length,
      fallback: allRows.filter((r) => r.certified.match === 'fallback').length,
      miss: allRows.filter((r) => r.certified.match === 'miss').length,
    },
    misses: allRows.filter((r) => r.certified.match === 'miss').map((r) => r.taskId),
  }

  const artifact = {
    experiment: 'e3-memory-ab',
    spec: 'docs/research/e3-certified-memory.md',
    ranAt: new Date().toISOString(),
    models: { worker: model, analyst: model },
    config: {
      n,
      holdoutN,
      offset,
      kFacts,
      budget,
      innerTurns: opts.innerTurns,
      split,
      primeMode: 'relevance',
      store: storePath,
      proseCorpus: proseCorpusPath,
    },
    admission:
      'v1 minimal form (the spec allows it): pre-seeded FROZEN store — rows entered only via the seed CLI gate rule (promotionGate-promoted, or train-displacer + REPRODUCIBLE under --seed-displacers; every row names its certificate in verdictReason). In-stream admission deferred: it requires a per-candidate promotion gate and an author in the loop. Under a frozen store the certified-arm slope has no growth mechanism — this run binds lift/cost/holdout-transfer, not the growing-slope signature.',
    store: storeRows,
    stream: rows,
    skipped,
    admissions,
    finalStoreRows: store.rows().length,
    lifts,
    slope,
    ...(holdout ? { holdout } : {}),
    retrieval,
    cost: {
      cold: armStats(rows.map((r) => r.cold)),
      prose: armStats(rows.map((r) => r.prose)),
      certified: armStats(rows.map((r) => r.certified)),
    },
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(artifact, null, 1))

  console.error(`\n${'='.repeat(74)}`)
  console.error(`E3 MEMORY A/B RESULT · stream n=${rows.length} · ${model} · budget=${budget}`)
  console.error('='.repeat(74))
  console.error(`  cold ${pct(mean(rows.map((r) => r.cold.score)))}   prose ${pct(mean(rows.map((r) => r.prose.score)))}   certified ${pct(mean(rows.map((r) => r.certified.score)))}`)
  console.error(`  prose − cold      ${pp(lifts.proseVsCold.point)}  CI [${pp(lifts.proseVsCold.low)}, ${pp(lifts.proseVsCold.high)}]  ${sig(lifts.proseVsCold)}`)
  console.error(`  certified − cold  ${pp(lifts.certifiedVsCold.point)}  CI [${pp(lifts.certifiedVsCold.low)}, ${pp(lifts.certifiedVsCold.high)}]  ${sig(lifts.certifiedVsCold)}`)
  console.error(`  certified − prose ${pp(lifts.certifiedVsProse.point)}  CI [${pp(lifts.certifiedVsProse.low)}, ${pp(lifts.certifiedVsProse.high)}]  ${sig(lifts.certifiedVsProse)}`)
  console.error(`  SLOPE prose:     ${pp(slope.prose.firstHalf)} → ${pp(slope.prose.secondHalf)}  ${slope.prose.growing ? '(growing)' : '(not growing)'}`)
  console.error(`  SLOPE certified: ${pp(slope.certified.firstHalf)} → ${pp(slope.certified.secondHalf)}  ${slope.certified.growing ? '(growing)' : '(not growing; frozen store — see admission note)'}`)
  if (holdout) {
    console.error(`  HOLDOUT (${holdout.n} fresh tasks, memory read-only): prose ${pp(holdout.lifts.proseVsCold.point)} ${sig(holdout.lifts.proseVsCold)} · certified ${pp(holdout.lifts.certifiedVsCold.point)} ${sig(holdout.lifts.certifiedVsCold)}`)
  }
  console.error(`  retrieval: hit-rate ${pct(retrieval.hitRate)} (class ${retrieval.byMatch.class} / fallback ${retrieval.byMatch.fallback} / miss ${retrieval.byMatch.miss})`)
  console.error(`  cost/task: cold $${armStats(rows.map((r) => r.cold)).meanUsd.toFixed(4)} · prose $${armStats(rows.map((r) => r.prose)).meanUsd.toFixed(4)} · certified $${armStats(rows.map((r) => r.certified)).meanUsd.toFixed(4)}`)
  console.error(`  artifact: ${out}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`e3-memory-ab: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
    process.exit(1)
  })
}
