/**
 * AEC-Bench adapter (TheodoreGalanos/aec-bench, MIT) — closed-form
 * Architecture/Engineering/Construction calculation tasks. Worker artifact = a
 * markdown solution ending in a fenced ```json block with the required numeric
 * fields. Judge = the task's OWN `tests/verify.py`, run with python3: it
 * recomputes ground truth from the embedded engineering formulas, extracts the
 * last JSON block from the artifact, scores each field by math.isclose within a
 * per-field rel_tol, and writes {"reward": mean} + per-field details.json.
 * GRADED / partial-credit, FULLY DETERMINISTIC — no LLM judge.
 *
 * Distinct from the multimodal nomic-ai/aec-bench; this is the deterministic
 * calculation platform. The runnable-instance verify.py only needs python3 (no
 * Docker, no Harbor) for the pure-calc disciplines, so the local gate runs at
 * conc<=2 without a container backend.
 *
 * Requires for a live run: network to raw.githubusercontent.com /
 * api.github.com (the in-repo tasks tree) + a python3 interpreter (the bench
 * venv) to run verify.py. For offline/CI, set AEC_FIXTURES=1 to load the
 * committed fixtures (bench/fixtures/aec-bench.json) — never a silent fallback.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { benchRoot, preflightVenvImports, readJsonReport, runStagedJudge, stageFile, venvPython } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'aec-bench.json')

const REPO = 'TheodoreGalanos/aec-bench'
const RAW = `https://raw.githubusercontent.com/${REPO}/main`
const API = `https://api.github.com/repos/${REPO}/contents`

/** Five disciplines under tasks/. A runnable instance ships tests/verify.py. */
const DISCIPLINES = ['civil', 'electrical', 'ground', 'mechanical', 'structural'] as const

/** Default cap on tasks enumerated per discipline before a `limit` is applied. */
const DEFAULT_LIMIT = 10

interface AecRecord {
  /** Canonical task id `<discipline>/<task>`, e.g. 'electrical/catenary-sag'. */
  id: string
  discipline: string
  /** instruction.md — the self-contained prompt (table + required outputs + JSON schema). */
  instruction: string
  /** task.toml — metadata/difficulty/timeouts (carried for trace context). */
  task_toml: string
  /** tests/verify.py — the deterministic verifier (recomputes GT, scores fields). */
  verify_py: string
  /** tests/fixtures/golden_pass.md — the oracle artifact that scores reward 1.0. */
  golden_pass_md: string
}

interface AecMeta {
  taskId: string
  discipline: string
  taskToml: string
  verifyPy: string
  goldenPassMd: string
}

function recordToTask(rec: AecRecord): BenchTask {
  const meta: AecMeta = {
    taskId: rec.id,
    discipline: rec.discipline,
    taskToml: rec.task_toml,
    verifyPy: rec.verify_py,
    goldenPassMd: rec.golden_pass_md,
  }
  return {
    id: rec.id,
    split: rec.discipline,
    // instruction.md is fully self-contained and already specifies the exact JSON
    // output schema + the "write to /workspace/output.md" contract the verifier
    // keys off — we pass it through verbatim so the verify.py extractor matches.
    prompt: rec.instruction,
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): AecMeta {
  const md = task.metadata
  if (
    !md ||
    typeof md.verifyPy !== 'string' ||
    typeof md.goldenPassMd !== 'string' ||
    typeof md.taskId !== 'string'
  ) {
    throw new Error(`aec-bench task ${task.id} missing verifier metadata — loadTasks did not populate it`)
  }
  return md as unknown as AecMeta
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`aec-bench fetch ${res.status}: ${url}`)
  return res.text()
}

interface GhEntry {
  name: string
  type: 'dir' | 'file'
}

/** List the runnable-instance task dirs under a discipline (those carrying tests/verify.py). */
async function listInstances(discipline: string): Promise<string[]> {
  const res = await fetch(`${API}/tasks/${discipline}`)
  if (!res.ok) throw new Error(`aec-bench list ${res.status}: tasks/${discipline}`)
  const entries = (await res.json()) as GhEntry[]
  return entries.filter((e) => e.type === 'dir').map((e) => `${discipline}/${e.name}`)
}

/**
 * Fetch one task's instruction.md + task.toml + tests/verify.py + golden_pass.md.
 * Returns null when the dir is a SEED (no runnable verify.py) so enumeration can
 * skip it without faking a task.
 */
async function fetchInstance(id: string): Promise<AecRecord | null> {
  const base = `${RAW}/tasks/${id}`
  const verify = await fetch(`${base}/tests/verify.py`)
  if (verify.status === 404) return null
  if (!verify.ok) throw new Error(`aec-bench fetch ${verify.status}: ${id}/tests/verify.py`)
  const [instruction, task_toml, golden_pass_md] = await Promise.all([
    fetchText(`${base}/instruction.md`),
    fetchText(`${base}/task.toml`),
    fetchText(`${base}/tests/fixtures/golden_pass.md`),
  ])
  return {
    id,
    discipline: id.split('/')[0] ?? '',
    instruction,
    task_toml,
    verify_py: await verify.text(),
    golden_pass_md,
  }
}

function selectFixtures(records: AecRecord[], opts: LoadOptions): BenchTask[] {
  let tasks = records.map(recordToTask)
  if (opts.split) tasks = tasks.filter((t) => t.split === opts.split)
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((t) => want.has(t.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  return tasks
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const records = JSON.parse(await readFile(FIXTURES, 'utf8')) as AecRecord[]
  console.warn(
    `[aec-bench] AEC_FIXTURES=1 — loading ${records.length} committed fixtures from ${FIXTURES} (no GitHub fetch)`,
  )
  return selectFixtures(records, opts)
}

/** Enumerate live tasks: explicit ids, an explicit split's dir, or a balanced
 *  cross-discipline slice. Skips seed dirs (no verify.py) — never fabricates. */
async function loadLive(opts: LoadOptions): Promise<BenchTask[]> {
  if (opts.ids) {
    const records: AecRecord[] = []
    for (const id of opts.ids) {
      const rec = await fetchInstance(id)
      if (!rec) throw new Error(`aec-bench: ${id} has no tests/verify.py (seed-only or wrong id)`)
      records.push(rec)
    }
    return records.map(recordToTask)
  }
  const disciplines = opts.split ? [opts.split] : DISCIPLINES
  const limit = opts.limit ?? DEFAULT_LIMIT
  const records: AecRecord[] = []
  for (const d of disciplines) {
    const ids = await listInstances(d)
    for (const id of ids) {
      if (records.length >= limit) break
      const rec = await fetchInstance(id)
      if (rec) records.push(rec)
    }
    if (records.length >= limit) break
  }
  if (records.length === 0) {
    throw new Error(
      `aec-bench loadTasks found no runnable instances for ${JSON.stringify(opts)} ` +
        `(no tests/verify.py under the requested discipline). Set AEC_FIXTURES=1 to run offline.`,
    )
  }
  return records.map(recordToTask)
}

/**
 * Run the task's own verify.py with python3 over the artifact via the shared
 * staged-judge spine (mkdtemp → stage → spawn → parseReport → cleanup). verify.py
 * writes {"reward": mean} to --output and per-field details.json as a sibling. We
 * read both: reward → graded score; details → sub-scores for the trace-analyst.
 * Fail loud if the verifier never wrote a numeric reward (a crashed verifier is
 * NOT a silent 0 — verify.py's own except-trap writes reward 0.0, so an absent /
 * non-numeric reward.json is a real bug, surfaced by readJsonReport).
 */
async function runVerifier(meta: AecMeta, artifact: string): Promise<BenchScore> {
  return runStagedJudge({
    tmpPrefix: 'aecbench-',
    timeoutMs: 120_000,
    async stage(dir) {
      await Promise.all([
        stageFile(join(dir, 'output.md'), artifact),
        stageFile(join(dir, 'verify.py'), meta.verifyPy),
      ])
    },
    bin: venvPython,
    argv: (dir) => [join(dir, 'verify.py'), '--input', join(dir, 'output.md'), '--output', join(dir, 'reward.json')],
    async parseReport(dir) {
      const report = await readJsonReport<{ reward?: number }>(join(dir, 'reward.json'))
      const reward = report.reward
      if (typeof reward !== 'number' || !Number.isFinite(reward)) {
        throw new Error(`aec-bench verify.py wrote no numeric reward for ${meta.taskId}: ${JSON.stringify(report)}`)
      }
      const details = await readFile(join(dir, 'details.json'), 'utf8').then(
        (s) => JSON.parse(s) as Record<string, number>,
        () => ({}),
      )
      const score = Math.max(0, Math.min(1, reward))
      return {
        // resolved = full credit (all fields within tolerance), matching aec-bench's perfect_rate.
        resolved: score >= 1,
        score,
        detail: JSON.stringify({ taskId: meta.taskId, discipline: meta.discipline, reward, fields: details }),
      }
    },
  })
}

export function createAecBenchAdapter(): BenchmarkAdapter {
  const fixturesMode = process.env.AEC_FIXTURES === '1'

  return {
    name: 'aec-bench',

    async preflight() {
      // The verifier is python3 over the stdlib (math/json/re) — no pip install.
      // Reuse the shared import-probe so the bench venv interpreter is proven to
      // exist + run before any judge spawns verify.py.
      await preflightVenvImports({
        modules: ['math', 'json', 're'],
        requireDocker: false,
        fix: 'Fix: python3 -m venv bench/.venv (verify.py only needs the stdlib — no pip install).',
      })
      if (fixturesMode) {
        await readFile(FIXTURES, 'utf8').catch((err) => {
          throw new Error(`AEC_FIXTURES=1 but ${FIXTURES} unreadable: ${err instanceof Error ? err.message : err}`)
        })
        return
      }
      const res = await fetch(`${RAW}/README.md`, { method: 'HEAD' }).catch((err) => {
        throw new Error(
          `aec-bench preflight failed reaching ${RAW}: ${err instanceof Error ? err.message : err}\n` +
            `Fix: ensure network access to raw.githubusercontent.com, or set AEC_FIXTURES=1 to run offline.`,
        )
      })
      if (!res.ok) {
        throw new Error(
          `aec-bench preflight: ${REPO} README HEAD ${res.status}. Set AEC_FIXTURES=1 to run against committed fixtures.`,
        )
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      try {
        return await loadLive(opts)
      } catch (err) {
        // A reachability failure falls back to fixtures with an explicit warn; a
        // wrong-id / seed-only error (the loader's own throw) propagates.
        if (err instanceof Error && /fetch \d|ENOTFOUND|getaddrinfo|network/i.test(err.message)) {
          console.warn(
            `[aec-bench] live fetch failed (${err.message.slice(0, 160)}); falling back to committed fixtures at ${FIXTURES}`,
          )
          return loadFixtures(opts)
        }
        throw err
      }
    },

    async goldArtifact(task: BenchTask) {
      // Gold = the task's own golden_pass.md (scores reward 1.0 through the SAME
      // verify.py the real artifact takes), proving the judge end-to-end.
      const meta = readMeta(task)
      return meta.goldenPassMd
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      // verify.py fail-closes an empty/unparseable artifact to reward 0.0 itself,
      // so we pass it straight through (no pre-judging here).
      return runVerifier(meta, artifact)
    },
  }
}
