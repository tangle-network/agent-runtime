/**
 * ToolLLM/ToolBench adapter.
 *
 * ToolBench task loading is useful for breadth, but the official ToolEval pass
 * rate evaluator is LLM-based and stochastic. Under this repo's deterministic
 * judge rule, this adapter intentionally refuses to score until a deterministic
 * ToolLLM subset with executable labels is supplied.
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
  relevantApis?: Array<[string, string]>
  deterministicJudge: false
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
  const meta: ToolBenchMeta = {
    queryId: String(row.query_id),
    apiList: row.api_list ?? [],
    relevantApis: row['relevant APIs'],
    deterministicJudge: false,
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
    ].join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
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

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as ToolBenchRow[]
  console.warn(`[toollm] TOOLLM_FIXTURES=1 — loading ${rows.length} adapter fixtures`)
  return selectRows(rows, opts)
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
      await readFile(queryFile(dir), 'utf8')
      throw new Error(
        'ToolLLM official ToolEval is LLM-judged, not deterministic. This adapter can load tasks, but scoring is intentionally disabled until TOOLLM_DETERMINISTIC_SUBSET supplies executable labels.',
      )
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const dir = toolbenchDir()
      if (!dir) throw new Error('TOOLBENCH_DIR is required to load ToolLLM tasks')
      return selectRows(JSON.parse(await readFile(queryFile(dir), 'utf8')) as ToolBenchRow[], opts)
    },

    async goldArtifact() {
      return undefined
    },

    async judge(): Promise<BenchScore> {
      throw new Error('ToolLLM scoring refused: official ToolEval is LLM-judged/stochastic; provide a deterministic executable subset before recording scores.')
    },
  }
}
