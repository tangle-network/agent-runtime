/**
 * ToolLLM/ToolBench adapter.
 *
 * ToolBench task loading is useful for breadth, but the official ToolEval pass
 * rate evaluator is LLM-based and stochastic. This adapter therefore scores
 * only ToolBench's deterministic API-selection labels (`relevant APIs`). It
 * never records a full ToolEval pass-rate score.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OutputAdapter } from '@tangle-network/agent-runtime/loops'
import { benchRoot } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'toollm.json')
const DEFAULT_QUERY_REL = join('data_example', 'instruction', 'G1_query.json')

interface ToolApi {
  category_name?: string
  tool_name: string
  api_name: string
  api_description?: string
  required_parameters?: unknown[]
  optional_parameters?: unknown[]
  method?: string
}

interface ToolBenchRow {
  query_id: number | string
  query: string
  api_list?: ToolApi[]
  'relevant APIs'?: Array<[string, string]>
}

interface ToolBenchMeta {
  queryId: string
  apiList: ToolApi[]
  relevantApis: Array<[string, string]>
  deterministicJudge: 'api-selection'
}

const toolbenchDir = (): string | undefined => process.env.TOOLBENCH_DIR
const queryFile = (dir: string): string => process.env.TOOLLM_QUERY_FILE ?? join(dir, DEFAULT_QUERY_REL)

export const toollmOutput: OutputAdapter<string> = {
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

function rowToTask(row: ToolBenchRow): BenchTask {
  const relevantApis = normalizeApiPairs(row['relevant APIs'] ?? [])
  const meta: ToolBenchMeta = {
    queryId: String(row.query_id),
    apiList: row.api_list ?? [],
    relevantApis,
    deterministicJudge: 'api-selection',
  }
  return {
    id: String(row.query_id),
    prompt: [
      'Solve this ToolLLM/ToolBench API-use task.',
      'Use only the listed APIs/tools and return the completed tool-use trace plus final answer.',
      '',
      `Query: ${row.query}`,
      '',
      `Available APIs: ${JSON.stringify(row.api_list ?? [], null, 2)}`,
      '',
      'Return the APIs you used as JSON: {"api_calls":[{"tool_name":"...","api_name":"..."}]}.',
    ].join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function normalizeApiPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function apiKey(pair: readonly [string, string]): string {
  return `${normalizeApiPart(pair[0])}.${normalizeApiPart(pair[1])}`
}

function normalizeApiPairs(value: unknown): Array<[string, string]> {
  if (!Array.isArray(value)) return []
  const out: Array<[string, string]> = []
  for (const item of value) {
    if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') {
      out.push([item[0], item[1]])
    } else if (
      item && typeof item === 'object'
      && typeof (item as { tool_name?: unknown }).tool_name === 'string'
      && typeof (item as { api_name?: unknown }).api_name === 'string'
    ) {
      out.push([(item as { tool_name: string }).tool_name, (item as { api_name: string }).api_name])
    }
  }
  return out
}

function readMeta(task: BenchTask): ToolBenchMeta {
  const md = task.metadata
  if (!md || !Array.isArray(md.relevantApis)) {
    throw new Error(`ToolLLM task ${task.id} missing metadata — loadTasks did not populate deterministic API-selection labels`)
  }
  return md as unknown as ToolBenchMeta
}

function selectRows(rows: ToolBenchRow[], opts: LoadOptions): BenchTask[] {
  let tasks = rows.map(rowToTask)
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((task) => want.has(task.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  if (tasks.length === 0) throw new Error(`ToolLLM: no tasks matched ${JSON.stringify(opts)}`)
  return tasks
}

function assertDeterministicSubset(tasks: readonly BenchTask[], source: string): void {
  const missing = tasks.filter((task) => readMeta(task).relevantApis.length === 0).map((task) => task.id)
  if (missing.length > 0) {
    throw new Error(
      `ToolLLM deterministic API-selection labels missing for ${missing.length}/${tasks.length} task(s) from ${source}: ${missing.slice(0, 5).join(', ')}. ` +
        'Use a ToolBench query file that includes "relevant APIs" labels, or do not score ToolLLM in agent-bench.',
    )
  }
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as ToolBenchRow[]
  console.warn(`[toollm] TOOLLM_FIXTURES=1 — loading ${rows.length} adapter fixtures`)
  const tasks = selectRows(rows, opts)
  assertDeterministicSubset(tasks, FIXTURES)
  return tasks
}

async function loadOfficialTasks(dir: string, opts: LoadOptions): Promise<BenchTask[]> {
  const source = queryFile(dir)
  const tasks = selectRows(JSON.parse(await readFile(source, 'utf8')) as ToolBenchRow[], opts)
  assertDeterministicSubset(tasks, source)
  return tasks
}

function extractJsonBlock(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)]
  const raw = (fences.at(-1)?.[1] ?? text).trim()
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

interface ExtractedApis {
  pairs: Array<[string, string]>
  source: 'structured-json' | 'text-mention'
}

function extractCalledApis(text: string, expected: readonly [string, string][]): ExtractedApis {
  const parsed = extractJsonBlock(text)
  if (parsed && typeof parsed === 'object') {
    const raw = parsed as Record<string, unknown>
    const fromApiCalls = normalizeApiPairs(raw.api_calls)
    if (fromApiCalls.length > 0) return { pairs: fromApiCalls, source: 'structured-json' }
    const fromCalls = normalizeApiPairs(raw.calls)
    if (fromCalls.length > 0) return { pairs: fromCalls, source: 'structured-json' }
  }

  const lower = text.toLowerCase()
  return {
    pairs: expected.filter(([tool, api]) => {
      const toolNeedle = normalizeApiPart(tool)
      const apiNeedle = normalizeApiPart(api)
      const compactText = lower.replace(/[^a-z0-9]+/g, '')
      return compactText.includes(`${toolNeedle}${apiNeedle}`) || (lower.includes(tool.toLowerCase()) && lower.includes(api.toLowerCase()))
    }),
    source: 'text-mention',
  }
}

function scoreApiSelection(task: BenchTask, artifact: string): BenchScore {
  const meta = readMeta(task)
  if (meta.relevantApis.length === 0) {
    throw new Error(`ToolLLM task ${task.id} has no deterministic API-selection labels; refusing to score`)
  }
  const expected = new Set(meta.relevantApis.map(apiKey))
  const extracted = extractCalledApis(artifact, meta.relevantApis)
  const calledPairs = extracted.pairs
  const called = new Set(calledPairs.map(apiKey))
  const truePositives = [...called].filter((key) => expected.has(key)).length
  const precision = called.size === 0 ? 0 : truePositives / called.size
  const recall = truePositives / expected.size
  const score = expected.size === 0 ? 0 : recall
  const resolved = extracted.source === 'structured-json' && recall === 1 && precision === 1
  return {
    resolved,
    score,
    detail: JSON.stringify({
      scoring: 'api-selection-only',
      extractionSource: extracted.source,
      queryId: meta.queryId,
      expected: meta.relevantApis,
      called: calledPairs,
      precision,
      recall,
      fullToolEvalScore: null,
    }),
  }
}

export function createToolLlmAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.TOOLLM_FIXTURES === '1'

  return {
    name: 'toollm',
    output: toollmOutput,

    async preflight() {
      if (fixturesMode) return
      const dir = toolbenchDir()
      if (!dir) {
        throw new Error('TOOLBENCH_DIR is required. Fix: clone https://github.com/OpenBMB/ToolBench and set TOOLBENCH_DIR=/path/to/ToolBench.')
      }
      await loadOfficialTasks(dir, { limit: 1 })
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const dir = toolbenchDir()
      if (!dir) throw new Error('TOOLBENCH_DIR is required to load ToolLLM tasks')
      return loadOfficialTasks(dir, opts)
    },

    async goldArtifact(task: BenchTask) {
      const meta = readMeta(task)
      if (meta.relevantApis.length === 0) return undefined
      return JSON.stringify({
        api_calls: meta.relevantApis.map(([tool_name, api_name]) => ({ tool_name, api_name })),
      }, null, 2)
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      return scoreApiSelection(task, artifact)
    },
  }
}
