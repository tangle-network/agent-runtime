/**
 * AgentBench deterministic subset adapter.
 *
 * This targets AgentBench DBBench rows only: question + table + published label.
 * It does not wrap AgentBench's controller protocol or the non-deterministic game
 * environments. Worker artifact = final answer text. Judge = exact match against
 * the official DBBench label list after light whitespace/case normalization.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OutputAdapter } from '@tangle-network/agent-runtime/loops'
import { benchRoot } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'agentbench-dbbench.json')
const DEFAULT_SPLIT = 'dev'

interface AgentBenchDbRow {
  description: string
  label: string[]
  table?: {
    table_name?: string
    table_info?: {
      columns?: Array<{ name: string; type?: string }>
      rows?: unknown[][]
    }
  }
}

interface AgentBenchMeta {
  labels: string[]
  split: string
  subset: 'dbbench'
  table?: AgentBenchDbRow['table']
}

const agentbenchDir = (): string | undefined => process.env.AGENTBENCH_DIR

export const agentbenchAnswerOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) text = t
    }
    const fences = [...text.matchAll(/```(?:text|answer)?\s*\n([\s\S]*?)```/g)]
    return (fences.at(-1)?.[1] ?? text).trim()
  },
}

function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
}

function rowToTask(row: AgentBenchDbRow, index: number, split: string): BenchTask {
  const columns = row.table?.table_info?.columns?.map((c) => `${c.name}${c.type ? ` (${c.type})` : ''}`).join(', ')
  const sampleRows = row.table?.table_info?.rows?.slice(0, 40)
  const meta: AgentBenchMeta = {
    labels: row.label,
    split,
    subset: 'dbbench',
    table: row.table,
  }
  return {
    id: `dbbench-${split}-${index}`,
    split,
    prompt: [
      'Answer this AgentBench DBBench question using the table below.',
      'Return only the answer value.',
      '',
      `Question: ${row.description}`,
      row.table?.table_name ? `Table: ${row.table.table_name}` : undefined,
      columns ? `Columns: ${columns}` : undefined,
      sampleRows ? `Rows JSON: ${JSON.stringify(sampleRows)}` : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): AgentBenchMeta {
  const md = task.metadata
  if (!md || !Array.isArray(md.labels)) {
    throw new Error(`agentbench task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as AgentBenchMeta
}

function selectRows(rows: AgentBenchDbRow[], opts: LoadOptions, split: string): BenchTask[] {
  let tasks = rows.map((row, index) => rowToTask(row, index, split))
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((task) => want.has(task.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  if (tasks.length === 0) throw new Error(`AgentBench DBBench: no tasks matched ${JSON.stringify(opts)}`)
  return tasks
}

async function loadJsonl(path: string): Promise<AgentBenchDbRow[]> {
  const raw = await readFile(path, 'utf8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentBenchDbRow)
}

async function loadFixtures(opts: LoadOptions, split: string): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as AgentBenchDbRow[]
  console.warn(`[agentbench] AGENTBENCH_FIXTURES=1 — loading ${rows.length} DBBench adapter fixtures`)
  return selectRows(rows, opts, split)
}

export function createAgentBenchAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.AGENTBENCH_FIXTURES === '1'

  return {
    name: 'agentbench',
    output: agentbenchAnswerOutput,

    async preflight() {
      if (fixturesMode) return
      const dir = agentbenchDir()
      if (!dir) {
        throw new Error('AGENTBENCH_DIR is required. Fix: clone https://github.com/THUDM/AgentBench and set AGENTBENCH_DIR=/path/to/AgentBench.')
      }
      await loadJsonl(join(dir, 'data', 'dbbench', `${DEFAULT_SPLIT}.jsonl`))
    },

    async loadTasks(opts: LoadOptions = {}) {
      const split = opts.split ?? DEFAULT_SPLIT
      if (fixturesMode) return loadFixtures(opts, split)
      const dir = agentbenchDir()
      if (!dir) throw new Error('AGENTBENCH_DIR is required to load AgentBench DBBench tasks')
      return selectRows(await loadJsonl(join(dir, 'data', 'dbbench', `${split}.jsonl`)), opts, split)
    },

    async goldArtifact(task: BenchTask) {
      return readMeta(task).labels[0]
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const got = normalizeAnswer(artifact)
      const expected = meta.labels.map(normalizeAnswer)
      const resolved = expected.includes(got)
      return {
        resolved,
        score: resolved ? 1 : 0,
        detail: JSON.stringify({ subset: meta.subset, split: meta.split, expected: meta.labels, got: artifact }),
      }
    },
  }
}
