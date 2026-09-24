# Live-agent improvement loop

This is the execution contract for improving an agent that serves real work.
The pilot must use the agent's actual profile and execution adapter.
Search returns a detached candidate; only the product can change the served agent.

## Decision and evidence unit

The unit is one sealed baseline/candidate pair on one independent task source.
Record the tenant-safe source reference, task family, profile and code digests, model, tool set, worker revision, seed, and execution placement.
Retain the raw run trace, checked outcome, errors, usage, cost, latency, and missing fields for each cell.
Keep customer content in its authorized store; pass redacted references to analysts and reports.
An absent trace, failed worker, or failed grader has a distinct status.
Neither a missing result nor an unknown cost becomes a zero score or a free run.

The pilot's registered outcome is checked task success.
Report cost and wall time beside it, and refuse promotion for a material regression in either agreed guardrail.
The final checker must assess the user's task outcome, not just the agent's explanation or a judge's preference.
Freeze the checker implementation, version, thresholds, independent observation unit, sample size, and stopping rule before candidate search.
The final set needs a random live-traffic cohort and a separately reported failure-enriched cohort.
Report each cohort's paired estimate and the traffic-weighted aggregate.
Failure mining alone changes the task mix and cannot establish a population lift.

## Run the loop

| Step | Existing owner and module | Required action and gap |
| --- | --- | --- |
| Capture | Runtime `src/intelligence/index.ts` (`traceRun`, `recordTrace`, `exportRunRecord`); Eval `src/trace/`, `src/rollout/` | Capture actual served runs with execution identity, outcome, usage, and cost. The pilot still needs a permitted live trace cohort and a verified mapping to task outcomes. |
| Mine failures | Eval `src/diagnosis/` and `src/trace/`; Runtime `src/runtime/observe.ts` and `src/runtime/harvest-corpus.ts` | Classify real failures, count each class by independent run, and retain trace references. Validate analyst findings against the trace before using them. No top-20 live-agent inventory has been checked yet. |
| Propose | Runtime `src/improvement/improve.ts`, `src/improvement/method-execution.ts`, `src/improvement/agentic-generator.ts`; Eval `src/campaign/` | Give an agent the development traces and task objective. Use a complete `OptimizationMethod` for profile edits or `agenticGenerator` for code edits. Record every proposal, rejection, and model cost. Do not author the treatment by hand. |
| Select | Eval `src/campaign/optimization-method.ts`, `src/campaign/search-ledger.ts`; Runtime `src/improvement/method-execution.ts` | Search may inspect train and selection cases only. Bind candidate bytes, callbacks, resources, and closure state to an execution reference. Keep the optimizer's selected candidate, including a negative or unchanged selection. |
| Final test | Eval `src/campaign/judge-snapshot.ts`, `src/campaign/gates/`, `src/paired-promotion-decision.ts`, `src/paired-promotion-power.ts`; Runtime `src/intelligence/improvement-cycle.ts` | Execute baseline and exact selected candidate on frozen, disjoint final cases using the production adapter. Pair on source units and equal actual resources. Report both task cohorts, the deciding interval, discordant pairs, exclusions, and the simulated power of the sealed decision. |
| Shadow | Runtime candidate experiment execution in `src/intelligence/improvement-cycle.ts`; product execution adapter | Run the candidate against copied or read-only tasks without customer-visible effects. The product must provide the shadow placement, data permissions, and separate billing attribution; Runtime does not switch traffic. |
| Canary | Eval `defaultProductionGate` can inspect canary run history; product traffic and telemetry | Randomize concurrent incumbent and candidate assignment by customer, session, or workflow. Keep memory separate per arm and wait for delayed task outcomes. Monitor checked success, error classes, cost, and latency. The product must implement routing and the stop trigger. |
| Promote or revert | Runtime `src/intelligence/activation.ts`, `src/intelligence/delivery.ts`; product atomic state and promotion ledger | Bind approval to the exact proposal and current state, then atomically activate. Verify the served digest and one user flow. Use `revert-to-baseline` against the same sealed proposal if the canary crosses a stop threshold. Only the product owns these writes. |

`proposeAgentProfileImprovement` already joins analysis, search, profile diffs, paired measurement, and a reviewable proposal.
The product adapter in `agent-dev-container/products/intelligence/api/src/lib/platform-agent-profile-runtime-job.ts` snapshots profile state and stores the proposal.
Ops-board #1428 owns the ongoing ADC Intelligence path from ordinary experience to reusable profile candidates.
This lane consumes that path and does not build a second profile store or promotion service.
Ops-board #1426 completed executable worker-state retention in Runtime PR #1319.

## Data boundaries and preregistration

1. Define one real agent, its served revision, task families, and authorized trace source.
2. Reserve development, selection, and final source units before reading candidate results.
3. Deduplicate source families, related conversations, retries, and variants across partitions.
4. Calibrate the frozen checker on independently known passes and failures.
5. Challenge checker and telemetry integrity with attempts to read answers, edit scoring dependencies, or forge time and cost.
   A seeded exploit that yields valid-looking evidence without detection invalidates the campaign.
6. Register a useful lift, cost and latency tolerances, a confidence level, and an alpha-safe stopping rule.
7. Size the paired final set with Eval's `requiredPairsForPairedPromotion` using a declared joint outcome law.
8. Run a small execution and result-capture proof before paying for the full matrix.

The candidate generator may see development traces, development checker feedback, and selection scores.
It must never see final task text, final checker internals, final outcomes, or canary results while choosing the candidate.
Register each candidate's hypothesis and edit budget before testing it.
A bundled hypothesis may cover interacting edits if the bundle is declared before execution.
Run each candidate and comparison arm with isolated Git state, workspace, and persistent memory.
Audit the resulting artifact for held-out answer IDs or scoring code copied into the candidate.
The same final source unit cannot be reused after a failed promotion attempt without accounting for repeated exposure.
If the available final set is too small, report a clean negative or inconclusive result with power and a bound on detectable lift.
Do not claim a tie proves no useful effect when the interval includes one.

Runtime's generic `promotionGate` defaults to six paired tasks and zero useful margin.
It skips unpaired rows, treats latency as informational, and permits unknown costs in superiority mode.
Those defaults do not certify this live-agent loop.
The product adapter must require the registered sample size and coverage, cost and latency guardrails, and complete receipts before promotion.

## First hosted-pilot measurement registration, 2026-09-24

These rules are fixed before the first Operator or Majo pilot result is read.
The pilot is not sealed until the product owner supplies the agent, cohort, checker, placement, and cost joins below.

- **Headline gate:** improve independently checked task success on a live agent this week.
  The 95% paired risk-difference score interval must have a lower bound above zero.
  Use Eval's `decidePairedPromotion(baseline, candidate, { binaryScale: 1, threshold: 0, confidence: 0.95, minPairs })` on frozen final pairs.
  Keep this zero threshold and its denominator fixed; report any stricter useful-effect margin separately.
- **Same-path baseline:** run the incumbent served revision and exact selected candidate through the same hosted adapter on each independent source task.
  Match model identity, tool grants, task input, resource caps, and read-only state snapshot.
  Isolate candidate memory and side effects; record each arm's profile digest, served model, execution ID, and placement.
  A historical or differently routed incumbent is diagnostic, never the deciding control.
- **Correctness:** record one binary task outcome from an independent product-state checker, its version, evidence reference, and observation time.
  A response claiming success, tool call completion, or user sentiment alone cannot make a task pass.
  Calibrate the exact checker on independently known passes, realistic failures, and a boundary case before final measurement.
- **Deterministic turn and cost proxy:** one turn is one accepted inbound user request with a stable turn ID.
  Sum settled billed USD for all model calls and retries joined to that turn's execution ID.
  Divide by the number of distinct accepted turn IDs; retain total USD, turn count, tokens, retries, and latency beside the ratio.
  If any required billing join is missing, mark cost per turn unknown and report the known subtotal and missing count.
  Report candidate generation, checking, and replay cost separately; Gate B includes them in total spend.
- **Checked-outcome proxies:** record task-specific persisted state transitions, validated tool results, and external acknowledgments as separate secondary fields.
  Freeze each predicate and its allowed evidence source before the run, then compare it with independent task labels.
  None of these proxies replaces checked task success in the headline gate.
- **Size and stopping:** use Eval's `requiredPairsForPairedPromotion` with a declared joint outcome law before candidate search.
  Run one small same-path execution and result-capture proof before the full matrix.
  Keep final source units disjoint from development and selection; count missing pairs, worker failures, and exclusions without turning them into zeros.
  Gate B keeps its separate floor of 100 fresh independent episode pairs and the original headline count.
- **If local tuning flattens:** stop local profile tuning after two selection rounds fail the preregistered useful margin.
  Diagnose the dominant checked failure class and test one candidate that changes the responsible execution mechanism.
  Register its mechanism event and use fresh final units or an alpha-safe sequential rule before that candidate is evaluated.

A positive replay interval remains a candidate result until the served canary has checked outcomes and a verified revision.

Before this registration becomes a runnable pilot, pin the agent and served revision, the authorized cohort and split, the exact checker and calibration fixtures, the product-state proxy predicates, and the shadow placement.
Also pin the baseline joint outcome law, final pair count, cost and latency guardrails, model grant, billed-cost join, and stopping rule.
Until these fields have checked receipts, neither the scorecard nor a proxy may report a live improvement.

## Across-run learning, Gate B

Gate B compares a learning process across repeated episodes with a frozen reference process.
The replication unit is one whole learning episode per arm, with matched starts and equal total budgets.
Score each episode's resulting agent on fresh final source units.
Only the learning arm may retain findings and approved changes after an episode.
At each later episode, record the prior evidence retrieved, the decision it changed, and the exact served candidate.
Evaluate both arms on fresh source units, including an unchanged ability check from earlier task families.
Count all analysis, candidate generation, execution, evaluation, retrieval, and serving costs over the declared horizon.
The primary estimate is the paired difference in later checked outcomes by independent episode source.
Report the trajectory and its interval, not merely the best version's score.
The current Gate A result tests within-run steering and cannot substitute for this comparison.
One improved specialist establishes an agent outcome, not that its improvement process learned.
A better self-improver requires a separate comparison of whole learning processes across repeated searches.

## Reliability and autoresearch

Build the failure taxonomy from real run traces before choosing fixes.
Rank classes by affected runs and user impact; include infrastructure and measurement failures separately.
For the top five, reproduce one representative case through the real execution path, fix its cause, and rerun that case and its neighboring class.
The regression suite must retain trace IDs, source revision, expected checker behavior, and exclusions.

An autoresearch agent may propose a change to Eval's own working evaluator or experiment procedure.
It must execute the proposed change, report both successes and failures, and retain its exact patch and cost.
Positive results require runner-origin command, exit, data hash, and result hash receipts.
Replay the selected revision in a clean environment before accepting the result.
An independent, frozen outer checker evaluates whether the changed procedure detects known failures or improves later task decisions.
A self-reported research conclusion is not an Eval improvement.

## Readiness gates

Mark a requirement pass only from a linked receipt: trace, sealed manifest, comparison, ledger row, recording, or served-flow check.
The scorecard must distinguish reusable substrate readiness from demonstrated live-agent lift.
The latter requires a deciding interval above zero, or a registered negative result with power adequate for the useful effect.
Two public benchmark runs must retain their dataset and evaluator revisions, per-task outputs, missing costs, and independent outcome checks.
Audit evaluator behavior and task validity, then report broken or excluded tasks before interpreting pass rates.
Local fixture success remains a contract proof.

## Evidence informing the gates

- [OpenAI's evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices) calls for task sets that reflect real traffic and warns against biased datasets.
- [MLR-Bench](https://arxiv.org/html/2505.19955v3) found synthesized or placeholder experimental results in 8 of 10 Claude Code experimentation tasks.
- [An autoresearch case study](https://arxiv.org/abs/2607.18064) observed cross-run information leakage and row memorization in a small domain study.
- [AIDE²](https://arxiv.org/html/2609.26457v1) improved specialists, but its three-seed outer-loop comparison could not establish a better self-improver.
- [METR's reward-hacking cases](https://metr.org/blog/2025-06-05-recent-reward-hacking/) include reading grader answers and changing timing functions.
- [OpenAI's SWE-bench Verified audit](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/) found material defects in 59.4% of 138 selected hard tasks.
- [OpenAI's SWE-bench Pro audit](https://openai.com/index/separating-signal-from-noise-coding-evaluations/) retracted its earlier recommendation after finding broken public tasks.
