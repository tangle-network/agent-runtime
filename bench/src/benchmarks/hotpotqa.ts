/**
 * HotpotQA adapter (hotpotqa/hotpot_qa, config 'distractor', split 'validation').
 * Multi-hop factoid QA. Worker artifact = a single free-text final answer string.
 *
 * Judge is the official HotpotQA / SQuAD-style metric, FULLY DETERMINISTIC — no
 * LLM. Both the predicted final answer and the gold are normalized (lowercase,
 * strip articles a/an/the, strip punctuation, collapse whitespace), then scored
 * by exact-match (EM) and token-level F1. resolved = EM OR F1 >= HOTPOTQA_F1_PASS
 * (default 0.6); score = the F1 (0..1). detail carries em + f1. This gives the
 * suite a judge that needs no model tokens at all.
 *
 * metadata carries the gold answer + supporting_facts (the title/sent_id pairs of
 * the gold supporting sentences) — a SOFT retrieval signal for the loop's critic,
 * never part of the score.
 *
 * Requires for a live run: the bench `.venv` with `datasets` installed + network
 * to Hugging Face. For offline/CI verification set HOTPOTQA_FIXTURES=1 to load the
 * committed fixtures (bench/fixtures/hotpotqa.json) — no HF download.
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const execFileAsync = promisify(execFile)
const BENCH_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PY = join(BENCH_ROOT, '.venv', 'bin', 'python')
const FIXTURES = join(BENCH_ROOT, 'fixtures', 'hotpotqa.json')

const DATASET = 'hotpotqa/hotpot_qa'
const DATASET_CONFIG = 'distractor'
const DATASET_SPLIT = 'validation'
const FINAL_ANSWER_SENTINEL = 'FINAL ANSWER:'

/** Default F1 pass threshold; HotpotQA's leaderboard reports EM and F1 separately. */
const DEFAULT_F1_PASS = 0.6

/** Worker contract appended to every task prompt. The judge keys off the sentinel. */
const WORKER_CONTRACT = [
  '',
  'Answer this multi-hop question. Reason across the facts you need, then commit to a single short answer.',
  `End your response with a single final line: \`${FINAL_ANSWER_SENTINEL} <answer>\``,
  'The answer after the sentinel must be the bare value only (no explanation on that line).',
].join('\n')

interface SupportingFacts {
  title: string[]
  sent_id: number[]
}

interface HotpotRow {
  id: string
  question: string
  answer: string
  type: string
  level: string
  supporting_facts: SupportingFacts
}

interface HotpotMeta {
  gold: string
  supportingFacts: SupportingFacts
  type: string
  level: string
  rawQuestion: string
}

/** Run the bench venv python with a script on stdin; return stdout (throws on nonzero). */
async function py(script: string, args: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync(PY, ['-c', script, ...args], {
    maxBuffer: 1024 * 1024 * 256,
  })
  return stdout
}

const ARTICLES = new Set(['a', 'an', 'the'])

/**
 * The official HotpotQA / SQuAD `normalize_answer`: lowercase, strip punctuation,
 * drop articles (a/an/the), collapse whitespace. Token comparisons run on the
 * output of this exactly as the published evaluator does.
 */
export function normalizeAnswer(input: string): string {
  const lower = input.toLowerCase()
  // strip punctuation: keep word chars + whitespace only
  const noPunct = lower.replace(/[^\w\s]/g, ' ')
  const tokens = noPunct
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !ARTICLES.has(t))
  return tokens.join(' ').trim()
}

/** Normalized-token list (the F1 bag-of-tokens unit). */
function answerTokens(input: string): string[] {
  const n = normalizeAnswer(input)
  return n.length === 0 ? [] : n.split(' ')
}

/** Exact match on the normalized strings. */
export function exactMatch(prediction: string, gold: string): boolean {
  return normalizeAnswer(prediction) === normalizeAnswer(gold)
}

/**
 * Token-level F1, the SQuAD/HotpotQA definition. Multiset (bag) intersection of
 * normalized tokens. Mirrors the published evaluator's special-case handling of
 * yes/no/noanswer and empty bags: if either side is empty, F1 is 1 only when both
 * are empty, else 0.
 */
export function tokenF1(prediction: string, gold: string): number {
  const predTokens = answerTokens(prediction)
  const goldTokens = answerTokens(gold)
  if (predTokens.length === 0 || goldTokens.length === 0) {
    return predTokens.length === 0 && goldTokens.length === 0 ? 1 : 0
  }
  const goldCounts = new Map<string, number>()
  for (const t of goldTokens) goldCounts.set(t, (goldCounts.get(t) ?? 0) + 1)
  let common = 0
  for (const t of predTokens) {
    const left = goldCounts.get(t)
    if (left !== undefined && left > 0) {
      common += 1
      goldCounts.set(t, left - 1)
    }
  }
  if (common === 0) return 0
  const precision = common / predTokens.length
  const recall = common / goldTokens.length
  return (2 * precision * recall) / (precision + recall)
}

/** Read the configured F1 pass threshold; fail loud on a malformed override. */
function f1PassThreshold(): number {
  const raw = process.env.HOTPOTQA_F1_PASS
  if (raw === undefined || raw.length === 0) return DEFAULT_F1_PASS
  const v = Number(raw)
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(`HOTPOTQA_F1_PASS must be a number in [0,1], got ${JSON.stringify(raw)}`)
  }
  return v
}

/**
 * Parse the worker artifact into the final answer string.
 * Order: the `FINAL ANSWER:` sentinel first (deterministic-extraction discipline);
 * fall back to the trimmed last non-empty line. Returns '' when nothing is
 * parseable (fail-closed — never guess), which judge() counts as resolved=false.
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

function rowToTask(row: HotpotRow): BenchTask {
  const meta: HotpotMeta = {
    gold: row.answer,
    supportingFacts: row.supporting_facts ?? { title: [], sent_id: [] },
    type: row.type ?? '',
    level: row.level ?? '',
    rawQuestion: row.question,
  }
  return {
    id: `hotpotqa-${row.id}`,
    split: DATASET_SPLIT,
    prompt: row.question + WORKER_CONTRACT,
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): HotpotMeta {
  const md = task.metadata
  if (!md || typeof md.gold !== 'string') {
    throw new Error(`HotpotQA task ${task.id} missing metadata.gold — loadTasks did not populate it`)
  }
  return md as unknown as HotpotMeta
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as HotpotRow[]
  console.warn(
    `[hotpotqa] HOTPOTQA_FIXTURES=1 — loading ${rows.length} committed fixtures from ${FIXTURES} (no HF download)`,
  )
  let tasks = rows.map(rowToTask)
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((t) => want.has(t.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  return tasks
}

export function createHotpotqaAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.HOTPOTQA_FIXTURES === '1'
  // Validate the threshold at construction so a malformed env fails before any run.
  f1PassThreshold()

  return {
    name: 'hotpotqa',

    async preflight() {
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8').catch((err) => {
          throw new Error(
            `HOTPOTQA_FIXTURES=1 but ${FIXTURES} unreadable: ${err instanceof Error ? err.message : err}`,
          )
        })
        return
      }
      try {
        await py(
          `from datasets import load_dataset
load_dataset(${JSON.stringify(DATASET)}, ${JSON.stringify(DATASET_CONFIG)}, split=${JSON.stringify(DATASET_SPLIT)})
print('ok')`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `hotpotqa preflight failed: ${msg}\n` +
            `Fix: (1) python3 -m venv bench/.venv && bench/.venv/bin/pip install datasets ; ` +
            `(2) ensure network access to Hugging Face for ${DATASET} (${DATASET_CONFIG}) ; ` +
            `or set HOTPOTQA_FIXTURES=1 to run against the committed fixtures offline.`,
        )
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      const limit = opts.limit ?? 10
      const script = `
import json, sys
from datasets import load_dataset
ds = load_dataset(${JSON.stringify(DATASET)}, ${JSON.stringify(DATASET_CONFIG)}, split=${JSON.stringify(DATASET_SPLIT)})
ids = set(json.loads(sys.argv[1])) if len(sys.argv) > 1 and sys.argv[1] else None
out = []
for r in ds:
    rid = f"hotpotqa-{r['id']}"
    if ids is not None and rid not in ids:
        continue
    sf = r.get('supporting_facts', {}) or {}
    out.append({
        "id": r["id"],
        "question": r.get("question", ""),
        "answer": r.get("answer", ""),
        "type": str(r.get("type", "")),
        "level": str(r.get("level", "")),
        "supporting_facts": {
            "title": list(sf.get("title", [])),
            "sent_id": [int(x) for x in sf.get("sent_id", [])],
        },
    })
    if ids is None and len(out) >= ${limit}:
        break
print(json.dumps(out))
`
      const stdout = await py(script, [opts.ids ? JSON.stringify(opts.ids) : ''])
      const rows = JSON.parse(stdout) as HotpotRow[]
      return rows.map(rowToTask)
    },

    async goldArtifact(task: BenchTask) {
      // Gold artifact = the worker-contract serialization of the gold answer, so
      // verify-judge proves gold→resolved through the SAME parse path the real
      // artifact takes.
      const meta = readMeta(task)
      return `${FINAL_ANSWER_SENTINEL} ${meta.gold}`
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const finalAnswer = parseFinalAnswer(artifact)

      if (finalAnswer.length === 0) {
        // Fail-closed: distinguish prompt-adherence failure from a wrong answer.
        return {
          resolved: false,
          score: 0,
          detail: JSON.stringify({
            reason: 'no parseable answer',
            em: false,
            f1: 0,
            normalizedGold: normalizeAnswer(meta.gold),
          }),
        }
      }

      const em = exactMatch(finalAnswer, meta.gold)
      const f1 = tokenF1(finalAnswer, meta.gold)
      const threshold = f1PassThreshold()
      const resolved = em || f1 >= threshold
      return {
        resolved,
        score: f1,
        detail: JSON.stringify({
          em,
          f1,
          threshold,
          normalizedAnswer: normalizeAnswer(finalAnswer),
          normalizedGold: normalizeAnswer(meta.gold),
          type: meta.type,
          level: meta.level,
          supportingFacts: meta.supportingFacts,
        }),
      }
    },
  }
}
