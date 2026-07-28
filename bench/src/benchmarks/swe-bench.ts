/**
 * SWE-bench Verified adapter. Worker artifact = a unified-diff patch. Judge =
 * the official `swebench` harness: apply the patch in the instance's Docker
 * image, run FAIL_TO_PASS + PASS_TO_PASS, report `resolved`. Fully deterministic
 * — no LLM judge.
 *
 * Requires: the bench `.venv` with `swebench` installed + a running Docker
 * daemon (per-instance images are pulled/built on first run).
 *
 * Process/Docker/report plumbing is shared via ./_harness; this file owns the
 * SWE-specific pieces: the patch OutputAdapter, the dataset dump, and the
 * predictions-file → run_evaluation argv → report-shape mapping.
 */

import { join } from 'node:path'
import type { OutputAdapter } from '@tangle-network/agent-runtime/kernel'
import {
  preflightVenvImports,
  readJsonReport,
  runStagedJudge,
  runVenvPython,
  safeRunId,
  stageFile,
  type StagedRunCaptureSpec,
} from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

/**
 * Fixed in-box path the agent clones the instance repo into. It is the SINGLE
 * source of truth shared by the prompt template (which tells the agent to clone
 * here) and `boxExtract` (which runs `git diff` here after the shot) — so the
 * harness always knows exactly where the agent's edits live, for any instance.
 */
const SWE_REPO_DIR = '/work'

/**
 * The SWE deliverable's FALLBACK parser, from the agent's event STREAM.
 *
 * The PRIMARY deliverable is `boxExtract` below: a `git diff` of the agent's
 * actual edits, read from the cloned repo's STATE inside the box (standard
 * SWE-bench practice). This event-stream parse only runs when that diff is empty
 * — a model that edited the source correctly but never printed a fenced diff (the
 * exact failure this replaces) still scores off its real changes, not its prose.
 */
export const swePatchOutput: OutputAdapter<string> = {
  parse(events) {
    let text = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) text = t
    }
    // Last ```diff/```patch fenced block (the contract the prompt asks for);
    // fall back to the raw text so a fence-less but valid diff still reaches the judge.
    const fences = [...text.matchAll(/```(?:diff|patch)?\s*\n([\s\S]*?)```/g)]
    const last = fences.at(-1)?.[1]
    return (last ?? text).trim()
  },
}

const DATASET = 'princeton-nlp/SWE-bench_Verified'
export type SweBenchCacheLevel = 'none' | 'base' | 'env' | 'instance'

export interface SweBenchArtifactCaptureContext {
  readonly taskId: string
  readonly runId: string
  /** One-based sequence unique within this adapter instance. */
  readonly attemptSequence: number
}

export interface SweBenchAdapterOptions {
  readonly timeoutMs?: number
  readonly cacheLevel?: SweBenchCacheLevel
  /**
   * Return a unique destination for any attempt whose complete official
   * evaluator directory and process logs should be retained.
   */
  readonly captureEvaluatorArtifacts?: (
    context: SweBenchArtifactCaptureContext,
  ) => StagedRunCaptureSpec | undefined
}

const SWE_CACHE_LEVELS = new Set<SweBenchCacheLevel>(['none', 'base', 'env', 'instance'])

function scorerNamespace(): 'swebench' | 'none' {
  const namespace = process.env.SWEBENCH_NAMESPACE ?? 'swebench'
  if (namespace !== 'swebench' && namespace !== 'none') {
    throw new Error(`SWEBENCH_NAMESPACE must be swebench|none, got "${namespace}"`)
  }
  return namespace
}
const TEST_FILE_EXCLUDES = [
  "':(exclude,glob)**/tests/**'",
  "':(exclude,glob)**/test/**'",
  "':(exclude,glob)test_*.py'",
  "':(exclude,glob)**/test_*.py'",
  "':(exclude,glob)*_test.py'",
  "':(exclude,glob)**/*_test.py'",
  "':(exclude,glob)conftest.py'",
  "':(exclude,glob)**/conftest.py'",
].join(' ')

interface SweReport {
  resolved_instances?: number
  resolved_ids?: string[]
  unresolved_ids?: string[]
  empty_patch_ids?: string[]
  completed_ids?: string[]
  incomplete_ids?: string[]
  error_ids?: string[]
  submitted_ids?: string[]
}

function stringIds(report: Record<string, unknown>, key: keyof SweReport): string[] {
  const value = report[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`swe-bench: malformed ${key}`)
  }
  return value
}

/** Convert one official report into a score without turning evaluator failures into agent failures. */
export function scoreSweReport(taskId: string, value: unknown): BenchScore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('swe-bench: report must be an object')
  }
  const report = value as Record<string, unknown>
  const statusIds = {
    resolved: stringIds(report, 'resolved_ids'),
    unresolved: stringIds(report, 'unresolved_ids'),
    emptyPatch: stringIds(report, 'empty_patch_ids'),
    completed: stringIds(report, 'completed_ids'),
    incomplete: stringIds(report, 'incomplete_ids'),
    error: stringIds(report, 'error_ids'),
  }
  const submitted = stringIds(report, 'submitted_ids')
  const mentioned = Object.values(statusIds).flat()
  if (
    mentioned.some((id) => id !== taskId)
    || (submitted.length > 0 && (submitted.length !== 1 || submitted[0] !== taskId))
  ) {
    throw new Error(`swe-bench: report identity mismatch for ${taskId}`)
  }
  if (statusIds.error.includes(taskId) || statusIds.incomplete.includes(taskId)) {
    throw new Error(`swe-bench: evaluator failed for ${taskId}`)
  }
  const outcomes = [
    statusIds.resolved.includes(taskId),
    statusIds.unresolved.includes(taskId),
    statusIds.emptyPatch.includes(taskId),
  ]
  if (outcomes.filter(Boolean).length !== 1) {
    throw new Error(`swe-bench: report has no unique outcome for ${taskId}`)
  }
  if ((outcomes[0] || outcomes[1]) && !statusIds.completed.includes(taskId)) {
    throw new Error(`swe-bench: report lacks a completed evaluation for ${taskId}`)
  }
  const resolved = outcomes[0]
  return { resolved, score: resolved ? 1 : 0, detail: JSON.stringify(report) }
}

export function sweEvaluationArgv(args: {
  readonly predictionsPath: string
  readonly runId: string
  readonly instanceId: string
  readonly cacheLevel: SweBenchCacheLevel
  readonly namespace?: 'swebench' | 'none'
}): string[] {
  return [
    '-m', 'swebench.harness.run_evaluation',
    '--dataset_name', DATASET,
    '--predictions_path', args.predictionsPath,
    '--run_id', args.runId,
    '--instance_ids', args.instanceId,
    '--max_workers', '1',
    '--namespace', args.namespace ?? scorerNamespace(),
    '--cache_level', args.cacheLevel,
  ]
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function sweMetadata(task: BenchTask): { repo: string; base: string } {
  const repo = String(task.metadata?.repo ?? '')
  const base = String(task.metadata?.base_commit ?? '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`swe-bench: invalid repo metadata for ${task.id}: ${repo}`)
  }
  if (!/^[0-9a-f]{7,40}$/i.test(base)) {
    throw new Error(`swe-bench: invalid base_commit metadata for ${task.id}: ${base}`)
  }
  return { repo, base }
}

export function createSweBenchAdapter(options: SweBenchAdapterOptions = {}): BenchmarkAdapter {
  if (
    options.timeoutMs !== undefined
    && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
  ) throw new Error('swe-bench: timeoutMs must be a positive integer')
  const cacheLevel = options.cacheLevel ?? 'env'
  if (!SWE_CACHE_LEVELS.has(cacheLevel)) throw new Error('swe-bench: invalid cacheLevel')
  if (
    options.captureEvaluatorArtifacts !== undefined
    && typeof options.captureEvaluatorArtifacts !== 'function'
  ) throw new Error('swe-bench: captureEvaluatorArtifacts must be a function')
  let attemptSequence = 0
  return {
    name: 'swe-bench-verified',
    output: swePatchOutput,

    // Extract the patch from repo STATE, not printed text: stage every edit the
    // agent made in the cloned repo and diff it against the checked-out
    // base_commit (`HEAD`). Test files are excluded — the judge applies the gold
    // `test_patch` itself, so an agent edit to a test would collide on apply. The
    // paths come out `a/<repo-relative>` (cwd = repo root), matching the gold
    // patch format the swebench judge's `git apply` expects.
    // Pre-stage: clone the instance repo at base_commit into SWE_REPO_DIR so the
    // agent only edits (the harness owns the checkout — a stochastic model can't be
    // trusted to clone to an exact path). `--quiet` keeps the exec output small.
    boxSetup(task) {
      const { repo, base } = sweMetadata(task)
      return {
        command: `rm -rf ${shellQuote(SWE_REPO_DIR)} && git clone --quiet ${shellQuote(`https://github.com/${repo}`)} ${shellQuote(SWE_REPO_DIR)} && git -C ${shellQuote(SWE_REPO_DIR)} checkout --quiet ${shellQuote(base)}`,
      }
    },
    boxExtract() {
      return {
        command: `git -C ${shellQuote(SWE_REPO_DIR)} add -A && git -C ${shellQuote(SWE_REPO_DIR)} diff --cached -- . ${TEST_FILE_EXCLUDES}`,
      }
    },

    async preflight() {
      await preflightVenvImports({
        modules: ['swebench'],
        requireDocker: true,
        fix:
          `Fix: (1) python3 -m venv bench/.venv && bench/.venv/bin/pip install swebench ; ` +
          `(2) ensure the Docker daemon is running (the judge builds per-instance images).`,
      })
    },

    async loadTasks(opts: LoadOptions = {}) {
      const limit = opts.limit ?? 10
      const split = opts.split ?? 'test'
      // Dump instances as JSON via the datasets loader (HF download on first run).
      const script = `
import json, sys
from datasets import load_dataset
ds = load_dataset(${JSON.stringify(DATASET)}, split=${JSON.stringify(split)})
ids = set(json.loads(sys.argv[1])) if len(sys.argv) > 1 and sys.argv[1] else None
out = []
for r in ds:
    if ids is not None and r["instance_id"] not in ids:
        continue
    out.append({
        "instance_id": r["instance_id"], "repo": r["repo"], "base_commit": r["base_commit"],
        "problem_statement": r["problem_statement"], "patch": r["patch"], "test_patch": r["test_patch"],
        "FAIL_TO_PASS": r["FAIL_TO_PASS"], "PASS_TO_PASS": r["PASS_TO_PASS"],
        "version": r.get("version"), "environment_setup_commit": r.get("environment_setup_commit"),
    })
    if ids is None and len(out) >= ${limit}:
        break
print(json.dumps(out))
`
      const stdout = await runVenvPython(script, [opts.ids ? JSON.stringify(opts.ids) : ''])
      const rows = JSON.parse(stdout) as Array<Record<string, unknown>>
      return rows.map(
        (r): BenchTask => ({
          id: String(r.instance_id),
          split,
          prompt: [
            `Repository: ${r.repo} @ ${r.base_commit}`,
            '',
            `The repository is ALREADY cloned at ${SWE_REPO_DIR}, checked out at commit ${r.base_commit}. Work there directly (\`cd ${SWE_REPO_DIR}\`); do not re-clone.`,
            '',
            'Resolve this issue by editing the repository SOURCE so the failing tests pass without breaking the passing ones. Do NOT edit test files — the evaluation runs hidden tests on a fresh checkout, so editing tests does not count. Keep the change minimal and confined to the cloned repo.',
            'Work iteratively: reproduce the issue, implement the fix in the source, and re-run the relevant tests until they pass. You do NOT need to print the diff — the harness reads your committed edits directly from the repo.',
            '',
            '--- Issue ---',
            String(r.problem_statement ?? ''),
          ].join('\n'),
          metadata: r,
        }),
      )
    },

    async goldArtifact(task: BenchTask) {
      const gold = task.metadata?.patch
      return typeof gold === 'string' ? gold : undefined
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const runId = safeRunId('bench', task.id)
      const capture = options.captureEvaluatorArtifacts?.({
        taskId: task.id,
        runId,
        attemptSequence: ++attemptSequence,
      })
      return runStagedJudge({
        tmpPrefix: 'swebench-',
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(capture === undefined ? {} : { capture }),
        // Debug: retain the staged dir (holds swebench's per-instance apply/run
        // logs) for post-mortem when SWEBENCH_KEEP_TMP is set. Off by default.
        ...(process.env.SWEBENCH_KEEP_TMP ? { keepTmp: true } : {}),
        async stage(dir) {
          await stageFile(
            join(dir, 'preds.json'),
            JSON.stringify([
              { instance_id: task.id, model_name_or_path: 'agent-runtime-bench', model_patch: artifact },
            ]),
          )
        },
        // The official evaluation harness. Pulls/builds the instance image, applies
        // the patch, runs the test spec, writes a per-run report JSON in cwd.
        argv: (dir) => sweEvaluationArgv({
          predictionsPath: join(dir, 'preds.json'),
          runId,
          instanceId: task.id,
          cacheLevel,
          namespace: scorerNamespace(),
        }),
        async parseReport(dir) {
          // Report file: agent-runtime-bench.<run_id>.json
          const report = await readJsonReport<SweReport>(join(dir, `agent-runtime-bench.${runId}.json`))
          return scoreSweReport(task.id, report)
        },
      })
    },
  }
}
