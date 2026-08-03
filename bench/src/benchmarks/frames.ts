/**
 * FRAMES adapter (google/frames-benchmark). Worker artifact = a single free-text
 * final answer string (optionally preceded by a citations block). FRAMES ships,
 * per item, a short gold `Answer` PLUS gold `wiki_links` (the Wikipedia URLs
 * needed to answer) — the gold-citation column is what lets the loop's critic
 * check citation coverage deterministically.
 *
 * Judge is two-tier, deterministic-first:
 *   Tier 1 — normalized exact / token-boundary containment match (no model tokens).
 *   Tier 2 — a constrained binary equivalence gate via a pinned LLM (JUDGE_MODEL,
 *            temperature 0), fired ONLY when Tier 1 misses, to absorb the
 *            paraphrase/alias equivalence FRAMES intends to allow.
 *
 * score is binary (resolved ? 1 : 0) — FRAMES has no partial credit. The judge
 * resolves strictly on the Answer value; wiki_links are a SOFT signal surfaced
 * in `detail` for the critic, never a hard pass criterion.
 *
 * Requires for a live run: the bench `.venv` with `datasets` installed and a
 * JUDGE_MODEL router key. For offline/CI verification set FRAMES_FIXTURES=1 to
 * load the committed fixtures (bench/fixtures/frames.json) — no HF download.
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { runBenchRouterTurn } from '../router-turn'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const execFileAsync = promisify(execFile)
const BENCH_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PY = join(BENCH_ROOT, '.venv', 'bin', 'python')
const FIXTURES = join(BENCH_ROOT, 'fixtures', 'frames.json')

const DATASET = 'google/frames-benchmark'
/** Pin the dataset revision: ids are derived from row order (no native id column),
 *  so a reorder would break opts.ids selection + scorecard joins. */
const DATASET_REVISION = 'main'
const FINAL_ANSWER_SENTINEL = 'FINAL ANSWER:'

/** Worker contract appended to every task prompt. Tier-1 parsing keys off the sentinel. */
const WORKER_CONTRACT = [
  '',
  'Research the question using live web sources and answer it.',
  'Cite the sources you used as full URLs, one per line, in a `CITATIONS:` block.',
  `End your response with a single final line: \`${FINAL_ANSWER_SENTINEL} <answer>\``,
  'The answer after the sentinel must be the bare value only (no explanation on that line).',
].join('\n')

/**
 * Typed seam for the future dynamic-topology research worker. The benchmark
 * adapter scores a plain `string` artifact (the BenchmarkAdapter contract); the
 * loop worker decodes its agent runs into a {@link ResearchAnswer} and serializes
 * `finalAnswer` (+ optional `CITATIONS:` block) into that string before judging.
 */
export interface ResearchTask {
  id: string
  question: string
  /** Gold short answer — judge resolves strictly against this. */
  gold: string
  /** Gold Wikipedia URLs — SOFT citation-coverage signal for the critic, never a hard gate. */
  goldSources: string[]
  /** FRAMES reasoning_types, e.g. 'numerical | temporal' — slices the scorecard by hop-type. */
  reasoningTypes: string
}

export interface ResearchAnswer {
  finalAnswer: string
  citations: string[]
}

interface FramesRow {
  Prompt: string
  Answer: string
  wiki_links: string
  reasoning_types: string
}

interface FramesMeta {
  gold: string
  goldSources: string[]
  reasoningTypes: string
  rawPrompt: string
}

/** Run the bench venv python with a script on stdin; return stdout (throws on nonzero). */
async function py(script: string, args: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync(PY, ['-c', script, ...args], {
    maxBuffer: 1024 * 1024 * 256,
  })
  return stdout
}

const ARTICLES = new Set(['a', 'an', 'the'])
const UNIT_WORDS = new Set([
  'years',
  'year',
  'months',
  'month',
  'days',
  'day',
  'people',
  'percent',
  'dollars',
  'meters',
  'metres',
  'kilometers',
  'kilometres',
  'miles',
  'km',
  'm',
])

const WRITTEN_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  million: 1_000_000,
  billion: 1_000_000_000,
}

const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
}

const SCALES = new Set(['hundred', 'thousand', 'million', 'billion'])

/** Fold a run of written-number words into one integer ("twenty eight"→28, "two hundred"→200). */
function composeWrittenRun(words: string[]): number {
  let total = 0
  let current = 0
  for (const w of words) {
    const v = WRITTEN_NUMBERS[w]
    if (v === undefined) continue
    if (w === 'hundred') {
      current = (current === 0 ? 1 : current) * 100
    } else if (SCALES.has(w)) {
      current = (current === 0 ? 1 : current) * v
      total += current
      current = 0
    } else {
      current += v
    }
  }
  return total + current
}

/** Canonicalize "1,234" / "1.2 million" / written numerals to a single numeric token. */
function canonicalizeNumbers(s: string): string {
  // "1,234,567" → "1234567"
  let out = s.replace(/(\d),(?=\d{3}\b)/g, '$1')
  // "1.2 million" / "3 billion" → expanded integer
  out = out.replace(/\b(\d+(?:\.\d+)?)\s+(hundred|thousand|million|billion)\b/g, (_m, num: string, scaleWord: string) => {
    const scale = WRITTEN_NUMBERS[scaleWord] ?? 1
    return String(Number(num) * scale)
  })
  // fold contiguous runs of written-number words into one integer
  out = out.replace(/\b[a-z]+(?:[\s-]+[a-z]+)*\b/g, (run) => {
    const words = run.split(/[\s-]+/)
    if (!words.every((w) => w in WRITTEN_NUMBERS)) return run
    return String(composeWrittenRun(words))
  })
  return out
}

/** "March 3, 1879" / "3 March 1879" → "1879-03-03"; year-only stays as the year. */
function canonicalizeDates(s: string): string {
  let out = s.replace(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/g,
    (_m, mon: string, day: string, year: string) => `${year}-${MONTHS[mon]}-${day.padStart(2, '0')}`,
  )
  out = out.replace(
    /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/g,
    (_m, day: string, mon: string, year: string) => `${year}-${MONTHS[mon]}-${day.padStart(2, '0')}`,
  )
  return out
}

/** Port of the SQuAD/GAIA normalize_answer routine, plus number/date canonicalization. */
export function normalizeAnswer(input: string): string {
  let s = input.toLowerCase()
  s = canonicalizeDates(s)
  s = canonicalizeNumbers(s)
  // strip punctuation (keep alphanumerics, ISO-date hyphens collapse to space-free below)
  s = s.replace(/[^\w\s-]/g, ' ')
  // tokenize, drop articles + trailing unit words, keep order
  const tokens = s
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !ARTICLES.has(t))
    .filter((t) => !UNIT_WORDS.has(t))
  return tokens.join(' ').trim()
}

/** Tier-1 match: normalized equality OR normalized gold as a token-boundary substring. */
function tier1Match(candidate: string, gold: string): boolean {
  const nc = normalizeAnswer(candidate)
  const ng = normalizeAnswer(gold)
  if (ng.length === 0) return false
  if (nc === ng) return true
  // token-boundary containment: gold appears as a whole-token run inside candidate
  const re = new RegExp(`(^|\\s)${ng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`)
  return re.test(nc)
}

/**
 * Parse the worker artifact into the final answer string.
 * Order: the `FINAL ANSWER:` sentinel first (deterministic-extraction discipline);
 * fall back to the last non-empty line. Returns '' when nothing is parseable
 * (fail-closed — never guess), which judge() counts as resolved=false.
 */
export function parseFinalAnswer(artifact: string): string {
  const lines = artifact.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? ''
    const idx = line.toUpperCase().indexOf(FINAL_ANSWER_SENTINEL)
    if (idx !== -1) return line.slice(idx + FINAL_ANSWER_SENTINEL.length).trim()
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const t = (lines[i] ?? '').trim()
    if (t.length > 0) return t
  }
  return ''
}

/** Extract cited URLs from a `CITATIONS:` block and any bare URLs in the artifact. */
export function parseCitations(artifact: string): string[] {
  const urls = new Set<string>()
  for (const m of artifact.matchAll(/https?:\/\/[^\s)<>"']+/g)) {
    urls.add(m[0].replace(/[.,;]+$/, ''))
  }
  return [...urls]
}

/** Fraction of gold Wikipedia article slugs touched by the candidate's citations. SOFT signal. */
function citationCoverage(citations: string[], goldSources: string[]): number {
  if (goldSources.length === 0) return 1
  const slug = (u: string) => {
    const m = u.match(/\/wiki\/([^#?]+)/)
    return m ? decodeURIComponent(m[1] ?? '').toLowerCase() : u.toLowerCase()
  }
  const got = new Set(citations.map(slug))
  let hit = 0
  for (const g of goldSources) if (got.has(slug(g))) hit += 1
  return hit / goldSources.length
}

const JUDGE_PROMPT = (question: string, gold: string, candidate: string): string =>
  [
    'You are a strict answer-equivalence checker for a factual question-answering benchmark.',
    'Decide ONLY whether the candidate answer is semantically equivalent to the gold answer for this question.',
    'It is CORRECT iff it contains the same factual value as the gold answer. Extra correct detail is fine.',
    'A different value, a missing value, or a wrong value is INCORRECT.',
    '',
    `Question: ${question}`,
    `Gold answer: ${gold}`,
    `Candidate answer: ${candidate}`,
    '',
    'Respond with ONLY a fenced JSON block and nothing else:',
    '```json',
    '{"verdict": "correct" | "incorrect"}',
    '```',
  ].join('\n')

interface JudgeRouter {
  baseUrl: string
  key: string
  model: string
}

function judgeRouter(): JudgeRouter {
  const model = process.env.JUDGE_MODEL
  if (!model) throw new Error('JUDGE_MODEL is required for the FRAMES Tier-2 equivalence judge')
  const key = process.env.TANGLE_API_KEY
  if (!key) throw new Error('TANGLE_API_KEY is required for the FRAMES Tier-2 judge')
  const baseUrl = process.env.JUDGE_ROUTER_BASE ?? process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  return { baseUrl, key, model }
}

/** Constrained binary equivalence gate. Pinned model, temperature 0; fail loud on unparseable output. */
async function tier2Judge(
  question: string,
  gold: string,
  candidate: string,
  router: JudgeRouter,
): Promise<boolean> {
  const turn = await runBenchRouterTurn(
    {
      routerBaseUrl: router.baseUrl,
      routerKey: router.key,
      profile: {
        name: 'frames-equivalence-judge',
        model: { provider: 'tangle-router', default: router.model },
      },
      temperature: 0,
      seed: 0,
    },
    JUDGE_PROMPT(question, gold, candidate),
  )
  const content = turn.finalText
  if (!content) throw new Error('FRAMES Tier-2 judge returned no message content')
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fenced ? fenced[1] : content)?.trim() ?? ''
  let parsed: { verdict?: unknown }
  try {
    parsed = JSON.parse(raw) as { verdict?: unknown }
  } catch {
    throw new Error(`FRAMES Tier-2 judge produced unparseable output (no JSON verdict): ${content.slice(0, 300)}`)
  }
  if (parsed.verdict === 'correct') return true
  if (parsed.verdict === 'incorrect') return false
  throw new Error(`FRAMES Tier-2 judge verdict not in {correct,incorrect}: ${JSON.stringify(parsed).slice(0, 200)}`)
}

/** FRAMES wiki_links is a python-repr list string, e.g. "['https://…', 'https://…']". */
function parseWikiLinks(raw: string): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const m of raw.matchAll(/https?:\/\/[^\s'"\]]+/g)) out.push(m[0])
  return out
}

function rowToTask(row: FramesRow, index: number): BenchTask {
  const goldSources = parseWikiLinks(row.wiki_links)
  const meta: FramesMeta = {
    gold: row.Answer,
    goldSources,
    reasoningTypes: row.reasoning_types ?? '',
    rawPrompt: row.Prompt,
  }
  return {
    id: `frames-${index}`,
    split: 'test',
    prompt: row.Prompt + WORKER_CONTRACT,
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): FramesMeta {
  const md = task.metadata
  if (!md || typeof md.gold !== 'string') {
    throw new Error(`FRAMES task ${task.id} missing metadata.gold — loadTasks did not populate it`)
  }
  return md as unknown as FramesMeta
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as FramesRow[]
  console.log(`[frames] FRAMES_FIXTURES=1 — loading ${rows.length} committed fixtures (no HF download)`)
  let tasks = rows.map(rowToTask)
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((t) => want.has(t.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  return tasks
}

export function createFramesAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.FRAMES_FIXTURES === '1'

  return {
    name: 'frames',

    async preflight() {
      // Tier-2 judge router config must be present in both modes — the loop's
      // citation-coverage stop gate is meaningless without the equivalence judge.
      judgeRouter()
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8').catch((err) => {
          throw new Error(`FRAMES_FIXTURES=1 but ${FIXTURES} unreadable: ${err instanceof Error ? err.message : err}`)
        })
        return
      }
      try {
        await py(
          `from datasets import load_dataset
load_dataset(${JSON.stringify(DATASET)}, split='test', revision=${JSON.stringify(DATASET_REVISION)})
print('ok')`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `frames preflight failed: ${msg}\n` +
            `Fix: (1) python3 -m venv bench/.venv && bench/.venv/bin/pip install datasets ; ` +
            `(2) ensure network access to Hugging Face for ${DATASET} ; ` +
            `or set FRAMES_FIXTURES=1 to run against the committed fixtures offline.`,
        )
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const limit = opts.limit ?? 10
      const script = `
import json, sys
from datasets import load_dataset
ds = load_dataset(${JSON.stringify(DATASET)}, split='test', revision=${JSON.stringify(DATASET_REVISION)})
ids = set(json.loads(sys.argv[1])) if len(sys.argv) > 1 and sys.argv[1] else None
out = []
for i, r in enumerate(ds):
    rid = f"frames-{i}"
    if ids is not None and rid not in ids:
        continue
    out.append({
        "_index": i,
        "Prompt": r.get("Prompt", ""),
        "Answer": r.get("Answer", ""),
        "wiki_links": str(r.get("wiki_links", "")),
        "reasoning_types": str(r.get("reasoning_types", "")),
    })
    if ids is None and len(out) >= ${limit}:
        break
print(json.dumps(out))
`
      const stdout = await py(script, [opts.ids ? JSON.stringify(opts.ids) : ''])
      const rows = JSON.parse(stdout) as Array<FramesRow & { _index: number }>
      return rows.map((r) => rowToTask(r, r._index))
    },

    async goldArtifact(task: BenchTask) {
      // Gold artifact = the worker-contract serialization of the gold Answer, so
      // verify-judge proves gold→resolved through the SAME parse path the real
      // artifact takes (Tier-1 short-circuits with no model tokens).
      const meta = readMeta(task)
      return `${FINAL_ANSWER_SENTINEL} ${meta.gold}`
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const finalAnswer = parseFinalAnswer(artifact)
      const citations = parseCitations(artifact)
      const coverage = citationCoverage(citations, meta.goldSources)

      if (finalAnswer.length === 0) {
        // Fail-closed: distinguish prompt-adherence failure from a wrong answer.
        return {
          resolved: false,
          score: 0,
          detail: JSON.stringify({
            tier: 'none',
            reason: 'no parseable answer',
            normalizedGold: normalizeAnswer(meta.gold),
            citationCoverage: coverage,
          }),
        }
      }

      // Tier 1 — free, deterministic.
      if (tier1Match(finalAnswer, meta.gold)) {
        return {
          resolved: true,
          score: 1,
          detail: JSON.stringify({
            tier: 1,
            normalizedAnswer: normalizeAnswer(finalAnswer),
            normalizedGold: normalizeAnswer(meta.gold),
            citationCoverage: coverage,
          }),
        }
      }

      // Tier 2 — constrained LLM equivalence gate (fail loud on unparseable output).
      const verdict = await tier2Judge(meta.rawPrompt, meta.gold, finalAnswer, judgeRouter())
      return {
        resolved: verdict,
        score: verdict ? 1 : 0,
        detail: JSON.stringify({
          tier: 2,
          normalizedAnswer: normalizeAnswer(finalAnswer),
          normalizedGold: normalizeAnswer(meta.gold),
          judgeVerdict: verdict ? 'correct' : 'incorrect',
          citationCoverage: coverage,
        }),
      }
    },
  }
}
