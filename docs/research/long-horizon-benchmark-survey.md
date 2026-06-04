> **Track:** Architecture (research) · **Role:** survey (adversarially verified) · **Status:** reference · **Run:** `w9ntld2vt` (102 agents, 20 sources, 100 claims → 25 verified, 23 confirmed / 2 killed)

# Long-horizon & multi-turn benchmark survey

For the RSI driver experiment: run an agent over multiple turns on a hard task, compare
**steer policies** (continue / critical-audit / aggressive-ship / personas) against blind
independent retries, and measure whether steering gets farther per added turn. The experiment
wants a benchmark that is **natively multi-turn** (context carries across turns) and whose
completion signal is **GRADED** (fraction of tests passing), not binary, so the adaptation
curve is smooth.

## Top recommendations

- **Long-horizon software build, steer a continued conversation, compare policies → Commit0.**
  The only surveyed benchmark that is simultaneously **graded** (pass-rate of unit tests, a
  continuous 0–100%), **natively multi-turn/interactive** (multi-stage unit-test + static-analysis
  + coverage feedback the agent adapts to across turns — the curve measurably moves with feedback,
  e.g. iterating on test errors lifts pass-rate to ~26%), and genuinely **long-horizon** (implement
  entire real Python libraries from scratch against long-form specs; 54–57 libraries).
  Sources: arXiv 2412.01769, commit-0.github.io. NeurIPS 2024 D&B.

- **Multi-turn agent↔user conversation with tools → τ²-bench (tau2-bench).** A natively multi-turn
  **dual-control** Tool-Agent-User benchmark: a simulated user and the agent converse turn-by-turn
  and **both** can call tools (a Dec-POMDP). Sources: github.com/sierra-research/tau2-bench,
  arXiv 2506.07982. **Caveat:** rewards are effectively **binary** per task (gated by required
  actions + `reward_basis`) — it is the *conversation* pick, **not** a graded-curve pick (a
  verifier vote killed the "graded" claim 0–3).

## Verified verdicts

| Benchmark | Graded? | Natively multi-turn / continued-session? | Fit for "steer a continued build conversation" | Vote |
|---|---|---|---|---|
| **Commit0** | **Yes** — unit-test pass-rate % | **Yes** — interactive multi-stage feedback the agent adapts to | **Best** | 3-0 |
| **FeatureBench** | **Yes** — Passed-Rate (frac. of fail→pass tests) + binary Resolved-Rate | **Yes** — agentic scaffolds, ≤500 steps, diminishing returns ~100 | Strong runner-up; *feature-level*, not greenfield whole-project | 3-0 |
| **DevBench** | **Yes** — test pass-rate, coverage %, env-setup success | **No** — 5 waterfall stages graded independently with *reference* inputs; only a review-role refine loop | Graded + from-scratch, but **not** one continuous build conversation | 3-0 / 2-1 |
| **ProgramBench** (Meta/FAIR, arXiv 2605.03546) | Headline **binary** (% Resolved = all tests pass); a secondary "% Tests Passed" partial-progress metric exists | **Yes** — write-compile-debug, 1,000-step / 6-hr cap, median ~868 cmds/task (model-dependent) | **Single-agent-only by design**; multi-agent + human-guided modes are *future work* | graded headline REFUTED 1-2 |
| **SlopCodeBench** (arXiv 2603.24755) | **Yes** — 4 solve-rate variants + continuous [0,1] erosion/verbosity | Iterative **on the artifact only** — *deliberately wipes prior conversation*; fresh Docker per checkpoint, only the workdir persists | Disqualified for *conversational* steer (no carried context). NB: it already ran a steer comparison — quality prompts cut initial erosion but did **not** slow per-checkpoint degradation (~1.3pp/ckpt), at +12.1% cost | 3-0 |
| **SWE-Lancer** | **No** — payout only if *all* applicable tests pass; graded only by summed $ of whole tasks | **No** — independent single-deliverable tasks + managerial choices | Poor (no smooth curve) | 3-0 |
| **MLE-bench** | Medal/percentile (effectively binary per task) | **No** — one final CSV; the agent's own internal ~24h loop, graded only on the submission | Moderate at best | 2-1 |

## What ProgramBench / "program bench" is

The Meta/FAIR **rebuild-from-scratch** benchmark (arXiv 2605.03546, github.com/facebookresearch/programbench,
May 2026): a single SWE-agent rebuilds programs via a human-like write-compile-debug cycle in a
persistent Docker session (1,000 steps / 6 hours). Single-agent-only by design; **not** built for
steer-policy comparison (that is invited as future work). A usable graded substrate via its
"% Tests Passed per instance" secondary metric, but the headline "% Resolved" is binary.

## Caveats (carried verbatim from the verifier)

- **Scope gap — not adversarially verified this round:** SWE-Gym, SWE-bench Verified, SWE-bench
  Multimodal, MLAgentBench, RepoBench, the original single-control τ-bench, AppWorld,
  TerminalBench, OSWorld, GAIA, WebArena, VisualWebArena, Cybench. Most are predominantly
  binary/single-deliverable or web/OS/security-domain (likely poor for a graded software-build
  curve), but confirm before relying on it.
- **Name collisions:** the graded software-dev **DevBench** is arXiv **2403.08604** (not 2601.11895);
  **FeatureBench** (2602.10975) ≠ the 2025 "FeatBench" (2509.22237); **ProgramBench** resolves only
  to the Meta/FAIR 2605.03546.
- **Dating:** ProgramBench / FeatureBench / SlopCodeBench carry 2026 arXiv IDs; their leaderboard
  numbers will move, but the *design* properties cited (graded vs binary, step caps, context-carry
  semantics) are structural and stable.
- **Interpretive hedge:** "smooth curve" depends on per-task test count. SlopCodeBench's existing
  steer result (steering does not slow degradation) is the closest direct evidence for the
  hypothesis, but it is artifact-iterative, not conversation-continued, so it may not generalize.

## Implication for the harness

For a graded, multi-turn, long-horizon software-build adapter, **Commit0 is the slot-in**
(graded + natively interactive). It plugs into the `BenchmarkAdapter` contract as one entry; the
`executionMode: 'continued-session'` dial is what makes "steer a continued build conversation"
meaningful (without it, steering degrades to a re-attempt).
