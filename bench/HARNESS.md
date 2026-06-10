# bench harness — START HERE (the map, so you don't re-read 15 files)

If you're an agent picking this up: read this page, then run `pnpm help` + `pnpm gate` —
do NOT re-derive the harness from source. This map is SHORT on purpose; if it disagrees
with the code, the code wins — fix this page in the same turn (the anti-rediscovery law).
Verified against source 2026-06-10 · agent-eval pinned `^0.83.0`. The CANONICAL surface is now
the published optimization suite (`@tangle-network/agent-runtime/loops`): `Environment` +
`Strategy`/`defineStrategy` + `runBenchmark` — see the section below FIRST; the older
runExperiment/corpus-replay paths remain for the legacy gates.

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

## Data flow (the whole experiment in one line)
`rollout (worker → answer) → adapter.judge (valid?) → CORPUS RunRecord (k attempts, output+valid each) → corpus-replay --selector (pick WITHOUT the judge) → corpus-report CI → gate verdict`
The expensive part (rollouts) produces a **reusable corpus**; selection + stats are free
and offline (zero new rollouts, zero judge calls).

## THE CANONICAL SUITE (2026-06-10) — the published path; start here

The optimization layer now ships from the package (`PR #209–#211`); bench scripts compose it.
A domain = an `Environment` (5 hooks); a strategy = how budget is spent to beat its check;
`runBenchmark` returns per-strategy means + the per-task LOSSES table + the (score,$) Pareto
frontier + paired-bootstrap refine-vs-sample. Promotion is the package gate
(`promotionGate` — seeded paired bootstrap via agent-eval `heldoutSignificance`, minimum
6 paired tasks, CI lower bound must clear zero); the authoring is the package primitive
(`authorStrategy`, with a named `fallbackModel` retry). Models policy: cheap router models
only (worker + author default `deepseek-v4-pro`; `moonshotai/kimi-k2.6` is selectable but
needs `maxTokens` and times out on long authoring prompts) — never CC models.

| entry point | what it answers | one-liner |
|---|---|---|
| `src/flywheel-run.mts` | **THE CLEAN RUN** — does the system improve ITSELF (gen0 → author-from-losses → gen1 → disjoint ROTATING holdout via `HOLDOUT_OFFSET`)? | `EOPS_GYM_DBS_DIR=… N=12 HOLDOUT=8 tsx src/flywheel-run.mts` |
| `src/flywheel-evolve.mts` | **THE EVOLUTION RUN** — G generations × POP authored candidates (`runStrategyEvolution`): cost-aware champion, gzip-bits per artifact, fresh-slice promotion gate | `EOPS_GYM_DBS_DIR=… N=12 HOLDOUT=8 GENS=2 POP=2 tsx src/flywheel-evolve.mts` |
| `src/strategy-author.mts` | agent-authored strategies (R0→R2 ladder) on a cheap env | `tsx src/strategy-author.mts` |
| `src/agentic-run.mts` | depth-vs-breadth on EOPS through the canonical Supervisor (+16.4pp result) | `EOPS_GYM_DBS_DIR=… TASKS=16 tsx src/agentic-run.mts` |
| `src/eops-gepa.mts` | GEPA over the analyst prompt + frozen holdout (verdict: prompt coordinate FLAT) | `N=12 HOLDOUT=6 GENS=2 tsx src/eops-gepa.mts` |
| `src/eops-corpus-ab.mts` | the across-run flywheel A/B (naive priming = **−11.6pp NEGATIVE**; `PRIME_MODE=relevance` = the unrun surviving design) | `N=16 HOLDOUT=4 PRIME_MODE=relevance tsx src/eops-corpus-ab.mts` |
| `src/commit0-env-run.mts` | the HARD domain (implement whole libraries vs their test suites) through `runBenchmark` | `IDS=commit-0/wcwidth BUDGET=3 INNER_TURNS=10 tsx src/commit0-env-run.mts` |
| `src/prompt-compression-gate.mts` | **THE REDUCER GATE** — does prompt compression preserve quality while cutting real cost? (nth-char/word-drop baselines vs LLM compression, each gated non-inferiority vs the original) | `N=12 BUDGET=2 tsx src/prompt-compression-gate.mts` |
| `src/examples/strategy-demo.mts` | the 3-layer API demo (gym-free) | `WORKER_MODEL=gpt-4o-mini tsx src/examples/strategy-demo.mts` |
| `src/examples/math-demo.mts` | any-domain proof: math via `createVerifierEnvironment` (the tax/legal/gtm answer-shape) | `BUDGET=3 tsx src/examples/math-demo.mts` |

EOPS standup (one container): `docker run -d --rm --name eops -p 8006:8005
shivakrishnareddyma225/enterpriseops-gym-mcp-itsm:latest` + `EOPS_GYM_DBS_DIR=<unzipped
gym_dbs.zip from github.com/ServiceNow/EnterpriseOps-Gym>`; restart it FRESH per big run
(it wedges under load); `EOPS_SPLIT=csm|hr|…` selects other domains (their gym containers
not yet sourced). Cross-cutting laws baked into the suite: keep-best checkpoint scoring
(final-state scoring is biased −6–8pp), equal compute via the conserved pool, the analyst
is firewalled (trace-only), costs are real (router usage → `{usd, ms, tokens}`).

### The QUEUED runs for the test fleet (wired, one command each, unrun)
1. **Relevance-primed corpus A/B** — `PRIME_MODE=relevance K_FACTS=2 N=16 HOLDOUT=4` (the read-side design that survived the naive-priming negative).
2. **Strategy tournament at power** — flywheel-run with `N=24 HOLDOUT=12` (or runBenchmark with all four built-ins), the within-run topology verdict.
3. **Commit0 at real budget** — `BUDGET=3 INNER_TURNS=12 N=3` sample-vs-refine on the hard domain.
4. **Cross-domain replication** — blocked on sourcing the csm/hr gym containers (`EOPS_SPLIT` is wired).

## Commands (mirrored by `pnpm help` / `tsx src/run.ts help` — keep in sync)
run.ts:  help · preflight · verify-judge · solve-one · solve-one-local · solve-cad ·
         solve-browser · ui-review · batch-blind · batch-oracle · batch-compare
standalone tools (NOT in run.ts — the gate lives here):
  corpus-replay.mts  --selector: selector@k vs random@k vs oracle@k over a corpus (THE offline gate)
  corpus-report.mts  paired-bootstrap CI + Benjamini-Hochberg over corpora
  improve-prompt.ts     GEPA-optimize a directive vs a held-out gate + paired CI (selfImprove)
  finsearch-loop.ts  the real runLoop+createDriver closed loop on FinSearchComp
  terminal-compare.ts  Terminal-Bench compare (own main, not in run.ts)
unit tests (the only fully-green, cred-free runnable surface besides offline replay):
  node --test --import tsx src/{selector,compare-decomp,steering-experiment,refine-loop}.test.mts

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
makes the gate replayable with no rollouts. To gate the DIVERSE arm you must first generate
a diverse-strategy corpus (k different `composeStrategies` prefixes per instance) — that
generator is the in-progress work; the identical-directive control corpus is `batch-oracle`.

## Run the DIVERSE-vs-blind gate THROUGH the keystone (the recursive runtime, live)
```
cd bench
export TANGLE_API_KEY=…                                 # router + the deployable judge
BENCH=enterpriseops-gym EOPS_FIXTURES=1 N=20 K=4 pnpm keystone-gate
```
`keystone-gate-cli.mts` → `runKeystoneGate` (`src/keystone-gate.ts`): a `Persona` + the generic
`fanout` combinator over the budget-conserving `Supervisor`. Blind = K identical children, diverse
= K distinct strategy directives — equal-k by construction (conserved pool), proven by
`equalKOnCost`. The DEPLOYABLE selector is the benchmark's OWN `adapter.judge` (each child solves
via the router, is graded by the runnable checker, and that `BenchScore` is the child's verdict
`defaultSelectWinner` ranks on — selector ≠ oracle/LLM-judge). Pick a deployable-checker bench
(enterpriseops-gym / swe-bench / terminal-bench), NOT finsearchcomp (LLM-judge → not deployable).
Offline plumbing test (no creds): `tsx src/keystone-gate.test.mts`. This is the two-runtime
reconciliation — the gate now runs through the SAME recursive atom every personified loop uses.

## Generate a fresh corpus (local, no router/sandbox key — opencode at ~/.local/bin/opencode)
```
BENCH=hotpotqa HOTPOTQA_FIXTURES=1 RESEARCH=1 CORPUS=/tmp/identical.jsonl K=4 tsx src/run.ts batch-oracle 30
tsx src/corpus-replay.mts /tmp/identical.jsonl --selector
```
(hotpotqa is cheap + deterministic-judge but near-ceiling/weak-signal; simpleqa similar;
finsearchcomp is the strong-signal domain but needs the sandbox/local-web worker.)

## GEPA-optimize (so the gate tests BEST-effort, not strawman, prompts)
```
BENCH=hotpotqa RESEARCH=1 ROUTER_KEY=… tsx src/improve-prompt.ts   # POP/GENS/TRAIN_N/HOLDOUT_N envs
```
GEPA optimizes the shared base directive; the diverse lenses (`directives.ts`) layer on top.

## Workers (the rollout substrate) — pick via env
- `RESEARCH=1` → local opencode, model-knowledge QA (cheap; **works today**, conc≤2)
- `SANDBOX=1`  → prod-sandbox web-search worker (FinSearchComp real path; historically infra-flaky)
- default      → local code-patch worker (SWE-bench; judge needs bench/.venv + Docker)
The steer text lives in `directives.ts`, NOT in the worker (the worker is substrate). A
strategy is a prompt PREFIX; the judge is unchanged.

## Adapters (benchmarks/) — honest state (the code wins over this line; verified 2026-06-04)
The code-benches share `benchmarks/_harness.ts` (stage artifact → run the bench's OWN evaluator
in a `.venv`/Docker subprocess → parse its JSON report → `{resolved,score}`). No per-adapter
copy of the process/venv/Docker/temp/report plumbing; commit0+appworld also share its
stdin-piping runner (`runVenvScriptStdin`).
- **Real, runnable with ZERO extra deps:** finsearchcomp (GitHub dataset + fixtures + LLM judge — the gate bench), hotpotqa + simpleqa + frames (HF/web QA + F1/LLM judge; `*_FIXTURES=1` offline), **aec-bench** (real GitHub task tree + fixtures; judge = the task's own `tests/verify.py` over python3 stdlib — **deterministic, graded per-field partial credit, no Docker, no LLM** → the candidate non-oracle correctable-middle-band bench for the open gate).
- **Real code, needs an external harness/tools to run (fail loud with the exact install/Docker fix; never a fabricated score):** swe-bench + terminal-bench (`bench/.venv` + Docker), **commit0** (ISOLATED `bench/.venv-commit0` via `python3 -m venv bench/.venv-commit0 && bench/.venv-commit0/bin/pip install commit0 datasets` — its deps conflict with the shared `.venv`; override dir with `COMMIT0_VENV` — plus Docker; judge = official pytest harness, graded (passed+xfail)/total; the rollout prompt stages in-box (clones `commit-0/<repo>` @ `base_commit`, emits `git diff`); `COMMIT0_FIXTURES=1` for offline listing), **programbench** (`pip install programbench` + Docker on linux/amd64 + HF blobs; judge = official cleanroom eval, graded passed/total; `PROGRAMBENCH_FIXTURES=1` offline), **appworld** (`pip install appworld` + `appworld install` + `appworld download data`; judge = AppWorld's own `world.evaluate()`, graded passes/num_tests — NO committed fixture: task data exists only after `download data`, so loadTasks fails loud rather than fabricate a task), mind2web, cad-design + cadbench + cadgenbench (openscad/blender/build123d).
- **goldArtifact:** aec-bench returns the task's real `golden_pass.md` (verify-judge works fully offline). commit0 / programbench / appworld return `undefined` — the oracle is a git ref / stripped source / engine-bundled solution, not a portable string; judge correctness is proven by a real solve through the harness, not a synthetic gold (documented + fail-loud, not a fake).
- **Absent (not built):** swe-gym, swe-bench-multimodal, and the rest of the survey set.
Every unbuilt/scaffold adapter fails LOUD (throws with the integration step) rather than faking a score — no silent zeros in any corpus. Offline fixture tests: `benchmarks/{aec-bench,commit0,programbench,appworld}.test.mts` (`tsx --test`).

## Is it runnable RIGHT NOW? (verify the map, don't trust it blindly)
```
tsx src/run.ts help        # the real command list (source of truth)
tsx src/run.ts preflight   # harness/worker reachable for BENCH?
```
Creds: the router/sandbox paths read `ROUTER_KEY`/`SANDBOX_KEY` (+ `ROUTER_BASE`/`SANDBOX_BASE_URL`)
from the environment. Source them from the operator's private secret store (documented in the
global agent config, NOT here — this repo is public) into the run process; never print them.
NOT needed for the offline selector gate, the hotpotqa/swe-bench deterministic judges, or
RESEARCH=1 local-opencode rollouts — if unset, those paths are cred-blocked, not code-blocked.

## Durable next step (so this stops drifting)
`run.ts help` is now real (the command map). Next: lift the standalone tools into a single
command registry + a test asserting every `cmd === 'X'` and every package.json script
appears in `help`. Then `help` IS the map and this page is just the narrative.
