/**
 * FinResearchBench-compatible adapter.
 *
 * The paper defines a logic-tree Agent-as-a-Judge benchmark for financial
 * research reports, but there is no stable public scorer package wired here.
 * Live mode therefore requires a local data export whose rows carry the official
 * judge prompt/template/logic tree. The adapter refuses to invent a judge.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { benchRoot } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'finresearchbench.json')

interface FinResearchRecord {
  id: string
  question: string
  category?: string
  reference_answer?: string
  reference_report?: string
  logic_tree?: unknown
  rubric?: unknown
  judge_system_prompt?: string
  judge_prompt_template?: string
}

interface FinResearchMeta {
  id: string
  category: string
  question: string
  referenceAnswer: string
  referenceReport: string
  logicTree: unknown
  rubric: unknown
  judgeSystemPrompt?: string
  judgePromptTemplate?: string
  scoring: 'official-logic-tree-judge' | 'fixture-exact-reference'
}

const dataFile = (): string | undefined => process.env.FINRESEARCHBENCH_DATA_FILE

function routerConfig(): { baseUrl: string; key: string; model: string } {
  const key = process.env.TANGLE_API_KEY
  if (!key) throw new Error('TANGLE_API_KEY is required for FinResearchBench live LLM judging')
  return {
    baseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    key,
    model: process.env.FINRESEARCHBENCH_JUDGE_MODEL ?? process.env.JUDGE_MODEL ?? 'deepseek-v4-flash',
  }
}

async function assertReadable(path: string, label: string): Promise<void> {
  try {
    await stat(path)
  } catch (err) {
    throw new Error(`FinResearchBench: missing ${label} at ${path} (${err instanceof Error ? err.message : err})`)
  }
}

function readRecords(raw: string): FinResearchRecord[] {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as FinResearchRecord[]
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as FinResearchRecord)
}

function assertLiveJudgeFields(records: readonly FinResearchRecord[], source: string): void {
  const missing = records
    .filter((row) => !row.judge_system_prompt || !row.judge_prompt_template)
    .map((row) => row.id)
  if (missing.length > 0) {
    throw new Error(
      `FinResearchBench live rows from ${source} missing official judge prompts for ${missing.length}/${records.length} row(s): ${missing.slice(0, 5).join(', ')}. ` +
        'Use a benchmark export with judge_system_prompt and judge_prompt_template, or do not score this benchmark live.',
    )
  }
}

function rowToTask(row: FinResearchRecord, fixturesMode: boolean): BenchTask {
  const referenceAnswer = row.reference_answer ?? ''
  const referenceReport = row.reference_report ?? referenceAnswer
  const meta: FinResearchMeta = {
    id: row.id,
    category: row.category ?? 'unknown',
    question: row.question,
    referenceAnswer,
    referenceReport,
    logicTree: row.logic_tree ?? null,
    rubric: row.rubric ?? null,
    judgeSystemPrompt: row.judge_system_prompt,
    judgePromptTemplate: row.judge_prompt_template,
    scoring: fixturesMode ? 'fixture-exact-reference' : 'official-logic-tree-judge',
  }
  return {
    id: row.id,
    split: row.category,
    prompt: [
      'Complete this FinResearchBench financial research task.',
      'Produce a decision-grade research answer with explicit reasoning, evidence, and final conclusion.',
      '',
      row.question,
    ].join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): FinResearchMeta {
  const md = task.metadata
  if (!md || typeof md.question !== 'string') {
    throw new Error(`FinResearchBench task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as FinResearchMeta
}

function selectRows(rows: FinResearchRecord[], opts: LoadOptions, fixturesMode: boolean): BenchTask[] {
  let tasks = rows.map((row) => rowToTask(row, fixturesMode))
  if (opts.split) tasks = tasks.filter((task) => task.split === opts.split)
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((task) => want.has(task.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  if (tasks.length === 0) throw new Error(`FinResearchBench: no tasks matched ${JSON.stringify(opts)}`)
  return tasks
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const records = readRecords(await readFile(FIXTURES, 'utf8'))
  console.warn(`[finresearchbench] FINRESEARCHBENCH_FIXTURES=1 — loading ${records.length} adapter fixtures`)
  return selectRows(records, opts, true)
}

async function loadOfficialTasks(path: string, opts: LoadOptions): Promise<BenchTask[]> {
  const records = readRecords(await readFile(path, 'utf8'))
  assertLiveJudgeFields(records, path)
  return selectRows(records, opts, false)
}

function fillTemplate(meta: FinResearchMeta, response: string): string {
  const template = meta.judgePromptTemplate
  if (!template) throw new Error(`FinResearchBench task ${meta.id} missing judge_prompt_template`)
  return template
    .replaceAll('{question}', meta.question)
    .replaceAll('{response}', response)
    .replaceAll('{reference_answer}', meta.referenceAnswer)
    .replaceAll('{reference_report}', meta.referenceReport)
    .replaceAll('{logic_tree}', JSON.stringify(meta.logicTree, null, 2))
    .replaceAll('{rubric}', JSON.stringify(meta.rubric, null, 2))
}

function parseJudgeScore(content: string): { score: number; raw: unknown } {
  const candidates: string[] = []
  for (const m of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(m[1].trim())
  for (const m of content.matchAll(/\{[\s\S]*?\}/g)) candidates.push(m[0])
  candidates.push(content.trim())
  for (const candidate of candidates) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(candidate) as Record<string, unknown>
    } catch {
      continue
    }
    const raw = parsed.score ?? parsed.overall_score ?? parsed.total_score ?? parsed.answer_score
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    if (!Number.isFinite(n)) continue
    if (n < 0) throw new Error(`FinResearchBench judge score is negative: ${JSON.stringify(parsed)}`)
    const score = n <= 1 ? n : n <= 10 ? n / 10 : n / 100
    if (score > 1) throw new Error(`FinResearchBench judge score outside supported range: ${JSON.stringify(parsed)}`)
    return { score, raw: parsed }
  }
  throw new Error(`FinResearchBench judge produced no parseable JSON score: ${content.slice(0, 400)}`)
}

async function runOfficialJudge(meta: FinResearchMeta, response: string): Promise<BenchScore> {
  if (!meta.judgeSystemPrompt) throw new Error(`FinResearchBench task ${meta.id} missing judge_system_prompt`)
  const router = routerConfig()
  const res = await fetch(`${router.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${router.key}` },
    body: JSON.stringify({
      model: router.model,
      temperature: 0,
      messages: [
        { role: 'system', content: meta.judgeSystemPrompt },
        { role: 'user', content: fillTemplate(meta, response) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`FinResearchBench judge HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error(`FinResearchBench judge returned no message content: ${JSON.stringify(body).slice(0, 300)}`)
  const { score, raw } = parseJudgeScore(content)
  return {
    resolved: score >= Number(process.env.FINRESEARCHBENCH_PASS_THRESHOLD ?? 0.8),
    score,
    detail: JSON.stringify({ scoring: meta.scoring, category: meta.category, judgeModel: router.model, raw }),
  }
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function scoreFixture(meta: FinResearchMeta, artifact: string): BenchScore {
  const answer = normalizeText(meta.referenceAnswer || meta.referenceReport)
  const response = normalizeText(artifact)
  const score = answer.length > 0 && response.includes(answer) ? 1 : 0
  return {
    resolved: score === 1,
    score,
    detail: JSON.stringify({ scoring: meta.scoring, category: meta.category }),
  }
}

export function createFinResearchBenchAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.FINRESEARCHBENCH_FIXTURES === '1'

  return {
    name: 'finresearchbench',

    async preflight() {
      if (fixturesMode) {
        await assertReadable(FIXTURES, 'fixture file')
        return
      }
      const file = dataFile()
      if (!file) {
        throw new Error(
          'FINRESEARCHBENCH_DATA_FILE is required. Fix: export the official FinResearchBench rows as JSON/JSONL with judge_system_prompt and judge_prompt_template fields, then set FINRESEARCHBENCH_DATA_FILE=/path/to/export.jsonl.',
        )
      }
      routerConfig()
      await assertReadable(file, 'data file')
      await loadOfficialTasks(file, { limit: 1 })
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const file = dataFile()
      if (!file) throw new Error('FINRESEARCHBENCH_DATA_FILE is required to load FinResearchBench rows')
      return loadOfficialTasks(file, opts)
    },

    async goldArtifact(task: BenchTask) {
      const meta = readMeta(task)
      return meta.referenceReport || meta.referenceAnswer || undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      if (fixturesMode) return scoreFixture(meta, artifact)
      if (artifact.trim().length === 0) {
        return {
          resolved: false,
          score: 0,
          detail: JSON.stringify({ scoring: meta.scoring, category: meta.category, reason: 'empty answer' }),
        }
      }
      return runOfficialJudge(meta, artifact)
    },
  }
}
