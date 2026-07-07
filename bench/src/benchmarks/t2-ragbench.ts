/**
 * T2-RAGBench adapter.
 *
 * T2-RAGBench stresses text+table retrieval and numerical reasoning over
 * financial documents. The judge uses the shared deterministic answer scorer
 * with numeric tolerance enabled by default.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { benchRoot } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'
import {
  FINAL_ANSWER_SENTINEL,
  allStrings,
  answerScoreToBenchScore,
  contextBlock,
  contextsFrom,
  firstString,
  isObject,
  ragAnswerOutput,
  readJsonRows,
  scoreAnswerArtifact,
  selectTasks,
  stringFrom,
  type RagContext,
} from './rag-shared'

const FIXTURES = join(benchRoot, 'fixtures', 't2-ragbench.json')

interface T2RagBenchMeta {
  benchmark: 't2-ragbench'
  query: string
  goldAnswers: string[]
  contexts: RagContext[]
  subset: string
  documentId: string
}

const dataFile = (): string | undefined => process.env.T2_RAGBENCH_DATA_FILE

function rowToTask(raw: unknown, index: number): BenchTask {
  if (!isObject(raw)) throw new Error(`T2-RAGBench row ${index} must be an object`)
  const query = firstString(raw, ['question', 'query', 'prompt'])
  const goldAnswers = allStrings(raw, [
    'program_answer',
    'original_answer',
    'answer',
    'answers',
    'reference',
    'reference_answer',
    'gold',
  ])
  if (!query) throw new Error(`T2-RAGBench row ${index} missing question/query`)
  if (goldAnswers.length === 0) throw new Error(`T2-RAGBench row ${index} missing answer`)
  const baseContexts =
    contextsFrom(raw.context).length > 0
      ? contextsFrom(raw.context)
      : contextsFrom(raw.contexts).length > 0
      ? contextsFrom(raw.contexts)
      : contextsFrom(raw.chunks).length > 0
        ? contextsFrom(raw.chunks)
        : contextsFrom(raw.passages)
  const table = stringFrom(raw.table) ?? stringFrom(raw.table_text)
  const contexts = table
    ? [...baseContexts, { id: 'table', title: 'Table', text: table }]
    : baseContexts
  const subset = stringFrom(raw.subset) ?? stringFrom(raw.dataset) ?? 'unknown'
  const documentId =
    stringFrom(raw.context_id) ??
    stringFrom(raw.document_id) ??
    stringFrom(raw.doc_id) ??
    stringFrom(raw.file_name) ??
    'unknown'
  const id = stringFrom(raw.id) ?? stringFrom(raw.qid) ?? stringFrom(raw.query_id) ?? `t2-ragbench-${index}`
  const meta: T2RagBenchMeta = {
    benchmark: 't2-ragbench',
    query,
    goldAnswers,
    contexts,
    subset,
    documentId,
  }
  return {
    id,
    split: stringFrom(raw.split) ?? subset,
    prompt: [
      'Answer this T2-RAGBench text-and-table financial question.',
      'Do the required numerical reasoning from the supplied context before giving the final value.',
      'End with a single final line: `FINAL ANSWER: <answer>`.',
      '',
      `Question: ${query}`,
      `Document: ${documentId}`,
      `Subset: ${subset}`,
      contexts.length > 0 ? `\nContext:\n${contextBlock(contexts)}` : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): T2RagBenchMeta {
  const md = task.metadata
  if (!md || !Array.isArray(md.goldAnswers)) {
    throw new Error(`T2-RAGBench task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as T2RagBenchMeta
}

async function loadRows(path: string): Promise<unknown[]> {
  const rows = await readJsonRows(path)
  if (rows.length === 0) throw new Error(`T2-RAGBench: no rows in ${path}`)
  return rows
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as unknown[]
  console.warn(`[t2-ragbench] T2_RAGBENCH_FIXTURES=1 — loading ${rows.length} adapter fixtures`)
  return selectTasks(rows.map(rowToTask), opts, 'T2-RAGBench')
}

export function createT2RagBenchAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.T2_RAGBENCH_FIXTURES === '1'

  return {
    name: 't2-ragbench',
    output: ragAnswerOutput,

    async preflight() {
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8')
        return
      }
      const path = dataFile()
      if (!path) {
        throw new Error(
          'T2_RAGBENCH_DATA_FILE is required. Fix: export T2-RAGBench rows to JSONL and set T2_RAGBENCH_DATA_FILE=/path/to/t2-ragbench.jsonl, or set T2_RAGBENCH_FIXTURES=1 for adapter plumbing.',
        )
      }
      await loadRows(path)
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const path = dataFile()
      if (!path) throw new Error('T2_RAGBENCH_DATA_FILE is required to load T2-RAGBench tasks')
      return selectTasks((await loadRows(path)).map(rowToTask), opts, 'T2-RAGBench')
    },

    async goldArtifact(task: BenchTask) {
      return `${FINAL_ANSWER_SENTINEL} ${readMeta(task).goldAnswers[0] ?? ''}`
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const score = scoreAnswerArtifact(artifact, meta.goldAnswers, { numericTolerance: 0.01 })
      return answerScoreToBenchScore(score, {
        benchmark: meta.benchmark,
        subset: meta.subset,
        documentId: meta.documentId,
        contextCount: meta.contexts.length,
      })
    },
  }
}
