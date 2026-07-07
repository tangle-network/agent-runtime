/**
 * Open RAG Bench adapter.
 *
 * This targets Vectara-style Open RAG Bench exports over PDF-derived text,
 * table, and image contexts. The deterministic judge scores final-answer
 * agreement and surfaces modality/document metadata for diagnostics.
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

const FIXTURES = join(benchRoot, 'fixtures', 'open-rag-bench.json')

interface OpenRagBenchMeta {
  benchmark: 'open-rag-bench'
  query: string
  goldAnswers: string[]
  contexts: RagContext[]
  documentId: string
  modality: string
}

const dataFile = (): string | undefined => process.env.OPEN_RAG_BENCH_DATA_FILE

function rowToTask(raw: unknown, index: number): BenchTask {
  if (!isObject(raw)) throw new Error(`Open RAG Bench row ${index} must be an object`)
  const query = firstString(raw, ['question', 'query', 'prompt'])
  const goldAnswers = allStrings(raw, ['answer', 'answers', 'reference', 'reference_answer', 'gold'])
  if (!query) throw new Error(`Open RAG Bench row ${index} missing question/query`)
  if (goldAnswers.length === 0) throw new Error(`Open RAG Bench row ${index} missing answer`)
  const contexts =
    contextsFrom(raw.contexts).length > 0
      ? contextsFrom(raw.contexts)
      : contextsFrom(raw.chunks).length > 0
        ? contextsFrom(raw.chunks)
        : contextsFrom(raw.pages)
  const documentId =
    stringFrom(raw.document_id) ??
    stringFrom(raw.doc_id) ??
    stringFrom(raw.pdf_id) ??
    stringFrom(raw.file_name) ??
    stringFrom(raw.filename) ??
    'unknown'
  const modality = stringFrom(raw.modality) ?? stringFrom(raw.answer_modality) ?? 'unknown'
  const id = stringFrom(raw.id) ?? stringFrom(raw.query_id) ?? `open-rag-bench-${index}`
  const meta: OpenRagBenchMeta = {
    benchmark: 'open-rag-bench',
    query,
    goldAnswers,
    contexts,
    documentId,
    modality,
  }
  return {
    id,
    split: stringFrom(raw.split) ?? modality,
    prompt: [
      'Answer this Open RAG Bench PDF question using the supplied document context.',
      'Use tables, text, and image-derived notes when present.',
      'End with a single final line: `FINAL ANSWER: <answer>`.',
      '',
      `Question: ${query}`,
      `Document: ${documentId}`,
      `Modality: ${modality}`,
      contexts.length > 0 ? `\nDocument context:\n${contextBlock(contexts)}` : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): OpenRagBenchMeta {
  const md = task.metadata
  if (!md || !Array.isArray(md.goldAnswers)) {
    throw new Error(`Open RAG Bench task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as OpenRagBenchMeta
}

async function loadRows(path: string): Promise<unknown[]> {
  const rows = await readJsonRows(path)
  if (rows.length === 0) throw new Error(`Open RAG Bench: no rows in ${path}`)
  return rows
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as unknown[]
  console.warn(`[open-rag-bench] OPEN_RAG_BENCH_FIXTURES=1 — loading ${rows.length} adapter fixtures`)
  return selectTasks(rows.map(rowToTask), opts, 'Open RAG Bench')
}

export function createOpenRagBenchAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.OPEN_RAG_BENCH_FIXTURES === '1'

  return {
    name: 'open-rag-bench',
    output: ragAnswerOutput,

    async preflight() {
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8')
        return
      }
      const path = dataFile()
      if (!path) {
        throw new Error(
          'OPEN_RAG_BENCH_DATA_FILE is required. Fix: export vectara/open-rag-bench rows to JSONL and set OPEN_RAG_BENCH_DATA_FILE=/path/to/open-rag-bench.jsonl, or set OPEN_RAG_BENCH_FIXTURES=1 for adapter plumbing.',
        )
      }
      await loadRows(path)
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const path = dataFile()
      if (!path) throw new Error('OPEN_RAG_BENCH_DATA_FILE is required to load Open RAG Bench tasks')
      return selectTasks((await loadRows(path)).map(rowToTask), opts, 'Open RAG Bench')
    },

    async goldArtifact(task: BenchTask) {
      return `${FINAL_ANSWER_SENTINEL} ${readMeta(task).goldAnswers[0] ?? ''}`
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const score = scoreAnswerArtifact(artifact, meta.goldAnswers)
      return answerScoreToBenchScore(score, {
        benchmark: meta.benchmark,
        documentId: meta.documentId,
        modality: meta.modality,
        contextCount: meta.contexts.length,
      })
    },
  }
}
