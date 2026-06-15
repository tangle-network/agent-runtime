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
import type { OutputAdapter } from '@tangle-network/agent-runtime/loops'
import {
  preflightVenvImports,
  readJsonReport,
  runStagedJudge,
  runVenvPython,
  safeRunId,
  stageFile,
} from './_harness'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

/**
 * The SWE deliverable, extracted from the agent's event STREAM (not the box FS).
 * `runLoop`'s `OutputAdapter` only sees events, so the agent prints its unified
 * diff in a fenced block and this pulls the last one out — the seam that lets the
 * SWE benchmark run through the gate runner (`runGate` / `runBenchmark`)
 * like any other.
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

interface SweReport {
  resolved_instances?: number
  resolved_ids?: string[]
}

export function createSweBenchAdapter(): BenchmarkAdapter {
  return {
    name: 'swe-bench-verified',
    output: swePatchOutput,

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
            'Resolve this issue by editing the repository SOURCE so the failing tests pass without breaking the passing ones. Do NOT edit test files — the evaluation runs hidden tests, so editing tests does not count. Keep the change minimal.',
            'When done, END your reply with the COMPLETE unified git diff as the LAST thing, fenced exactly as ```diff … ``` (nothing after the closing fence). That fenced diff is the only deliverable.',
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
      return runStagedJudge({
        tmpPrefix: 'swebench-',
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
        argv: (dir) => [
          '-m', 'swebench.harness.run_evaluation',
          '--dataset_name', DATASET,
          '--predictions_path', join(dir, 'preds.json'),
          '--run_id', runId,
          '--instance_ids', task.id,
          '--max_workers', '1',
          '--cache_level', 'env',
        ],
        async parseReport(dir) {
          // Report file: agent-runtime-bench.<run_id>.json
          const report = await readJsonReport<SweReport>(join(dir, `agent-runtime-bench.${runId}.json`))
          const resolved = (report.resolved_ids ?? []).includes(task.id)
          return { resolved, score: resolved ? 1 : 0, detail: JSON.stringify(report) }
        },
      })
    },
  }
}
