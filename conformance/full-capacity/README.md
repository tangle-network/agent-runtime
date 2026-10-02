# Full-capacity consumer acceptance

This read-only instrument measures a caller-registered recursive cohort through retained Runtime journals and Sandbox native sessions.
It does not launch work or change scheduling, profiles, provider routes, limits, or recovery.
The consumer launches its exact recorded inputs through its maintained entrypoint.
Discovery Lab uses `disco preflight <spec.json>` followed by its sandbox-hosted `disco submit` path.

The headline gate is fixed before launch:

- Derive total cohort concurrency from configured placement, Sandbox account, model subscription, Runtime, and explicit resource ceilings.
- Preserve the registered root identities and every frontier; count retries separately from logical `(runId, nodeId)` pairs.
- Observe the derived target in overlapping native executions, with fresh assistant text, reasoning, or tool-call growth between samples.
- Observe the registered recursive depth through Runtime parent edges.
- Settle every logical node before its finite deadline, with readable, hashed output and a completed native capture.
- Prove the served subscription route and disabled paid-API fallback for every admitted execution.
- Record zero failed or stranded logical nodes, duplicate native executions for one admission key, and unresolved measurement gaps.

An incomplete capacity dimension makes the target unknown.
That limits acceptance claims; it does not block useful launches within separately verified, authorized resource limits.
An explicit `unbounded` dimension requires a source; numeric zero means admission is closed.
Generic sandbox slots, live controllers, accepted spawns, queued sessions, and unrelated successful research do not satisfy this gate.
A finite resource budget still binds even if the configured fleet could provide more.
The instrument does not infer an unlimited budget from a maximum-capacity request.

## Register and run

Keep the experiment contract immutable, alongside the exact capacity snapshot and consumer inputs.
The contract needs these fields:

| Field | Meaning |
| --- | --- |
| `experimentId`, `mode` | Stable experiment identity and `full-capacity` or `recovery` |
| `registeredAt`, `deadlineAt` | ISO timestamps fixed before the first launch |
| `resources.maxConcurrent`, `resources.maxWallMs` | Positive, explicit cohort resource budget |
| `resources.maxPaidModelUsd` | Zero for a subscription-only experiment |
| `shapeDigest` | Digest of the exact CPU, memory, disk, capture and placement requirements |
| `maxCapacityAgeMs` | Maximum age of the capacity snapshot at registration |
| `minProductiveOverlapMs`, `minRecursiveDepth` | Fixed productive overlap and depth gates |
| `profile` | Exact `harness`, allowed `models`, and `credentialSource: "subscription"` |
| `frontiers` | Complete, distinct research frontier identities |
| `runs` | Exact root `runId`, `frontierId`, `directory`, and SHA-256 of immutable `run-input.json` |
| `consumer` | Installed `runtimeKernel` and `sandboxSdk` module paths, `baseUrl`, and credential environment variable name |
| `consumer.authEvidencePath` | Optional path populated by the credential owner with served-route receipts |
| `readConcurrency`, `readTimeoutMs` | Finite budgets for read-only observations |

The capacity snapshot needs `scope: "configured-maximum"`, `observedAt`, matching `shapeDigest`, and `constraints`.
Each of `placement`, `sandboxAccount`, `modelSubscription`, and `runtime` carries `state`, `source`, and `observedAt`.
A `known` constraint carries `value`, measured in total concurrent native executions available to this cohort.
Account limits subtract unrelated work and add the already admitted cohort before comparison.
A current free-space observation must not masquerade as the configured maximum after permitted autoscaling.
Unknown host shapes, deployment eligibility, storage, quotas, or budgets remain explicit reasons.

The credential owner writes route receipts with `idempotencyKey`, `executionId`, `mode`, `source`, and `paidApiFallbackDisabled`.
The collector accepts receipts only for the matching admitted execution.
Credentials and OAuth material never belong in that file.
Requested profile metadata alone does not establish which authentication route served a run.

```bash
node scripts/full-capacity-acceptance.mjs plan /evidence/contract.json /evidence/capacity.json
# Launch the frozen inputs through the consumer's maintained entrypoint.
node scripts/full-capacity-acceptance.mjs sample /evidence/contract.json /evidence/sample-1
# Take another observation after the registered overlap interval.
node scripts/full-capacity-acceptance.mjs sample /evidence/contract.json /evidence/sample-2
# Take a final observation after native completion, before evidence teardown.
node scripts/full-capacity-acceptance.mjs sample /evidence/contract.json /evidence/final
node scripts/full-capacity-acceptance.mjs assess /evidence/contract.json /evidence/capacity.json \
  /evidence/sample-1/observation.json /evidence/sample-2/observation.json /evidence/final/observation.json
```

Set only the named credential environment variable through its existing private loader.
The command reads existing sessions; `sample` never creates, prompts, resumes, stops, or destroys a sandbox.
Every destination must be new.
Run observations from a durable host; interruption of this observer does not change Runtime execution.
The collector retains raw native messages privately with mode `0600`; stdout contains counts and paths only.
Captured output is sensitive research content and must not be published with the code.

Exit codes are `0` for pass, `1` for a measured failure, and `2` for incomplete evidence.
At the deadline, any nonterminal logical node is a failure.
Before the deadline, missing terminal results remain incomplete.
No timeout, read error, partial pagination, absent capture, or unknown price becomes success.

## Recovery arm

Register fault injection as a separate `recovery` contract with `recoveryDeadlineMs`.
Only the deployment owner performs the authorized injection and `disco resume` on the original run identity.
The observation's `recoveries` records original run/node, before/after admission keys, injection/recovery timestamps, journal-prefix preservation, and duplicate-native count.
The key must stay unchanged, the journal prefix must survive, and the finite recovery deadline must hold.
Retry attempts remain in `attempts`; they never increase the logical-run denominator or count as independent research trials.
A passing recovery arm cannot make the uninjected full-capacity arm pass.

## Evidence limits and calibration

Native concurrency means overlapping execution intervals bracketed by two matching live-session observations with increased productive content.
It does not assert that every model emitted a token at the same instant or that CPU/GPU utilization was saturated.
Terminal captures must match the admitted native session and execution and report completion with productive content.
The collector uses Runtime's `FileSpawnJournal` and `FileResultBlobStore` for validation and content-addressed reads.
Nested tree markers cannot overwrite recorded parent edges.
Subscription-only route proof does not establish zero subscription or infrastructure cost.
Scientific value, novelty, and independent result verification remain separate research gates.

Run the smallest complete instrument check:

```bash
node --test scripts/full-capacity-acceptance.test.mjs
```

The accepted calibration has 200 logical nodes across 54 roots and real retained-response-shaped payloads.
Controls remove productivity, concurrency, output, a frontier, recursion, quota knownness, identity integrity, or the subscription route.
These are offline instrument calibrations, not a live full-capacity claim.
