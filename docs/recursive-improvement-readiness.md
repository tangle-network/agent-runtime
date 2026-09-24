# Recursive improvement readiness, 2026-09-24

**Overall: FAIL.** The reusable measurement path is taking shape, but no hosted agent has completed a sealed improvement cycle.
These decisions describe the evidence available on this date, not a forecast.
The [live-loop contract](./live-agent-improvement-loop.md) defines the promotion gate.

| Requirement | Decision | Checked evidence and remaining condition |
| --- | --- | --- |
| Mapped live loop and external review | **PASS** | The [execution contract](./live-agent-improvement-loop.md) maps capture through revert to maintained modules and product gaps. Two ChatGPT Pro reviews ([first](https://chatgpt.com/c/6ab47d9a-5534-83ea-a9a1-5b107484f1d7), [second](https://chatgpt.com/c/6ab47db4-b3f0-83e8-8a37-c21de1d8f749)) informed its traffic-cohort, telemetry, isolation, and replay controls. |
| Real hosted agent cohort | **FAIL** | No authorized Operator or Majo cohort joins raw traces, independent task outcomes, and billed cost. Local fixtures and router interaction traces cannot establish this join. |
| Automated candidate and sealed final test | **FAIL** | Runtime and Eval have candidate and paired replay decisions. [Eval #793](https://github.com/tangle-network/agent-eval/pull/793) added a sealed randomized served-canary decision. No selected hosted candidate, frozen checker, disjoint live cohort, registered power, or live decision exists for this pilot. |
| Shadow, concurrent canary, and exact promotion or revert | **FAIL** | The product has not supplied read-only replay placement, randomized routing, arm isolation, a complete assignment ledger, checked delayed outcomes and settled bills, or verified served revisions. Eval's canary decision cannot supply these product receipts or activate a candidate. |
| Across-run learning, Gate B | **FAIL** | [Supervisor Lab #112](https://github.com/tangle-network/supervisor-lab/pull/112) merged the whole-episode reset/carry/revise runner. The [156-cell instrument report](https://github.com/tangle-network/supervisor-lab/pull/122) is synthetic; no live model grant and Sandbox control key were available. The bounded smoke cohort has only 22 tasks, below the 100 fresh-pair floor. |
| Real-trace reliability and regression | **FAIL** | [Eval #792](https://github.com/tangle-network/agent-eval/pull/792) merged 239 CodeTraceBench traces in nine observed classes, including 33 unsolved unknowns, and repaired five replay evidence defects. Only 22 unique cases have replay resources; 217 have explicit exclusions. The corpus cannot supply the requested top 20 live-agent failure classes or measure hosted-agent prevalence. |
| Agent-proposed Eval experiment | **PASS** | [Eval #791](https://github.com/tangle-network/agent-eval/pull/791) merged a frozen return-code rule with independent raw-label scoring. On 31 primary tasks its F1 was 0.357 versus 0.549 for a historical analyst, paired difference −0.193, 95% task-bootstrap interval [−0.315, −0.067]. Transfer F1 was 0 on 104 tasks because return codes were absent. This is a negative experiment, not an Eval improvement. |
| Two public agent benchmarks | **PASS** | [Benchmark proof #1341](https://github.com/tangle-network/agent-runtime/pull/1341) retains agent traces and official grader receipts. Terminal-Bench core 0.1.1 passed 2/2 selected tasks; SWE-bench Verified resolved 1/1 selected Astropy task, with 2/2 fail-to-pass and 13/13 pass-to-pass tests. These selected tasks prove execution, not population solve rates. Terminal task calls lack per-request served-model headers, its `hello-world` grader omits the no-other-files clause, and billed USD is unknown. |

Runtime's source peer range `>=0.185.0 <0.187.0` excludes Eval 0.187.0, which supplies the canary decision.
Public Knowledge 17.1.2 also excludes it through its `>=0.182.0 <0.187.0` peer range.
The package release owners must verify and publish a compatible dependency closure before the pilot installs these packages together.

The highest-priority missing receipt is one authorized hosted-agent cohort with checked outcomes and cost.
Next, freeze its checker and source-unit split, then run one bounded candidate search and a paired replay final test.
Only the randomized served canary's checked improvement interval or a registered powered negative result can settle the live pilot.
