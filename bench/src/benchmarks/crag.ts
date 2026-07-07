/**
 * CRAG adapter (Comprehensive RAG Benchmark).
 *
 * Live mode expects an official or compatible CRAG JSON/JSONL export. The
 * adapter preserves CRAG domain/type/dynamism tags in metadata and scores final
 * answers deterministically against the provided gold answer list.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { benchRoot } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'
import {
  FINAL_ANSWER_SENTINEL,
  allStrings,
  answerScoreToBenchScore,
  firstString,
  isObject,
  ragAnswerOutput,
  readJsonRows,
  scoreAnswerArtifact,
  selectTasks,
  stringFrom,
} from './rag-shared'

const FIXTURES = join(benchRoot, 'fixtures', 'crag.json')

interface CragMeta {
  benchmark: 'crag'
  query: string
  goldAnswers: string[]
  domain: string
  questionType: string
  dynamism: string
}

const dataFile = (): string | undefined => process.env.CRAG_DATA_FILE

function rowToTask(raw: unknown, index: number): BenchTask {
  if (!isObject(raw)) throw new Error(`CRAG row ${index} must be an object`)
  const query = firstString(raw, ['query', 'question', 'prompt'])
  const goldAnswers = allStrings(raw, ['answer', 'answers', 'gold', 'gold_answer', 'expected_answer'])
  if (!query) throw new Error(`CRAG row ${index} missing query`)
  if (goldAnswers.length === 0) throw new Error(`CRAG row ${index} missing gold answer`)
  const domain = stringFrom(raw.domain) ?? 'unknown'
  const questionType = stringFrom(raw.question_type) ?? stringFrom(raw.questionType) ?? 'unknown'
  const dynamism = stringFrom(raw.static_or_dynamic) ?? stringFrom(raw.dynamism) ?? 'unknown'
  const id = stringFrom(raw.id) ?? stringFrom(raw.query_id) ?? `crag-${index}`
  const meta: CragMeta = {
    benchmark: 'crag',
    query,
    goldAnswers,
    domain,
    questionType,
    dynamism,
  }
  return {
    id,
    split: stringFrom(raw.split) ?? domain,
    prompt: [
      'Answer this CRAG factual question.',
      'Return a concise answer and do not guess when the evidence is insufficient.',
      'End with a single final line: `FINAL ANSWER: <answer>`.',
      '',
      `Question: ${query}`,
      `Domain: ${domain}`,
      `Question type: ${questionType}`,
      `Dynamism: ${dynamism}`,
    ].join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): CragMeta {
  const md = task.metadata
  if (!md || !Array.isArray(md.goldAnswers)) {
    throw new Error(`CRAG task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as CragMeta
}

async function loadRows(path: string): Promise<unknown[]> {
  const rows = await readJsonRows(path)
  if (rows.length === 0) throw new Error(`CRAG: no rows in ${path}`)
  return rows
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as unknown[]
  console.warn(`[crag] CRAG_FIXTURES=1 — loading ${rows.length} adapter fixtures`)
  return selectTasks(rows.map(rowToTask), opts, 'CRAG')
}

export function createCragAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.CRAG_FIXTURES === '1'

  return {
    name: 'crag',
    output: ragAnswerOutput,

    async preflight() {
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8')
        return
      }
      const path = dataFile()
      if (!path) {
        throw new Error(
          'CRAG_DATA_FILE is required. Fix: export facebookresearch/CRAG rows to JSONL and set CRAG_DATA_FILE=/path/to/crag.jsonl, or set CRAG_FIXTURES=1 for adapter plumbing.',
        )
      }
      await loadRows(path)
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const path = dataFile()
      if (!path) throw new Error('CRAG_DATA_FILE is required to load CRAG tasks')
      return selectTasks((await loadRows(path)).map(rowToTask), opts, 'CRAG')
    },

    async goldArtifact(task: BenchTask) {
      return `${FINAL_ANSWER_SENTINEL} ${readMeta(task).goldAnswers[0] ?? ''}`
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const score = scoreAnswerArtifact(artifact, meta.goldAnswers)
      return answerScoreToBenchScore(score, {
        benchmark: meta.benchmark,
        domain: meta.domain,
        questionType: meta.questionType,
        dynamism: meta.dynamism,
      })
    },
  }
}
