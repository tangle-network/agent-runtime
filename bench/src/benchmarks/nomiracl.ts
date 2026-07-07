/**
 * NoMIRACL adapter.
 *
 * NoMIRACL tests robustness to irrelevant retrieved passages. The worker does
 * not generate an answer here; it classifies whether the supplied passages
 * contain enough evidence to answer the query. This directly measures false
 * positive / false negative behavior for RAG abstention.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { benchRoot } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'
import {
  contextBlock,
  contextsFrom,
  firstString,
  isObject,
  ragAnswerOutput,
  readJsonRows,
  selectTasks,
  stringFrom,
  type RagContext,
} from './rag-shared'

const FIXTURES = join(benchRoot, 'fixtures', 'nomiracl.json')

interface NoMiraclMeta {
  benchmark: 'nomiracl'
  query: string
  answerable: boolean
  language: string
  subset: string
  contexts: RagContext[]
}

const dataFile = (): string | undefined => process.env.NOMIRACL_DATA_FILE

function passagesFrom(value: unknown, relevant: boolean): RagContext[] {
  return contextsFrom(value).map((context) => ({ ...context, relevant }))
}

function answerableFrom(raw: Record<string, unknown>, contexts: readonly RagContext[]): boolean {
  const direct = raw.answerable ?? raw.is_answerable ?? raw.has_answer ?? raw.label ?? raw.relevant
  if (typeof direct === 'boolean') return direct
  if (typeof direct === 'number') return direct > 0
  if (typeof direct === 'string') {
    const normalized = direct.toLowerCase()
    if (['true', 't', 'relevant', 'answerable', 'positive', '1', 'yes'].includes(normalized)) return true
    if (['false', 'f', 'non-relevant', 'non_relevant', 'unanswerable', 'negative', '0', 'no'].includes(normalized)) {
      return false
    }
  }
  return contexts.some((context) => context.relevant === true)
}

function rowToTask(raw: unknown, index: number): BenchTask {
  if (!isObject(raw)) throw new Error(`NoMIRACL row ${index} must be an object`)
  const query = firstString(raw, ['query', 'question'])
  if (!query) throw new Error(`NoMIRACL row ${index} missing query`)
  const labelledPassages = [
    ...passagesFrom(raw.positive_passages, true),
    ...passagesFrom(raw.negative_passages, false),
  ]
  const contexts =
    labelledPassages.length > 0
      ? labelledPassages
      : contextsFrom(raw.passages).length > 0
      ? contextsFrom(raw.passages)
      : contextsFrom(raw.contexts).length > 0
        ? contextsFrom(raw.contexts)
        : contextsFrom(raw.documents)
  const answerable = answerableFrom(raw, contexts)
  const language = stringFrom(raw.lang) ?? stringFrom(raw.language) ?? 'unknown'
  const subset = stringFrom(raw.subset) ?? (answerable ? 'relevant' : 'non-relevant')
  const id = stringFrom(raw.id) ?? stringFrom(raw.query_id) ?? `nomiracl-${index}`
  const meta: NoMiraclMeta = {
    benchmark: 'nomiracl',
    query,
    answerable,
    language,
    subset,
    contexts,
  }
  return {
    id,
    split: stringFrom(raw.split) ?? language,
    prompt: [
      'Classify this NoMIRACL RAG relevance case.',
      'Return exactly one word: ANSWERABLE if at least one supplied passage contains enough evidence to answer the query, otherwise UNANSWERABLE.',
      '',
      `Query: ${query}`,
      contexts.length > 0 ? `\nPassages:\n${contextBlock(contexts)}` : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): NoMiraclMeta {
  const md = task.metadata
  if (!md || typeof md.answerable !== 'boolean') {
    throw new Error(`NoMIRACL task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as NoMiraclMeta
}

function parseClassification(artifact: string): boolean | null {
  const normalized = artifact.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (/\bunanswerable\b|\bnot answerable\b|\bno answer\b|\bnegative\b|\bfalse\b/.test(normalized)) {
    return false
  }
  if (/\banswerable\b|\brelevant\b|\bpositive\b|\btrue\b|\byes\b/.test(normalized)) return true
  return null
}

async function loadRows(path: string): Promise<unknown[]> {
  const rows = await readJsonRows(path)
  if (rows.length === 0) throw new Error(`NoMIRACL: no rows in ${path}`)
  return rows
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as unknown[]
  console.warn(`[nomiracl] NOMIRACL_FIXTURES=1 — loading ${rows.length} adapter fixtures`)
  return selectTasks(rows.map(rowToTask), opts, 'NoMIRACL')
}

export function createNoMiraclAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.NOMIRACL_FIXTURES === '1'

  return {
    name: 'nomiracl',
    output: ragAnswerOutput,

    async preflight() {
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8')
        return
      }
      const path = dataFile()
      if (!path) {
        throw new Error(
          'NOMIRACL_DATA_FILE is required. Fix: export project-miracl/nomiracl rows to JSONL and set NOMIRACL_DATA_FILE=/path/to/nomiracl.jsonl, or set NOMIRACL_FIXTURES=1 for adapter plumbing.',
        )
      }
      await loadRows(path)
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const path = dataFile()
      if (!path) throw new Error('NOMIRACL_DATA_FILE is required to load NoMIRACL tasks')
      return selectTasks((await loadRows(path)).map(rowToTask), opts, 'NoMIRACL')
    },

    async goldArtifact(task: BenchTask) {
      return readMeta(task).answerable ? 'ANSWERABLE' : 'UNANSWERABLE'
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const got = parseClassification(artifact)
      const resolved = got === meta.answerable
      return {
        resolved,
        score: resolved ? 1 : 0,
        detail: JSON.stringify({
          benchmark: meta.benchmark,
          language: meta.language,
          subset: meta.subset,
          expected: meta.answerable ? 'ANSWERABLE' : 'UNANSWERABLE',
          got: got === null ? null : got ? 'ANSWERABLE' : 'UNANSWERABLE',
          contextCount: meta.contexts.length,
        }),
      }
    },
  }
}
