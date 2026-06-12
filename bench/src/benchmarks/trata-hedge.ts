/**
 * Trata Hedge-Bench adapter (Trata-Inc/trata-hedge-bench). 102 financial
 * analysis tasks across 6 domains (private equity, managed care, industrials,
 * vertical SaaS, REITs, insurance). Each task bundles real earnings-call
 * transcripts, financial statements, press releases, and SEC filings under
 * `environment/data/`; the agent must produce a grounded analysis citing those
 * files.
 *
 * Harbor architecture: the original benchmark runs each task in a Docker
 * container with file-read tools. This adapter skips Harbor and embeds the data
 * files directly in the worker prompt so any router backend can score it. Large
 * files (> 30 KB) are truncated to fit within model context limits. The judge
 * reads the actual files from disk for citation verification.
 *
 * Judge: a 3-stage LLM cascade faithful to grade.py —
 *   Task 1: hallucination check (cited-file context + agent answer)
 *   Task 2: per-move coverage check (ground truth + agent answer + flagged claims)
 *   Task 3: synthesis check (ground truth + agent answer)
 * Score 0–4: themes_covered == num_themes && synthesis → 4, all themes → 3,
 * ≥2 themes → 2, ≥1 theme → 1, else → 0. Normalized to 0..1 for BenchScore;
 * resolved = score 4 (sparse reward).
 *
 * Requires TANGLE_API_KEY and TRATA_BENCH_ROOT=/tmp/trata-hedge-bench.
 * Clone: git clone --depth 1 https://github.com/Trata-Inc/trata-hedge-bench /tmp/trata-hedge-bench
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const DEFAULT_BENCH_ROOT = '/tmp/trata-hedge-bench'
const MAX_FILE_BYTES = 8_000
// Sandbox API rejects messages > 100K chars; instruction + suffix adds ~500 chars overhead.
const MAX_DATA_CHARS = 85_000
const WORKER_SUFFIX = [
  '',
  'The data files above are your only source. Cite each claim with the filename that supports it.',
  'Write your complete analysis to the text block that starts with "ANALYSIS:" on a line by itself.',
  'Take a clear position on the topic. Every factual claim must name the file it comes from.',
].join('\n')

// Judge model: Gemini 2.5 Pro via router (matches gemini-3.1-pro-preview tier used by grade.py).
const JUDGE_MODEL = 'gemini-2.5-pro'

interface TrataTaskMeta {
  taskDir: string
  taskId: string
  dataDir: string
  groundTruth: string
  gradingTask1: string
  gradingTask2: string
  gradingTask3: string
  /** [(label, n_moves)] in rubric order. */
  themeMoveCounts: Array<{ label: string; nMoves: number }>
}

// ── file reading helpers ──────────────────────────────────────────────────────

function readText(p: string, maxBytes = MAX_FILE_BYTES): string {
  try {
    const buf = readFileSync(p)
    if (buf.length <= maxBytes) return buf.toString('utf8')
    return buf.subarray(0, maxBytes).toString('utf8') + `\n[… truncated at ${maxBytes} bytes …]`
  } catch {
    return `[unreadable: ${p}]`
  }
}

function listFilesRec(dir: string): string[] {
  const out: string[] = []
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      try {
        if (statSync(full).isDirectory()) out.push(...listFilesRec(full))
        else out.push(full)
      } catch {
        // skip unreadable entries
      }
    }
  } catch {
    // dir absent
  }
  return out.sort()
}

function buildDataBlock(dataDir: string): string {
  const files = listFilesRec(dataDir)
  if (files.length === 0) return '(no data files found)'
  // Prioritise: company profiles → earnings calls → primary-ticker financials →
  // sec filings → press releases → peers. Stop once total chars hit MAX_DATA_CHARS.
  const priority = (f: string) => {
    if (f.includes('company_profiles')) return 0
    if (f.includes('earnings_call')) return 1
    if (/financials\/(income|cash_flow|balance)/.test(f) && !/bam_|bx_|kkr_|ares_|cg_|owl_|fsk_|cat_|de_|tdg_|car_/.test(f)) return 2
    if (f.includes('sec_filings')) return 3
    if (f.includes('investor_pres')) return 4
    if (f.includes('press_release')) return 5
    return 6
  }
  const sorted = [...files].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b))
  const blocks: string[] = []
  let total = 0
  for (const f of sorted) {
    const rel = f.slice(dataDir.length + 1)
    const content = readText(f)
    const chunk = `\n=== FILE: data/${rel} ===\n${content}`
    if (total + chunk.length > MAX_DATA_CHARS) {
      blocks.push(`\n[… ${sorted.length - blocks.length} more files omitted to stay within context limit …]`)
      break
    }
    blocks.push(chunk)
    total += chunk.length
  }
  return blocks.join('')
}

function buildCitedDataBlock(answerText: string, dataDir: string): string {
  const files = listFilesRec(dataDir)
  const cited: string[] = []
  for (const f of files) {
    const rel = f.slice(dataDir.length + 1)
    const name = rel.split('/').pop() ?? ''
    if (answerText.includes(rel) || answerText.includes(name)) cited.push(f)
  }
  if (cited.length === 0) {
    return '(The agent did not cite any data files, or no cited file could be located.)'
  }
  const blocks: string[] = []
  for (const f of cited) {
    const rel = f.slice(dataDir.length + 1)
    blocks.push(`\n=== FILE: data/${rel} ===\n${readText(f)}`)
  }
  return blocks.join('')
}

// ── ground-truth parser ───────────────────────────────────────────────────────

function parseThemeMoveCounts(groundTruth: string): Array<{ label: string; nMoves: number }> {
  const lines = groundTruth.split('\n')
  const themeStarts = lines.reduce<number[]>((acc, l, i) => {
    if (/^\d+\./.test(l.trim())) acc.push(i)
    return acc
  }, [])
  return themeStarts.map((start, k) => {
    const end = k + 1 < themeStarts.length ? themeStarts[k + 1] : lines.length
    const block = lines.slice(start, end).join('\n')
    const label = lines[start].replace(/^\d+\.\s*/, '').trim()
    const nMoves = (block.match(/^\s*\[[a-z]\]\s+/gm) ?? []).length
    return { label, nMoves }
  })
}

function coverageThreshold(nMoves: number): number {
  return Math.max(1, Math.min(nMoves - 1, 3))
}

// ── router judge calls ────────────────────────────────────────────────────────

interface JudgeRouter {
  baseUrl: string
  key: string
  model: string
}

function judgeRouter(): JudgeRouter {
  const key = process.env.TANGLE_API_KEY
  if (!key) throw new Error('TANGLE_API_KEY is required for the Trata hedge-bench judge')
  const model = process.env.JUDGE_MODEL ?? JUDGE_MODEL
  const baseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  return { baseUrl, key, model }
}

function parseJsonFallback(raw: string): unknown {
  let s = raw.trim()
  if (s.startsWith('```')) s = s.split('\n').slice(1).join('\n')
  if (s.endsWith('```')) s = s.slice(0, s.lastIndexOf('```'))
  s = s.replace(/,(\s*[}\]])/g, '$1').trim()
  try {
    return JSON.parse(s)
  } catch {
    try {
      const m = s.match(/\{[\s\S]*\}/)
      if (m) return JSON.parse(m[0])
    } catch {
      // fallthrough
    }
  }
  return null
}

async function callJudge(router: JudgeRouter, prompt: string, maxAttempts = 2): Promise<unknown> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${router.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${router.key}` },
      body: JSON.stringify({
        model: router.model,
        temperature: 0,
        max_tokens: 16384,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      if (i < maxAttempts - 1) continue
      throw new Error(`Trata judge HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string') continue
    const parsed = parseJsonFallback(content)
    if (parsed !== null) return parsed
  }
  return null
}

interface Task1Result {
  hallucinations_detected?: boolean | string
  unverifiable_claims?: Array<{ claim: string; cited_file?: string; issue?: string; evidence_check?: string }>
}

interface Task2ThemeResult {
  label?: string
  moves_hit?: string[]
  moves_missed?: string[]
  moves_tainted?: string[]
  move_reasoning?: Record<string, string>
}

interface Task2Result {
  themes?: Task2ThemeResult[]
}

interface Task3Result {
  synthesis_found?: string | null
}

async function task1HallucinationCheck(
  meta: TrataTaskMeta,
  answer: string,
  router: JudgeRouter,
): Promise<Task1Result> {
  const citedBlock = buildCitedDataBlock(answer, meta.dataDir)
  const dataContext =
    'The block below contains the contents of the data files the agent cited in their answer. ' +
    'Treat this as the ground truth for factual verification.\n\n' +
    `<cited_data>\n${citedBlock}\n</cited_data>`
  const prompt = meta.gradingTask1
    .replace('{data_context}', dataContext)
    .replace('{agent_answer}', answer)
  const result = await callJudge(router, prompt)
  return (result as Task1Result) ?? { hallucinations_detected: false, unverifiable_claims: [] }
}

async function task2PerMoveCheck(
  meta: TrataTaskMeta,
  answer: string,
  flaggedClaims: Task1Result['unverifiable_claims'],
  router: JudgeRouter,
): Promise<Task2Result> {
  const claimsBlock =
    flaggedClaims && flaggedClaims.length > 0
      ? JSON.stringify(flaggedClaims, null, 2)
      : '(No claims were flagged as hallucinations.)'
  const prompt = meta.gradingTask2
    .replace('{ground_truth}', meta.groundTruth)
    .replace('{agent_answer}', answer)
    .replace('{flagged_claims_block}', claimsBlock)
    .replace('{num_themes}', String(meta.themeMoveCounts.length))
  const result = await callJudge(router, prompt)
  return (result as Task2Result) ?? { themes: [] }
}

async function task3SynthesisCheck(
  meta: TrataTaskMeta,
  answer: string,
  router: JudgeRouter,
): Promise<Task3Result> {
  const prompt = meta.gradingTask3
    .replace('{ground_truth}', meta.groundTruth)
    .replace('{agent_answer}', answer)
  const result = await callJudge(router, prompt)
  return (result as Task3Result) ?? { synthesis_found: null }
}

async function runTriataJudge(meta: TrataTaskMeta, answer: string, router: JudgeRouter): Promise<BenchScore> {
  if (!answer.trim()) {
    return { resolved: false, score: 0, detail: JSON.stringify({ error: 'empty answer' }) }
  }

  // Stage 1: hallucination check (serial — feeds into stage 2).
  const t1 = await task1HallucinationCheck(meta, answer, router)
  const flaggedClaims = t1.unverifiable_claims ?? []

  // Stages 2 + 3 in parallel.
  const [t2, t3] = await Promise.all([
    task2PerMoveCheck(meta, answer, flaggedClaims, router),
    task3SynthesisCheck(meta, answer, router),
  ])

  const judgeThemes = t2.themes ?? []
  const themesHit: string[] = []
  const themesMissed: string[] = []

  for (let i = 0; i < meta.themeMoveCounts.length; i++) {
    const { label, nMoves } = meta.themeMoveCounts[i]
    const judge = judgeThemes[i] ?? {}
    const movesHit = (judge.moves_hit ?? []).map((m: string) => m.replace(/[\[\]]/g, ''))
    const tainted = new Set((judge.moves_tainted ?? []).map((m: string) => m.replace(/[\[\]]/g, '')))
    const validHit = movesHit.filter((m: string) => !tainted.has(m))
    const threshold = coverageThreshold(nMoves)
    if (validHit.length >= threshold) themesHit.push(label)
    else themesMissed.push(label)
  }

  const numThemes = meta.themeMoveCounts.length
  const synth = t3.synthesis_found
  const hasSynthesis = typeof synth === 'string' && synth.length > 0 && synth !== 'null'

  let rawScore: number
  if (numThemes === 0) rawScore = 0
  else if (themesHit.length === numThemes && hasSynthesis) rawScore = 4
  else if (themesHit.length === numThemes) rawScore = 3
  else if (themesHit.length >= 2) rawScore = 2
  else if (themesHit.length >= 1) rawScore = 1
  else rawScore = 0

  const hallRaw = t1.hallucinations_detected
  const hallucinations = hallRaw === true || hallRaw === 'true'

  return {
    resolved: rawScore === 4,
    score: numThemes > 0 ? rawScore / 4 : 0,
    detail: JSON.stringify({
      rawScore,
      themesHit,
      themesMissed,
      hallucinations,
      unverifiableClaims: flaggedClaims.length,
      synthesis: synth ?? null,
      judgeModel: router.model,
    }),
  }
}

// ── task loading ──────────────────────────────────────────────────────────────

function benchRoot(): string {
  return process.env.TRATA_BENCH_ROOT ?? DEFAULT_BENCH_ROOT
}

function loadTask(taskId: string): { task: BenchTask; meta: TrataTaskMeta } {
  const taskDir = join(benchRoot(), 'environments', taskId)
  const dataDir = join(taskDir, 'environment', 'data')
  const testsDir = join(taskDir, 'tests')

  const instruction = readText(join(taskDir, 'instruction.md'), Infinity)
  const dataBlock = buildDataBlock(dataDir)
  const groundTruth = readText(join(testsDir, 'ground_truth.txt'), Infinity)
  const gradingTask1 = readText(join(testsDir, 'grading_prompt_task1.md'), Infinity)
  const gradingTask2 = readText(join(testsDir, 'grading_prompt_task2.md'), Infinity)
  const gradingTask3 = readText(join(testsDir, 'grading_prompt_task3.md'), Infinity)

  const themeMoveCounts = parseThemeMoveCounts(groundTruth)

  // Rewrite the instruction so the agent knows data is inline (no /app/data/ FS).
  const prompt = [
    instruction
      .replace(
        "You are a financial analyst with access to the data in `/app/data/`.",
        'You are a financial analyst. The relevant financial data files are provided inline below.',
      )
      .replace(/Write your full analysis to `\/app\/answer\.txt`\.?/, 'Write your full analysis below.')
      .replace(/`\/app\/data\/`/g, 'the data files below'),
    '',
    '## Data files (inline)',
    dataBlock,
    WORKER_SUFFIX,
  ].join('\n')

  const meta: TrataTaskMeta = {
    taskDir,
    taskId,
    dataDir,
    groundTruth,
    gradingTask1,
    gradingTask2,
    gradingTask3,
    themeMoveCounts,
  }

  // Store meta in the BenchTask so the judge can access it without re-reading.
  const task: BenchTask = {
    id: taskId,
    prompt,
    metadata: meta as unknown as Record<string, unknown>,
  }

  return { task, meta }
}

function readMeta(task: BenchTask): TrataTaskMeta {
  const md = task.metadata
  if (!md || typeof md.taskDir !== 'string' || typeof md.groundTruth !== 'string') {
    throw new Error(`Trata task ${task.id} missing judge metadata — was it loaded by this adapter?`)
  }
  return md as unknown as TrataTaskMeta
}

/** List all task ids from the environments directory. */
function listTaskIds(root: string): string[] {
  try {
    return readdirSync(join(root, 'environments'))
      .filter((name) => {
        try {
          return statSync(join(root, 'environments', name)).isDirectory()
        } catch {
          return false
        }
      })
      .sort()
  } catch (err) {
    throw new Error(
      `Trata benchmark environments not found at ${join(root, 'environments')}: ` +
        `${err instanceof Error ? err.message : err}.\n` +
        `Clone the repo: git clone --depth 1 https://github.com/Trata-Inc/trata-hedge-bench ${root}`,
    )
  }
}

// ── extract agent analysis from artifact ─────────────────────────────────────

function extractAnalysis(artifact: string): string {
  // Model may write "ANALYSIS:" as its very first token (no leading newline) or
  // after some preamble. Both are valid; fail-closed on absence.
  if (artifact.startsWith('ANALYSIS:')) return artifact.slice('ANALYSIS:'.length).trim()
  const marker = artifact.indexOf('\nANALYSIS:')
  if (marker !== -1) return artifact.slice(marker + '\nANALYSIS:'.length).trim()
  return ''
}

// ── adapter factory ───────────────────────────────────────────────────────────

export function createTrataHedgeAdapter(): BenchmarkAdapter {
  return {
    name: 'trata-hedge',

    async preflight() {
      const root = benchRoot()
      const envDir = join(root, 'environments')
      try {
        const stat = statSync(envDir)
        if (!stat.isDirectory()) throw new Error('not a directory')
      } catch {
        throw new Error(
          `Trata hedge-bench not found at ${envDir}.\n` +
            `Clone: git clone --depth 1 https://github.com/Trata-Inc/trata-hedge-bench ${root}`,
        )
      }
      // Validate judge router connectivity.
      judgeRouter()
      const ids = listTaskIds(root)
      if (ids.length === 0) throw new Error(`No task directories found under ${envDir}`)
      console.warn(
        `[trata-hedge] ${ids.length} tasks loaded from ${root}. ` +
          `Worker model reads embedded data inline (Harbor/Docker not required). ` +
          `Judge uses ${process.env.JUDGE_MODEL ?? JUDGE_MODEL} via Tangle router.`,
      )
    },

    async loadTasks(opts: LoadOptions = {}): Promise<BenchTask[]> {
      const root = benchRoot()
      let ids = listTaskIds(root)
      if (opts.ids) {
        const want = new Set(opts.ids)
        ids = ids.filter((id) => want.has(id))
      } else if (opts.limit !== undefined) {
        ids = ids.slice(0, opts.limit)
      }
      return ids.map((id) => loadTask(id).task)
    },

    async goldArtifact(_task: BenchTask): Promise<string | undefined> {
      // No single gold answer: the score comes from rubric theme coverage, not
      // string-match against a reference response. Return undefined — the bench
      // harness will skip judge self-verification for this adapter.
      return undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      const answer = extractAnalysis(artifact)
      return runTriataJudge(meta, answer, judgeRouter())
    },
  }
}
