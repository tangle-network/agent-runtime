# agent-runtime-bench

Published as `@tangle-network/agent-bench`, with independent CI and release checks for its TypeScript and Python surfaces.

**Read [`bench/HARNESS.md`](./HARNESS.md) FIRST.** It is the one maintained map: the commands, the `rollout → corpus → selector → CI → gate` data flow, the canonical-suite table, the wired/needs-creds/scaffolded matrix, and the gate one-liners, kept verified against source.

## Release

This package publishes from its own tag. A root `v*` tag publishes `@tangle-network/agent-runtime` only.

```bash
# after bench/package.json holds the new version on the tip of main
git tag -a agent-bench-v<version> -m "agent-bench <version>"
git push origin agent-bench-v<version>
```

Bump `bench/package.json` and cut the tag in the same release. The manifest resolves the first-party cohort through the workspace catalog, so a catalog move changes what this package publishes. `publish.yml` skips a version the registry already holds, so a bump without a tag leaves the registry serving the previous cohort to every consumer.

Confirm the release with `npm view @tangle-network/agent-bench version`.

## Use

```bash
pnpm add -D @tangle-network/agent-bench
```

```ts
import { resolveAdapter } from '@tangle-network/agent-bench'

const crag = resolveAdapter('crag')
```

## SWE-bench judge setup (the one block not in HARNESS.md)

```bash
python3 -m venv .venv && .venv/bin/pip install swebench   # SWE-bench harness
pnpm install                                              # tsx + link parent
# Docker daemon must be running (judges build/run per-instance images)
```

The judge needs only Docker; workers need a model key (Tangle router `TANGLE_API_KEY`, or a direct provider).

Live optimizer scripts require explicit token prices so cost records cannot be guessed.
Use the `REFLECT_` prefix for the general benchmark scripts and `GEPA_OPTIMIZER_` for the SWE arena seat.
For either prefix, set `INPUT_USD_PER_MILLION`, `CACHED_INPUT_USD_PER_MILLION`, `CACHE_WRITE_USD_PER_MILLION`, and `OUTPUT_USD_PER_MILLION`.
The SWE arena seat reads its model from `GEPA_OPTIMIZER_MODEL`, its URL from `GEPA_OPTIMIZER_BASE_URL`, and its key from `GEPA_OPTIMIZER_API_KEY`.
It falls back to the configured driver model, `ROUTER_BASE`, and `TANGLE_API_KEY`.
Missing prices fail before an optimizer model call.

Retain every official per-test log and report before the temporary evaluator directory is removed:

```ts
const adapter = createSweBenchAdapter({
  captureEvaluatorArtifacts: ({ taskId, attemptSequence }) => ({
    destination: path.join(runDirectory, taskId, String(attemptSequence)),
  }),
})
const score = await adapter.judge(task, patch)
console.log(score.judgeArtifacts?.manifestPath)
```

Each destination contains the untouched evaluator tree under `evaluator/`, raw `stdout.bin` and `stderr.bin` under `process/`, and `receipt.json` with per-file SHA-256 values plus a whole-tree SHA-256.
The destination must be unique and absent; an existing path fails loud instead of overwriting evidence.
Failed evaluators throw `StagedJudgeError` with the same `judgeArtifacts` receipt after retaining partial logs.

## Official-data adapters: tau2/tau3, DABStep, FinResearchBench

Fixture mode (`TAU2_FIXTURES=1`, `TAU3_FIXTURES=1`, `DABSTEP_FIXTURES=1`, `FINRESEARCHBENCH_FIXTURES=1`) proves adapter plumbing only.
A fixture result is never a benchmark score.
A benchmark score requires the official data below plus the benchmark's own judge, and nothing else counts.

| Adapter | Official data | Judge |
|---|---|---|
| `tau2-bench` / `tau3-banking` | `TAU2_BENCH_DIR` / `TAU3_BENCH_DIR` = clean git checkout of [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench); domain via `TAU2_DOMAIN` / `TAU3_DOMAIN` | tau2's own reward recomputation over a tau `results.json` trajectory |
| `dabstep` | `DABSTEP_DIR` = checkout of [EnvCommons/DABStep](https://github.com/EnvCommons/DABStep) (`grade.py`, `splits/`, `files/`); released `dataset.csv` beside it or via `DABSTEP_DATASET_CSV` | official `grade.py`, deterministic, no LLM |
| `finresearchbench` | `FINRESEARCHBENCH_DATA_FILE` = JSON/JSONL export whose rows carry `judge_system_prompt` and `judge_prompt_template` | official logic-tree model judge over the Tangle router (`TANGLE_API_KEY`) |

**tau2/tau3.**
Run `uv sync --extra knowledge` inside the checkout and set `AGENT_BENCH_PYTHON=<checkout>/.venv/bin/python3` so the loader and judge run in the interpreter that holds the `tau2` distribution.
Every official load stamps `upstreamCommit` (checkout HEAD) and `upstreamVersion` (installed `tau2` distribution) into task metadata, and fails loud on a dirty or non-git checkout or a missing distribution.
The judge re-resolves the pin, refuses a checkout or interpreter that moved after load, and writes both values into its score detail.
A trajectory score needs a tau `results.json` produced by the paid tau simulation (agent plus user simulator); the adapter only recomputes the official reward from that artifact.

**DABStep.**
The git checkout does not ship `dataset.csv`.
The row file (`task_id,question,guidelines,all_golds_by_task`) is distributed with the OpenReward DABStep environment, which mounts it at `/orwd_data/dataset.csv`.
The public [adyen/DABstep](https://huggingface.co/datasets/adyen/DABstep) release carries the task rows without golds (`data/tasks/all.jsonl`; answers withheld for the leaderboard) and a 10-task dev split with reference answers (`data/tasks/dev.jsonl`).
Point `DABSTEP_DATASET_CSV` at an absolute row-file path when the checkout and the rows live apart.

**FinResearchBench.**
The judge is a model call, so its score records the exact judge turn usage on `BenchScore.judgeUsage` (tokens, cost, model).
`tokensKnown: false` and `usdKnown: false` survive verbatim; an unknown judge cost never reads as zero spend.
`FINRESEARCHBENCH_JUDGE_MODEL` (or `JUDGE_MODEL`) selects the judge; `FINRESEARCHBENCH_PASS_THRESHOLD` moves the resolve bar from 0.8.

## Pier custom candidates

The package executes a branded `PreparedAgentCandidateExecution` from `@tangle-network/agent-runtime` through one atomic API and ships `pier_agents.tangle_candidate:TangleCandidateAgent` as its thin Pier transport.
The executor recreates every input from runtime-verified file bytes and reveals model credentials only inside the claimed execution callback.
Pier owns the task container and verifier; protected model usage and traces stay in `@tangle-network/agent-eval` and are finalized by the shared runtime.
`FilePierCandidateTrialController` atomically reserves a unique Pier job, then persists the supervisor PID, process-session identity, and that job's exact Docker projects so a fresh evaluator process can stop and remove an abandoned trial.
Run `PIER_REPO=/path/to/pier pnpm verify:pier` for the zero-model failure/pass and fresh-process recovery proof, and see `HARNESS.md` for the exact invocation and failure contract.
From an installed npm package, expose the shipped Python module with `export PYTHONPATH="$(npm root)/@tangle-network/agent-bench${PYTHONPATH:+:$PYTHONPATH}"` before invoking Pier.
