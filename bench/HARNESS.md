# bench harness — START HERE (the map, so you don't re-read 15 files)

If you're an agent picking this up: read this page, then run `pnpm help` + `pnpm gate` —
do NOT re-derive the harness from source. This map is SHORT on purpose; if it disagrees
with the code, the code wins — fix this page in the same turn (the anti-rediscovery law).
Verified against source 2026-07-11 · agent-eval pinned `^0.114.0`. The CANONICAL surface is now
the published optimization suite (`@tangle-network/agent-runtime/loops`): `Environment` +
`Strategy`/`defineStrategy` + `runBenchmark` — see the section below FIRST. The recursive
diverse-vs-blind gate runs through the keystone (`gate-cli.mts` → `runGate`);
the offline selector replay (`corpus-replay.mts` / `corpus-report.mts`) gates the legacy corpora.

## What this harness answers
**The success criterion is Gate B** (docs/learning-flywheel.md, docs/architecture.md §2): across
repeated runs on a persistent, checkable task family, the deployed policy's verifier-graded
**multi-objective** score (correct · fast · secure · cheap, each its own deployable checker)
improves **run-over-run** at matched per-run compute, surviving a frozen-policy control, significant
at adequate n. That across-run slope is RSI. **The harness has NOT yet run Gate B** — see the durable
gap below.

What the harness measures **today is Gate A** (docs/roadmap-rsi.md — the inner GO/NO-GO for the
within-run adaptive-driver layer): **does any non-blind topology beat blind compute at EQUAL COMPUTE
(Σ rollouts × turns — `k` counts rollouts, each may be multi-turn/stateful), under a DEPLOYABLE
(non-oracle) selector, at significant n?** Gate A is a **narrow diagnostic** — the cost-justification
for parallel/adaptive topology, **NOT** the product verdict. A failed Gate A deletes within-run
steering only; it never touches the corpus+policy product (Gate B). The invariant is equal-COMPUTE,
not equal-k-on-stateless-samples.

**Terminology (one word, used consistently).** A **rollout** (≡ a "shot") is ONE agent running an
`AgentProfile` to completion — a full, possibly **multi-turn / stateful** trajectory. `k` counts
*rollouts*; **turns live *inside* a rollout**, never as separate shots. A single **stateless
completion** (`maxTurns=0`, `harness: null`, one model call, no persistent workspace) is the
*degenerate* rollout — fine as a selector **lower bound**, never the canonical unit. The HumanEval
probe (`bench/src/humaneval-gate.mts`) uses exactly that degenerate shape — it calls the router
directly and does **not** route through `AgentProfile` / the sandbox / the keystone — so its numbers
are the **no-self-correction lower bound** on the selector, distinct from the rollout-based keystone
gate above. Bridge it to the product by running the same arms with real rollouts (an `AgentProfile`
through `runLoop`), dialing `maxTurns`.

Two things to keep straight: today's judges grade a single
*correctness* scalar (the multi-objective vector is the open contract, architecture.md §6), and every
number below is single-objective + within-run — read them as Gate-A diagnostics, not Gate-B results.
- Within-run STEER (verify-and-revise family) **LOSES** (rung-0, n=40: blind 37.5% →
  random@3 60.0% → refineGepa@3 45.0%; the earlier +20pp was confounded compute).
- On the COMMITTED finsearch corpus, the self-consistency selector also **loses**:
  selector@k − random@k = **−8.2pp** (n=51). So "pick the consensus among k identical-ish
  attempts" does not beat a random draw here.
- **VERIFIER-GROUNDED selection is the one selector that wins** — but ONLY where a domain has
  WITHIN-TASK graded variance. Proven POSITIVE on HumanEval (deployable-checker, binary, n=50:
  verifier−sc = +12.0pp CI[+4,+22]). The continuous-reward generalization (`selector.ts`
  `summarizeVerifierSelector`, `corpus-replay --selector=verifier`) ranks k attempts by their
  stored deployable-checker `score` and reports selector(=best-of-k) vs random(=mean-of-k) with a
  paired bootstrap CI. **aec-bench is structurally DEAD for it** (n=12 gpt-4.1, **0/12 random +
  1/12 diverse tasks have any within-task score spread**): closed-form engineering calcs score
  deterministically w.r.t. sampling — across-task difficulty (33% resolve) but ~0 within-task
  selection headroom. The gpt-5 null (oracle 2.5%) was a worker artifact (no JSON emission);
  gpt-4.1 fixes the band (mean 36.1%) but the selector gate stays flat. **commit0 is the right
  Layer-1 domain** (different impls pass different test subsets → real within-task spread).
- **UNTESTED (still Gate A):** parallel **DIVERSE strategies** (different reasoning paths,
  `directives.ts` → `DIVERSE_STRATEGY_LENSES` / `composeStrategies`) @k vs blind sample(n=k). A
  distinct family from what rung-0 falsified — the open *within-run* question, and what runProgram's
  `parallel` is built to deploy.
- **UNBUILT (Gate B):** the across-run policy-improvement curve on a multi-objective task stream.
  No harness runs it yet; it is the durable next step, not a corpus-replay over the existing
  single-objective records.

## The run archive (where results LIVE)

Every run's full artifact is committed under `agent-lab/runs/<date>/` — self-describing JSON
(models + config + per-task cells + gate verdicts with CIs), portable to any repo without
this codebase. `agent-lab/runs/RUNS.md` is the index mapping artifacts → verdicts → the
findings gist. **Set `OUT=runs/<date>/<name>.json` (in agent-lab) on every run — never `/tmp`**
(a reboot erases ramdisk; ~20 runs nearly died there once).

## Data flow (the whole experiment in one line)
`rollout (worker → answer) → adapter.judge (valid?) → CORPUS RunRecord (k attempts, output+valid each) → corpus-replay --selector (pick WITHOUT the judge) → corpus-report CI → gate verdict`
The expensive part (rollouts) produces a **reusable corpus**; selection + stats are free
and offline (zero new rollouts, zero judge calls).

## THE CANONICAL SUITE (2026-06-10) — the published path; start here

The optimization layer ships from the package; bench scripts compose it. A domain = an
`Environment` (5 hooks); a strategy = how budget is spent to beat its check; `runBenchmark`
returns per-strategy means + the per-task LOSSES table + the (score,$) Pareto frontier.
Promotion is the package gate (`promotionGate` — seeded paired bootstrap, evidence floor,
two modes: **superiority** and **non-inferiority** = score CI low > −tolerance AND cost
savings CI low > 0, the "same quality, cheaper" gate; verdicts carry paired Δlatency).
Authoring is `authorStrategy` (named `fallbackModel` retry). **Funnel-alignment law**: the
search-side champion tie-band must be no stricter than the gate's tolerance (under
`OBJECTIVE=cost` it defaults to it). Endurance envs on the evolve runner: `CHECKPOINT=path`
(phase ledger + resume — a killed run re-pays ONE phase), `GYM_RECREATE='docker …'`
(recreate the container at phase boundaries — the wedge killer). Observability:
`createWaterfallCollector` (every spawn billed+timed) + `anytimeReport` (TTT / shots-to-
target / COCO ERT / hill-climb AUC per satisficing target). Models policy: cheap router
models only (defaults `deepseek-v4-pro`/`deepseek-v4-flash`; compressor = flash with
`gpt-4o-mini` fallback) — never CC models; every verdict banner + artifact is
self-describing (models + config).

| entry point | what it answers | one-liner |
|---|---|---|
| **the research lines** | the flywheel/evolution runs, σ×κ factor grid, steering hypercube, model matrix, E3 certified memory, depth-vs-breadth, corpus A/Bs — **moved to [tangle-network/agent-lab](https://github.com/tangle-network/agent-lab) (private)** with the EOPS/math domains and the run archive | `~/code/agent-lab` — map in its README |
| `src/commit0-env-run.mts` | the HARD domain (implement whole libraries vs their test suites) through `runBenchmark` | `IDS=commit-0/wcwidth BUDGET=3 INNER_TURNS=10 tsx src/commit0-env-run.mts` |
| `src/examples/strategy-demo.mts` | the 3-layer API demo (gym-free) | `WORKER_MODEL=gpt-4o-mini tsx src/examples/strategy-demo.mts` |
| `src/examples/math-demo.mts` | any-domain proof: math via `createVerifierEnvironment` (the tax/legal/gtm answer-shape) | `BUDGET=3 tsx src/examples/math-demo.mts` |

`run-benchmarks-cli.mts` can run a bounded per-task refinement loop with
`LOOP_ATTEMPTS=N`: attempt 1 answers the original task; later attempts receive previous artifacts
plus redacted checker feedback; the loop stops early on pass. This is for testing whether agents can
use the benchmark's own feedback to solve the task, not for leaking gold answers into prompts.
For local subscription-backed workers, set `BACKEND=bridge`, `BRIDGE_URL`, `BRIDGE_BEARER`, and pass
the full bridge model id in `CELLS`, e.g. `CELLS=opencode/deepseek/deepseek-v4-pro`.

EOPS standup (one container): `docker run -d --rm --name eops -p 8006:8005
shivakrishnareddyma225/enterpriseops-gym-mcp-itsm:latest` + `EOPS_GYM_DBS_DIR=<unzipped
gym_dbs.zip from github.com/ServiceNow/EnterpriseOps-Gym>`; restart it FRESH per big run
(it wedges under load); `EOPS_SPLIT=csm|hr|…` selects other domains (their gym containers
not yet sourced). **Parallel lanes:** tasks carry the dataset's literal gym URL
(`http://localhost:8006`); `EOPS_GYM_URL=http://localhost:8007` rebases every server URL,
so N concurrent runs use N containers (`-p 8007:8005`, `-p 8008:8005`, …) instead of
serializing on one wedge-prone gym. Bring-up check: `agent-lab/domains/lane-probe.mts`. Cross-cutting laws baked into the suite: keep-best checkpoint scoring
(final-state scoring is biased −6–8pp), equal compute via the conserved pool, the analyst
is firewalled (trace-only), costs are real (router usage → `{usd, ms, tokens}`).

### The QUEUED runs for the test fleet (wired, one command each, unrun)
1. **Relevance-primed corpus A/B** — `PRIME_MODE=relevance K_FACTS=2 N=16 HOLDOUT=4` (the read-side design that survived the naive-priming negative).
2. ~~Strategy tournament at power~~ — RAN (n=24, budget 4, ×3 configs): HOLD verdicts; the cost-frontier finding ×3 + the funnel-alignment law came out of these. Live ledger: `.evolve/current.json` + the findings gist.
3. **Commit0 at real budget** — `BUDGET=3 INNER_TURNS=12 N=3` sample-vs-refine on the hard domain.
4. **Cross-domain replication** — blocked on sourcing the csm/hr gym containers (`EOPS_SPLIT` is wired).

## Commands (the standalone tools — each its own `main`)
the gate + measurement tools:
  corpus-replay.mts  --selector: selector@k vs random@k vs oracle@k over a corpus (THE offline gate)
  corpus-report.mts  paired-bootstrap CI + Benjamini-Hochberg over corpora
  gate-cli.mts  the recursive diverse-vs-blind gate through `runGate` (Supervisor)
  run-benchmarks-cli.mts  runBenchmarks: any subset of the ADAPTERS registry × model/harness cells, one combined ranked report (#420)
  commit0-env-run.mts  the HARD domain through `runBenchmark` (the optimization suite)
  terminal-compare.ts  Terminal-Bench compare (own main)
  pnpm verify:pier  zero-model failure/pass Pier controls through a separate verifier
unit tests (the only fully-green, cred-free runnable surface besides offline replay):
  node --test --import tsx src/{selector,refine-loop}.test.mts
  tsx src/gate.test.mts   # offline plumbing test (no creds)

## Run the GATE — today, zero creds (it already runs)
```
cd bench
pnpm gate                                              # = corpus-replay.mts corpus/finsearch.jsonl --selector
tsx src/corpus-replay.mts corpus/finsearch.jsonl --selector --condition=refine   # other arms
tsx src/corpus-replay.mts <corpus.jsonl> --selector=verifier   # GRADED domains: rank k by deployable-checker score
pnpm gate-report                                       # paired-bootstrap CI + BH-FDR
```
`--selector=verifier` is for corpora whose attempts carry a continuous `score` (commit0
pytest pass-rate / aec verify.py partial credit) and where text doesn't cluster: it ranks by
the deployable checker (argmax score) and reports selector vs random with a paired bootstrap CI.
It needs WITHIN-TASK score spread to move — flat on aec (closed-form), live on commit0 (code).
The committed `corpus/finsearch.jsonl` (152 records: random@3 / refineHand@3 / refineGepa@3)
makes the gate replayable with no rollouts. To gate the DIVERSE arm you generate a
diverse-strategy corpus (k different `composeStrategies` prefixes per instance) by running
`gate-cli.mts` with the distinct-directive arms — the blind (identical-children) arm is the
control on the same run.

## Run the DIVERSE-vs-blind gate THROUGH the keystone (the recursive runtime, live)
```
cd bench
export TANGLE_API_KEY=…                                 # router + the deployable judge
BENCH=enterpriseops-gym EOPS_FIXTURES=1 N=20 K=4 pnpm gate-cli
```
`gate-cli.mts` → `runGate` (`src/gate.ts`): a `Persona` + the generic
`fanout` combinator over the budget-conserving `Supervisor`. Blind = K identical children, diverse
= K distinct strategy directives — equal-k by construction (conserved pool), proven by
`equalKOnCost`. The DEPLOYABLE selector is the benchmark's OWN `adapter.judge` (each child solves
via the router, is graded by the runnable checker, and that `BenchScore` is the child's verdict
`defaultSelectWinner` ranks on — selector ≠ oracle/LLM-judge). Pick a deployable-checker bench
(enterpriseops-gym / swe-bench / terminal-bench), NOT finsearchcomp (LLM-judge → not deployable).
Offline plumbing test (no creds): `tsx src/gate.test.mts`. The gate runs through the SAME recursive
atom every personified loop uses.

## "Supervisor" (iterate/decompose) vs blind — through the PUBLISHED suite
The supervisor-vs-blind gate is NOT a bespoke harness: it is `runBenchmark([sample, refine, …])`
over an Environment. blind = `sample` (best-of-k); "supervisor" = `refine`/`sampleThenRefine`
(depth: attempt→firewalled-analyst-steer→retry — *"a multi-agent team is just a Strategy whose driver
spawns several agents"*). Equal compute by the substrate's CONSERVED budget; the deployable check is
the Environment's `score`; the can't-fake-the-check firewall is built in. Run it on the HARD real
domain via `commit0-env-run.mts` (above) or the toy `strategy-demo.mts` (offline). The LLM
agent-driver (an LLM that itself decides spawns via the coordination MCP) is the SEPARATE product
path — `atom-mcp-e2e.mts` / `atom-commit0.mts` — not a strategy. Evolve any strategy on a frozen
holdout with `runStrategyEvolution`.

## Generate a fresh corpus + gate it
The rollout generators now live with their domains: the recursive gate
(`gate-cli.mts`) and the optimization-suite env runs (`commit0-env-run.mts`,
`research-gate.mts` for the off-sandbox RAG baseline) each append corpus `RunRecord`s. Gate any
written corpus offline with the selector:
```
tsx src/corpus-replay.mts <corpus.jsonl> --selector
```
(hotpotqa is cheap + deterministic-judge but near-ceiling/weak-signal; simpleqa similar;
finsearchcomp is the strong-signal domain but needs the sandbox/local-web worker.)

## Optimize the strategy/prompt (so the gate tests BEST-effort, not strawman)
Strategy-space search is the package's `runStrategyEvolution` (the optimization suite); the diverse
lenses (`directives.ts`) layer on top of the shared base directive consumed by the gate arms.

## Workers (the rollout substrate)
The gate solves each child via the router and grades it with the benchmark's own
deployable `adapter.judge`; `research-gate.mts` is the off-sandbox retrieve→answer baseline
(`SEARCH=<provider>` selects the web-search arm). The steer text lives in `directives.ts`, NOT in the
worker (the worker is substrate). A strategy is a prompt PREFIX; the judge is unchanged.

## Adapters (benchmarks/) — honest state (the code wins over this line; verified 2026-06-04)
The code-benches share `benchmarks/_harness.ts` (stage artifact → run the bench's OWN evaluator
in a `.venv`/Docker subprocess → parse its JSON report → `{resolved,score}`). No per-adapter
copy of the process/venv/Docker/temp/report plumbing; commit0+appworld also share its
stdin-piping runner (`runVenvScriptStdin`).
Published-package consumers set `AGENT_BENCH_PYTHON` to the absolute path of an interpreter containing the benchmark dependencies.
If unset, source checkouts keep using `bench/.venv/bin/python`.
- **Real, runnable with ZERO extra deps:** finsearchcomp (GitHub dataset + fixtures + LLM judge — the gate bench), hotpotqa + simpleqa + frames (HF/web QA + F1/LLM judge; `*_FIXTURES=1` offline), **ragbench**, **crag**, **nomiracl**, **open-rag-bench**, **t2-ragbench** (SOTA RAG/knowledge benchmarks with committed fixtures and deterministic answer/relevance judges; live mode reads explicit `*_DATA_FILE` JSON/JSONL exports), **aec-bench** (real GitHub task tree + fixtures; judge = the task's own `tests/verify.py` over python3 stdlib — **deterministic, graded per-field partial credit, no Docker, no LLM** → the candidate non-oracle correctable-middle-band bench for the open gate).
- **Real code, needs an external harness/tools to run (fail loud with the exact install/Docker fix; never a fabricated score):** swe-bench + terminal-bench (`bench/.venv` + Docker), **commit0** (ISOLATED `bench/.venv-commit0` via `python3 -m venv bench/.venv-commit0 && bench/.venv-commit0/bin/pip install commit0 datasets` — its deps conflict with the shared `.venv`; override dir with `COMMIT0_VENV` — plus Docker; judge = official pytest harness, graded (passed+xfail)/total; the rollout prompt stages in-box (clones `commit-0/<repo>` @ `base_commit`, emits `git diff`); `COMMIT0_FIXTURES=1` for offline listing), **programbench** (`pip install programbench` + Docker on linux/amd64 + HF blobs; judge = official cleanroom eval, graded passed/total; `PROGRAMBENCH_FIXTURES=1` offline), **appworld** (`pip install appworld` + `appworld install` + `appworld download data`; judge = AppWorld's own `world.evaluate()`, graded passes/num_tests — NO committed fixture: task data exists only after `download data`, so loadTasks fails loud rather than fabricate a task), **dabstep** (`DABSTEP_DIR=/path/to/EnvCommons/DABStep` with the released `dataset.csv`, `splits/*.txt`, `files/*`, and `grade.py`; judge delegates to official `grade.py`; `DABSTEP_FIXTURES=1` only tests adapter plumbing and does not fabricate benchmark scores), **webarena-verified** (`WEBARENA_VERIFIED_DIR=/path/to/webarena-verified`; judge delegates to official `eval-tasks` over a run output directory), **tau2-bench** (`TAU2_BENCH_DIR=/path/to/tau2-bench`; judge recomputes tau2 trajectory rewards), **tau3-banking** (`TAU3_BENCH_DIR=/path/to/tau2-bench`; default domain `banking_knowledge`; judge recomputes tau trajectory rewards through the upstream tau3 package), **agentbench** DBBench subset (`AGENTBENCH_DIR=/path/to/AgentBench`; exact-match deterministic label judge), **bfcl** deterministic function-call subset (`BFCL_DIR=/path/to/gorilla/berkeley-function-call-leaderboard`; loads official BFCL JSONL + `possible_answer`; score = structured call/argument match, not the full BFCL leaderboard evaluator), **toollm** API-selection subset (`TOOLBENCH_DIR=/path/to/ToolBench`; score = recall of ToolBench `relevant APIs` labels, resolved only when the worker emits the requested structured JSON call list; official ToolEval pass rate remains LLM-judged/stochastic), **finresearchbench** (`FINRESEARCHBENCH_DATA_FILE=/path/to/export.jsonl`; rows must carry official `judge_system_prompt` + `judge_prompt_template`; no self-authored live judge), mind2web, cad-design + cadbench + cadgenbench (openscad/blender/build123d).
- **goldArtifact:** aec-bench returns the task's real `golden_pass.md` (verify-judge works fully offline). commit0 / programbench / appworld return `undefined` — the oracle is a git ref / stripped source / engine-bundled solution, not a portable string; judge correctness is proven by a real solve through the harness, not a synthetic gold (documented + fail-loud, not a fake).
- **Absent (not built):** swe-gym, swe-bench-multimodal, and the rest of the survey set.
Every unbuilt/scaffold adapter fails LOUD (throws with the integration step) rather than faking a score — no silent zeros in any corpus. Offline fixture tests: `benchmarks/{aec-bench,commit0,programbench,appworld,rag-benchmarks}.test.mts` (`tsx --test`).

## Pier candidate bridge

`pier_agents.tangle_candidate:TangleCandidateAgent` is the reusable Pier custom-agent path for frozen Tangle candidates.
`executePreparedPierCandidate()` is the only public entry point; its private staging step writes the runtime's execution-plan and materialization-receipt bytes verbatim.
The Python bridge rechecks those bytes and their signed task, candidate, profile, repository, instruction, and workspace identities before launch.
It rejects a raw candidate bundle, never projects an `AgentProfile`, and leaves task isolation, patch transfer, verification, retries, and result storage to Pier.

The adapter fails the trial when any prepared identity drifts, when the task checkout or immutable OCI image differs from the signed identity, or when the candidate exits nonzero or exceeds its signed deadline.
Candidate code runs as an unprivileged numeric user, while evaluator inputs and timeout evidence remain root-owned.
It never accepts candidate-authored token, cost, or trace receipts; `executePreparedPierCandidate()` uses the runtime's atomic execution path and reconciles the protected `TraceStore` with the model-gateway ledger before returning a gradable receipt.
The prepared object contains no credentials.
The runtime passes model and trace bindings only to the trusted executor request.
The Pier launcher inherits their values through its protected process environment and passes only `${NAME}` references on the command line, so credentials never enter prepared bytes, CLI arguments, or job files.
The executor builds fresh task, candidate, and profile trees from the request's exact verified file bytes; prepared staging directories are never launch authority.
Isolated memory and knowledge-bearing candidates currently fail closed until Pier has executor-owned mount and after-state capture.
The signed wall deadline is a hard stop: the runtime aborts, Pier kills the process tree, and the executor acknowledges process and container death.
The signed tool-step count is a post-run validity check over protected traces, not a pre-tool stop; generic black-box Pier processes cannot honestly prevent step N+1.
The executable zero-model fixture is `fixtures/pier-agent/`; run it against the R360 Pier checkout with `PIER_REPO=/path/to/pier pnpm verify:pier`.
That command runs a no-change candidate that must score 0/1, proves a fresh evaluator process can kill a persisted child and remove its real Docker container, and runs a known-good candidate that must score 1/1.
It then checks that each official result and exact task patch is bound into its own runtime receipt with zero model usage.

For a real frozen candidate, use `FilePierCandidateTrialController`, append `agentArgs` and `attemptArgs`, and pass each executor-only `evaluatorEnv` entry through Pier's evaluator-owned environment mechanism.
The launch callback's second argument carries the signed runtime `request`, protected `traceStore`, cancellation `signal`, and absolute `deadlineAtMs`; production launchers must use that context rather than reconstructing it.
The controller sends secrets to its supervisor over a pipe, while its durable files contain only process and Docker-project identities:
The supervisor never inherits `process.env`; non-default Docker connections use a stable `dockerConnection.id` plus the exact environment injected into both Pier and cleanup.
Fresh recovery workers must reconstruct that same named connection; `terminate-pier-trial.mts` selects only the comma-delimited variables named by `PIER_DOCKER_ENV_NAMES` when `PIER_DOCKER_CONNECTION_ID` is set.
`jobName` must be unique per prepared execution; the controller atomically reserves that job directory so recovery can remove only containers owned by that execution.

```ts
const controller = new FilePierCandidateTrialController({
  directory: '/var/lib/tangle/pier-control',
  launch: (staged, { request }) => {
    const jobName = request.executionId
    return {
      command: 'uv',
      args: ['run', 'pier', 'run', ...staged.agentArgs, ...staged.attemptArgs],
      cwd: pierCheckout,
      env: { ...evaluatorEnvironment, ...staged.evaluatorEnv },
      jobsDirectory,
      jobName,
      readResult: () => readOfficialPierResult(jobsDirectory, jobName),
    }
  },
})

const result = await executePreparedPierCandidate({
  prepared,
  directory: '/sealed/candidate',
  pierVersion: '0.3.0',
  traceStore,
  claimStore,
  outputArtifacts,
  grader,
  controller,
})
```

The controller's result resolves only after normal process/container cleanup.
On a signed deadline, external abort, or recovery by another evaluator process, the adapter waits for `terminateAndWait()` to acknowledge both process exit and container removal before it returns control to the runtime.

One prepared execution always maps to one Pier attempt (`--n-attempts 1 --max-retries 0`).
Production callers pass a long-lived `FileAgentCandidateExecutionClaimStore`; an in-memory claim store is test-only and cannot prevent a second process from replaying the same attempt.
Any allowed pre-model infrastructure retry is a new prepared execution with its own counted attempt identity.

## Is it runnable RIGHT NOW? (verify the map, don't trust it blindly)
```
ls src/*.mts src/*.ts          # the real tool list (each its own main — source of truth)
tsx src/gate.test.mts # offline plumbing test (no creds)
```
Creds: the router/sandbox paths read `ROUTER_KEY`/`SANDBOX_KEY` (+ `ROUTER_BASE`/`SANDBOX_BASE_URL`)
from the environment. Source them from the operator's private secret store (documented in the
global agent config, NOT here — this repo is public) into the run process; never print them.
NOT needed for the offline selector gate, the hotpotqa/swe-bench deterministic judges, or
RESEARCH=1 local-opencode rollouts — if unset, those paths are cred-blocked, not code-blocked.

## Durable next step (so this stops drifting)
The surviving tools are standalone `.mts` mains (no `run.ts` registry). Next: a manifest test that
asserts every committed tool + package.json script is named on this page, so the map can't silently
drift from the code again.
