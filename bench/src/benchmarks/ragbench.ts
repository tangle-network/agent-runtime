/**
 * RAGBench-compatible adapter.
 *
 * Live mode expects a local JSON/JSONL export from rungalileo/ragbench or a
 * compatible table. Rows must carry a query and at least one reference answer.
 * Contexts, TRACe labels, and source metadata are preserved in task metadata
 * for diagnostics; the deterministic judge scores the worker's final answer
 * against the reference answer(s).
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

const FIXTURES = join(benchRoot, 'fixtures', 'ragbench.json')

interface RagBenchMeta {
  benchmark: 'ragbench'
  query: string
  goldAnswers: string[]
  contexts: RagContext[]
  dataset?: string
  traceLabels: Record<string, unknown>
}

const dataFile = (): string | undefined => process.env.RAGBENCH_DATA_FILE

function rowToTask(raw: unknown, index: number): BenchTask {
  if (!isObject(raw)) throw new Error(`RAGBench row ${index} must be an object`)
  const query = firstString(raw, ['question', 'query', 'user_input', 'prompt'])
  const goldAnswers = allStrings(raw, [
    'response',
    'responses',
    'model_response',
    'generated_response',
    'reference',
    'references',
    'reference_answer',
    'reference_answers',
    'answer',
    'answers',
    'gold',
    'gold_answer',
    'ground_truth',
    'expected_answer',
  ])
  if (!query) throw new Error(`RAGBench row ${index} missing question/query`)
  if (goldAnswers.length === 0) throw new Error(`RAGBench row ${index} missing reference answer`)
  const contexts =
    contextsFrom(raw.contexts).length > 0
      ? contextsFrom(raw.contexts)
      : contextsFrom(raw.retrieved_contexts).length > 0
        ? contextsFrom(raw.retrieved_contexts)
        : contextsFrom(raw.documents)
  const traceLabels: Record<string, unknown> = {}
  for (const key of [
    'adherence',
    'completeness',
    'relevance',
    'utilization',
    'all_relevant_sentence_keys',
    'all_utilized_sentence_keys',
  ]) {
    if (raw[key] !== undefined) traceLabels[key] = raw[key]
  }
  const dataset = stringFrom(raw.dataset) ?? stringFrom(raw.source_dataset)
  const id = stringFrom(raw.id) ?? stringFrom(raw.example_id) ?? `ragbench-${index}`
  const meta: RagBenchMeta = {
    benchmark: 'ragbench',
    query,
    goldAnswers,
    contexts,
    ...(dataset ? { dataset } : {}),
    traceLabels,
  }
  return {
    id,
    split: stringFrom(raw.split) ?? dataset ?? 'ragbench',
    prompt: [
      'Answer this RAGBench question using the supplied retrieved context.',
      'End with a single final line: `FINAL ANSWER: <answer>`.',
      '',
      `Question: ${query}`,
      contexts.length > 0 ? `\nRetrieved context:\n${contextBlock(contexts)}` : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): RagBenchMeta {
  const md = task.metadata
  if (!md || !Array.isArray(md.goldAnswers)) {
    throw new Error(`RAGBench task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as RagBenchMeta
}

async function loadRows(path: string): Promise<unknown[]> {
  const rows = await readJsonRows(path)
  if (rows.length === 0) throw new Error(`RAGBench: no rows in ${path}`)
  return rows
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as unknown[]
  console.warn(`[ragbench] RAGBENCH_FIXTURES=1 — loading ${rows.length} adapter fixtures`)
  return selectTasks(rows.map(rowToTask), opts, 'RAGBench')
}

export function createRagBenchAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.RAGBENCH_FIXTURES === '1'

  return {
    name: 'ragbench',
    output: ragAnswerOutput,

    async preflight() {
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8')
        return
      }
      const path = dataFile()
      if (!path) {
        throw new Error(
          'RAGBENCH_DATA_FILE is required. Fix: export rungalileo/ragbench rows to JSONL and set RAGBENCH_DATA_FILE=/path/to/ragbench.jsonl, or set RAGBENCH_FIXTURES=1 for adapter plumbing.',
        )
      }
      await loadRows(path)
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const path = dataFile()
      if (!path) throw new Error('RAGBENCH_DATA_FILE is required to load RAGBench tasks')
      return selectTasks((await loadRows(path)).map(rowToTask), opts, 'RAGBench')
    },

    async goldArtifact(task: BenchTask) {
      return `${FINAL_ANSWER_SENTINEL} ${readMeta(task).goldAnswers[0] ?? ''}`
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const score = scoreAnswerArtifact(artifact, meta.goldAnswers)
      return answerScoreToBenchScore(score, {
        benchmark: meta.benchmark,
        dataset: meta.dataset ?? null,
        traceLabels: meta.traceLabels,
        contextCount: meta.contexts.length,
      })
    },
  }
}
