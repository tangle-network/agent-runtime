/**
 * FinSearchComp adapter (randomtutu/FinSearchComp). Agentic financial search +
 * reasoning. Worker artifact = the agent's free-form final answer text (zh/en).
 *
 * Each record is SELF-CONTAINED and carries its OWN judge: a per-record
 * `judge_system_prompt` + a `judge_prompt_template` with {prompt},
 * {response_reference} (gold answer WITH embedded tolerance/scoring-criteria),
 * and {response} (the student answer) placeholders. We faithfully REPLICATE the
 * benchmark's judge — fill the template, run it under the record's system prompt
 * via the pinned router (temperature 0), and parse the JSON the judge emits. The
 * judge returns an `answer_score` field; 1/positive = resolved, else not.
 * This matches the FinSearchComp leaderboard (Grok-4-web 68.9%).
 *
 * There is NO deterministic Tier-1 path here: the gold answer is prose with
 * region-specific units, embedded tolerances ("允许1%的误差"), and multi-point
 * scoring criteria. The benchmark intends its own LLM judge to be the arbiter,
 * so the judge IS the score — fail loud on unparseable judge output (never
 * default to resolved).
 *
 * SCOPE: T2 (Simple_Historical_Lookup) + T3 (Complex_Historical_Investigation)
 * are fully self-contained and supported. T1 (Time_Sensitive_Data_Fetching)
 * needs a live market snapshot / akshare ground truth to fill the judge's
 * {ground_truth} slot — it is SKIPPED in loadTasks and flagged in preflight.
 * See {@link T1Seam}.
 *
 * Requires for a live run: network access to the GitHub-hosted dataset JSON and
 * a TANGLE_API_KEY for the judge. For offline/CI verification, loadTasks falls back
 * to the committed fixtures (bench/fixtures/finsearchcomp.json) with an explicit
 * console.warn — never a silent fallback.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const BENCH_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FIXTURES = join(BENCH_ROOT, 'fixtures', 'finsearchcomp.json')

const DATASET_URL =
  'https://raw.githubusercontent.com/randomtutu/FinSearchComp/main/data/finsearchcomp_data.json'

/** Task-type prefix on prompt_id, e.g. "(T2)Simple_Historical_Lookup_001". */
type TaskType = 'T1' | 'T2' | 'T3'
/** Only these are self-contained (gold + own judge, no external ground truth). */
const SUPPORTED_TYPES: ReadonlySet<TaskType> = new Set<TaskType>(['T2', 'T3'])

/**
 * Worker contract appended to every task prompt. The judge is paraphrase- and
 * keyword-aware ("答案为", "the answer is"), so we do not impose a sentinel; we
 * pass the whole artifact through as {response}. We DO ask the worker to lead
 * with its final value so a truncated artifact still carries the answer.
 */
const WORKER_CONTRACT = [
  '',
  'Research this financial question using live web/market sources and answer it.',
  'State your final answer explicitly, with the exact units and precision the question requests.',
  'Respect any tolerance the question implies; show the value you settled on, not just intermediate work.',
].join('\n')

/**
 * Typed seam for T1 (Time_Sensitive_Data_Fetching). T1 records score against a
 * live market snapshot the judge consumes via a {ground_truth} template slot;
 * the adapter does NOT fabricate that snapshot. Wiring T1 means supplying a
 * resolver that fetches the akshare/market value for the record at judge time
 * and filling {ground_truth}. Until then T1 is excluded from loadTasks.
 */
export interface T1Seam {
  promptId: string
  /** Resolver that returns the real-time ground-truth block for the {ground_truth} slot. */
  resolveGroundTruth(promptId: string): Promise<string>
}

interface FinSearchRecord {
  prompt_id: string
  prompt: string
  response_reference: string
  judge_prompt_template: string
  judge_system_prompt: string
  label: string
}

interface FinSearchMeta {
  promptId: string
  label: string
  taskType: TaskType
  region: string
  responseReference: string
  judgePromptTemplate: string
  judgeSystemPrompt: string
  rawPrompt: string
}

/** "(T2)Simple_Historical_Lookup_001" → "T2"; throws on an unknown/missing prefix. */
function parseTaskType(promptId: string): TaskType {
  const m = promptId.match(/^\((T[123])\)/)
  if (!m) throw new Error(`FinSearchComp prompt_id has no (T1|T2|T3) prefix: ${JSON.stringify(promptId)}`)
  return m[1] as TaskType
}

/** "Simple_Historical_Lookup(Greater China)" → "Greater China"; '' when absent. */
function parseRegion(label: string): string {
  const m = label.match(/\(([^()]+)\)\s*$/)
  return m ? m[1].trim() : ''
}

function recordToTask(rec: FinSearchRecord): BenchTask {
  const taskType = parseTaskType(rec.prompt_id)
  const meta: FinSearchMeta = {
    promptId: rec.prompt_id,
    label: rec.label,
    taskType,
    region: parseRegion(rec.label),
    responseReference: rec.response_reference,
    judgePromptTemplate: rec.judge_prompt_template,
    judgeSystemPrompt: rec.judge_system_prompt,
    rawPrompt: rec.prompt,
  }
  return {
    id: rec.prompt_id,
    split: taskType,
    prompt: rec.prompt + WORKER_CONTRACT,
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): FinSearchMeta {
  const md = task.metadata
  if (
    !md ||
    typeof md.responseReference !== 'string' ||
    typeof md.judgePromptTemplate !== 'string' ||
    typeof md.judgeSystemPrompt !== 'string' ||
    typeof md.rawPrompt !== 'string'
  ) {
    throw new Error(`FinSearchComp task ${task.id} missing judge metadata — loadTasks did not populate it`)
  }
  return md as unknown as FinSearchMeta
}

/** Fill the per-record judge_prompt_template. {ground_truth} is T1-only and unused for T2/T3. */
function fillJudgePrompt(meta: FinSearchMeta, response: string): string {
  return meta.judgePromptTemplate
    .replaceAll('{prompt}', meta.rawPrompt)
    .replaceAll('{response_reference}', meta.responseReference)
    .replaceAll('{response}', response)
}

interface JudgeRouter {
  baseUrl: string
  key: string
  model: string
}

function judgeRouter(): JudgeRouter {
  const key = process.env.TANGLE_API_KEY
  if (!key) throw new Error('TANGLE_API_KEY is required for the FinSearchComp per-record LLM judge')
  const model = process.env.JUDGE_MODEL ?? 'gpt-5'
  const baseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  return { baseUrl, key, model }
}

/**
 * The judge emits a JSON object with an `answer_score`. In this dataset it is a
 * flat integer ({"answer_score": 1}); we also accept the nested-array form
 * ([[1]] → read [0][0]) the upstream scorer can produce. 1/positive = resolved.
 * A "null" sentinel (judge could not obtain ground truth) is NOT a pass.
 */
function readAnswerScore(value: unknown): { resolved: boolean; score: number; raw: unknown } {
  let v: unknown = value
  // unwrap nested-array form: [[s]] / [s]
  while (Array.isArray(v)) v = v[0]
  if (v === null || v === undefined || v === 'null') {
    return { resolved: false, score: 0, raw: value }
  }
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) {
    throw new Error(`FinSearchComp judge answer_score not numeric: ${JSON.stringify(value)}`)
  }
  // Their scale: 1 = correct, 0 = wrong. Treat any positive as resolved; clamp to 0..1.
  const resolved = n >= 1
  const score = n <= 0 ? 0 : n >= 1 ? 1 : n
  return { resolved, score, raw: value }
}

/** Extract the first JSON object carrying `answer_score` from judge output; throw if none. */
function parseJudgeOutput(content: string): { resolved: boolean; score: number; raw: unknown } {
  // Prefer a fenced block, then fall back to scanning for a {...} with answer_score.
  const candidates: string[] = []
  for (const m of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(m[1].trim())
  for (const m of content.matchAll(/\{[^{}]*"answer_score"[\s\S]*?\}/g)) candidates.push(m[0])
  candidates.push(content.trim())
  for (const c of candidates) {
    let parsed: { answer_score?: unknown }
    try {
      parsed = JSON.parse(c) as { answer_score?: unknown }
    } catch {
      continue
    }
    if ('answer_score' in parsed) return readAnswerScore(parsed.answer_score)
  }
  throw new Error(
    `FinSearchComp judge produced no parseable {"answer_score": …}: ${content.slice(0, 400)}`,
  )
}

/** Run the record's own judge via the router. Fail loud on transport/parse errors. */
async function runRecordJudge(meta: FinSearchMeta, response: string, router: JudgeRouter): Promise<BenchScore> {
  const res = await fetch(`${router.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${router.key}` },
    body: JSON.stringify({
      model: router.model,
      temperature: 0,
      messages: [
        { role: 'system', content: meta.judgeSystemPrompt },
        { role: 'user', content: fillJudgePrompt(meta, response) },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`FinSearchComp judge HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(`FinSearchComp judge returned no message content: ${JSON.stringify(body).slice(0, 300)}`)
  }
  const { resolved, score, raw } = parseJudgeOutput(content)
  return {
    resolved,
    score,
    detail: JSON.stringify({
      taskType: meta.taskType,
      region: meta.region,
      answerScore: raw,
      judgeModel: router.model,
    }),
  }
}

function selectRecords(records: FinSearchRecord[], opts: LoadOptions): BenchTask[] {
  let tasks = records
    .filter((r) => SUPPORTED_TYPES.has(parseTaskType(r.prompt_id)))
    .map(recordToTask)
  if (opts.split) tasks = tasks.filter((t) => t.split === opts.split)
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((t) => want.has(t.id))
  } else if (opts.limit !== undefined) {
    tasks = balanceByType(tasks, opts.limit)
  }
  return tasks
}

/** Round-robin across task types (T2/T3) so a `limit` pulls a balanced mix
 *  rather than slicing the type-ordered dataset's first N (which yields all
 *  T2). Deterministic — preserves dataset order within each type. */
function balanceByType(tasks: BenchTask[], limit: number): BenchTask[] {
  const queues = new Map<TaskType, BenchTask[]>()
  for (const t of tasks) {
    const k = parseTaskType(t.id)
    const q = queues.get(k)
    if (q) q.push(t)
    else queues.set(k, [t])
  }
  const lanes = [...queues.values()]
  const out: BenchTask[] = []
  for (let i = 0; out.length < limit; i++) {
    const before = out.length
    for (const lane of lanes) {
      if (i < lane.length) out.push(lane[i])
      if (out.length >= limit) break
    }
    if (out.length === before) break // all lanes exhausted
  }
  return out
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const records = JSON.parse(await readFile(FIXTURES, 'utf8')) as FinSearchRecord[]
  return selectRecords(records, opts)
}

async function fetchDataset(): Promise<FinSearchRecord[]> {
  const res = await fetch(DATASET_URL)
  if (!res.ok) throw new Error(`FinSearchComp dataset HTTP ${res.status} fetching ${DATASET_URL}`)
  const data = (await res.json()) as FinSearchRecord[]
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`FinSearchComp dataset empty or not an array: ${DATASET_URL}`)
  }
  return data
}

export function createFinsearchcompAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.FINSEARCHCOMP_FIXTURES === '1'

  return {
    name: 'finsearchcomp',

    async preflight() {
      // The per-record LLM judge is the arbiter in both modes — its router
      // config must exist or no score can be produced.
      judgeRouter()
      console.warn(
        '[finsearchcomp] T1 (Time_Sensitive_Data_Fetching) is NOT scored: it needs a live ' +
          'market snapshot / akshare ground truth for the judge {ground_truth} slot. ' +
          'loadTasks supports T2 + T3 only; wire T1Seam to add T1.',
      )
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8').catch((err) => {
          throw new Error(
            `FINSEARCHCOMP_FIXTURES=1 but ${FIXTURES} unreadable: ${err instanceof Error ? err.message : err}`,
          )
        })
        return
      }
      const res = await fetch(DATASET_URL, { method: 'HEAD' }).catch((err) => {
        throw new Error(
          `finsearchcomp preflight failed reaching ${DATASET_URL}: ${err instanceof Error ? err.message : err}\n` +
            `Fix: ensure network access to raw.githubusercontent.com, or set FINSEARCHCOMP_FIXTURES=1 ` +
            `to run against the committed fixtures offline.`,
        )
      })
      if (!res.ok) {
        throw new Error(
          `finsearchcomp preflight: dataset HEAD ${res.status} for ${DATASET_URL}. ` +
            `Set FINSEARCHCOMP_FIXTURES=1 to run against the committed fixtures offline.`,
        )
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      let records: FinSearchRecord[]
      try {
        records = await fetchDataset()
      } catch (err) {
        console.warn(
          `[finsearchcomp] live dataset fetch failed (${err instanceof Error ? err.message : err}); ` +
            `falling back to committed fixtures at ${FIXTURES}`,
        )
        return loadFixtures(opts)
      }
      return selectRecords(records, opts)
    },

    async goldArtifact(task: BenchTask) {
      // Gold artifact = the record's response_reference fed back as the student
      // answer, so verify-judge proves gold→resolved through the SAME per-record
      // judge the real artifact takes. The reference may carry tolerance/criteria
      // prose; the judge is built to read the value out of it.
      const meta = readMeta(task)
      return meta.responseReference
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const response = artifact.trim()
      if (response.length === 0) {
        // Fail-closed — the benchmark's own judges score an empty answer 0.
        return {
          resolved: false,
          score: 0,
          detail: JSON.stringify({ taskType: meta.taskType, region: meta.region, reason: 'empty answer' }),
        }
      }
      return runRecordJudge(meta, response, judgeRouter())
    },
  }
}
