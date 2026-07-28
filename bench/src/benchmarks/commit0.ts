/**
 * Commit0 adapter (wentingzhao/commit0_combined) — implement-a-library-from-scratch.
 * Each record is a Python repo stubbed at `base_commit` (public function bodies
 * emptied to `pass`) + the full test suite + a natural-language spec URL. Worker
 * artifact = a unified diff that fills in `src_dir`. Judge = the official
 * `commit0` test harness: it stages the starter repo, applies the worker's diff,
 * builds the library's deps and runs `pytest`, writing a per-repo pytest-json
 * `report.json`. Score = (passed + xfail) / total — GRADED / partial-credit (the
 * macro-averaged unit-test pass-rate the leaderboard reports). Fully
 * deterministic — no LLM judge.
 *
 * The OutputAdapter is stream-only (the SWE wrinkle), so the worker emits its
 * implementation as a fenced ```diff against the stubbed repo — same deliverable
 * shape as swe-bench. The expensive per-repo clone+build+test is delegated to the
 * real `commit0` harness on a local Docker backend (NOT reimplemented here).
 *
 * Requires for a live run: an ISOLATED `.venv-commit0` with `commit0` installed
 * (its deps conflict with the shared bench `.venv`; override with COMMIT0_VENV) +
 * a Docker daemon (`--backend local`). For offline/CI dataset listing set
 * COMMIT0_FIXTURES=1 to load the committed lite rows (bench/fixtures/commit0.json)
 * — judging still needs the harness + Docker and fails loud, never a fabricated score.
 */

import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { OutputAdapter } from '@tangle-network/agent-runtime/kernel'
import { benchRoot, preflightVenvImports, runVenvScriptStdin, venvPythonAt } from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const FIXTURES = join(benchRoot, 'fixtures', 'commit0.json')

// commit0's pip deps (pydantic/sqlalchemy v1, modal, …) conflict with the shared
// bench .venv, so its harness runs in an ISOLATED venv. Override with COMMIT0_VENV.
// Resolved at call-time so the env is honored at run-time (not frozen at import).
const commit0VenvDir = (): string => process.env.COMMIT0_VENV ?? '.venv-commit0'
const commit0Python = (): string => venvPythonAt(commit0VenvDir())

const DATASET = 'wentingzhao/commit0_combined'
const DATASET_SPLIT = 'test'
// HF rows server — columnar pull with no `datasets` install required for listing.
const ROWS_API = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}&config=default&split=${DATASET_SPLIT}`

/** Reuse the SWE patch extractor shape: last fenced diff/patch, else raw text. */
export const commit0DiffOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) text = t
    }
    const fences = [...text.matchAll(/```(?:diff|patch)?\s*\n([\s\S]*?)```/g)]
    const body = (fences.at(-1)?.[1] ?? text).trim()
    // `git apply` rejects a patch that is not newline-terminated ("corrupt patch at
    // line N+1"); the .trim() above strips the final newline, so restore exactly one.
    return body.length > 0 ? `${body}\n` : body
  },
}

interface Commit0Setup {
  install: string
  packages: string[] | null
  pip_packages: string[] | null
  pre_install: string[] | null
  python: string
  specification: string
}

interface Commit0Row {
  instance_id: string
  repo: string
  original_repo: string
  base_commit: string
  reference_commit: string
  setup: Commit0Setup
  test: { test_cmd: string; test_dir: string }
  src_dir: string
}

interface Commit0Meta {
  instanceId: string
  repo: string
  originalRepo: string
  baseCommit: string
  referenceCommit: string
  srcDir: string
  testDir: string
  testCmd: string
  specification: string
}

function rowToTask(row: Commit0Row): BenchTask {
  const meta: Commit0Meta = {
    instanceId: row.instance_id,
    repo: row.repo,
    originalRepo: row.original_repo,
    baseCommit: row.base_commit,
    referenceCommit: row.reference_commit,
    srcDir: row.src_dir,
    testDir: row.test.test_dir,
    testCmd: row.test.test_cmd,
    specification: row.setup.specification,
  }
  return {
    id: row.instance_id,
    split: DATASET_SPLIT,
    prompt: [
      `Clone https://github.com/${row.repo} into /work, then \`cd /work && git checkout ${row.base_commit}\`.`,
      `This is the STUBBED library: the public functions/classes under \`${row.src_dir}\` have empty bodies (\`pass\`/\`...\`).`,
      `Fill in COMPLETE implementations under \`${row.src_dir}\` so the existing test suite under \`${row.test.test_dir}\` passes. Read those tests and the spec to learn the required behavior.`,
      `Specification / docs: ${row.setup.specification}`,
      'Do NOT edit the test files — the evaluation re-runs the existing tests on a fresh clone. Implement only the source.',
      `When done, from /work run EXACTLY: \`git add -A && git diff --cached -- ${row.src_dir}\` and END your reply with its COMPLETE output as the LAST thing, fenced exactly as \`\`\`diff … \`\`\` (nothing after the closing fence). That fenced diff (against ${row.base_commit}) is the only deliverable.`,
    ].join('\n'),
    metadata: meta as unknown as Record<string, unknown>,
  }
}

function readMeta(task: BenchTask): Commit0Meta {
  const md = task.metadata
  if (!md || typeof md.instanceId !== 'string' || typeof md.referenceCommit !== 'string' || typeof md.srcDir !== 'string') {
    throw new Error(`commit0 task ${task.id} missing metadata — loadTasks did not populate it`)
  }
  return md as unknown as Commit0Meta
}

function selectRows(rows: Commit0Row[], opts: LoadOptions): BenchTask[] {
  let tasks = rows.map(rowToTask)
  if (opts.ids) {
    const want = new Set(opts.ids)
    tasks = tasks.filter((t) => want.has(t.id))
  } else if (opts.limit !== undefined) {
    tasks = tasks.slice(0, opts.limit)
  }
  return tasks
}

async function loadFixtures(opts: LoadOptions): Promise<BenchTask[]> {
  const rows = JSON.parse(await readFile(FIXTURES, 'utf8')) as Commit0Row[]
  console.warn(
    `[commit0] COMMIT0_FIXTURES=1 — loading ${rows.length} committed lite rows from ${FIXTURES} (no HF fetch)`,
  )
  return selectRows(rows, opts)
}

/** Pull real rows from the HF rows server (paged). limit caps the pull; ids
 *  filtered client-side. Throws on a non-OK response (fail loud). */
async function fetchRows(opts: LoadOptions): Promise<Commit0Row[]> {
  const target = opts.ids ? opts.ids.length * 4 : (opts.limit ?? 16)
  const rows: Commit0Row[] = []
  const want = opts.ids ? new Set(opts.ids) : null
  const page = 100
  for (let offset = 0; offset < 64 && rows.length < target; offset += page) {
    const res = await fetch(`${ROWS_API}&offset=${offset}&length=${page}`)
    if (!res.ok) throw new Error(`commit0 rows HTTP ${res.status} (offset ${offset}): ${(await res.text()).slice(0, 200)}`)
    const body = (await res.json()) as { rows?: Array<{ row: Commit0Row }>; num_rows_total?: number }
    const got = body.rows ?? []
    if (got.length === 0) break
    for (const r of got) {
      if (want && !want.has(r.row.instance_id)) continue
      rows.push(r.row)
    }
    if (got.length < page) break
  }
  if (rows.length === 0) throw new Error(`commit0: no rows matched ${JSON.stringify(opts)} from ${DATASET}`)
  return rows
}

/**
 * Run the official commit0 harness for one repo over the worker's diff. The
 * harness clones base_commit, applies the diff into src_dir, installs deps and
 * runs pytest, then writes a per-repo pytest-json report. We read that report and
 * compute (passed + xfail) / total — the leaderboard's per-repo pass-rate.
 *
 * This is the expensive, Docker-backed boundary; it is DELEGATED to `commit0`,
 * not reimplemented. The driver script lives in scripts/commit0_judge.py so the
 * harness call + report parse are one auditable python entrypoint.
 */
async function runHarness(meta: Commit0Meta, artifact: string): Promise<BenchScore> {
  const judge = join(benchRoot, 'scripts', 'commit0_judge.py')
  let stdout: string
  try {
    // The worker's diff is piped to the driver's stdin (shared stdin-aware runner —
    // execFile's `input` option is not honored async and hangs the reader).
    stdout = await runVenvScriptStdin(
      judge,
      ['--dataset', DATASET, '--split', DATASET_SPLIT, '--instance', meta.instanceId, '--src-dir', meta.srcDir],
      artifact,
      { cwd: benchRoot, python: commit0Python() },
    )
  } catch (err) {
    const e = err as { message?: string }
    throw new Error(`commit0 harness failed for ${meta.instanceId}: ${(e.message || String(err)).slice(0, 1500)}`)
  }
  const report = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as {
    passed?: number
    total?: number
    error?: string
  }
  if (report.error) throw new Error(`commit0 harness error for ${meta.instanceId}: ${report.error}`)
  if (typeof report.passed !== 'number' || typeof report.total !== 'number') {
    throw new Error(`commit0 judge returned no {passed,total}: ${stdout.slice(0, 400)}`)
  }
  // total=0 means the harness MEASURED NOTHING (collection error with no declared
  // test ids) — an unmeasured attempt, not a 0% one. Throw so the caller excludes
  // it as infra instead of recording a fabricated zero.
  if (report.total <= 0) {
    throw new Error(`commit0 judge measured no tests for ${meta.instanceId} (total=0): ${stdout.slice(0, 400)}`)
  }
  const score = report.passed / report.total
  return {
    resolved: report.passed === report.total,
    score,
    detail: JSON.stringify({ instanceId: meta.instanceId, passed: report.passed, total: report.total }),
  }
}

export function createCommit0Adapter(): BenchmarkAdapter {
  const fixturesMode = process.env.COMMIT0_FIXTURES === '1'

  return {
    name: 'commit0',
    output: commit0DiffOutput,

    async preflight() {
      await preflightVenvImports({
        modules: ['commit0'],
        requireDocker: true,
        python: commit0Python(),
        fix:
          `Fix: (1) python3 -m venv bench/${commit0VenvDir()} && bench/${commit0VenvDir()}/bin/pip install commit0 datasets ` +
          `(an ISOLATED venv — commit0's deps conflict with the shared bench/.venv; override the dir with COMMIT0_VENV) ; ` +
          `(2) ensure the Docker daemon is running (commit0 --backend local builds per-repo images). ` +
          `Dataset rows come from the HF rows server; set COMMIT0_FIXTURES=1 to list the committed lite rows offline.`,
      })
    },

    async loadTasks(opts: LoadOptions = {}) {
      if (fixturesMode) return loadFixtures(opts)
      let rows: Commit0Row[]
      try {
        rows = await fetchRows(opts)
      } catch (err) {
        console.warn(
          `[commit0] live rows fetch failed (${err instanceof Error ? err.message : err}); falling back to committed fixtures at ${FIXTURES}`,
        )
        return loadFixtures(opts)
      }
      return selectRows(rows, opts)
    },

    async goldArtifact() {
      // The oracle is the reference_commit's src_dir, which the commit0 harness
      // checks out by ref — not expressible as a portable diff string without
      // cloning. verify-judge against this adapter requires the live harness, so
      // we return undefined (no offline gold-diff). Judge correctness is proven by
      // running the harness on a real solve, not by a synthetic gold patch.
      return undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = readMeta(task)
      return runHarness(meta, artifact)
    },
  }
}
