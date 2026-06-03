/**
 * SimpleQA adapter (OpenAI simple-evals; short-form factual QA). Worker artifact
 * = a single free-text final answer string (optionally preceded by a CITATIONS:
 * block). Each item ships a short gold `answer` plus metadata (topic,
 * answer_type, source urls).
 *
 * Judge is the official SimpleQA grader — an LLM classifier that maps
 * (question, gold target, predicted answer) to exactly one of:
 *   A = CORRECT       — fully contains the gold, no contradiction
 *   B = INCORRECT     — contradicts / contains a different factual value
 *   C = NOT_ATTEMPTED — hedged, non-committal, or no value given
 * resolved = (grade == CORRECT). score = 1 for CORRECT else 0. The grade letter
 * (with its label) rides in `detail`; NOT_ATTEMPTED is surfaced distinctly from
 * INCORRECT so the scorecard can separate abstention from error.
 *
 * There is no deterministic tier: SimpleQA's rubric (containment + abstention)
 * is the grader's job by design, so judge() always calls the pinned grader model
 * (temperature 0) and fails loud on unparseable grader output. The final-answer
 * extraction IS deterministic (FINAL ANSWER: sentinel, fail-closed to '').
 *
 * Requires for a live run: the bench `.venv` with `datasets`/`requests` not
 * needed — the test set is a single public CSV fetched over HTTP — plus a
 * grader key (TANGLE_API_KEY). For offline/CI verification set
 * SIMPLEQA_FIXTURES=1 to load the committed fixtures
 * (bench/fixtures/simpleqa.json) — no network.
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
const FIXTURES = join(BENCH_ROOT, 'fixtures', 'simpleqa.json')

const DATASET_URL =
  'https://openaipublic.blob.core.windows.net/simple-evals/simple_qa_test_set.csv'
const FINAL_ANSWER_SENTINEL = 'FINAL ANSWER:'

/** Worker contract appended to every task prompt. Answer extraction keys off the sentinel. */
const WORKER_CONTRACT = [
  '',
  'Research the question using live web sources and answer it with a short, specific factual value.',
  'Cite the sources you used as full URLs, one per line, in a `CITATIONS:` block.',
  `End your response with a single final line: \`${FINAL_ANSWER_SENTINEL} <answer>\``,
  'The answer after the sentinel must be the bare value only (no explanation on that line).',
  'If you do not know the answer, state that you do not know rather than guessing.',
].join('\n')

/**
 * Typed seam for the research worker. The benchmark adapter scores a plain
 * `string` artifact (the BenchmarkAdapter contract); the loop worker decodes its
 * agent runs into a {@link ResearchAnswer} and serializes `finalAnswer` (+ an
 * optional `CITATIONS:` block) into that string before judging.
 */
export interface ResearchTask {
  id: string
  question: string
  /** Gold short answer — the grader's target. */
  gold: string
  /** Source URLs cited by the dataset for this item — SOFT provenance signal, never a hard gate. */
  goldSources: string[]
  /** SimpleQA topic, e.g. 'Politics' — slices the scorecard by domain. */
  topic: string
  /** SimpleQA answer_type, e.g. 'Person' | 'Date' | 'Number' | 'Place'. */
  answerType: string
}

export interface ResearchAnswer {
  finalAnswer: string
  citations: string[]
}

/** Normalized fixture/loader row — the single shape both the CSV loader and fixtures emit. */
interface SimpleQaRow {
  problem: string
  answer: string
  topic: string
  answer_type: string
  urls: string[]
}

interface SimpleQaMeta {
  gold: string
  goldSources: string[]
  topic: string
  answerType: string
  question: string
}

/** The three official SimpleQA grades. */
type Grade = 'CORRECT' | 'INCORRECT' | 'NOT_ATTEMPTED'

/** Run the bench venv python with a script; return stdout (throws on nonzero). */
async function py(script: string, args: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync(PY, ['-c', script, ...args], {
    maxBuffer: 1024 * 1024 * 256,
  })
  return stdout
}

/**
 * Parse the worker artifact into the final answer string.
 * Order: the `FINAL ANSWER:` sentinel first (deterministic-extraction discipline);
 * fall back to the last non-empty line. Returns '' when nothing is parseable
 * (fail-closed — never guess); judge() grades '' as NOT_ATTEMPTED.
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

/** Extract every bare URL in the artifact (CITATIONS: block + inline). SOFT provenance signal. */
export function parseCitations(artifact: string): string[] {
  const urls = new Set<string>()
  for (const m of artifact.matchAll(/https?:\/\/[^\s)<>"']+/g)) {
    urls.add(m[0].replace(/[.,;]+$/, ''))
  }
  return [...urls]
}

/**
 * The official SimpleQA grader prompt (faithful paraphrase of OpenAI's
 * simple-evals GRADER_TEMPLATE). Classifies the predicted answer against the
 * gold target into A=CORRECT / B=INCORRECT / C=NOT_ATTEMPTED. The predicted
 * answer must fully contain the gold value with no contradicting statement;
 * hedged or non-committal answers are NOT_ATTEMPTED.
 */
const GRADER_PROMPT = (question: string, gold: string, predicted: string): string =>
  [
    'Your job is to grade a predicted answer to a factual question against the single gold target answer.',
    'Grade the prediction into exactly one of three categories: CORRECT, INCORRECT, or NOT_ATTEMPTED.',
    'First, follow these grading rules carefully.',
    '',
    'CORRECT:',
    '  The predicted answer fully contains the gold target without contradicting it.',
    '  Predictions with more detail than the gold are still CORRECT, as long as no part contradicts the gold.',
    '  Hedging that still commits to the gold value (e.g. "I think it is X" where X is the gold) is CORRECT.',
    '  Minor formatting, capitalization, ordering, or obvious-typo differences do not matter.',
    '  For numeric/date targets, the prediction is CORRECT only if it matches the gold to the precision the gold specifies.',
    '',
    'INCORRECT:',
    '  The predicted answer contradicts the gold target in any way, even if the contradiction is hedged.',
    '  A prediction that states a different factual value than the gold is INCORRECT.',
    '',
    'NOT_ATTEMPTED:',
    '  The gold target is neither fully given nor contradicted: the prediction declines to answer, says it does not know,',
    '  asks for clarification, or gives a non-committal, vague, or empty response that commits to no specific value.',
    '',
    'Also note the following rules:',
    '  Do not punish a prediction for omitting information that would not change whether the gold target is contained.',
    '  Grade ONLY whether the gold value is present and uncontradicted — not the overall quality of the response.',
    '',
    `Question: ${question}`,
    `Gold target: ${gold}`,
    `Predicted answer: ${predicted}`,
    '',
    'Respond with ONLY a fenced JSON block and nothing else:',
    '```json',
    '{"grade": "CORRECT" | "INCORRECT" | "NOT_ATTEMPTED"}',
    '```',
  ].join('\n')

interface GraderRouter {
  baseUrl: string
  key: string
  model: string
}

function graderRouter(): GraderRouter {
  const key = process.env.TANGLE_API_KEY
  if (!key) throw new Error('TANGLE_API_KEY is required for the SimpleQA grader (set the Tangle API key)')
  const model = process.env.JUDGE_MODEL ?? 'gpt-5'
  const baseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  return { baseUrl, key, model }
}

/** Call the official grader. Pinned model, temperature 0; fail loud on unparseable output. */
async function gradeAnswer(
  question: string,
  gold: string,
  predicted: string,
  router: GraderRouter,
): Promise<Grade> {
  const res = await fetch(`${router.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${router.key}` },
    body: JSON.stringify({
      model: router.model,
      temperature: 0,
      messages: [{ role: 'user', content: GRADER_PROMPT(question, gold, predicted) }],
    }),
  })
  if (!res.ok) {
    throw new Error(`SimpleQA grader HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(`SimpleQA grader returned no message content: ${JSON.stringify(body).slice(0, 300)}`)
  }
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fenced ? fenced[1] : content)?.trim() ?? ''
  let parsed: { grade?: unknown }
  try {
    parsed = JSON.parse(raw) as { grade?: unknown }
  } catch {
    throw new Error(`SimpleQA grader produced unparseable output (no JSON grade): ${content.slice(0, 300)}`)
  }
  if (parsed.grade === 'CORRECT' || parsed.grade === 'INCORRECT' || parsed.grade === 'NOT_ATTEMPTED') {
    return parsed.grade
  }
  throw new Error(
    `SimpleQA grader grade not in {CORRECT,INCORRECT,NOT_ATTEMPTED}: ${JSON.stringify(parsed).slice(0, 200)}`,
  )
}

function rowToTask(row: SimpleQaRow, index: number): BenchTask {
  const meta: SimpleQaMeta = {
    gold: row.answer,
    goldSources: row.urls,
    topic: row.topic,
    answerType: row.answer_type,
    question: row.problem,
  }
  return {
    id: `simpleqa-${index}`,
    split: 'test',
    prompt: row.problem + WORKER_CONTRACT,
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): SimpleQaMeta {
  const md = task.metadata
  if (!md || typeof md.gold !== 'string' || typeof md.question !== 'string') {
    throw new Error(`SimpleQA task ${task.id} missing metadata.gold/question — loadTasks did not populate it`)
  }
  return md as unknown as SimpleQaMeta
}

function selectTasks(tasks: BenchTask[], opts: LoadOptions): BenchTask[] {
  if (opts.ids) {
    const want = new Set(opts.ids)
    return tasks.filter((t) => want.has(t.id))
  }
  if (opts.limit !== undefined) return tasks.slice(0, opts.limit)
  return tasks
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as SimpleQaRow[]
  console.warn(`[simpleqa] SIMPLEQA_FIXTURES=1 — loading ${rows.length} committed fixtures (no network)`)
  return selectTasks(rows.map(rowToTask), opts)
}

/**
 * Load the live test set: fetch the public CSV via the bench venv python, parse
 * with `csv` (handles quoted/embedded-comma fields) and `ast.literal_eval` for
 * the python-repr `metadata` dict. Emits the same normalized SimpleQaRow shape
 * the fixtures use, so loadTasks/judge share one parse path.
 */
async function loadLive(opts: LoadOptions): Promise<BenchTask[]> {
  const script = `
import csv, ast, json, io, sys
from urllib.request import urlopen
with urlopen(${JSON.stringify(DATASET_URL)}, timeout=120) as resp:
    text = resp.read().decode('utf-8')
rows = list(csv.DictReader(io.StringIO(text)))
out = []
for r in rows:
    meta = ast.literal_eval(r['metadata']) if r.get('metadata') else {}
    out.append({
        'problem': r.get('problem', ''),
        'answer': r.get('answer', ''),
        'topic': str(meta.get('topic', '')),
        'answer_type': str(meta.get('answer_type', '')),
        'urls': list(meta.get('urls', [])),
    })
print(json.dumps(out))
`
  const stdout = await py(script)
  const rows = JSON.parse(stdout) as SimpleQaRow[]
  return selectTasks(rows.map(rowToTask), opts)
}

export function createSimpleQaAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.SIMPLEQA_FIXTURES === '1'

  return {
    name: 'simpleqa',

    async preflight() {
      // The grader router must be configured in both modes — SimpleQA's score is
      // defined by the grader, so a run without it is meaningless.
      graderRouter()
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8').catch((err) => {
          throw new Error(
            `SIMPLEQA_FIXTURES=1 but ${FIXTURES} unreadable: ${err instanceof Error ? err.message : err}`,
          )
        })
        return
      }
      try {
        await py(
          `from urllib.request import urlopen
with urlopen(${JSON.stringify(DATASET_URL)}, timeout=120) as resp:
    head = resp.read(64).decode('utf-8', 'replace')
assert head.startswith('metadata,problem,answer'), 'unexpected CSV header: ' + head[:40]
print('ok')`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `simpleqa preflight failed: ${msg}\n` +
            `Fix: (1) ensure the bench venv exists (python3 -m venv bench/.venv) ; ` +
            `(2) ensure network access to ${DATASET_URL} ; ` +
            `or set SIMPLEQA_FIXTURES=1 to run against the committed fixtures offline.`,
        )
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      return loadLive(opts)
    },

    async goldArtifact(task: BenchTask) {
      // Gold artifact = the worker-contract serialization of the gold answer, so
      // verify-judge proves gold→CORRECT through the SAME parse path the real
      // artifact takes.
      const meta = readMeta(task)
      return `${FINAL_ANSWER_SENTINEL} ${meta.gold}`
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const finalAnswer = parseFinalAnswer(artifact)
      const citations = parseCitations(artifact)

      if (finalAnswer.length === 0) {
        // No parseable value committed — NOT_ATTEMPTED by construction, no grader call.
        return {
          resolved: false,
          score: 0,
          detail: JSON.stringify({
            grade: 'NOT_ATTEMPTED',
            gradeLetter: 'C',
            reason: 'no parseable answer',
            gold: meta.gold,
            topic: meta.topic,
            answerType: meta.answerType,
            citationCount: citations.length,
          }),
        }
      }

      const grade = await gradeAnswer(meta.question, meta.gold, finalAnswer, graderRouter())
      const gradeLetter = grade === 'CORRECT' ? 'A' : grade === 'INCORRECT' ? 'B' : 'C'
      const resolved = grade === 'CORRECT'
      return {
        resolved,
        score: resolved ? 1 : 0,
        detail: JSON.stringify({
          grade,
          gradeLetter,
          gold: meta.gold,
          predicted: finalAnswer,
          topic: meta.topic,
          answerType: meta.answerType,
          citationCount: citations.length,
        }),
      }
    },
  }
}
