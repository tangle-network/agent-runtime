# Public agent benchmark integration proof, 2026-09-24

**Decision:** The maintained benchmark paths produced three officially graded agent outputs across two public suites.
This is an execution proof from selected tasks, not a population solve-rate estimate.
No promotion or learning claim uses these scores.

## Scored runs

| Suite and task | Official result | Agent execution | Measured usage |
| --- | --- | --- | --- |
| Terminal-Bench core 0.1.1, `hello-world` | Pass, 2/2 checks | One OpenCode attempt, two tool calls, 63 s | 528 new input, 90 output, 20,992 cache-read tokens |
| Terminal-Bench core 0.1.1, `fix-permissions` | Pass, 1/1 check | One OpenCode attempt, three tool calls, 68 s | 376 new input, 98 output, 21,312 cache-read tokens |
| SWE-bench Verified, `astropy__astropy-12907` | Resolved, 2/2 fail-to-pass and 13/13 pass-to-pass tests | One Runtime shot, 20 model completions, 22 tool calls, 444 s | 270,485 input and 14,557 output tokens; cache split unknown |

The Terminal runner used the published Terminal-Bench 0.2.18 `tb` command and its native Docker task grader.
The runner requested `glm-5.3` through the Router-backed OpenCode provider.
The [route probe](model-probe/glm53-probe.json) reported `glm-5.3` in both the response body and [served-model header](model-probe/glm53-probe.headers).
The Terminal agent events do not retain per-request served-model headers, so exact identity on those task calls remains unverified.

The SWE runner used Runtime `runAgentic`, a jailed read/edit/run surface, and the official `swebench` 4.1.0 Docker evaluator.
Runtime checked every reported model against `glm-5.3` and rejected earlier `glm-5.2` requests that returned `glm-5.3`.
The patch changed only `astropy/modeling/separable.py`, applied cleanly to base commit `d16bfe05a744909de4b27f5875fe0d4ed41ce607`, and passed the [official task report](swe/astropy__astropy-12907/official-task-report.json).
Nine requested local `run` calls were unavailable because their task image was not cached.
The agent still produced the [504-byte patch](swe/astropy__astropy-12907/patch.diff); the evaluator ran its own tests later.

## Dataset, grader, and validity checks

Terminal-Bench used cached `terminal-bench-core==0.1.1` tasks.
The `hello-world` task and verifier SHA-256 values were `b123145ce3aa927dc82e99c6239ff32e856c9ccdf6f1b007889061337590a2df` and `e8d9b4ed8cd78114534c2caa569cfa09752b122115c7d084b467f9a55a3eaf48`.
The `fix-permissions` values were `d0d7b59d874b40fb7b4689a38734da75bd4c13715f435222578eae24d4bfbfc3` and `b4f18fa4d580f603f2c1f1e7d5b92c3cdb5c91e3d51427ed45c3633de5d10f2e`.
These hashes identify each `task.yaml` and `tests/test_outputs.py` in the cached dataset.

The `hello-world` grader checked file existence and exact content with a final newline.
It did not enforce the task's separate instruction to create no other files.
The `fix-permissions` grader checked the owner execute bit, a zero script exit, and the expected output string.
The [calibration receipts](calibration/) show gold pass and empty fail for `hello-world`, and empty fail for `fix-permissions`.
The adapter exposed no gold artifact for `fix-permissions`; its graded agent pass supplies the positive case.

SWE-bench used cached `princeton-nlp/SWE-bench_Verified`, `test` split, snapshot `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`.
The Astropy problem statement, gold patch, and test patch SHA-256 values were `c01334ec1b21a089c650cf2e7b96ab974469076bf1260d23885799e1f0a7551f`, `0f3e44432ed8540e9526edff4f83793948a2f139fc3971b67c30043c1eb7964a`, and `5ef90b640ffce4590bb61ef2ea0e3256416dddf41b45bf4f2c3610a6e8c53718`.
The [calibration receipts](calibration/) show the official gold patch resolved and an empty patch rejected.
The agent patch SHA-256 was `0172ca0d430e58fc42e46d478f879e667a9a6e262295d7b49aea68cbc53d5986`.
The grader reported zero evaluator errors and zero failed tests for that patch.

These tasks were selected for an integration check, and both Terminal tasks are marked easy.
The public Astropy issue may have appeared in model training data; this run cannot measure that exposure.
No scored task was excluded for a grader defect.

## Excluded execution attempts

- The first Terminal `hello-world` attempt sent tools with `reasoning_effort` to `gpt-5.4-mini`; Router returned HTTP 400 before a valid model completion.
- A later Terminal `hello-world` attempt passed its grader on a requested `glm-5.2` route, but the probe's response body said `glm-5.3` while its served-model header said `glm-5.2`.
- Two SWE Astropy attempts requested `glm-5.2` and had zero model completions and zero tool calls. Runtime rejected the provider-reported `glm-5.3` identity before agent work.

The [attempt logs](excluded/) and [model probes](model-probe/) retain these invalid executions.
Their failed or passed grader fields do not enter the scored denominators above.

## Cost and retained evidence

The Router did not return a billed USD receipt for these runs.
Runtime marked SWE dollar accounting unknown, and Terminal-Bench recorded tokens without billed cost.
At the probe's observed rates, multiplying all SWE tokens gives **$0.4604** as a rate illustration, not a bill.
Terminal cache-read pricing and actual settled charges are unknown.
No cost-effectiveness or equal-spend conclusion follows.

The [Terminal results and event traces](terminal/) retain each verifier decision, tool call, and token record.
The [SWE summary, tool trace, Runtime events, patch, and judge receipt](swe/astropy__astropy-12907/) retain the selected output and evaluator file hashes.
The full SWE evaluator directory remains at `.runs/public-bench-20260923/swe-glm53/astropy__astropy-12907/judge-1` in the measurement worktree.
Its receipt records nine file hashes and tree SHA-256 `6fe4a1ede18e899f1eb9c359402d05eb28cff5cb0c587f974e34ee67f3dd2822`.
[`SHA256SUMS.txt`](SHA256SUMS.txt) hashes every committed receipt in this directory.
