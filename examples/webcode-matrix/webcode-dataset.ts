/**
 * webcode-dataset — load the REAL WebCode E2E tasks (Exa's open dataset, vendored under MIT in ./data).
 *
 * Exa ships the dataset ONLY — "No agent harness included — bring your own (e.g. mini-swe-agent)." So this
 * module loads their 33 real tasks; the harness×model matrix in `webcode-matrix.ts` is the missing harness.
 *
 * Each task carries the agent's prompt (`task_description`), the EXACT pytest grader Exa wrote
 * (`test_patch`), the file the agent must produce (`solution_files`), and the per-task toolchain image
 * (`dockerfile`). Grading is execution truth: write the agent's solution, run Exa's `test_patch`, pass ⟺
 * pytest exits 0. No LLM judge, no invented tasks.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Scenario } from '@tangle-network/agent-eval/campaign'

/** One real WebCode E2E task, as a campaign `Scenario`. Field names mirror Exa's JSONL schema. */
export interface WebCodeTask extends Scenario {
  /** Exa task id, e.g. `e2e_001`. */
  readonly id: string
  readonly slug: string
  readonly repo: string
  readonly repoUrl: string
  readonly releaseTag: string
  /** The agent's prompt — what to build against the post-cutoff API. */
  readonly taskDescription: string
  /** Exa's pytest grader, written verbatim into the sandbox as the test suite. */
  readonly testPatch: string
  /** The file(s) the agent must produce (e.g. `Solution.swift`). */
  readonly solutionFiles: readonly string[]
  /** The per-task toolchain Dockerfile (the image Exa grades in). */
  readonly dockerfile?: string
  /** The base image parsed from the Dockerfile's `FROM` (e.g. `swift:6.1-bookworm`) — the per-task
   *  toolchain for tier-2/3 grading (see README). `undefined` when no Dockerfile ships. */
  readonly baseImage?: string
  /** Required-knowledge citations (the post-Aug-2025 API the agent must web-search). */
  readonly citations: ReadonlyArray<{ url?: string; required_knowledge?: string }>
}

interface RawWebCodeRow {
  id: string
  slug: string
  repo: string
  repo_url: string
  release_tag: string
  task_description: string
  test_patch: string
  metadata?: {
    solution_files?: string[]
    dockerfile?: string
    citations?: Array<{ url?: string; required_knowledge?: string }>
  }
}

// The dataset is FETCHED, not vendored — it carries secret-shaped test fixtures (a task probes secret
// detection) that trip push protection, and it is 656K. `data/fetch.sh` downloads it; `WEBCODE_DATASET`
// overrides the path (e.g. a checkout of exa-labs/benchmarks).
const datasetPath =
  process.env.WEBCODE_DATASET ?? fileURLToPath(new URL('./data/code_e2e.jsonl', import.meta.url))

/**
 * Load the real WebCode E2E tasks. Fetch the dataset first: `examples/webcode-matrix/data/fetch.sh`
 * (or set `WEBCODE_DATASET` to a `code_e2e.jsonl` path).
 * @param opts.limit cap the number of tasks (handy for a cheap smoke; omit for all 33).
 */
export function loadWebCodeTasks(opts: { limit?: number } = {}): WebCodeTask[] {
  if (!existsSync(datasetPath)) {
    throw new Error(
      `WebCode dataset not found at ${datasetPath}. Fetch it first: run examples/webcode-matrix/data/fetch.sh, or set WEBCODE_DATASET to a code_e2e.jsonl path (source: github.com/exa-labs/benchmarks).`,
    )
  }
  const text = readFileSync(datasetPath, 'utf8')
  const rows: RawWebCodeRow[] = text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RawWebCodeRow)
  const tasks = rows.map((r): WebCodeTask => {
    const m = r.metadata ?? {}
    // The base toolchain image is the Dockerfile's first `FROM` (e.g. `swift:6.1-bookworm`).
    const baseImage = m.dockerfile ? /^\s*FROM\s+(\S+)/im.exec(m.dockerfile)?.[1] : undefined
    return {
      id: r.id,
      kind: 'webcode',
      slug: r.slug,
      repo: r.repo,
      repoUrl: r.repo_url,
      releaseTag: r.release_tag,
      taskDescription: r.task_description,
      testPatch: r.test_patch,
      solutionFiles: m.solution_files ?? [],
      ...(m.dockerfile ? { dockerfile: m.dockerfile } : {}),
      ...(baseImage ? { baseImage } : {}),
      citations: m.citations ?? [],
    }
  })
  return opts.limit ? tasks.slice(0, opts.limit) : tasks
}
