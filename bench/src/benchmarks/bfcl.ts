/**
 * Berkeley Function Calling Leaderboard adapter.
 *
 * Scope: deterministic function-call ground-truth categories from the official
 * BFCL data files. This is NOT the full live BFCL leaderboard evaluator: agentic
 * web-search/memory categories and BFCL's own model-response harness remain
 * upstream responsibilities. The adapter loads official JSONL rows plus their
 * `possible_answer` file and scores structured function-call artifacts against
 * allowed function/argument values.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { OutputAdapter } from '@tangle-network/agent-runtime/kernel'
import { benchRoot } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'bfcl.json')
const DEFAULT_CATEGORY = 'BFCL_v4_simple_python'

interface BfclRow {
  id: string
  question: unknown
  function: unknown
}

interface BfclAnswerRow {
  id: string
  ground_truth: unknown
}

interface BfclAllowedCall {
  name: string
  arguments: Record<string, unknown[]>
}

interface BfclMeta {
  rowId: string
  category: string
  functions: unknown
  expected: BfclAllowedCall[]
  scoring: 'bfcl-ground-truth-subset'
}

interface BfclActualCall {
  name: string
  arguments: Record<string, unknown>
}

const bfclDir = (): string | undefined => process.env.BFCL_DIR
const bfclCategory = (): string => process.env.BFCL_CATEGORY ?? DEFAULT_CATEGORY

export const bfclOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) text = t
    }
    return text.trim()
  },
}

async function assertPath(path: string, label: string): Promise<void> {
  try {
    await stat(path)
  } catch (err) {
    throw new Error(`BFCL: missing ${label} at ${path} (${err instanceof Error ? err.message : err})`)
  }
}

function readJsonl(raw: string): unknown[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

function taskFile(dir: string, category: string): string {
  return process.env.BFCL_DATA_FILE ?? join(dir, 'bfcl_eval', 'data', `${category}.json`)
}

function answerFile(dir: string, category: string): string {
  return process.env.BFCL_ANSWER_FILE ?? join(dir, 'bfcl_eval', 'data', 'possible_answer', `${category}.json`)
}

function questionText(question: unknown): string {
  if (typeof question === 'string') return question
  if (!Array.isArray(question)) return JSON.stringify(question, null, 2)
  const turns: string[] = []
  for (const item of question.flat(3)) {
    if (item && typeof item === 'object') {
      const role = typeof (item as { role?: unknown }).role === 'string' ? (item as { role: string }).role : 'user'
      const content = (item as { content?: unknown }).content
      if (typeof content === 'string') turns.push(`${role}: ${content}`)
    }
  }
  return turns.length > 0 ? turns.join('\n') : JSON.stringify(question, null, 2)
}

function normalizeScalar(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)))
  if (typeof value === 'string') return value.trim().toLowerCase()
  return JSON.stringify(value)
}

function normalizeAllowed(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value]
}

function groundTruthToCalls(value: unknown): BfclAllowedCall[] {
  if (!Array.isArray(value)) return []
  const out: BfclAllowedCall[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    for (const [name, args] of Object.entries(item as Record<string, unknown>)) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) continue
      const normalized: Record<string, unknown[]> = {}
      for (const [argName, allowed] of Object.entries(args as Record<string, unknown>)) {
        normalized[argName] = normalizeAllowed(allowed)
      }
      out.push({ name, arguments: normalized })
    }
  }
  return out
}

function rowToTask(row: BfclRow, answer: BfclAnswerRow, category: string): BenchTask {
  const expected = groundTruthToCalls(answer.ground_truth)
  if (expected.length === 0) {
    throw new Error(`BFCL ${row.id}: possible_answer has no deterministic ground_truth calls`)
  }
  const meta: BfclMeta = {
    rowId: row.id,
    category,
    functions: row.function,
    expected,
    scoring: 'bfcl-ground-truth-subset',
  }
  return {
    id: row.id,
    split: category,
    prompt: [
      'Solve this BFCL function-calling task.',
      'Return only JSON: {"function_calls":[{"name":"...","arguments":{...}}]}.',
      '',
      questionText(row.question),
      '',
      `Available functions: ${JSON.stringify(row.function, null, 2)}`,
    ].join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): BfclMeta {
  const md = task.metadata
  if (!md || !Array.isArray(md.expected)) {
    throw new Error(`BFCL task ${task.id} missing expected calls — loadTasks did not populate metadata`)
  }
  return md as unknown as BfclMeta
}

function selectTasks(tasks: BenchTask[], opts: LoadOptions): BenchTask[] {
  let out = tasks
  if (opts.split) out = out.filter((task) => task.split === opts.split)
  if (opts.ids) {
    const want = new Set(opts.ids)
    out = out.filter((task) => want.has(task.id))
  } else if (opts.limit !== undefined) {
    out = out.slice(0, opts.limit)
  }
  if (out.length === 0) throw new Error(`BFCL: no tasks matched ${JSON.stringify(opts)}`)
  return out
}

function buildTasks(rows: BfclRow[], answers: BfclAnswerRow[], category: string, opts: LoadOptions): BenchTask[] {
  const byId = new Map(answers.map((answer) => [answer.id, answer]))
  const tasks = rows.map((row) => {
    const answer = byId.get(row.id)
    if (!answer) throw new Error(`BFCL ${category}: missing possible_answer for ${row.id}`)
    return rowToTask(row, answer, category)
  })
  return selectTasks(tasks, opts)
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const fixture = JSON.parse(await readFile(FIXTURES, 'utf8')) as { rows: BfclRow[]; answers: BfclAnswerRow[]; category: string }
  console.warn(`[bfcl] BFCL_FIXTURES=1 — loading ${fixture.rows.length} adapter fixtures`)
  return buildTasks(fixture.rows, fixture.answers, fixture.category, opts)
}

async function loadOfficialTasks(dir: string, opts: LoadOptions): Promise<BenchTask[]> {
  const category = bfclCategory()
  const dataPath = taskFile(dir, category)
  const answersPath = answerFile(dir, category)
  const [rawRows, rawAnswers] = await Promise.all([readFile(dataPath, 'utf8'), readFile(answersPath, 'utf8')])
  const rows = readJsonl(rawRows) as BfclRow[]
  const answers = readJsonl(rawAnswers) as BfclAnswerRow[]
  return buildTasks(rows, answers, category, opts)
}

function extractJsonBlock(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
  const raw = (fences.at(-1)?.[1] ?? text).trim()
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function normalizeArguments(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return normalizeArguments(JSON.parse(value))
    } catch {
      return {}
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function callFromObject(value: unknown): BfclActualCall | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (raw.function && typeof raw.function === 'object') {
    const fn = raw.function as Record<string, unknown>
    if (typeof fn.name === 'string') return { name: fn.name, arguments: normalizeArguments(fn.arguments) }
  }
  const name =
    typeof raw.name === 'string' ? raw.name
      : typeof raw.function_name === 'string' ? raw.function_name
        : typeof raw.tool_name === 'string' ? raw.tool_name
          : undefined
  if (!name) return undefined
  return { name, arguments: normalizeArguments(raw.arguments ?? raw.args ?? raw.parameters) }
}

function extractActualCalls(artifact: string): BfclActualCall[] {
  const parsed = extractJsonBlock(artifact)
  if (Array.isArray(parsed)) return parsed.map(callFromObject).filter((call): call is BfclActualCall => Boolean(call))
  if (parsed && typeof parsed === 'object') {
    const raw = parsed as Record<string, unknown>
    for (const key of ['function_calls', 'tool_calls', 'calls']) {
      if (Array.isArray(raw[key])) {
        return raw[key].map(callFromObject).filter((call): call is BfclActualCall => Boolean(call))
      }
    }
    const single = callFromObject(raw)
    if (single) return [single]
  }
  return []
}

function argMatches(expectedValues: unknown[], actual: unknown): boolean {
  return expectedValues.some((expected) => normalizeScalar(expected) === normalizeScalar(actual))
}

function callMatches(expected: BfclAllowedCall, actual: BfclActualCall): boolean {
  if (expected.name !== actual.name) return false
  for (const [argName, allowed] of Object.entries(expected.arguments)) {
    if (!(argName in actual.arguments)) {
      if (allowed.some((value) => value === '' || value === null || value === undefined)) continue
      return false
    }
    if (!argMatches(allowed, actual.arguments[argName])) return false
  }
  return true
}

function scoreCalls(task: BenchTask, artifact: string): BenchScore {
  const meta = readMeta(task)
  const actual = extractActualCalls(artifact)
  const used = new Set<number>()
  let matched = 0
  for (const expected of meta.expected) {
    const index = actual.findIndex((call, i) => !used.has(i) && callMatches(expected, call))
    if (index >= 0) {
      used.add(index)
      matched += 1
    }
  }
  const recall = meta.expected.length === 0 ? 0 : matched / meta.expected.length
  const precision = actual.length === 0 ? 0 : matched / actual.length
  const score = recall
  return {
    resolved: recall === 1 && precision === 1,
    score,
    detail: JSON.stringify({
      scoring: meta.scoring,
      category: meta.category,
      expected: meta.expected,
      actual,
      precision,
      recall,
      fullBfclLeaderboardScore: null,
    }),
  }
}

export function createBfclAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.BFCL_FIXTURES === '1'

  return {
    name: 'bfcl',
    output: bfclOutput,

    async preflight() {
      if (fixturesMode) return
      const dir = bfclDir()
      if (!dir) {
        throw new Error(
          'BFCL_DIR is required. Fix: clone https://github.com/ShishirPatil/gorilla, set BFCL_DIR=/path/to/gorilla/berkeley-function-call-leaderboard, and optionally set BFCL_CATEGORY=BFCL_v4_simple_python.',
        )
      }
      const category = bfclCategory()
      await assertPath(taskFile(dir, category), 'BFCL task JSONL')
      await assertPath(answerFile(dir, category), 'BFCL possible_answer JSONL')
      await loadOfficialTasks(dir, { limit: 1 })
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const dir = bfclDir()
      if (!dir) throw new Error('BFCL_DIR is required to load official BFCL rows')
      return loadOfficialTasks(dir, opts)
    },

    async goldArtifact(task: BenchTask) {
      const meta = readMeta(task)
      return JSON.stringify({
        function_calls: meta.expected.map((call) => ({
          name: call.name,
          arguments: Object.fromEntries(Object.entries(call.arguments).map(([key, values]) => [key, values[0]])),
        })),
      }, null, 2)
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      return scoreCalls(task, artifact)
    },
  }
}
