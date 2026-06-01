/**
 * SWE-bench Verified adapter. Worker artifact = a unified-diff patch. Judge =
 * the official `swebench` harness: apply the patch in the instance's Docker
 * image, run FAIL_TO_PASS + PASS_TO_PASS, report `resolved`. Fully deterministic
 * — no LLM judge.
 *
 * Requires: the bench `.venv` with `swebench` installed + a running Docker
 * daemon (per-instance images are pulled/built on first run).
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { BenchmarkAdapter, BenchScore, BenchTask, LoadOptions } from './types'

const execFileAsync = promisify(execFile)
const BENCH_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PY = join(BENCH_ROOT, '.venv', 'bin', 'python')
const DATASET = 'princeton-nlp/SWE-bench_Verified'

/** Run the bench venv python with a script on stdin; return stdout (throws on nonzero). */
async function py(script: string, args: string[] = [], timeoutMs = 0): Promise<string> {
  const { stdout } = await execFileAsync(PY, ['-c', script, ...args], {
    maxBuffer: 1024 * 1024 * 256,
    timeout: timeoutMs,
  })
  return stdout
}

export function createSweBenchAdapter(): BenchmarkAdapter {
  return {
    name: 'swe-bench-verified',

    async preflight() {
      try {
        await py('import swebench, docker; docker.from_env().ping(); print("ok")')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `swe-bench preflight failed: ${msg}\n` +
            `Fix: (1) python3 -m venv bench/.venv && bench/.venv/bin/pip install swebench ; ` +
            `(2) ensure the Docker daemon is running (the judge builds per-instance images).`,
        )
      }
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
      const stdout = await py(script, [opts.ids ? JSON.stringify(opts.ids) : ''])
      const rows = JSON.parse(stdout) as Array<Record<string, unknown>>
      return rows.map(
        (r): BenchTask => ({
          id: String(r.instance_id),
          split,
          prompt: [
            `Repository: ${r.repo} @ ${r.base_commit}`,
            '',
            'Resolve this issue by editing the repository. Output a unified git diff (the patch) that makes the failing tests pass without breaking the passing ones.',
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
      const runId = `bench-${task.id}`.replace(/[^a-zA-Z0-9_.-]/g, '_')
      const dir = await mkdtemp(join(tmpdir(), 'swebench-'))
      const predPath = join(dir, 'preds.json')
      await writeFile(
        predPath,
        JSON.stringify([
          { instance_id: task.id, model_name_or_path: 'agent-runtime-bench', model_patch: artifact },
        ]),
      )
      // The official evaluation harness. Pulls/builds the instance image, applies
      // the patch, runs the test spec, writes a per-run report JSON in cwd.
      await execFileAsync(
        PY,
        [
          '-m', 'swebench.harness.run_evaluation',
          '--dataset_name', DATASET,
          '--predictions_path', predPath,
          '--run_id', runId,
          '--instance_ids', task.id,
          '--max_workers', '1',
          '--cache_level', 'env',
        ],
        { cwd: dir, maxBuffer: 1024 * 1024 * 256, timeout: 1000 * 60 * 30 },
      )
      // Report file: agent-runtime-bench.<run_id>.json
      const reportPath = join(dir, `agent-runtime-bench.${runId}.json`)
      const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
        resolved_instances?: number
        resolved_ids?: string[]
      }
      const resolved = (report.resolved_ids ?? []).includes(task.id)
      return { resolved, score: resolved ? 1 : 0, detail: JSON.stringify(report) }
    },
  }
}
