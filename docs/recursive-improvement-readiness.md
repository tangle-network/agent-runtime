# Recursive improvement readiness, 2026-09-24

**Overall: FAIL.** The reusable measurement path is taking shape, but no hosted agent has completed a sealed improvement cycle.
These decisions describe the evidence available on this date, not a forecast.
The [live-loop contract](./live-agent-improvement-loop.md) defines the promotion gate.

| Requirement | Decision | Checked evidence and remaining condition |
| --- | --- | --- |
| Mapped live loop and external review | **PASS** | The [execution contract](./live-agent-improvement-loop.md) maps capture through revert to maintained modules and product gaps. Two ChatGPT Pro reviews ([first](https://chatgpt.com/c/6ab47d9a-5534-83ea-a9a1-5b107484f1d7), [second](https://chatgpt.com/c/6ab47db4-b3f0-83e8-8a37-c21de1d8f749)) informed its traffic-cohort, telemetry, isolation, and replay controls. |
| Real hosted agent cohort | **FAIL** | No authorized Operator or Majo cohort joins raw traces, independent task outcomes, and billed cost. Local fixtures and router interaction traces cannot establish this join. |
| Automated candidate and sealed final test | **FAIL** | Runtime and Eval have candidate and paired-decision primitives, but neither has run on the exact selected candidate from a hosted agent. No frozen checker, disjoint random traffic cohort, registered power, or deciding interval exists for that pilot. |
| Shadow, concurrent canary, and exact promotion or revert | **FAIL** | The product has not supplied read-only replay placement, randomized traffic routing, separate arm memory, delayed outcomes, or a verified served-revision check for this pilot. No production activation is claimed. |
| Across-run learning, Gate B | **FAIL** | [Supervisor Lab #112](https://github.com/tangle-network/supervisor-lab/pull/112) merged the whole-episode reset/carry/revise runner. The [156-cell instrument report](https://github.com/tangle-network/supervisor-lab/pull/122) is synthetic; no live model grant and Sandbox control key were available. The bounded smoke cohort has only 22 tasks, below the 100 fresh-pair floor. |
| Real-trace reliability and regression | **FAIL** | [Eval #792](https://github.com/tangle-network/agent-eval/pull/792) records 239 CodeTraceBench traces in nine observed classes, including 33 unsolved unknowns, and repairs five replay evidence defects. The change is pending merge; 22 unique cases have replay resources, while 217 have explicit exclusions. The corpus does not measure hosted-agent failure prevalence. |
| Agent-proposed Eval experiment | **PASS** | [Eval #791](https://github.com/tangle-network/agent-eval/pull/791) merged a frozen return-code rule with independent raw-label scoring. On 31 primary tasks its F1 was 0.357 versus 0.549 for a historical analyst, paired difference −0.193, 95% task-bootstrap interval [−0.315, −0.067]. Transfer F1 was 0 on 104 tasks because return codes were absent. This is a negative experiment, not an Eval improvement. |
| Two public agent benchmarks | **FAIL** | Terminal-Bench core 0.1.1 `hello-world` passed its official verifier, 1/1, after two live agent tool calls. Its model response body and served header disagreed, so model identity remains unverified. The SWE-bench Verified live agent run is pending. Gold and empty-artifact calibration passed and failed as expected on both graders, but those checks are not agent scores. The router did not return billed cost for the live Terminal-Bench run. |

The highest-priority missing receipt is one authorized hosted-agent cohort with checked outcomes and cost.
Next, freeze its checker and source-unit split, then run one bounded candidate search and a paired final test.
Only a deciding improvement interval or a powered negative result can settle the live pilot.
