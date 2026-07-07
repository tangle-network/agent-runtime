import { readFile } from 'node:fs/promises'
import type { OutputAdapter } from '@tangle-network/agent-runtime/loops'
import type { BenchScore, BenchTask, LoadOptions } from './types'

export const FINAL_ANSWER_SENTINEL = 'FINAL ANSWER:'

export interface RagContext {
  id: string
  text: string
  title?: string
  source?: string
  relevant?: boolean
}

export interface RagAnswerScore {
  resolved: boolean
  score: number
  finalAnswer: string
  bestGold: string | null
  exact: boolean
  numeric: boolean
  f1: number
  threshold: number
}

export const ragAnswerOutput: OutputAdapter<string> = {
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

export function parseFinalAnswer(artifact: string): string {
  const lines = artifact.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? ''
    const idx = line.toUpperCase().indexOf(FINAL_ANSWER_SENTINEL)
    if (idx !== -1) return line.slice(idx + FINAL_ANSWER_SENTINEL.length).trim()
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = (lines[i] ?? '').trim()
    if (trimmed.length > 0) return trimmed
  }
  return ''
}

export function parseCitations(artifact: string): string[] {
  const urls = new Set<string>()
  for (const match of artifact.matchAll(/https?:\/\/[^\s)<>"']+/g)) {
    urls.add(match[0].replace(/[.,;]+$/, ''))
  }
  return [...urls]
}

export function normalizeAnswer(input: string): string {
  return input
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[^\p{L}\p{N}\s.-]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => !['a', 'an', 'the'].includes(token))
    .join(' ')
    .trim()
}

function tokens(input: string): string[] {
  const normalized = normalizeAnswer(input)
  return normalized.length === 0 ? [] : normalized.split(/\s+/)
}

export function tokenF1(candidate: string, gold: string): number {
  const candidateTokens = tokens(candidate)
  const goldTokens = tokens(gold)
  if (candidateTokens.length === 0 || goldTokens.length === 0) {
    return candidateTokens.length === 0 && goldTokens.length === 0 ? 1 : 0
  }
  const counts = new Map<string, number>()
  for (const token of goldTokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  let common = 0
  for (const token of candidateTokens) {
    const left = counts.get(token)
    if (left !== undefined && left > 0) {
      common += 1
      counts.set(token, left - 1)
    }
  }
  if (common === 0) return 0
  const precision = common / candidateTokens.length
  const recall = common / goldTokens.length
  return (2 * precision * recall) / (precision + recall)
}

function exactOrContains(candidate: string, gold: string): boolean {
  const normalizedCandidate = normalizeAnswer(candidate)
  const normalizedGold = normalizeAnswer(gold)
  if (normalizedGold.length === 0) return false
  if (normalizedCandidate === normalizedGold) return true
  const escaped = normalizedGold.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalizedCandidate)
}

function numbers(input: string): number[] {
  return [...input.replace(/,/g, '').matchAll(/-?\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter(Number.isFinite)
}

function numericMatch(candidate: string, gold: string, relativeTolerance: number): boolean {
  const got = numbers(candidate)
  const want = numbers(gold)
  if (got.length === 0 || want.length === 0) return false
  return want.some((expected) =>
    got.some((actual) => {
      const tolerance = Math.max(Math.abs(expected) * relativeTolerance, relativeTolerance)
      return Math.abs(actual - expected) <= tolerance
    }),
  )
}

export function scoreAnswerArtifact(
  artifact: string,
  golds: readonly string[],
  options: { threshold?: number; numericTolerance?: number } = {},
): RagAnswerScore {
  const finalAnswer = parseFinalAnswer(artifact)
  const threshold = options.threshold ?? 0.72
  const numericTolerance = options.numericTolerance ?? 0.01
  let best: RagAnswerScore = {
    resolved: false,
    score: 0,
    finalAnswer,
    bestGold: null,
    exact: false,
    numeric: false,
    f1: 0,
    threshold,
  }
  if (finalAnswer.length === 0 || golds.length === 0) return best

  for (const gold of golds) {
    const exact = exactOrContains(finalAnswer, gold)
    const numeric = numericMatch(finalAnswer, gold, numericTolerance)
    const f1 = tokenF1(finalAnswer, gold)
    const resolved = exact || numeric || f1 >= threshold
    const score = exact || numeric ? 1 : f1
    if (score > best.score || (resolved && !best.resolved)) {
      best = { resolved, score, finalAnswer, bestGold: gold, exact, numeric, f1, threshold }
    }
  }
  return best
}

export function answerScoreToBenchScore(
  score: RagAnswerScore,
  detail: Record<string, unknown>,
): BenchScore {
  return {
    resolved: score.resolved,
    score: score.score,
    detail: JSON.stringify({
      ...detail,
      finalAnswer: score.finalAnswer,
      bestGold: score.bestGold,
      exact: score.exact,
      numeric: score.numeric,
      f1: score.f1,
      threshold: score.threshold,
    }),
  }
}

export async function readJsonRows(path: string): Promise<unknown[]> {
  const raw = (await readFile(path, 'utf8')).trim()
  if (raw.length === 0) return []
  if (raw.startsWith('[') || raw.startsWith('{')) {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed
    if (isObject(parsed)) {
      for (const key of ['rows', 'data', 'examples', 'items']) {
        const value = parsed[key]
        if (Array.isArray(value)) return value
      }
    }
    throw new Error(`${path} must contain a JSON array, JSONL rows, or an object with rows/data/examples/items`)
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

export function selectTasks(tasks: BenchTask[], opts: LoadOptions, label: string): BenchTask[] {
  let selected = tasks
  if (opts.split) selected = selected.filter((task) => task.split === opts.split)
  if (opts.ids) {
    const ids = new Set(opts.ids)
    selected = selected.filter((task) => ids.has(task.id))
  } else if (opts.limit !== undefined) {
    selected = selected.slice(0, opts.limit)
  }
  if (selected.length === 0) throw new Error(`${label}: no tasks matched ${JSON.stringify(opts)}`)
  return selected
}

export function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function stringArrayFrom(value: unknown): string[] {
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()]
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim().length > 0) return [entry.trim()]
    if (isObject(entry)) {
      const text = stringFrom(entry.answer) ?? stringFrom(entry.value) ?? stringFrom(entry.text)
      return text ? [text] : []
    }
    return []
  })
}

export function firstString(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringFrom(row[key])
    if (value) return value
  }
  return ''
}

export function allStrings(row: Record<string, unknown>, keys: readonly string[]): string[] {
  const out: string[] = []
  for (const key of keys) out.push(...stringArrayFrom(row[key]))
  return [...new Set(out)]
}

export function contextsFrom(value: unknown): RagContext[] {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [{ id: 'ctx-1', text: value.trim() }]
  }
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index): RagContext[] => {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      return [{ id: `ctx-${index + 1}`, text: entry.trim() }]
    }
    if (Array.isArray(entry)) {
      const [first, second] = entry
      if (typeof first === 'string' && typeof second === 'string') {
        return [{ id: first, text: second.trim() }]
      }
      return entry.flatMap((nested, nestedIndex) =>
        contextsFrom([nested]).map((ctx) => ({
          ...ctx,
          id: ctx.id.startsWith('ctx-') ? `ctx-${index + 1}-${nestedIndex + 1}` : ctx.id,
        })),
      )
    }
    if (!isObject(entry)) return []
    const text =
      stringFrom(entry.text) ??
      stringFrom(entry.context) ??
      stringFrom(entry.content) ??
      stringFrom(entry.passage) ??
      stringFrom(entry.document) ??
      stringFrom(entry.page_content) ??
      stringFrom(entry.chunk)
    if (!text) return []
    const id =
      stringFrom(entry.id) ??
      stringFrom(entry.docid) ??
      stringFrom(entry.doc_id) ??
      stringFrom(entry.document_id) ??
      `ctx-${index + 1}`
    const relevantRaw = entry.relevant ?? entry.is_relevant ?? entry.label ?? entry.relevance
    const relevant =
      typeof relevantRaw === 'boolean'
        ? relevantRaw
        : typeof relevantRaw === 'number'
          ? relevantRaw > 0
          : undefined
    return [
      {
        id,
        text,
        ...(stringFrom(entry.title) ? { title: stringFrom(entry.title) } : {}),
        ...(stringFrom(entry.source) ?? stringFrom(entry.url)
          ? { source: stringFrom(entry.source) ?? stringFrom(entry.url) }
          : {}),
        ...(relevant !== undefined ? { relevant } : {}),
      },
    ]
  })
}

export function contextBlock(contexts: readonly RagContext[]): string {
  if (contexts.length === 0) return ''
  return contexts
    .map((ctx, index) =>
      [
        `[${index + 1}] ${ctx.title ?? ctx.id}`,
        ctx.source ? `Source: ${ctx.source}` : undefined,
        ctx.text,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
